import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { readCommercialTracePreListingFeeV1 } = await import(
  "./commercial-trace-prelisting-fee-read-v1.ts")
const { feePackageRevisionV1 } = await import(
  "../seller-os/ebay-fee-producer-v1.ts")
const account = "test-account"
const packageId = "24535b37-0335-4984-a36c-dbb73a7560da"
const packageData = { categoryId: "50692",
  pricing: { targetPrice: 50, currency: "USD" } }
const revision = feePackageRevisionV1(packageData)
const input = { marketplaceAccountKey: account,
  lunaProductId: "9220832493792", lunaVariantId: "48809643540704",
  supplierSku: "ITEM-8049-ORA-LU-DE", categoryId: "50692",
  salePrice: 50, now: new Date("2026-09-23T20:00:00Z") }
const queueRow = { id: "11111111-1111-4111-8111-111111111111",
  candidate_key: "exact-candidate",
  supplier_product_id: input.lunaProductId,
  supplier_variant_id: input.lunaVariantId,
  supplier_sku: input.supplierSku }
const packageRow = { id: packageId, account_key: account,
  opportunity_id: queueRow.id, candidate_key: queueRow.candidate_key,
  package_data: packageData }
function db(change = {}) {
  const reads = []
  return { reads, from(table) {
    const query = { filters: {}, select() { return this },
      eq(key, value) { this.filters[key] = value; return this },
      limit(count) {
        reads.push({ table, count, filters: { ...this.filters } })
        const data = table === "ebay_luna_opportunity_queue"
          ? change.queue ?? [queueRow] : change.packages ?? [packageRow]
        return Promise.resolve({ data, error: null })
      } }
    return query
  } }
}
function handoff(change = {}) {
  return async (args) => {
    assert.equal(args.accountKey, account)
    assert.equal(args.itemId, null)
    assert.equal(args.packageId, packageId)
    return { status: change.status ?? "PROVEN",
      resolvedAuthority: { marketplaceAccountKey: account,
        marketplace: "EBAY_US", itemId: null,
        packageId, packageRevision: revision, sku: input.supplierSku,
        categoryId: input.categoryId, feeBasis: { salePrice: 50 },
        ...change.authority } }
  }
}
test("exact existing package reuses canonical pre-sale fee without writes", async () => {
  const supabase = db()
  const result = await readCommercialTracePreListingFeeV1({ ...input,
    supabase, readFeeHandoff: handoff() })
  assert.equal(result.status, "PROVEN")
  assert.equal(result.fee.packageRevision, revision)
  assert.equal(result.fee.packageIdentity.supplierSku, input.supplierSku)
  assert.equal(result.fee.floorFeeIntervalBound, null)
  assert.deepEqual(supabase.reads.map((entry) => entry.table),
    ["ebay_luna_opportunity_queue", "ebay_listing_packages"])
  assert.equal(supabase.reads[1].filters.account_key, account)
})
test("missing or ambiguous package cannot borrow another fee", async () => {
  for (const packages of [[], [packageRow, packageRow]]) {
    const result = await readCommercialTracePreListingFeeV1({ ...input,
      supabase: db({ packages }), readFeeHandoff: async () => {
        throw Error("HANDOFF_MUST_NOT_BE_CALLED")
      } })
    assert.equal(result.status, "MISSING")
  }
})
test("wrong account, category, price or current handoff fails closed", async () => {
  for (const pkg of [
    { ...packageRow, account_key: "OTHER" },
    { ...packageRow, package_data: { ...packageData, categoryId: "OTHER" } },
    { ...packageRow, package_data: { ...packageData,
      pricing: { targetPrice: 49, currency: "USD" } } },
  ]) {
    const result = await readCommercialTracePreListingFeeV1({ ...input,
      supabase: db({ packages: [pkg] }), readFeeHandoff: async () => {
        throw Error("HANDOFF_MUST_NOT_BE_CALLED")
      } })
    assert.equal(result.status, "MISSING")
  }
  const stale = await readCommercialTracePreListingFeeV1({ ...input,
    supabase: db(), readFeeHandoff: handoff({ status: "STALE" }) })
  assert.equal(stale.status, "STALE")
  assert.equal(stale.fee.status, "STALE")
  for (const changes of [
    { authority: { marketplaceAccountKey: "OTHER" } },
    { authority: { categoryId: "OTHER" } },
    { authority: { feeBasis: { salePrice: 49 } } }]) {
    const result = await readCommercialTracePreListingFeeV1({ ...input,
      supabase: db(), readFeeHandoff: handoff(changes) })
    assert.equal(result.status, "MISSING")
  }
})
test("missing market price or category performs no database read", async () => {
  const supabase = db()
  const result = await readCommercialTracePreListingFeeV1({ ...input,
    salePrice: null, supabase })
  assert.equal(result.status, "MISSING")
  assert.equal(supabase.reads.length, 0)
})
