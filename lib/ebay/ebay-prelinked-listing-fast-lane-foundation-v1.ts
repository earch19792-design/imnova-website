import { createHash } from "node:crypto"

export const SELLER_OS_PRELINKED_LISTING_FAST_LANE_FOUNDATION_VERSION =
  "OP_LAUNCH_I01_PRELINKED_LISTING_FAST_LANE_FOUNDATION_V1" as const
export const SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_VERSION =
  "SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_V1" as const
export const SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_VERSION =
  "SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_V1" as const
export const SELLER_OS_PRELINKED_LAUNCH_LINEAGE_VERSION =
  "SELLER_OS_PRELINKED_LAUNCH_LINEAGE_V1" as const

export const SELLER_OS_PRELINKED_LAUNCH_CONFIGURATION_MODES_V1 = Object.freeze([
  "SINGLE_COMPONENT", "SIMPLE_MULTIPLIER", "MULTI_COMPONENT_BOM",
] as const)
export const SELLER_OS_LAUNCH_GATE_NAMES_V1 = Object.freeze([
  "SUPPLY", "MARKET", "ECONOMICS", "LISTING",
] as const)
export const SELLER_OS_LAUNCH_EVIDENCE_AUTHORITY_CLASSES_V1 = Object.freeze([
  "OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT",
  "DERIVED_FACT", "INFERENCE", "RECOMMENDATION", "UNPROVEN", "UNAVAILABLE",
] as const)
// The six stable adapter boundaries requested by OP-LAUNCH-I01.
export const SELLER_OS_PRELINKED_LAUNCH_ADAPTERS_V1 = Object.freeze([
  "SupplierIdentityAdapter", "MarketEvidenceAdapter",
  "EconomicsEvidenceAdapter", "ListingReadinessAdapter",
  "PortfolioPolicyAdapter", "LearningOutcomeAdapter",
] as const)
export const SELLER_OS_LAUNCH_EVIDENCE_CLASSES_V1 = Object.freeze([
  "SUPPLIER_IDENTITY", "MARKET_EVIDENCE", "ECONOMICS_EVIDENCE",
  "LISTING_READINESS", "PORTFOLIO_POLICY", "LEARNING_OUTCOME",
] as const)
export const SELLER_OS_PRELINKED_FAST_LANE_SAFETY_V1 = Object.freeze({
  authority: "SHADOW_FOUNDATION_ONLY", humanApprovalRequired: true,
  p2GateBypassAllowed: false, publishAllowed: false, ebayWrites: 0,
  marketplaceWrites: 0, inventoryWrites: 0, productCaseMutations: 0,
  lunaMutations: 0, stockJobsCreated: 0, messagesSent: 0, payments: 0,
} as const)
export const SELLER_OS_PRELINKED_LAUNCH_SHADOW_POOL_MAXIMUM = 20 as const

type ConfigurationModeV1 =
  typeof SELLER_OS_PRELINKED_LAUNCH_CONFIGURATION_MODES_V1[number]
type GateNameV1 = typeof SELLER_OS_LAUNCH_GATE_NAMES_V1[number]
type EvidenceAuthorityClassV1 =
  typeof SELLER_OS_LAUNCH_EVIDENCE_AUTHORITY_CLASSES_V1[number]
type EvidenceClassV1 = typeof SELLER_OS_LAUNCH_EVIDENCE_CLASSES_V1[number]
type AdapterNameV1 = typeof SELLER_OS_PRELINKED_LAUNCH_ADAPTERS_V1[number]
type EvidenceAvailabilityV1 = "AVAILABLE" | "UNPROVEN" | "UNKNOWN" |
  "UNAVAILABLE" | "STALE" | "CONFLICT"
type GateStatusV1 = "READY" | "NOT_READY" | "UNPROVEN"
type P2DependencyGateV1 = "PREPUBLICATION_PRELINKED_ONLY" | "PASS" |
  "BLOCKED" | "UNPROVEN"

const DIGEST = /^sha256:[0-9a-f]{64}$/
const LUNA_ID = /^\d{1,30}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,119}$/
const EBAY_ITEM_ID = /^\d{9,20}$/
const EBAY_CUSTOM_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_COMPONENTS = 20
const MAX_EVIDENCE = 100

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}
function deterministicId(prefix: string, value: unknown) {
  return `${prefix}:${sha256(value)}`
}
// Cross-language business identities use one exact UTF-8 newline framing shared
// with Postgres. None of these fields can contain a newline.
function textDigest(values: readonly string[]) {
  return `sha256:${createHash("sha256").update(values.join("\n"), "utf8")
    .digest("hex")}`
}
function deterministicTextId(prefix: string, values: readonly string[]) {
  return `${prefix}:${textDigest(values)}`
}
function fail(code: string): never { throw new Error(code) }
function safeId(value: unknown, code: string) {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!SAFE_ID.test(normalized)) fail(code)
  return normalized
}
function nullableSafeId(value: unknown, code: string) {
  return value === null || value === undefined || value === ""
    ? null : safeId(value, code)
}
function safeDigest(value: unknown, code: string) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!DIGEST.test(normalized)) fail(code)
  return normalized
}
function iso(value: unknown, code: string) {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized || !Number.isFinite(Date.parse(normalized))) fail(code)
  return new Date(normalized).toISOString()
}
function positiveInteger(value: unknown, code: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(code)
  return Number(value)
}
function score(value: unknown) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
    fail("LAUNCH_SCORE_INVALID")
  }
  return Math.round(normalized * 100) / 100
}
function reasonCodes(values: readonly string[], code: string) {
  const normalized = [...new Set(values.map((value) => String(value).trim()))]
    .sort((a, b) => a.localeCompare(b))
  if (normalized.some((value) => !SAFE_CODE.test(value))) fail(code)
  return Object.freeze(normalized)
}
function supplierSku(value: unknown) {
  const normalized = typeof value === "string" ? value.normalize("NFKC").trim() : ""
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f]/.test(normalized)) {
    fail("LUNA_SKU_INVALID")
  }
  return normalized
}
function ebaySku(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const normalized = String(value).trim()
  if (!EBAY_CUSTOM_LABEL.test(normalized)) fail("CANONICAL_EBAY_SKU_INVALID")
  return normalized
}
function normalizeListingPackageId(value: unknown, code = "LISTING_PACKAGE_ID_INVALID") {
  if (value === null || value === undefined || value === "") return null
  const normalized = String(value).trim().toLowerCase()
  if (!UUID.test(normalized)) fail(code)
  return normalized
}
function canonicalSkuForListingPackage(value: string) {
  return `IMNOVA${value.replace(/-/g, "").toUpperCase()}`
}
function deterministicListingPackageId(launchCandidateId: string, attempt: number) {
  const compact = createHash("sha256").update(
    `SELLER_OS_PRELINKED_LISTING_PACKAGE_V1\n${launchCandidateId}\n${attempt}`,
    "utf8").digest("hex").slice(0, 32)
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
}
function unique<T>(values: readonly T[]) { return [...new Set(values)] }

export type SellerOsSupplierIdentityStatusV1 = "EXACT_PRELINKED" |
  "UNPROVEN" | "UNKNOWN" | "UNAVAILABLE" | "CONFLICT"
export type SellerOsPrelinkedSupplierComponentInputV1 = Readonly<{
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  supplierQuantityRequired: number
  supplierIdentityStatus: SellerOsSupplierIdentityStatusV1
  p2LinkageId?: string | null
}>
export type SellerOsPrelinkedSupplierComponentV1 = Readonly<{
  componentIdentityId: string
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  supplierQuantityRequired: number
  supplierIdentityStatus: SellerOsSupplierIdentityStatusV1
  p2LinkageId: string | null
}>
export type SellerOsPrelinkedConfigurationV1 = Readonly<{
  accountKey: string
  marketplaceId: "EBAY_US"
  configurationMode: ConfigurationModeV1
  configurationIdentity: string
  expectedComponentCount: number
  components: readonly SellerOsPrelinkedSupplierComponentV1[]
  complete: boolean
  blockerCodes: readonly string[]
}>

export function buildSellerOsPrelinkedLaunchConfigurationV1(input: {
  accountKey: string
  marketplaceId: "EBAY_US"
  configurationMode: ConfigurationModeV1
  expectedComponentCount: number
  components: readonly SellerOsPrelinkedSupplierComponentInputV1[]
}): SellerOsPrelinkedConfigurationV1 {
  const accountKey = safeId(input.accountKey, "ACCOUNT_KEY_INVALID")
  if (input.marketplaceId !== "EBAY_US") fail("MARKETPLACE_NOT_ALLOWED")
  if (!SELLER_OS_PRELINKED_LAUNCH_CONFIGURATION_MODES_V1.includes(
    input.configurationMode)) fail("CONFIGURATION_MODE_INVALID")
  const expectedComponentCount = positiveInteger(input.expectedComponentCount,
    "EXPECTED_COMPONENT_COUNT_INVALID")
  if (expectedComponentCount > MAX_COMPONENTS || input.components.length > MAX_COMPONENTS) {
    fail("CONFIGURATION_COMPONENT_LIMIT_EXCEEDED")
  }
  if (!input.components.length) fail("PRELINKED_CONFIGURATION_COMPONENTS_REQUIRED")
  const components = input.components.map((component) => {
    const lunaProductId = String(component.lunaProductId ?? "").trim()
    const lunaVariantId = String(component.lunaVariantId ?? "").trim()
    if (!LUNA_ID.test(lunaProductId)) fail("LUNA_PRODUCT_ID_INVALID")
    if (!LUNA_ID.test(lunaVariantId)) fail("LUNA_VARIANT_ID_INVALID")
    const supplierQuantityRequired = positiveInteger(
      component.supplierQuantityRequired, "SUPPLIER_QUANTITY_REQUIRED_INVALID")
    if (!["EXACT_PRELINKED", "UNPROVEN", "UNKNOWN", "UNAVAILABLE", "CONFLICT"]
      .includes(component.supplierIdentityStatus)) fail("SUPPLIER_IDENTITY_STATUS_INVALID")
    const normalized = { lunaProductId, lunaVariantId,
      lunaSku: supplierSku(component.lunaSku), supplierQuantityRequired,
      supplierIdentityStatus: component.supplierIdentityStatus,
      p2LinkageId: nullableSafeId(component.p2LinkageId, "P2_LINKAGE_ID_INVALID") }
    return Object.freeze({ componentIdentityId: deterministicTextId(
      "launch-component-v1", ["SELLER_OS_PRELINKED_LAUNCH_COMPONENT_IDENTITY_V1",
        lunaProductId, lunaVariantId, String(supplierQuantityRequired)]), ...normalized })
  }).sort((a, b) => a.lunaProductId.localeCompare(b.lunaProductId) ||
    a.lunaVariantId.localeCompare(b.lunaVariantId) ||
    a.supplierQuantityRequired - b.supplierQuantityRequired)
  if (unique(components.map((component) =>
    `${component.lunaProductId}:${component.lunaVariantId}`)).length !== components.length) {
    fail("DUPLICATE_CONFIGURATION_COMPONENT")
  }
  if (input.configurationMode === "SINGLE_COMPONENT" &&
      (expectedComponentCount !== 1 || components.length !== 1 ||
       components[0].supplierQuantityRequired !== 1)) fail("SINGLE_COMPONENT_GRAIN_INVALID")
  if (input.configurationMode === "SIMPLE_MULTIPLIER" &&
      (expectedComponentCount !== 1 || components.length !== 1 ||
       components[0].supplierQuantityRequired <= 1)) fail("SIMPLE_MULTIPLIER_GRAIN_INVALID")
  if (input.configurationMode === "MULTI_COMPONENT_BOM" && expectedComponentCount < 2) {
    fail("MULTI_COMPONENT_BOM_GRAIN_INVALID")
  }
  const blockers: string[] = []
  if (components.length !== expectedComponentCount) blockers.push("BOM_COMPONENT_MISSING")
  for (const component of components) {
    if (component.supplierIdentityStatus !== "EXACT_PRELINKED") {
      blockers.push(`SUPPLIER_IDENTITY_${component.supplierIdentityStatus}`)
    }
  }
  // Grain: ONE_LOGICAL_PRODUCT_CONFIGURATION -> ONE_LAUNCH_CANDIDATE_ID.
  // Account, marketplace, discovery and Product Case are lineage, not identity.
  const configurationIdentity = deterministicTextId("launch-configuration-v1",
    ["SELLER_OS_PRELINKED_CONFIGURATION_V1", input.configurationMode,
      ...components.map((component) => `${component.lunaProductId}:` +
        `${component.lunaVariantId}:${component.supplierQuantityRequired}`)])
  return Object.freeze({ accountKey, marketplaceId: input.marketplaceId,
    configurationMode: input.configurationMode, configurationIdentity,
    expectedComponentCount, components: Object.freeze(components),
    complete: blockers.length === 0,
    blockerCodes: Object.freeze(unique(blockers).sort()) })
}

export function buildSellerOsPrelinkedLaunchConfigurationIdV1(
  input: Parameters<typeof buildSellerOsPrelinkedLaunchConfigurationV1>[0],
) { return buildSellerOsPrelinkedLaunchConfigurationV1(input).configurationIdentity }

export type SellerOsLaunchEvidenceSubjectV1 = Readonly<{
  accountKey: string
  marketplaceId: "EBAY_US"
  configurationIdentity: string
  componentIdentityIds: readonly string[]
}>
export type SellerOsLaunchEvidenceInputV1 = Readonly<{
  subject: SellerOsLaunchEvidenceSubjectV1
  adapterVersion: string
  reference: string
  evidenceDigest: string
  sourceContractVersion: string
  observedAt: string
  maximumAgeSeconds: number
  availability: EvidenceAvailabilityV1
  authorityClass: EvidenceAuthorityClassV1
  blockerCodes?: readonly string[]
}>
export type SellerOsLaunchEvidenceV1 = Readonly<{
  adapter: AdapterNameV1
  evidenceClass: EvidenceClassV1
  subject: SellerOsLaunchEvidenceSubjectV1
  adapterVersion: string
  reference: string
  evidenceDigest: string
  sourceContractVersion: string
  observedAt: string
  maximumAgeSeconds: number
  availability: EvidenceAvailabilityV1
  authorityClass: EvidenceAuthorityClassV1
  blockerCodes: readonly string[]
}>
const ADAPTER_EVIDENCE_CLASS = Object.freeze({
  SupplierIdentityAdapter: "SUPPLIER_IDENTITY",
  MarketEvidenceAdapter: "MARKET_EVIDENCE",
  EconomicsEvidenceAdapter: "ECONOMICS_EVIDENCE",
  ListingReadinessAdapter: "LISTING_READINESS",
  PortfolioPolicyAdapter: "PORTFOLIO_POLICY",
  LearningOutcomeAdapter: "LEARNING_OUTCOME",
} as const satisfies Record<AdapterNameV1, EvidenceClassV1>)

function normalizeSubject(input: SellerOsLaunchEvidenceSubjectV1) {
  if (input.marketplaceId !== "EBAY_US") fail("EVIDENCE_MARKETPLACE_INVALID")
  const componentIdentityIds = Object.freeze(unique(input.componentIdentityIds.map(
    (identity) => safeId(identity, "EVIDENCE_COMPONENT_ID_INVALID"))).sort())
  if (!componentIdentityIds.length || componentIdentityIds.length > MAX_COMPONENTS) {
    fail("EVIDENCE_COMPONENT_SUBJECT_INVALID")
  }
  return Object.freeze({ accountKey: safeId(input.accountKey,
    "EVIDENCE_ACCOUNT_KEY_INVALID"), marketplaceId: input.marketplaceId,
  configurationIdentity: safeId(input.configurationIdentity,
    "EVIDENCE_CONFIGURATION_IDENTITY_INVALID"), componentIdentityIds })
}
function adaptEvidence(adapter: AdapterNameV1, input: SellerOsLaunchEvidenceInputV1) {
  if (!SELLER_OS_LAUNCH_EVIDENCE_AUTHORITY_CLASSES_V1.includes(input.authorityClass)) {
    fail("EVIDENCE_AUTHORITY_CLASS_INVALID")
  }
  if (!["AVAILABLE", "UNPROVEN", "UNKNOWN", "UNAVAILABLE", "STALE", "CONFLICT"]
    .includes(input.availability)) fail("EVIDENCE_AVAILABILITY_INVALID")
  if ((input.authorityClass === "UNPROVEN" || input.authorityClass === "UNAVAILABLE") &&
      input.availability === "AVAILABLE") fail("NON_FACT_AUTHORITY_CANNOT_BE_AVAILABLE")
  return Object.freeze({ adapter, evidenceClass: ADAPTER_EVIDENCE_CLASS[adapter],
    subject: normalizeSubject(input.subject),
    adapterVersion: safeId(input.adapterVersion, "ADAPTER_VERSION_INVALID"),
    reference: safeId(input.reference, "EVIDENCE_REFERENCE_INVALID"),
    evidenceDigest: safeDigest(input.evidenceDigest, "EVIDENCE_DIGEST_INVALID"),
    sourceContractVersion: safeId(input.sourceContractVersion,
      "SOURCE_CONTRACT_VERSION_INVALID"),
    observedAt: iso(input.observedAt, "EVIDENCE_OBSERVED_AT_INVALID"),
    maximumAgeSeconds: positiveInteger(input.maximumAgeSeconds,
      "EVIDENCE_MAXIMUM_AGE_INVALID"), availability: input.availability,
    authorityClass: input.authorityClass,
    blockerCodes: reasonCodes(input.blockerCodes ?? [], "EVIDENCE_BLOCKER_CODE_INVALID") })
}
export function SupplierIdentityAdapter(input: SellerOsLaunchEvidenceInputV1) {
  return adaptEvidence("SupplierIdentityAdapter", input)
}
export function MarketEvidenceAdapter(input: SellerOsLaunchEvidenceInputV1) {
  return adaptEvidence("MarketEvidenceAdapter", input)
}
export function EconomicsEvidenceAdapter(input: SellerOsLaunchEvidenceInputV1) {
  return adaptEvidence("EconomicsEvidenceAdapter", input)
}
export function ListingReadinessAdapter(input: SellerOsLaunchEvidenceInputV1) {
  return adaptEvidence("ListingReadinessAdapter", input)
}
export function PortfolioPolicyAdapter(input: SellerOsLaunchEvidenceInputV1) {
  return adaptEvidence("PortfolioPolicyAdapter", input)
}
export function LearningOutcomeAdapter(input: SellerOsLaunchEvidenceInputV1) {
  return adaptEvidence("LearningOutcomeAdapter", input)
}
export const adaptSellerOsSupplierIdentityV1 = SupplierIdentityAdapter
export const adaptSellerOsMarketEvidenceV1 = MarketEvidenceAdapter
export const adaptSellerOsEconomicsEvidenceV1 = EconomicsEvidenceAdapter
export const adaptSellerOsListingReadinessV1 = ListingReadinessAdapter
export const adaptSellerOsPortfolioPolicyV1 = PortfolioPolicyAdapter
export const adaptSellerOsLearningOutcomeV1 = LearningOutcomeAdapter

export type SellerOsLaunchGateV1 = Readonly<{
  gate: GateNameV1
  status: GateStatusV1
  requiredEvidenceClass: EvidenceClassV1
  evidenceReference: string | null
  blockerCodes: readonly string[]
}>
export type SellerOsLaunchEvidencePackageV1 = Readonly<{
  contractVersion: typeof SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_VERSION
  evidencePackageId: string
  evidenceDigest: string
  accountKey: string
  marketplaceId: "EBAY_US"
  configurationIdentity: string
  evaluatedAt: string
  p2DependencyGate: P2DependencyGateV1
  evidence: readonly SellerOsLaunchEvidenceV1[]
  gates: Readonly<Record<GateNameV1, SellerOsLaunchGateV1>>
  supplierIdentityStatus: EvidenceAvailabilityV1
  marketEvidenceStatus: EvidenceAvailabilityV1
  economicsStatus: EvidenceAvailabilityV1
  listingReadinessStatus: EvidenceAvailabilityV1
  supplyReadinessStatus: EvidenceAvailabilityV1
  hardBlockers: readonly string[]
  readiness: "READY_TO_LIST" | "NOT_READY_TO_LIST"
  publishAllowed: false
  p2GateBypassAllowed: false
}>
const GATE_CLASS = Object.freeze({ SUPPLY: "SUPPLIER_IDENTITY",
  MARKET: "MARKET_EVIDENCE", ECONOMICS: "ECONOMICS_EVIDENCE",
  LISTING: "LISTING_READINESS" } as const satisfies Record<GateNameV1, EvidenceClassV1>)
const FACT_AUTHORITIES = new Set<EvidenceAuthorityClassV1>([
  "OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT"])
const ECONOMICS_AUTHORITIES = new Set<EvidenceAuthorityClassV1>([
  "DURABLY_PERSISTED_FACT", "DERIVED_FACT"])
const LISTING_AUTHORITIES = new Set<EvidenceAuthorityClassV1>([
  "DURABLY_PERSISTED_FACT", "DERIVED_FACT"])
function authoritySatisfies(gate: GateNameV1, authority: EvidenceAuthorityClassV1) {
  if (gate === "ECONOMICS") return ECONOMICS_AUTHORITIES.has(authority)
  if (gate === "LISTING") return LISTING_AUTHORITIES.has(authority)
  return FACT_AUTHORITIES.has(authority)
}
function statusFromGate(gate: SellerOsLaunchGateV1): EvidenceAvailabilityV1 {
  if (gate.status === "READY") return "AVAILABLE"
  if (gate.blockerCodes.some((code) => code.includes("STALE"))) return "STALE"
  if (gate.blockerCodes.some((code) => code.includes("UNAVAILABLE"))) return "UNAVAILABLE"
  if (gate.blockerCodes.some((code) => code.includes("CONFLICT"))) return "CONFLICT"
  return "UNPROVEN"
}
function evidenceIdentityLine(item: SellerOsLaunchEvidenceV1) {
  return [item.adapter, item.evidenceClass, item.adapterVersion, item.reference,
    item.evidenceDigest, item.sourceContractVersion, item.observedAt,
    String(item.maximumAgeSeconds), item.availability, item.authorityClass,
    [...item.blockerCodes].sort().join(",")].join("|")
}
function subjectMatches(item: SellerOsLaunchEvidenceV1,
  config: SellerOsPrelinkedConfigurationV1) {
  return item.subject.accountKey === config.accountKey &&
    item.subject.marketplaceId === config.marketplaceId &&
    item.subject.configurationIdentity === config.configurationIdentity &&
    canonicalJson(item.subject.componentIdentityIds) === canonicalJson(
      config.components.map((component) => component.componentIdentityId).sort())
}
function assessGate(gate: GateNameV1, evidence: readonly SellerOsLaunchEvidenceV1[],
  evaluatedAtMs: number, config: SellerOsPrelinkedConfigurationV1) {
  const requiredEvidenceClass = GATE_CLASS[gate]
  const matches = evidence.filter((item) => item.evidenceClass === requiredEvidenceClass)
  const blockers: string[] = []
  if (!matches.length) blockers.push(`MISSING_${requiredEvidenceClass}`)
  if (matches.length > 1) blockers.push(`DUPLICATE_${requiredEvidenceClass}`)
  const item = matches.length === 1 ? matches[0] : null
  if (item) {
    const observedAtMs = Date.parse(item.observedAt)
    if (evaluatedAtMs < observedAtMs - 300_000 ||
        evaluatedAtMs - observedAtMs > item.maximumAgeSeconds * 1_000 ||
        item.availability === "STALE") blockers.push(`STALE_${requiredEvidenceClass}`)
    if (item.availability !== "AVAILABLE") {
      blockers.push(`${requiredEvidenceClass}_${item.availability}`)
    }
    if (!authoritySatisfies(gate, item.authorityClass)) {
      blockers.push(`${requiredEvidenceClass}_AUTHORITY_${item.authorityClass}`)
    }
    blockers.push(...item.blockerCodes)
  }
  if (gate === "SUPPLY") blockers.push(...config.blockerCodes)
  const normalized = Object.freeze(unique(blockers).sort())
  const unproven = !item || item.availability === "UNKNOWN" ||
    item.availability === "UNPROVEN" || item.availability === "UNAVAILABLE" ||
    item.authorityClass === "UNPROVEN" || item.authorityClass === "UNAVAILABLE" ||
    normalized.some((code) => code.startsWith("MISSING_") || code.startsWith("STALE_"))
  return Object.freeze({ gate, status: normalized.length
    ? unproven ? "UNPROVEN" as const : "NOT_READY" as const : "READY" as const,
  requiredEvidenceClass, evidenceReference: item?.reference ?? null,
  blockerCodes: normalized })
}

export function buildSellerOsLaunchEvidencePackageIdV1(input: {
  accountKey: string
  marketplaceId: "EBAY_US"
  configurationIdentity: string
  p2DependencyGate: P2DependencyGateV1
  evidence: readonly SellerOsLaunchEvidenceV1[]
}) {
  const accountKey = safeId(input.accountKey, "ACCOUNT_KEY_INVALID")
  const configurationIdentity = safeId(input.configurationIdentity,
    "CONFIGURATION_IDENTITY_INVALID")
  if (input.marketplaceId !== "EBAY_US") fail("MARKETPLACE_NOT_ALLOWED")
  if (!["PREPUBLICATION_PRELINKED_ONLY", "PASS", "BLOCKED", "UNPROVEN"]
    .includes(input.p2DependencyGate)) fail("P2_DEPENDENCY_GATE_INVALID")
  return deterministicTextId("launch-evidence-v1",
    ["SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_ID_V1", accountKey,
      input.marketplaceId, configurationIdentity, input.p2DependencyGate,
      ...[...input.evidence].map(evidenceIdentityLine).sort()])
}

export function buildSellerOsLaunchEvidencePackageV1(input: {
  configuration: SellerOsPrelinkedConfigurationV1
  evidence: readonly SellerOsLaunchEvidenceV1[]
  evaluatedAt: string
  p2DependencyGate: P2DependencyGateV1
}): SellerOsLaunchEvidencePackageV1 {
  if (input.evidence.length > MAX_EVIDENCE) fail("LAUNCH_EVIDENCE_LIMIT_EXCEEDED")
  if (!["PREPUBLICATION_PRELINKED_ONLY", "PASS", "BLOCKED", "UNPROVEN"]
    .includes(input.p2DependencyGate)) fail("P2_DEPENDENCY_GATE_INVALID")
  const evidence: readonly SellerOsLaunchEvidenceV1[] = Object.freeze(
    [...input.evidence].sort((a, b) => `${a.evidenceClass}:${a.reference}`
      .localeCompare(`${b.evidenceClass}:${b.reference}`)))
  for (const item of evidence) {
    if (ADAPTER_EVIDENCE_CLASS[item.adapter] !== item.evidenceClass) {
      fail("EVIDENCE_CLASS_ADAPTER_MISMATCH")
    }
    if (!subjectMatches(item, input.configuration)) {
      fail("EVIDENCE_SUBJECT_CONFIGURATION_MISMATCH")
    }
  }
  const evaluatedAt = iso(input.evaluatedAt, "EVIDENCE_EVALUATED_AT_INVALID")
  const evaluatedAtMs = Date.parse(evaluatedAt)
  const gates = Object.fromEntries(SELLER_OS_LAUNCH_GATE_NAMES_V1.map((gate) => [
    gate, assessGate(gate, evidence, evaluatedAtMs, input.configuration),
  ])) as Record<GateNameV1, SellerOsLaunchGateV1>
  const blockers = Object.values(gates).flatMap((gate) => gate.blockerCodes)
  for (const policy of evidence.filter((item) => item.evidenceClass === "PORTFOLIO_POLICY")) {
    if (policy.availability !== "AVAILABLE" || policy.blockerCodes.length) {
      blockers.push("PORTFOLIO_POLICY_NOT_READY", ...policy.blockerCodes)
    }
  }
  if (["BLOCKED", "UNPROVEN"].includes(input.p2DependencyGate)) {
    blockers.push(`P2_DEPENDENCY_GATE_${input.p2DependencyGate}`)
  }
  const hardBlockers = Object.freeze(unique(blockers).sort())
  const evidencePackageId = buildSellerOsLaunchEvidencePackageIdV1({
    accountKey: input.configuration.accountKey,
    marketplaceId: input.configuration.marketplaceId,
    configurationIdentity: input.configuration.configurationIdentity,
    p2DependencyGate: input.p2DependencyGate, evidence })
  const evidenceDigest = textDigest(
    ["SELLER_OS_LAUNCH_EVIDENCE_DIGEST_V1", evidencePackageId, evaluatedAt,
      gates.SUPPLY.status, gates.MARKET.status, gates.ECONOMICS.status,
      gates.LISTING.status, ...hardBlockers])
  return Object.freeze({ contractVersion: SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_VERSION,
    evidencePackageId, evidenceDigest, accountKey: input.configuration.accountKey,
    marketplaceId: input.configuration.marketplaceId,
    configurationIdentity: input.configuration.configurationIdentity,
    evaluatedAt, p2DependencyGate: input.p2DependencyGate, evidence,
    gates: Object.freeze(gates), supplierIdentityStatus: statusFromGate(gates.SUPPLY),
    marketEvidenceStatus: statusFromGate(gates.MARKET),
    economicsStatus: statusFromGate(gates.ECONOMICS),
    listingReadinessStatus: statusFromGate(gates.LISTING),
    supplyReadinessStatus: statusFromGate(gates.SUPPLY), hardBlockers,
    readiness: hardBlockers.length || Object.values(gates).some((gate) =>
      gate.status !== "READY") ? "NOT_READY_TO_LIST" : "READY_TO_LIST",
    publishAllowed: false, p2GateBypassAllowed: false })
}

export type SellerOsProductCaseLineageReferenceV1 = Readonly<{
  productCaseId: string
  productCaseVersionId: string
  productCaseVersionDigest: string
  authority: "PROVISIONAL_NON_AUTHORITATIVE_LINEAGE"
}>
export type SellerOsLaunchCandidateProvenanceV1 = Readonly<{
  authorityClass: EvidenceAuthorityClassV1
  sourceContractVersion: string
  sourceReferences: readonly string[]
  observedAt: string
  limitations: readonly string[]
  productCaseLineage: SellerOsProductCaseLineageReferenceV1 | null
}>
export type SellerOsPrelinkedLaunchCandidateInputV1 = Readonly<{
  configuration: SellerOsPrelinkedConfigurationV1
  evidencePackage: SellerOsLaunchEvidencePackageV1
  opportunityCandidateKey: string
  launchScore: number
  scoreVersion: string
  provenance: SellerOsLaunchCandidateProvenanceV1
  canonicalEbaySku?: string | null
  listingPackageId?: string | null
  ebayItemId?: string | null
  p2LinkageId?: string | null
  createdAt: string
  updatedAt: string
}>
export type SellerOsPrelinkedLaunchCandidateV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_VERSION
  launchCandidateId: string
  candidateId: string
  launchId: string
  configurationIdentity: string
  configurationMode: ConfigurationModeV1
  accountKey: string
  marketplaceId: "EBAY_US"
  opportunityCandidateKey: string
  components: readonly SellerOsPrelinkedSupplierComponentV1[]
  lunaProductId: string | null
  lunaVariantId: string | null
  lunaSku: string | null
  supplierQuantityRequired: number | null
  supplierIdentityStatus: EvidenceAvailabilityV1
  marketEvidenceStatus: EvidenceAvailabilityV1
  economicsStatus: EvidenceAvailabilityV1
  listingReadinessStatus: EvidenceAvailabilityV1
  supplyReadinessStatus: EvidenceAvailabilityV1
  hardBlockers: readonly string[]
  launchClassification: "READY_TO_LIST" | "NOT_READY_TO_LIST"
  launchScore: number
  scoreVersion: string
  evidencePackageId: string
  evidenceDigest: string
  provenance: SellerOsLaunchCandidateProvenanceV1
  canonicalEbaySku: string | null
  listingPackageId: string | null
  ebayItemId: string | null
  p2LinkageId: string | null
  outcomeTrackingId: string
  createdAt: string
  updatedAt: string
  p2DependencyGate: P2DependencyGateV1
  p2GateBypassAllowed: false
  publishAllowed: false
  blockerAlwaysWinsScore: true
}>
function normalizeProvenance(input: SellerOsLaunchCandidateProvenanceV1) {
  if (!SELLER_OS_LAUNCH_EVIDENCE_AUTHORITY_CLASSES_V1.includes(input.authorityClass)) {
    fail("PROVENANCE_AUTHORITY_CLASS_INVALID")
  }
  const refs = Object.freeze(unique(input.sourceReferences.map((reference) =>
    safeId(reference, "PROVENANCE_REFERENCE_INVALID"))).sort())
  if (!refs.length) fail("PROVENANCE_REFERENCE_REQUIRED")
  const pc = input.productCaseLineage ? Object.freeze({
    productCaseId: safeId(input.productCaseLineage.productCaseId, "PRODUCT_CASE_ID_INVALID"),
    productCaseVersionId: safeId(input.productCaseLineage.productCaseVersionId,
      "PRODUCT_CASE_VERSION_ID_INVALID"),
    productCaseVersionDigest: safeDigest(input.productCaseLineage.productCaseVersionDigest,
      "PRODUCT_CASE_VERSION_DIGEST_INVALID"),
    authority: input.productCaseLineage.authority === "PROVISIONAL_NON_AUTHORITATIVE_LINEAGE"
      ? input.productCaseLineage.authority : fail("PRODUCT_CASE_LINEAGE_AUTHORITY_INVALID"),
  }) : null
  return Object.freeze({ authorityClass: input.authorityClass,
    sourceContractVersion: safeId(input.sourceContractVersion,
      "PROVENANCE_CONTRACT_VERSION_INVALID"), sourceReferences: refs,
    observedAt: iso(input.observedAt, "PROVENANCE_OBSERVED_AT_INVALID"),
    limitations: reasonCodes(input.limitations, "PROVENANCE_LIMITATION_INVALID"),
    productCaseLineage: pc })
}
export function buildSellerOsPrelinkedLaunchIdV1(input: {
  configurationIdentity: string
}) {
  return deterministicTextId("prelinked-launch-v1",
    ["SELLER_OS_PRELINKED_LAUNCH_V1", safeId(input.configurationIdentity,
      "CONFIGURATION_IDENTITY_INVALID")])
}
export function buildSellerOsPrelinkedLaunchCandidateIdV1(input: {
  configurationIdentity: string
}) {
  return deterministicTextId("prelinked-candidate-v1",
    [SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_VERSION,
      safeId(input.configurationIdentity, "CONFIGURATION_IDENTITY_INVALID")])
}
export function buildSellerOsPrelinkedLaunchCandidateV1(
  input: SellerOsPrelinkedLaunchCandidateInputV1,
): SellerOsPrelinkedLaunchCandidateV1 {
  const config = input.configuration
  const pack = input.evidencePackage
  if (pack.contractVersion !== SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_VERSION ||
      pack.accountKey !== config.accountKey || pack.marketplaceId !== config.marketplaceId ||
      pack.configurationIdentity !== config.configurationIdentity) {
    fail("CANDIDATE_EVIDENCE_PACKAGE_SUBJECT_MISMATCH")
  }
  const launchCandidateId = buildSellerOsPrelinkedLaunchCandidateIdV1({
    configurationIdentity: config.configurationIdentity })
  const launchId = buildSellerOsPrelinkedLaunchIdV1({
    configurationIdentity: config.configurationIdentity })
  const canonicalEbaySku = ebaySku(input.canonicalEbaySku)
  const listingPackageId = normalizeListingPackageId(input.listingPackageId)
  const ebayItemId = input.ebayItemId === null || input.ebayItemId === undefined ||
    input.ebayItemId === "" ? null : String(input.ebayItemId)
  if (ebayItemId && !EBAY_ITEM_ID.test(ebayItemId)) fail("EBAY_ITEM_ID_INVALID")
  const p2LinkageId = nullableSafeId(input.p2LinkageId, "P2_LINKAGE_ID_INVALID")
  const blockers = [...pack.hardBlockers]
  if ((canonicalEbaySku === null) !== (listingPackageId === null)) {
    fail("SKU_LISTING_PACKAGE_PAIR_REQUIRED")
  }
  if (canonicalEbaySku && listingPackageId &&
      canonicalEbaySku !== canonicalSkuForListingPackage(listingPackageId)) {
    fail("SKU_LISTING_PACKAGE_IDENTITY_MISMATCH")
  }
  if (ebayItemId && !p2LinkageId) blockers.push("PUBLISHED_LISTING_P2_LINKAGE_REQUIRED")
  const hardBlockers = Object.freeze(unique(blockers).sort())
  const createdAt = iso(input.createdAt, "CANDIDATE_CREATED_AT_INVALID")
  const updatedAt = iso(input.updatedAt, "CANDIDATE_UPDATED_AT_INVALID")
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail("CANDIDATE_TIME_ORDER_INVALID")
  const single = config.components.length === 1 ? config.components[0] : null
  return Object.freeze({ contractVersion: SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_VERSION,
    launchCandidateId, candidateId: launchCandidateId, launchId,
    configurationIdentity: config.configurationIdentity,
    configurationMode: config.configurationMode, accountKey: config.accountKey,
    marketplaceId: config.marketplaceId,
    opportunityCandidateKey: safeId(input.opportunityCandidateKey,
      "OPPORTUNITY_CANDIDATE_KEY_INVALID"), components: config.components,
    lunaProductId: single?.lunaProductId ?? null,
    lunaVariantId: single?.lunaVariantId ?? null, lunaSku: single?.lunaSku ?? null,
    supplierQuantityRequired: single?.supplierQuantityRequired ?? null,
    supplierIdentityStatus: pack.supplierIdentityStatus,
    marketEvidenceStatus: pack.marketEvidenceStatus,
    economicsStatus: pack.economicsStatus,
    listingReadinessStatus: pack.listingReadinessStatus,
    supplyReadinessStatus: pack.supplyReadinessStatus, hardBlockers,
    launchClassification: hardBlockers.length || pack.readiness !== "READY_TO_LIST"
      ? "NOT_READY_TO_LIST" : "READY_TO_LIST",
    launchScore: score(input.launchScore),
    scoreVersion: safeId(input.scoreVersion, "SCORE_VERSION_INVALID"),
    evidencePackageId: pack.evidencePackageId, evidenceDigest: pack.evidenceDigest,
    provenance: normalizeProvenance(input.provenance), canonicalEbaySku,
    listingPackageId, ebayItemId, p2LinkageId,
    outcomeTrackingId: deterministicId("launch-outcome-tracking-v1", { launchId,
      contractVersion: "SELLER_OS_LAUNCH_OUTCOME_TRACKING_V1" }),
    createdAt, updatedAt, p2DependencyGate: pack.p2DependencyGate,
    p2GateBypassAllowed: false, publishAllowed: false,
    blockerAlwaysWinsScore: true })
}

export function buildSellerOsPrelinkedLaunchShadowV1(input: {
  candidate: SellerOsPrelinkedLaunchCandidateV1
  publishRequested?: boolean
  p2BypassRequested?: boolean
}) {
  const reasons = [...input.candidate.hardBlockers]
  if (input.candidate.launchClassification !== "READY_TO_LIST") {
    reasons.push("MANDATORY_GATE_NOT_READY")
  }
  if (input.publishRequested) reasons.push("OP_LAUNCH_I01_PUBLISH_FORBIDDEN")
  if (input.p2BypassRequested) reasons.push("P2_GATE_BYPASS_FORBIDDEN")
  const normalized = Object.freeze(unique(reasons).sort())
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_LISTING_FAST_LANE_FOUNDATION_VERSION,
    launchCandidateId: input.candidate.launchCandidateId,
    status: normalized.length ? "BLOCKED" as const : "READY_FOR_HUMAN_REVIEW" as const,
    reasonCodes: normalized, publishAllowed: false as const,
    p2GateBypassAllowed: false as const, externalWrites: 0 as const })
}
export function buildSellerOsPrelinkedLaunchShadowPoolV1(input: {
  candidates: readonly SellerOsPrelinkedLaunchCandidateV1[]
}) {
  const byIdentity = new Map<string, SellerOsPrelinkedLaunchCandidateV1>()
  for (const candidate of input.candidates) {
    const existing = byIdentity.get(candidate.launchCandidateId)
    if (existing && (existing.configurationIdentity !== candidate.configurationIdentity ||
        existing.evidenceDigest !== candidate.evidenceDigest ||
        existing.launchScore !== candidate.launchScore)) fail("SHADOW_POOL_CANDIDATE_CONFLICT")
    if (!existing) byIdentity.set(candidate.launchCandidateId, candidate)
  }
  const all = [...byIdentity.values()].sort((a, b) =>
    b.launchScore - a.launchScore || a.launchCandidateId.localeCompare(b.launchCandidateId))
  const selected = all.slice(0, SELLER_OS_PRELINKED_LAUNCH_SHADOW_POOL_MAXIMUM)
  return Object.freeze({ contractVersion: "SELLER_OS_PRELINKED_LAUNCH_SHADOW_POOL_V1",
    maximumCandidates: SELLER_OS_PRELINKED_LAUNCH_SHADOW_POOL_MAXIMUM,
    inputCount: input.candidates.length, uniqueCount: all.length,
    selectedCount: selected.length, truncated: all.length > selected.length,
    candidates: Object.freeze(selected.map((candidate, index) => Object.freeze({
      rank: index + 1, candidate }))), publishAllowed: false as const })
}
export function requestSellerOsPrelinkedLaunchPublishV1() {
  return Object.freeze({ status: "BLOCKED" as const,
    reasonCode: "OP_LAUNCH_I01_PUBLISH_FORBIDDEN" as const,
    marketplaceWrites: 0 as const })
}

export type SellerOsExternalPublicationReceiptV1 = Readonly<{
  contractVersion: "SELLER_OS_EXTERNAL_PUBLICATION_RECEIPT_V1"
  authority: "OUTSIDE_OP_LAUNCH_I01"
  reference: string
  receiptDigest: string
  publishedAt: string
}>
export function buildSellerOsLaunchOutcomeIdV1(input: {
  launchId: string
  ebayItemId: string
  windowStart: string
  windowEnd: string
  outcomeContractVersion: string
}) {
  const windowStart = iso(input.windowStart, "OUTCOME_WINDOW_START_INVALID")
  const windowEnd = iso(input.windowEnd, "OUTCOME_WINDOW_END_INVALID")
  if (Date.parse(windowEnd) <= Date.parse(windowStart)) fail("OUTCOME_WINDOW_INVALID")
  if (!EBAY_ITEM_ID.test(input.ebayItemId)) fail("EBAY_ITEM_ID_INVALID")
  return deterministicId("launch-outcome-v1", { launchId: safeId(input.launchId,
    "LAUNCH_ID_INVALID"), ebayItemId: input.ebayItemId, windowStart, windowEnd,
  outcomeContractVersion: safeId(input.outcomeContractVersion,
    "OUTCOME_CONTRACT_VERSION_INVALID") })
}

export type SellerOsPrelinkedLaunchLineageV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRELINKED_LAUNCH_LINEAGE_VERSION
  launchCandidateId: string
  configurationIdentity: string
  launchId: string
  evidencePackageId: string
  opportunityCandidateKey: string
  productCaseLineage: SellerOsProductCaseLineageReferenceV1 | null
  reservedSku: string | null
  reservedListingPackageId: string | null
  ebayItemId: string | null
  publicationReceiptReference: string | null
}>
type LineageResultV1 = Readonly<{ outcome: "CREATED" | "IDEMPOTENT_SUCCESS" |
  "BLOCKED" | "CONFLICT"; reasonCode: string;
  lineage: SellerOsPrelinkedLaunchLineageV1 | null }>
export function createSellerOsPrelinkedLaunchLineageRegistryV1(input?: {
  historicalSkuBindings?: readonly Readonly<{ sku: string; launchId: string | null }>[]
  allocateListingPackageId?: (input: Readonly<{
    launchCandidateId: string
    configurationIdentity: string
    attempt: number
  }>) => string
}) {
  const historicalSkus = new Map<string, string | null>()
  for (const binding of input?.historicalSkuBindings ?? []) {
    const normalized = ebaySku(binding.sku)
    if (!normalized) fail("HISTORICAL_SKU_INVALID")
    historicalSkus.set(normalized.toUpperCase(), binding.launchId
      ? safeId(binding.launchId, "HISTORICAL_LAUNCH_ID_INVALID") : null)
  }
  const byLaunch = new Map<string, SellerOsPrelinkedLaunchLineageV1>()
  const skuOwners = new Map<string, string>()
  const itemOwners = new Map<string, string>()
  const result = (outcome: LineageResultV1["outcome"], reasonCode: string,
    lineage: SellerOsPrelinkedLaunchLineageV1 | null): LineageResultV1 =>
    Object.freeze({ outcome, reasonCode, lineage })
  function register(candidate: SellerOsPrelinkedLaunchCandidateV1) {
    if (candidate.launchClassification !== "READY_TO_LIST") {
      return result("BLOCKED", "LAUNCH_CANDIDATE_NOT_READY", null)
    }
    const existing = byLaunch.get(candidate.launchId)
    if (existing) return existing.launchCandidateId === candidate.launchCandidateId &&
      existing.evidencePackageId === candidate.evidencePackageId
      ? result("IDEMPOTENT_SUCCESS", "LINEAGE_ALREADY_REGISTERED", existing)
      : result("CONFLICT", "LAUNCH_LINEAGE_CONFLICT", existing)
    const lineage = Object.freeze({
      contractVersion: SELLER_OS_PRELINKED_LAUNCH_LINEAGE_VERSION,
      launchCandidateId: candidate.launchCandidateId,
      configurationIdentity: candidate.configurationIdentity,
      launchId: candidate.launchId, evidencePackageId: candidate.evidencePackageId,
      opportunityCandidateKey: candidate.opportunityCandidateKey,
      productCaseLineage: candidate.provenance.productCaseLineage,
      reservedSku: candidate.canonicalEbaySku,
      reservedListingPackageId: candidate.listingPackageId,
      ebayItemId: candidate.ebayItemId,
      publicationReceiptReference: null })
    if (candidate.canonicalEbaySku) {
      const collisionKey = candidate.canonicalEbaySku.toUpperCase()
      const existingSkuOwner = skuOwners.get(collisionKey)
      const historicalOwner = historicalSkus.get(collisionKey)
      if ((existingSkuOwner && existingSkuOwner !== candidate.launchId) ||
          (historicalSkus.has(collisionKey) && historicalOwner !== candidate.launchId)) {
        return result("CONFLICT", "HYDRATED_SKU_COLLISION", null)
      }
      skuOwners.set(collisionKey, candidate.launchId)
    }
    if (candidate.ebayItemId) itemOwners.set(candidate.ebayItemId, candidate.launchId)
    byLaunch.set(candidate.launchId, lineage)
    return result("CREATED", "LINEAGE_REGISTERED", lineage)
  }
  async function reserveSku(reservation: { launchId: string }) {
    if (!reservation || Object.keys(reservation).some((key) => key !== "launchId")) {
      return result("BLOCKED", "CALLER_SKU_INPUT_FORBIDDEN", null)
    }
    const launchId = safeId(reservation.launchId, "LAUNCH_ID_INVALID")
    const lineage = byLaunch.get(launchId)
    if (!lineage) return result("BLOCKED", "LAUNCH_LINEAGE_NOT_FOUND", null)
    if (lineage.reservedSku && lineage.reservedListingPackageId) {
      return result("IDEMPOTENT_SUCCESS", "SKU_ALREADY_RESERVED", lineage)
    }
    for (let attempt = 0; attempt <= 7; attempt += 1) {
      const allocated = input?.allocateListingPackageId?.({
        launchCandidateId: lineage.launchCandidateId,
        configurationIdentity: lineage.configurationIdentity,
        attempt,
      }) ?? deterministicListingPackageId(lineage.launchCandidateId, attempt)
      const reservedListingPackageId = normalizeListingPackageId(allocated,
        "SERVER_ALLOCATED_LISTING_PACKAGE_ID_INVALID")
      if (!reservedListingPackageId) fail("SERVER_ALLOCATED_LISTING_PACKAGE_ID_INVALID")
      const reservedSku = canonicalSkuForListingPackage(reservedListingPackageId)
      const collisionKey = reservedSku.toUpperCase()
      const historicalOwner = historicalSkus.get(collisionKey)
      const owner = skuOwners.get(collisionKey)
      if ((historicalSkus.has(collisionKey) && historicalOwner !== launchId) ||
          (owner && owner !== launchId)) continue
      skuOwners.set(collisionKey, launchId)
      const updated = Object.freeze({ ...lineage, reservedSku,
        reservedListingPackageId })
      byLaunch.set(launchId, updated)
      return result("CREATED", "SERVER_SKU_RESERVED", updated)
    }
    return result("BLOCKED", "SERVER_SKU_ALLOCATION_EXHAUSTED", lineage)
  }
  function bindPublishedListing(input: { launchId: string;
    ebayItemId: string; receipt: SellerOsExternalPublicationReceiptV1 }) {
    const launchId = safeId(input.launchId, "LAUNCH_ID_INVALID")
    if (Object.prototype.hasOwnProperty.call(input, "sku")) {
      return result("BLOCKED", "CALLER_SKU_INPUT_FORBIDDEN", null)
    }
    if (!EBAY_ITEM_ID.test(input.ebayItemId)) {
      return result("BLOCKED", "PUBLISHED_IDENTITY_INVALID", null)
    }
    const lineage = byLaunch.get(launchId)
    if (!lineage) return result("BLOCKED", "LAUNCH_LINEAGE_NOT_FOUND", null)
    if (!lineage.reservedSku || !lineage.reservedListingPackageId ||
        skuOwners.get(lineage.reservedSku.toUpperCase()) !== launchId) {
      return result("BLOCKED", "SKU_RESERVATION_REQUIRED", lineage)
    }
    if (input.receipt?.contractVersion !== "SELLER_OS_EXTERNAL_PUBLICATION_RECEIPT_V1" ||
        input.receipt?.authority !== "OUTSIDE_OP_LAUNCH_I01") {
      return result("BLOCKED", "EXTERNAL_PUBLICATION_RECEIPT_REQUIRED", lineage)
    }
    const receiptReference = safeId(input.receipt.reference,
      "PUBLICATION_RECEIPT_REFERENCE_INVALID")
    safeDigest(input.receipt.receiptDigest, "PUBLICATION_RECEIPT_DIGEST_INVALID")
    iso(input.receipt.publishedAt, "PUBLICATION_RECEIPT_TIME_INVALID")
    const itemOwner = itemOwners.get(input.ebayItemId)
    if (itemOwner && itemOwner !== launchId) {
      return result("CONFLICT", "EBAY_ITEM_ID_CONFLICT", lineage)
    }
    if (lineage.ebayItemId && lineage.ebayItemId !== input.ebayItemId) {
      return result("CONFLICT", "LAUNCH_ITEM_ID_CONFLICT", lineage)
    }
    if (lineage.ebayItemId === input.ebayItemId) {
      return lineage.publicationReceiptReference === receiptReference
        ? result("IDEMPOTENT_SUCCESS", "ITEM_ID_ALREADY_BOUND", lineage)
        : result("CONFLICT", "PUBLICATION_RECEIPT_CONFLICT", lineage)
    }
    itemOwners.set(input.ebayItemId, launchId)
    const updated = Object.freeze({ ...lineage, ebayItemId: input.ebayItemId,
      publicationReceiptReference: receiptReference })
    byLaunch.set(launchId, updated)
    return result("CREATED", "PUBLISHED_LISTING_BOUND", updated)
  }
  const reconstruct = (launchId: string) =>
    byLaunch.get(safeId(launchId, "LAUNCH_ID_INVALID")) ?? null
  return Object.freeze({ register, reserveSku, bindPublishedListing, reconstruct })
}

export function getSellerOsPrelinkedListingFastLaneFoundationV1() {
  return Object.freeze({
    contractVersion: SELLER_OS_PRELINKED_LISTING_FAST_LANE_FOUNDATION_VERSION,
    candidateContractVersion: SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_VERSION,
    evidencePackageContractVersion: SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_VERSION,
    configurationModes: SELLER_OS_PRELINKED_LAUNCH_CONFIGURATION_MODES_V1,
    authorityClasses: SELLER_OS_LAUNCH_EVIDENCE_AUTHORITY_CLASSES_V1,
    evidenceClasses: SELLER_OS_LAUNCH_EVIDENCE_CLASSES_V1,
    gates: SELLER_OS_LAUNCH_GATE_NAMES_V1,
    adapters: SELLER_OS_PRELINKED_LAUNCH_ADAPTERS_V1,
    shadowPoolMaximum: SELLER_OS_PRELINKED_LAUNCH_SHADOW_POOL_MAXIMUM,
    safety: SELLER_OS_PRELINKED_FAST_LANE_SAFETY_V1,
  })
}
