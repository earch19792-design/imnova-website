// Projection only: the existing Luna catalog -> assessment materializer owns
// truth. No queue, reference listing, package or image fallback is allowed here.
export const LUNA_FIELD_TRUTH_FIELDS_V1 = Object.freeze([
  "LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "SUPPLIER_SKU", "TITLE", "BRAND",
  "MODEL", "MATERIAL", "COLOR", "DIMENSIONS", "SIZE_SET", "WEIGHT",
  "PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "FORM_FACTOR", "FEATURES",
  "INTENDED_USES", "GTIN", "MPN", "SUPPLIER_COST", "REGULAR_PRICE", "SALE_PRICE",
  "SUPPLIER_AVAILABILITY", "SUPPLIER_STOCK", "IMAGES", "VARIANT_OPTIONS",
])
type Row = Record<string, unknown>
function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
}
export function projectLunaFieldTruthV1(value: unknown, now: Date) {
  const receipt = record(value)
  const valid = receipt.contractVersion === "LUNA_FIELD_PRODUCT_TRUTH_V1"
  const stored = valid && Array.isArray(receipt.fields) ? receipt.fields.map(record) : []
  const fields = LUNA_FIELD_TRUTH_FIELDS_V1.map((name) => {
    const matches = stored.filter((entry) => entry.FIELD === name)
    const candidate = matches.length === 1 ? matches[0] : {}
    const supported = Array.isArray(candidate.SOURCE_EVIDENCE) &&
      candidate.SOURCE_EVIDENCE.length > 0 && typeof candidate.EVIDENCE_ID === "string"
    const semantic = candidate.SEMANTIC_CLASS
    const explicitMissing = semantic === "MISSING" && candidate.VALUE === null
    const proven = semantic === "FACT" && candidate.EVIDENCE_STATUS === "PROVEN" && supported && candidate.VALUE !== null
    const claim = semantic === "SUPPLIER_CLAIM" && candidate.EVIDENCE_STATUS === "UNPROVEN" && supported
    const inferred = semantic === "INFERRED" && candidate.EVIDENCE_STATUS === "UNPROVEN" &&
      supported && typeof candidate.REASONING_BASIS === "string"
    const contradicted = semantic === "CONTRADICTED" && candidate.CONTRADICTION === true && supported
    const accepted = explicitMissing || proven || claim || inferred || contradicted
    const source = accepted ? candidate : {
      FIELD: name, VALUE: null, SEMANTIC_CLASS: "MISSING", EVIDENCE_STATUS: "MISSING",
      SOURCE: "LUNA_EXACT_VARIANT", SOURCE_AUTHORITY: "SUPPLIER",
      SOURCE_LOCATOR_OR_FIELD: null, CAPTURED_AT: null, OBSERVED_AT: null,
      FRESH_UNTIL: null, CONFIDENCE: 0, EVIDENCE_ID: null,
      REASONING_BASIS: "No valid durable field-level Luna evidence; downstream fallback prohibited",
      CONTRADICTION: false, SOURCE_EVIDENCE: [],
    }
    const expiry = typeof source.FRESH_UNTIL === "string" ? Date.parse(source.FRESH_UNTIL) : NaN
    const stale = Number.isFinite(expiry) && expiry <= now.getTime()
    // Keep durable evidence status/IDs byte-for-byte; freshness is an explicit
    // additional temporal check, not a rewrite of the historical observation.
    return Object.freeze({ ...source, FIELD: name,
      VALUE: source.VALUE ?? null, EVIDENCE_STATUS: String(source.EVIDENCE_STATUS),
      FRESHNESS: stale ? "STALE" : source.OBSERVED_AT ? "CURRENT" : "UNKNOWN",
      DOWNSTREAM_CONSUMABLE: proven && !stale,
      DOWNSTREAM_CONSUMERS: ["PRODUCT_TRUTH"] })
  })
  const status: "CONTRADICTED" | "PROVEN" | "PARTIAL" | "UNPROVEN" = fields.some((f) => f.EVIDENCE_STATUS === "CONTRADICTED") ? "CONTRADICTED"
    : fields.every((f) => f.EVIDENCE_STATUS === "PROVEN" && f.FRESHNESS !== "STALE") ? "PROVEN"
      : fields.some((f) => f.EVIDENCE_STATUS !== "MISSING") ? "PARTIAL" : "UNPROVEN"
  return { fields, status, contractVersion: valid ? receipt.contractVersion : null,
    capturedAt: valid ? receipt.capturedAt : null,
    evidenceDigest: valid ? receipt.evidenceDigest : null,
    counts: valid ? receipt.counts : null,
    unsupportedDownstreamValues: valid && Array.isArray(receipt.unsupportedDownstreamValues)
      ? receipt.unsupportedDownstreamValues : [] }
}
