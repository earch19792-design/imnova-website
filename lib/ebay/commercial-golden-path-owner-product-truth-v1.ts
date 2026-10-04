import { createHash } from "node:crypto"

export const GOLDEN_OWNER_PRODUCT_TRUTH_EVIDENCE_V1 =
  "SELLER_OS_OWNER_PRODUCT_TRUTH_EVIDENCE_V1" as const

export type GoldenOwnerProductTruthFactClassV1 =
  | "VISIBLE_BRAND_MARKING"
  | "OBSERVED_MARKING"
  | "SUPPLIER_BASE_INCLUDED_UNIT_COUNT"

export type GoldenOwnerProductTruthSourceV1 = Readonly<{
  canonicalUrl: string
  sourceLocator: string
  sourceDigest: string
  capturedAt: string
  sourceMediaType: "IMAGE" | "VIDEO"
}>

export type GoldenOwnerProductTruthObservationV1 = Readonly<{
  factClass: GoldenOwnerProductTruthFactClassV1
  value: string
  evidenceStatement: string
}>

export type GoldenOwnerProductTruthCandidateV1 = Readonly<{
  productId: string
  variantId: string
  supplierSku: string
  supplierQuantity: number
}>

export type GoldenOwnerProductTruthEvidenceV1 = Readonly<{
  schemaVersion: typeof GOLDEN_OWNER_PRODUCT_TRUTH_EVIDENCE_V1
  evidenceId: string
  evidenceDigest: string
  authorityClass: "OWNER_ATTESTED_SUPPLIER_VISUAL_OBSERVATION"
  candidate: GoldenOwnerProductTruthCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  sourceLocator: string
  sourceDigest: string
  sourceMediaType: "IMAGE" | "VIDEO"
  capturedAt: string
  factClass: GoldenOwnerProductTruthFactClassV1
  value: string
  normalizedValue: string
  evidenceStatement: string
  operatorAttested: true
  manufacturerBrandPromoted: false
  supplierTruthModified: false
  unknownFieldsPromoted: false
  marketplaceWrites: 0
  supplierPurchases: 0
  draftIsLive: false
}>

type JsonRecord = Record<string, unknown>

const record = (value: unknown): JsonRecord => value && typeof value === "object"
  && !Array.isArray(value) ? value as JsonRecord : {}

const text = (value: unknown, maximum = 1_000) => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  : ""

const digest = (value: unknown) => {
  const canonical = (entry: unknown): unknown => Array.isArray(entry)
    ? entry.map(canonical)
    : entry && typeof entry === "object"
      ? Object.fromEntries(Object.entries(entry as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]))
      : entry
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

export function canonicalGoldenLunaProductUrlV1(value: unknown) {
  try {
    const parsed = new URL(text(value, 2_000))
    if (
      parsed.protocol !== "https:"
      || !["lunaportex.com", "www.lunaportex.com"].includes(parsed.hostname)
      || !/^\/products\/[A-Za-z0-9][A-Za-z0-9._~%+-]*\/?$/.test(parsed.pathname)
      || parsed.username || parsed.password || parsed.hash
    ) return ""
    parsed.hostname = "lunaportex.com"
    parsed.pathname = parsed.pathname.replace(/\/$/, "")
    parsed.search = ""
    return parsed.toString()
  } catch {
    return ""
  }
}

function normalizedMarking(value: unknown) {
  const marking = text(value, 160)
  if (!marking || marking.length < 2) return ""
  return marking.toLocaleUpperCase("en-US")
}

function normalizedObservationValue(
  factClass: unknown,
  value: unknown,
) {
  if (factClass === "SUPPLIER_BASE_INCLUDED_UNIT_COUNT") {
    const normalized = text(value, 20)
    return /^(?:[1-9]|[1-9][0-9]{1,2}|1000)$/.test(normalized)
      ? normalized
      : ""
  }
  return normalizedMarking(value)
}

function evidenceCore(value: JsonRecord) {
  const { evidenceId: _id, evidenceDigest: _digest, ...core } = value
  return core
}

export function buildGoldenOwnerProductTruthEvidenceV1(input: Readonly<{
  candidate: GoldenOwnerProductTruthCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  expectedCanonicalUrl: string
  source: GoldenOwnerProductTruthSourceV1
  observations: ReadonlyArray<GoldenOwnerProductTruthObservationV1>
  operatorAttested: true
  now: Date
}>) {
  const expectedUrl = canonicalGoldenLunaProductUrlV1(input.expectedCanonicalUrl)
  const canonicalUrl = canonicalGoldenLunaProductUrlV1(input.source.canonicalUrl)
  const sourceLocator = canonicalGoldenLunaProductUrlV1(input.source.sourceLocator)
  const capturedAt = text(input.source.capturedAt, 40)
  if (
    !/^\d{1,30}$/.test(input.candidate.productId)
    || !/^\d{1,30}$/.test(input.candidate.variantId)
    || !text(input.candidate.supplierSku, 160)
    || !Number.isSafeInteger(input.candidate.supplierQuantity)
    || input.candidate.supplierQuantity < 1
    || input.candidate.supplierQuantity > 20
    || !text(input.accountKey, 240)
    || !text(input.ownerUserId, 80)
    || !/^sha256:[0-9a-f]{64}$/.test(input.sourceFingerprint)
    || !expectedUrl || canonicalUrl !== expectedUrl || sourceLocator !== expectedUrl
    || !/^sha256:[0-9a-f]{64}$/.test(input.source.sourceDigest)
    || !["IMAGE", "VIDEO"].includes(input.source.sourceMediaType)
    || !capturedAt || !Number.isFinite(Date.parse(capturedAt))
    || Date.parse(capturedAt) > input.now.getTime()
    || input.operatorAttested !== true
    || input.observations.length < 1 || input.observations.length > 20
  ) throw new Error("OWNER_PRODUCT_TRUTH_EVIDENCE_INVALID")

  return Object.freeze(input.observations.map((observation) => {
    const factClass = observation.factClass
    const value = text(observation.value, 160)
    const normalizedValue = normalizedObservationValue(factClass, value)
    const evidenceStatement = text(observation.evidenceStatement, 1_000)
    if (
      !["VISIBLE_BRAND_MARKING", "OBSERVED_MARKING",
        "SUPPLIER_BASE_INCLUDED_UNIT_COUNT"].includes(factClass)
      || factClass === "SUPPLIER_BASE_INCLUDED_UNIT_COUNT"
        && input.candidate.supplierQuantity !== 1
      || !value || !normalizedValue || evidenceStatement.length < 12
    ) throw new Error("OWNER_PRODUCT_TRUTH_OBSERVATION_INVALID")
    const core = {
      schemaVersion: GOLDEN_OWNER_PRODUCT_TRUTH_EVIDENCE_V1,
      authorityClass: "OWNER_ATTESTED_SUPPLIER_VISUAL_OBSERVATION" as const,
      candidate: { ...input.candidate },
      accountKey: input.accountKey,
      ownerUserId: input.ownerUserId,
      sourceFingerprint: input.sourceFingerprint,
      canonicalUrl,
      sourceLocator,
      sourceDigest: input.source.sourceDigest,
      sourceMediaType: input.source.sourceMediaType,
      capturedAt,
      factClass,
      value,
      normalizedValue,
      evidenceStatement,
      operatorAttested: true as const,
      manufacturerBrandPromoted: false as const,
      supplierTruthModified: false as const,
      unknownFieldsPromoted: false as const,
      marketplaceWrites: 0 as const,
      supplierPurchases: 0 as const,
      draftIsLive: false as const,
    }
    const evidenceDigest = digest(core)
    return Object.freeze({ ...core, evidenceId: evidenceDigest, evidenceDigest })
  }))
}

export function isGoldenOwnerProductTruthEvidenceV1(input: Readonly<{
  evidence: unknown
  candidate: GoldenOwnerProductTruthCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  now: Date
}>) {
  const evidence = record(input.evidence)
  const candidate = record(evidence.candidate)
  const expectedUrl = canonicalGoldenLunaProductUrlV1(input.canonicalUrl)
  return evidence.schemaVersion === GOLDEN_OWNER_PRODUCT_TRUTH_EVIDENCE_V1
    && evidence.authorityClass === "OWNER_ATTESTED_SUPPLIER_VISUAL_OBSERVATION"
    && evidence.accountKey === input.accountKey
    && evidence.ownerUserId === input.ownerUserId
    && candidate.productId === input.candidate.productId
    && candidate.variantId === input.candidate.variantId
    && candidate.supplierSku === input.candidate.supplierSku
    && candidate.supplierQuantity === input.candidate.supplierQuantity
    && evidence.sourceFingerprint === input.sourceFingerprint
    && canonicalGoldenLunaProductUrlV1(evidence.canonicalUrl) === expectedUrl
    && canonicalGoldenLunaProductUrlV1(evidence.sourceLocator) === expectedUrl
    && /^sha256:[0-9a-f]{64}$/.test(text(evidence.sourceDigest, 100))
    && ["IMAGE", "VIDEO"].includes(String(evidence.sourceMediaType))
    && Number.isFinite(Date.parse(text(evidence.capturedAt, 40)))
    && Date.parse(String(evidence.capturedAt)) <= input.now.getTime()
    && ["VISIBLE_BRAND_MARKING", "OBSERVED_MARKING",
      "SUPPLIER_BASE_INCLUDED_UNIT_COUNT"].includes(String(evidence.factClass))
    && Boolean(normalizedObservationValue(evidence.factClass, evidence.value))
    && normalizedObservationValue(evidence.factClass, evidence.value) === evidence.normalizedValue
    && text(evidence.evidenceStatement, 1_000).length >= 12
    && evidence.operatorAttested === true
    && evidence.manufacturerBrandPromoted === false
    && evidence.supplierTruthModified === false
    && evidence.unknownFieldsPromoted === false
    && evidence.marketplaceWrites === 0
    && evidence.supplierPurchases === 0
    && evidence.draftIsLive === false
    && evidence.evidenceId === evidence.evidenceDigest
    && evidence.evidenceDigest === digest(evidenceCore(evidence))
}

export function goldenOwnerObservedMarkingsV1(input: Readonly<{
  evidence: ReadonlyArray<unknown>
  candidate: GoldenOwnerProductTruthCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  now: Date
}>) {
  return Object.freeze([...new Set(input.evidence.filter((evidence) =>
    isGoldenOwnerProductTruthEvidenceV1({ ...input, evidence }))
    .filter((evidence) => record(evidence).factClass !== "SUPPLIER_BASE_INCLUDED_UNIT_COUNT")
    .map((evidence) => normalizedMarking(record(evidence).normalizedValue))
    .filter(Boolean))])
}

export function goldenOwnerBaseIncludedUnitCountV1(input: Readonly<{
  evidence: ReadonlyArray<unknown>
  candidate: GoldenOwnerProductTruthCandidateV1
  accountKey: string
  ownerUserId: string
  sourceFingerprint: string
  canonicalUrl: string
  now: Date
}>) {
  const accepted = input.evidence.filter((evidence) =>
    isGoldenOwnerProductTruthEvidenceV1({ ...input, evidence }))
    .filter((evidence) =>
      record(evidence).factClass === "SUPPLIER_BASE_INCLUDED_UNIT_COUNT")
  const values = [...new Set(accepted.map((evidence) =>
    Number(record(evidence).normalizedValue))
    .filter((value) => Number.isSafeInteger(value) && value >= 1 && value <= 1_000))]
  const evidenceIds = accepted.map((evidence) => String(record(evidence).evidenceId))
  if (values.length > 1) return Object.freeze({
    status: "CONFLICT" as const, value: null, evidenceIds: Object.freeze(evidenceIds),
  })
  if (values.length === 1) return Object.freeze({
    status: "PROVEN" as const, value: values[0], evidenceIds: Object.freeze(evidenceIds),
  })
  return Object.freeze({
    status: "UNPROVEN" as const, value: null, evidenceIds: Object.freeze([] as string[]),
  })
}
