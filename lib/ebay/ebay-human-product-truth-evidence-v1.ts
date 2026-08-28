import { createHash } from "node:crypto"

export const EBAY_HUMAN_PRODUCT_TRUTH_EVIDENCE_V1 =
  "SELLER_OS_HUMAN_CONFIRMED_PRODUCT_TRUTH_EVIDENCE_V1" as const
export const LUNA_OFFICIAL_PRODUCT_PAGE_EVIDENCE_V1 =
  "LUNA_OFFICIAL_PRODUCT_PAGE" as const

type JsonRecord = Record<string, unknown>

export type HumanProductTruthOfficialAspectV1 = Readonly<{
  name: string
  required: boolean
  mode: string
  valuesComplete: boolean
  values: ReadonlyArray<Readonly<{ value: string }>>
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function normalizedKey(value: unknown) {
  return text(value, 120).toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function timestamp(value: unknown) {
  const parsed = text(value, 40)
  return Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : ""
}

function digest(value: unknown) {
  const canonical = (entry: unknown): string => {
    if (entry === undefined) return "null"
    if (Array.isArray(entry)) return `[${entry.map(canonical).join(",")}]`
    if (entry && typeof entry === "object") {
      return `{${Object.entries(entry as JsonRecord)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
        .join(",")}}`
    }
    return JSON.stringify(entry)
  }
  return `sha256:${createHash("sha256")
    .update(canonical(value)).digest("hex")}`
}

function exactLunaProductUrl(value: unknown) {
  try {
    const parsed = new URL(text(value, 2_000))
    if (
      parsed.protocol !== "https:"
      || !["lunaportex.com", "www.lunaportex.com"].includes(parsed.hostname)
      || !/^\/products\/[A-Za-z0-9][A-Za-z0-9._~%+-]*\/?$/.test(parsed.pathname)
      || parsed.username || parsed.password || parsed.hash
    ) return ""
    parsed.search = ""
    parsed.hostname = "www.lunaportex.com"
    parsed.pathname = parsed.pathname.replace(/\/$/, "")
    return parsed.toString()
  } catch {
    return ""
  }
}

function opportunityIdentity(opportunity: JsonRecord) {
  const assessment = record(opportunity.assessment)
  const productTruth = record(assessment.productTruth)
  return {
    opportunityId: text(opportunity.id, 64),
    candidateKey: text(opportunity.candidate_key, 300),
    lunaProductId: text(
      productTruth.lunaProductId ?? opportunity.supplier_product_id, 80,
    ),
    lunaVariantId: text(
      productTruth.lunaVariantId ?? opportunity.supplier_variant_id, 80,
    ),
    supplierSku: text(productTruth.supplierSku ?? opportunity.supplier_sku, 120),
    gtin: text(productTruth.gtin ?? opportunity.gtin, 20),
    sourceReference: exactLunaProductUrl(productTruth.sourceUrl),
  }
}

function canonicalOfficialValue(
  aspect: HumanProductTruthOfficialAspectV1,
  proposed: unknown,
) {
  const value = text(proposed, 500)
  if (!value) return ""
  if (aspect.mode !== "SELECTION_ONLY" || !aspect.valuesComplete) return value
  return aspect.values.find((entry) =>
    normalizedKey(entry.value) === normalizedKey(value))?.value ?? ""
}

export function buildHumanConfirmedProductTruthEvidenceV1(input: Readonly<{
  opportunity: JsonRecord
  listingPackageId: string
  marketplaceId: "EBAY_US"
  actorId: string
  aspect: HumanProductTruthOfficialAspectV1
  normalizedValue: string
  evidenceStatement: string
  confirmedAt?: string | Date
}>) {
  const identity = opportunityIdentity(input.opportunity)
  const listingPackageId = text(input.listingPackageId, 64)
  const actorId = text(input.actorId, 64)
  const evidenceStatement = text(input.evidenceStatement, 500)
  const aspectName = text(input.aspect.name, 120)
  const normalizedValue = canonicalOfficialValue(
    input.aspect, input.normalizedValue,
  )
  const confirmedAt = input.confirmedAt instanceof Date
    ? input.confirmedAt.toISOString() : timestamp(input.confirmedAt ?? new Date())
  if (
    !/^[0-9a-f-]{36}$/i.test(identity.opportunityId)
    || !identity.candidateKey
    || !identity.lunaProductId || !identity.lunaVariantId
    || !identity.supplierSku
    || !/^\d{8,14}$/.test(identity.gtin)
    || !identity.sourceReference
    || !/^[0-9a-f-]{36}$/i.test(listingPackageId)
    || !/^[0-9a-f-]{36}$/i.test(actorId)
    || input.marketplaceId !== "EBAY_US"
    || !input.aspect.required
    || !aspectName || !normalizedValue
    || evidenceStatement.length < 12
    || !confirmedAt
  ) throw new Error("HUMAN_PRODUCT_TRUTH_EVIDENCE_INVALID")

  const payload = {
    schemaVersion: EBAY_HUMAN_PRODUCT_TRUTH_EVIDENCE_V1,
    authorityClass: EBAY_HUMAN_PRODUCT_TRUTH_EVIDENCE_V1,
    provenance: "OPERATOR_CONFIRMED_EXACT_SUPPLIER_EVIDENCE",
    sourceClass: LUNA_OFFICIAL_PRODUCT_PAGE_EVIDENCE_V1,
    sourceReference: identity.sourceReference,
    marketplaceId: input.marketplaceId,
    opportunityId: identity.opportunityId,
    listingPackageId,
    candidateKey: identity.candidateKey,
    lunaProductId: identity.lunaProductId,
    lunaVariantId: identity.lunaVariantId,
    supplierSku: identity.supplierSku,
    gtin: identity.gtin,
    aspectName,
    normalizedValue,
    evidenceStatement,
    confirmedBy: actorId,
    confirmedAt,
    marketplaceWrites: 0,
  }
  return Object.freeze({ ...payload, evidenceDigest: digest(payload) })
}

function evidencePayload(value: JsonRecord) {
  const { evidenceDigest: _digest, ...payload } = value
  return payload
}

function assertEvidenceMatchesOpportunity(
  opportunity: JsonRecord,
  value: unknown,
) {
  const evidence = record(value)
  const identity = opportunityIdentity(opportunity)
  if (
    evidence.schemaVersion !== EBAY_HUMAN_PRODUCT_TRUTH_EVIDENCE_V1
    || evidence.authorityClass !== EBAY_HUMAN_PRODUCT_TRUTH_EVIDENCE_V1
    || evidence.provenance !== "OPERATOR_CONFIRMED_EXACT_SUPPLIER_EVIDENCE"
    || evidence.sourceClass !== LUNA_OFFICIAL_PRODUCT_PAGE_EVIDENCE_V1
    || evidence.marketplaceId !== "EBAY_US"
    || evidence.opportunityId !== identity.opportunityId
    || evidence.candidateKey !== identity.candidateKey
    || evidence.lunaProductId !== identity.lunaProductId
    || evidence.lunaVariantId !== identity.lunaVariantId
    || evidence.supplierSku !== identity.supplierSku
    || evidence.gtin !== identity.gtin
    || exactLunaProductUrl(evidence.sourceReference) !== identity.sourceReference
    || !text(evidence.aspectName, 120)
    || !text(evidence.normalizedValue, 500)
    || text(evidence.evidenceStatement, 500).length < 12
    || !/^[0-9a-f-]{36}$/i.test(text(evidence.confirmedBy, 64))
    || !timestamp(evidence.confirmedAt)
    || evidence.marketplaceWrites !== 0
    || evidence.evidenceDigest !== digest(evidencePayload(evidence))
  ) throw new Error("HUMAN_PRODUCT_TRUTH_EVIDENCE_IDENTITY_MISMATCH")
  return evidence
}

export function applyHumanConfirmedProductTruthEvidenceV1(input: Readonly<{
  opportunity: JsonRecord
  evidence: JsonRecord
}>) {
  const evidence = assertEvidenceMatchesOpportunity(
    input.opportunity, input.evidence,
  )
  const assessment = record(input.opportunity.assessment)
  const productTruth = record(assessment.productTruth)
  if (!text(productTruth.evidenceDigest, 100)) {
    throw new Error("HUMAN_PRODUCT_TRUTH_BASE_AUTHORITY_REQUIRED")
  }
  const history = Array.isArray(productTruth.humanConfirmedAspectEvidenceV1)
    ? productTruth.humanConfirmedAspectEvidenceV1.map(record) : []
  const evidenceDigest = text(evidence.evidenceDigest, 100)
  const nextHistory = history.some((entry) =>
    text(entry.evidenceDigest, 100) === evidenceDigest)
    ? history : [...history, evidence]
  const current = record(productTruth.humanConfirmedRequiredAspectsV1)
  const currentAspectEvidence = Object.values(current).map(record).find((entry) =>
    normalizedKey(entry.aspectName) === normalizedKey(evidence.aspectName))
  if (
    currentAspectEvidence
    && normalizedKey(currentAspectEvidence.normalizedValue) !==
      normalizedKey(evidence.normalizedValue)
  ) throw new Error("HUMAN_PRODUCT_TRUTH_EVIDENCE_CONFLICT")
  const nextProductTruthCore = {
    ...productTruth,
    evidenceDigest: undefined,
    humanConfirmedAspectEvidenceV1: nextHistory,
    humanConfirmedRequiredAspectsV1: {
      ...current,
      [text(evidence.aspectName, 120)]: evidence,
    },
  }
  const nextProductTruth = {
    ...nextProductTruthCore,
    evidenceDigest: digest(nextProductTruthCore),
  }
  return Object.freeze({
    assessment: {
      ...assessment,
      productTruth: nextProductTruth,
    },
    productTruth: nextProductTruth,
    evidence,
  })
}

export function humanConfirmedProductTruthValuesV1(
  opportunity: JsonRecord,
) {
  const productTruth = record(record(opportunity.assessment).productTruth)
  const current = record(productTruth.humanConfirmedRequiredAspectsV1)
  const history = Array.isArray(productTruth.humanConfirmedAspectEvidenceV1)
    ? productTruth.humanConfirmedAspectEvidenceV1.map(record) : []
  const historyDigests = new Set(history.map((entry) =>
    text(entry.evidenceDigest, 100)).filter(Boolean))
  const values: Record<string, string> = {}
  for (const raw of Object.values(current)) {
    const evidence = assertEvidenceMatchesOpportunity(opportunity, raw)
    if (!historyDigests.has(text(evidence.evidenceDigest, 100))) {
      throw new Error("HUMAN_PRODUCT_TRUTH_EVIDENCE_HISTORY_REQUIRED")
    }
    const aspectName = text(evidence.aspectName, 120)
    const normalizedValue = text(evidence.normalizedValue, 500)
    const existing = values[aspectName]
    if (existing && normalizedKey(existing) !== normalizedKey(normalizedValue)) {
      throw new Error("HUMAN_PRODUCT_TRUTH_EVIDENCE_CONFLICT")
    }
    values[aspectName] = normalizedValue
  }
  return Object.freeze(values)
}
