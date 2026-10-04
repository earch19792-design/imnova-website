import { goldenArray as rows, goldenRecord as record, goldenNumber as number,
  goldenDigest as digest, classifyGoldenComparable, type GoldenMarketEvidence } from "../ebay/commercial-golden-path-domain-v1"
import { projectLunaFieldTruthV1 } from "./luna-field-truth-projection-v1"
import { listingEconomicsV1, type Economics } from "./listing-treatment-engine-v1"
import { classifyReferenceFieldsV1 } from "./sell-one-like-this-v1"

export const FAST_LISTING_V1 = "SELLER_OS_FAST_LISTING_V1"
export type FastRecord = Record<string, unknown>
export type FastState = "RESEARCH_DRAFT" | "LISTING_READY" | "PUBLISH_READY" | "HOLD"
export const FAST_FIELDS = ["SUPPLIER_SKU", "TITLE", "SOURCE_URL", "BRAND", "MODEL", "GTIN", "CONDITION",
  "SUPPLIER_COST", "SUPPLIER_AVAILABILITY", "SUPPLIER_STOCK", "QUANTITY_OR_SET_COUNT", "PACKAGE_CONTENTS",
  "VARIANT_OPTIONS", "SIZE_SET", "COLOR", "MATERIAL", "WEIGHT", "DIMENSIONS", "IMAGES"] as const
const money = (n: number) => Math.round(n * 100) / 100
const date = (v: unknown) => Date.parse(String(v ?? ""))
export type FastField = { FIELD: string; VALUE: unknown; SOURCE: string; METHOD: string; OBSERVED_AT: string | null;
  EVIDENCE_ID: string | null; FRESH_UNTIL: string | null; STATUS: string; supersedes?: string | null }
export type FastOfferInput = { quantity: number; price: number | null; priceReference: string | null;
  shipping: FastRecord; fee: FastRecord; advertising: number | null; otherCosts: number | null; costReference: string | null }
export type FastInput = { source: FastRecord; opportunityId: string; candidateKey: string; accountKey: string;
  corrections: FastField[]; confirmation: FastRecord; market: GoldenMarketEvidence[]; selectedEvidenceIds: string[];
  packReasons: FastRecord[]; offers: FastOfferInput[]; selectedQuantity: number; controlledTest: FastRecord;
  compliance: FastRecord; duplicate: FastRecord; imageRights: FastRecord; finalReview: FastRecord; now: Date }

/** Read the existing field receipt first. Snapshot columns are direct Luna
 * observations; they cannot supply brand, condition, presentation or claims. */
export function fastProductTruthV1(source: FastRecord, corrections: FastField[], now: Date) {
  const projected = projectLunaFieldTruthV1(source.field_truth_v1, now)
  const raw: FastRecord = { LUNA_PRODUCT_ID: source.product_id, LUNA_VARIANT_ID: source.variant_id,
    SUPPLIER_SKU: source.sku, TITLE: source.title, SOURCE_URL: source.canonical_url,
    SUPPLIER_COST: number(source.price), SUPPLIER_AVAILABILITY: typeof source.availability === "boolean"
      ? source.availability ? "AVAILABLE" : "OUT_OF_STOCK" : null }
  const observed = typeof source.observed_at === "string" ? source.observed_at : null
  const fields = [...FAST_FIELDS, "LUNA_PRODUCT_ID", "LUNA_VARIANT_ID"].map((name): FastField => {
    const f = record(projected.fields.find(x => x.FIELD === name))
    const fact = f.DOWNSTREAM_CONSUMABLE === true && f.CONTRADICTION !== true
    const contradicted = f.CONTRADICTION === true
    const value = contradicted ? null : fact ? f.VALUE : raw[name] ?? null
    const dynamic = ["SUPPLIER_COST", "SUPPLIER_AVAILABILITY", "SUPPLIER_STOCK"].includes(name)
    const freshness = dynamic && observed ? new Date(date(observed) + 6 * 3600000).toISOString() : null
    const stale = dynamic && (!observed || date(observed) > +now || date(freshness) <= +now)
    return { FIELD: name, VALUE: value, SOURCE: "LUNA", METHOD: fact ? "LUNA_FIELD_PRODUCT_TRUTH_V1" : "LUNA_SNAPSHOT_STRUCTURED_FIELD",
      OBSERVED_AT: fact ? String(f.OBSERVED_AT ?? observed) : observed,
      EVIDENCE_ID: value === null ? null : fact ? String(f.EVIDENCE_ID) : digest({ snapshot: source.snapshot_id, fingerprint: source.source_fingerprint, field: name, value }),
      FRESH_UNTIL: fact && typeof f.FRESH_UNTIL === "string" ? f.FRESH_UNTIL : freshness,
      STATUS: contradicted ? "CONTRADICTED" : value === null ? "MISSING" : stale ? "STALE" : "PROVEN" }
  })
  for (const c of corrections) {
    if (c.SOURCE !== "USER" || c.METHOD !== "OWNER_EXPLICIT_PRODUCT_FACT" || !c.EVIDENCE_ID ||
      date(c.OBSERVED_AT) > +now || !Number.isFinite(date(c.OBSERVED_AT))) continue
    const index = fields.findIndex(f => f.FIELD === c.FIELD)
    if (index < 0) continue
    // Dynamic OWNER observations also expire; old stock or cost is never live authority.
    fields[index] = { ...c, STATUS: c.VALUE === null ? "MISSING" : c.FRESH_UNTIL && date(c.FRESH_UNTIL) <= +now ? "STALE" : "PROVEN" }
  }
  const values = Object.fromEntries(fields.filter(f => f.STATUS === "PROVEN").map(f => [f.FIELD, f.VALUE]))
  return { fields, values, missing: fields.filter(f => f.STATUS !== "PROVEN").map(f => f.FIELD),
    evidenceDigest: digest(fields.map(f => ({ field: f.FIELD, value: f.VALUE, evidenceId: f.EVIDENCE_ID, status: f.STATUS }))) }
}

export function validateFastCorrectionV1(input: { field: string; value: unknown; actorId: string;
  opportunityId: string; sourceFingerprint: string; previous: string | null; now: Date }): FastField {
  if (!(FAST_FIELDS as readonly string[]).includes(input.field) || ["SUPPLIER_SKU", "SOURCE_URL", "IMAGES"].includes(input.field)) throw Error("FAST_LISTING_FIELD_NOT_EDITABLE")
  let value = input.value
  if (["SUPPLIER_COST", "SUPPLIER_STOCK", "QUANTITY_OR_SET_COUNT"].includes(input.field)) {
    value = number(value)
    if (value === null || Number(value) < 0 || input.field !== "SUPPLIER_COST" && !Number.isSafeInteger(value) ||
      ["SUPPLIER_COST", "QUANTITY_OR_SET_COUNT"].includes(input.field) && Number(value) <= 0) throw Error("FAST_LISTING_FIELD_VALUE_INVALID")
  } else {
    if (typeof value !== "string" || !value.trim() || value.length > 1500) throw Error("FAST_LISTING_FIELD_VALUE_INVALID")
    value = value.trim()
    if (input.field === "SUPPLIER_AVAILABILITY" && !["AVAILABLE", "OUT_OF_STOCK"].includes(String(value))) throw Error("FAST_LISTING_AVAILABILITY_INVALID")
    if (input.field === "GTIN" && !/^\d{8,14}$/.test(String(value))) throw Error("FAST_LISTING_GTIN_INVALID")
    if (input.field === "CONDITION" && !["NEW", "USED", "OPEN_BOX", "REFURBISHED"].includes(String(value))) throw Error("FAST_LISTING_CONDITION_INVALID")
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.actorId)) throw Error("FAST_LISTING_OWNER_REQUIRED")
  const observedAt = input.now.toISOString()
  return { FIELD: input.field, VALUE: value, SOURCE: "USER", METHOD: "OWNER_EXPLICIT_PRODUCT_FACT", OBSERVED_AT: observedAt,
    FRESH_UNTIL: ["SUPPLIER_COST", "SUPPLIER_STOCK", "SUPPLIER_AVAILABILITY"].includes(input.field) ? new Date(+input.now + 6 * 3600000).toISOString() : null,
    EVIDENCE_ID: digest({ ...input, value, now: observedAt }), STATUS: "PROVEN", supersedes: input.previous }
}

function exactCapture(input: FastInput, offer: FastOfferInput) {
  const q = offer.shipping
  return q.status === "PROVEN" && q.source === "LUNA_SHIPPING_CAPTURE" && q.productId === input.source.product_id &&
    q.variantId === input.source.variant_id && q.supplierSku === input.source.sku && q.quantity === offer.quantity &&
    q.sourceFingerprint === input.source.source_fingerprint && q.truthDigest === fastProductTruthV1(input.source, input.corrections, input.now).evidenceDigest && q.currency === "USD" && q.noPurchase === true &&
    q.noPayment === true && Boolean(q.receiptId) && date(q.observedAt) <= +input.now && date(q.freshUntil) > +input.now &&
    number(q.amountUsd) !== null && Number(q.amountUsd) >= 0
}
function exactFee(input: FastInput, offer: FastOfferInput) {
  const f = offer.fee
  return f.status === "PROVEN" && f.accountKey === input.accountKey && f.productId === input.source.product_id &&
    f.variantId === input.source.variant_id && f.supplierSku === input.source.sku && f.supplierQuantity === offer.quantity &&
    f.price === offer.price && f.currency === "USD" && f.sourceFingerprint === input.source.source_fingerprint &&
    f.truthDigest === fastProductTruthV1(input.source, input.corrections, input.now).evidenceDigest &&
    Boolean(f.receiptId) && date(f.observedAt) <= +input.now && date(f.freshUntil) > +input.now &&
    number(f.amountUsd) !== null && Number(f.amountUsd) >= 0
}

export function projectFastListingV1(input: FastInput) {
  const truth = fastProductTruthV1(input.source, input.corrections, input.now), v = truth.values
  const count = number(v.QUANTITY_OR_SET_COUNT), cost = number(v.SUPPLIER_COST)
  const presentationKnown = count !== null && Number.isSafeInteger(count) && count > 0
  const basic = Boolean(v.LUNA_PRODUCT_ID && v.LUNA_VARIANT_ID && v.SUPPLIER_SKU && v.TITLE && cost !== null && cost > 0 && presentationKnown)
  const identityConfirmed = input.confirmation.truthDigest === truth.evidenceDigest && Boolean(input.confirmation.actorId)
  const controlled = input.controlledTest.confirmed === true && Boolean(input.controlledTest.actorId) && input.controlledTest.truthDigest === truth.evidenceDigest
  const target = (q: number) => ({ productName: typeof v.TITLE === "string" ? v.TITLE : null,
    manufacturerBrand: typeof v.BRAND === "string" ? v.BRAND : null, model: typeof v.MODEL === "string" ? v.MODEL : null,
    mpn: null, gtin: q === 1 && typeof v.GTIN === "string" ? v.GTIN : null,
    color: typeof v.COLOR === "string" ? v.COLOR : null, packCount: presentationKnown ? count! * q : null })
  const classified = input.market.map(e => ({ ...e, ...classifyGoldenComparable(target(1), e),
    selected: input.selectedEvidenceIds.includes(e.evidenceId) }))
  const validSold = (e: GoldenMarketEvidence) => e.listingState === "SOLD" && e.currency === "USD" &&
    e.realizedPriceStatus === "PROVEN" && e.soldQuantity !== null && e.soldQuantity > 0 && Number.isSafeInteger(e.soldQuantity) &&
    e.realizedSoldPrice !== null && e.realizedSoldPrice > 0 && e.buyerShipping !== null && e.buyerShipping >= 0 &&
    date(e.lastSoldDate) <= date(e.capturedAt) && date(e.capturedAt) <= +input.now && +input.now - date(e.lastSoldDate) <= 90 * 86400000
  const supportedPack = (q: number) => input.packReasons.some(r => r.quantity === q && r.truthDigest === truth.evidenceDigest &&
    ((r.reason === "HUMAN_CONFIRMATION" || r.reason === "MULTIPLE_CONSUMPTION") && Boolean(r.actorId) && Boolean(r.explanation))) ||
    input.market.some(e => validSold(e) && ["EXACT", "CLOSE"].includes(classifyGoldenComparable(target(q), e).classification))
  const offers = input.offers.filter(o => o.quantity === 1 || [2, 3, 4].includes(o.quantity) && supportedPack(o.quantity))
    .sort((a, b) => a.quantity - b.quantity)
  const matrix = offers.map(o => {
    const comparable = input.market.filter(e => validSold(e) && ["EXACT", "CLOSE"].includes(classifyGoldenComparable(target(o.quantity), e).classification))
    const shipping = exactCapture(input, o) ? number(o.shipping.amountUsd) : null
    const fee = exactFee(input, o) ? number(o.fee.amountUsd) : null
    const totalCost = cost !== null ? money(cost * o.quantity) : null
    const component = (value: number | null, reference: unknown) => ({ value, reference: typeof reference === "string" ? reference : null, fresh: value !== null && Boolean(reference) })
    const extra = o.otherCosts !== null && o.advertising !== null ? money(o.otherCosts + o.advertising) : null
    const economics = listingEconomicsV1({ salePrice: component(o.price, o.priceReference), productCost: component(totalCost, truth.evidenceDigest),
      shippingCost: component(shipping, o.shipping.receiptId), ebayFees: component(fee, o.fee.receiptId),
      otherCosts: component(extra, o.costReference), adFeeBasis: component(null, null) } satisfies Economics)
    const net = economics.economicsUnproven ? null : economics.profitBeforeAds
    const margin = net !== null && o.price ? net / o.price * 100 : null
    const blockers = [shipping === null ? "EXACT_LUNA_SHIPPING_REQUIRED" : null, fee === null ? "EXACT_ACCOUNT_CATEGORY_FEE_REQUIRED" : null,
      o.price === null ? "COMPETITIVE_PRICE_REQUIRED" : null, extra === null ? "OTHER_COSTS_OR_AD_POLICY_REQUIRED" : null,
      net !== null && net < 4 ? "NET_PROFIT_BELOW_4" : null].filter((x): x is string => Boolean(x))
    return { quantity: o.quantity, includedCount: presentationKnown ? count! * o.quantity : null,
      presentation: o.quantity === 1 ? "Unidad proveedor" : `Pack de ${o.quantity} unidades proveedor`, price: o.price,
      totalLunaCost: totalCost, shipping, ebayFee: fee, advertising: o.advertising, otherCosts: o.otherCosts,
      netProfit: net, marginPercent: margin, comparableCount: comparable.length,
      confirmedComparableCount: comparable.filter(e => input.selectedEvidenceIds.includes(e.evidenceId)).length,
      evidenceClass: comparable.some(e => classifyGoldenComparable(target(o.quantity), e).classification === "EXACT") ? "EXACT_SOLD" : comparable.length ? "SIMILAR_SOLD" : controlled ? "CONTROLLED_TEST" : "UNPROVEN",
      recommended: net !== null && net >= 4 && blockers.length === 0,
      status: blockers.length ? net !== null && net < 4 ? "HOLD" : "PENDING" : "ECONOMICS_READY", blockers,
      warnings: margin !== null && margin < 15 ? ["MARGIN_BELOW_15_PERCENT"] : [],
      shippingReference: shipping !== null ? o.shipping.receiptId : null, feeReference: fee !== null ? o.fee.receiptId : null }
  })
  const selected = matrix.find(o => o.quantity === input.selectedQuantity) ?? matrix[0] ?? null
  const authorityCurrent = (a: FastRecord) => a.truthDigest === truth.evidenceDigest && a.sourceFingerprint === input.source.source_fingerprint &&
    date(a.observedAt) <= +input.now && date(a.freshUntil) > +input.now
  const duplicate = input.duplicate.status === "DUPLICATE", stock = v.SUPPLIER_AVAILABILITY === "AVAILABLE" &&
    (v.SUPPLIER_STOCK === undefined || number(v.SUPPLIER_STOCK)! > 0)
  const categoryReady = authorityCurrent(input.compliance) && input.compliance.categoryReady === true && input.compliance.specificsReady === true &&
    input.compliance.conditionReady === true && Boolean(v.CONDITION)
  const marketReady = Boolean(selected && selected.comparableCount > 0) || controlled
  const listingBlockers = [!basic ? "MINIMUM_PRODUCT_TRUTH_REQUIRED" : null, !identityConfirmed ? "CONFIRM_EXACT_PRODUCT_IDENTITY" : null,
    !stock ? "CURRENT_LUNA_STOCK_REQUIRED" : null, !marketReady ? "SOLD_EVIDENCE_OR_CONTROLLED_TEST_REQUIRED" : null,
    !categoryReady ? "CATEGORY_CONDITION_AND_SPECIFICS_REQUIRED" : null, duplicate ? "CONFIRMED_DUPLICATE" : null].filter((x): x is string => Boolean(x))
  const publishBlockers = [...listingBlockers, ...(selected?.blockers ?? ["PRESENTATION_REQUIRED"]),
    number(v.SUPPLIER_STOCK) === null || Number(v.SUPPLIER_STOCK) < (selected?.quantity ?? 1) ? "CONFIRMED_LUNA_STOCK_QUANTITY_REQUIRED" : null,
    input.duplicate.status !== "PASS" || !authorityCurrent(input.duplicate) ? "DUPLICATE_CHECK_REQUIRED" : null,
    input.compliance.status !== "PROVEN" || !authorityCurrent(input.compliance) ? "COMPLIANCE_REQUIRED" : null,
    input.imageRights.status !== "AUTHORIZED" || !authorityCurrent(input.imageRights) || !rows(input.imageRights.assets).length ||
      rows(input.imageRights.assets).some(a=>a.authorized !== true || !["LUNA","OWN","AUTHORIZED","FAITHFUL_GENERATED"].includes(String(a.source))) ? "AUTHORIZED_REPRESENTATIVE_IMAGES_REQUIRED" : null,
    (selected?.quantity ?? 1)>1 && input.imageRights.representedSupplierQuantity !== selected?.quantity ? "PACK_REPRESENTATIVE_IMAGES_REQUIRED" : null,
    input.finalReview.truthDigest !== truth.evidenceDigest || input.finalReview.offerDigest !== digest(selected) || !input.finalReview.actorId ? "FINAL_HUMAN_REVIEW_REQUIRED" : null]
    .filter((x): x is string => Boolean(x))
  const state: FastState = duplicate || v.SUPPLIER_AVAILABILITY === "OUT_OF_STOCK" || !basic ? "HOLD"
    : publishBlockers.length === 0 ? "PUBLISH_READY" : listingBlockers.length === 0 ? "LISTING_READY" : "RESEARCH_DRAFT"
  const exactSold = selected?.evidenceClass === "EXACT_SOLD"
  return { contractVersion: FAST_LISTING_V1, opportunityId: input.opportunityId, candidateKey: input.candidateKey,
    sourceSnapshotId: input.source.snapshot_id, sourceFingerprint: input.source.source_fingerprint,
    truth, identityConfirmed, matrix, selectedQuantity: selected?.quantity ?? 1, selected, comparables: classified,
    state, marketClassification: exactSold ? "EXACT_SOLD_EVIDENCE" : controlled ? "CONTROLLED_TEST" : "UNPROVEN",
    productProven: exactSold === true && (selected?.comparableCount ?? 0) >= 3 && !controlled,
    canPrepareDraft: basic && !duplicate, listingBlockers, publishBlockers: [...new Set(publishBlockers)],
    nextAction: !basic ? "Completar presentación y datos mínimos" : !identityConfirmed ? "Confirmar datos del producto"
      : !marketReady ? "Buscar comparables Sold o registrar prueba controlada" : !categoryReady ? "Resolver categoría e item specifics"
        : selected?.shipping === null ? "Calcular shipping exacto" : selected?.ebayFee === null ? "Resolver tarifa de cuenta y categoría"
          : selected?.netProfit !== null && selected?.netProfit !== undefined && selected.netProfit < 4 ? "No listar: beneficio menor de $4" : "Abrir revisión final",
    explanation: duplicate ? "Ya existe un duplicado confirmado." : !selected ? "Falta una presentación conocida."
      : selected.netProfit !== null && selected.netProfit < 4 ? "El precio de mercado no alcanza $4 netos."
        : selected.quantity === 1 ? "La unidad se evalúa primero. Los packs necesitan evidencia propia."
          : "Pack respaldado por evidencia o confirmación humana registrada.",
    safety: { marketplaceWrites: 0, purchases: 0, automaticPublications: 0, internalDraftOnly: true, codexRuntimeDependency: false } }
}

export function fastReferenceDifferencesV1(reference: FastRecord, truth: ReturnType<typeof fastProductTruthV1>) {
  return classifyReferenceFieldsV1(reference).map(f => ({ ...f, ownValue: truth.values[
    ({ brand: "BRAND", model: "MODEL", upc: "GTIN", condition: "CONDITION", quantity: "QUANTITY_OR_SET_COUNT" } as Record<string, string>)[f.field.toLowerCase()]
      ?? f.field.replace(/^ASPECT_VALUE:/, "").toUpperCase()] ?? null, importedValue: null }))
}
