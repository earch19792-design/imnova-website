export const LISTING_COMMERCIAL_ENVELOPE_V1 = "SELLER_OS_LISTING_COMMERCIAL_ENVELOPE_V1"
export type CommercialEvidenceState = "PROVEN" | "PENDING" | "STALE" | "NEEDS_EVIDENCE" | "NOT_APPLICABLE"
export type CommercialComponent = { status: CommercialEvidenceState; value: unknown; reference: string | null;
  source: string | null; observedAt: string | null; freshUntil: string | null }
export const COMMERCIAL_COMPONENTS = ["sku", "account", "productCost", "salePrice", "shipping", "feeAuthority",
  "inventory", "category", "itemSpecifics", "keywordV2_1", "images", "listingPackage", "liveIdentity",
  "metrics", "quality", "actualFees", "sales"] as const
export type CommercialComponentName = typeof COMMERCIAL_COMPONENTS[number]
type RecordValue = Record<string, unknown>
const record = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {}
const text = (v: unknown) => typeof v === "string" && v.length ? v : null
export function commercialComponentV1(input: Partial<CommercialComponent>, now: Date): CommercialComponent {
  const c = { status: "PENDING" as CommercialEvidenceState, value: null, reference: null, source: null, observedAt: null, freshUntil: null, ...input }
  if (c.status === "PROVEN" && (c.value === null || c.value === undefined || !c.reference || !c.source)) c.status = "NEEDS_EVIDENCE"
  if (c.status === "PROVEN" && c.freshUntil && !(Date.parse(c.freshUntil) > now.getTime())) c.status = "STALE"
  if (c.status === "PROVEN" && c.observedAt && (!Number.isFinite(Date.parse(c.observedAt)) || Date.parse(c.observedAt) > now.getTime())) c.status = "NEEDS_EVIDENCE"
  return c
}
export function buildListingCommercialEnvelopeV1(input: { accountKey: string; packageId: string | null;
  itemId: string | null; components: Partial<Record<CommercialComponentName, Partial<CommercialComponent>>>; now: Date }) {
  const components = Object.fromEntries(COMMERCIAL_COMPONENTS.map(key => [key, commercialComponentV1(input.components[key] ?? {}, input.now)])) as Record<CommercialComponentName, CommercialComponent>
  const attention = Object.values(components).some(c => c.status === "NEEDS_EVIDENCE" || c.status === "STALE")
  const complete = Object.values(components).every(c => c.status === "PROVEN" || c.status === "NOT_APPLICABLE")
  return { contractVersion: LISTING_COMMERCIAL_ENVELOPE_V1,
    envelopeKey: input.packageId ? `${input.accountKey}:package:${input.packageId}` : `${input.accountKey}:item:${input.itemId}`,
    accountKey: input.accountKey, packageId: input.packageId, itemId: input.itemId,
    phase: input.itemId ? "POST_PUBLICATION_READBACK" : "PRE_PUBLICATION", components,
    status: attention ? "REQUIERE_ATENCION" : complete ? "COMPLETO" : "ESPERANDO_DATOS",
    label: attention ? "Requiere atención" : complete ? "Completo" : "Esperando datos",
    waitingIsError: false, observedAt: input.now.toISOString(),
    authority: "EXISTING_DURABLE_PACKAGE_AND_OFFICIAL_READBACK",
    reevaluation: "ON_EXISTING_READ_PATH", codexRuntimeDependency: false,
    safety: { marketplaceWrites: 0, ebayAdsWrites: 0, newPollers: 0, newBackgroundWorkers: 0 } }
}

// The existing product-case reader resolves package/account before publication
// and official Item ID afterwards. Project that durable linkage on every read;
// no second repair ledger or manually maintained copy of the package is needed.
export function envelopeFromProductCaseV1(input: { accountKey: string; packageId: string | null;
  itemId: string | null; sku: string | null; fields: unknown[]; keyword: unknown; feeHandoff?: unknown; now: Date }) {
  const fields = input.fields.map(record)
  const mapped = { productCost: "SUPPLIER_COST", salePrice: "EBAY_LIVE_PRICE", shipping: "SUPPLIER_SHIPPING",
    inventory: "SUPPLIER_STOCK", category: "CATEGORY", itemSpecifics: "REQUIRED_ASPECTS", images: "IMAGES",
    listingPackage: "PACKAGE_STATE", liveIdentity: "EBAY_ITEM_ID" } as const
  const components: Partial<Record<CommercialComponentName, Partial<CommercialComponent>>> = {}
  for (const [key, field] of Object.entries(mapped)) {
    const f = fields.find(f => f.FIELD === field) ?? {}
    const status = f.EVIDENCE_STATUS === "PROVEN" ? "PROVEN" : f.EVIDENCE_STATUS === "STALE" ? "STALE" :
      ["CONTRADICTED", "UNAVAILABLE", "UNPROVEN"].includes(String(f.EVIDENCE_STATUS)) ? "NEEDS_EVIDENCE" : "PENDING"
    components[key as CommercialComponentName] = { status, value: f.VALUE ?? null,
      reference: text(f.EVIDENCE_ID), source: text(f.SOURCE_AUTHORITY), observedAt: text(f.OBSERVED_AT ?? f.CAPTURED_AT), freshUntil: text(f.FRESH_UNTIL) }
  }
  const fee = record(input.feeHandoff)
  if (input.feeHandoff) {
    components.feeAuthority = { status: fee.status === "PROVEN" ? "PROVEN" : fee.status === "STALE" ? "STALE" : "PENDING",
      value: fee.authority, reference: text(fee.reference), source: "SELLER_OS_EBAY_FEE_AUTHORITY_V1" }
    components.actualFees = { status: fee.actualPostSaleFee ? "PROVEN" : "PENDING", value: fee.actualPostSaleFee ?? null,
      reference: text(record(fee.actualPostSaleFee).receiptId), source: "SELLER_OS_EBAY_POST_SALE_FEE_RECONCILIATION_V1" }
  }
  const keyword = record(input.keyword)
  components.keywordV2_1 = { status: keyword.STATUS === "ACCEPTED" ? "PROVEN" : "PENDING",
    value: keyword.STATUS ?? null, reference: text(keyword.INPUT_FINGERPRINT), source: "PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1" }
  components.account = { status: "PROVEN", value: input.accountKey, reference: input.accountKey, source: "AUTHENTICATED_ACCOUNT_SCOPE" }
  components.sku = { status: input.sku ? "PROVEN" : "PENDING", value: input.sku,
    reference: input.packageId, source: "CANONICAL_PACKAGE_BINDING" }
  if (!input.itemId) for (const key of ["liveIdentity", "metrics", "quality", "actualFees", "sales"] as const) components[key] = { status: "NOT_APPLICABLE" }
  return buildListingCommercialEnvelopeV1({ ...input, components })
}
