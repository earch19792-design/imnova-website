export const SELLER_OS_LUNA_TRACE_PRODUCT_TRUTH_GATE_V1 =
  "SELLER_OS_LUNA_TRACE_PRODUCT_TRUTH_GATE_V1" as const

export const LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1 = Object.freeze([
  "LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "SUPPLIER_SKU", "TITLE", "BRAND",
  "MODEL", "MATERIAL", "COLOR", "DIMENSIONS", "SIZE_SET", "WEIGHT",
  "PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "FORM_FACTOR", "FEATURES",
  "INTENDED_USES", "GTIN", "MPN", "SUPPLIER_COST", "REGULAR_PRICE", "SALE_PRICE",
  "SUPPLIER_AVAILABILITY", "SUPPLIER_STOCK", "IMAGES", "VARIANT_OPTIONS",
] as const)

export const LUNA_TRACE_REQUIRED_PRODUCT_TRUTH_FIELDS_V1 = Object.freeze([
  "LUNA_PRODUCT_ID",
  "LUNA_VARIANT_ID",
  "SUPPLIER_SKU",
  "TITLE",
  "SUPPLIER_COST",
  "SUPPLIER_AVAILABILITY",
] as const)

type JsonRecord = Record<string, unknown>
type RequiredField = typeof LUNA_TRACE_REQUIRED_PRODUCT_TRUTH_FIELDS_V1[number]

export type LunaTraceProductTruthBindingV1 = Readonly<{
  snapshotId: string | null
  productId: string | null
  variantId: string | null
  supplierSku: string | null
  sourceFingerprint: string | null
  canonicalUrl: string | null
  exactSingleVariantBinding: boolean
  supplierCost?: number | null
  supplierAvailability?: boolean | null
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function current(name: RequiredField, field: JsonRecord, now: Date) {
  if (typeof field.FRESH_UNTIL !== "string") {
    return !["SUPPLIER_COST", "SUPPLIER_AVAILABILITY"].includes(name)
  }
  const expiry = Date.parse(field.FRESH_UNTIL)
  return Number.isFinite(expiry) && expiry > now.getTime()
}

function sameValue(field: RequiredField, value: unknown,
  binding: LunaTraceProductTruthBindingV1) {
  if (field === "LUNA_PRODUCT_ID") return value === binding.productId
  if (field === "LUNA_VARIANT_ID") return value === binding.variantId
  if (field === "SUPPLIER_SKU") return value === binding.supplierSku
  if (field === "TITLE") return typeof value === "string" && value.trim().length > 0
  if (field === "SUPPLIER_COST") {
    return typeof value === "number" && Number.isFinite(value) && value > 0 &&
      (binding.supplierCost === undefined || binding.supplierCost === null ||
        value === binding.supplierCost)
  }
  return ["AVAILABLE", "OUT_OF_STOCK"].includes(String(value)) &&
    (binding.supplierAvailability === undefined ||
      binding.supplierAvailability === null ||
      value === (binding.supplierAvailability ? "AVAILABLE" : "OUT_OF_STOCK"))
}

export function evaluateLunaTraceProductTruthGateV1(input: Readonly<{
  receipt: unknown
  binding: LunaTraceProductTruthBindingV1
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const receipt = record(input.receipt)
  const fields = Array.isArray(receipt.fields) ? receipt.fields.map(record) : []
  const fieldNames = fields.map((field) => String(field.FIELD ?? ""))
  const receiptShapeValid = fields.length === LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1.length &&
    LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1.every((name) =>
      fieldNames.filter((fieldName) => fieldName === name).length === 1)
  const bindingValid = receipt.contractVersion === "LUNA_FIELD_PRODUCT_TRUTH_V1" &&
    receipt.sourceAuthorityContract === "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1" &&
    receipt.sourceSnapshotId === input.binding.snapshotId &&
    receipt.sourceProductId === input.binding.productId &&
    receipt.sourceVariantId === input.binding.variantId &&
    receipt.sourceSupplierSku === input.binding.supplierSku &&
    receipt.sourceCatalogFingerprint === input.binding.sourceFingerprint &&
    /^sha256:[0-9a-f]{64}$/.test(String(receipt.evidenceDigest ?? "")) &&
    /^sha256:[0-9a-f]{64}$/.test(String(input.binding.sourceFingerprint ?? "")) &&
    /^https:\/\/(?:www\.)?lunaportex\.com\/products\/[^/?#]+$/.test(
      String(input.binding.canonicalUrl ?? ""))
  const fieldResults = LUNA_TRACE_REQUIRED_PRODUCT_TRUTH_FIELDS_V1.map((name) => {
    const matches = fields.filter((field) => field.FIELD === name)
    const field = matches.length === 1 ? matches[0] : {}
    const expectedProductReceipt = `luna_catalog:${input.binding.snapshotId}:${input.binding.productId}`
    const expectedVariantReceipt = `${expectedProductReceipt}:${input.binding.variantId}`
    const evidence = Array.isArray(field.SOURCE_EVIDENCE)
      ? field.SOURCE_EVIDENCE.map(record) : []
    const evidenceBound = evidence.length > 0 && evidence.every((entry) =>
      /^sha256:[0-9a-f]{64}$/.test(String(entry.EVIDENCE_ID ?? "")) &&
      [expectedProductReceipt, expectedVariantReceipt].includes(
        String(entry.SOURCE_RECEIPT_ID ?? ""))) &&
      /^sha256:[0-9a-f]{64}$/.test(String(field.EVIDENCE_ID ?? ""))
    const downstreamConsumable = matches.length === 1 &&
      field.SEMANTIC_CLASS === "FACT" &&
      field.EVIDENCE_STATUS === "PROVEN" &&
      field.CONTRADICTION !== true && field.VALUE !== null &&
      evidenceBound && current(name, field, now) &&
      sameValue(name, field.VALUE, input.binding)
    return Object.freeze({ field: name, downstreamConsumable,
      evidenceId: downstreamConsumable ? String(field.EVIDENCE_ID) : null,
      value: downstreamConsumable ? field.VALUE : null })
  })
  const rejectedFields = fieldResults.filter((field) =>
    !field.downstreamConsumable).map((field) => field.field)
  const sufficient = bindingValid && receiptShapeValid &&
    input.binding.exactSingleVariantBinding &&
    rejectedFields.length === 0
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_TRACE_PRODUCT_TRUTH_GATE_V1,
    traceProductTruthSufficient: sufficient,
    traceCompatible: sufficient,
    bindingValid,
    receiptShapeValid,
    exactSingleVariantBinding: input.binding.exactSingleVariantBinding,
    requiredFields: LUNA_TRACE_REQUIRED_PRODUCT_TRUTH_FIELDS_V1,
    rejectedFields: Object.freeze(rejectedFields),
    fields: Object.freeze(fieldResults),
    receiptEvidenceDigest: bindingValid ? String(receipt.evidenceDigest) : null,
    productTruthStatusPreserved: String(receipt.status ?? "UNPROVEN"),
    marketplaceWrites: 0 as const,
  })
}
