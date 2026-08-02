"use client"

import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"
import { supabase } from "@/lib/supabase"
import {
  acceptedProductCaseEvidence,
  applyProductCaseEvidenceReview,
  buildProductCaseRunnerOutput,
  buildStrategyLabAdapterPreview,
  createProductCaseWorkspaceExport,
  createGeneralProductComparableCandidate,
  createHumanVisualReviewRecord,
  createManualAuthenticatedSupplierSourceCapture,
  deleteHumanIdentityReviewRecord,
  deleteHumanVisualReviewRecord,
  deleteSupplierCatalogLimitationRecord,
  extractProductCaseEvidence,
  importProductCaseWorkspaceExport,
  mergeProductCaseEvidenceCaptures,
  PRODUCT_CASE_CONTENT_MAX_BYTES,
  HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
  HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION,
  PRODUCT_CASE_OPERATIONAL_PHASES,
  PRODUCT_CASE_HUMAN_IDENTITY_FIELDS as HUMAN_IDENTITY_FIELDS,
  PRODUCT_CASE_RUNNER_VERSION,
  PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES,
  PRODUCT_CASE_ZERO_EFFECTS,
  refreshProductCaseLegacyImportAuditForExport,
  resolveLunaSourceContractGuard,
  reviewHumanComparableCandidate,
  saveHumanIdentityReviewRecord,
  saveSupplierCatalogLimitationRecord,
  SUPPLIER_CATALOG_LIMITATION_CONTRACT_VERSION,
  serializeProductCaseWorkspaceExport,
  transitionProductCaseSupplierCapture,
  validateProductCaseImportFileMetadata,
  validateProductCaseImportJsonCandidate,
  validateManualAuthenticatedVisibleSourceText,
  validateLunaProductUrl,
  type ProductCaseDocument,
  type ProductCaseHumanIdentityReview,
  type ProductCaseHistoricalHumanIdentityReviewAudit,
  type ProductCaseImageApproval,
  type ProductCaseImageObservation,
  type ProductCaseLegacyImportAudit,
  type ProductCaseListingOperations,
  type ProductCaseSupplierSourceCapture,
  type ProductCaseSupplierCatalogLimitation,
  type ProductCaseSupplierCatalogLimitationState,
} from "@/lib/ebay/product-case-runner"
import {
  EMPTY_PRODUCT_CASE_LISTING_OPERATIONS,
  PRODUCT_CASE_RUNNER_FIXTURES,
} from "@/lib/ebay/product-case-runner-fixtures"

type JsonRecord = Record<string, unknown>
type ReviewAction =
  | "ACCEPT"
  | "REJECT"
  | "CORRECT"
  | "NEEDS_MORE_EVIDENCE"
type VisualReviewFilter = "ALL" | "PENDING" | "CORRECTED"
type VisualReviewReturnTarget = {
  observationEvidenceId: string
  anchorId: string
}
type ExtractedEvidence = Awaited<
  ReturnType<typeof extractProductCaseEvidence>
>["evidence"][number]
type Capture = Awaited<
  ReturnType<typeof extractProductCaseEvidence>
>["capture"]

type ReviewDraft = {
  action: ReviewAction
  reason: string
  correctedValue: string
}

type ImageApprovalDraft = {
  sourceKind: ProductCaseImageApproval["sourceKind"]
  sourceUrl: string
  assetHash: string
  purpose: string
  role: ProductCaseImageApproval["role"]
  order: string
  variantId: string
  packQuantity: string
  humanNotes: string
  status: ProductCaseImageApproval["status"]
  reviewer: string
  reason: string
  productAndVariantMatch: boolean
  packQuantityMatch: boolean
  logosAndIpReviewed: boolean
  claimsReviewed: boolean
  ebayRoleCoherent: boolean
}

type VisualObservationDraft = {
  imageId: string
  sourceUrl: string
  sourceReference: string
  contradictsEvidenceIds: string[]
  reviewerType: ProductCaseDocument["imageAnalysis"]["observations"][number]["reviewerType"]
  observedProductType: string
  visibleFeatures: string
  visibleText: string
  visibleBrands: string
  visibleColors: string
  visibleQuantity: string
  observedVariant: string
  possibleConflicts: string
  confidence: ProductCaseDocument["imageAnalysis"]["observations"][number]["confidence"]
  humanDecision: ProductCaseDocument["imageAnalysis"]["observations"][number]["humanDecision"]
  humanReason: string
}

type HumanIdentityReviewDraft = {
  reviewer: string
  decision:
    | "NEEDS_MORE_EVIDENCE"
    | "CONFLICT_CONFIRMED"
    | "IDENTITY_CONFIRMED"
  confidence: "LOW" | "MEDIUM" | "HIGH"
  humanReason: string
  evidenceIds: string[]
  sameGeneralProductTypeConfirmed: boolean
  productType: string
  exactIdentityConfirmed: boolean
  brandConfirmed: boolean
  brand: string
  model: string
  mpn: string
  supplierProductId: string
  supplierSku: string
  variantId: string
  color: string
  packQuantity: string
  physicalProductVerified: boolean
  physicalVerificationEvidenceIds: string[]
}

type SupplierCatalogLimitationDraft = {
  reviewer: string
  humanReason: string
  catalogExhaustionConfirmed: boolean
}

type ComparableReviewDraft = {
  decision: "KEEP_NOT_VALIDATED" | "REJECT" | "VALIDATE_ACTIVE_EXACT"
  reason: string
  reviewer: string
  identityVisualMatch: boolean
  variantMatch: boolean
  contentsMatch: boolean
  packQuantityMatch: boolean
  validatedTitle: string
  validatedPackQuantity: string
  validatedVariantComposition: string
  buyerShipping: string
  reasonCodes: string
}

type GeneralComparableDraft = {
  sourceReference: string
  ebayUrl: string
  observedTitle: string
  observedPriceApprox: string
  observedShippingApprox: string
  currency: string
  condition: string
  listingStatus: ProductCaseDocument["marketEvidence"]["humanSuppliedComparableCandidates"][number]["listingStatus"]
}

type ProvenanceDecisionDraft = {
  field: string
  valueJson: string
  sourceReference: string
  reviewer: string
  reason: string
  variantKey: string
}

type PreflightResponse = {
  success: boolean
  accessStatus:
    | "SOURCE_AVAILABLE"
    | "AUTHENTICATED_SOURCE_REQUIRED"
    | "SOURCE_REJECTED"
  sourceUrl?: string
  capturedAt?: string
  httpStatus?: number
  contentType?: string | null
  contentHash?: string | null
  responseBytes?: number | null
  publicEvidence?: ExtractedEvidence[]
  nextAction?: string
  error?: string
  safety?: {
    readOnly?: boolean
    serverPersistence?: boolean
    supabaseWrites?: number
    ebayCalls?: number
    ebayWrites?: number
    openAiCalls?: number
    whatsappCalls?: number
    imageDownloads?: number
    credentialsForwarded?: boolean
    cookiesForwarded?: boolean
    rawBodyReturned?: boolean
  }
}

type ProductCaseImportRoundtrip = {
  source: "FILE" | "TEXTAREA"
  imported: JsonRecord
  rebuilt: JsonRecord
  historicalOutputAudit: JsonRecord | null
  canonicalJson: string
  canonicalJsonBytes: number
  canonicalJsonWithinExportLimit: boolean
  domainValidated: true
  workspaceDeepEquivalent: boolean
  outputDeepEquivalent: boolean
  importedManualHandoffTrusted: false
  legacyOutputRebuilt: boolean
  importWarnings: string[]
  outputMismatchPaths: string[]
  sourceWorkspaceExportVersion: string
  currentOutputContractVersion: string
  phaseContract: "PRODUCT_CASE_OPERATIONAL_PIPELINE_12_PHASES_5_STATUSES"
}

const pilotFixture = PRODUCT_CASE_RUNNER_FIXTURES[0] as unknown as JsonRecord
const fixtureDocument = record(
  pilotFixture.document ?? pilotFixture.input ?? pilotFixture,
)
const fixtureSupplierSourceCapture =
  (fixtureDocument.supplierSourceCapture ?? null) as
    ProductCaseSupplierSourceCapture | null

const inputClass =
  "min-h-12 w-full rounded-2xl border border-white/15 bg-black/35 px-4 text-sm text-white outline-none transition focus:border-cyan-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
const textAreaClass =
  `${inputClass} min-h-40 resize-y py-3 font-mono text-xs leading-5`
const buttonFocus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"

const PRODUCT_CASE_PHASE_NAVIGATION_TARGETS = [
  { anchorId: "source-access", focusId: "source-access-heading" },
  {
    anchorId: "phase-2-evidence-review",
    focusId: "evidence-review-heading",
  },
  {
    anchorId: "phase-3-human-visual-review",
    focusId: "human-visual-review-heading",
  },
  {
    anchorId: "phase-4-identity-and-variants",
    focusId: "identity-review-heading",
  },
  {
    anchorId: "phase-5-market-evidence",
    focusId: "phase-5-market-evidence-heading",
  },
  {
    anchorId: "strategy-input-preview",
    focusId: "strategy-preview-heading",
  },
  {
    anchorId: "strategy-input-preview",
    focusId: "strategy-preview-heading",
  },
  { anchorId: "human-shadow-review", focusId: "shadow-heading" },
  {
    anchorId: "manual-image-registry",
    focusId: "image-registry-heading",
  },
  {
    anchorId: "manual-listing-handoff",
    focusId: "manual-package-heading",
  },
  {
    anchorId: "manual-listing-handoff",
    focusId: "manual-package-heading",
  },
  {
    anchorId: "manual-listing-registration",
    focusId: "manual-registration-heading",
  },
] as const

const VISUAL_REVIEW_ISSUE_PREFIXES = [
  "HUMAN_VISUAL_REVIEW_IMAGE_ID_DUPLICATE_OR_MISSING",
  "HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED",
  "HUMAN_VISUAL_REVIEW_BRAND_PLACEHOLDER_INVALID",
  "HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE",
] as const

const emptyImageApprovalDraft: ImageApprovalDraft = {
  sourceKind: "ORIGINAL_SUPPLIER",
  sourceUrl: "",
  assetHash: "",
  purpose: "",
  role: "SECONDARY",
  order: "",
  variantId: "",
  packQuantity: "",
  humanNotes: "",
  status: "HUMAN_REVIEW",
  reviewer: "",
  reason: "",
  productAndVariantMatch: false,
  packQuantityMatch: false,
  logosAndIpReviewed: false,
  claimsReviewed: false,
  ebayRoleCoherent: false,
}

const emptyVisualObservationDraft: VisualObservationDraft = {
  imageId: "",
  sourceUrl: "",
  sourceReference: "",
  contradictsEvidenceIds: [],
  reviewerType: "HUMAN",
  observedProductType: "",
  visibleFeatures: "",
  visibleText: "",
  visibleBrands: "",
  visibleColors: "",
  visibleQuantity: "",
  observedVariant: "",
  possibleConflicts: "",
  confidence: "LOW",
  humanDecision: "NEEDS_MORE_EVIDENCE",
  humanReason: "",
}

const emptyHumanIdentityReviewDraft: HumanIdentityReviewDraft = {
  reviewer: "",
  decision: "NEEDS_MORE_EVIDENCE",
  confidence: "LOW",
  humanReason: "",
  evidenceIds: [],
  sameGeneralProductTypeConfirmed: false,
  productType: "",
  exactIdentityConfirmed: false,
  brandConfirmed: false,
  brand: "",
  model: "",
  mpn: "",
  supplierProductId: "",
  supplierSku: "",
  variantId: "",
  color: "",
  packQuantity: "",
  physicalProductVerified: false,
  physicalVerificationEvidenceIds: [],
}

const emptySupplierCatalogLimitationDraft:
  SupplierCatalogLimitationDraft = {
    reviewer: "",
    humanReason: "",
    catalogExhaustionConfirmed: false,
  }

function visualObservationDraftFrom(
  observation: ProductCaseImageObservation,
): VisualObservationDraft {
  if (observation.rawHumanInput) {
    return {
      ...observation.rawHumanInput,
      contradictsEvidenceIds: [...observation.contradictsEvidenceIds],
      reviewerType: "HUMAN",
      confidence: observation.confidence,
      humanDecision: observation.humanDecision,
    }
  }
  return {
    imageId: observation.imageId,
    sourceUrl: observation.sourceUrl ?? "",
    sourceReference: observation.sourceReference ?? "",
    contradictsEvidenceIds: [...observation.contradictsEvidenceIds],
    reviewerType: observation.reviewerType,
    observedProductType: observation.observedProductType ?? "",
    visibleFeatures: observation.visibleFeatures.join("\n"),
    visibleText: observation.visibleText.join("\n"),
    visibleBrands: observation.visibleBrands.join("\n"),
    visibleColors: observation.visibleColors.join("\n"),
    visibleQuantity: observation.visibleQuantity === null
      ? ""
      : String(observation.visibleQuantity),
    observedVariant: observation.observedVariant ?? "",
    possibleConflicts: observation.possibleConflicts.join("\n"),
    confidence: observation.confidence,
    humanDecision: observation.humanDecision,
    humanReason: observation.humanReason,
  }
}

function canonicalVisualReviewImageId(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim()
}

function stableDomIdSegment(value: string) {
  const normalized =
    canonicalVisualReviewImageId(value).toLocaleLowerCase("en-US")
  if (/^[a-z0-9_-]+$/.test(normalized)) return normalized
  let hash = 2_166_136_261
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  const readable = normalized
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item"
  return `${readable}-${(hash >>> 0).toString(36)}`
}

function visualReviewCardAnchor(
  imageId: string,
  disambiguator?: string,
) {
  const baseAnchor =
    `visual-review-card-${stableDomIdSegment(imageId)}`
  return disambiguator
    ? `${baseAnchor}--${stableDomIdSegment(disambiguator)}`
    : baseAnchor
}

function visualReviewIssueAnchor(
  imageId: string,
  disambiguator?: string,
) {
  const baseAnchor =
    `visual-review-legacy-issue-${stableDomIdSegment(imageId)}`
  return disambiguator
    ? `${baseAnchor}--${stableDomIdSegment(disambiguator)}`
    : baseAnchor
}

function visualIssueMatchesObservation(
  issue: string,
  observation: ProductCaseImageObservation,
) {
  const imageId = canonicalVisualReviewImageId(observation.imageId)
  return VISUAL_REVIEW_ISSUE_PREFIXES.some((prefix) =>
    issue === `${prefix}:${imageId}`
  ) ||
    issue.startsWith(
      `HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:${imageId}:`,
    )
}

const emptyComparableReviewDraft: ComparableReviewDraft = {
  decision: "KEEP_NOT_VALIDATED",
  reason: "",
  reviewer: "",
  identityVisualMatch: false,
  variantMatch: false,
  contentsMatch: false,
  packQuantityMatch: false,
  validatedTitle: "",
  validatedPackQuantity: "",
  validatedVariantComposition: "",
  buyerShipping: "",
  reasonCodes: "",
}

const emptyGeneralComparableDraft: GeneralComparableDraft = {
  sourceReference: "",
  ebayUrl: "",
  observedTitle: "",
  observedPriceApprox: "",
  observedShippingApprox: "",
  currency: "USD",
  condition: "New",
  listingStatus: "ACTIVE_VISIBLE",
}

const emptyPhysicalInspectionDraft: ProvenanceDecisionDraft = {
  field: "title",
  valueJson: "\"\"",
  sourceReference: "",
  reviewer: "",
  reason: "",
  variantKey: "",
}

const emptyListingDecisionDraft: ProvenanceDecisionDraft = {
  field: "ebay_category",
  valueJson: "{}",
  sourceReference: "",
  reviewer: "",
  reason: "",
  variantKey: "",
}

const physicalInspectionFields = [
  "title",
  "brand",
  "model",
  "mpn",
  "supplier_product_id",
  "supplier_sku",
  "variant_id",
  "color",
  "material",
  "capacity",
  "dimensions",
  "product_dimensions",
  "package_dimensions",
  "weight",
  "contents",
  "included_quantity",
  "pack_quantity",
] as const

const humanListingDecisionFields = [
  "ebay_optimized_title",
  "ebay_category",
  "ebay_condition",
  "ebay_item_specific",
  "listing_description",
  "listing_price",
  "listing_quantity",
  "listing_policy_bundle",
  "item_location",
] as const

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry)).filter(Boolean)
    : []
}

function text(value: unknown, fallback = "MISSING") {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return fallback
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "MISSING"
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function evidenceId(value: unknown) {
  const entry = record(value)
  return text(entry.evidenceId ?? entry.id, "EVIDENCE_ID_MISSING")
}

function humanIdentityReviewDraftFrom(
  identityReview: ProductCaseDocument["identityReview"],
): HumanIdentityReviewDraft {
  const review = record(record(identityReview).humanReview)
  if (Object.keys(review).length === 0) {
    return { ...emptyHumanIdentityReviewDraft }
  }
  const rawHumanInput = record(review.rawHumanInput)
  const decisionValue = text(review.decision, "NEEDS_MORE_EVIDENCE")
  const decision: HumanIdentityReviewDraft["decision"] = [
    "NEEDS_MORE_EVIDENCE",
    "CONFLICT_CONFIRMED",
    "IDENTITY_CONFIRMED",
  ].includes(decisionValue)
    ? decisionValue as HumanIdentityReviewDraft["decision"]
    : "NEEDS_MORE_EVIDENCE"
  const confidenceValue = text(review.confidence, "LOW")
  const confidence: HumanIdentityReviewDraft["confidence"] = [
    "LOW",
    "MEDIUM",
    "HIGH",
  ].includes(confidenceValue)
    ? confidenceValue as HumanIdentityReviewDraft["confidence"]
    : "LOW"
  const rawOrReview = (field: string) => {
    const rawValue = rawHumanInput[field]
    if (typeof rawValue === "string") return rawValue
    const reviewValue = review[field]
    if (typeof reviewValue === "string") return reviewValue
    if (typeof reviewValue === "number") return String(reviewValue)
    return ""
  }
  const booleanValue = (field: string) =>
    review[field] === true ||
    (review[field] === undefined && rawHumanInput[field] === true)
  const rawEvidenceIds = Array.isArray(rawHumanInput.evidenceIds)
    ? rawHumanInput.evidenceIds.map(String)
    : strings(review.evidenceIds)
  const rawPhysicalEvidenceIds = Array.isArray(
      rawHumanInput.physicalVerificationEvidenceIds,
    )
    ? rawHumanInput.physicalVerificationEvidenceIds.map(String)
    : strings(review.physicalVerificationEvidenceIds)
  return {
    reviewer: rawOrReview("reviewer"),
    decision,
    confidence,
    humanReason: rawOrReview("humanReason"),
    evidenceIds: rawEvidenceIds,
    sameGeneralProductTypeConfirmed: booleanValue(
      "sameGeneralProductTypeConfirmed",
    ),
    productType: rawOrReview("productType"),
    exactIdentityConfirmed: booleanValue("exactIdentityConfirmed"),
    brandConfirmed: booleanValue("brandConfirmed"),
    brand: rawOrReview("brand"),
    model: rawOrReview("model"),
    mpn: rawOrReview("mpn"),
    supplierProductId: rawOrReview("supplierProductId"),
    supplierSku: rawOrReview("supplierSku"),
    variantId: rawOrReview("variantId"),
    color: rawOrReview("color"),
    packQuantity: rawOrReview("packQuantity"),
    physicalProductVerified: booleanValue("physicalProductVerified"),
    physicalVerificationEvidenceIds: rawPhysicalEvidenceIds,
  }
}

function cloneHumanIdentityReviewDraft(
  draft: HumanIdentityReviewDraft,
): HumanIdentityReviewDraft {
  return {
    ...draft,
    evidenceIds: [...draft.evidenceIds],
    physicalVerificationEvidenceIds:
      [...draft.physicalVerificationEvidenceIds],
  }
}

function humanIdentityRawInputFrom(
  identityReview: ProductCaseDocument["identityReview"],
): ProductCaseHumanIdentityReview["rawHumanInput"] | null {
  return identityReview.humanReview?.rawHumanInput
    ? structuredClone(identityReview.humanReview.rawHumanInput)
    : null
}

function humanIdentityRawInputForSave(
  draft: HumanIdentityReviewDraft,
  baseline: HumanIdentityReviewDraft,
  original:
    ProductCaseHumanIdentityReview["rawHumanInput"] | null,
): ProductCaseHumanIdentityReview["rawHumanInput"] {
  if (
    original &&
    JSON.stringify(draft) === JSON.stringify(baseline)
  ) {
    return structuredClone(original)
  }
  return {
    reviewer: draft.reviewer,
    decision: draft.decision,
    confidence: draft.confidence,
    humanReason: draft.humanReason,
    evidenceIds: [...draft.evidenceIds],
    sameGeneralProductTypeConfirmed:
      draft.sameGeneralProductTypeConfirmed,
    productType: draft.productType,
    exactIdentityConfirmed: draft.exactIdentityConfirmed,
    brandConfirmed: draft.brandConfirmed,
    brand: draft.brand,
    model: draft.model,
    mpn: draft.mpn,
    supplierProductId: draft.supplierProductId,
    supplierSku: draft.supplierSku,
    variantId: draft.variantId,
    color: draft.color,
    packQuantity: draft.packQuantity,
    physicalProductVerified: draft.physicalProductVerified,
    physicalVerificationEvidenceIds:
      [...draft.physicalVerificationEvidenceIds],
  }
}

function mergeEvidence(
  current: ExtractedEvidence[],
  added: ExtractedEvidence[],
) {
  return mergeProductCaseEvidenceCaptures(current, added)
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function nullableNumber(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nullableInteger(value: string) {
  const parsed = nullableNumber(value)
  return parsed !== null && Number.isInteger(parsed) ? parsed : null
}

function downloadJson(filename: string, content: string) {
  const blobUrl = URL.createObjectURL(new Blob([content], {
    type: "application/json;charset=utf-8",
  }))
  const anchor = document.createElement("a")
  anchor.href = blobUrl
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
}

function tone(value: unknown) {
  const status = text(value, "")
  if (
    status.includes("COMPLETE") ||
    status.includes("ACCEPT") ||
    status === "SOURCE_AVAILABLE" ||
    status === "HIGH"
  ) {
    return "border-emerald-200/30 bg-emerald-200/[0.07] text-emerald-50"
  }
  if (
    status.includes("BLOCK") ||
    status.includes("HOLD") ||
    status.includes("MISSING") ||
    status.includes("REJECT") ||
    status === "LOW" ||
    status === "AUTHENTICATED_SOURCE_REQUIRED"
  ) {
    return "border-amber-200/30 bg-amber-200/[0.07] text-amber-50"
  }
  return "border-cyan-200/25 bg-cyan-200/[0.06] text-cyan-50"
}

function fixtureEvidence(): ExtractedEvidence[] {
  const candidates = fixtureDocument.evidence ?? pilotFixture.evidence
  return Array.isArray(candidates)
    ? candidates as ExtractedEvidence[]
    : []
}

function fixtureCaptures(): Capture[] {
  const candidates = fixtureDocument.captures ?? pilotFixture.captures
  return Array.isArray(candidates)
    ? candidates as Capture[]
    : []
}

function fixtureUrl() {
  return text(
    fixtureDocument.sourceUrl ?? pilotFixture.sourceUrl,
    "",
  )
}

function fixtureLabel() {
  return text(
    fixtureDocument.productLabel ?? pilotFixture.productLabel,
    "Product Case Runner",
  )
}

function emptyBrowserListingOperations(): ProductCaseListingOperations {
  return {
    ...structuredClone(EMPTY_PRODUCT_CASE_LISTING_OPERATIONS),
    blockers: [],
    differences: [],
    supplierAvailabilityStatus: "NOT_CONFIRMED",
    brandIpClaimsReview: {
      status: "NOT_REVIEWED",
      reviewer: null,
      reviewedAt: null,
      reason: null,
    },
    explicitHumanApproval: {
      approved: false,
      reviewer: null,
      reviewedAt: null,
      reason: null,
    },
    humanOverride: {
      applied: false,
      reviewer: null,
      reviewedAt: null,
      reason: null,
      overriddenBlockers: [],
    },
    candidateKey: null,
  }
}

export default function ProductCaseRunnerPage() {
  const initialHumanConclusion = record(
    record(fixtureDocument.humanReview).conclusion,
  )
  const [sourceUrl, setSourceUrl] = useState(fixtureUrl)
  const [fixtureActive, setFixtureActive] = useState(true)
  const [caseId, setCaseId] = useState(() =>
    text(fixtureDocument.caseId, "product-case-browser-draft")
  )
  const [productLabel, setProductLabel] = useState(fixtureLabel)
  const [caseCreatedAt, setCaseCreatedAt] = useState(() =>
    text(fixtureDocument.createdAt, new Date().toISOString())
  )
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null)
  const [importedSourceAccess, setImportedSourceAccess] =
    useState<ProductCaseDocument["sourceAccess"] | null>(null)
  const [importJson, setImportJson] = useState("")
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(
    null,
  )
  const [importInputSource, setImportInputSource] =
    useState<ProductCaseImportRoundtrip["source"]>("TEXTAREA")
  const [importReadStatus, setImportReadStatus] =
    useState<"IDLE" | "READING" | "READY" | "ERROR">("IDLE")
  const [importInlineError, setImportInlineError] = useState("")
  const [importMismatchPaths, setImportMismatchPaths] =
    useState<string[]>([])
  const importReadGenerationRef = useRef(0)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const [importRoundtrip, setImportRoundtrip] =
    useState<ProductCaseImportRoundtrip | null>(null)
  const [importRequiresHumanReReview, setImportRequiresHumanReReview] =
    useState(false)
  const [legacyImportAudit, setLegacyImportAudit] =
    useState<ProductCaseLegacyImportAudit | null>(null)
  const [historicalHumanIdentityReviewAudit,
    setHistoricalHumanIdentityReviewAudit] =
    useState<ProductCaseHistoricalHumanIdentityReviewAudit | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(false)
  const [supplierSourceCapture, setSupplierSourceCapture] =
    useState<ProductCaseSupplierSourceCapture | null>(() =>
      structuredClone(fixtureSupplierSourceCapture)
    )
  const [manualContent, setManualContent] = useState(() =>
    fixtureSupplierSourceCapture?.rawVisibleSourceText ?? ""
  )
  const [
    humanVisibleProductTextConfirmed,
    setHumanVisibleProductTextConfirmed,
  ] = useState(() => Boolean(fixtureSupplierSourceCapture))
  const [evidence, setEvidence] =
    useState<ExtractedEvidence[]>(fixtureEvidence)
  const [captures, setCaptures] = useState<Capture[]>(fixtureCaptures)
  const [marketEvidence, setMarketEvidence] =
    useState<ProductCaseDocument["marketEvidence"]>(() =>
      structuredClone(
        fixtureDocument.marketEvidence,
      ) as ProductCaseDocument["marketEvidence"]
    )
  const [generalComparableDraft, setGeneralComparableDraft] =
    useState<GeneralComparableDraft>(emptyGeneralComparableDraft)
  const [imageAnalysis, setImageAnalysis] =
    useState<ProductCaseDocument["imageAnalysis"]>(() =>
      structuredClone(
        fixtureDocument.imageAnalysis,
      ) as ProductCaseDocument["imageAnalysis"]
    )
  const [identityReviewState, setIdentityReviewState] =
    useState<ProductCaseDocument["identityReview"]>(() =>
      structuredClone(
        fixtureDocument.identityReview,
      ) as ProductCaseDocument["identityReview"]
    )
  const [supplierCatalogLimitation, setSupplierCatalogLimitation] =
    useState<ProductCaseSupplierCatalogLimitationState>(() =>
      structuredClone(fixtureDocument.supplierCatalogLimitation) as
        ProductCaseSupplierCatalogLimitationState
    )
  const [supplierCatalogLimitationDraft,
    setSupplierCatalogLimitationDraft] =
    useState<SupplierCatalogLimitationDraft>(
      emptySupplierCatalogLimitationDraft,
    )
  const [supplierCatalogLimitationError,
    setSupplierCatalogLimitationError] = useState("")
  const [humanIdentityReviewDraft, setHumanIdentityReviewDraft] =
    useState<HumanIdentityReviewDraft>(() =>
      humanIdentityReviewDraftFrom(
        fixtureDocument.identityReview as
          ProductCaseDocument["identityReview"],
        )
    )
  const [
    humanIdentityReviewDraftBaseline,
    setHumanIdentityReviewDraftBaseline,
  ] = useState<HumanIdentityReviewDraft>(() =>
    cloneHumanIdentityReviewDraft(
      humanIdentityReviewDraftFrom(
        fixtureDocument.identityReview as
          ProductCaseDocument["identityReview"],
      ),
    )
  )
  const [
    humanIdentityRawInputSnapshot,
    setHumanIdentityRawInputSnapshot,
  ] = useState<ProductCaseHumanIdentityReview["rawHumanInput"] | null>(
    () =>
      humanIdentityRawInputFrom(
        fixtureDocument.identityReview as
          ProductCaseDocument["identityReview"],
      ),
  )
  const [editingHumanIdentityReview, setEditingHumanIdentityReview] =
    useState(() =>
      Object.keys(
        record(record(fixtureDocument.identityReview).humanReview),
      ).length === 0
    )
  const [economicsPolicy, setEconomicsPolicy] = useState<
    Parameters<typeof buildStrategyLabAdapterPreview>[0]["economicsPolicy"]
  >(() => (fixtureDocument.economicsPolicy ?? null) as
    Parameters<typeof buildStrategyLabAdapterPreview>[0]["economicsPolicy"])
  const [scenarioDraft, setScenarioDraft] = useState<
    Parameters<typeof buildStrategyLabAdapterPreview>[0]["scenarioDraft"]
  >(() => (fixtureDocument.scenarioDraft ?? null) as
    Parameters<typeof buildStrategyLabAdapterPreview>[0]["scenarioDraft"])
  const [economicsPolicyJson, setEconomicsPolicyJson] = useState(() =>
    JSON.stringify(fixtureDocument.economicsPolicy ?? null, null, 2)
  )
  const [scenarioDraftJson, setScenarioDraftJson] = useState(() =>
    JSON.stringify(fixtureDocument.scenarioDraft ?? null, null, 2)
  )
  const [reviewDrafts, setReviewDrafts] =
    useState<Record<string, ReviewDraft>>({})
  const [appliedReviewDecisions, setAppliedReviewDecisions] =
    useState<Record<string, ReviewAction>>({})
  const [comparableReviewDrafts, setComparableReviewDrafts] =
    useState<Record<string, ComparableReviewDraft>>({})
  const [humanConclusion, setHumanConclusion] = useState(() =>
    text(initialHumanConclusion.conclusion, "")
  )
  const [humanScenario, setHumanScenario] = useState(() =>
    text(initialHumanConclusion.scenario, "")
  )
  const [humanReason, setHumanReason] = useState(() =>
    text(initialHumanConclusion.reason, "")
  )
  const [humanReviewer, setHumanReviewer] = useState(() =>
    text(initialHumanConclusion.reviewer, "")
  )
  const [humanReviewedAt, setHumanReviewedAt] = useState<string | null>(() =>
    text(initialHumanConclusion.reviewedAt, "") || null
  )
  const [proposedRuleObservation, setProposedRuleObservation] = useState(() =>
    text(
      record(fixtureDocument.humanReview).proposedRuleObservation,
      "",
    )
  )
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [
    humanIdentityReviewError,
    setHumanIdentityReviewError,
  ] = useState("")
  const [workspaceExportError, setWorkspaceExportError] = useState("")
  const [extracting, setExtracting] = useState(false)
  const [generatedPackage, setGeneratedPackage] =
    useState<JsonRecord | null>(null)
  const [imageApprovals, setImageApprovals] =
    useState<ProductCaseImageApproval[]>([])
  const [imageApprovalDrafts, setImageApprovalDrafts] =
    useState<Record<string, ImageApprovalDraft>>({})
  const [newImageDraft, setNewImageDraft] = useState<ImageApprovalDraft>(
    emptyImageApprovalDraft,
  )
  const [visualObservationDraft, setVisualObservationDraft] =
    useState<VisualObservationDraft>(emptyVisualObservationDraft)
  const [
    editingVisualObservationEvidenceId,
    setEditingVisualObservationEvidenceId,
  ] = useState<string | null>(null)
  const [visualReviewFilter, setVisualReviewFilter] =
    useState<VisualReviewFilter>("ALL")
  const [visualReviewQuery, setVisualReviewQuery] = useState("")
  const [
    highlightedVisualReviewEvidenceId,
    setHighlightedVisualReviewEvidenceId,
  ] = useState<string | null>(null)
  const [
    visualReviewReturnTarget,
    setVisualReviewReturnTarget,
  ] = useState<VisualReviewReturnTarget | null>(null)
  const [activePhaseIndex, setActivePhaseIndex] =
    useState<number | null>(null)
  const visualReviewHighlightTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null)
  const [runnerTimestamp, setRunnerTimestamp] = useState(() =>
    text(fixtureDocument.createdAt, new Date().toISOString())
  )
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const humanIdentityReviewErrorRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => {
    if (visualReviewHighlightTimeoutRef.current) {
      clearTimeout(visualReviewHighlightTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const savedReview = record(record(identityReviewState).humanReview)
    const nextDraft = humanIdentityReviewDraftFrom(identityReviewState)
    setHumanIdentityReviewDraft(nextDraft)
    setHumanIdentityReviewDraftBaseline(
      cloneHumanIdentityReviewDraft(nextDraft),
    )
    setHumanIdentityRawInputSnapshot(
      humanIdentityRawInputFrom(identityReviewState),
    )
    setHumanIdentityReviewError("")
    setEditingHumanIdentityReview(Object.keys(savedReview).length === 0)
  }, [identityReviewState])

  const urlValidation = useMemo(
    () => validateLunaProductUrl(sourceUrl),
    [sourceUrl],
  )
  const manualBytes = useMemo(
    () => byteLength(manualContent),
    [manualContent],
  )
  const sourceAccess = useMemo(() => ({
    status: preflight
      ? preflight.accessStatus === "SOURCE_AVAILABLE"
        ? "PUBLIC_ACCESSIBLE" as const
        : preflight.accessStatus === "AUTHENTICATED_SOURCE_REQUIRED"
          ? "AUTHENTICATED_SOURCE_REQUIRED" as const
          : "REJECTED" as const
      : importedSourceAccess
        ? importedSourceAccess.status
        : fixtureActive
        ? text(
          record(fixtureDocument.sourceAccess).status,
          "NOT_RUN",
        ) as ProductCaseDocument["sourceAccess"]["status"]
        : "NOT_RUN" as const,
    canonicalUrl: preflight?.sourceUrl ??
      importedSourceAccess?.canonicalUrl ??
      (urlValidation.valid ? urlValidation.canonicalUrl : null),
    checkedAt: preflight?.capturedAt ??
      importedSourceAccess?.checkedAt ??
      null,
    reason: preflight?.error ??
      (preflight?.accessStatus === "AUTHENTICATED_SOURCE_REQUIRED"
        ? "AUTHENTICATED_SOURCE_REQUIRED"
        : importedSourceAccess?.reason ?? null),
    httpStatus: preflight?.httpStatus ??
      importedSourceAccess?.httpStatus ??
      null,
    redirectsFollowed: importedSourceAccess?.redirectsFollowed ?? 0,
    credentialsUsed: false as const,
  }), [
    fixtureActive,
    importedSourceAccess,
    preflight,
    sourceUrl,
    urlValidation,
  ])
  const sourceContractGuard = useMemo(
    () => resolveLunaSourceContractGuard({
      sourceAccessStatus: sourceAccess.status,
      supplierSourceCapture,
    }),
    [sourceAccess.status, supplierSourceCapture],
  )

  const productCase = useMemo(() => ({
    ...fixtureDocument,
    version: PRODUCT_CASE_RUNNER_VERSION,
    caseId: text(
      caseId,
      "product-case-browser-draft",
    ),
    productLabel,
    sourceUrl: urlValidation.valid
      ? urlValidation.canonicalUrl
      : sourceUrl,
    createdAt: caseCreatedAt,
    sourceAccess,
    supplierSourceCapture,
    captures,
    evidence,
    marketEvidence,
    imageAnalysis,
    identityReview: identityReviewState,
    supplierCatalogLimitation,
    humanReview: {
      ...record(fixtureDocument.humanReview),
      conclusion: {
        scenario: humanScenario || null,
        conclusion: humanConclusion || null,
        reason: humanReason || null,
        reviewedAt: humanReviewedAt,
        reviewer: humanReviewer || null,
      },
      proposedRuleObservation: proposedRuleObservation || null,
      learningStatus: "HUMAN_REVIEW_DRAFT",
      canChangeEngineRules: false,
      canLinkListing: false,
      canPublishAutomatically: false,
    },
    safety: PRODUCT_CASE_ZERO_EFFECTS,
  }) as unknown as ProductCaseDocument, [
    captures,
    caseCreatedAt,
    caseId,
    evidence,
    humanConclusion,
    humanReason,
    humanReviewedAt,
    humanReviewer,
    humanScenario,
    identityReviewState,
    imageAnalysis,
    marketEvidence,
    productLabel,
    proposedRuleObservation,
    runnerTimestamp,
    sourceAccess,
    supplierSourceCapture,
    supplierCatalogLimitation,
    sourceUrl,
    urlValidation,
  ])

  const strategyAdapter = useMemo(
    () => buildStrategyLabAdapterPreview({
      document: productCase,
      evaluatedAt: runnerTimestamp,
      economicsPolicy,
      scenarioDraft,
    }),
    [economicsPolicy, productCase, runnerTimestamp, scenarioDraft],
  )
  const [listingOperations, setListingOperations] =
    useState<ProductCaseListingOperations>(() => structuredClone(
      pilotFixture.listingOperations ??
      EMPTY_PRODUCT_CASE_LISTING_OPERATIONS,
    ) as ProductCaseListingOperations)
  const runnerOutput = useMemo(
    () => buildProductCaseRunnerOutput({
      document: productCase,
      adapter: strategyAdapter,
      imageApprovals,
      listingOperations,
      generatedAt: runnerTimestamp,
    }),
    [
      imageApprovals,
      listingOperations,
      productCase,
      runnerTimestamp,
      strategyAdapter,
    ],
  )
  const output = record(runnerOutput)
  const readiness = record(output.readiness)
  const strategyPreview = record(output.adapter)
  const shadowMode = record(output.shadowMode)
  const osConclusion = text(
    strategyPreview.osConclusion,
    "MISSING",
  )
  const listingPackage = record(output.listingPackage)
  const listingPackageStatus = text(
    output.listingPackageStatus ?? listingPackage.packageStatus,
  )
  const registrationDraft = record(output.registrationDraft)
  const learningObservation = record(output.learningObservation)
  const imageRegistry = record(output.imageRegistry)
  const outputDocument = record(output.document)
  const visualAnalysis = record(outputDocument.imageAnalysis)
  const identityReview = record(outputDocument.identityReview)
  const savedHumanIdentityReview = record(identityReview.humanReview)
  const activeSupplierCatalogAttestation = record(
    supplierCatalogLimitation.activeAttestation,
  )
  const supplierIdentityEvidenceIds = strings(
    identityReview.supplierEvidenceIds,
  )
  const humanObservationIdentityEvidenceIds = strings(
    identityReview.humanObservationEvidenceIds,
  )
  const acceptedIdentityEvidenceIds = new Set(
    acceptedProductCaseEvidence(evidence).map((entry) => entry.id),
  )
  const admissibleIdentityEvidence = evidence.filter((entry) => {
    const row = record(entry)
    const id = evidenceId(entry)
    const status = text(row.evidenceStatus, "")
    const evidenceClass = text(row.evidenceClass, "")
    if (
      ["REJECTED", "NEEDS_MORE_EVIDENCE", "MISSING", "CONFLICTED"]
        .includes(status) ||
      ["MISSING", "CONFLICTED"].includes(evidenceClass)
    ) return false
    if (acceptedIdentityEvidenceIds.has(id)) return true
    const observation = imageAnalysis.observations.find((candidate) =>
      candidate.evidenceId === id
    )
    return Boolean(
      observation &&
      observation.contractVersion ===
        HUMAN_VISUAL_REVIEW_CONTRACT_VERSION &&
      observation.rawHumanInput &&
      observation.humanDecision === "ACCEPT_FOR_ANALYSIS" &&
      observation.contentHash === text(row.contentHash, "") &&
      text(row.sourceType, "") === "HUMAN_VISUAL_OBSERVATION" &&
      text(row.sourceEvidenceClass, "") === "HUMAN_VISUAL_REVIEW" &&
      captures.some((capture) =>
        capture.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
        capture.contentHash === observation.contentHash
      )
    )
  })
  const identityEvidenceCandidates =
    admissibleIdentityEvidence.filter((entry) => {
      const row = record(entry)
      const field = text(row.field, "")
      return (
        new Set([
          "title",
          "contents",
          "visual_observation",
          ...HUMAN_IDENTITY_FIELDS,
        ]).has(field) &&
        text(row.sourceEvidenceClass, "") !== "SUPPLIER_MARKETING_CLAIM"
      )
    })
  const humanReviewFieldNames: Record<string, string> = {
    product_type: "productType",
    brand: "brand",
    model: "model",
    mpn: "mpn",
    supplier_product_id: "supplierProductId",
    supplier_sku: "supplierSku",
    variant_id: "variantId",
    color: "color",
    pack_quantity: "packQuantity",
  }
  const savedIdentityProvenance = record(
    savedHumanIdentityReview.provenance,
  )
  const savedIdentityReviewEvidenceIds = new Set(
    strings(savedHumanIdentityReview.evidenceIds),
  )
  const availableIdentityFieldRows = HUMAN_IDENTITY_FIELDS.map((field) => {
    const reviewField = humanReviewFieldNames[field]
    const canonicalReviewValue = savedHumanIdentityReview[reviewField]
    const hasCanonicalReviewValue = canonicalReviewValue !== null &&
      canonicalReviewValue !== undefined && canonicalReviewValue !== ""
    const fieldProvenance = field === "product_type"
      ? rows(savedIdentityProvenance.productType)
      : field === "pack_quantity"
        ? rows(savedIdentityProvenance.packQuantity)
        : []
    const entry = admissibleIdentityEvidence.find((candidate) => {
      const row = record(candidate)
      if (text(row.field, "") !== field) return false
      if (!hasCanonicalReviewValue) return true
      const candidateValue = row.correctedValue ??
        row.normalizedValue ?? row.rawValue
      return savedIdentityReviewEvidenceIds.has(evidenceId(candidate)) &&
        JSON.stringify(candidateValue) === JSON.stringify(canonicalReviewValue)
    })
    const row = record(entry)
    const provenanceEvidenceIds = fieldProvenance.map((reference) =>
      text(reference.evidenceId, "")
    ).filter(Boolean)
    const provenanceClasses = fieldProvenance.map((reference) =>
      text(reference.sourceEvidenceClass, "")
    ).filter(Boolean)
    const hasFieldProvenance = provenanceEvidenceIds.length > 0
    return {
      field,
      evidenceIds: hasCanonicalReviewValue && hasFieldProvenance
        ? provenanceEvidenceIds
        : entry ? [evidenceId(entry)] : [],
      value: hasCanonicalReviewValue
        ? canonicalReviewValue
        : entry
          ? row.correctedValue ?? row.normalizedValue ?? row.rawValue
          : null,
      sourceEvidenceClasses: hasCanonicalReviewValue && hasFieldProvenance
        ? provenanceClasses
        : entry ? [text(row.sourceEvidenceClass, "")] : [],
    }
  })
  const missingIdentityFields = availableIdentityFieldRows
    .filter((row) => row.value === null)
    .map((row) => row.field)
  const activeIdentityConflicts = [
    text(identityReview.currentConflict, ""),
    ...imageAnalysis.observations.flatMap((observation) =>
      observation.possibleConflicts
    ),
  ].filter((entry, index, all) =>
    Boolean(entry) && all.indexOf(entry) === index
  )
  const identityBlockers = strings(identityReview.blockers)
  const imageRegistryEntries = rows(imageRegistry.entries)
  const phaseSnapshots = rows(output.operationalPipeline)
  const blockedPhaseSnapshots = phaseSnapshots.filter((phase) =>
    phase.status === "BLOCKED"
  )
  const firstBlockedPhase = blockedPhaseSnapshots[0]
  const packagePhase = phaseSnapshots.find((phase) =>
    phase.phase === "MANUAL_LISTING_PACKAGE"
  )
  const packageGenerated =
    !importRequiresHumanReReview &&
    output.listingPackage !== null &&
    listingPackageStatus !== "NOT_GENERATED_IDENTITY_HOLD"
  const manualHandoffAllowed =
    !importRequiresHumanReReview &&
    (listingPackage.manualHandoffAllowed === true ||
      output.manualHandoffAllowed === true)
  const packageBlockers = [
    ...(importRequiresHumanReReview
      ? ["IMPORTED_WORKSPACE_HUMAN_RE_REVIEW_REQUIRED"]
      : []),
    ...rows(listingPackage.gates)
      .flatMap((gate) => strings(gate.blockers)),
    ...strings(packagePhase?.blockers),
  ].filter((entry, index, all) => all.indexOf(entry) === index)
  const acceptedEvidence = evidence.filter((entry) => {
    const verdict = text(record(entry).humanVerdict, "")
    return verdict === "ACCEPT" || verdict === "CORRECT"
  })
  const rejectedEvidence = evidence.filter((entry) =>
    text(record(entry).humanVerdict, "") === "REJECT"
  )
  const reviewableEvidence = evidence.filter((entry) =>
    text(record(entry).field, "") !== "visual_observation"
  )
  const contradictableSupplierEvidence = evidence.filter((entry) => {
    const row = record(entry)
    return ["title", "description", "product_type"].includes(
      text(row.field, ""),
    ) && ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      text(row.sourceEvidenceClass, ""),
    )
  })
  const visualReviewContractIssues = imageAnalysis.contractIssues ?? []
  const visualReviewImageAnchorCounts =
    imageAnalysis.observations.reduce<Map<string, number>>(
      (counts, observation) => {
        const segment = stableDomIdSegment(observation.imageId)
        counts.set(segment, (counts.get(segment) ?? 0) + 1)
        return counts
      },
      new Map(),
    )
  function visualReviewAnchorDisambiguator(
    observation: ProductCaseImageObservation,
  ) {
    const segment = stableDomIdSegment(observation.imageId)
    const needsDisambiguation =
      !observation.imageId.trim() ||
      (visualReviewImageAnchorCounts.get(segment) ?? 0) > 1
    if (!needsDisambiguation) return undefined
    const observationIndex =
      imageAnalysis.observations.indexOf(observation)
    return `${observation.evidenceId}-${observationIndex + 1}`
  }
  function visualReviewCardAnchorFor(
    observation: ProductCaseImageObservation,
  ) {
    return visualReviewCardAnchor(
      observation.imageId,
      visualReviewAnchorDisambiguator(observation),
    )
  }
  function visualReviewIssueAnchorFor(
    observation: ProductCaseImageObservation,
  ) {
    return visualReviewIssueAnchor(
      observation.imageId,
      visualReviewAnchorDisambiguator(observation),
    )
  }
  const isVisualReviewPending = (
    observation: ProductCaseImageObservation,
  ) =>
    observation.contractVersion !== HUMAN_VISUAL_REVIEW_CONTRACT_VERSION ||
    !observation.rawHumanInput ||
    visualReviewContractIssues.some((issue) =>
      visualIssueMatchesObservation(issue, observation)
    )
  const pendingVisualObservations = imageAnalysis.observations.filter(
    isVisualReviewPending,
  )
  const normalizedVisualReviewQuery =
    visualReviewQuery.trim().toLocaleLowerCase("en-US")
  const filteredVisualObservations = imageAnalysis.observations.filter(
    (observation) => {
      const pending = isVisualReviewPending(observation)
      if (visualReviewFilter === "PENDING" && !pending) return false
      if (visualReviewFilter === "CORRECTED" && pending) return false
      if (!normalizedVisualReviewQuery) return true
      const searchable = [
        observation.imageId,
        observation.evidenceId,
        pending
          ? "LEGACY REQUIRES CORRECTION PENDING"
          : "CORRECTED HUMAN VISUAL REVIEW",
        ...visualReviewContractIssues.filter((issue) =>
          visualIssueMatchesObservation(issue, observation)
        ),
      ].join("\n").toLocaleLowerCase("en-US")
      return searchable.includes(normalizedVisualReviewQuery)
    },
  )
  const stockEvidence = record(evidence.find((entry) =>
    record(entry).field === "visible_stock" &&
    record(entry).normalizedValue !== null
  ))
  const currentEvidenceLeader = text(
    record(strategyPreview.currentEvidenceLeader).offerScenario,
    "NOT_YET_DETERMINED",
  )
  const strategicHypothesis = text(
    record(strategyPreview.strategicHypothesisToValidate).offerScenario,
    "NOT_YET_DEFINED",
  )

  function focusProductCaseTarget(
    anchorId: string,
    focusId = anchorId,
  ) {
    const target = document.getElementById(anchorId)
    const focusTarget = document.getElementById(focusId)
    if (!target) return
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
    window.history.replaceState(null, "", `#${anchorId}`)
    target.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    })
    window.requestAnimationFrame(() => {
      ;(focusTarget ?? target).focus({ preventScroll: true })
    })
  }

  function focusVisualReviewCard(
    observation: ProductCaseImageObservation,
    returnAnchorId: string,
  ) {
    setVisualReviewFilter("ALL")
    setVisualReviewQuery("")
    setVisualReviewReturnTarget({
      observationEvidenceId: observation.evidenceId,
      anchorId: returnAnchorId,
    })
    setHighlightedVisualReviewEvidenceId(observation.evidenceId)
    if (visualReviewHighlightTimeoutRef.current) {
      clearTimeout(visualReviewHighlightTimeoutRef.current)
    }
    visualReviewHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedVisualReviewEvidenceId((current) =>
        current === observation.evidenceId ? null : current
      )
      visualReviewHighlightTimeoutRef.current = null
    }, 3_000)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const cardId = visualReviewCardAnchorFor(observation)
        focusProductCaseTarget(cardId)
      })
    })
  }

  function focusFirstPendingVisualReview(returnAnchorId: string) {
    const firstPending = pendingVisualObservations[0]
    if (!firstPending) return
    focusVisualReviewCard(firstPending, returnAnchorId)
  }

  function returnToVisualReviewBlocker() {
    if (
      !visualReviewReturnTarget ||
      visualReviewReturnTarget.observationEvidenceId !==
        editingVisualObservationEvidenceId
    ) return
    focusProductCaseTarget(visualReviewReturnTarget.anchorId)
  }

  function navigateToProductCasePhase(
    event: ReactMouseEvent<HTMLAnchorElement>,
    index: number,
  ) {
    const target = PRODUCT_CASE_PHASE_NAVIGATION_TARGETS[index]
    if (!target) return
    event.preventDefault()
    setActivePhaseIndex(index)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusProductCaseTarget(target.anchorId, target.focusId)
      })
    })
  }

  function changeSourceUrl(nextUrl: string) {
    const changedAt = new Date().toISOString()
    importReadGenerationRef.current += 1
    setSourceUrl(nextUrl)
    setFixtureActive(false)
    setCaseId("product-case-browser-draft")
    setProductLabel("BROWSER PRODUCT CASE DRAFT")
    setCaseCreatedAt(changedAt)
    setRunnerTimestamp(changedAt)
    setPreflight(null)
    setImportedSourceAccess(null)
    setImportJson("")
    setSelectedImportFile(null)
    setImportInputSource("TEXTAREA")
    setImportReadStatus("IDLE")
    setImportInlineError("")
    setImportMismatchPaths([])
    if (importFileInputRef.current) importFileInputRef.current.value = ""
    setImportRoundtrip(null)
    setImportRequiresHumanReReview(false)
    setLegacyImportAudit(null)
    setHistoricalHumanIdentityReviewAudit(null)
    setWorkspaceExportError("")
    setManualContent("")
    setHumanVisibleProductTextConfirmed(false)
    setSupplierSourceCapture(null)
    setEvidence([])
    setCaptures([])
    setMarketEvidence({
      runStatus: "NOT_RUN",
      soldExact: "MISSING",
      soldExactCount: 0,
      activeExact: "MISSING",
      marketCeiling: "MISSING",
      referenceMedian: null,
      comparables: [],
      humanSuppliedComparableCandidates: [],
      observedAt: null,
    })
    setImageAnalysis({
      imageAnalysisCapability: "HUMAN_ASSISTED_ONLY",
      machineVisionStatus: "NOT_IMPLEMENTED",
      openAiVisionUsed: false,
      humanReviewRequired: true,
      visualEvidenceStatus: "NOT_REVIEWED",
      conflictDetectedFrom: [],
      observations: [],
    })
    setIdentityReviewState({
      status: "NOT_REVIEWED",
      confidence: "LOW",
      physicalProductVerified: false,
      physicalVerificationEvidenceIds: [],
      conflictHistory: [],
      currentConflict: null,
      supplierEvidenceIds: [],
      humanObservationEvidenceIds: [],
      blockers: [],
      nextAction: "CAPTURE_AUTHENTICATED_SUPPLIER_EVIDENCE",
      humanReview: null,
    })
    setSupplierCatalogLimitation({
      activeAttestation: null,
      historicalAttestations: [],
    })
    setSupplierCatalogLimitationDraft(
      emptySupplierCatalogLimitationDraft,
    )
    setSupplierCatalogLimitationError("")
    setEconomicsPolicy(null)
    setScenarioDraft(null)
    setEconomicsPolicyJson("null")
    setScenarioDraftJson("null")
    setReviewDrafts({})
    setAppliedReviewDecisions({})
    setComparableReviewDrafts({})
    setGeneralComparableDraft(emptyGeneralComparableDraft)
    setHumanConclusion("")
    setHumanScenario("")
    setHumanReason("")
    setHumanReviewer("")
    setHumanReviewedAt(null)
    setProposedRuleObservation("")
    setImageApprovals([])
    setImageApprovalDrafts({})
    setNewImageDraft({ ...emptyImageApprovalDraft })
    setVisualObservationDraft({ ...emptyVisualObservationDraft })
    setEditingVisualObservationEvidenceId(null)
    setVisualReviewFilter("ALL")
    setVisualReviewQuery("")
    setHighlightedVisualReviewEvidenceId(null)
    setVisualReviewReturnTarget(null)
    setActivePhaseIndex(null)
    if (visualReviewHighlightTimeoutRef.current) {
      clearTimeout(visualReviewHighlightTimeoutRef.current)
      visualReviewHighlightTimeoutRef.current = null
    }
    setListingOperations(emptyBrowserListingOperations())
    setGeneratedPackage(null)
    setNotice(
      "Fuente cambiada: el expediente anterior fue retirado del estado del navegador para impedir contaminación entre productos.",
    )
    setError("")
  }

  async function runPreflight() {
    setError("")
    setNotice("")
    setPreflight(null)
    if (!urlValidation.valid) {
      setError(urlValidation.error)
      return
    }
    setPreflightBusy(true)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session?.access_token) {
        throw new Error("ADMIN_SESSION_REQUIRED")
      }
      const query = new URLSearchParams({
        sourceUrl: urlValidation.canonicalUrl,
      })
      const response = await fetch(
        `/api/admin/ebay/product-case-runner/preflight?${query.toString()}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
        },
      )
      const payload = await response.json() as PreflightResponse
      setPreflight(payload)
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "SOURCE_PREFLIGHT_UNAVAILABLE")
        return
      }
      if (Array.isArray(payload.publicEvidence)) {
        setEvidence((current) =>
          mergeEvidence(current, payload.publicEvidence ?? [])
        )
      }
      setNotice(
        payload.accessStatus === "AUTHENTICATED_SOURCE_REQUIRED"
          ? "AUTHENTICATED_SOURCE_REQUIRED — pega manualmente la evidencia visible desde tu sesión autorizada de Luna Portex."
          : "SOURCE_AVAILABLE — el preflight fue read-only. Revisa y pega la evidencia visible para continuar.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "SOURCE_PREFLIGHT_UNAVAILABLE",
      )
    } finally {
      setPreflightBusy(false)
    }
  }

  async function analyzeManualContent() {
    setError("")
    setNotice("")
    if (!urlValidation.valid) {
      setError(urlValidation.error)
      return
    }
    const manualTextValidation =
      validateManualAuthenticatedVisibleSourceText(manualContent)
    if (!manualTextValidation.valid) {
      setError(manualTextValidation.error)
      return
    }
    setExtracting(true)
    try {
      const result = await extractProductCaseEvidence({
        sourceUrl: urlValidation.canonicalUrl,
        capturedAt: new Date().toISOString(),
        content: manualContent,
        sourceType: sourceAccess.status ===
            "AUTHENTICATED_SOURCE_REQUIRED"
          ? "LUNA_AUTHENTICATED_MANUAL_CAPTURE"
          : "LUNA_MANUAL_CAPTURE",
      })
      const authenticatedSourceCapture =
        sourceAccess.status === "AUTHENTICATED_SOURCE_REQUIRED"
          ? await createManualAuthenticatedSupplierSourceCapture({
              supplierUrl: urlValidation.canonicalUrl,
              rawVisibleSourceText:
                manualTextValidation.rawVisibleSourceText,
              sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
              extraction: result,
              humanVisibleProductTextConfirmed,
            })
          : null
      setRunnerTimestamp(result.capture.capturedAt)
      setAppliedReviewDecisions({})
      if (authenticatedSourceCapture) {
        const transitioned = transitionProductCaseSupplierCapture({
          document: productCase,
          replacement: {
            supplierSourceCapture: authenticatedSourceCapture,
            extraction: result,
          },
        })
        setCaptures(transitioned.captures)
        setEvidence(transitioned.evidence)
        setSupplierSourceCapture(transitioned.supplierSourceCapture)
        setImageAnalysis(transitioned.imageAnalysis)
        setIdentityReviewState(transitioned.identityReview)
        setSupplierCatalogLimitation(
          transitioned.supplierCatalogLimitation,
        )
        setMarketEvidence(transitioned.marketEvidence)
      } else {
        const transitioned = transitionProductCaseSupplierCapture({
          document: productCase,
          replacement: {
            supplierSourceCapture: null,
            extraction: result,
          },
        })
        setCaptures(transitioned.captures)
        setEvidence(transitioned.evidence)
        setSupplierSourceCapture(transitioned.supplierSourceCapture)
        setImageAnalysis(transitioned.imageAnalysis)
        setIdentityReviewState(transitioned.identityReview)
        setSupplierCatalogLimitation(
          transitioned.supplierCatalogLimitation,
        )
        setMarketEvidence(transitioned.marketEvidence)
      }
      const proposedTitle = result.evidence.find((entry) =>
        entry.field === "title" &&
        entry.evidenceStatus !== "MISSING"
      )
      if (proposedTitle && typeof proposedTitle.normalizedValue === "string") {
        setProductLabel(proposedTitle.normalizedValue)
      }
      setGeneratedPackage(null)
      setNotice(
        `Evidencia procesada localmente: ${
          result.evidence.filter((entry) =>
            entry.evidenceStatus !== "MISSING"
          ).length
        } candidatos y ${result.missingFields.length} campos MISSING. Nada se envió ni guardó en el servidor.`,
      )
      window.setTimeout(() => resultsHeadingRef.current?.focus(), 0)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "MANUAL_SOURCE_ANALYSIS_FAILED",
      )
    } finally {
      setExtracting(false)
    }
  }

  function clearManualContent() {
    const transitioned = transitionProductCaseSupplierCapture({
      document: productCase,
      replacement: null,
    })
    setManualContent("")
    setHumanVisibleProductTextConfirmed(false)
    setSupplierSourceCapture(transitioned.supplierSourceCapture)
    setCaptures(transitioned.captures)
    setEvidence(transitioned.evidence)
    setAppliedReviewDecisions({})
    setImageAnalysis(transitioned.imageAnalysis)
    setIdentityReviewState(transitioned.identityReview)
    setSupplierCatalogLimitation(transitioned.supplierCatalogLimitation)
    setMarketEvidence(transitioned.marketEvidence)
    setGeneratedPackage(null)
    setNotice(
      "Contenido y extracción temporal eliminados de esta sesión del navegador.",
    )
    setError("")
  }

  function setReviewDraft(
    id: string,
    update: Partial<ReviewDraft>,
  ) {
    setReviewDrafts((current) => ({
      ...current,
      [id]: {
        action: current[id]?.action ?? "NEEDS_MORE_EVIDENCE",
        reason: current[id]?.reason ?? "",
        correctedValue: current[id]?.correctedValue ?? "",
        ...update,
      },
    }))
  }

  function commitReview(entry: ExtractedEvidence) {
    setError("")
    setNotice("")
    const id = evidenceId(entry)
    const draft = reviewDrafts[id] ?? {
      action: "NEEDS_MORE_EVIDENCE" as const,
      reason: "",
      correctedValue: "",
    }
    if (
      ["REJECT", "CORRECT"].includes(draft.action) &&
      !draft.reason.trim()
    ) {
      setError(`${draft.action}_REQUIRES_HUMAN_REASON:${id}`)
      return
    }
    if (draft.action === "CORRECT" && !draft.correctedValue.trim()) {
      setError(`CORRECT_REQUIRES_CORRECTED_VALUE:${id}`)
      return
    }
    try {
      const reviewedEvidence = applyProductCaseEvidenceReview(evidence, {
        evidenceId: id,
        action: draft.action,
        reason: draft.reason,
        correctedValue: draft.action === "CORRECT"
          ? draft.correctedValue
          : undefined,
      })
      const sourceType = text(record(entry).sourceType, "")
      const invalidatesIdentity =
        sourceType.startsWith("LUNA_") ||
        sourceType === "HUMAN_VISUAL_OBSERVATION"
      setEvidence(reviewedEvidence)
      if (invalidatesIdentity) {
        const invalidatedDocument = deleteHumanIdentityReviewRecord({
          document: {
            ...productCase,
            evidence: reviewedEvidence,
          },
        })
        setIdentityReviewState(invalidatedDocument.identityReview)
        setSupplierCatalogLimitation(
          invalidatedDocument.supplierCatalogLimitation,
        )
        setMarketEvidence(invalidatedDocument.marketEvidence)
      }
      setGeneratedPackage(null)
      setAppliedReviewDecisions((current) => ({
        ...current,
        [id]: draft.action,
      }))
      setNotice(
        `${id}: ${draft.action}. El valor raw/original permanece preservado.${
          invalidatesIdentity
            ? " La revisión de identidad y los artefactos derivados fueron invalidados."
            : ""
        }`,
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "HUMAN_REVIEW_NOT_APPLIED",
      )
    }
  }

  function setImageApprovalDraft(
    id: string,
    update: Partial<ImageApprovalDraft>,
    base: ImageApprovalDraft = emptyImageApprovalDraft,
  ) {
    setImageApprovalDrafts((current) => ({
      ...current,
      [id]: {
        ...base,
        ...current[id],
        ...update,
      },
    }))
  }

  function commitImageApproval(asset: JsonRecord) {
    setError("")
    setNotice("")
    const id = text(asset.evidenceId, "")
    const draft = imageApprovalDrafts[id] ?? {
      ...emptyImageApprovalDraft,
      sourceKind: text(
        asset.sourceKind,
        "ORIGINAL_SUPPLIER",
      ) as ProductCaseImageApproval["sourceKind"],
      sourceUrl: text(asset.sourceUrl, ""),
      assetHash: text(asset.assetHash, ""),
      purpose: text(asset.purpose, ""),
      role: text(
        asset.role,
        "SECONDARY",
      ) as ProductCaseImageApproval["role"],
      order: text(asset.order, ""),
      variantId: text(asset.variantId, ""),
      packQuantity: text(asset.packQuantity, ""),
      humanNotes: text(asset.humanNotes, ""),
      status: text(
        asset.approvalStatus,
        "HUMAN_REVIEW",
      ) as ProductCaseImageApproval["status"],
      reviewer: text(asset.reviewer, ""),
    }
    if (!id) {
      setError("IMAGE_EVIDENCE_ID_REQUIRED")
      return
    }
    if (!draft.sourceUrl.trim() || !draft.purpose.trim()) {
      setError(`IMAGE_SOURCE_URL_AND_PURPOSE_REQUIRED:${id}`)
      return
    }
    if (
      draft.assetHash &&
      !/^sha256:[0-9a-f]{64}$/.test(draft.assetHash.trim())
    ) {
      setError(`IMAGE_ASSET_SHA256_INVALID:${id}`)
      return
    }
    if (
      ["APPROVED", "REJECTED"].includes(draft.status) &&
      !draft.reviewer.trim()
    ) {
      setError(`IMAGE_REVIEWER_REQUIRED:${id}`)
      return
    }
    if (draft.status === "REJECTED" && !draft.reason.trim()) {
      setError(`IMAGE_REJECTION_REASON_REQUIRED:${id}`)
      return
    }
    const reviewedAt = new Date().toISOString()
    setRunnerTimestamp(reviewedAt)
    setImageApprovals((current) => [
      ...current.filter((entry) => entry.evidenceId !== id),
      {
        evidenceId: id,
        sourceKind: draft.sourceKind,
        sourceUrl: draft.sourceUrl.trim(),
        assetHash: draft.assetHash.trim()
          ? draft.assetHash.trim() as `sha256:${string}`
          : null,
        purpose: draft.purpose.trim(),
        role: draft.role,
        order: nullableInteger(draft.order) ?? 0,
        variantId: draft.variantId.trim() || null,
        packQuantity: nullableInteger(draft.packQuantity),
        humanNotes: draft.humanNotes.trim() || null,
        status: draft.status,
        reviewer: draft.reviewer.trim() || null,
        reviewedAt: ["APPROVED", "REJECTED"].includes(draft.status)
          ? reviewedAt
          : null,
        reason: draft.reason.trim() || null,
        qa: {
          productAndVariantMatch: draft.productAndVariantMatch,
          packQuantityMatch: draft.packQuantityMatch,
          logosAndIpReviewed: draft.logosAndIpReviewed,
          claimsReviewed: draft.claimsReviewed,
          ebayRoleCoherent: draft.ebayRoleCoherent,
        },
      },
    ])
    setNotice(
      `${id}: QA manual ${draft.status}. No se cargó ni descargó la imagen.`,
    )
  }

  function registerManualImageMetadata() {
    setError("")
    setNotice("")
    const draft = newImageDraft
    if (!draft.sourceUrl.trim() || !draft.purpose.trim()) {
      setError("IMAGE_SOURCE_URL_AND_PURPOSE_REQUIRED")
      return
    }
    try {
      const parsed = new URL(draft.sourceUrl)
      if (parsed.protocol !== "https:") throw new Error()
    } catch {
      setError("IMAGE_SOURCE_HTTPS_URL_REQUIRED")
      return
    }
    if (
      !draft.assetHash.trim() ||
      !/^sha256:[0-9a-f]{64}$/.test(draft.assetHash.trim())
    ) {
      setError("IMAGE_ASSET_SHA256_REQUIRED")
      return
    }
    const order = nullableInteger(draft.order)
    if (order === null || order < 1) {
      setError("IMAGE_ORDER_POSITIVE_INTEGER_REQUIRED")
      return
    }
    if (
      ["APPROVED", "REJECTED"].includes(draft.status) &&
      !draft.reviewer.trim()
    ) {
      setError("IMAGE_REVIEWER_REQUIRED")
      return
    }
    if (draft.status === "REJECTED" && !draft.reason.trim()) {
      setError("IMAGE_REJECTION_REASON_REQUIRED")
      return
    }
    const reviewedAt = new Date().toISOString()
    setRunnerTimestamp(reviewedAt)
    setImageApprovals((current) => [
      ...current,
      {
        evidenceId: null,
        sourceKind: draft.sourceKind,
        sourceUrl: draft.sourceUrl.trim(),
        assetHash: draft.assetHash.trim() as `sha256:${string}`,
        purpose: draft.purpose.trim(),
        role: draft.role,
        order,
        variantId: draft.variantId.trim() || null,
        packQuantity: nullableInteger(draft.packQuantity),
        humanNotes: draft.humanNotes.trim() || null,
        status: draft.status,
        reviewer: draft.reviewer.trim() || null,
        reviewedAt: ["APPROVED", "REJECTED"].includes(draft.status)
          ? reviewedAt
          : null,
        reason: draft.reason.trim() || null,
        qa: {
          productAndVariantMatch: draft.productAndVariantMatch,
          packQuantityMatch: draft.packQuantityMatch,
          logosAndIpReviewed: draft.logosAndIpReviewed,
          claimsReviewed: draft.claimsReviewed,
          ebayRoleCoherent: draft.ebayRoleCoherent,
        },
      },
    ])
    setNewImageDraft(emptyImageApprovalDraft)
    setNotice(
      "Metadatos de imagen registrados sólo en memoria; el asset no fue cargado ni descargado.",
    )
  }

  async function registerVisualObservation() {
    setError("")
    setNotice("")
    const draft = visualObservationDraft
    if (
      !draft.imageId.trim() ||
      !draft.humanReason.trim()
    ) {
      setError("VISUAL_OBSERVATION_IMAGE_AND_OBSERVATION_REQUIRED")
      return
    }
    if (draft.sourceUrl.trim()) {
      try {
        const parsed = new URL(draft.sourceUrl)
        if (parsed.protocol !== "https:") throw new Error()
      } catch {
        setError("VISUAL_OBSERVATION_HTTPS_SOURCE_REQUIRED_WHEN_PROVIDED")
        return
      }
    }
    const reviewedAt = new Date().toISOString()
    const possibleConflicts = splitLines(draft.possibleConflicts)
    try {
      const editingObservation = editingVisualObservationEvidenceId
        ? imageAnalysis.observations.find((observation) =>
            observation.evidenceId === editingVisualObservationEvidenceId
          ) ?? null
        : null
      const visualRecord = await createHumanVisualReviewRecord({
        document: productCase,
        replaceEvidenceId: editingVisualObservationEvidenceId,
        imageId: draft.imageId.trim(),
        sourceUrl: draft.sourceUrl.trim() || null,
        sourceReference: draft.sourceReference.trim() ||
          `MANUAL_IMAGE_REFERENCE:${draft.imageId.trim()}`,
        reviewerType: draft.reviewerType,
        observedProductType: draft.observedProductType.trim() || null,
        visibleFeatures: splitLines(draft.visibleFeatures),
        visibleText: splitLines(draft.visibleText),
        visibleBrands: splitLines(draft.visibleBrands),
        visibleColors: splitLines(draft.visibleColors),
        visibleQuantity: nullableInteger(draft.visibleQuantity),
        observedVariant: draft.observedVariant.trim() || null,
        possibleConflicts,
        contradictsEvidenceIds: draft.contradictsEvidenceIds,
        confidence: draft.confidence,
        humanDecision: draft.humanDecision,
        humanReason: draft.humanReason.trim(),
        reviewedAt,
        rawHumanInput: {
          imageId: draft.imageId,
          sourceUrl: draft.sourceUrl,
          sourceReference: draft.sourceReference,
          observedProductType: draft.observedProductType,
          visibleFeatures: draft.visibleFeatures,
          visibleText: draft.visibleText,
          visibleBrands: draft.visibleBrands,
          visibleColors: draft.visibleColors,
          visibleQuantity: draft.visibleQuantity,
          observedVariant: draft.observedVariant,
          possibleConflicts: draft.possibleConflicts,
          confidence: draft.confidence,
          humanDecision: draft.humanDecision,
          humanReason: draft.humanReason,
        },
      })
      setEvidence(visualRecord.updatedDocument.evidence)
      setCaptures(visualRecord.updatedDocument.captures)
      setImageAnalysis(visualRecord.updatedDocument.imageAnalysis)
      setIdentityReviewState(visualRecord.updatedDocument.identityReview)
      setSupplierCatalogLimitation(
        visualRecord.updatedDocument.supplierCatalogLimitation,
      )
      setMarketEvidence(visualRecord.updatedDocument.marketEvidence)
      setGeneratedPackage(null)
      setRunnerTimestamp(reviewedAt)
      setVisualObservationDraft({ ...emptyVisualObservationDraft })
      setEditingVisualObservationEvidenceId(null)
      setVisualReviewFilter("ALL")
      setVisualReviewQuery("")
      setHighlightedVisualReviewEvidenceId(null)
      setVisualReviewReturnTarget(null)
      setActivePhaseIndex(null)
      if (visualReviewHighlightTimeoutRef.current) {
        clearTimeout(visualReviewHighlightTimeoutRef.current)
        visualReviewHighlightTimeoutRef.current = null
      }
      setNotice(
        editingObservation ||
          imageAnalysis.observations.some((entry) =>
            entry.imageId.trim() === draft.imageId.trim()
          )
          ? "Revisión visual humana actualizada en memoria. Seller OS no ejecutó machine vision."
          : "Revisión visual humana agregada en memoria. Seller OS no ejecutó machine vision.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "HUMAN_VISUAL_REVIEW_INVALID",
      )
    }
  }

  function editVisualObservation(
    observation: ProductCaseImageObservation,
  ) {
    const currentEvidenceIds = new Set(evidence.map((entry) => entry.id))
    const draft = visualObservationDraftFrom(observation)
    setError("")
    setNotice(
      observation.contradictsEvidenceIds.some((id) =>
          !currentEvidenceIds.has(id)
        )
        ? "Editando revisión visual: existen referencias Luna stale. Revise y guarde o elimine humanamente la tarjeta."
        : "Editando revisión visual humana en memoria.",
    )
    setEditingVisualObservationEvidenceId(observation.evidenceId)
    setVisualReviewReturnTarget((current) =>
      current?.observationEvidenceId === observation.evidenceId
        ? current
        : {
            observationEvidenceId: observation.evidenceId,
            anchorId: isVisualReviewPending(observation)
              ? visualReviewIssueAnchorFor(observation)
              : visualReviewCardAnchorFor(observation),
          }
    )
    setVisualObservationDraft({
      ...draft,
      contradictsEvidenceIds: draft.contradictsEvidenceIds.filter((id) =>
        currentEvidenceIds.has(id)
      ),
    })
    window.requestAnimationFrame(() => {
      const firstField = document.getElementById("phase3-visual-image-id")
      firstField?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      })
      window.requestAnimationFrame(() => {
        firstField?.focus({ preventScroll: true })
      })
    })
  }

  function cancelVisualObservationEdit() {
    setEditingVisualObservationEvidenceId(null)
    setVisualObservationDraft({ ...emptyVisualObservationDraft })
    setVisualReviewReturnTarget(null)
    setNotice("Edición visual cancelada; no se modificó la revisión.")
  }

  function deleteVisualObservation(
    observation: ProductCaseImageObservation,
  ) {
    const updatedDocument = deleteHumanVisualReviewRecord({
      document: productCase,
      imageId: observation.imageId,
    })
    setEvidence(updatedDocument.evidence)
    setCaptures(updatedDocument.captures)
    setImageAnalysis(updatedDocument.imageAnalysis)
    setIdentityReviewState(updatedDocument.identityReview)
    setSupplierCatalogLimitation(
      updatedDocument.supplierCatalogLimitation,
    )
    setMarketEvidence(updatedDocument.marketEvidence)
    setGeneratedPackage(null)
    if (
      editingVisualObservationEvidenceId === observation.evidenceId
    ) {
      setEditingVisualObservationEvidenceId(null)
      setVisualObservationDraft({ ...emptyVisualObservationDraft })
      setVisualReviewReturnTarget(null)
    } else if (
      visualReviewReturnTarget?.observationEvidenceId ===
        observation.evidenceId
    ) {
      setVisualReviewReturnTarget(null)
    }
    const changedAt = new Date().toISOString()
    setRunnerTimestamp(changedAt)
    setNotice(
      "Revisión visual humana eliminada de la memoria actual; export/import conserva únicamente el estado vigente.",
    )
  }

  function toggleHumanIdentityEvidenceId(
    selectedEvidenceId: string,
    selected: boolean,
  ) {
    setHumanIdentityReviewDraft((current) => ({
      ...current,
      evidenceIds: selected
        ? [...new Set([...current.evidenceIds, selectedEvidenceId])]
        : current.evidenceIds.filter((id) => id !== selectedEvidenceId),
    }))
  }

  function showHumanIdentityReviewError(message: string) {
    setHumanIdentityReviewError(message)
    window.requestAnimationFrame(() => {
      humanIdentityReviewErrorRef.current?.focus()
    })
  }

  async function saveHumanIdentityReview() {
    setHumanIdentityReviewError("")
    setNotice("")
    const draft = humanIdentityReviewDraft
    if (!draft.reviewer.trim() || !draft.humanReason.trim()) {
      showHumanIdentityReviewError(
        "HUMAN_IDENTITY_REVIEW_REVIEWER_AND_REASON_REQUIRED",
      )
      return
    }
    if (draft.evidenceIds.length === 0) {
      showHumanIdentityReviewError(
        "HUMAN_IDENTITY_REVIEW_EVIDENCE_REQUIRED",
      )
      return
    }
    const reviewedAt = new Date().toISOString()
    const rawHumanInput = humanIdentityRawInputForSave(
      draft,
      humanIdentityReviewDraftBaseline,
      humanIdentityRawInputSnapshot,
    )
    try {
      const result = await saveHumanIdentityReviewRecord({
        document: productCase,
        reviewer: draft.reviewer.trim(),
        reviewedAt,
        decision: draft.decision,
        confidence: draft.confidence,
        humanReason: draft.humanReason.trim(),
        evidenceIds: [...draft.evidenceIds],
        sameGeneralProductTypeConfirmed:
          draft.sameGeneralProductTypeConfirmed,
        productType: draft.productType.trim() || null,
        exactIdentityConfirmed: draft.exactIdentityConfirmed,
        brandConfirmed: draft.brandConfirmed,
        brand: draft.brand.trim() || null,
        model: draft.model.trim() || null,
        mpn: draft.mpn.trim() || null,
        supplierProductId: draft.supplierProductId.trim() || null,
        supplierSku: draft.supplierSku.trim() || null,
        variantId: draft.variantId.trim() || null,
        color: draft.color.trim() || null,
        packQuantity: nullableInteger(draft.packQuantity),
        physicalProductVerified: draft.physicalProductVerified,
        physicalVerificationEvidenceIds:
          [...draft.physicalVerificationEvidenceIds],
        rawHumanInput,
      })
      setIdentityReviewState(result.updatedDocument.identityReview)
      setSupplierCatalogLimitation(
        result.updatedDocument.supplierCatalogLimitation,
      )
      setMarketEvidence(result.updatedDocument.marketEvidence)
      setGeneratedPackage(null)
      setRunnerTimestamp(reviewedAt)
      setEditingHumanIdentityReview(false)
      setNotice(
        "Revisión humana de identidad guardada localmente. Identidad, readiness y handoff continúan fail-closed.",
      )
    } catch (caught) {
      showHumanIdentityReviewError(
        caught instanceof Error
          ? caught.message
          : "HUMAN_IDENTITY_REVIEW_INVALID",
      )
    }
  }

  function editHumanIdentityReview() {
    const nextDraft = humanIdentityReviewDraftFrom(identityReviewState)
    setHumanIdentityReviewDraft(nextDraft)
    setHumanIdentityReviewDraftBaseline(
      cloneHumanIdentityReviewDraft(nextDraft),
    )
    setHumanIdentityRawInputSnapshot(
      humanIdentityRawInputFrom(identityReviewState),
    )
    setHumanIdentityReviewError("")
    setEditingHumanIdentityReview(true)
    setNotice("Editando revisión humana de identidad en memoria.")
    window.requestAnimationFrame(() => {
      focusProductCaseTarget(
        "phase-4-identity-and-variants",
        "phase4-identity-reviewer",
      )
    })
  }

  function deleteHumanIdentityReview() {
    setHumanIdentityReviewError("")
    const updatedDocument = deleteHumanIdentityReviewRecord({
      document: productCase,
    })
    setIdentityReviewState(updatedDocument.identityReview)
    setSupplierCatalogLimitation(
      updatedDocument.supplierCatalogLimitation,
    )
    setMarketEvidence(updatedDocument.marketEvidence)
    setGeneratedPackage(null)
    setRunnerTimestamp(new Date().toISOString())
    setNotice(
      "Revisión humana de identidad eliminada localmente; readiness, paquete y handoff permanecen bloqueados.",
    )
  }

  async function saveSupplierCatalogLimitation() {
    setSupplierCatalogLimitationError("")
    setNotice("")
    const draft = supplierCatalogLimitationDraft
    const identityEvidenceIds = strings(
      savedHumanIdentityReview.evidenceIds,
    )
    const reviewedAt = new Date().toISOString()
    try {
      const result = await saveSupplierCatalogLimitationRecord({
        document: productCase,
        reviewer: draft.reviewer,
        reviewedAt,
        humanReason: draft.humanReason,
        catalogExhaustionConfirmed:
          draft.catalogExhaustionConfirmed,
        evidenceIds: identityEvidenceIds,
        rawHumanInput: {
          reviewer: draft.reviewer,
          humanReason: draft.humanReason,
          catalogExhaustionConfirmed:
            draft.catalogExhaustionConfirmed,
          evidenceIds: [...identityEvidenceIds].sort(),
        },
      })
      setSupplierCatalogLimitation(
        result.updatedDocument.supplierCatalogLimitation,
      )
      setMarketEvidence(result.updatedDocument.marketEvidence)
      setSupplierCatalogLimitationDraft(
        emptySupplierCatalogLimitationDraft,
      )
      setRunnerTimestamp(reviewedAt)
      setGeneratedPackage(null)
      setNotice(
        "Declaración guardada localmente. Se habilita sólo investigación manual de comparables generales; identidad exacta, estrategia, package, publicación y handoff continúan bloqueados.",
      )
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "SUPPLIER_CATALOG_LIMITATION_INVALID"
      setSupplierCatalogLimitationError(message)
      window.requestAnimationFrame(() => {
        document.getElementById("supplier-catalog-limitation-error")
          ?.focus()
      })
    }
  }

  function deleteSupplierCatalogLimitation() {
    const updatedDocument = deleteSupplierCatalogLimitationRecord({
      document: productCase,
    })
    setSupplierCatalogLimitation(
      updatedDocument.supplierCatalogLimitation,
    )
    setMarketEvidence(updatedDocument.marketEvidence)
    setGeneratedPackage(null)
    setRunnerTimestamp(new Date().toISOString())
    setNotice(
      "Declaración eliminada del estado activo y conservada sólo para auditoría; Fase 5 vuelve a quedar bloqueada.",
    )
  }

  function reviewMissingIdentityEvidence() {
    setActivePhaseIndex(1)
    focusProductCaseTarget(
      "phase-2-evidence-review",
      "evidence-review-heading",
    )
  }

  function captureGeneralComparable() {
    setError("")
    setNotice("")
    try {
      if (readiness.researchEligibility !== "ALLOWED_WITH_LIMITATIONS") {
        throw new Error("LIMITED_MARKET_RESEARCH_NOT_ELIGIBLE")
      }
      const optionalMoney = (raw: string) => {
        if (!raw.trim()) return null
        const value = Number(raw)
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("GENERAL_PRODUCT_COMPARABLE_MONEY_INVALID")
        }
        return value
      }
      const observedAt = new Date().toISOString()
      const candidate = createGeneralProductComparableCandidate({
        sourceReference: generalComparableDraft.sourceReference,
        ebayUrl: generalComparableDraft.ebayUrl || null,
        observedTitle: generalComparableDraft.observedTitle,
        observedPriceApprox: optionalMoney(
          generalComparableDraft.observedPriceApprox,
        ),
        observedShippingApprox: optionalMoney(
          generalComparableDraft.observedShippingApprox,
        ),
        currency: generalComparableDraft.currency,
        condition: generalComparableDraft.condition,
        listingStatus: generalComparableDraft.listingStatus,
        observedAt,
      })
      setMarketEvidence((current) => ({
        ...current,
        runStatus: "NOT_VALIDATED",
        humanSuppliedComparableCandidates: [
          ...current.humanSuppliedComparableCandidates,
          candidate,
        ],
        observedAt,
      }))
      setGeneralComparableDraft(emptyGeneralComparableDraft)
      setRunnerTimestamp(observedAt)
      setNotice(
        "Comparable general capturado sólo en memoria local; no se consultó eBay ni se afirmó coincidencia exacta.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "GENERAL_PRODUCT_COMPARABLE_CAPTURE_INVALID",
      )
    }
  }

  function recordHumanConclusion() {
    setError("")
    if (!humanConclusion || !humanReason.trim() || !humanReviewer.trim()) {
      setError("HUMAN_CONCLUSION_REASON_AND_REVIEWER_REQUIRED")
      return
    }
    const reviewedAt = new Date().toISOString()
    setHumanReviewedAt(reviewedAt)
    setRunnerTimestamp(reviewedAt)
    setNotice(
      "Conclusión humana registrada localmente y separada de la conclusión del OS.",
    )
  }

  function commitComparableReview(
    candidate: ProductCaseDocument["marketEvidence"]["humanSuppliedComparableCandidates"][number],
    index: number,
  ) {
    setError("")
    setNotice("")
    const key = `${candidate.ebayItemId ?? candidate.sourceReference}-${index}`
    const draft = comparableReviewDrafts[key] ??
      emptyComparableReviewDraft
    try {
      if (
        readiness.comparisonMode ===
          "GENERAL_PRODUCT_COMPARABLES_ONLY" &&
        draft.decision === "VALIDATE_ACTIVE_EXACT"
      ) {
        throw new Error(
          "GENERAL_PRODUCT_COMPARABLE_CANNOT_BECOME_EXACT_MATCH",
        )
      }
      const reviewedAt = new Date().toISOString()
      const reviewed = reviewHumanComparableCandidate(candidate, {
        decision: draft.decision,
        reason: draft.reason,
        reviewer: draft.reviewer,
        reviewedAt,
        identityVisualMatch: draft.identityVisualMatch,
        variantMatch: draft.variantMatch,
        contentsMatch: draft.contentsMatch,
        packQuantityMatch: draft.packQuantityMatch,
        validatedTitle: draft.validatedTitle.trim() || null,
        validatedPackQuantity:
          nullableInteger(draft.validatedPackQuantity),
        validatedVariantComposition:
          splitLines(draft.validatedVariantComposition),
        buyerShipping: nullableNumber(draft.buyerShipping),
        reasonCodes: splitLines(draft.reasonCodes),
      })
      setMarketEvidence((current) => {
        const candidates =
          current.humanSuppliedComparableCandidates.map(
            (entry, candidateIndex) =>
              candidateIndex === index ? reviewed : entry,
          )
        const exactCandidates = candidates.filter((entry) =>
          entry.comparisonClass === "EXACT_PRODUCT_MATCH"
        )
        return {
          ...current,
          activeExact: exactCandidates.some((entry) =>
              entry.validationStatus === "VALIDATED_ACTIVE_EXACT"
            )
            ? "AVAILABLE"
            : exactCandidates.length
              ? "NOT_VALIDATED"
              : "MISSING",
          humanSuppliedComparableCandidates: candidates,
          observedAt: reviewedAt,
        }
      })
      setRunnerTimestamp(reviewedAt)
      setNotice(
        reviewed.validationStatus === "VALIDATED_ACTIVE_EXACT"
          ? "Comparable validado por humano únicamente como ACTIVE_EXACT; nunca se convirtió en SOLD_EXACT."
          : "Revisión humana del candidato registrada localmente; no se consultó ni modificó eBay.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "COMPARABLE_HUMAN_REVIEW_INVALID",
      )
    }
  }

  function applyEconomicsPolicyJson() {
    setError("")
    try {
      const parsed: unknown = JSON.parse(economicsPolicyJson)
      if (parsed !== null) {
        const policy = record(parsed)
        const numericFields = [
          "feeRate",
          "fixedOrderFee",
          "returnsReserveRate",
          "promotedListingsReserveRate",
          "minimumProfit",
          "minimumMarginPercent",
          "minimumRoiPercent",
        ]
        if (
          typeof policy.version !== "string" ||
          numericFields.some((field) =>
            typeof policy[field] !== "number" ||
            !Number.isFinite(policy[field]) ||
            Number(policy[field]) < 0
          )
        ) {
          throw new Error("ECONOMICS_POLICY_JSON_INVALID")
        }
      }
      const nextPolicy = parsed as Parameters<
        typeof buildStrategyLabAdapterPreview
      >[0]["economicsPolicy"]
      buildStrategyLabAdapterPreview({
        document: productCase,
        evaluatedAt: runnerTimestamp,
        economicsPolicy: nextPolicy,
        scenarioDraft,
      })
      setEconomicsPolicy(nextPolicy)
      setRunnerTimestamp(new Date().toISOString())
      setNotice(
        "Economics policy validada y aplicada sólo al estado local del Runner.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "ECONOMICS_POLICY_JSON_INVALID",
      )
    }
  }

  function applyScenarioDraftJson() {
    setError("")
    try {
      const parsed: unknown = JSON.parse(scenarioDraftJson)
      if (parsed !== null) {
        const scenario = record(parsed)
        const validOfferScenarios = [
          "SINGLE",
          "TWO_PACK",
          "THREE_PACK",
          "MIXED_VARIANT_BUNDLE",
        ]
        const requiredStrings = [
          "id",
          "packQuantityEvidenceId",
          "packagingCostEvidenceId",
          "outboundShippingCostEvidenceId",
          "listingPriceEvidenceId",
          "buyerShippingChargeEvidenceId",
        ]
        if (
          !validOfferScenarios.includes(text(scenario.offerScenario, "")) ||
          requiredStrings.some((field) =>
            typeof scenario[field] !== "string" ||
            !String(scenario[field]).trim()
          ) ||
          !Array.isArray(scenario.variantComposition) ||
          !Array.isArray(scenario.costLines) ||
          !Array.isArray(scenario.requiredIdentityFields) ||
          !Array.isArray(scenario.requiredDimensionFields) ||
          typeof scenario.requiresExactSoldEvidence !== "boolean" ||
          !Object.keys(record(scenario.creativeSeed)).length
        ) {
          throw new Error("SCENARIO_DRAFT_JSON_INVALID")
        }
      }
      const nextScenario = parsed as Parameters<
        typeof buildStrategyLabAdapterPreview
      >[0]["scenarioDraft"]
      buildStrategyLabAdapterPreview({
        document: productCase,
        evaluatedAt: runnerTimestamp,
        economicsPolicy,
        scenarioDraft: nextScenario,
      })
      setScenarioDraft(nextScenario)
      setRunnerTimestamp(new Date().toISOString())
      setNotice(
        "Scenario draft validado y aplicado sólo al estado local del Runner.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "SCENARIO_DRAFT_JSON_INVALID",
      )
    }
  }

  async function importProductCaseJson(
    rawJson: string,
    source: ProductCaseImportRoundtrip["source"],
  ) {
    const importGeneration = importReadGenerationRef.current
    setError("")
    setImportInlineError("")
    setImportMismatchPaths([])
    setNotice("")
    setWorkspaceExportError("")
    try {
      const importedResult = await importProductCaseWorkspaceExport(rawJson)
      if (importReadGenerationRef.current !== importGeneration) return
      const importedEnvelope = record(importedResult.importedEnvelope)
      const importedWorkspace = importedResult.workspaceState
      const importedDocument = importedWorkspace.document
      const importedDocumentRecord = record(importedDocument)
      const importedUrl = importedDocument.sourceUrl
      if (
        !text(importedDocumentRecord.caseId, "") ||
        !text(importedDocumentRecord.productLabel, "") ||
        !text(importedDocumentRecord.createdAt, "")
      ) {
        throw new Error("PRODUCT_CASE_IMPORT_IDENTITY_METADATA_INVALID")
      }
      const importedUrlValidation = validateLunaProductUrl(importedUrl)
      if (!importedUrlValidation.valid) {
        throw new Error("PRODUCT_CASE_IMPORT_SOURCE_URL_INVALID")
      }
      const importedOutput = record(importedEnvelope.output)
      const rebuiltOutput = importedResult.rebuiltOutput
      const rebuiltOperationalPipeline = rows(
        rebuiltOutput.operationalPipeline,
      )
      const validStatuses = new Set([
        "NOT_STARTED",
        "IN_PROGRESS",
        "HUMAN_REVIEW_REQUIRED",
        "BLOCKED",
        "COMPLETED",
      ])
      for (
        const [position, phase] of
          PRODUCT_CASE_OPERATIONAL_PHASES.entries()
        ) {
        const rebuiltPhase = rebuiltOperationalPipeline[position]
        if (
          rebuiltOperationalPipeline.length !==
            PRODUCT_CASE_OPERATIONAL_PHASES.length ||
          rebuiltPhase?.phase !== phase ||
          !validStatuses.has(text(rebuiltPhase?.status, ""))
        ) {
          throw new Error(
            `PRODUCT_CASE_OPERATIONAL_PHASE_${phase}_INVALID`,
          )
        }
      }
      const workspaceDeepEquivalent =
        JSON.stringify(record(importedEnvelope.workspaceState)) ===
          JSON.stringify(importedWorkspace)
      const outputDeepEquivalent =
        JSON.stringify(importedOutput) === JSON.stringify(rebuiltOutput)
      const canonicalJson = JSON.stringify(
        createProductCaseWorkspaceExport({
          workspaceState: importedWorkspace,
          exportedAt: text(
            importedEnvelope.exportedAt,
            new Date().toISOString(),
          ),
        }),
        null,
        2,
      )
      const canonicalJsonBytes = byteLength(canonicalJson)
      const canonicalJsonWithinExportLimit =
        canonicalJsonBytes <= PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES
      const importedHumanReview = record(
        importedDocumentRecord.humanReview,
      )
      const importedHumanConclusion = record(
        importedHumanReview.conclusion,
      )
      setFixtureActive(false)
      setSourceUrl(importedUrlValidation.canonicalUrl)
      setCaseId(text(importedDocumentRecord.caseId, ""))
      setProductLabel(text(importedDocumentRecord.productLabel, ""))
      setCaseCreatedAt(text(importedDocumentRecord.createdAt, ""))
      setRunnerTimestamp(importedWorkspace.evaluatedAt)
      setPreflight(null)
      setImportedSourceAccess(
        structuredClone(
          importedDocument.sourceAccess,
        ),
      )
      setSupplierSourceCapture(
        structuredClone(importedDocument.supplierSourceCapture ?? null),
      )
      setManualContent(
        importedDocument.supplierSourceCapture?.rawVisibleSourceText ?? "",
      )
      setHumanVisibleProductTextConfirmed(
        importedDocument.supplierSourceCapture
          ?.humanVisibleProductTextConfirmed === true,
      )
      setCaptures(structuredClone(importedDocument.captures))
      setEvidence(structuredClone(importedDocument.evidence))
      setMarketEvidence(structuredClone(importedDocument.marketEvidence))
      setImageAnalysis(structuredClone(importedDocument.imageAnalysis))
      setIdentityReviewState(
        structuredClone(importedDocument.identityReview),
      )
      setSupplierCatalogLimitation(
        structuredClone(importedDocument.supplierCatalogLimitation),
      )
      setSupplierCatalogLimitationDraft(
        emptySupplierCatalogLimitationDraft,
      )
      setSupplierCatalogLimitationError("")
      setEconomicsPolicy(importedWorkspace.economicsPolicy)
      setScenarioDraft(importedWorkspace.scenarioDraft)
      setEconomicsPolicyJson(
        JSON.stringify(importedWorkspace.economicsPolicy, null, 2),
      )
      setScenarioDraftJson(
        JSON.stringify(importedWorkspace.scenarioDraft, null, 2),
      )
      setReviewDrafts({})
      setAppliedReviewDecisions({})
      setComparableReviewDrafts({})
      setGeneralComparableDraft(emptyGeneralComparableDraft)
      setHumanConclusion(text(importedHumanConclusion.conclusion, ""))
      setHumanScenario(text(importedHumanConclusion.scenario, ""))
      setHumanReason(text(importedHumanConclusion.reason, ""))
      setHumanReviewer(text(importedHumanConclusion.reviewer, ""))
      setHumanReviewedAt(
        text(importedHumanConclusion.reviewedAt, "") || null,
      )
      setProposedRuleObservation(
        text(importedHumanReview.proposedRuleObservation, ""),
      )
      setImageApprovals(structuredClone(importedWorkspace.imageApprovals))
      setImageApprovalDrafts({})
      setNewImageDraft({ ...emptyImageApprovalDraft })
      setVisualObservationDraft({ ...emptyVisualObservationDraft })
      setEditingVisualObservationEvidenceId(null)
      setVisualReviewFilter("ALL")
      setVisualReviewQuery("")
      setHighlightedVisualReviewEvidenceId(null)
      setVisualReviewReturnTarget(null)
      setActivePhaseIndex(null)
      if (visualReviewHighlightTimeoutRef.current) {
        clearTimeout(visualReviewHighlightTimeoutRef.current)
        visualReviewHighlightTimeoutRef.current = null
      }
      setListingOperations(
        structuredClone(importedWorkspace.listingOperations),
      )
      setGeneratedPackage(null)
      setImportRequiresHumanReReview(true)
      setLegacyImportAudit(
        importedWorkspace.legacyImportAudit
          ? structuredClone(importedWorkspace.legacyImportAudit)
          : null,
      )
      setHistoricalHumanIdentityReviewAudit(
        importedWorkspace.historicalHumanIdentityReviewAudit
          ? structuredClone(
              importedWorkspace.historicalHumanIdentityReviewAudit,
            )
          : null,
      )
      setImportJson(canonicalJson)
      setImportRoundtrip({
        source,
        imported: importedEnvelope,
        rebuilt: record(rebuiltOutput),
        historicalOutputAudit: importedResult.historicalOutputAudit
          ? record(importedResult.historicalOutputAudit)
          : null,
        canonicalJson,
        canonicalJsonBytes,
        canonicalJsonWithinExportLimit,
        domainValidated: true,
        workspaceDeepEquivalent,
        outputDeepEquivalent,
        importedManualHandoffTrusted:
          importedResult.importedManualHandoffTrusted,
        legacyOutputRebuilt: importedResult.legacyOutputRebuilt,
        importWarnings: [...importedResult.importWarnings],
        outputMismatchPaths: importedResult.outputMismatchPaths.length > 0
          ? [...importedResult.outputMismatchPaths]
          : [
              ...(importedResult.historicalOutputAudit
                ?.outputMismatchPaths ?? []),
            ],
        sourceWorkspaceExportVersion:
          importedResult.sourceWorkspaceExportVersion ?? "UNKNOWN",
        currentOutputContractVersion:
          importedResult.currentOutputContractVersion,
        phaseContract:
          "PRODUCT_CASE_OPERATIONAL_PIPELINE_12_PHASES_5_STATUSES",
      })
      const preIdentityOutputRebuilt = importedResult.importWarnings.includes(
        "PRE_IDENTITY_CONTRACT_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
      )
      setNotice(
        importedResult.historicalOutputAudit
          ? `${importedResult.importWarnings.join(" · ")}. El output histórico se conserva sólo para auditoría; identidad, readiness, paquete y handoff permanecen bloqueados.`
          : preIdentityOutputRebuilt
          ? "PRE_IDENTITY_CONTRACT_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN. El output anterior no se reutilizó: el dominio actual lo reconstruyó completamente en modo fail-closed; identidad, readiness, paquete y handoff permanecen bloqueados."
          : importedResult.visualReviewCorrectionRequired
          ? `PRODUCT CASE importado sin corregir datos legacy. Corrección humana obligatoria: ${importedResult.visualReviewContractIssues.join(" · ")}`
          : "PRODUCT CASE JSON importado, validado por el dominio y conservado sólo en memoria del navegador.",
      )
    } catch (caught) {
      if (importReadGenerationRef.current !== importGeneration) return
      const importError = caught instanceof Error
        ? caught.message
        : "PRODUCT_CASE_IMPORT_INVALID"
      const [errorCode, ...errorDetail] = importError.split(":")
      const diagnosticPaths =
        errorCode === "PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH"
          ? errorDetail.join(":").split(" · ").filter((path) =>
              /^output(?:\.|\[|$)/.test(path) &&
              !path.includes("REDACTED_KEY")
            )
          : []
      setImportMismatchPaths(diagnosticPaths)
      setImportInlineError(errorCode)
      setError(importError)
    }
  }

  async function importProductCaseFile(
    file: File | null,
  ) {
    const readGeneration = ++importReadGenerationRef.current
    if (!file) {
      setSelectedImportFile(null)
      setImportReadStatus("IDLE")
      return
    }
    setSelectedImportFile(file)
    setImportInputSource("FILE")
    setImportReadStatus("READING")
    setImportInlineError("")
    setImportMismatchPaths([])
    setError("")
    setNotice("")
    setImportRoundtrip(null)
    setWorkspaceExportError("")
    const metadataError = validateProductCaseImportFileMetadata(file)
    if (metadataError) {
      setImportReadStatus("ERROR")
      setImportInlineError(metadataError)
      setError(metadataError)
      return
    }
    try {
      const rawJson = await file.text()
      if (importReadGenerationRef.current !== readGeneration) return
      const candidateError = validateProductCaseImportJsonCandidate(rawJson)
      if (candidateError) {
        setImportReadStatus("ERROR")
        setImportInlineError(candidateError)
        setError(candidateError)
        return
      }
      setImportJson(rawJson)
      setImportReadStatus("READY")
      setNotice(
        `Archivo listo para validar: ${file.name} (${file.size.toLocaleString()} bytes).`,
      )
    } catch {
      if (importReadGenerationRef.current !== readGeneration) return
      const readError = "PRODUCT_CASE_IMPORT_FILE_READ_FAILED"
      setImportReadStatus("ERROR")
      setImportInlineError(readError)
      setError(readError)
    }
  }

  const importJsonCandidateError = useMemo(
    () => validateProductCaseImportJsonCandidate(importJson),
    [importJson],
  )
  const importReady = importReadStatus === "READY" &&
    importJsonCandidateError === null

  async function exportReviewedCase() {
    setWorkspaceExportError("")
    try {
      const exportedAt = new Date().toISOString()
      const refreshedWorkspaceState =
        await refreshProductCaseLegacyImportAuditForExport({
          workspaceState: {
            document: productCase,
            evaluatedAt: runnerTimestamp,
            generatedAt: runnerTimestamp,
            economicsPolicy,
            scenarioDraft,
            imageApprovals,
            imageObservations: imageAnalysis.observations,
            listingOperations,
            ...(legacyImportAudit
              ? { legacyImportAudit: structuredClone(legacyImportAudit) }
              : {}),
            ...(historicalHumanIdentityReviewAudit
              ? {
                  historicalHumanIdentityReviewAudit: structuredClone(
                    historicalHumanIdentityReviewAudit,
                  ),
                }
              : {}),
          },
          exportedAt,
        })
      setLegacyImportAudit(
        refreshedWorkspaceState.legacyImportAudit
          ? structuredClone(refreshedWorkspaceState.legacyImportAudit)
          : null,
      )
      const serialized = serializeProductCaseWorkspaceExport({
        workspaceState: refreshedWorkspaceState,
        exportedAt,
      })
      downloadJson(
        `${text(productCase.caseId, "product-case")}.json`,
        serialized,
      )
    } catch (caught) {
      const exportError = caught instanceof Error
        ? caught.message
        : "PRODUCT_CASE_EXPORT_FAILED"
      setWorkspaceExportError(
        exportError === "PRODUCT_CASE_EXPORT_TOO_LARGE"
          ? `${exportError}: la representación V3 auditada supera el límite de ${PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES.toLocaleString()} bytes. El workspace reconstruido y su audit histórico permanecen intactos en memoria; no se generó ni descargó una copia incompleta.`
          : exportError,
      )
    }
  }

  function exportRegistrationDraft() {
    downloadJson(
      "MANUAL_LISTING_REGISTRATION_DRAFT.json",
      JSON.stringify({
        documentType: "MANUAL_LISTING_REGISTRATION_DRAFT",
        ...registrationDraft,
      }, null, 2),
    )
  }

  function generateManualPackage() {
    if (!manualHandoffAllowed || !packageGenerated) return
    setGeneratedPackage(listingPackage)
    setNotice(
      "Paquete local generado para handoff humano. No se ejecutó ninguna llamada a marketplace.",
    )
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-40 pt-6 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[32px] border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.11] via-violet-200/[0.04] to-black p-5 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href="/admin/ebay/strategy-lab"
              className={`inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm font-black ${buttonFocus}`}
            >
              ← Strategy Lab
            </a>
            <span className="rounded-full border border-amber-200/30 bg-amber-200/[0.06] px-3 py-2 text-xs font-black text-amber-50">
              READ-ONLY · BROWSER STATE ONLY
            </span>
          </div>
          <p className="mt-7 text-xs font-black uppercase tracking-[0.25em] text-cyan-100/55">
            Single Product Lab · Product Case Runner V1
          </p>
          <h1 className="mt-2 max-w-4xl text-3xl font-black leading-tight sm:text-5xl">
            {productLabel}
          </h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-white/65">
            Captura evidencia visible de Luna Portex, conserva su procedencia y
            decide campo por campo. Nada se publica, enlaza, aprende o persiste
            automáticamente.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Supabase writes", 0],
              ["eBay writes", 0],
              ["OpenAI calls", 0],
              ["WhatsApp calls", 0],
              ["Image downloads", 0],
              ["Server persistence", 0],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3"
              >
                <p className="break-words text-[10px] font-black uppercase tracking-wider text-emerald-100/50">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-black text-emerald-100">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </header>

        <section
          aria-labelledby="product-case-import-heading"
          className="mt-4 rounded-[32px] border border-violet-200/20 bg-violet-200/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-100/55">
            Browser-only roundtrip
          </p>
          <h2 id="product-case-import-heading" className="mt-2 text-2xl font-black">
            IMPORTAR PRODUCT CASE JSON
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Importa desde archivo o pega el JSON exportado. Se valida la
            versión, el pipeline operativo exacto de 12 fases y cinco estados,
            los efectos externos en cero y se reconstruye con el dominio. El
            contenido permanece sólo en memoria: no se envía al servidor ni se
            guarda en almacenamiento persistente del navegador.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="grid content-start gap-2 text-xs font-black" htmlFor="product-case-import-file">
              Archivo JSON
              <input
                ref={importFileInputRef}
                id="product-case-import-file"
                type="file"
                accept=".json,application/json,text/json,text/plain"
                onChange={(event) => {
                  void importProductCaseFile(
                    event.currentTarget.files?.[0] ?? null,
                  )
                }}
                className={`${inputClass} py-3 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-100 file:px-3 file:py-2 file:text-xs file:font-black file:text-black`}
              />
              <span className="font-normal text-white/40">
                Máximo {PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES.toLocaleString()} bytes.
              </span>
              <output
                htmlFor="product-case-import-file"
                data-testid="product-case-import-file-selection"
                className="rounded-xl border border-white/10 bg-black/20 p-3 font-normal text-white/70"
                aria-live="polite"
              >
                {selectedImportFile
                  ? `${selectedImportFile.name} · ${selectedImportFile.size.toLocaleString()} bytes · ${importReadStatus}`
                  : "Ningún archivo seleccionado"}
              </output>
              {selectedImportFile &&
              (importReadStatus === "ERROR" ||
                importInputSource === "TEXTAREA") ? (
                <button
                  type="button"
                  data-testid="product-case-import-file-retry"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void importProductCaseFile(selectedImportFile)
                  }}
                  className={`min-h-11 rounded-xl border border-amber-200/30 bg-amber-200/[0.08] px-4 text-xs font-black text-amber-50 ${buttonFocus}`}
                >
                  {importInputSource === "TEXTAREA"
                    ? "VOLVER A CARGAR EL ARCHIVO SELECCIONADO"
                    : "REINTENTAR LECTURA DEL ARCHIVO"}
                </button>
              ) : null}
            </label>
            <label className="grid gap-2 text-xs font-black" htmlFor="product-case-import-json">
              JSON como texto
              <textarea
                id="product-case-import-json"
                value={importJson}
                onChange={(event) => {
                  importReadGenerationRef.current += 1
                  const nextJson = event.target.value
                  const candidateError =
                    validateProductCaseImportJsonCandidate(nextJson)
                  const visibleCandidateError =
                    candidateError === "PRODUCT_CASE_IMPORT_REQUIRED"
                      ? ""
                      : candidateError ?? ""
                  setImportJson(nextJson)
                  setImportInputSource("TEXTAREA")
                  setImportReadStatus(
                    nextJson.trim()
                      ? candidateError === null ? "READY" : "ERROR"
                      : "IDLE",
                  )
                  setImportInlineError(visibleCandidateError)
                  setImportMismatchPaths([])
                  setError(visibleCandidateError)
                  setNotice("")
                  setImportRoundtrip(null)
                }}
                spellCheck={false}
                className={`${textAreaClass} min-h-44`}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() =>
              importProductCaseJson(importJson, importInputSource)}
            disabled={!importReady}
            data-testid="product-case-import-submit"
            className={`mt-4 min-h-12 rounded-2xl border border-violet-200/30 bg-violet-200/[0.08] px-5 text-sm font-black text-violet-50 disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}
          >
            VALIDAR E IMPORTAR EN ESTE NAVEGADOR
          </button>
          {importInlineError && (
            <div
              role="alert"
              data-testid="product-case-import-error"
              className="mt-4 rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50"
            >
              <p>{importInlineError}</p>
              {importMismatchPaths.length > 0 && (
                <div
                  data-testid="product-case-import-mismatch-paths"
                  className="mt-3"
                >
                  <p className="text-xs uppercase tracking-wider opacity-65">
                    Rutas distintas · sólo diagnóstico, sin valores
                  </p>
                  <ol className="mt-2 max-h-56 list-decimal overflow-auto pl-5 font-mono text-[11px] leading-5">
                    {importMismatchPaths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
          {importRoundtrip && (
            <>
              {!importRoundtrip.historicalOutputAudit &&
                importRoundtrip.importWarnings.includes(
                  "PRE_IDENTITY_CONTRACT_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
                ) && (
                <div
                  role="status"
                  data-testid="product-case-pre-identity-output-warning"
                  className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-200/[0.08] p-4 text-amber-50"
                >
                  <p className="text-sm font-black">
                    PRE_IDENTITY_CONTRACT_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN
                  </p>
                  <p className="mt-2 text-xs leading-5 opacity-75">
                    Este export es anterior al contrato canónico de identidad.
                    El output anterior no se reutilizó: fue reconstruido
                    completamente con el dominio actual en modo fail-closed.
                    Identidad, readiness, paquete y handoff permanecen
                    bloqueados hasta una nueva revisión humana.
                  </p>
                  <p className="mt-3 text-xs font-black">
                    {importRoundtrip.sourceWorkspaceExportVersion} →{" "}
                    {importRoundtrip.currentOutputContractVersion}
                  </p>
                  {importRoundtrip.importWarnings.length > 1 && (
                    <ul className="mt-3 grid gap-1 font-mono text-[11px]">
                      {importRoundtrip.importWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {importRoundtrip.historicalOutputAudit && (
                <div
                  data-testid="product-case-legacy-output-warning"
                  className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-200/[0.08] p-4 text-amber-50"
                >
                  <p className="text-sm font-black">
                    LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN
                  </p>
                  <p className="mt-2 text-xs leading-5 opacity-75">
                    El output, paquete y handoff históricos no están activos ni
                    son confiables. El dominio actual reconstruyó el expediente
                    en modo fail-closed y exige corrección/revisión humana.
                  </p>
                  <p className="mt-3 text-xs font-black">
                    {importRoundtrip.sourceWorkspaceExportVersion} →{" "}
                    {importRoundtrip.currentOutputContractVersion}
                  </p>
                  <div
                    id="product-case-legacy-summary"
                    data-testid="visual-review-legacy-summary"
                    tabIndex={-1}
                    className="mt-3 scroll-mt-28 rounded-2xl border border-amber-100/25 bg-black/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-amber-100"
                  >
                    <p
                      aria-live="polite"
                      className="text-sm font-black"
                    >
                      {pendingVisualObservations.length === 1
                        ? "1 revisión visual requiere corrección"
                        : `${pendingVisualObservations.length} revisiones visuales requieren corrección`}
                    </p>
                    {pendingVisualObservations.length > 0 && (
                      <>
                        <ul className="mt-2 grid gap-1 font-mono text-xs">
                          {pendingVisualObservations.map((observation) => (
                            <li
                              key={visualReviewCardAnchorFor(observation)}
                            >
                              {observation.imageId}
                            </li>
                          ))}
                        </ul>
                        <a
                          href="#visual-review-legacy-queue"
                          data-testid="visual-review-review-now"
                          onClick={(event) => {
                            event.preventDefault()
                            focusFirstPendingVisualReview(
                              "product-case-legacy-summary",
                            )
                          }}
                          className={`mt-3 inline-flex min-h-11 items-center rounded-xl border border-amber-100/35 bg-amber-100/10 px-4 text-xs font-black ${buttonFocus}`}
                        >
                          REVISAR AHORA
                        </a>
                      </>
                    )}
                  </div>
                  <details className="mt-3">
                    <summary className={`min-h-11 cursor-pointer text-xs font-black ${buttonFocus}`}>
                      RUTAS DEL OUTPUT HISTÓRICO QUE CAMBIARON ·{" "}
                      {importRoundtrip.outputMismatchPaths.length}
                    </summary>
                    <ol className="mt-2 max-h-64 list-decimal overflow-auto pl-5 font-mono text-[11px] leading-5">
                      {importRoundtrip.outputMismatchPaths.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ol>
                  </details>
                </div>
              )}
              <dl className="mt-4 grid gap-3 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.05] p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-white/45">Source</dt>
                  <dd className="mt-1 font-black">{importRoundtrip.source}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Workspace domain validation</dt>
                  <dd className="mt-1 font-black">PASS</dd>
                </div>
                <div>
                  <dt className="text-white/45">Workspace equivalence</dt>
                  <dd className="mt-1 font-black">
                    {importRoundtrip.workspaceDeepEquivalent
                      ? "DEEP_EQUIVALENT"
                      : "DIFFERENT"}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/45">Rebuilt output equivalence</dt>
                  <dd className="mt-1 font-black">
                    {importRoundtrip.outputDeepEquivalent
                      ? "DEEP_EQUIVALENT"
                      : "REBUILT_DIFFERS_REVIEW_REQUIRED"}
                  </dd>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-white/45">Import trust / phase contract</dt>
                  <dd className="mt-1 font-black">
                    importedManualHandoffTrusted = false ·{" "}
                    {importRoundtrip.phaseContract} ·{" "}
                    {importRoundtrip.canonicalJsonBytes.toLocaleString()} bytes
                    {" · "}
                    {importRoundtrip.canonicalJsonWithinExportLimit
                      ? "V3_EXPORTABLE"
                      : "V3_ACTIVE_IN_MEMORY_OVER_EXPORT_LIMIT"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <JsonPanel
                  label="Historical envelope · audit only · never active"
                  value={importRoundtrip.imported}
                />
                <JsonPanel
                  label="Domain rebuilt output"
                  value={importRoundtrip.rebuilt}
                />
                {importRoundtrip.historicalOutputAudit && (
                  <JsonPanel
                    label="Legacy output audit reference · untrusted"
                    value={importRoundtrip.historicalOutputAudit}
                    className="lg:col-span-2"
                  />
                )}
              </div>
            </>
          )}
        </section>

        <nav
          aria-label="Fases del Product Case"
          className="mt-4 overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.03] p-3"
        >
          <ol className="flex min-w-max gap-2">
            {PRODUCT_CASE_OPERATIONAL_PHASES.map((phase, index) => {
              const snapshot = phaseSnapshots.find((candidate) =>
                candidate.phase === phase
              )
              const status = text(snapshot?.status, "NOT_STARTED")
              const navigationTarget =
                PRODUCT_CASE_PHASE_NAVIGATION_TARGETS[index]
              return (
                <li key={phase}>
                  <a
                    href={`#${navigationTarget.anchorId}`}
                    onClick={(event) =>
                      navigateToProductCasePhase(event, index)}
                    aria-current={
                      activePhaseIndex === index ? "location" : undefined
                    }
                    className={`flex min-h-14 w-48 items-center gap-3 rounded-2xl border px-3 text-left text-xs font-black ${tone(status)} ${buttonFocus}`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-black/20"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{phase}</span>
                      <span className="mt-0.5 block truncate text-[10px] opacity-60">
                        {status}
                      </span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ol>
        </nav>

        <section
          id="source-access"
          aria-labelledby="source-access-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            1. SUPPLIER_SOURCE
          </p>
          <h2
            id="source-access-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Validar origen permitido
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
            Sólo HTTPS, host exacto Luna Portex y una ruta de producto. El
            preflight no usa ni reenvía cookies, contraseñas o sesión de Luna.
          </p>
          <form
            className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              void runPreflight()
            }}
          >
            <label className="grid gap-2 text-sm font-black" htmlFor="source-url">
              URL del producto
              <input
                id="source-url"
                type="url"
                required
                autoComplete="off"
                spellCheck={false}
                value={sourceUrl}
                onChange={(event) => changeSourceUrl(event.target.value)}
                aria-invalid={sourceUrl.length > 0 && !urlValidation.valid}
                aria-describedby="source-url-help"
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={preflightBusy || !urlValidation.valid}
              className={`min-h-12 self-end rounded-2xl bg-cyan-200 px-5 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}
            >
              {preflightBusy
                ? "PREFLIGHT READ-ONLY…"
                : "VALIDAR Y HACER PREFLIGHT"}
            </button>
          </form>
          <p id="source-url-help" className="mt-2 text-xs leading-5 text-white/45">
            {urlValidation.valid
              ? `URL CANÓNICA: ${urlValidation.canonicalUrl}`
              : sourceUrl
                ? urlValidation.error
                : "Pega una URL /products/<handle> de Luna Portex."}
          </p>
          <div className={`mt-4 rounded-2xl border p-4 ${tone(sourceAccess.status)}`}>
            <p className="text-xs font-black uppercase tracking-wider opacity-60">
              Source access status
            </p>
            <p className="mt-1 text-lg font-black">
              {text(sourceAccess.status, "NOT_RUN")}
            </p>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="opacity-50">HTTP</dt><dd className="mt-1 font-black">{display(sourceAccess.httpStatus)}</dd></div>
              <div><dt className="opacity-50">Content type</dt><dd className="mt-1 break-words font-black">{display(preflight?.contentType)}</dd></div>
              <div><dt className="opacity-50">Hash</dt><dd className="mt-1 break-all font-mono">{display(preflight?.contentHash)}</dd></div>
              <div><dt className="opacity-50">Next action</dt><dd className="mt-1 break-words font-black">{text(preflight?.nextAction, "CAPTURE_AUTHENTICATED_SUPPLIER_EVIDENCE")}</dd></div>
            </dl>
          </div>
          {sourceAccess.status === "AUTHENTICATED_SOURCE_REQUIRED" && (
            <div
              data-testid="authenticated-supplier-paste-panel"
              className="mt-5 rounded-3xl border border-cyan-200/30 bg-cyan-200/[0.055] p-4 sm:p-5"
            >
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/60">
                MANUAL_AUTHENTICATED_PASTE · BROWSER ONLY
              </p>
              <p className="mt-2 break-all text-xs font-black text-white/70">
                {text(sourceAccess.canonicalUrl, sourceUrl)}
              </p>
              <label
                className="mt-4 grid gap-2 text-sm font-black"
                htmlFor="authenticated-visible-source-text"
              >
                PEGAR CONTENIDO VISIBLE AUTENTICADO DE LUNA
                <textarea
                  id="authenticated-visible-source-text"
                  data-testid="authenticated-visible-source-text"
                  value={manualContent}
                  onChange={(event) => {
                    setManualContent(event.target.value)
                    setHumanVisibleProductTextConfirmed(false)
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="authenticated-source-warning authenticated-source-size"
                  aria-invalid={
                    manualBytes > PRODUCT_CASE_CONTENT_MAX_BYTES
                  }
                  className={`${textAreaClass} min-h-64`}
                />
              </label>
              <div
                id="authenticated-source-warning"
                role="note"
                className="mt-3 rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4 text-xs leading-6 text-amber-50"
              >
                Pega únicamente texto visible del producto. No pegues ni
                solicites contraseñas, cookies, tokens, HTML completo, datos de
                pago ni información personal de la cuenta. El contenido se
                mantiene sólo en memoria del navegador y entra al Export JSON
                únicamente después de procesarlo.
              </div>
              <label className="mt-3 flex min-h-11 items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/70">
                <input
                  type="checkbox"
                  data-testid="confirm-visible-product-text"
                  checked={humanVisibleProductTextConfirmed}
                  onChange={(event) =>
                    setHumanVisibleProductTextConfirmed(
                      event.target.checked,
                    )}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-200"
                />
                Confirmo que revisé este contenido y contiene únicamente texto
                visible del producto, sin datos de cuenta, autenticación,
                contacto personal ni pago.
              </label>
              <p
                id="authenticated-source-size"
                className={`mt-2 text-right text-xs ${
                  manualBytes > PRODUCT_CASE_CONTENT_MAX_BYTES
                    ? "font-black text-rose-200"
                    : "text-white/45"
                }`}
              >
                {manualBytes.toLocaleString()} /{" "}
                {PRODUCT_CASE_CONTENT_MAX_BYTES.toLocaleString()} bytes
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  data-testid="process-supplier-evidence"
                  disabled={
                    extracting ||
                    !manualContent.trim() ||
                    manualBytes > PRODUCT_CASE_CONTENT_MAX_BYTES ||
                    !urlValidation.valid ||
                    !humanVisibleProductTextConfirmed
                  }
                  onClick={() => void analyzeManualContent()}
                  className={`min-h-12 rounded-2xl bg-cyan-200 px-5 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}
                >
                  {extracting
                    ? "PROCESANDO LOCALMENTE…"
                    : "PROCESAR EVIDENCIA DEL PROVEEDOR"}
                </button>
                <button
                  type="button"
                  data-testid="clear-supplier-content"
                  disabled={!manualContent && !supplierSourceCapture}
                  onClick={clearManualContent}
                  className={`min-h-12 rounded-2xl border border-white/15 px-5 text-sm font-black text-white/75 disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}
                >
                  LIMPIAR CONTENIDO
                </button>
              </div>
            </div>
          )}
        </section>

        <section
          id="raw-supplier-evidence"
          aria-labelledby="raw-evidence-heading"
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            2. PRODUCT_EVIDENCE
          </p>
          <h2 id="raw-evidence-heading" className="mt-2 text-2xl font-black">
            Resultado de la captura local
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            El texto fuente, candidatos, claims excluidos y datos faltantes
            permanecen visibles y exportables. Ningún candidato se convierte
            automáticamente en PRODUCT_VERIFIED.
          </p>
          <div
            data-testid="luna-source-contract-guard"
            className={`mt-4 rounded-2xl border p-4 ${
              sourceContractGuard.parseHealth === "SOURCE_FORMAT_CHANGED"
                ? "border-rose-200/35 bg-rose-200/[0.08] text-rose-50"
                : "border-cyan-200/25 bg-cyan-200/[0.06] text-cyan-50"
            }`}
          >
            <p className="text-xs font-black uppercase tracking-[0.18em]">
              LUNA SOURCE CONTRACT GUARD V1
            </p>
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="opacity-55">Parse health</dt>
                <dd data-testid="luna-parse-health" className="mt-1 font-black">
                  {sourceContractGuard.parseHealth}
                </dd>
              </div>
              <div>
                <dt className="opacity-55">Stock state</dt>
                <dd data-testid="luna-stock-state" className="mt-1 font-black">
                  {sourceContractGuard.stockState}
                </dd>
              </div>
              <div>
                <dt className="opacity-55">Parser version</dt>
                <dd className="mt-1 break-words font-mono">
                  {sourceContractGuard.parserVersion}
                </dd>
              </div>
              <div>
                <dt className="opacity-55">Source contract</dt>
                <dd className="mt-1 break-words font-mono">
                  {sourceContractGuard.sourceContractVersion}
                </dd>
              </div>
            </dl>
            {sourceContractGuard.parseHealth ===
                "SOURCE_FORMAT_CHANGED" && (
              <p className="mt-3 font-black">
                El formato de Luna pudo cambiar. Revisión humana obligatoria.
              </p>
            )}
          </div>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-6">
            <div className="rounded-2xl border border-white/10 p-3">
              <dt className="text-white/45">Capture method</dt>
              <dd className="mt-1 font-black">
                {supplierSourceCapture?.sourceCaptureMethod ?? "NOT_CAPTURED"}
              </dd>
            </div>
            <div className="rounded-2xl border border-white/10 p-3">
              <dt className="text-white/45">Evidence candidates</dt>
              <dd className="mt-1 font-black">
                {supplierSourceCapture?.evidenceCandidates.length ?? 0}
              </dd>
            </div>
            <div className="rounded-2xl border border-white/10 p-3">
              <dt className="text-white/45">Missing fields</dt>
              <dd className="mt-1 font-black">
                {supplierSourceCapture?.missingFields.length ?? "MISSING"}
              </dd>
            </div>
            <div className="rounded-2xl border border-white/10 p-3">
              <dt className="text-white/45">Warnings</dt>
              <dd className="mt-1 font-black">
                {supplierSourceCapture?.extractionWarnings.length ?? 0}
              </dd>
            </div>
            <div className="rounded-2xl border border-white/10 p-3">
              <dt className="text-white/45">Sensitive assessment</dt>
              <dd className="mt-1 break-words font-black">
                {supplierSourceCapture?.sensitiveContentAssessment ??
                  "NOT_ASSESSED"}
              </dd>
            </div>
            <div className="rounded-2xl border border-white/10 p-3">
              <dt className="text-white/45">Visible product text</dt>
              <dd className="mt-1 break-words font-black">
                {supplierSourceCapture?.humanVisibleProductTextConfirmed
                  ? "HUMAN_CONFIRMED"
                  : "NOT_CONFIRMED"}
              </dd>
            </div>
          </dl>
          <details
            open={Boolean(supplierSourceCapture)}
            className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4"
          >
            <summary className={`cursor-pointer font-black ${buttonFocus}`}>
              Texto fuente original
            </summary>
            <pre
              data-testid="raw-visible-source-text"
              className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-white/65"
            >
              {supplierSourceCapture?.rawVisibleSourceText ??
                "MISSING — procesa una captura manual autenticada."}
            </pre>
          </details>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <JsonPanel
              label="Claims excluidos de product facts"
              value={supplierSourceCapture?.evidenceCandidates.filter(
                (entry) =>
                  entry.evidenceClass === "SUPPLIER_MARKETING_CLAIM"
              ) ?? []}
            />
            <JsonPanel
              label="Conflictos y campos MISSING"
              value={{
                conflicts: rows(runnerOutput.legacyPhaseDiagnostics)
                  .flatMap((phase) => rows(phase.conflicts)),
                missingFields: supplierSourceCapture?.missingFields ?? [],
                extractionWarnings:
                  supplierSourceCapture?.extractionWarnings ?? [],
              }}
            />
          </div>
        </section>

        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="mt-4 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.07] p-4 text-sm font-bold text-cyan-50"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50"
          >
            {error}
          </p>
        )}

        <section
          id="evidence-review"
          aria-labelledby="evidence-review-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <span
            id="phase-2-evidence-review"
            className="block scroll-mt-28"
            aria-hidden="true"
          />
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            PHASE_2_EVIDENCE_REVIEW · IDENTITY · CLASSIFICATION · CONFLICTS
          </p>
          <h2
            id="evidence-review-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Revisión humana campo por campo
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Todo dato de Luna empieza como SUPPLIER_STATED. Una corrección
            conserva rawValue y originalValue; nunca eleva el dato a
            PRODUCT_VERIFIED.
          </p>
          <div className="mt-5 grid gap-4">
            {reviewableEvidence.length === 0 && (
              <p className="rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4 text-sm text-amber-50">
                MISSING — captura evidencia visible para crear propuestas.
              </p>
            )}
            {reviewableEvidence.map((entry) => {
              const row = record(entry)
              const id = evidenceId(entry)
              const draft = reviewDrafts[id] ?? {
                action: "NEEDS_MORE_EVIDENCE" as const,
                reason: "",
                correctedValue: "",
              }
              const selectedAction = draft.action
              const reasonRequired =
                selectedAction === "REJECT" ||
                selectedAction === "CORRECT"
              const supplierMarketingClaim =
                text(row.evidenceClass, "") ===
                  "SUPPLIER_MARKETING_CLAIM" ||
                text(row.sourceEvidenceClass, "") ===
                  "SUPPLIER_MARKETING_CLAIM"
              const supplierStatedFact =
                !supplierMarketingClaim &&
                (
                  text(row.evidenceClass, "") === "SUPPLIER_STATED" ||
                  text(row.sourceEvidenceClass, "") === "SUPPLIER_STATED"
                )
              const evidenceKindLabel = supplierMarketingClaim
                ? "SUPPLIER MARKETING CLAIM"
                : supplierStatedFact
                  ? "SUPPLIER-STATED FACT"
                  : "REVIEWABLE EVIDENCE"
              const evidenceCardTone = supplierMarketingClaim
                ? "border-violet-200/30 bg-violet-200/[0.06]"
                : supplierStatedFact
                  ? "border-cyan-200/25 bg-cyan-200/[0.04]"
                  : "border-white/10 bg-black/20"
              return (
                <fieldset
                  key={id}
                  id={`evidence-card-${stableDomIdSegment(id)}`}
                  className={`min-w-0 scroll-mt-28 rounded-3xl border p-4 sm:p-5 ${evidenceCardTone}`}
                >
                  <legend className="max-w-full px-2 text-sm font-black">
                    <span className="block break-all font-mono text-[10px] uppercase tracking-wider text-white/45">
                      EVIDENCE_CARD:{id}
                    </span>
                    <span className="mt-1 block break-words">
                      {row.field === "title"
                        ? "Título original del proveedor"
                        : text(row.label ?? row.field, id)}
                    </span>
                  </legend>
                  <p className="mb-4 inline-flex min-h-8 items-center rounded-full border border-white/20 px-3 text-[10px] font-black tracking-wider">
                    {evidenceKindLabel}
                  </p>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <dl className="grid min-w-0 gap-3 rounded-2xl border border-white/10 p-3 text-xs">
                      <div>
                        <dt className="font-black uppercase tracking-wider text-white/40">Raw / original</dt>
                        <dd className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-5">{display(row.rawValue ?? row.originalValue)}</dd>
                      </div>
                      <div>
                        <dt className="font-black uppercase tracking-wider text-white/40">Normalized</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words">{display(row.normalizedValue)}</dd>
                      </div>
                      <div>
                        <dt className="font-black uppercase tracking-wider text-white/40">Corrected</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words">{display(row.correctedValue)}</dd>
                      </div>
                    </dl>
                    <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-2xl border border-white/10 p-3 text-xs">
                      <div><dt className="text-white/40">Source type</dt><dd className="mt-1 break-words font-black">{text(row.sourceType)}</dd></div>
                      <div><dt className="text-white/40">Evidence class</dt><dd className="mt-1 break-words font-black">{text(row.evidenceClass)}</dd></div>
                      <div><dt className="text-white/40">Status</dt><dd className="mt-1 break-words font-black">{text(row.evidenceStatus)}</dd></div>
                      <div><dt className="text-white/40">Verdict</dt><dd className="mt-1 break-words font-black">{text(row.humanVerdict, "NOT_REVIEWED")}</dd></div>
                      <div className="col-span-2"><dt className="text-white/40">Extraction path</dt><dd className="mt-1 break-all font-mono">{text(row.extractionPath)}</dd></div>
                      <div className="col-span-2"><dt className="text-white/40">Content hash</dt><dd className="mt-1 break-all font-mono">{text(row.contentHash)}</dd></div>
                    </dl>
                  </div>
                  <div
                    role="group"
                    aria-label={`Veredicto humano para ${text(row.field, id)}`}
                    className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4"
                  >
                    {([
                      "ACCEPT",
                      "REJECT",
                      "CORRECT",
                      "NEEDS_MORE_EVIDENCE",
                    ] as const).map((action) => (
                      <button
                        key={action}
                        type="button"
                        aria-pressed={selectedAction === action}
                        onClick={() => setReviewDraft(id, { action })}
                        className={`min-h-11 rounded-xl border px-2 text-[11px] font-black ${selectedAction === action ? "border-cyan-100 bg-cyan-100 text-black" : "border-white/15 text-white/65"} ${buttonFocus}`}
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                  {selectedAction === "CORRECT" && (
                    <label className="mt-4 grid gap-2 text-xs font-black" htmlFor={`${id}-corrected-value`}>
                      Valor corregido
                      <textarea
                        id={`${id}-corrected-value`}
                        value={draft.correctedValue}
                        onChange={(event) =>
                          setReviewDraft(id, {
                            correctedValue: event.target.value,
                          })}
                        className={`${textAreaClass} min-h-24`}
                      />
                    </label>
                  )}
                  {(reasonRequired ||
                    selectedAction === "NEEDS_MORE_EVIDENCE") && (
                    <label className="mt-4 grid gap-2 text-xs font-black" htmlFor={`${id}-human-reason`}>
                      Motivo humano {reasonRequired ? "· obligatorio" : "· opcional"}
                      <textarea
                        id={`${id}-human-reason`}
                        required={reasonRequired}
                        value={draft.reason}
                        onChange={(event) =>
                          setReviewDraft(id, { reason: event.target.value })}
                        aria-invalid={reasonRequired && !draft.reason.trim()}
                        className={`${textAreaClass} min-h-24`}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => commitReview(entry)}
                    className={`mt-4 min-h-11 rounded-xl border border-cyan-200/25 bg-cyan-200/[0.08] px-4 text-xs font-black text-cyan-50 ${buttonFocus}`}
                  >
                    APLICAR REVISIÓN LOCAL
                  </button>
                  {appliedReviewDecisions[id] && (
                    <div
                      data-testid={`applied-review-${id}`}
                      className="mt-3 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.08] p-3 text-xs text-emerald-50"
                    >
                      <p className="font-black">
                        DECISIÓN APLICADA: {appliedReviewDecisions[id]}
                      </p>
                      <p className="mt-1">
                        Status: <span className="font-black">
                          {text(row.evidenceStatus)}
                        </span>
                      </p>
                      <p>
                        Verdict: <span className="font-black">
                          {text(row.humanVerdict, "NOT_REVIEWED")}
                        </span>
                      </p>
                    </div>
                  )}
                </fieldset>
              )
            })}
          </div>
        </section>

        <section
          id="human-visual-review"
          aria-labelledby="human-visual-review-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-cyan-200/20 bg-cyan-200/[0.035] p-5 sm:p-7"
        >
          <span
            id="phase-3-human-visual-review"
            className="block scroll-mt-28"
            aria-hidden="true"
          />
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            PHASE_3_HUMAN_VISUAL_REVIEW
          </p>
          <h2
            id="human-visual-review-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Agregar observación visual suministrada por un humano
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Seller OS no observa la imagen. Registra únicamente lo descrito por
            el revisor y conserva la referencia original. La observación queda
            como HUMAN_VISUAL_REVIEW y nunca como machine vision o
            PRODUCT_VERIFIED.
          </p>
          <p className="mt-3 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.04] p-3 text-xs font-black">
            {HUMAN_VISUAL_REVIEW_CONTRACT_VERSION} · reviewerType:HUMAN ·
            captureMethod:HUMAN_VISUAL_REVIEW · machineVisionStatus:NOT_IMPLEMENTED
            · openAiVisionUsed:false
          </p>
          <section
            id="visual-review-legacy-queue"
            data-testid="visual-review-legacy-queue"
            tabIndex={-1}
            aria-labelledby="visual-review-legacy-queue-heading"
            className="mt-4 scroll-mt-28 rounded-2xl border border-amber-200/30 bg-amber-200/[0.07] p-4 text-amber-50 outline-none focus-visible:ring-2 focus-visible:ring-amber-100"
          >
            <p className="font-mono text-[10px] font-black tracking-wider">
              VISUAL_REVIEW_LEGACY_QUEUE
            </p>
            <h3
              id="visual-review-legacy-queue-heading"
              className="mt-1 font-black"
            >
              {pendingVisualObservations.length === 1
                ? "1 revisión visual requiere corrección"
                : `${pendingVisualObservations.length} revisiones visuales requieren corrección`}
            </h3>
            {pendingVisualObservations.length > 0
              ? (
                <ul className="mt-3 grid gap-3">
                  {pendingVisualObservations.map((observation) => {
                    const observationIssues =
                      visualReviewContractIssues.filter((issue) =>
                        visualIssueMatchesObservation(issue, observation)
                      )
                    const displayedIssues = observationIssues.length > 0
                      ? observationIssues
                      : [
                          `HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:${observation.imageId}`,
                        ]
                    const issueAnchor =
                      visualReviewIssueAnchorFor(observation)
                    const cardAnchor =
                      visualReviewCardAnchorFor(observation)
                    return (
                      <li
                        key={issueAnchor}
                        id={issueAnchor}
                        tabIndex={-1}
                        className="scroll-mt-28 rounded-xl border border-amber-100/20 bg-black/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-amber-100"
                      >
                        <p className="break-all text-xs font-black">
                          VISUAL_REVIEW_CARD:{observation.imageId}
                        </p>
                        <ul className="mt-2 grid gap-1 font-mono text-[11px] leading-5">
                          {displayedIssues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                        <a
                          href={`#${cardAnchor}`}
                          onClick={(event) => {
                            event.preventDefault()
                            focusVisualReviewCard(
                              observation,
                              issueAnchor,
                            )
                          }}
                          className={`mt-3 inline-flex min-h-11 items-center rounded-xl border border-amber-100/35 bg-amber-100/10 px-4 text-xs font-black ${buttonFocus}`}
                        >
                          IR A CORREGIR
                        </a>
                      </li>
                    )
                  })}
                </ul>
              )
              : (
                <p className="mt-2 text-xs font-black text-emerald-100">
                  Sin revisiones visuales legacy pendientes.
                </p>
              )}
            {visualReviewContractIssues.some((issue) =>
              !imageAnalysis.observations.some((observation) =>
                visualIssueMatchesObservation(issue, observation)
              )
            ) && (
              <div className="mt-3 rounded-xl border border-amber-100/20 p-3">
                <p className="text-xs font-black">
                  Otros bloqueos visuales sin tarjeta navegable
                </p>
                <ul className="mt-2 grid gap-1 font-mono text-[11px]">
                  {visualReviewContractIssues.filter((issue) =>
                    !imageAnalysis.observations.some((observation) =>
                      visualIssueMatchesObservation(issue, observation)
                    )
                  ).map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            )}
          </section>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-visual-image-id"
            >
              ID de imagen — imageId
              <input
                id="phase3-visual-image-id"
                value={visualObservationDraft.imageId}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    imageId: event.target.value,
                  }))}
                className={inputClass}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-observed-product-type"
            >
              Tipo de producto observado — observedProductType
              <input
                id="phase3-observed-product-type"
                value={visualObservationDraft.observedProductType}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    observedProductType: event.target.value,
                  }))}
                className={inputClass}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-visual-source-reference"
            >
              Referencia de origen — sourceReference
              <input
                id="phase3-visual-source-reference"
                value={visualObservationDraft.sourceReference}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    sourceReference: event.target.value,
                  }))}
                className={inputClass}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-visual-source-url"
            >
              URL de origen — sourceUrl · HTTPS opcional
              <input
                id="phase3-visual-source-url"
                type="url"
                value={visualObservationDraft.sourceUrl}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    sourceUrl: event.target.value,
                  }))}
                className={inputClass}
              />
            </label>
            {([
              [
                "visibleFeatures",
                "Características visibles — visibleFeatures · una por línea",
              ],
              [
                "visibleText",
                "Texto visible en la imagen — visibleText · uno por línea",
              ],
              [
                "visibleBrands",
                "Marcas visibles — visibleBrands · una por línea",
              ],
              [
                "visibleColors",
                "Colores visibles — visibleColors · uno por línea",
              ],
            ] as const).map(([field, label]) => (
              <label
                key={field}
                className="grid gap-2 text-sm font-black"
                htmlFor={`phase3-${field}`}
              >
                {label}
                <textarea
                  id={`phase3-${field}`}
                  value={visualObservationDraft[field]}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))}
                  className={`${textAreaClass} min-h-24`}
                />
              </label>
            ))}
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-visible-quantity"
            >
              Cantidad visible — visibleQuantity
              <input
                id="phase3-visible-quantity"
                type="number"
                min="0"
                step="1"
                value={visualObservationDraft.visibleQuantity}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    visibleQuantity: event.target.value,
                  }))}
                className={inputClass}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-observed-variant"
            >
              Variante observada — observedVariant
              <input
                id="phase3-observed-variant"
                value={visualObservationDraft.observedVariant}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    observedVariant: event.target.value,
                  }))}
                className={inputClass}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-visual-decision"
            >
              Decisión humana — humanDecision
              <select
                id="phase3-visual-decision"
                value={visualObservationDraft.humanDecision}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    humanDecision: event.target.value as
                      VisualObservationDraft["humanDecision"],
                  }))}
                className={inputClass}
              >
                <option value="ACCEPT_FOR_ANALYSIS">
                  ACCEPT_FOR_ANALYSIS
                </option>
                <option value="NEEDS_MORE_EVIDENCE">
                  NEEDS_MORE_EVIDENCE
                </option>
                <option value="REJECT_FOR_EBAY_HANDOFF">
                  REJECT_FOR_EBAY_HANDOFF
                </option>
              </select>
            </label>
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-visual-confidence"
            >
              Confianza — confidence
              <select
                id="phase3-visual-confidence"
                value={visualObservationDraft.confidence}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    confidence: event.target.value as
                      VisualObservationDraft["confidence"],
                  }))}
                className={inputClass}
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </label>
            <label
              className="grid gap-2 text-sm font-black lg:col-span-2"
              htmlFor="phase3-visual-blockers"
            >
              Bloqueos visuales — possibleConflicts · uno por línea
              <textarea
                id="phase3-visual-blockers"
                value={visualObservationDraft.possibleConflicts}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    possibleConflicts: event.target.value,
                  }))}
                className={`${textAreaClass} min-h-24`}
              />
            </label>
            <fieldset className="rounded-2xl border border-amber-200/20 p-4 lg:col-span-2">
              <legend className="px-2 text-xs font-black">
                Evidencia textual contradicha · opcional
              </legend>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                {contradictableSupplierEvidence.map((entry) => {
                  const id = evidenceId(entry)
                  const checked =
                    visualObservationDraft.contradictsEvidenceIds.includes(id)
                  return (
                    <label
                      key={id}
                      className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setVisualObservationDraft((current) => ({
                            ...current,
                            contradictsEvidenceIds: event.target.checked
                              ? [...current.contradictsEvidenceIds, id]
                              : current.contradictsEvidenceIds.filter(
                                (candidate) => candidate !== id,
                              ),
                          }))}
                        className="mt-0.5 size-4"
                      />
                      <span className="min-w-0 break-words">
                        <span className="block font-black">{id}</span>
                        <span className="text-white/45">
                          {display(record(entry).field)} ·{" "}
                          {display(record(entry).rawValue)}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <label
              className="grid gap-2 text-sm font-black lg:col-span-2"
              htmlFor="phase3-visual-reason"
            >
              Motivo humano — humanReason · requerido
              <textarea
                id="phase3-visual-reason"
                value={visualObservationDraft.humanReason}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    humanReason: event.target.value,
                  }))}
                className={`${textAreaClass} min-h-24`}
              />
            </label>
            <button
              type="button"
              data-testid="add-human-visual-review"
              onClick={registerVisualObservation}
              disabled={
                !visualObservationDraft.imageId.trim() ||
                !visualObservationDraft.humanReason.trim()
              }
              className={`min-h-12 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.08] px-4 text-sm font-black text-cyan-50 disabled:cursor-not-allowed disabled:opacity-40 lg:col-span-2 ${buttonFocus}`}
            >
              {editingVisualObservationEvidenceId
                ? "GUARDAR CAMBIOS DE REVISIÓN"
                : "AGREGAR REVISIÓN HUMANA"}
            </button>
            {editingVisualObservationEvidenceId && (
              <>
                <button
                  type="button"
                  onClick={returnToVisualReviewBlocker}
                  disabled={
                    !visualReviewReturnTarget ||
                    visualReviewReturnTarget.observationEvidenceId !==
                      editingVisualObservationEvidenceId
                  }
                  className={`min-h-11 rounded-2xl border border-amber-200/30 bg-amber-200/[0.07] px-4 text-sm font-black text-amber-50 disabled:opacity-40 ${buttonFocus}`}
                >
                  VOLVER AL BLOQUEO
                </button>
                <button
                  type="button"
                  onClick={cancelVisualObservationEdit}
                  className={`min-h-11 rounded-2xl border border-white/15 px-4 text-sm font-black text-white/70 ${buttonFocus}`}
                >
                  CANCELAR EDICIÓN
                </button>
              </>
            )}
          </div>
          <section
            aria-labelledby="registered-visual-reviews-heading"
            className="mt-7 rounded-3xl border border-cyan-200/20 bg-black/20 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/55">
                  HUMAN VISUAL REVIEW
                </p>
                <h3
                  id="registered-visual-reviews-heading"
                  className="mt-1 text-xl font-black"
                >
                  REVISIONES VISUALES REGISTRADAS
                </h3>
              </div>
              <dl
                aria-live="polite"
                className="grid grid-cols-2 gap-2 text-xs"
              >
                <div className="rounded-xl border border-white/10 px-3 py-2">
                  <dt className="text-white/45">Total:</dt>
                  <dd
                    data-testid="visual-review-total-count"
                    className="mt-1 text-lg font-black"
                  >
                    {imageAnalysis.observations.length}
                  </dd>
                </div>
                <div className="rounded-xl border border-amber-200/25 px-3 py-2">
                  <dt className="text-amber-100/65">Pendientes:</dt>
                  <dd
                    data-testid="visual-review-pending-count"
                    className="mt-1 text-lg font-black text-amber-50"
                  >
                    {pendingVisualObservations.length}
                  </dd>
                </div>
              </dl>
            </div>
            <div
              role="group"
              aria-label="Filtrar revisiones visuales por estado"
              className="mt-4 grid grid-cols-3 gap-2"
            >
              {([
                ["ALL", "TODAS"],
                ["PENDING", "PENDIENTES"],
                ["CORRECTED", "CORREGIDAS"],
              ] as const).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={visualReviewFilter === filter}
                  onClick={() => setVisualReviewFilter(filter)}
                  className={`min-h-11 rounded-xl border px-2 text-[11px] font-black ${
                    visualReviewFilter === filter
                      ? "border-cyan-100 bg-cyan-100 text-black"
                      : "border-white/15 text-white/65"
                  } ${buttonFocus}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
              <label
                className="grid gap-2 text-xs font-black"
                htmlFor="visual-review-search"
              >
                Buscar revisión visual — imageId, evidenceId o estado
                <input
                  id="visual-review-search"
                  type="search"
                  value={visualReviewQuery}
                  onChange={(event) =>
                    setVisualReviewQuery(event.target.value)}
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                onClick={() => setVisualReviewQuery("")}
                disabled={!visualReviewQuery}
                className={`min-h-11 self-end rounded-xl border border-white/15 px-4 text-xs font-black disabled:opacity-40 ${buttonFocus}`}
              >
                LIMPIAR BÚSQUEDA
              </button>
            </div>
            <p className="mt-3 text-xs text-white/45">
              Mostrando {filteredVisualObservations.length} de{" "}
              {imageAnalysis.observations.length}
            </p>
            <div className="mt-4 grid gap-3">
              {filteredVisualObservations.map((observation) => {
                const pending = isVisualReviewPending(observation)
                const highlighted =
                  highlightedVisualReviewEvidenceId ===
                    observation.evidenceId
                const cardAnchor =
                  visualReviewCardAnchorFor(observation)
                return (
                  <article
                    key={cardAnchor}
                    id={cardAnchor}
                    tabIndex={-1}
                    aria-labelledby={`${cardAnchor}-heading`}
                    data-testid={`human-visual-review-card-${observation.evidenceId}`}
                    data-visual-review-status={
                      pending ? "PENDING" : "CORRECTED"
                    }
                    className={`scroll-mt-28 scroll-mb-32 rounded-3xl border p-4 outline-none transition ${
                      pending
                        ? "border-amber-200/40 bg-amber-200/[0.07]"
                        : "border-cyan-200/20 bg-cyan-200/[0.035]"
                    } ${
                      highlighted
                        ? "ring-4 ring-amber-200 ring-offset-4 ring-offset-[#05070d]"
                        : "focus-visible:ring-2 focus-visible:ring-cyan-100"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4
                          id={`${cardAnchor}-heading`}
                          className="break-all font-mono text-base font-black"
                        >
                          VISUAL_REVIEW_CARD:{observation.imageId}
                        </h4>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-cyan-100/25 bg-cyan-100/[0.07] px-3 py-1 text-[10px] font-black">
                            HUMAN VISUAL REVIEW
                          </span>
                          <span
                            className={`rounded-full border px-3 py-1 text-[10px] font-black ${
                              pending
                                ? "border-amber-100/35 bg-amber-100/10 text-amber-50"
                                : "border-emerald-100/30 bg-emerald-100/[0.08] text-emerald-50"
                            }`}
                          >
                            {pending
                              ? "LEGACY REQUIRES CORRECTION"
                              : "CORRECTED VISUAL REVIEW"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-white/55">
                          {observation.reviewerType} ·{" "}
                          {observation.confidence} ·{" "}
                          {observation.humanDecision}
                        </p>
                        <p className="mt-1 break-all text-[10px] font-black text-cyan-100/50">
                          {observation.contractVersion ??
                            "LEGACY_UNVERSIONED · CORRECCIÓN HUMANA REQUERIDA"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => editVisualObservation(observation)}
                          className={`min-h-10 rounded-xl border border-cyan-200/25 px-3 text-xs font-black ${buttonFocus}`}
                        >
                          EDITAR
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteVisualObservation(observation)}
                          className={`min-h-10 rounded-xl border border-rose-200/25 px-3 text-xs font-black text-rose-100 ${buttonFocus}`}
                        >
                          ELIMINAR
                        </button>
                      </div>
                    </div>
                    <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      {([
                        [
                          "ID de imagen — imageId",
                          observation.imageId,
                        ],
                        [
                          "Referencia de origen — sourceReference",
                          observation.sourceReference,
                        ],
                        [
                          "URL de origen — sourceUrl",
                          observation.sourceUrl,
                        ],
                        [
                          "Tipo de producto observado — observedProductType",
                          observation.observedProductType,
                        ],
                        [
                          "Características visibles — visibleFeatures",
                          observation.visibleFeatures,
                        ],
                        [
                          "Texto visible en la imagen — visibleText",
                          observation.visibleText,
                        ],
                        [
                          "Marcas visibles — visibleBrands",
                          observation.visibleBrands,
                        ],
                        [
                          "Colores visibles — visibleColors",
                          observation.visibleColors,
                        ],
                        [
                          "Cantidad visible — visibleQuantity",
                          observation.visibleQuantity,
                        ],
                        [
                          "Variante observada — observedVariant",
                          observation.observedVariant,
                        ],
                        [
                          "Bloqueos visuales — possibleConflicts",
                          observation.possibleConflicts,
                        ],
                        [
                          "Confianza — confidence",
                          observation.confidence,
                        ],
                        [
                          "Decisión humana — humanDecision",
                          observation.humanDecision,
                        ],
                      ] as const).map(([label, value]) => {
                        const values = Array.isArray(value) ? value : [value]
                        const present = values.filter((entry) =>
                          entry !== null && entry !== undefined && entry !== ""
                        )
                        return (
                          <div
                            key={label}
                            className="min-w-0 rounded-xl border border-white/10 p-3"
                          >
                            <dt className="font-black text-white/55">
                              {label}
                            </dt>
                            <dd className="mt-2 break-words">
                              {present.length > 0
                                ? (
                                  <ul className="grid gap-1">
                                    {present.map((entry, index) => (
                                      <li key={`${label}-${index}`}>
                                        {String(entry)}
                                      </li>
                                    ))}
                                  </ul>
                                )
                                : "MISSING"}
                            </dd>
                          </div>
                        )
                      })}
                      <div className="rounded-xl border border-white/10 p-3 sm:col-span-2">
                        <dt className="font-black text-white/55">
                          Motivo humano — humanReason
                        </dt>
                        <dd className="mt-2 whitespace-pre-wrap break-words">
                          {observation.humanReason}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-white/10 p-3 sm:col-span-2">
                        <dt className="font-black text-white/55">
                          Evidencia visual — evidenceId
                        </dt>
                        <dd className="mt-2 break-all font-mono">
                          {observation.evidenceId}
                        </dd>
                      </div>
                    </dl>
                    {observation.rawHumanInput
                      ? (
                        <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs">
                          <summary className={`cursor-pointer font-black ${buttonFocus}`}>
                            Texto humano original preservado
                          </summary>
                          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                            {Object.entries(observation.rawHumanInput).map(
                              ([field, value]) => (
                                <div key={field}>
                                  <dt className="text-white/45">{field}</dt>
                                  <dd className="whitespace-pre-wrap break-words">
                                    {value || "MISSING"}
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                        </details>
                      )
                      : (
                        <p className="mt-3 rounded-xl border border-amber-200/25 bg-amber-200/[0.06] p-3 text-xs font-black text-amber-100">
                          LEGACY REQUIRES CORRECTION · Datos visuales legacy:
                          corrección humana obligatoria; no se normalizaron
                          silenciosamente.
                        </p>
                      )}
                  </article>
                )
              })}
              {imageAnalysis.observations.length === 0 && (
                <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm font-black text-white/45">
                  VISUAL OBSERVATIONS: NOT_REVIEWED
                </p>
              )}
              {imageAnalysis.observations.length > 0 &&
                filteredVisualObservations.length === 0 && (
                <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm font-black text-white/55">
                  Sin revisiones visuales que coincidan con el filtro y la
                  búsqueda.
                </p>
              )}
            </div>
          </section>
        </section>

        <section
          id="phase-4-identity-and-variants"
          aria-labelledby="identity-review-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-violet-200/20 bg-violet-200/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-100/65">
            OPERATIONAL PHASE 4 · IDENTITY_AND_VARIANTS
          </p>
          <h2
            id="identity-review-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Revisión humana de identidad y variante
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Determina si la evidencia describe el mismo tipo general de
            producto sin convertir esa coincidencia aparente en identidad
            exacta. El título original de Luna permanece SUPPLIER_STATED:
            nunca demuestra marca, modelo o variante y no es un título eBay
            optimizado.
          </p>
          <p className="mt-3 rounded-2xl border border-violet-200/20 bg-violet-200/[0.04] p-3 text-xs font-black">
            {HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION} · HUMAN REVIEW ·
            physicalProductVerified:
            {String(Boolean(identityReview.physicalProductVerified))} ·
            canPublishAutomatically:false ·
            manualHandoffAllowed efectivo:
            {String(manualHandoffAllowed)}
          </p>
          {Object.keys(savedHumanIdentityReview).length > 0 &&
            Object.keys(activeSupplierCatalogAttestation).length === 0 && (
            <button
              type="button"
              onClick={() =>
                focusProductCaseTarget(
                  "supplier-catalog-limitation",
                  "supplier-catalog-limitation-heading",
                )}
              className={`mt-3 min-h-11 rounded-xl border border-amber-200/30 bg-amber-200/[0.06] px-4 text-xs font-black ${buttonFocus}`}
            >
              REVISAR BLOQUEO: PROVEEDOR SIN IDENTIFICADORES ADICIONALES
            </button>
          )}
          {humanIdentityReviewError && (
            <div
              ref={humanIdentityReviewErrorRef}
              id="phase4-identity-review-error"
              role="alert"
              tabIndex={-1}
              className="mt-4 scroll-mt-28 rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm font-black text-rose-50 outline-none focus-visible:ring-2 focus-visible:ring-rose-100"
            >
              {humanIdentityReviewError}
            </div>
          )}

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <section
              aria-labelledby="identity-evidence-links-heading"
              className="rounded-3xl border border-cyan-200/20 bg-black/20 p-4"
            >
              <h3
                id="identity-evidence-links-heading"
                className="font-black"
              >
                Evidencia enlazada por procedencia
              </h3>
              <dl className="mt-3 grid gap-3 text-xs">
                <div className="rounded-xl border border-cyan-200/15 p-3">
                  <dt className="font-black text-cyan-100">
                    Evidencia declarada por proveedor — supplierEvidenceIds
                  </dt>
                  <dd className="mt-2">
                    {supplierIdentityEvidenceIds.length > 0
                      ? (
                        <ul className="grid gap-1 font-mono">
                          {supplierIdentityEvidenceIds.map((id) => (
                            <li key={id} className="break-all">{id}</li>
                          ))}
                        </ul>
                      )
                      : "MISSING"}
                  </dd>
                </div>
                <div className="rounded-xl border border-violet-200/20 p-3">
                  <dt className="font-black text-violet-100">
                    Observaciones humanas — humanObservationEvidenceIds
                  </dt>
                  <dd className="mt-2">
                    {humanObservationIdentityEvidenceIds.length > 0
                      ? (
                        <ul className="grid gap-1 font-mono">
                          {humanObservationIdentityEvidenceIds.map((id) => (
                            <li key={id} className="break-all">{id}</li>
                          ))}
                        </ul>
                      )
                      : "MISSING"}
                  </dd>
                </div>
              </dl>
            </section>

            <section
              aria-labelledby="identity-current-state-heading"
              className="rounded-3xl border border-amber-200/20 bg-amber-200/[0.04] p-4"
            >
              <h3 id="identity-current-state-heading" className="font-black">
                Estado y bloqueos vigentes
              </h3>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-white/45">Status</dt>
                  <dd className="mt-1 font-black">
                    {display(identityReview.status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/45">Confidence</dt>
                  <dd className="mt-1 font-black">
                    {display(identityReview.confidence)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-white/45">Conflictos activos</dt>
                  <dd className="mt-1">
                    {activeIdentityConflicts.length > 0
                      ? (
                        <ul className="grid gap-1 font-mono">
                          {activeIdentityConflicts.map((conflict) => (
                            <li key={conflict}>{conflict}</li>
                          ))}
                        </ul>
                      )
                      : "NONE"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-white/45">Bloqueos — blockers</dt>
                  <dd className="mt-1">
                    {identityBlockers.length > 0
                      ? (
                        <ul className="grid gap-1 font-mono">
                          {identityBlockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      )
                      : "NONE"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-white/45">Siguiente acción</dt>
                  <dd className="mt-1 font-black">
                    {display(identityReview.nextAction)}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={reviewMissingIdentityEvidence}
                className={`mt-4 min-h-11 rounded-xl border border-amber-100/30 bg-amber-100/[0.07] px-4 text-xs font-black ${buttonFocus}`}
              >
                REVISAR EVIDENCIA FALTANTE
              </button>
            </section>
          </div>

          <section
            aria-labelledby="identity-fields-heading"
            className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-4"
          >
            <h3 id="identity-fields-heading" className="font-black">
              Campos de identidad disponibles · Campos MISSING
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {availableIdentityFieldRows.map((row) => (
                <article
                  key={row.field}
                  className={`rounded-xl border p-3 text-xs ${
                    row.value === null
                      ? "border-amber-200/25 bg-amber-200/[0.04]"
                      : "border-cyan-200/20 bg-cyan-200/[0.035]"
                  }`}
                >
                  <p className="font-mono font-black">{row.field}</p>
                  <p className="mt-2 break-words font-black">
                    {row.value === null ? "MISSING" : display(row.value)}
                  </p>
                  {row.evidenceIds.length > 0 && (
                    <p className="mt-2 whitespace-pre-wrap break-all font-mono text-[10px] text-white/45">
                      {row.evidenceIds.join("\n")}
                    </p>
                  )}
                  {row.sourceEvidenceClasses.length > 0 && (
                    <p className="mt-1 text-[10px] text-white/45">
                      {row.sourceEvidenceClasses.join(" · ")}
                    </p>
                  )}
                </article>
              ))}
            </div>
            <p className="mt-3 text-xs font-black text-amber-100">
              MISSING:{" "}
              {missingIdentityFields.length > 0
                ? missingIdentityFields.join(" · ")
                : "NONE"}
            </p>
          </section>

          {Object.keys(savedHumanIdentityReview).length > 0 &&
            !editingHumanIdentityReview && (
            <article
              data-testid="human-identity-review-card"
              className="mt-4 rounded-3xl border border-emerald-200/25 bg-emerald-200/[0.045] p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-black tracking-wider text-emerald-100/65">
                    {HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION}
                  </p>
                  <h3 className="mt-1 text-lg font-black">
                    REVISIÓN DE IDENTIDAD REGISTRADA
                  </h3>
                </div>
                <span className="rounded-full border border-emerald-100/30 px-3 py-1 text-xs font-black">
                  {display(savedHumanIdentityReview.status)}
                </span>
              </div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
                {([
                  ["contractVersion", "Versión — contractVersion"],
                  ["contentHash", "Hash canónico — contentHash"],
                  ["reviewer", "Revisor — reviewer"],
                  ["reviewedAt", "Fecha automática — reviewedAt"],
                  ["decision", "Decisión humana — decision"],
                  ["confidence", "Confianza — confidence"],
                  [
                    "sameGeneralProductTypeConfirmed",
                    "Mismo tipo general aparente",
                  ],
                  ["productType", "Tipo general de producto — productType"],
                  [
                    "exactIdentityConfirmed",
                    "Identidad exacta confirmada",
                  ],
                  ["brandConfirmed", "Marca confirmada independientemente"],
                  ["brand", "Marca — brand"],
                  ["model", "Modelo — model"],
                  ["mpn", "MPN — mpn"],
                  [
                    "supplierProductId",
                    "ID del producto del proveedor — supplierProductId",
                  ],
                  ["supplierSku", "SKU del proveedor — supplierSku"],
                  ["variantId", "Variante — variantId"],
                  ["color", "Color — color"],
                  ["packQuantity", "Cantidad del pack — packQuantity"],
                  [
                    "physicalProductVerified",
                    "Producto físico verificado — physicalProductVerified",
                  ],
                ] as const).map(([field, label]) => (
                  <div
                    key={field}
                    className="rounded-xl border border-white/10 p-3"
                  >
                    <dt className="text-white/45">{label}</dt>
                    <dd className="mt-1 break-words font-black">
                      {display(savedHumanIdentityReview[field])}
                    </dd>
                  </div>
                ))}
                <div className="rounded-xl border border-white/10 p-3 sm:col-span-2 xl:col-span-3">
                  <dt className="text-white/45">Motivo humano — humanReason</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words font-black">
                    {display(savedHumanIdentityReview.humanReason)}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 p-3 sm:col-span-2 xl:col-span-3">
                  <dt className="text-white/45">
                    Evidencias usadas en la revisión de identidad — evidenceIds
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap break-all font-mono">
                    {display(savedHumanIdentityReview.evidenceIds)}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 p-3 sm:col-span-2 xl:col-span-3">
                  <dt className="text-white/45">
                    Evidencias de verificación física — physicalVerificationEvidenceIds
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap break-all font-mono">
                    {display(
                      savedHumanIdentityReview
                        .physicalVerificationEvidenceIds,
                    )}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 p-3 sm:col-span-2 xl:col-span-3">
                  <dt className="text-white/45">
                    Procedencia canónica — provenance
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap break-all font-mono">
                    {display(savedHumanIdentityReview.provenance)}
                  </dd>
                </div>
              </dl>
              <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs">
                <summary className={`cursor-pointer font-black ${buttonFocus}`}>
                  Texto humano original preservado — rawHumanInput
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-white/60">
                  {display(savedHumanIdentityReview.rawHumanInput)}
                </pre>
              </details>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={editHumanIdentityReview}
                  className={`min-h-11 rounded-xl border border-cyan-200/30 bg-cyan-200/[0.07] px-4 text-xs font-black ${buttonFocus}`}
                >
                  EDITAR REVISIÓN
                </button>
                <button
                  type="button"
                  onClick={deleteHumanIdentityReview}
                  className={`min-h-11 rounded-xl border border-rose-200/25 bg-rose-200/[0.06] px-4 text-xs font-black text-rose-50 ${buttonFocus}`}
                >
                  ELIMINAR REVISIÓN
                </button>
              </div>
            </article>
          )}

          {(editingHumanIdentityReview ||
            Object.keys(savedHumanIdentityReview).length === 0) && (
            <fieldset className="mt-4 rounded-3xl border border-violet-200/25 bg-black/20 p-4 sm:p-5">
              <legend className="px-2 font-black">
                Formulario canónico de revisión humana
              </legend>
              <div className="grid gap-4 lg:grid-cols-2">
                <label
                  className="grid gap-2 text-xs font-black"
                  htmlFor="phase4-identity-reviewer"
                >
                  Revisor — reviewer · requerido
                  <input
                    id="phase4-identity-reviewer"
                    value={humanIdentityReviewDraft.reviewer}
                    onChange={(event) =>
                      setHumanIdentityReviewDraft((current) => ({
                        ...current,
                        reviewer: event.target.value,
                      }))}
                    className={inputClass}
                  />
                  <span className="font-normal text-white/45">
                    reviewedAt se registra automáticamente al guardar.
                  </span>
                </label>
                <label
                  className="grid gap-2 text-xs font-black"
                  htmlFor="phase4-identity-decision"
                >
                  Decisión — decision
                  <select
                    id="phase4-identity-decision"
                    value={humanIdentityReviewDraft.decision}
                    onChange={(event) =>
                      setHumanIdentityReviewDraft((current) => ({
                        ...current,
                        decision: event.target.value as
                          HumanIdentityReviewDraft["decision"],
                      }))}
                    className={inputClass}
                  >
                    <option value="NEEDS_MORE_EVIDENCE">
                      NEEDS_MORE_EVIDENCE
                    </option>
                    <option value="CONFLICT_CONFIRMED">
                      CONFLICT_CONFIRMED
                    </option>
                    <option value="IDENTITY_CONFIRMED">
                      IDENTITY_CONFIRMED
                    </option>
                  </select>
                </label>
                <label
                  className="grid gap-2 text-xs font-black"
                  htmlFor="phase4-identity-confidence"
                >
                  Confianza — confidence
                  <select
                    id="phase4-identity-confidence"
                    value={humanIdentityReviewDraft.confidence}
                    onChange={(event) =>
                      setHumanIdentityReviewDraft((current) => ({
                        ...current,
                        confidence: event.target.value as
                          HumanIdentityReviewDraft["confidence"],
                      }))}
                    className={inputClass}
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                  </select>
                </label>
                <div className="rounded-xl border border-amber-200/25 bg-amber-200/[0.05] p-3 text-xs">
                  <p className="font-black">
                    Producto físico verificado — physicalProductVerified
                  </p>
                  <p className="mt-1 font-mono">
                    {String(
                      humanIdentityReviewDraft.physicalProductVerified,
                    )}
                  </p>
                  <p className="mt-2 text-white/50">
                    {humanIdentityReviewDraft.physicalProductVerified
                      ? "Verificación física válida importada: se preserva al editar y no puede recrearse desde esta UI."
                      : "Esta UI no puede afirmar una inspección física independiente."}
                  </p>
                  {humanIdentityReviewDraft
                    .physicalVerificationEvidenceIds.length > 0 && (
                    <ul className="mt-2 grid gap-1 font-mono text-[10px]">
                      {humanIdentityReviewDraft
                        .physicalVerificationEvidenceIds.map((id) => (
                          <li key={id} className="break-all">
                            {id}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 p-3 text-xs font-black">
                  <input
                    type="checkbox"
                    checked={
                      humanIdentityReviewDraft.sameGeneralProductTypeConfirmed
                    }
                    onChange={(event) =>
                      setHumanIdentityReviewDraft((current) => ({
                        ...current,
                        sameGeneralProductTypeConfirmed:
                          event.target.checked,
                        productType: event.target.checked
                          ? current.productType
                          : "",
                      }))}
                    className="size-4"
                  />
                  Mismo tipo general aparente — sameGeneralProductTypeConfirmed
                </label>
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 p-3 text-xs font-black">
                  <input
                    type="checkbox"
                    checked={
                      humanIdentityReviewDraft.exactIdentityConfirmed
                    }
                    onChange={(event) =>
                      setHumanIdentityReviewDraft((current) => ({
                        ...current,
                        exactIdentityConfirmed: event.target.checked,
                      }))}
                    className="size-4"
                  />
                  Identidad exacta confirmada — exactIdentityConfirmed
                </label>
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 p-3 text-xs font-black lg:col-span-2">
                  <input
                    type="checkbox"
                    checked={humanIdentityReviewDraft.brandConfirmed}
                    onChange={(event) =>
                      setHumanIdentityReviewDraft((current) => ({
                        ...current,
                        brandConfirmed: event.target.checked,
                      }))}
                    className="size-4"
                  />
                  Marca confirmada por evidencia independiente —
                  brandConfirmed
                </label>
                {([
                  [
                    "productType",
                    "Tipo general de producto — productType",
                  ],
                  ["brand", "Marca — brand"],
                  ["model", "Modelo — model"],
                  ["mpn", "MPN — mpn"],
                  [
                    "supplierProductId",
                    "ID del producto del proveedor — supplierProductId",
                  ],
                  ["supplierSku", "SKU del proveedor — supplierSku"],
                  ["variantId", "Variante — variantId"],
                  ["color", "Color — color"],
                  ["packQuantity", "Cantidad del pack — packQuantity"],
                ] as const).map(([field, label]) => (
                  <label
                    key={field}
                    className="grid gap-2 text-xs font-black"
                    htmlFor={`phase4-${field}`}
                  >
                    {label}
                    <input
                      id={`phase4-${field}`}
                      type={field === "packQuantity" ? "number" : "text"}
                      min={field === "packQuantity" ? "1" : undefined}
                      step={field === "packQuantity" ? "1" : undefined}
                      disabled={field === "productType" &&
                        !humanIdentityReviewDraft
                          .sameGeneralProductTypeConfirmed}
                      value={humanIdentityReviewDraft[field]}
                      placeholder="MISSING"
                      onChange={(event) =>
                        setHumanIdentityReviewDraft((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))}
                      className={inputClass}
                    />
                  </label>
                ))}
                <fieldset className="rounded-2xl border border-white/10 p-4 lg:col-span-2">
                  <legend className="px-2 text-xs font-black">
                    Evidencias seleccionadas — evidenceIds
                  </legend>
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    {identityEvidenceCandidates.map((entry) => {
                      const row = record(entry)
                      const id = evidenceId(entry)
                      const checked =
                        humanIdentityReviewDraft.evidenceIds.includes(id)
                      const preservedPhysicalReference =
                        humanIdentityReviewDraft
                          .physicalVerificationEvidenceIds.includes(id)
                      return (
                        <label
                          key={id}
                          className="flex min-h-12 items-start gap-3 rounded-xl border border-white/10 p-3 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={preservedPhysicalReference}
                            onChange={(event) =>
                              toggleHumanIdentityEvidenceId(
                                id,
                                event.target.checked,
                              )}
                            className="mt-0.5 size-4"
                          />
                          <span className="min-w-0">
                            <span className="block break-all font-mono font-black">
                              {id}
                            </span>
                            <dl className="mt-2 grid gap-1 text-[10px] text-white/55">
                              <div>
                                <dt className="inline font-black">Field: </dt>
                                <dd className="inline">{display(row.field)}</dd>
                              </div>
                              <div>
                                <dt className="inline font-black">Raw value: </dt>
                                <dd className="inline whitespace-pre-wrap break-words">
                                  {display(row.rawValue)}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-black">
                                  Normalized value:{" "}
                                </dt>
                                <dd className="inline whitespace-pre-wrap break-words">
                                  {display(row.normalizedValue)}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-black">
                                  Evidence class:{" "}
                                </dt>
                                <dd className="inline">
                                  {display(row.evidenceClass)}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-black">
                                  Procedencia:{" "}
                                </dt>
                                <dd className="inline">
                                  {display(row.sourceEvidenceClass)} ·{" "}
                                  {display(row.sourceType)}
                                </dd>
                              </div>
                            </dl>
                            {row.field === "title" && (
                              <span className="mt-1 block font-black text-amber-100">
                                SUPPLIER_STATED CONTEXT ONLY · no prueba
                                marca/modelo/variante
                              </span>
                            )}
                            {preservedPhysicalReference && (
                              <span className="mt-1 block font-black text-emerald-100">
                                REFERENCIA FÍSICA IMPORTADA PRESERVADA
                              </span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                    {identityEvidenceCandidates.length === 0 && (
                      <p className="text-xs font-black text-amber-100">
                        MISSING — no hay evidencia de identidad seleccionable.
                      </p>
                    )}
                  </div>
                </fieldset>
                <label
                  className="grid gap-2 text-xs font-black lg:col-span-2"
                  htmlFor="phase4-identity-human-reason"
                >
                  Motivo humano — humanReason · requerido
                  <textarea
                    id="phase4-identity-human-reason"
                    value={humanIdentityReviewDraft.humanReason}
                    onChange={(event) =>
                      setHumanIdentityReviewDraft((current) => ({
                        ...current,
                        humanReason: event.target.value,
                      }))}
                    className={`${textAreaClass} min-h-24`}
                  />
                </label>
                <button
                  type="button"
                  data-testid="save-human-identity-review"
                  disabled={
                    !humanIdentityReviewDraft.reviewer.trim() ||
                    !humanIdentityReviewDraft.humanReason.trim() ||
                    humanIdentityReviewDraft.evidenceIds.length === 0
                  }
                  onClick={() => void saveHumanIdentityReview()}
                  className={`min-h-12 rounded-2xl border border-violet-100/30 bg-violet-100/[0.08] px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 lg:col-span-2 ${buttonFocus}`}
                >
                  GUARDAR REVISIÓN DE IDENTIDAD
                </button>
                {Object.keys(savedHumanIdentityReview).length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingHumanIdentityReview(false)
                      const nextDraft =
                        humanIdentityReviewDraftFrom(identityReviewState)
                      setHumanIdentityReviewDraft(nextDraft)
                      setHumanIdentityReviewDraftBaseline(
                        cloneHumanIdentityReviewDraft(nextDraft),
                      )
                      setHumanIdentityRawInputSnapshot(
                        humanIdentityRawInputFrom(identityReviewState),
                      )
                      setHumanIdentityReviewError("")
                    }}
                    className={`min-h-11 rounded-xl border border-white/15 px-4 text-xs font-black lg:col-span-2 ${buttonFocus}`}
                  >
                    CANCELAR EDICIÓN
                  </button>
                )}
              </div>
            </fieldset>
          )}

          <section
            id="supplier-catalog-limitation"
            aria-labelledby="supplier-catalog-limitation-heading"
            className="mt-6 scroll-mt-28 rounded-3xl border border-amber-200/25 bg-amber-200/[0.045] p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-100/65">
                  {SUPPLIER_CATALOG_LIMITATION_CONTRACT_VERSION}
                </p>
                <h3
                  id="supplier-catalog-limitation-heading"
                  tabIndex={-1}
                  className="mt-2 scroll-mt-28 text-xl font-black outline-none"
                >
                  Proveedor sin identificadores adicionales
                </h3>
              </div>
              {Object.keys(activeSupplierCatalogAttestation).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-emerald-200/30 bg-emerald-200/[0.08] px-3 py-2 text-[10px] font-black text-emerald-50">
                    CATALOG INFORMATION EXHAUSTED
                  </span>
                  <span className="rounded-full border border-amber-200/30 bg-amber-200/[0.08] px-3 py-2 text-[10px] font-black text-amber-50">
                    RESEARCH ONLY — NOT EXACT IDENTITY
                  </span>
                </div>
              )}
            </div>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-white/65">
              El proveedor no ofrece más identificadores. Se permite investigar
              productos comparables, pero no se confirma que sean el mismo
              producto ni se permite publicar.
            </p>
            <p className="mt-3 rounded-2xl border border-rose-200/25 bg-rose-200/[0.06] p-3 text-xs font-black text-rose-50">
              Esta declaración no verifica físicamente el producto, no confirma
              identidad exacta y no libera Strategy Lab, package, publicación
              ni handoff.
            </p>
            {supplierCatalogLimitationError && (
              <div
                id="supplier-catalog-limitation-error"
                role="alert"
                tabIndex={-1}
                className="mt-4 scroll-mt-28 rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm font-black outline-none focus-visible:ring-2 focus-visible:ring-rose-100"
              >
                {supplierCatalogLimitationError}
              </div>
            )}
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-white/45">URL canónica de Luna</dt><dd className="mt-1 break-all font-mono">{display(supplierSourceCapture?.supplierUrl ?? sourceAccess.canonicalUrl)}</dd></div>
              <div><dt className="text-white/45">Hash de captura</dt><dd className="mt-1 break-all font-mono">{display(supplierSourceCapture?.contentHash)}</dd></div>
              <div><dt className="text-white/45">Parser version</dt><dd className="mt-1 break-all font-mono">{display(supplierSourceCapture?.parserVersion)}</dd></div>
              <div><dt className="text-white/45">Source contract</dt><dd className="mt-1 break-all font-mono">{display(supplierSourceCapture?.sourceContractVersion)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-white/45">Campos que continuarán MISSING</dt><dd className="mt-1 font-mono">{display(savedHumanIdentityReview.missingFields ?? [])}</dd></div>
              <div className="sm:col-span-2"><dt className="text-white/45">Evidencias utilizadas</dt><dd className="mt-1 break-all font-mono">{display(savedHumanIdentityReview.evidenceIds ?? [])}</dd></div>
            </dl>
            {Object.keys(activeSupplierCatalogAttestation).length > 0
              ? (
                <div className="mt-4 grid gap-3">
                  <JsonPanel
                    label="Declaración activa · resumen verificable"
                    value={activeSupplierCatalogAttestation}
                  />
                  <button
                    type="button"
                    onClick={deleteSupplierCatalogLimitation}
                    className={`min-h-11 rounded-xl border border-rose-200/25 px-4 text-xs font-black text-rose-100 ${buttonFocus}`}
                  >
                    ELIMINAR DECLARACIÓN ACTIVA
                  </button>
                </div>
              )
              : (
                <fieldset className="mt-4 grid gap-4 rounded-2xl border border-white/10 p-4 lg:grid-cols-2">
                  <legend className="px-2 text-xs font-black">
                    Declaración humana explícita
                  </legend>
                  <label className="grid gap-2 text-xs font-black" htmlFor="supplier-catalog-limitation-reviewer">
                    Revisor — reviewer · requerido
                    <input
                      id="supplier-catalog-limitation-reviewer"
                      value={supplierCatalogLimitationDraft.reviewer}
                      onChange={(event) =>
                        setSupplierCatalogLimitationDraft((current) => ({
                          ...current,
                          reviewer: event.target.value,
                        }))}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-2 text-xs font-black" htmlFor="supplier-catalog-limitation-reason">
                    Motivo humano — humanReason · requerido
                    <textarea
                      id="supplier-catalog-limitation-reason"
                      value={supplierCatalogLimitationDraft.humanReason}
                      onChange={(event) =>
                        setSupplierCatalogLimitationDraft((current) => ({
                          ...current,
                          humanReason: event.target.value,
                        }))}
                      className={`${textAreaClass} min-h-24`}
                    />
                  </label>
                  <label className="flex min-h-14 items-start gap-3 rounded-xl border border-amber-200/20 p-3 text-xs font-black lg:col-span-2">
                    <input
                      type="checkbox"
                      checked={supplierCatalogLimitationDraft.catalogExhaustionConfirmed}
                      onChange={(event) =>
                        setSupplierCatalogLimitationDraft((current) => ({
                          ...current,
                          catalogExhaustionConfirmed: event.target.checked,
                        }))}
                      className="mt-0.5 size-4"
                    />
                    Confirmo que revisé toda la información disponible del
                    catálogo del proveedor y que el proveedor no ofrece
                    identificadores adicionales para este producto.
                  </label>
                  <button
                    type="button"
                    data-testid="save-supplier-catalog-limitation"
                    disabled={
                      !supplierCatalogLimitationDraft.reviewer.trim() ||
                      !supplierCatalogLimitationDraft.humanReason.trim() ||
                      !supplierCatalogLimitationDraft.catalogExhaustionConfirmed ||
                      Object.keys(savedHumanIdentityReview).length === 0
                    }
                    onClick={() => void saveSupplierCatalogLimitation()}
                    className={`min-h-12 rounded-2xl border border-amber-100/30 bg-amber-100/[0.08] px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 lg:col-span-2 ${buttonFocus}`}
                  >
                    DECLARAR CATÁLOGO AGOTADO Y HABILITAR INVESTIGACIÓN LIMITADA
                  </button>
                </fieldset>
              )}
          </section>
        </section>

        <section
          id="strategy-input-preview"
          aria-labelledby="strategy-preview-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            5. MARKET EVIDENCE · 6–7. STRATEGY LAB INPUT PREVIEW
          </p>
          <h2
            id="strategy-preview-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            {readiness.researchEligibility === "ALLOWED_WITH_LIMITATIONS"
              ? "Investigación limitada y estrategia aún bloqueada"
              : "Market Evidence y Strategy Lab"}
          </h2>
          <section
            id="phase-5-market-evidence"
            aria-labelledby="phase-5-market-evidence-heading"
            className="mt-4 scroll-mt-28 rounded-3xl border border-amber-200/25 bg-amber-200/[0.045] p-4 sm:p-5"
          >
            <h3
              id="phase-5-market-evidence-heading"
              tabIndex={-1}
              className="scroll-mt-28 text-xl font-black outline-none"
            >
              {readiness.researchEligibility === "ALLOWED_WITH_LIMITATIONS"
                ? "Fase 5 · captura manual local de comparables generales"
                : "Fase 5 · evidencia de mercado"}
            </h3>
            {readiness.researchEligibility === "ALLOWED_WITH_LIMITATIONS" ? (
              <>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-200/25 px-3 py-2 text-[10px] font-black">
                {display(readiness.supplierCatalogCompleteness)}
              </span>
              <span className="rounded-full border border-amber-200/25 px-3 py-2 text-[10px] font-black">
                {display(readiness.researchEligibility)}
              </span>
              <span className="rounded-full border border-amber-200/25 px-3 py-2 text-[10px] font-black">
                {display(readiness.comparisonMode)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/60">
              Sólo puede usarse el productType confirmado, la cantidad del pack
              y especificaciones SUPPLIER_STATED claramente etiquetadas. No se
              permiten claims de marketing como hechos, marca/modelo inventados,
              coincidencias exactas, inferencias de demanda por stock ni
              observaciones visuales como PRODUCT_VERIFIED.
            </p>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200/20 p-3">
                <dt className="font-black text-emerald-100">Bloqueo para investigación</dt>
                <dd className="mt-2 font-mono">{readiness.researchEligibility === "ALLOWED_WITH_LIMITATIONS" ? "NONE — CAPTURE_GENERAL_PRODUCT_COMPARABLE_MARKET_EVIDENCE" : "SUPPLIER_CATALOG_LIMITATION_ATTESTATION_REQUIRED"}</dd>
              </div>
              <div className="rounded-xl border border-rose-200/20 p-3">
                <dt className="font-black text-rose-100">Bloqueos para estrategia/publicación</dt>
                <dd className="mt-2 font-mono">EXACT_IDENTITY_REQUIRED · REAL_COSTS_REQUIRED · BRAND_IP_REVIEW_REQUIRED · IMAGE_RIGHTS_REQUIRED · PACKAGE_AND_HANDOFF_BLOCKED</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-xl border border-white/10 p-3 text-xs font-black">
              Interfaz local únicamente · runStatus:{display(marketEvidence.runStatus)} · external requests:0 · mutating requests:0 · exactMarketplaceMatchAllowed:false · canTreatComparableAsSameProduct:false
            </p>
            <div
              id="general-product-comparable-capture"
              className="mt-4 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.035] p-4"
            >
              <h4 className="font-black">Capturar comparable general — GENERAL_PRODUCT_COMPARABLE</h4>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-black">
                  Referencia visible — sourceReference
                  <input id="general-comparable-source-reference" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-normal" value={generalComparableDraft.sourceReference} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, sourceReference: event.target.value }))} />
                </label>
                <label className="text-xs font-black">
                  URL copiada manualmente — ebayUrl
                  <input id="general-comparable-ebay-url" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-normal" value={generalComparableDraft.ebayUrl} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, ebayUrl: event.target.value }))} />
                </label>
                <label className="text-xs font-black sm:col-span-2">
                  Título observado — observedTitle
                  <input id="general-comparable-observed-title" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-normal" value={generalComparableDraft.observedTitle} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, observedTitle: event.target.value }))} />
                </label>
                <label className="text-xs font-black">
                  Precio observado — observedPriceApprox
                  <input id="general-comparable-price" inputMode="decimal" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-normal" value={generalComparableDraft.observedPriceApprox} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, observedPriceApprox: event.target.value }))} />
                </label>
                <label className="text-xs font-black">
                  Envío observado — observedShippingApprox
                  <input id="general-comparable-shipping" inputMode="decimal" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-normal" value={generalComparableDraft.observedShippingApprox} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, observedShippingApprox: event.target.value }))} />
                </label>
                <label className="text-xs font-black">
                  Moneda — currency
                  <input id="general-comparable-currency" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-normal" value={generalComparableDraft.currency} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, currency: event.target.value }))} />
                </label>
                <label className="text-xs font-black">
                  Condición — condition
                  <input id="general-comparable-condition" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-normal" value={generalComparableDraft.condition} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, condition: event.target.value }))} />
                </label>
                <label className="text-xs font-black sm:col-span-2">
                  Estado observado — listingStatus
                  <select id="general-comparable-listing-status" className="mt-1 w-full rounded-xl border border-white/10 bg-[#111722] px-3 py-2 font-normal" value={generalComparableDraft.listingStatus} onChange={(event) => setGeneralComparableDraft((current) => ({ ...current, listingStatus: event.target.value as GeneralComparableDraft["listingStatus"] }))}>
                    <option value="ACTIVE_VISIBLE">ACTIVE_VISIBLE</option>
                    <option value="SOLD_AUCTION_VISIBLE">SOLD_AUCTION_VISIBLE</option>
                    <option value="SOLD_USED_VISIBLE">SOLD_USED_VISIBLE</option>
                    <option value="ACTIVE_USED_VISIBLE">ACTIVE_USED_VISIBLE</option>
                  </select>
                </label>
              </div>
              <button type="button" className="mt-3 rounded-xl border border-cyan-200/25 px-4 py-2 text-xs font-black" onClick={captureGeneralComparable}>
                Guardar comparable general local
              </button>
            </div>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-white/60">
                La ruta de identidad exacta conserva sus gates normales de evidencia de mercado; la declaración de catálogo agotado no está activa.
              </p>
            )}
          </section>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatusCard label="Identity" value={readiness.productIdentity} />
            <StatusCard label="Identity confidence" value={readiness.identityConfidence} />
            <StatusCard label="Product facts" value={readiness.productFactsReadiness} />
            <StatusCard label="Supplier evidence" value={readiness.supplierEvidence} />
            <StatusCard label="Market" value={readiness.marketEvidence} />
            <StatusCard label="Economics" value={readiness.economics} />
            <StatusCard label="Strategy" value={readiness.strategy} />
          </div>
          <div className="mt-4 rounded-2xl border border-rose-200/20 bg-rose-200/[0.045] p-4">
            <h3 className="font-black">Identity review</h3>
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <div><dt className="text-white/45">Status</dt><dd className="mt-1 font-black">{display(identityReview.status)}</dd></div>
              <div><dt className="text-white/45">Confidence</dt><dd className="mt-1 font-black">{display(identityReview.confidence)}</dd></div>
              <div><dt className="text-white/45">Physical verification</dt><dd className="mt-1 font-black">{display(identityReview.physicalProductVerified)}</dd></div>
              <div className="sm:col-span-3"><dt className="text-white/45">Evidencias usadas en la revisión de identidad — evidenceIds</dt><dd className="mt-1 whitespace-pre-wrap font-mono">{display(savedHumanIdentityReview.evidenceIds ?? [])}</dd></div>
              <div className="sm:col-span-3"><dt className="text-white/45">Evidencias de verificación física — physicalVerificationEvidenceIds</dt><dd className="mt-1 whitespace-pre-wrap font-mono">{display(identityReview.physicalVerificationEvidenceIds)}</dd></div>
              <div className="sm:col-span-3"><dt className="text-white/45">Conflicts / blockers</dt><dd className="mt-1 whitespace-pre-wrap font-mono">{display(identityReview.currentConflict ?? identityReview.blockers)}</dd></div>
            </dl>
            <a
              href="#phase-4-identity-and-variants"
              onClick={(event) => {
                event.preventDefault()
                setActivePhaseIndex(3)
                focusProductCaseTarget(
                  "phase-4-identity-and-variants",
                  "identity-review-heading",
                )
              }}
              className={`mt-4 inline-flex min-h-11 items-center rounded-xl border border-rose-100/30 bg-rose-100/[0.07] px-4 text-xs font-black ${buttonFocus}`}
            >
              IR A REVISIÓN HUMANA DE IDENTIDAD
            </a>
          </div>
          <fieldset className="mt-4 rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.035] p-4 sm:p-5">
            <legend className="px-2 font-black">
              SCENARIO_ECONOMICS · JSON local fail-closed
            </legend>
            <p className="text-xs leading-5 text-white/50">
              Introduce evidencia enlazada sin defaults. `null` mantiene la
              fase bloqueada. El dominio valida nuevamente antes de producir
              cualquier preview; no existe fetch de eBay ni persistencia.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="grid gap-2 text-xs font-black" htmlFor="economics-policy-json">
                EconomicsPolicy JSON
                <textarea
                  id="economics-policy-json"
                  value={economicsPolicyJson}
                  onChange={(event) =>
                    setEconomicsPolicyJson(event.target.value)}
                  spellCheck={false}
                  className={`${textAreaClass} min-h-64`}
                />
                <button
                  type="button"
                  onClick={applyEconomicsPolicyJson}
                  className={`min-h-11 rounded-xl border border-cyan-200/25 px-4 font-black ${buttonFocus}`}
                >
                  VALIDAR ECONOMICS POLICY LOCAL
                </button>
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="scenario-draft-json">
                ProductCaseScenarioDraft JSON
                <textarea
                  id="scenario-draft-json"
                  value={scenarioDraftJson}
                  onChange={(event) =>
                    setScenarioDraftJson(event.target.value)}
                  spellCheck={false}
                  className={`${textAreaClass} min-h-64`}
                />
                <button
                  type="button"
                  onClick={applyScenarioDraftJson}
                  className={`min-h-11 rounded-xl border border-cyan-200/25 px-4 font-black ${buttonFocus}`}
                >
                  VALIDAR SCENARIO DRAFT LOCAL
                </button>
              </label>
            </div>
          </fieldset>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4">
              <p className="text-xs font-black uppercase tracking-wider text-cyan-100/55">
                CURRENT EVIDENCE LEADER
              </p>
              <p className="mt-2 text-xl font-black">{currentEvidenceLeader}</p>
              <p className="mt-2 text-sm leading-6 text-white/55">
                Escenario actualmente mejor respaldado; no está aprobado para ejecutar.
              </p>
            </div>
            <div className="rounded-2xl border border-violet-200/20 bg-violet-200/[0.05] p-4">
              <p className="text-xs font-black uppercase tracking-wider text-violet-100/55">
                STRATEGIC HYPOTHESIS TO VALIDATE
              </p>
              <p className="mt-2 text-xl font-black">{strategicHypothesis}</p>
              <p className="mt-2 text-sm leading-6 text-white/55">
                Una hipótesis humana no recibe puntos positivos ni autoriza handoff.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4">
            <h3 className="font-black">Market evidence</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs lg:grid-cols-6">
              <div><dt className="text-white/45">Validation</dt><dd className="mt-1 font-black">{display(readiness.marketEvidence)}</dd></div>
              <div><dt className="text-white/45">SOLD_EXACT</dt><dd className="mt-1 font-black">{display(marketEvidence.soldExact)}</dd></div>
              <div><dt className="text-white/45">SOLD_EXACT count</dt><dd className="mt-1 font-black">{display(marketEvidence.soldExactCount)}</dd></div>
              <div><dt className="text-white/45">ACTIVE_EXACT</dt><dd className="mt-1 font-black">{display(marketEvidence.activeExact)}</dd></div>
              <div><dt className="text-white/45">MARKET CEILING</dt><dd className="mt-1 font-black">{display(marketEvidence.marketCeiling)}</dd></div>
              <div><dt className="text-white/45">Reference median</dt><dd className="mt-1 font-black">{display(marketEvidence.referenceMedian)}</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-white/50">
              Todo candidato empieza NOT_VALIDATED. En la ruta limitada debe
              etiquetarse GENERAL_PRODUCT_COMPARABLE y nunca puede convertirse
              en coincidencia exacta. Fuera de esa ruta, sólo una revisión humana
              con identidad, variante, contenido, pack, Item ID activo, título
              y buyer shipping completos puede validarlo como ACTIVE_EXACT.
              Nunca se convierte en SOLD_EXACT ni en product fact.
            </p>
          </div>
          {Object.keys(stockEvidence).length > 0 && (
            <div className="mt-4 rounded-2xl border border-violet-200/20 bg-violet-200/[0.04] p-4">
              <h3 className="font-black">Supplier inventory signal</h3>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                <div><dt className="text-white/45">Observed value</dt><dd className="mt-1 font-black">{display(stockEvidence.normalizedValue)}</dd></div>
                <div><dt className="text-white/45">Availability purpose</dt><dd className="mt-1 font-black">{display(stockEvidence.availabilityPurpose)}</dd></div>
                <div><dt className="text-white/45">Demand evidence</dt><dd className="mt-1 font-black">{display(stockEvidence.demandEvidence)}</dd></div>
              </dl>
            </div>
          )}
          <div className="mt-4 grid gap-3">
            {marketEvidence.humanSuppliedComparableCandidates.map(
              (candidate, candidateIndex) => {
                const candidateKey =
                  `${candidate.ebayItemId ?? candidate.sourceReference}-${candidateIndex}`
                const draft = comparableReviewDrafts[candidateKey] ??
                  emptyComparableReviewDraft
                const setDraft = (
                  patch: Partial<ComparableReviewDraft>,
                ) =>
                  setComparableReviewDrafts((current) => ({
                    ...current,
                    [candidateKey]: { ...draft, ...patch },
                  }))
                return (
                  <article
                    key={candidateKey}
                    className="rounded-2xl border border-rose-200/20 bg-rose-200/[0.04] p-4"
                  >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-rose-100">
                        {candidate.sourceType}
                      </p>
                      <p className="mt-1 font-mono text-xs">
                        Item {candidate.ebayItemId}
                      </p>
                    </div>
                    <span className="rounded-full border border-rose-200/25 px-3 py-1 text-xs font-black text-rose-100">
                      {candidate.comparisonClass} · {candidate.validationStatus}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-white/55">
                    {candidate.validationBlockers.join(" · ")}
                  </p>
                  <p className="mt-2 text-xs font-black text-amber-100">
                    eligibleForSoldExact = {String(candidate.eligibleForSoldExact)}
                    {" · "}canBecomeProductFact = {String(candidate.canBecomeProductFact)}
                  </p>
                  <dl className="mt-3 grid gap-3 rounded-xl border border-white/10 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="text-white/45">Source reference</dt>
                      <dd className="mt-1 break-words font-black">{candidate.sourceReference}</dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Observed title</dt>
                      <dd className="mt-1 break-words font-black">{display(candidate.observedTitle)}</dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Copied URL</dt>
                      <dd className="mt-1 break-all font-mono">{display(candidate.ebayUrl)}</dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Observed price</dt>
                      <dd className="mt-1 font-black">{display(candidate.observedPriceApprox)} {display(candidate.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Observed shipping</dt>
                      <dd className="mt-1 font-black">{display(candidate.observedShippingApprox)} {display(candidate.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Condition · listing status</dt>
                      <dd className="mt-1 font-black">{display(candidate.condition)} · {candidate.listingStatus}</dd>
                    </div>
                  </dl>
                  <fieldset className="mt-4 rounded-2xl border border-white/10 p-4">
                    <legend className="px-2 text-xs font-black">
                      Human comparable review · no eBay fetch
                    </legend>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <label className="grid gap-2 text-xs font-black">
                        Decision
                        <select
                          value={draft.decision}
                          onChange={(event) =>
                            setDraft({
                              decision: event.target.value as
                                ComparableReviewDraft["decision"],
                            })}
                          className={inputClass}
                        >
                          <option value="KEEP_NOT_VALIDATED">
                            KEEP_NOT_VALIDATED
                          </option>
                          <option value="REJECT">REJECT</option>
                          <option
                            value="VALIDATE_ACTIVE_EXACT"
                            disabled={readiness.comparisonMode ===
                              "GENERAL_PRODUCT_COMPARABLES_ONLY" ||
                              candidate.comparisonClass ===
                                "GENERAL_PRODUCT_COMPARABLE"}
                          >
                            VALIDATE_ACTIVE_EXACT
                          </option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-xs font-black">
                        Reviewer
                        <input
                          value={draft.reviewer}
                          onChange={(event) =>
                            setDraft({ reviewer: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-black lg:col-span-2">
                        Reason · required
                        <textarea
                          value={draft.reason}
                          onChange={(event) =>
                            setDraft({ reason: event.target.value })}
                          className={`${textAreaClass} min-h-20`}
                        />
                      </label>
                      {([
                        ["identityVisualMatch", "Identity visual match"],
                        ["variantMatch", "Variant match"],
                        ["contentsMatch", "Contents match"],
                        ["packQuantityMatch", "Pack quantity match"],
                      ] as const).map(([field, label]) => (
                        <label
                          key={field}
                          className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 p-3 text-xs font-black"
                        >
                          <input
                            type="checkbox"
                            checked={draft[field]}
                            onChange={(event) =>
                              setDraft({ [field]: event.target.checked })}
                            className="size-4"
                          />
                          {label}
                        </label>
                      ))}
                      <label className="grid gap-2 text-xs font-black">
                        Validated title
                        <input
                          value={draft.validatedTitle}
                          onChange={(event) =>
                            setDraft({ validatedTitle: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-black">
                        Validated pack quantity
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={draft.validatedPackQuantity}
                          onChange={(event) =>
                            setDraft({
                              validatedPackQuantity: event.target.value,
                            })}
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-black">
                        Variant composition · comma or lines
                        <textarea
                          value={draft.validatedVariantComposition}
                          onChange={(event) =>
                            setDraft({
                              validatedVariantComposition:
                                event.target.value,
                            })}
                          className={`${textAreaClass} min-h-20`}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-black">
                        Buyer shipping · explicit 0 allowed
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.buyerShipping}
                          onChange={(event) =>
                            setDraft({ buyerShipping: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-black lg:col-span-2">
                        Reason codes · comma or lines
                        <textarea
                          value={draft.reasonCodes}
                          onChange={(event) =>
                            setDraft({ reasonCodes: event.target.value })}
                          className={`${textAreaClass} min-h-20`}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!draft.reason.trim() || !draft.reviewer.trim()}
                        onClick={() =>
                          commitComparableReview(
                            candidate,
                            candidateIndex,
                          )}
                        className={`min-h-11 rounded-xl border border-rose-200/25 px-4 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40 lg:col-span-2 ${buttonFocus}`}
                      >
                        APLICAR REVISIÓN HUMANA DEL CANDIDATO
                      </button>
                    </div>
                  </fieldset>
                </article>
                )
              },
            )}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <JsonPanel
              label={`Accepted evidence · ${acceptedEvidence.length}`}
              value={acceptedEvidence}
            />
            <JsonPanel
              label={`Rejected evidence · ${rejectedEvidence.length}`}
              value={rejectedEvidence}
            />
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <h3 className="font-black">Blockers y siguiente acción</h3>
            <p className="mt-2 break-words text-sm font-black text-amber-50">
              {text(
                strategyPreview.nextAction,
              )}
            </p>
            <p className="mt-2 break-words text-xs leading-5 text-white/55">
              {strings(
                strategyPreview.blockers,
              ).join(" · ") || "MISSING_INPUT"}
            </p>
          </div>
        </section>

        <section
          id="human-shadow-review"
          aria-labelledby="shadow-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            8. HUMAN REVIEW / SHADOW MODE
          </p>
          <h2
            id="shadow-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Conclusión humana separada del OS
          </h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-sm font-black" htmlFor="human-scenario">
              Offer scenario
              <select
                id="human-scenario"
                value={humanScenario}
                onChange={(event) => setHumanScenario(event.target.value)}
                className={inputClass}
              >
                <option value="">NOT_REVIEWED</option>
                <option value="SINGLE">SINGLE</option>
                <option value="TWO_PACK">TWO_PACK</option>
                <option value="THREE_PACK">THREE_PACK</option>
                <option value="MIXED_VARIANT_BUNDLE">
                  MIXED_VARIANT_BUNDLE
                </option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-black" htmlFor="human-conclusion">
              Human conclusion
              <select
                id="human-conclusion"
                value={humanConclusion}
                onChange={(event) => setHumanConclusion(event.target.value)}
                className={inputClass}
              >
                <option value="">NOT_REVIEWED</option>
                <option value="GO_SINGLE">GO_SINGLE</option>
                <option value="TEST_SINGLE">TEST_SINGLE</option>
                <option value="EVALUATE_TWO_PACK">EVALUATE_TWO_PACK</option>
                <option value="EVALUATE_THREE_PACK">EVALUATE_THREE_PACK</option>
                <option value="MIXED_VARIANT_BUNDLE">
                  MIXED_VARIANT_BUNDLE
                </option>
                <option value="HOLD_IDENTITY">HOLD_IDENTITY</option>
                <option value="HOLD_COMPATIBILITY">HOLD_COMPATIBILITY</option>
                <option value="HOLD_ECONOMICS">HOLD_ECONOMICS</option>
                <option value="HOLD_EVIDENCE_INCOMPLETE">HOLD_EVIDENCE_INCOMPLETE</option>
                <option value="NO_GO">NO_GO</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-black lg:col-span-2" htmlFor="human-conclusion-reason">
              Human reason
              <textarea
                id="human-conclusion-reason"
                value={humanReason}
                onChange={(event) => setHumanReason(event.target.value)}
                className={`${textAreaClass} min-h-24`}
              />
            </label>
            <label className="grid gap-2 text-sm font-black lg:col-span-2" htmlFor="rule-observation">
              Proposed rule observation · observation only
              <textarea
                id="rule-observation"
                value={proposedRuleObservation}
                onChange={(event) =>
                  setProposedRuleObservation(event.target.value)}
                className={`${textAreaClass} min-h-24`}
              />
            </label>
            <label className="grid gap-2 text-sm font-black" htmlFor="human-reviewer">
              Reviewer
              <input
                id="human-reviewer"
                value={humanReviewer}
                onChange={(event) => setHumanReviewer(event.target.value)}
                className={inputClass}
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={recordHumanConclusion}
                disabled={
                  !humanConclusion ||
                  !humanReason.trim() ||
                  !humanReviewer.trim()
                }
                className={`min-h-12 w-full rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.08] px-4 text-sm font-black text-cyan-50 disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}
              >
                REGISTRAR CONCLUSIÓN HUMANA LOCAL
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <StatusCard
              label="OS conclusion"
              value={osConclusion}
            />
            <StatusCard
              label="Human offer scenario"
              value={humanScenario || "NOT_REVIEWED"}
            />
            <StatusCard
              label="Human conclusion"
              value={humanConclusion || "NOT_REVIEWED"}
            />
            <StatusCard
              label="Differences"
              value={shadowMode.differences ?? "NOT_YET_COMPARED"}
            />
          </div>
        </section>

        <section
          id="manual-image-registry"
          aria-labelledby="image-registry-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            9. IMAGE REGISTRY / QA
          </p>
          <h2
            id="image-registry-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Registro textual y aprobación manual
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Sólo URL, metadatos, hash disponible y estado de revisión. Esta
            pantalla no muestra, descarga, transforma ni genera assets.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-amber-200/20 bg-amber-200/[0.04] p-4 text-xs lg:grid-cols-5">
            <div><dt className="text-white/45">Image analysis capability</dt><dd className="mt-1 font-black">{display(visualAnalysis.imageAnalysisCapability)}</dd></div>
            <div><dt className="text-white/45">Machine vision</dt><dd className="mt-1 font-black">{display(visualAnalysis.machineVisionStatus)}</dd></div>
            <div><dt className="text-white/45">OpenAI vision used</dt><dd className="mt-1 font-black">{display(visualAnalysis.openAiVisionUsed)}</dd></div>
            <div><dt className="text-white/45">Human review required</dt><dd className="mt-1 font-black">{display(visualAnalysis.humanReviewRequired)}</dd></div>
            <div><dt className="text-white/45">Visual evidence status</dt><dd className="mt-1 font-black">{display(visualAnalysis.visualEvidenceStatus)}</dd></div>
            <div className="col-span-2 lg:col-span-5"><dt className="text-white/45">Conflict detected from</dt><dd className="mt-1 font-black">{display(visualAnalysis.conflictDetectedFrom)}</dd></div>
          </dl>
          <div className="hidden" aria-hidden="true">
            {rows(visualAnalysis.observations).map((observation, index) => {
              const observationId = text(
                observation.imageId,
                `visual-observation-${index + 1}`,
              )
              const observationSourceUrl = text(observation.sourceUrl, "")
              return (
                <article
                  key={`${observationId}-${index}`}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-black">{observationId}</h3>
                    <span className="rounded-full border border-cyan-200/20 px-3 py-1 text-[10px] font-black uppercase">
                      {display(observation.reviewerType)}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-white/45">Source reference</dt>
                      <dd className="mt-1 break-all font-black">
                        {display(observation.sourceReference)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Source URL</dt>
                      <dd className="mt-1 break-all font-black">
                        {observationSourceUrl || "MISSING"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Capture method</dt>
                      <dd className="mt-1 font-black">
                        {display(observation.captureMethod)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Confidence</dt>
                      <dd className="mt-1 font-black">
                        {display(observation.confidence)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Human decision</dt>
                      <dd className="mt-1 font-black">
                        {display(observation.humanDecision)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-white/45">Observed product / variant</dt>
                      <dd className="mt-1 font-black">
                        {display(observation.observedProductType)}
                        {" · "}
                        {display(observation.observedVariant)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-white/45">Possible conflicts</dt>
                      <dd className="mt-1 font-black">
                        {display(observation.possibleConflicts)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-white/45">Evidence / content hash</dt>
                      <dd className="mt-1 break-all font-black">
                        {display(observation.evidenceId)}
                        {" · "}
                        {display(observation.contentHash)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-white/45">Contradicted supplier evidence IDs</dt>
                      <dd className="mt-1 break-all font-black">
                        {display(observation.contradictsEvidenceIds)}
                      </dd>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <dt className="text-white/45">Human reason</dt>
                      <dd className="mt-1 font-black">
                        {display(observation.humanReason)}
                      </dd>
                    </div>
                  </dl>
                </article>
              )
            })}
            {rows(visualAnalysis.observations).length === 0 && (
              <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm font-black text-white/45">
                VISUAL OBSERVATIONS: NOT_REVIEWED
              </p>
            )}
          </div>
          <a
            href="#human-visual-review"
            className={`mt-4 block rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4 text-sm font-black text-cyan-50 ${buttonFocus}`}
          >
            Administrar revisiones visuales en HUMAN_VISUAL_REVIEW
          </a>
          <fieldset
            className="hidden"
            aria-hidden="true"
            hidden
            disabled
          >
            <legend className="px-2 font-black">
              Registrar observación visual humana
            </legend>
            <p className="text-xs leading-5 text-white/50">
              Seller OS no ejecuta machine vision. La observación se asocia al
              identificador o referencia humana de la imagen; la URL es opcional
              y permanece MISSING cuando no existe una fuente real. No se infiere
              contenido desde filename, alt text o URL.
            </p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-image-id">
                Image ID
                <input
                  id="visual-observation-image-id"
                  value={visualObservationDraft.imageId}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      imageId: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-source-reference">
                Source reference · human supplied
                <input
                  id="visual-observation-source-reference"
                  placeholder="Referencia visible o identificador interno humano"
                  value={visualObservationDraft.sourceReference}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      sourceReference: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-source-url">
                Source URL HTTPS · optional
                <input
                  id="visual-observation-source-url"
                  type="url"
                  placeholder="MISSING cuando no existe URL real"
                  value={visualObservationDraft.sourceUrl}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      sourceUrl: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-reviewer-type">
                Reviewer type
                <select
                  id="visual-observation-reviewer-type"
                  value={visualObservationDraft.reviewerType}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      reviewerType: event.target.value as
                        VisualObservationDraft["reviewerType"],
                    }))}
                  className={inputClass}
                >
                  <option value="HUMAN">HUMAN</option>
                  <option value="CHATGPT_ASSISTED_HUMAN">
                    CHATGPT_ASSISTED_HUMAN
                  </option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-product-type">
                Observed product type
                <input
                  id="visual-observation-product-type"
                  value={visualObservationDraft.observedProductType}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      observedProductType: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              {([
                ["visibleFeatures", "Visible features · one per line"],
                ["visibleText", "Visible text · one per line"],
                ["visibleBrands", "Visible brands · one per line"],
                ["visibleColors", "Visible colors · one per line"],
              ] as const).map(([field, label]) => (
                <label
                  key={field}
                  className="grid gap-2 text-xs font-black"
                  htmlFor={`visual-observation-${field}`}
                >
                  {label}
                  <textarea
                    id={`visual-observation-${field}`}
                    value={visualObservationDraft[field]}
                    onChange={(event) =>
                      setVisualObservationDraft((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))}
                    className={`${textAreaClass} min-h-24`}
                  />
                </label>
              ))}
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-visible-quantity">
                Visible quantity
                <input
                  id="visual-observation-visible-quantity"
                  type="number"
                  min="0"
                  step="1"
                  value={visualObservationDraft.visibleQuantity}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      visibleQuantity: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-variant">
                Observed variant
                <input
                  id="visual-observation-variant"
                  value={visualObservationDraft.observedVariant}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      observedVariant: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black lg:col-span-2" htmlFor="visual-observation-conflicts">
                Possible conflicts · one per line
                <textarea
                  id="visual-observation-conflicts"
                  value={visualObservationDraft.possibleConflicts}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      possibleConflicts: event.target.value,
                    }))}
                  className={`${textAreaClass} min-h-24`}
                />
              </label>
              <fieldset className="rounded-2xl border border-amber-200/20 p-4 lg:col-span-2">
                <legend className="px-2 text-xs font-black">
                  Contradicted supplier evidence IDs · optional
                </legend>
                <p className="text-xs leading-5 text-white/45">
                  Selecciona únicamente la evidencia textual del proveedor que
                  esta observación contradice. El dominio enlaza la observación,
                  captura, conflicto y timeline.
                </p>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {contradictableSupplierEvidence.map((entry) => {
                    const row = record(entry)
                    const id = evidenceId(entry)
                    const checked =
                      visualObservationDraft.contradictsEvidenceIds.includes(id)
                    return (
                      <label
                        key={id}
                        className="flex min-h-11 items-start gap-3 rounded-xl border border-white/10 p-3 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setVisualObservationDraft((current) => ({
                              ...current,
                              contradictsEvidenceIds: event.target.checked
                                ? [...current.contradictsEvidenceIds, id]
                                : current.contradictsEvidenceIds.filter(
                                  (candidate) => candidate !== id,
                                ),
                            }))}
                          className="mt-0.5 size-4"
                        />
                        <span className="min-w-0">
                          <span className="block break-all font-black">{id}</span>
                          <span className="mt-1 block break-words text-white/45">
                            {display(row.field)} · {display(row.rawValue)}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                  {contradictableSupplierEvidence.length === 0 && (
                    <p className="rounded-xl border border-dashed border-white/10 p-3 font-black text-white/45 lg:col-span-2">
                      SUPPLIER TEXT EVIDENCE: MISSING
                    </p>
                  )}
                </div>
              </fieldset>
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-confidence">
                Confidence
                <select
                  id="visual-observation-confidence"
                  value={visualObservationDraft.confidence}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      confidence: event.target.value as
                        VisualObservationDraft["confidence"],
                    }))}
                  className={inputClass}
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="visual-observation-decision">
                Human decision
                <select
                  id="visual-observation-decision"
                  value={visualObservationDraft.humanDecision}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      humanDecision: event.target.value as
                        VisualObservationDraft["humanDecision"],
                    }))}
                  className={inputClass}
                >
                  <option value="ACCEPT_FOR_ANALYSIS">
                    ACCEPT_FOR_ANALYSIS
                  </option>
                  <option value="REJECT_FOR_EBAY_HANDOFF">
                    REJECT_FOR_EBAY_HANDOFF
                  </option>
                  <option value="NEEDS_MORE_EVIDENCE">
                    NEEDS_MORE_EVIDENCE
                  </option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-black lg:col-span-2" htmlFor="visual-observation-reason">
                Human reason · required
                <textarea
                  id="visual-observation-reason"
                  value={visualObservationDraft.humanReason}
                  onChange={(event) =>
                    setVisualObservationDraft((current) => ({
                      ...current,
                      humanReason: event.target.value,
                    }))}
                  className={`${textAreaClass} min-h-24`}
                />
              </label>
              <button
                type="button"
                onClick={registerVisualObservation}
                disabled={
                  !visualObservationDraft.imageId.trim() ||
                  !visualObservationDraft.humanReason.trim()
                }
                className={`min-h-12 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.08] px-4 text-sm font-black text-cyan-50 disabled:cursor-not-allowed disabled:opacity-40 lg:col-span-2 ${buttonFocus}`}
              >
                REGISTRAR OBSERVACIÓN VISUAL HUMANA
              </button>
            </div>
          </fieldset>
          <fieldset className="mt-4 rounded-3xl border border-violet-200/20 bg-violet-200/[0.04] p-4 sm:p-5">
            <legend className="px-2 font-black">
              Registrar metadatos de una imagen
            </legend>
            <p className="text-xs leading-5 text-white/50">
              El SHA-256 debe corresponder al asset real y ser aportado por el
              humano. Nunca se reutiliza el hash de la captura de página como
              hash de imagen.
            </p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-source-kind">
                Source kind
                <select
                  id="new-image-source-kind"
                  value={newImageDraft.sourceKind}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      sourceKind: event.target.value as
                        ProductCaseImageApproval["sourceKind"],
                    }))}
                  className={inputClass}
                >
                  <option value="ORIGINAL_SUPPLIER">ORIGINAL_SUPPLIER</option>
                  <option value="MANUALLY_PREPARED">MANUALLY_PREPARED</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-source-url">
                Source URL HTTPS
                <input
                  id="new-image-source-url"
                  type="url"
                  value={newImageDraft.sourceUrl}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      sourceUrl: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black lg:col-span-2" htmlFor="new-image-asset-hash">
                Asset SHA-256
                <input
                  id="new-image-asset-hash"
                  placeholder="sha256:…"
                  spellCheck={false}
                  value={newImageDraft.assetHash}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      assetHash: event.target.value.trim().toLowerCase(),
                    }))}
                  aria-describedby="new-image-hash-help"
                  className={`${inputClass} font-mono`}
                />
                <span id="new-image-hash-help" className="font-normal leading-5 text-white/45">
                  64 caracteres hexadecimales después de sha256:.
                </span>
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-purpose">
                Purpose
                <input
                  id="new-image-purpose"
                  value={newImageDraft.purpose}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      purpose: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-role">
                Role
                <select
                  id="new-image-role"
                  value={newImageDraft.role}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      role: event.target.value as
                        ProductCaseImageApproval["role"],
                    }))}
                  className={inputClass}
                >
                  <option value="MAIN">MAIN</option>
                  <option value="SECONDARY">SECONDARY</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-order">
                Order
                <input
                  id="new-image-order"
                  type="number"
                  min="1"
                  step="1"
                  value={newImageDraft.order}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      order: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-variant">
                Variant ID
                <input
                  id="new-image-variant"
                  value={newImageDraft.variantId}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      variantId: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-pack">
                Pack quantity
                <input
                  id="new-image-pack"
                  type="number"
                  min="1"
                  step="1"
                  value={newImageDraft.packQuantity}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      packQuantity: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-approval-status">
                Approval status
                <select
                  id="new-image-approval-status"
                  value={newImageDraft.status}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      status: event.target.value as
                        ProductCaseImageApproval["status"],
                    }))}
                  className={inputClass}
                >
                  <option value="SOURCE_REQUIRED">SOURCE_REQUIRED</option>
                  <option value="MANUAL_IMAGE_ATTACHED">MANUAL_IMAGE_ATTACHED</option>
                  <option value="HUMAN_REVIEW">HUMAN_REVIEW</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-black" htmlFor="new-image-reviewer">
                Reviewer
                <input
                  id="new-image-reviewer"
                  value={newImageDraft.reviewer}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      reviewer: event.target.value,
                    }))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-2 text-xs font-black lg:col-span-2" htmlFor="new-image-notes">
                Structured human visual observation
                <textarea
                  id="new-image-notes"
                  value={newImageDraft.humanNotes}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      humanNotes: event.target.value,
                    }))}
                  className={`${textAreaClass} min-h-24`}
                />
                <span className="font-normal leading-5 text-white/45">
                  Input humano o ChatGPT-assisted-human. Seller OS no ejecuta
                  machine vision y no infiere contenido desde filename, alt o URL.
                </span>
              </label>
              <label className="grid gap-2 text-xs font-black lg:col-span-2" htmlFor="new-image-reason">
                Review reason
                <textarea
                  id="new-image-reason"
                  value={newImageDraft.reason}
                  onChange={(event) =>
                    setNewImageDraft((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))}
                  className={`${textAreaClass} min-h-24`}
                />
              </label>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {([
                ["productAndVariantMatch", "Producto y variante coinciden"],
                ["packQuantityMatch", "Pack quantity coincide"],
                ["logosAndIpReviewed", "Logos e IP revisados"],
                ["claimsReviewed", "Claims revisados"],
                ["ebayRoleCoherent", "Rol marketplace coherente"],
              ] as const).map(([key, label]) => (
                <label
                  key={key}
                  className="flex min-h-12 items-center gap-2 rounded-xl border border-white/10 p-3 text-xs font-black"
                >
                  <input
                    type="checkbox"
                    checked={newImageDraft[key]}
                    onChange={(event) =>
                      setNewImageDraft((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))}
                    className="size-5"
                  />
                  {label}
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={registerManualImageMetadata}
              className={`mt-4 min-h-12 rounded-2xl border border-violet-200/30 bg-violet-200/[0.08] px-4 text-sm font-black text-violet-50 ${buttonFocus}`}
            >
              REGISTRAR METADATOS DE IMAGEN LOCALMENTE
            </button>
          </fieldset>
          <div className="mt-4 grid gap-3">
            {strings(imageRegistry.blockers).length > 0 && (
              <div className="rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4">
                <p className="font-black text-amber-50">Image QA blockers</p>
                <ul className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  {strings(imageRegistry.blockers).map((blocker) => (
                    <li key={blocker} className="rounded-xl bg-black/20 p-2">
                      <code>{blocker}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {imageRegistryEntries.length === 0 && (
              <p className="rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4 text-sm text-amber-50">
                SOURCE_REQUIRED — falta una fuente visual real y una main
                aprobada por humano.
              </p>
            )}
            {imageRegistryEntries.map((asset, index) => (
              <article
                key={text(asset.registryId ?? asset.sourceUrl, String(index))}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <p className="break-all font-mono text-xs">
                  {text(asset.sourceUrl)}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                  <div><dt className="text-white/40">Role</dt><dd className="mt-1 font-black">{text(asset.role)}</dd></div>
                  <div><dt className="text-white/40">Purpose / order</dt><dd className="mt-1 font-black">{text(asset.purpose)} · {text(asset.order)}</dd></div>
                  <div><dt className="text-white/40">Asset hash</dt><dd className="mt-1 break-all font-black">{text(asset.assetHash, "MISSING_NOT_PROVIDED")}</dd></div>
                  <div><dt className="text-white/40">Approval</dt><dd className="mt-1 font-black">{text(asset.approvalStatus, "HUMAN_REVIEW")}</dd></div>
                  <div><dt className="text-white/40">Pack quantity</dt><dd className="mt-1 font-black">{text(asset.packQuantity)}</dd></div>
                  <div><dt className="text-white/40">Variant</dt><dd className="mt-1 font-black">{text(asset.variantId)}</dd></div>
                  <div className="col-span-2"><dt className="text-white/40">Human notes</dt><dd className="mt-1 whitespace-pre-wrap font-black">{text(asset.humanNotes)}</dd></div>
                  <div className="col-span-2"><dt className="text-white/40">Source capture hash</dt><dd className="mt-1 break-all font-black">{text(asset.sourceCaptureHash, "MISSING")}</dd></div>
                  <div className="col-span-2"><dt className="text-white/40">Manual QA</dt><dd className="mt-1 break-words font-mono">{display(asset.qa)}</dd></div>
                </dl>
                {(() => {
                  const id = text(asset.evidenceId, "")
                  if (!id) {
                    return (
                      <p className="mt-3 text-xs leading-5 text-white/45">
                        Registro manual ya incorporado. Para cambiar sus
                        metadatos, retíralo reiniciando el expediente local y
                        vuelve a registrarlo; no existe persistencia server-side.
                      </p>
                    )
                  }
                  const draft = imageApprovalDrafts[id] ?? {
                    ...emptyImageApprovalDraft,
                    sourceKind: text(
                      asset.sourceKind,
                      "ORIGINAL_SUPPLIER",
                    ) as ProductCaseImageApproval["sourceKind"],
                    sourceUrl: text(asset.sourceUrl, ""),
                    assetHash: text(asset.assetHash, ""),
                    purpose: text(asset.purpose, ""),
                    role: text(asset.role, "SECONDARY") as
                      ProductCaseImageApproval["role"],
                    order: text(asset.order, ""),
                    variantId: text(asset.variantId, ""),
                    packQuantity: text(asset.packQuantity, ""),
                    humanNotes: text(asset.humanNotes, ""),
                    status: text(
                      asset.approvalStatus,
                      "HUMAN_REVIEW",
                    ) as ProductCaseImageApproval["status"],
                    reviewer: text(asset.reviewer, ""),
                    reason: "",
                    productAndVariantMatch:
                      record(asset.qa).productAndVariantMatch === true,
                    packQuantityMatch:
                      record(asset.qa).packQuantityMatch === true,
                    logosAndIpReviewed:
                      record(asset.qa).logosAndIpReviewed === true,
                    claimsReviewed:
                      record(asset.qa).claimsReviewed === true,
                    ebayRoleCoherent:
                      record(asset.qa).ebayRoleCoherent === true,
                  }
                  return (
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <label className="grid gap-2 text-xs font-black" htmlFor={`${id}-image-role`}>
                        Image role
                        <select
                          id={`${id}-image-role`}
                          value={draft.role}
                          onChange={(event) =>
                            setImageApprovalDraft(id, {
                              role: event.target.value as
                                ProductCaseImageApproval["role"],
                            }, draft)}
                          className={inputClass}
                        >
                          <option value="MAIN">MAIN</option>
                          <option value="SECONDARY">SECONDARY</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-xs font-black" htmlFor={`${id}-image-status`}>
                        Manual QA status
                        <select
                          id={`${id}-image-status`}
                          value={draft.status}
                          onChange={(event) =>
                            setImageApprovalDraft(id, {
                              status: event.target.value as
                                ProductCaseImageApproval["status"],
                            }, draft)}
                          className={inputClass}
                        >
                          <option value="SOURCE_REQUIRED">SOURCE_REQUIRED</option>
                          <option value="MANUAL_IMAGE_ATTACHED">MANUAL_IMAGE_ATTACHED</option>
                          <option value="HUMAN_REVIEW">HUMAN_REVIEW</option>
                          <option value="APPROVED">APPROVED</option>
                          <option value="REJECTED">REJECTED</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-xs font-black" htmlFor={`${id}-image-reviewer`}>
                        Reviewer
                        <input
                          id={`${id}-image-reviewer`}
                          value={draft.reviewer}
                          onChange={(event) =>
                            setImageApprovalDraft(id, {
                              reviewer: event.target.value,
                            }, draft)}
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-black" htmlFor={`${id}-image-reason`}>
                        Review reason
                        <input
                          id={`${id}-image-reason`}
                          value={draft.reason}
                          onChange={(event) =>
                            setImageApprovalDraft(id, {
                              reason: event.target.value,
                            }, draft)}
                          className={inputClass}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => commitImageApproval(asset)}
                        className={`min-h-11 rounded-xl border border-cyan-200/25 px-4 text-xs font-black text-cyan-50 lg:col-span-2 ${buttonFocus}`}
                      >
                        APLICAR QA MANUAL
                      </button>
                    </div>
                  )
                })()}
              </article>
            ))}
          </div>
        </section>

        <section
          id="manual-listing-handoff"
          aria-labelledby="manual-package-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            10. MANUAL_LISTING_PACKAGE · 11. MANUAL_EBAY_HANDOFF
          </p>
          <h2
            id="manual-package-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Paquete local o blockers explícitos
          </h2>
          {importRequiresHumanReReview && (
            <div className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-200/[0.07] p-4 text-amber-50">
              <p className="font-black">
                IMPORT VIEW_ONLY — HUMAN RE-REVIEW REQUIRED
              </p>
              <p className="mt-2 text-xs leading-5">
                La aprobación explícita y las aprobaciones de imágenes
                importadas fueron invalidadas en la copia de trabajo. Revisa
                localmente todos los gates y registra una nueva aprobación
                humana; ningún estado READY importado habilita el handoff.
              </p>
            </div>
          )}
          <ListingOperationsEditor
            value={listingOperations}
            onChange={setListingOperations}
            onReviewedAt={setRunnerTimestamp}
            onExplicitHumanApproval={() =>
              setImportRequiresHumanReReview(false)}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {packageGenerated ? (
              <JsonPanel
                label="Manual listing package"
                value={listingPackage}
              />
            ) : (
              <div className="rounded-2xl border border-rose-200/25 bg-rose-200/[0.06] p-4 text-rose-50">
                <p className="text-xs font-black uppercase tracking-wider opacity-60">
                  Manual listing package
                </p>
                <p className="mt-2 text-xl font-black">
                  NO GENERADO — {display(readiness.strategy)}
                </p>
                <p className="mt-2 text-sm font-black">
                  {display(listingPackageStatus)}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/55">
                  No existen campos de listing ejecutables o copiables mientras
                  el identity gate permanezca bloqueado.
                </p>
              </div>
            )}
            <JsonPanel
              label="MANUAL_LISTING_REGISTRATION_DRAFT"
              value={{
                documentType: "MANUAL_LISTING_REGISTRATION_DRAFT",
                ...registrationDraft,
              }}
            />
          </div>
          {!manualHandoffAllowed && (
            <div
              id="manual-handoff-blockers"
              className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-200/[0.07] p-4 text-amber-50"
            >
              <p className="font-black">MANUAL HANDOFF BLOCKED</p>
              <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                {(packageBlockers.length
                  ? packageBlockers
                  : ["PRODUCT_CASE_GATES_INCOMPLETE"]).map((blocker) => (
                  <li key={blocker} className="rounded-xl bg-black/20 p-2">
                    <code>{blocker}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            disabled={!manualHandoffAllowed || !packageGenerated}
            aria-describedby={!manualHandoffAllowed || !packageGenerated
              ? "manual-handoff-blockers"
              : undefined}
            onClick={generateManualPackage}
            className={`mt-4 min-h-14 w-full rounded-2xl bg-emerald-200 px-5 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-35 sm:w-auto ${buttonFocus}`}
          >
            GENERAR PAQUETE PARA PUBLICACIÓN MANUAL
          </button>
          {manualHandoffAllowed && packageGenerated && (
            <div className="mt-4 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.06] p-4">
              <h3 className="font-black">Instrucciones de Seller Hub · sólo humano</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-white/65">
                <li>Descarga y revisa el paquete local completo.</li>
                <li>Abre Seller Hub manualmente en una pestaña separada.</li>
                <li>Transcribe únicamente los campos aprobados.</li>
                <li>Realiza la revisión final dentro de Seller Hub.</li>
                <li>El humano pulsa “List it” allí; Seller OS no ejecuta ese paso.</li>
                <li>Registra después el Item ID en el borrador exportable.</li>
              </ol>
            </div>
          )}
          {generatedPackage && (
            <JsonPanel
              className="mt-4"
              label="Generated local package"
              value={generatedPackage}
            />
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportReviewedCase}
              className={`min-h-11 rounded-xl border border-cyan-200/25 px-4 text-xs font-black text-cyan-50 ${buttonFocus}`}
            >
              EXPORTAR PRODUCT CASE JSON
            </button>
            <button
              type="button"
              onClick={exportRegistrationDraft}
              className={`min-h-11 rounded-xl border border-violet-200/25 px-4 text-xs font-black text-violet-50 ${buttonFocus}`}
            >
              EXPORTAR REGISTRATION DRAFT JSON
            </button>
          </div>
          {workspaceExportError && (
            <p
              role="alert"
              data-testid="product-case-workspace-export-error"
              className="mt-3 rounded-2xl border border-rose-200/30 bg-rose-200/[0.08] p-4 text-sm font-bold text-rose-50"
            >
              {workspaceExportError}
            </p>
          )}
        </section>

        <section
          id="manual-listing-registration"
          aria-labelledby="manual-registration-heading"
          className="mt-5 scroll-mt-28 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            12. MANUAL_LISTING_REGISTRATION
          </p>
          <h2
            id="manual-registration-heading"
            tabIndex={-1}
            className="mt-2 scroll-mt-28 text-2xl font-black outline-none"
          >
            Registro posterior a la publicación manual
          </h2>
          <p className="mt-3 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.04] p-4 text-sm font-black leading-6 text-cyan-50">
            Después de publicar manualmente, registra el Item ID para iniciar el enlace y monitoreo read-only.
          </p>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-violet-100/55">
            POST-PIPELINE LEARNING OBSERVATION
          </p>
          <h3 className="mt-2 text-xl font-black">
            Observación supervisada; ninguna regla cambia
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatusCard label="Learning mode" value={learningObservation.status ?? "OBSERVATION_ONLY"} />
            <StatusCard label="Measurement" value={learningObservation.measurementStatus ?? "NOT_YET_MEASURED"} />
            <StatusCard label="Engine rule changed" value={learningObservation.engineRuleChanged ?? false} />
            <StatusCard label="Can change rules" value={learningObservation.canChangeEngineRules ?? false} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(["DAY_0", "DAY_7", "DAY_14", "DAY_30"] as const).map((day) => {
              const checkpoint = rows(
                output.futureMeasurementStages ??
                learningObservation.futureMeasurementStages,
              ).find((entry) =>
                text(entry.stage ?? entry.id ?? entry.day, "") === day
              )
              return (
                <div
                  key={day}
                  className="rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4"
                >
                  <p className="text-xs font-black text-amber-100">{day}</p>
                  <p className="mt-2 text-sm font-black">
                    {text(checkpoint?.status, "BLOCKED")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-white/45">
                    {text(
                      checkpoint?.reason,
                      "LISTING_NOT_LINKED_AND_MONITORING_OUT_OF_SCOPE",
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        <section
          aria-labelledby="phase-audit-heading"
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.025] p-5 sm:p-7"
        >
          <h2 id="phase-audit-heading" className="text-2xl font-black">
            Pipeline operativo canónico
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/50">
            Doce fases ordenadas y cinco estados posibles, calculados por el
            dominio. Cada fase muestra blockers y siguiente acción sin que la
            UI altere la propagación.
          </p>
          <div className={`mt-4 rounded-2xl border p-4 ${tone(
            firstBlockedPhase ? "BLOCKED" : "COMPLETED",
          )}`}>
            <p className="text-xs font-black uppercase tracking-wider opacity-60">
              Propagación del expediente
            </p>
            <p className="mt-2 text-lg font-black">
              {firstBlockedPhase
                ? `BLOCKED desde ${display(firstBlockedPhase.phase)}`
                : "COMPLETED · SIN BLOQUEO PROPAGADO"}
            </p>
            <p className="mt-2 text-xs leading-5 opacity-65">
              {firstBlockedPhase
                ? `${blockedPhaseSnapshots.length} fases reportan BLOCKED. Las fases posteriores conservan el estado calculado por el dominio; la UI no libera ni corrige gates.`
                : "Todas las fases conservan el estado calculado por el dominio."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRODUCT_CASE_OPERATIONAL_PHASES.map((phase, index) => {
                const snapshot = phaseSnapshots.find((candidate) =>
                  candidate.phase === phase
                )
                const status = text(snapshot?.status, "NOT_STARTED")
                return (
                  <span
                    key={phase}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${tone(status)}`}
                  >
                    {index + 1} {phase}: {status}
                  </span>
                )
              })}
            </div>
          </div>
          <div className="mt-4 grid gap-4">
            {phaseSnapshots.map((phase, index) => (
              <PhaseReport
                key={text(phase.phase, String(index))}
                phase={phase}
                index={index}
              />
            ))}
          </div>
        </section>
      </div>
      <SellerOsMobileNav active="operations" />
    </main>
  )
}

function StatusCard({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  return (
    <div className={`rounded-2xl border p-4 ${tone(value)}`}>
      <p className="text-[10px] font-black uppercase tracking-wider opacity-55">
        {label}
      </p>
      <p className="mt-2 break-words text-lg font-black">{display(value)}</p>
    </div>
  )
}

function JsonPanel({
  label,
  value,
  className = "",
}: {
  label: string
  value: unknown
  className?: string
}) {
  return (
    <details className={`min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4 ${className}`}>
      <summary className={`min-h-11 cursor-pointer font-black ${buttonFocus}`}>
        {label}
      </summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/35 p-3 text-[11px] leading-5 text-white/65">
        {display(value)}
      </pre>
    </details>
  )
}

function PhaseReport({
  phase,
  index,
}: {
  phase: JsonRecord
  index: number
}) {
  const phaseName =
    PRODUCT_CASE_OPERATIONAL_PHASES[index] ??
    text(phase.phase, `PHASE ${index + 1}`)
  const fields: Array<[string, unknown]> = [
    ["Input recibido", phase.input],
    ["Output producido", phase.output],
    ["Evidencia aceptada", phase.acceptedEvidenceIds],
    ["Evidencia rechazada", phase.rejectedEvidenceIds],
    ["Conflictos", phase.conflicts],
    ["Datos faltantes", phase.missingFields],
    ["Blockers", phase.blockers],
    ["Confidence", phase.confidence],
    ["Reglas aplicadas", phase.appliedRules],
    ["Siguiente acción", phase.nextAction],
    ["Publication status", phase.publicationStatus],
    ["Handoff artifact generated", phase.handoffArtifactGenerated],
  ]
  return (
    <article
      id={`product-case-phase-${index}`}
      tabIndex={-1}
      className="scroll-mt-28 scroll-mb-32 rounded-3xl border border-white/10 bg-black/20 p-4 outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-cyan-100/50">
            Operational phase {index + 1}
          </p>
          <h3 className="mt-1 text-lg font-black">{phaseName}</h3>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${tone(phase.status)}`}>
          {text(phase.status, "NOT_STARTED")}
        </span>
      </header>
      <dl className="mt-4 grid gap-3 lg:grid-cols-2">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-2xl border border-white/10 p-3"
          >
            <dt className="text-[10px] font-black uppercase tracking-wider text-white/40">
              {label}
            </dt>
            <dd className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-white/65">
              {display(value)}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

function splitLines(value: string) {
  return [...new Set(value.split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean))]
}

function ListingOperationsEditor({
  value,
  onChange,
  onReviewedAt,
  onExplicitHumanApproval,
}: {
  value: ProductCaseListingOperations
  onChange: (value: ProductCaseListingOperations) => void
  onReviewedAt: (value: string) => void
  onExplicitHumanApproval: () => void
}) {
  const [itemSpecificsJson, setItemSpecificsJson] = useState(
    () => JSON.stringify(value.itemSpecifics, null, 2),
  )
  const [itemSpecificsError, setItemSpecificsError] = useState("")
  const [evidenceLinksJson, setEvidenceLinksJson] = useState(
    () => JSON.stringify(value.evidenceLinks, null, 2),
  )
  const [evidenceLinksError, setEvidenceLinksError] = useState("")

  useEffect(() => {
    setItemSpecificsJson(JSON.stringify(value.itemSpecifics, null, 2))
    setItemSpecificsError("")
  }, [value.itemSpecifics])

  useEffect(() => {
    setEvidenceLinksJson(JSON.stringify(value.evidenceLinks, null, 2))
    setEvidenceLinksError("")
  }, [value.evidenceLinks])

  function update<K extends keyof ProductCaseListingOperations>(
    key: K,
    next: ProductCaseListingOperations[K],
  ) {
    onChange({ ...value, [key]: next })
  }

  function applyItemSpecifics() {
    try {
      const parsed: unknown = JSON.parse(itemSpecificsJson)
      const source = record(parsed)
      const normalized = Object.fromEntries(
        Object.entries(source).map(([key, entry]) => [
          key.trim(),
          Array.isArray(entry)
            ? entry.map((item) => String(item).trim()).filter(Boolean)
            : [String(entry).trim()].filter(Boolean),
        ]).filter(([key]) => Boolean(key)),
      )
      update("itemSpecifics", normalized)
      setItemSpecificsJson(JSON.stringify(normalized, null, 2))
      setItemSpecificsError("")
    } catch {
      setItemSpecificsError("ITEM_SPECIFICS_JSON_INVALID")
    }
  }

  function applyEvidenceLinks() {
    try {
      const parsed = record(JSON.parse(evidenceLinksJson))
      const arrayKeys = [
        "title",
        "category",
        "condition",
        "description",
        "listingPrice",
        "quantity",
        "economics",
        "policies",
        "itemLocation",
      ] as const
      const itemSpecificLinks = record(parsed.itemSpecifics)
      const normalized = {
        title: [],
        category: [],
        condition: [],
        itemSpecifics: Object.fromEntries(
          Object.entries(itemSpecificLinks).map(([key, entry]) => [
            key,
            strings(entry),
          ]),
        ),
        description: [],
        listingPrice: [],
        quantity: [],
        economics: [],
        policies: [],
        itemLocation: [],
      } as ProductCaseListingOperations["evidenceLinks"]
      for (const key of arrayKeys) normalized[key] = strings(parsed[key])
      update("evidenceLinks", normalized)
      setEvidenceLinksJson(JSON.stringify(normalized, null, 2))
      setEvidenceLinksError("")
    } catch {
      setEvidenceLinksError("EVIDENCE_LINKS_JSON_INVALID")
    }
  }

  function recordBrandReview() {
    const reviewedAt = new Date().toISOString()
    onReviewedAt(reviewedAt)
    update("brandIpClaimsReview", {
      ...value.brandIpClaimsReview,
      reviewedAt: value.brandIpClaimsReview.status === "NOT_REVIEWED"
        ? null
        : reviewedAt,
    })
  }

  function recordExplicitApproval() {
    const reviewedAt = new Date().toISOString()
    onReviewedAt(reviewedAt)
    update("explicitHumanApproval", {
      ...value.explicitHumanApproval,
      reviewedAt: value.explicitHumanApproval.approved
        ? reviewedAt
        : null,
    })
    if (value.explicitHumanApproval.approved) {
      onExplicitHumanApproval()
    }
  }

  function recordOverride() {
    const reviewedAt = new Date().toISOString()
    onReviewedAt(reviewedAt)
    update("humanOverride", {
      ...value.humanOverride,
      reviewedAt: value.humanOverride.applied ? reviewedAt : null,
    })
  }

  return (
    <details className="mt-4 rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.035] p-4 sm:p-5">
      <summary className={`min-h-11 cursor-pointer text-lg font-black ${buttonFocus}`}>
        Inputs locales de los 15 gates operativos
      </summary>
      <p className="mt-2 max-w-4xl text-xs leading-5 text-white/50">
        Campos vacíos permanecen MISSING. Nada se completa desde el proveedor,
        competidores o valores sintéticos. Este formulario sólo construye un
        borrador en memoria.
      </p>

      <fieldset className="mt-5 rounded-2xl border border-white/10 p-4">
        <legend className="px-2 font-black">Contenido, categoría y condición</legend>
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-title">
            EBAY_OPTIMIZED_TITLE_DRAFT · máximo 80
            <input
              id="ops-title"
              maxLength={80}
              value={value.title ?? ""}
              onChange={(event) => update("title", event.target.value || null)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-description">
            Human-reviewed description
            <textarea
              id="ops-description"
              value={value.description ?? ""}
              onChange={(event) =>
                update("description", event.target.value || null)}
              className={`${textAreaClass} min-h-24`}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-category-id">
            Category ID
            <input
              id="ops-category-id"
              value={value.categoryId ?? ""}
              onChange={(event) =>
                update("categoryId", event.target.value || null)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-category-name">
            Category name
            <input
              id="ops-category-name"
              value={value.categoryName ?? ""}
              onChange={(event) =>
                update("categoryName", event.target.value || null)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-condition-id">
            Condition ID
            <input
              id="ops-condition-id"
              value={value.conditionId ?? ""}
              onChange={(event) =>
                update("conditionId", event.target.value || null)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-condition-description">
            Condition description
            <input
              id="ops-condition-description"
              value={value.conditionDescription ?? ""}
              onChange={(event) =>
                update(
                  "conditionDescription",
                  event.target.value || null,
                )}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-required-specifics">
            Required item specifics · uno por línea
            <textarea
              id="ops-required-specifics"
              value={value.requiredItemSpecifics.join("\n")}
              onChange={(event) =>
                update(
                  "requiredItemSpecifics",
                  splitLines(event.target.value),
                )}
              className={`${textAreaClass} min-h-24`}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-item-specifics">
            Item specifics JSON
            <textarea
              id="ops-item-specifics"
              spellCheck={false}
              value={itemSpecificsJson}
              onChange={(event) => setItemSpecificsJson(event.target.value)}
              aria-invalid={Boolean(itemSpecificsError)}
              aria-describedby="ops-item-specifics-status"
              className={`${textAreaClass} min-h-32`}
            />
          </label>
          <label className="grid gap-2 text-xs font-black lg:col-span-2" htmlFor="ops-evidence-links">
            Evidence links JSON · sólo IDs de evidencia aceptada
            <textarea
              id="ops-evidence-links"
              spellCheck={false}
              value={evidenceLinksJson}
              onChange={(event) => setEvidenceLinksJson(event.target.value)}
              aria-invalid={Boolean(evidenceLinksError)}
              aria-describedby="ops-evidence-links-status"
              className={`${textAreaClass} min-h-48`}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={applyItemSpecifics}
            className={`min-h-11 rounded-xl border border-cyan-200/25 px-4 text-xs font-black text-cyan-50 ${buttonFocus}`}
          >
            APLICAR ITEM SPECIFICS JSON LOCALMENTE
          </button>
          <p
            id="ops-item-specifics-status"
            role={itemSpecificsError ? "alert" : "status"}
            className={itemSpecificsError
              ? "text-xs font-black text-rose-200"
              : "text-xs text-white/45"}
          >
            {itemSpecificsError ||
              `${Object.keys(value.itemSpecifics).length} specifics aplicados`}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={applyEvidenceLinks}
            className={`min-h-11 rounded-xl border border-violet-200/25 px-4 text-xs font-black text-violet-50 ${buttonFocus}`}
          >
            APLICAR EVIDENCE LINKS JSON LOCALMENTE
          </button>
          <p
            id="ops-evidence-links-status"
            role={evidenceLinksError ? "alert" : "status"}
            className={evidenceLinksError
              ? "text-xs font-black text-rose-200"
              : "text-xs text-white/45"}
          >
            {evidenceLinksError ||
              "El engine comprobará cada ID contra evidencia aceptada."}
          </p>
        </div>
      </fieldset>

      <fieldset className="mt-4 rounded-2xl border border-white/10 p-4">
        <legend className="px-2 font-black">Offer y economía revisada</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["listingPrice", "Listing price", "0.01"],
            ["quantity", "Quantity", "1"],
            ["totalInvestment", "Total investment", "0.01"],
            ["estimatedProfit", "Estimated profit", "0.01"],
            ["marginPercent", "Margin percent", "0.01"],
            ["roiPercent", "ROI percent", "0.01"],
          ] as const).map(([key, label, step]) => (
            <label key={key} className="grid gap-2 text-xs font-black" htmlFor={`ops-${key}`}>
              {label}
              <input
                id={`ops-${key}`}
                type="number"
                step={step}
                value={value[key] ?? ""}
                onChange={(event) =>
                  update(
                    key,
                    key === "quantity"
                      ? nullableInteger(event.target.value)
                      : nullableNumber(event.target.value),
                  )}
                className={inputClass}
              />
            </label>
          ))}
          <label className="grid gap-2 text-xs font-black sm:col-span-2" htmlFor="ops-availability">
            Supplier availability
            <select
              id="ops-availability"
              value={value.supplierAvailabilityStatus}
              onChange={(event) =>
                update(
                  "supplierAvailabilityStatus",
                  event.target.value as
                    ProductCaseListingOperations["supplierAvailabilityStatus"],
                )}
              className={inputClass}
            >
              <option value="NOT_CONFIRMED">NOT_CONFIRMED</option>
              <option value="CONFIRMED_AVAILABLE">CONFIRMED_AVAILABLE</option>
              <option value="CONFIRMED_UNAVAILABLE">CONFIRMED_UNAVAILABLE</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="mt-4 rounded-2xl border border-white/10 p-4">
        <legend className="px-2 font-black">
          Policies, handling e item location
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["fulfillmentPolicyId", "Fulfillment policy ID"],
            ["paymentPolicyId", "Payment policy ID"],
            ["returnPolicyId", "Return policy ID"],
            ["shippingPolicySummary", "Shipping policy summary"],
            ["returnPolicySummary", "Return policy summary"],
          ] as const).map(([key, label]) => (
            <label key={key} className="grid gap-2 text-xs font-black" htmlFor={`ops-${key}`}>
              {label}
              <input
                id={`ops-${key}`}
                value={value[key] ?? ""}
                onChange={(event) =>
                  update(key, event.target.value || null)}
                className={inputClass}
              />
            </label>
          ))}
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-handling">
            Handling time days
            <input
              id="ops-handling"
              type="number"
              min="0"
              step="1"
              value={value.handlingTimeDays ?? ""}
              onChange={(event) =>
                update(
                  "handlingTimeDays",
                  nullableInteger(event.target.value),
                )}
              className={inputClass}
            />
          </label>
          {([
            ["country", "Country"],
            ["postalCode", "Postal code"],
            ["city", "City"],
            ["stateOrProvince", "State / province"],
          ] as const).map(([key, label]) => (
            <label key={key} className="grid gap-2 text-xs font-black" htmlFor={`ops-location-${key}`}>
              {label}
              <input
                id={`ops-location-${key}`}
                value={value.itemLocation[key] ?? ""}
                onChange={(event) =>
                  update("itemLocation", {
                    ...value.itemLocation,
                    [key]: event.target.value || null,
                  })}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4 rounded-2xl border border-white/10 p-4">
        <legend className="px-2 font-black">
          Evidencia, orden visual, supuestos y diferencias
        </legend>
        <div className="grid gap-3 lg:grid-cols-2">
          {([
            ["imageEvidenceOrder", "Image registry IDs en orden"],
            ["supportingEvidenceIds", "Supporting accepted evidence IDs"],
            ["assumptions", "Assumptions declaradas"],
            ["blockers", "Blockers declarados"],
            ["differences", "OS vs human differences"],
          ] as const).map(([key, label]) => (
            <label key={key} className="grid gap-2 text-xs font-black" htmlFor={`ops-${key}`}>
              {label} · uno por línea
              <textarea
                id={`ops-${key}`}
                value={value[key].join("\n")}
                onChange={(event) =>
                  update(key, splitLines(event.target.value))}
                className={`${textAreaClass} min-h-24`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4 rounded-2xl border border-white/10 p-4">
        <legend className="px-2 font-black">Brand, IP y claims review</legend>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-brand-status">
            Status
            <select
              id="ops-brand-status"
              value={value.brandIpClaimsReview.status}
              onChange={(event) =>
                update("brandIpClaimsReview", {
                  ...value.brandIpClaimsReview,
                  status: event.target.value as
                    ProductCaseListingOperations["brandIpClaimsReview"]["status"],
                  reviewedAt: null,
                })}
              className={inputClass}
            >
              <option value="NOT_REVIEWED">NOT_REVIEWED</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-brand-reviewer">
            Reviewer
            <input
              id="ops-brand-reviewer"
              value={value.brandIpClaimsReview.reviewer ?? ""}
              onChange={(event) =>
                update("brandIpClaimsReview", {
                  ...value.brandIpClaimsReview,
                  reviewer: event.target.value || null,
                  reviewedAt: null,
                })}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-brand-reason">
            Reason
            <input
              id="ops-brand-reason"
              value={value.brandIpClaimsReview.reason ?? ""}
              onChange={(event) =>
                update("brandIpClaimsReview", {
                  ...value.brandIpClaimsReview,
                  reason: event.target.value || null,
                  reviewedAt: null,
                })}
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={
            value.brandIpClaimsReview.status === "NOT_REVIEWED" ||
            !value.brandIpClaimsReview.reviewer ||
            !value.brandIpClaimsReview.reason
          }
          onClick={recordBrandReview}
          className={`mt-3 min-h-11 rounded-xl border border-cyan-200/25 px-4 text-xs font-black disabled:opacity-40 ${buttonFocus}`}
        >
          REGISTRAR BRAND / IP / CLAIMS REVIEW
        </button>
      </fieldset>

      <fieldset className="mt-4 rounded-2xl border border-white/10 p-4">
        <legend className="px-2 font-black">Explicit human handoff approval</legend>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 p-3 text-xs font-black">
            <input
              type="checkbox"
              checked={value.explicitHumanApproval.approved}
              onChange={(event) =>
                update("explicitHumanApproval", {
                  ...value.explicitHumanApproval,
                  approved: event.target.checked,
                  reviewedAt: null,
                })}
              className="size-5"
            />
            Approval explicitly granted
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-approval-reviewer">
            Reviewer
            <input
              id="ops-approval-reviewer"
              value={value.explicitHumanApproval.reviewer ?? ""}
              onChange={(event) =>
                update("explicitHumanApproval", {
                  ...value.explicitHumanApproval,
                  reviewer: event.target.value || null,
                  reviewedAt: null,
                })}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-approval-reason">
            Reason
            <input
              id="ops-approval-reason"
              value={value.explicitHumanApproval.reason ?? ""}
              onChange={(event) =>
                update("explicitHumanApproval", {
                  ...value.explicitHumanApproval,
                  reason: event.target.value || null,
                  reviewedAt: null,
                })}
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={
            !value.explicitHumanApproval.approved ||
            !value.explicitHumanApproval.reviewer ||
            !value.explicitHumanApproval.reason
          }
          onClick={recordExplicitApproval}
          className={`mt-3 min-h-11 rounded-xl border border-cyan-200/25 px-4 text-xs font-black disabled:opacity-40 ${buttonFocus}`}
        >
          REGISTRAR APROBACIÓN EXPLÍCITA LOCAL
        </button>
      </fieldset>

      <fieldset className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/[0.035] p-4">
        <legend className="px-2 font-black">Human override record</legend>
        <p className="text-xs leading-5 text-amber-50/70">
          Un override queda registrado pero no convierte evidencia faltante en
          evidencia presente y no omite ninguno de los 15 gates.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 p-3 text-xs font-black">
            <input
              type="checkbox"
              checked={value.humanOverride.applied}
              onChange={(event) =>
                update("humanOverride", {
                  ...value.humanOverride,
                  applied: event.target.checked,
                  reviewedAt: null,
                })}
              className="size-5"
            />
            Record override observation
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-override-reviewer">
            Reviewer
            <input
              id="ops-override-reviewer"
              value={value.humanOverride.reviewer ?? ""}
              onChange={(event) =>
                update("humanOverride", {
                  ...value.humanOverride,
                  reviewer: event.target.value || null,
                  reviewedAt: null,
                })}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-override-reason">
            Reason
            <input
              id="ops-override-reason"
              value={value.humanOverride.reason ?? ""}
              onChange={(event) =>
                update("humanOverride", {
                  ...value.humanOverride,
                  reason: event.target.value || null,
                  reviewedAt: null,
                })}
              className={inputClass}
            />
          </label>
          <label className="grid gap-2 text-xs font-black" htmlFor="ops-overridden-blockers">
            Referenced blockers · uno por línea
            <textarea
              id="ops-overridden-blockers"
              value={value.humanOverride.overriddenBlockers.join("\n")}
              onChange={(event) =>
                update("humanOverride", {
                  ...value.humanOverride,
                  overriddenBlockers: splitLines(event.target.value),
                  reviewedAt: null,
                })}
              className={`${textAreaClass} min-h-24`}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={
            !value.humanOverride.applied ||
            !value.humanOverride.reviewer ||
            !value.humanOverride.reason
          }
          onClick={recordOverride}
          className={`mt-3 min-h-11 rounded-xl border border-amber-200/25 px-4 text-xs font-black disabled:opacity-40 ${buttonFocus}`}
        >
          REGISTRAR OVERRIDE COMO OBSERVACIÓN
        </button>
      </fieldset>
    </details>
  )
}
