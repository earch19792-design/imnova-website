import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

export const SELLER_OS_CURRENT_FUTURE_STOCKGUARD_WIRING_VERSION =
  "CURRENT_AND_FUTURE_LISTING_LUNA_STOCKGUARD_WIRING_V1" as const
export const SELLER_OS_PUBLISH_WITH_STOCKGUARD_CONTRACT_VERSION =
  "PUBLISH_WITH_STOCKGUARD_CONTRACT_V1" as const

export const SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1 = Object.freeze([
  "366543596425", "366574069492", "366575102453", "366581718546",
  "366582544476", "366582586826", "366582630351", "366582671136",
  "366584136876", "366584249461", "366584348898", "366592485792",
  "366592919965", "366597434810", "366597780377", "366602466981",
  "366608128809",
] as const)
export const SELLER_OS_ENDED_ITEM_IDS_EXCLUDED_V1 = Object.freeze([
  "366569086086", "366581670145",
] as const)

export type SellerOsApprovedComponentV1 = Readonly<{
  productId: string
  variantId: string
  supplierSku: string
  supplierCostUsd: number
  quantityRequiredPerBundle: number
}>
export type SellerOsApprovedListingLinkageV1 = Readonly<{
  itemId: string
  mode: "SINGLE_COMPONENT" | "MULTI_COMPONENT_BOM"
  components: readonly SellerOsApprovedComponentV1[]
}>

export const SELLER_OS_HUMAN_APPROVED_CURRENT_LINKAGES_V1 = Object.freeze([
  ["366574069492", "9220837933280", "48809649504480",
    "Jhoel-Food Scale-with Nutritional-Calculator-B0CS36YWSB", 10.10],
  ["366581718546", "9220836098272", "48809647276256",
    "Alibaba-Body-Bag-Brown-B0BGK71P7X-1", 2.52],
  ["366582544476", "9220836753632", "48809648095456", "ITEM3429", 9.90],
  ["366582586826", "9220805755104", "48809607659744", "ITEM5810", 44.20],
  ["366582671136", "9220832755936", "48809643802848", "ITEM3704", 6.52],
  ["366592485792", "9220805787872", "48809607692512", "ITEM5803", 31.15],
  ["366592919965", "9220864016608", "53002127507680",
    "FL-LUXURY-MEN-RING", 4.87],
  ["366597434810", "9220815749344", "48809620930784", "ITEM5195", 11.58],
].map(([itemId, productId, variantId, supplierSku, cost]) => Object.freeze({
  itemId: String(itemId), mode: "SINGLE_COMPONENT" as const,
  components: Object.freeze([Object.freeze({ productId: String(productId),
    variantId: String(variantId), supplierSku: String(supplierSku),
    supplierCostUsd: Number(cost), quantityRequiredPerBundle: 1 })]),
})))

export const SELLER_OS_HUMAN_APPROVED_BUNDLE_V1 = Object.freeze({
  itemId: "366584348898", mode: "MULTI_COMPONENT_BOM" as const,
  components: Object.freeze([
    Object.freeze({ productId: "9220836098272", variantId: "48809647276256",
      supplierSku: "Alibaba-Body-Bag-Brown-B0BGK71P7X-1",
      supplierCostUsd: 2.52, quantityRequiredPerBundle: 1 }),
    Object.freeze({ productId: "9220837245152", variantId: "48809648750816",
      supplierSku: "Jhoel-40000mAh-Portable-Charger with 30W-B0C2423BW9",
      supplierCostUsd: 19.90, quantityRequiredPerBundle: 1 }),
  ]),
})

export const SELLER_OS_BLOCKED_IDENTITY_ITEM_IDS_V1 = Object.freeze([
  "366543596425", "366575102453", "366582630351", "366584136876",
  "366584249461", "366597780377", "366602466981", "366608128809",
] as const)

const ITEM_ID = /^\d{9,19}$/
const LUNA_ID = /^\d{1,30}$/
const SKU = /^[^\u0000-\u001f\u007f]{1,200}$/

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

export function assertSellerOsAuthoritativeCurrentLiveCohortV1(
  actualItemIds: readonly string[],
) {
  const actual = [...new Set(actualItemIds.map(String))].sort()
  const expected = [...SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1].sort()
  if (actual.some((itemId) => !ITEM_ID.test(itemId)) ||
      JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("SELLER_OS_CURRENT_LIVE_COHORT_CHANGED_FAIL_CLOSED")
  }
  if (SELLER_OS_ENDED_ITEM_IDS_EXCLUDED_V1.some((itemId) =>
    actual.includes(itemId))) {
    throw new Error("SELLER_OS_ENDED_ITEM_RESURRECTION_REJECTED")
  }
  return Object.freeze({ authoritative: true as const, liveCount: 17 as const,
    itemIds: Object.freeze(actual), endedItemIdsExcluded: true as const })
}

function componentKey(component: SellerOsApprovedComponentV1) {
  return `${component.productId}:${component.variantId}:${component.supplierSku}`
}

export function assertSellerOsHumanApprovedLinkageEvidenceV1(input: {
  approval: SellerOsApprovedListingLinkageV1
  observedComponents: readonly Readonly<{
    productId: string
    variantId: string
    supplierSku: string
    canonicalUrl: string
    observedAt: string
  }>[]
}) {
  if (!ITEM_ID.test(input.approval.itemId) ||
      !SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1.includes(
        input.approval.itemId as typeof SELLER_OS_CURRENT_LIVE_ITEM_IDS_V1[number])) {
    throw new Error("SELLER_OS_APPROVED_LINKAGE_CURRENT_ITEM_REQUIRED")
  }
  const observed = new Map(input.observedComponents.map((component) =>
    [componentKey({ ...component, supplierCostUsd: 0,
      quantityRequiredPerBundle: 1 }), component]))
  const components = input.approval.components.map((component) => {
    if (!LUNA_ID.test(component.productId) || !LUNA_ID.test(component.variantId) ||
        !SKU.test(component.supplierSku) ||
        !Number.isFinite(component.supplierCostUsd) ||
        component.supplierCostUsd <= 0 ||
        !Number.isSafeInteger(component.quantityRequiredPerBundle) ||
        component.quantityRequiredPerBundle < 1) {
      throw new Error("SELLER_OS_APPROVED_LINKAGE_IDENTITY_INVALID")
    }
    const evidence = observed.get(componentKey(component))
    if (!evidence || !/^https:\/\/(?:www\.)?lunaportex\.com\/products\/[A-Za-z0-9%._~-]+$/.test(
      evidence.canonicalUrl) || !Number.isFinite(Date.parse(evidence.observedAt))) {
      throw new Error("SELLER_OS_APPROVED_LINKAGE_EXACT_EVIDENCE_REQUIRED")
    }
    return Object.freeze({ ...component, canonicalUrl: evidence.canonicalUrl,
      observedAt: new Date(evidence.observedAt).toISOString(),
      componentIdentityId: `luna-component-identity-v1:${digest([
        component.productId, component.variantId, component.supplierSku,
      ])}`.replace(":sha256:sha256:", ":sha256:") })
  })
  if (input.approval.mode === "SINGLE_COMPONENT" && components.length !== 1) {
    throw new Error("SELLER_OS_APPROVED_SINGLE_COMPONENT_GRAIN_INVALID")
  }
  if (input.approval.mode === "MULTI_COMPONENT_BOM" && components.length < 2) {
    throw new Error("SELLER_OS_APPROVED_BUNDLE_INCOMPLETE")
  }
  if (new Set(components.map(componentKey)).size !== components.length) {
    throw new Error("SELLER_OS_APPROVED_BUNDLE_COMPONENT_DUPLICATE")
  }
  return Object.freeze({ itemId: input.approval.itemId,
    mode: input.approval.mode, components: Object.freeze(components),
    complete: true as const, certifiedBy: "HUMAN_APPROVED_EXACT_IDENTITY" as const })
}

export type SellerOsStockguardReadinessV1 = "STOCKGUARD_READY" |
  "STOCKGUARD_PARTIAL" | "STOCKGUARD_BLOCKED_IDENTITY" |
  "STOCKGUARD_BLOCKED_STOCK_EVIDENCE"

export function classifySellerOsCurrentListingStockguardReadinessV1(input: {
  currentLive: boolean
  exactItemSkuIdentity: boolean
  linkageCertified: boolean
  compositionComplete: boolean
  sourceHealth: "HEALTHY" | "UNAVAILABLE" | "UNPROVEN"
  freshness: "FRESH" | "STALE" | "UNPROVEN"
  stockState: "CERTIFIED_OOS" | "IN_STOCK" | "STOCK_UNKNOWN"
  canonicalProjectionAvailable: boolean
}) : SellerOsStockguardReadinessV1 {
  if (!input.currentLive || !input.exactItemSkuIdentity ||
      !input.linkageCertified) return "STOCKGUARD_BLOCKED_IDENTITY"
  if (!input.compositionComplete) return "STOCKGUARD_PARTIAL"
  if (input.sourceHealth !== "HEALTHY" || input.freshness !== "FRESH" ||
      input.stockState === "STOCK_UNKNOWN" ||
      !input.canonicalProjectionAvailable) {
    return "STOCKGUARD_BLOCKED_STOCK_EVIDENCE"
  }
  return "STOCKGUARD_READY"
}

export type SellerOsPublishStockguardComponentV1 = Readonly<{
  productId: string
  variantId: string
  supplierSku: string
  canonicalLunaUrl: string
  quantityRequiredPerBundle: number
  identityCertified: boolean
  stockIdentityResolved: boolean
  stockState: "CERTIFIED_OOS" | "IN_STOCK" | "STOCK_UNKNOWN"
  sourceHealth: "HEALTHY" | "UNAVAILABLE" | "UNPROVEN"
  freshness: "FRESH" | "STALE" | "UNPROVEN"
  safeCapacity: number | null
}>

export function evaluatePublishWithStockguardContractV1(input: {
  sellerSku: string
  components: readonly SellerOsPublishStockguardComponentV1[]
  expectedComponentCount: number
  economicsReady: boolean
  monitorEnrollmentIntentPrepared: boolean
}) {
  const components = Array.isArray(input?.components) ? input.components : []
  const sellerSku = typeof input?.sellerSku === "string" ? input.sellerSku : ""
  const expectedComponentCount = Number(input?.expectedComponentCount)
  const exact = Boolean(sellerSku && SKU.test(sellerSku)) &&
    components.length > 0 && components.every((component) =>
      LUNA_ID.test(component.productId) && LUNA_ID.test(component.variantId) &&
      SKU.test(component.supplierSku) && component.identityCertified === true &&
      /^https:\/\/(?:www\.)?lunaportex\.com\/products\/[A-Za-z0-9%._~-]+$/.test(
        component.canonicalLunaUrl) &&
      Number.isSafeInteger(component.quantityRequiredPerBundle) &&
      component.quantityRequiredPerBundle > 0)
  const composition = Number.isSafeInteger(expectedComponentCount) &&
    expectedComponentCount > 0 &&
    components.length === expectedComponentCount &&
    new Set(components.map((component) =>
      `${component.productId}:${component.variantId}`)).size ===
        components.length
  const stockIdentity = exact && components.every((component) =>
    component.stockIdentityResolved === true)
  const stockguard = exact && stockIdentity && composition &&
    components.every((component) =>
    component.sourceHealth === "HEALTHY" && component.freshness === "FRESH" &&
    component.stockState !== "STOCK_UNKNOWN" &&
    (component.stockState === "CERTIFIED_OOS" ? component.safeCapacity === 0 :
      component.safeCapacity === null ||
        (Number.isSafeInteger(component.safeCapacity) &&
          Number(component.safeCapacity) >= 0)))
  const monitorEnrollment = input?.monitorEnrollmentIntentPrepared === true
  const publishAllowed = exact && composition && stockguard && monitorEnrollment &&
    input?.economicsReady === true && !components.some((component) =>
      component.stockState === "CERTIFIED_OOS" || component.safeCapacity === 0)
  return Object.freeze({
    contractVersion: SELLER_OS_PUBLISH_WITH_STOCKGUARD_CONTRACT_VERSION,
    exactLunaLinkageReady: exact, compositionReady: composition,
    stockguardReady: stockguard, economicsReady: input?.economicsReady === true,
    monitorEnrollmentIntentPrepared: monitorEnrollment,
    stockIdentityResolved: stockIdentity,
    publishAllowed, noExactLunaLinkageNoPublish: true as const,
    noStockIdentityResolutionNoPublish: true as const,
    noStockguardReadyNoPublish: true as const,
    noMonitorEnrollmentNoPublish: true as const,
    attachmentIntent: Object.freeze({
      sellerSku,
      expectedComponentCount,
      components: Object.freeze(components.map((component) => Object.freeze({
        productId: component.productId,
        variantId: component.variantId,
        supplierSku: component.supplierSku,
        canonicalLunaUrl: component.canonicalLunaUrl,
        quantityRequiredPerBundle: component.quantityRequiredPerBundle,
        stockIdentityResolved: component.stockIdentityResolved,
        stockState: component.stockState,
        sourceHealth: component.sourceHealth,
        freshness: component.freshness,
        safeCapacity: component.safeCapacity,
      }))),
      stockguardEnrollmentIntentPrepared: stockguard,
      monitorEnrollmentIntentPrepared: monitorEnrollment,
    }),
    blockers: Object.freeze([
      ...(!exact ? ["EXACT_LUNA_LINKAGE_REQUIRED"] : []),
      ...(components.some((component) =>
        component.stockIdentityResolved !== true)
        ? ["STOCK_IDENTITY_RESOLUTION_REQUIRED"] : []),
      ...(!composition ? ["COMPOSITION_REQUIRED"] : []),
      ...(!stockguard ? ["STOCKGUARD_READY_REQUIRED"] : []),
      ...(!monitorEnrollment ? ["MONITOR_ENROLLMENT_INTENT_REQUIRED"] : []),
      ...(input?.economicsReady !== true ? ["ECONOMICS_READY_REQUIRED"] : []),
      ...(components.some((component) => component.stockState ===
        "CERTIFIED_OOS" || component.safeCapacity === 0)
        ? ["PRE_PUBLISH_OOS_BLOCKED"] : []),
    ]), marketplaceWrites: 0 as const })
}

export function revalidateMaterializedPublishWithStockguardContractV1(
  input: unknown,
) {
  const contract = input as ReturnType<
    typeof evaluatePublishWithStockguardContractV1
  >
  const attachment = contract?.attachmentIntent
  const components = Array.isArray(attachment?.components)
    ? attachment.components : []
  const evaluated = evaluatePublishWithStockguardContractV1({
    sellerSku: attachment?.sellerSku ?? "",
    expectedComponentCount: Number(attachment?.expectedComponentCount),
    economicsReady: contract?.economicsReady === true,
    monitorEnrollmentIntentPrepared:
      contract?.monitorEnrollmentIntentPrepared === true,
    components: components.map((component) => ({
      ...component,
      identityCertified: contract?.exactLunaLinkageReady === true,
    })),
  })
  if (!evaluated.publishAllowed || !isDeepStrictEqual(evaluated, input)) {
    throw new Error("PUBLISH_WITH_STOCKGUARD_CONTRACT_REQUIRED")
  }
  return evaluated
}

export function buildPostPublishStockguardAttachmentV1(input: {
  prePublish: ReturnType<typeof evaluatePublishWithStockguardContractV1>
  sellerSku: string
  officialItemId: string
  officialSellerSku: string
  activeObservationVerified: boolean
  stockguardEnrollmentPersisted: boolean
  monitorEnrollmentPersisted: boolean
}) {
  if (!input.prePublish.publishAllowed || !ITEM_ID.test(input.officialItemId) ||
      input.sellerSku !== input.officialSellerSku ||
      !input.activeObservationVerified || !input.stockguardEnrollmentPersisted ||
      !input.monitorEnrollmentPersisted) {
    throw new Error("SELLER_OS_POST_PUBLISH_STOCKGUARD_ATTACH_FAILED_CLOSED")
  }
  return Object.freeze({ officialItemIdAttached: true as const,
    linkageCarriedForward: true as const, stockguardEnrolled: true as const,
    monitorEnrolled: true as const, manualRediscoveryRequired: false as const,
    marketplaceWrites: 0 as const })
}
