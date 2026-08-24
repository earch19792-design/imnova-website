import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildLunaStockCheckJobV1,
  buildLunaStockObservationWindowV1,
  type SellerOsLunaStockLinkageV1,
// @ts-ignore -- Node's native TypeScript test runner requires the extension.
} from "./ebay-luna-stock-observation-v1.ts"
import {
  createSellerOsLunaStockObservationRepositoryV1,
  type SellerOsPersistableLunaStockObservationV1,
// @ts-ignore -- Node's native TypeScript test runner requires the extension.
} from "./ebay-luna-stock-observation-repository-v1.ts"
import {
  createSellerOsLunaPublicExactStockAuthorityV1,
  SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1,
// @ts-ignore -- Node's native TypeScript test runner requires the extension.
} from "./ebay-luna-public-exact-stock-authority-v1.ts"
import { canonicalLunaProductUrlV1 } from
// @ts-ignore -- Node's native TypeScript test runner requires the extension.
  "./ebay-luna-supplier-stock-watcher-v1.ts"

export const SELLER_OS_STOCK_IDENTITY_AUTO_RECONCILIATION_VERSION =
  "STOCK_IDENTITY_AUTO_RECONCILIATION_V1" as const

const ITEM_ID = /^\d{9,19}$/
const MAXIMUM_TARGETS = 20

type DecisionRow = Readonly<{
  decision_id: string
  decision_version: number
  decision: string
  ebay_item_id: string
  ebay_sku: string | null
  linkage_id: string | null
  components: unknown
}>

type VariantRow = Readonly<{
  supplier_product_id: string
  supplier_variant_id: string
  sku: string | null
  product_url: string | null
}>

type ExactComponent = Readonly<{
  componentIdentityId: string
  productId: string
  variantId: string
  sku: string
  canonicalSourceUrl: string
  supplierQuantityRequired: number
}>

export function resolveSellerOsExactStockIdentityV1(input: Readonly<{
  certifiedComponents: readonly Readonly<{
    productId: string
    variantId: string
    sku: string
    quantityRequired: number
  }>[]
  availableIdentities: readonly VariantRow[]
}>) {
  let ambiguous = false
  const components: ExactComponent[] = []
  for (const component of input.certifiedComponents) {
    const matches = input.availableIdentities.filter((row) =>
      row.supplier_product_id === component.productId &&
      row.supplier_variant_id === component.variantId &&
      row.sku === component.sku && Boolean(row.product_url))
    if (matches.length > 1) ambiguous = true
    if (matches.length !== 1) continue
    const canonicalSourceUrl = canonicalLunaProductUrlV1(
      matches[0].product_url as string,
    )
    if (!canonicalSourceUrl) continue
    components.push(Object.freeze({
      componentIdentityId: digest("luna-component-identity-v1", [
        component.productId, component.variantId, component.sku,
      ]),
      productId: component.productId,
      variantId: component.variantId,
      sku: component.sku,
      canonicalSourceUrl,
      supplierQuantityRequired: component.quantityRequired,
    }))
  }
  return Object.freeze({
    status: ambiguous ? "AMBIGUOUS" as const
      : components.length === input.certifiedComponents.length
        ? "AUTO_RESOLVED" as const : "NO_MATCH" as const,
    components: Object.freeze(components),
  })
}

function digest(prefix: string, value: unknown) {
  return `${prefix}:sha256:${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex")}`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeText(value: unknown, maximum = 160) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim()
  return normalized && normalized.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 &&
    Number(value) <= 10_000 ? Number(value) : null
}

function parseCertifiedComponents(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return []
  const parsed = value.flatMap((entry) => {
    const row = record(entry)
    const productId = safeText(row.lunaProductId, 100)
    const variantId = safeText(row.lunaVariantId, 100)
    const sku = safeText(row.lunaSku, 120)
    const quantityRequired = positiveInteger(row.supplierQuantityRequired)
    const certified = row.exactProductIdentity === true &&
      row.exactVariantIdentity === true && row.exactSupplierSku === true &&
      row.structuredVariantAttributesComplete === true &&
      row.identityConflict === false
    return productId && variantId && sku && quantityRequired && certified
      ? [{ productId, variantId, sku, quantityRequired }] : []
  })
  const keys = new Set(parsed.map((component) => JSON.stringify([
    component.productId, component.variantId, component.sku,
  ])))
  return parsed.length === value.length && keys.size === parsed.length
    ? parsed : []
}

function persistedObservation(input: {
  job: ReturnType<typeof buildLunaStockCheckJobV1>
  attemptNumber: number
  observation: Awaited<ReturnType<ReturnType<
    typeof createSellerOsLunaPublicExactStockAuthorityV1>>>
}): SellerOsPersistableLunaStockObservationV1 {
  const value = input.observation
  const available = value.sourceStatus === "AVAILABLE"
  const state = !available ? "UNKNOWN"
    : value.stockState === "CERTIFIED_OOS" ? "OBSERVED_OUT_OF_STOCK"
      : value.observedSupplierQuantity !== null ? "OBSERVED_QUANTITY"
        : value.stockState === "IN_STOCK" ? "OBSERVED_IN_STOCK" : "UNKNOWN"
  const observationId = digest("luna-stock-observation-v1", [
    input.job.stockCheckJobId, value.componentIdentityId,
    input.attemptNumber, input.job.contractVersion,
  ])
  const limitations = [...new Set([
    SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1,
    "PUBLIC_EXACT_IDENTITY_MATCHED",
    ...(value.certifiedOos ? ["PUBLIC_EXACT_CERTIFIED_OOS"] : []),
    ...(value.limitationCode ? [value.limitationCode] : []),
  ])].sort()
  return Object.freeze({
    observationId,
    stockCheckJobId: input.job.stockCheckJobId,
    linkageId: input.job.linkageId,
    canonicalEbayItemId: input.job.ebayItemId,
    componentIdentityId: value.componentIdentityId,
    lunaProductIdentity: value.lunaProductId,
    lunaVariantIdentity: value.lunaVariantId,
    lunaSku: value.lunaSku,
    supplierQuantityRequired: value.supplierQuantityRequired,
    observationState: state,
    sourceStatus: available ? "AVAILABLE" : "UNAVAILABLE",
    observedAvailability: available
      ? value.supplierStatedAvailability : null,
    observedSupplierQuantity: available
      ? value.observedSupplierQuantity : null,
    evidenceClass: available ? "SUPPLIER_STATED" : "UNAVAILABLE",
    evidenceDigest: digest("luna-stock-evidence-v1", [
      observationId, value.evidenceDigest, state,
      value.supplierStatedAvailability, value.observedSupplierQuantity,
    ]),
    acquisitionMethod: "CANONICAL_SERVER_READ",
    attemptCorrelation: Object.freeze({ attemptNumber: input.attemptNumber }),
    observedAt: value.observedAt,
    freshnessInput: Object.freeze({ maximumAgeSeconds: 21_600 }),
    limitations: Object.freeze(limitations),
  })
}

export async function reconcileSellerOsStockIdentityV1(
  supabase: SupabaseClient,
  input: Readonly<{
    accountKey: string
    targetItemIds: readonly string[]
    now?: Date
  }>,
) {
  const targets = [...new Set(input.targetItemIds.filter((itemId) =>
    ITEM_ID.test(itemId)))].sort().slice(0, MAXIMUM_TARGETS)
  if (!targets.length) return Object.freeze({
    contractVersion: SELLER_OS_STOCK_IDENTITY_AUTO_RECONCILIATION_VERSION,
    targetCount: 0, autoResolvedCount: 0, ambiguousCount: 0,
    noMatchCount: 0, inStockCount: 0, certifiedOosCount: 0,
    outcomes: Object.freeze([]), databaseWrites: 0, ebayWrites: 0,
  })
  const [listingRead, decisionRead] = await Promise.all([
    supabase.from("ebay_active_listings")
      .select("ebay_item_id,ebay_sku")
      .eq("account_key", input.accountKey)
      .eq("listing_status", "active")
      .in("ebay_item_id", targets),
    supabase.from("seller_os_luna_linkage_decisions")
      .select("decision_id,decision_version,decision,ebay_item_id,ebay_sku,linkage_id,components")
      .eq("account_key", input.accountKey)
      .eq("marketplace_id", "EBAY_US")
      .in("ebay_item_id", targets)
      .order("decision_version", { ascending: false }),
  ])
  if (listingRead.error || decisionRead.error) {
    throw new Error("STOCK_IDENTITY_RECONCILIATION_SOURCE_READ_FAILED")
  }
  const liveSkus = new Map((listingRead.data ?? []).map((row) =>
    [String(row.ebay_item_id), safeText(row.ebay_sku, 120)]))
  const latest = new Map<string, DecisionRow>()
  for (const row of (decisionRead.data ?? []) as DecisionRow[]) {
    if (!latest.has(row.ebay_item_id)) latest.set(row.ebay_item_id, row)
  }
  const seeds = targets.flatMap((itemId) => {
    const decision = latest.get(itemId)
    const components = decision ? parseCertifiedComponents(decision.components) : []
    return liveSkus.has(itemId) && decision?.decision ===
      "APPROVE_EXACT_LINKAGE" && decision.linkage_id && components.length
      ? [{ itemId, ebaySku: liveSkus.get(itemId) ?? decision.ebay_sku,
          linkageId: decision.linkage_id, components }]
      : []
  })
  const productIds = [...new Set(seeds.flatMap((seed) =>
    seed.components.map((component) => component.productId)))]
  const variantRead = productIds.length ? await supabase
    .from("market_radar_latest_variants")
    .select("supplier_product_id,supplier_variant_id,sku,product_url")
    .eq("source_key", "lunaportex")
    .in("supplier_product_id", productIds)
    .limit(500) : { data: [], error: null }
  if (variantRead.error) {
    throw new Error("STOCK_IDENTITY_RECONCILIATION_LUNA_IDENTITY_READ_FAILED")
  }
  const variants = (variantRead.data ?? []) as VariantRow[]
  const repository = createSellerOsLunaStockObservationRepositoryV1(supabase)
  const now = input.now ?? new Date()
  const outcomes: Array<Record<string, unknown>> = []
  let databaseWrites = 0
  for (const target of targets) {
    const seed = seeds.find((candidate) => candidate.itemId === target)
    if (!seed) {
      outcomes.push({ itemId: target, status: "NO_MATCH" })
      continue
    }
    const resolution = resolveSellerOsExactStockIdentityV1({
      certifiedComponents: seed.components,
      availableIdentities: variants,
    })
    const exactComponents = resolution.components
    if (resolution.status !== "AUTO_RESOLVED") {
      outcomes.push({ itemId: target, status: resolution.status })
      continue
    }
    const linkage: SellerOsLunaStockLinkageV1 = Object.freeze({
      linkageId: seed.linkageId,
      status: "CERTIFIED",
      ebayItemId: target,
      ebaySku: seed.ebaySku,
      components: Object.freeze(exactComponents.map((component) =>
        Object.freeze({ ...component,
          variantSemantics: "EXACT_VARIANT_REQUIRED" as const }))),
      bundleMode: exactComponents.length > 1
        ? "MULTI_COMPONENT_BOM" : "NOT_APPLICABLE",
    })
    const window = buildLunaStockObservationWindowV1({
      now: now.toISOString(), intervalSeconds: 3_600,
    })
    const job = buildLunaStockCheckJobV1({ linkage,
      observationWindow: window, acquisitionMethod: "CANONICAL_SERVER_READ" })
    await repository.ensureJob({ accountKey: input.accountKey, job })
    databaseWrites += 1
    const workerId = `stock-identity-v1:${createHash("sha256")
      .update(`${target}:${now.toISOString()}`).digest("hex").slice(0, 32)}`
    // The job row is created by the database during ensureJob. Claim with a
    // fresh timestamp so its immutable timestamp ordering cannot move
    // backwards when the request crossed a network boundary.
    const claim = await repository.claimJob({ stockCheckJobId: job.stockCheckJobId,
      workerId, now: new Date().toISOString() })
    if (!claim.claimed || !claim.attemptNumber) {
      outcomes.push({ itemId: target, status: "ALREADY_CURRENT" })
      continue
    }
    databaseWrites += 1
    const authority = createSellerOsLunaPublicExactStockAuthorityV1({
      loadLinkageById: async (linkageId) =>
        linkageId === seed.linkageId ? linkage : null,
    })
    const persisted = []
    for (const component of exactComponents) {
      const observed = await authority({ linkageId: seed.linkageId,
        componentIdentityId: component.componentIdentityId })
      const row = persistedObservation({ job,
        attemptNumber: claim.attemptNumber, observation: observed })
      await repository.ensureObservation({ accountKey: input.accountKey,
        observation: row, leaseOwner: workerId, now: new Date().toISOString() })
      databaseWrites += 1
      persisted.push({ observed, row })
    }
    const packageDigest = digest("luna-stock-package-v1", [
      job.stockCheckJobId,
      persisted.map((entry) => entry.row.evidenceDigest).sort(),
    ])
    await repository.completeJob({ stockCheckJobId: job.stockCheckJobId,
      workerId, packageDigest, now: new Date().toISOString() })
    databaseWrites += 1
    const certifiedOos = persisted.some((entry) => entry.observed.certifiedOos)
    const allInStock = persisted.every((entry) =>
      entry.observed.stockState === "IN_STOCK")
    outcomes.push({ itemId: target, status: "AUTO_RESOLVED",
      stockState: certifiedOos ? "CERTIFIED_OOS"
        : allInStock ? "IN_STOCK_SIGNAL" : "STOCK_UNKNOWN" })
  }
  return Object.freeze({
    contractVersion: SELLER_OS_STOCK_IDENTITY_AUTO_RECONCILIATION_VERSION,
    targetCount: targets.length,
    autoResolvedCount: outcomes.filter((row) =>
      row.status === "AUTO_RESOLVED" || row.status === "ALREADY_CURRENT").length,
    ambiguousCount: outcomes.filter((row) => row.status === "AMBIGUOUS").length,
    noMatchCount: outcomes.filter((row) => row.status === "NO_MATCH").length,
    inStockCount: outcomes.filter((row) =>
      row.stockState === "IN_STOCK_SIGNAL").length,
    certifiedOosCount: outcomes.filter((row) =>
      row.stockState === "CERTIFIED_OOS").length,
    outcomes: Object.freeze(outcomes.map(Object.freeze)),
    databaseWrites,
    ebayWrites: 0 as const,
  })
}
