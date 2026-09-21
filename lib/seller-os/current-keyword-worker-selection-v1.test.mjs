import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { nextCurrentPackageKeywordPlanV1 } from "./current-keyword-continuation-v2-1.ts"

function fixture(mutate = () => {}) {
  const plan = { id: "plan", marketplace_account_key: "account", current_listing_package_id: "package",
    source_context: "QUICK_PICK_RESEARCH_REQUIRED", status: "ACTIVE", marketplace: "EBAY_US", worker_claim_count: 0,
    source_opportunity_id: "opportunity", source_candidate_key: "luna-portex:100:200",
    source_luna_product_id: "100", subject_supplier_variant_id: "200", source_supplier_sku: "sku" }
  const pkg = { id: "package", account_key: "account", opportunity_id: "opportunity", status: "draft",
    candidate_key: plan.source_candidate_key, package_data: { currentPublicationFactoryV1: {
      version: "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1", authorityPolicy: "CURRENT_ONLY",
      reuseLegacyPreparation: false, packageId: "package", accountKey: "account", generation: "generation",
      productId: "100", variantId: "200", supplierSku: "sku", publicationAuthorized: false,
    }, preparationStatus: { keyword: "WAITING_FOR_CANONICAL_KEYWORD_HANDOFF" } } }
  const opportunity = { id: "opportunity", candidate_key: plan.source_candidate_key,
    supplier_product_id: "100", supplier_variant_id: "200", supplier_sku: "sku", product_title: "supplier title" }
  const task = { id: "task", plan_id: "plan", status: "PENDING", marketplace_account_key: "account", marketplace: "EBAY_US" }
  const data = { plan, pkg, opportunity, task }
  mutate(data)
  const calls = []
  const tables = { marketplace_product_research_query_plans: [plan], ebay_current_listing_packages_v1: [pkg],
    ebay_luna_opportunity_queue: [opportunity], marketplace_product_research_query_tasks: task ? [task] : [] }
  return { calls, supabase: { from(table) {
    calls.push(table)
    let rows = tables[table]
    assert.ok(rows, table)
    const get = (r, k) => k.split(/->>?/).reduce((v, p) => v?.[p], r)
    const q = { select() { return q }, eq(k, v) { rows = rows.filter(r => get(r, k) === v); return q },
      in(k, values) { rows = rows.filter(r => values.includes(r[k])); return q },
      not(k, _, v) { rows = rows.filter(r => r[k] !== v); return q },
      lt(k, v) { rows = rows.filter(r => r[k] < v); return q }, order() { return q },
      limit(n) { rows = rows.slice(0, n); return q },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }) },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) } }
    return q
  } } }
}
const run = f => nextCurrentPackageKeywordPlanV1({ supabase: f.supabase, accountKey: "account", now: new Date("2026-09-21T00:00:00Z") })
test("current canonical draft keyword plan selected read-only", async () => {
  const f = fixture()
  assert.deepEqual(await run(f), { planId: "plan", listingPackageId: "package", globalQueueFallback: false, marketplaceWrites: 0 })
})
test("scope, current package, identity, lease and bounded retries fail closed", async () => {
  for (const mutate of [
    f => f.plan.marketplace_account_key = "other", f => f.pkg.account_key = "other",
    f => f.pkg.status = "published", f => f.plan.current_listing_package_id = null,
    f => f.plan.source_context = "LUNA_PRE_RESEARCH", f => f.plan.status = "COMPLETED",
    f => f.plan.source_luna_product_id = "101", f => f.plan.subject_supplier_variant_id = "201",
    f => f.plan.source_supplier_sku = "other", f => f.opportunity.candidate_key = "other",
    f => f.pkg.package_data.currentPublicationFactoryV1.publicationAuthorized = true,
    f => f.pkg.package_data.currentPublicationFactoryV1.reuseLegacyPreparation = true,
    f => f.pkg.package_data.preparationStatus = {},
    f => f.task.status = "PROCESSED", f => f.plan.worker_claim_count = 5,
    f => f.plan.worker_lease_expires_at = "2026-09-22T00:00:00Z",
    f => f.plan.worker_next_retry_at = "2026-09-22T00:00:00Z",
    f => f.plan.worker_lease_expires_at = "malformed",
  ]) assert.equal((await run(fixture(mutate))).planId, null)
})
test("worker uses separate bounded selector and existing lease/claim authority", () => {
  const runner = readFileSync("app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx", "utf8")
  assert.ok(runner.includes('action: "GET_NEXT_AUTHORIZED_PRE_RESEARCH_BATCH_PLAN"'))
  assert.ok(runner.includes('action: "GET_NEXT_CURRENT_PACKAGE_KEYWORD_PLAN"'))
  assert.ok(runner.includes('action: "CLAIM_AUTONOMOUS_RESEARCH_PLAN"'))
  const route = readFileSync("app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")
  assert.ok(route.includes("CURRENT_KEYWORD_OWNER_REQUIRED"))
})
