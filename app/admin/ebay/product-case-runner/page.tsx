"use client"

import { useMemo, useRef, useState } from "react"

import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"
import { supabase } from "@/lib/supabase"
import {
  applyProductCaseEvidenceReview,
  buildProductCaseRunnerOutput,
  buildStrategyLabAdapterPreview,
  createHumanVisualReviewRecord,
  createManualAuthenticatedSupplierSourceCapture,
  extractProductCaseEvidence,
  importProductCaseWorkspaceExport,
  mergeProductCaseEvidenceCaptures,
  PRODUCT_CASE_CONTENT_MAX_BYTES,
  PRODUCT_CASE_OPERATIONAL_PHASES,
  PRODUCT_CASE_RUNNER_VERSION,
  PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES,
  PRODUCT_CASE_ZERO_EFFECTS,
  reviewHumanComparableCandidate,
  serializeProductCaseWorkspaceExport,
  transitionProductCaseSupplierCapture,
  validateManualAuthenticatedVisibleSourceText,
  validateLunaProductUrl,
  type ProductCaseDocument,
  type ProductCaseImageApproval,
  type ProductCaseListingOperations,
  type ProductCaseSupplierSourceCapture,
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
  canonicalJson: string
  domainValidated: true
  workspaceDeepEquivalent: boolean
  outputDeepEquivalent: boolean
  importedManualHandoffTrusted: false
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
  const [importRoundtrip, setImportRoundtrip] =
    useState<ProductCaseImportRoundtrip | null>(null)
  const [importRequiresHumanReReview, setImportRequiresHumanReReview] =
    useState(false)
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
  const [runnerTimestamp, setRunnerTimestamp] = useState(() =>
    text(fixtureDocument.createdAt, new Date().toISOString())
  )
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)

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
  const contradictableSupplierEvidence = evidence.filter((entry) => {
    const row = record(entry)
    return ["title", "description", "product_type"].includes(
      text(row.field, ""),
    ) && ["SUPPLIER_STATED", "PRODUCT_VERIFIED"].includes(
      text(row.sourceEvidenceClass, ""),
    )
  })
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

  function changeSourceUrl(nextUrl: string) {
    const changedAt = new Date().toISOString()
    setSourceUrl(nextUrl)
    setFixtureActive(false)
    setCaseId("product-case-browser-draft")
    setProductLabel("BROWSER PRODUCT CASE DRAFT")
    setCaseCreatedAt(changedAt)
    setRunnerTimestamp(changedAt)
    setPreflight(null)
    setImportedSourceAccess(null)
    setImportJson("")
    setImportRoundtrip(null)
    setImportRequiresHumanReReview(false)
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
    })
    setEconomicsPolicy(null)
    setScenarioDraft(null)
    setEconomicsPolicyJson("null")
    setScenarioDraftJson("null")
    setReviewDrafts({})
    setAppliedReviewDecisions({})
    setComparableReviewDrafts({})
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
      } else {
        setCaptures((current) => [...current, result.capture])
        setEvidence((current) => mergeEvidence(current, result.evidence))
        setSupplierSourceCapture(null)
        setIdentityReviewState((current) => ({
          ...current,
          status: "NOT_REVIEWED",
          confidence: "LOW",
          physicalProductVerified: false,
          physicalVerificationEvidenceIds: [],
          currentConflict: null,
          supplierEvidenceIds: [],
          humanObservationEvidenceIds: [],
          blockers: ["HUMAN_IDENTITY_REVIEW_REQUIRED"],
          nextAction: "REVIEW_PRODUCT_EVIDENCE",
        }))
      }
      const proposedTitle = result.evidence.find((entry) =>
        entry.field === "title" &&
        entry.evidenceStatus !== "MISSING"
      )
      if (proposedTitle && typeof proposedTitle.normalizedValue === "string") {
        setProductLabel(proposedTitle.normalizedValue)
      }
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
      setEvidence(reviewedEvidence)
      setAppliedReviewDecisions((current) => ({
        ...current,
        [id]: draft.action,
      }))
      setNotice(
        `${id}: ${draft.action}. El valor raw/original permanece preservado.`,
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
      const visualRecord = await createHumanVisualReviewRecord({
        document: productCase,
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
      })
      setEvidence(visualRecord.updatedEvidence)
      setCaptures((current) =>
        current.some((capture) =>
            record(capture).contentHash === visualRecord.capture.contentHash &&
            record(capture).sourceType === "HUMAN_VISUAL_OBSERVATION"
          )
          ? current
          : [...current, visualRecord.capture]
      )
      setImageAnalysis((current) => ({
        ...current,
        visualEvidenceStatus: "HUMAN_REVIEWED",
        conflictDetectedFrom: visualRecord.identityConflict
          ? ["SUPPLIER_TEXT", "HUMAN_VISUAL_REVIEW"]
          : current.conflictDetectedFrom,
        observations: [
          ...current.observations.filter((entry) =>
            entry.evidenceId !== visualRecord.observation.evidenceId
          ),
          visualRecord.observation,
        ],
      }))
      setIdentityReviewState((current) => visualRecord.identityConflict
        ? {
            ...current,
            status: "CONFLICTED",
            confidence: "LOW",
            physicalProductVerified: false,
            conflictHistory: [
              ...current.conflictHistory,
              ...possibleConflicts,
            ].filter((entry, index, all) => all.indexOf(entry) === index),
            currentConflict: possibleConflicts.join(" · "),
            supplierEvidenceIds: [
              ...current.supplierEvidenceIds,
              ...draft.contradictsEvidenceIds,
            ].filter((entry, index, all) => all.indexOf(entry) === index),
            humanObservationEvidenceIds: [
              ...current.humanObservationEvidenceIds,
              visualRecord.observation.evidenceId,
            ].filter((entry, index, all) => all.indexOf(entry) === index),
            blockers: [
              ...current.blockers,
              "PHYSICAL_PRODUCT_AND_VARIANT_VERIFICATION_REQUIRED",
            ].filter((entry, index, all) => all.indexOf(entry) === index),
            nextAction: "VERIFY_PHYSICAL_PRODUCT_AND_VARIANT",
          }
        : {
            ...current,
            humanObservationEvidenceIds: [
              ...current.humanObservationEvidenceIds,
              visualRecord.observation.evidenceId,
            ].filter((entry, index, all) => all.indexOf(entry) === index),
          })
      setRunnerTimestamp(reviewedAt)
      setVisualObservationDraft({ ...emptyVisualObservationDraft })
      setNotice(
        "Revisión visual humana agregada en memoria. Seller OS no ejecutó machine vision.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "HUMAN_VISUAL_REVIEW_INVALID",
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
        return {
          ...current,
          activeExact: candidates.some((entry) =>
              entry.validationStatus === "VALIDATED_ACTIVE_EXACT"
            )
            ? "AVAILABLE"
            : candidates.length
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
    setError("")
    setNotice("")
    try {
      const importedResult = await importProductCaseWorkspaceExport(rawJson)
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
      const importedOperationalPipeline = rows(
        importedOutput.operationalPipeline,
      )
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
        const importedPhase = importedOperationalPipeline[position]
        const rebuiltPhase = rebuiltOperationalPipeline[position]
        if (
          importedOperationalPipeline.length !==
            PRODUCT_CASE_OPERATIONAL_PHASES.length ||
          rebuiltOperationalPipeline.length !==
            PRODUCT_CASE_OPERATIONAL_PHASES.length ||
          importedPhase?.phase !== phase ||
          rebuiltPhase?.phase !== phase ||
          !validStatuses.has(text(importedPhase?.status, "")) ||
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
      const canonicalJson = JSON.stringify(importedEnvelope, null, 2)
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
      setImageApprovals([])
      setImageApprovalDrafts({})
      setNewImageDraft({ ...emptyImageApprovalDraft })
      setVisualObservationDraft({ ...emptyVisualObservationDraft })
      setListingOperations({
        ...structuredClone(importedWorkspace.listingOperations),
        explicitHumanApproval: {
          approved: false,
          reviewer: null,
          reviewedAt: null,
          reason: null,
        },
      })
      setGeneratedPackage(null)
      setImportRequiresHumanReReview(true)
      setImportJson(canonicalJson)
      setImportRoundtrip({
        source,
        imported: importedEnvelope,
        rebuilt: record(rebuiltOutput),
        canonicalJson,
        domainValidated: true,
        workspaceDeepEquivalent,
        outputDeepEquivalent,
        importedManualHandoffTrusted:
          importedResult.importedManualHandoffTrusted,
        phaseContract:
          "PRODUCT_CASE_OPERATIONAL_PIPELINE_12_PHASES_5_STATUSES",
      })
      setNotice(
        "PRODUCT CASE JSON importado, validado por el dominio y conservado sólo en memoria del navegador.",
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "PRODUCT_CASE_IMPORT_INVALID",
      )
    }
  }

  async function importProductCaseFile(
    file: File | null,
  ) {
    if (!file) return
    if (
      file.type &&
      file.type !== "application/json" &&
      file.type !== "text/json" &&
      file.type !== "text/plain"
    ) {
      setError("PRODUCT_CASE_IMPORT_CONTENT_TYPE_INVALID")
      return
    }
    if (file.size > PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES) {
      setError("PRODUCT_CASE_IMPORT_SIZE_LIMIT_EXCEEDED")
      return
    }
    const rawJson = await file.text()
    setImportJson(rawJson)
    await importProductCaseJson(rawJson, "FILE")
  }

  function exportReviewedCase() {
    const serialized = serializeProductCaseWorkspaceExport({
      workspaceState: {
        document: productCase,
        evaluatedAt: runnerTimestamp,
        generatedAt: runnerTimestamp,
        economicsPolicy,
        scenarioDraft,
        imageApprovals,
        imageObservations: imageAnalysis.observations,
        listingOperations,
      },
      exportedAt: new Date().toISOString(),
    })
    downloadJson(
      `${text(productCase.caseId, "product-case")}.json`,
      serialized,
    )
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
    <main className="min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-28 pt-6 text-white sm:px-6">
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
                id="product-case-import-file"
                type="file"
                accept=".json,application/json,text/json,text/plain"
                onChange={(event) => {
                  void importProductCaseFile(
                    event.currentTarget.files?.[0] ?? null,
                  )
                  event.currentTarget.value = ""
                }}
                className={`${inputClass} py-3 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-100 file:px-3 file:py-2 file:text-xs file:font-black file:text-black`}
              />
              <span className="font-normal text-white/40">
                Máximo {PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES.toLocaleString()} bytes.
              </span>
            </label>
            <label className="grid gap-2 text-xs font-black" htmlFor="product-case-import-json">
              JSON como texto
              <textarea
                id="product-case-import-json"
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                spellCheck={false}
                className={`${textAreaClass} min-h-44`}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => importProductCaseJson(importJson, "TEXTAREA")}
            disabled={!importJson.trim()}
            className={`mt-4 min-h-12 rounded-2xl border border-violet-200/30 bg-violet-200/[0.08] px-5 text-sm font-black text-violet-50 disabled:cursor-not-allowed disabled:opacity-40 ${buttonFocus}`}
          >
            VALIDAR E IMPORTAR EN ESTE NAVEGADOR
          </button>
          {importRoundtrip && (
            <>
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
                    {byteLength(importRoundtrip.canonicalJson).toLocaleString()} bytes preserved
                  </dd>
                </div>
              </dl>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <JsonPanel
                  label="Imported envelope · preserved for review"
                  value={importRoundtrip.imported}
                />
                <JsonPanel
                  label="Domain rebuilt output"
                  value={importRoundtrip.rebuilt}
                />
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
              return (
                <li key={phase}>
                  <a
                    href={`#product-case-phase-${index}`}
                    aria-current={index === 0 ? "step" : undefined}
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
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            1. SUPPLIER_SOURCE
          </p>
          <h2 id="source-access-heading" className="mt-2 text-2xl font-black">
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
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            2–5. IDENTITY · CLASSIFICATION · CONFLICTS · READINESS
          </p>
          <h2
            id="evidence-review-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="mt-2 text-2xl font-black outline-none"
          >
            Revisión humana campo por campo
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Todo dato de Luna empieza como SUPPLIER_STATED. Una corrección
            conserva rawValue y originalValue; nunca eleva el dato a
            PRODUCT_VERIFIED.
          </p>
          <div className="mt-5 grid gap-4">
            {evidence.length === 0 && (
              <p className="rounded-2xl border border-amber-200/25 bg-amber-200/[0.06] p-4 text-sm text-amber-50">
                MISSING — captura evidencia visible para crear propuestas.
              </p>
            )}
            {evidence.map((entry) => {
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
              return (
                <fieldset
                  key={id}
                  className="min-w-0 rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-5"
                >
                  <legend className="max-w-full px-2 text-sm font-black">
                    <span className="break-words">
                      {text(row.field ?? row.label, id)}
                    </span>
                  </legend>
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
          className="mt-5 rounded-[32px] border border-cyan-200/20 bg-cyan-200/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            3. HUMAN_VISUAL_REVIEW
          </p>
          <h2
            id="human-visual-review-heading"
            className="mt-2 text-2xl font-black"
          >
            Agregar observación visual suministrada por un humano
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Seller OS no observa la imagen. Registra únicamente lo descrito por
            el revisor y conserva la referencia original. La observación queda
            como HUMAN_VISUAL_REVIEW y nunca como machine vision o
            PRODUCT_VERIFIED.
          </p>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <label
              className="grid gap-2 text-sm font-black"
              htmlFor="phase3-visual-image-id"
            >
              Identificador de la imagen
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
              htmlFor="phase3-visual-decision"
            >
              Decisión humana
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
              className="grid gap-2 text-sm font-black lg:col-span-2"
              htmlFor="phase3-visual-observations"
            >
              Observaciones humanas
              <textarea
                id="phase3-visual-observations"
                value={visualObservationDraft.humanReason}
                onChange={(event) =>
                  setVisualObservationDraft((current) => ({
                    ...current,
                    humanReason: event.target.value,
                    visibleFeatures: event.target.value,
                  }))}
                className={`${textAreaClass} min-h-32`}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-black lg:col-span-2"
              htmlFor="phase3-visual-blockers"
            >
              Blockers visuales · uno por línea
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
              AGREGAR REVISIÓN HUMANA
            </button>
          </div>
          <JsonPanel
            label="Revisiones visuales humanas registradas"
            value={imageAnalysis.observations}
          />
        </section>

        <section
          id="strategy-input-preview"
          aria-labelledby="strategy-preview-heading"
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            6–7. STRATEGY LAB INPUT PREVIEW · OS CONCLUSION
          </p>
          <h2 id="strategy-preview-heading" className="mt-2 text-2xl font-black">
            Evidencia aceptada, sin anticipar estrategia
          </h2>
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
              <div className="sm:col-span-3"><dt className="text-white/45">Verification evidence IDs</dt><dd className="mt-1 whitespace-pre-wrap font-mono">{display(identityReview.physicalVerificationEvidenceIds)}</dd></div>
              <div className="sm:col-span-3"><dt className="text-white/45">Conflicts / blockers</dt><dd className="mt-1 whitespace-pre-wrap font-mono">{display(identityReview.currentConflict ?? identityReview.blockers)}</dd></div>
            </dl>
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
              Todo candidato empieza NOT_VALIDATED. Sólo una revisión humana
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
                      {candidate.validationStatus}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-white/55">
                    {candidate.validationBlockers.join(" · ")}
                  </p>
                  <p className="mt-2 text-xs font-black text-amber-100">
                    eligibleForSoldExact = {String(candidate.eligibleForSoldExact)}
                    {" · "}canBecomeProductFact = {String(candidate.canBecomeProductFact)}
                  </p>
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
                          <option value="VALIDATE_ACTIVE_EXACT">
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
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            8. HUMAN REVIEW / SHADOW MODE
          </p>
          <h2 id="shadow-heading" className="mt-2 text-2xl font-black">
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
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            9. IMAGE REGISTRY / QA
          </p>
          <h2 id="image-registry-heading" className="mt-2 text-2xl font-black">
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
          <div className="mt-4 grid gap-3">
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
          <fieldset className="mt-4 rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.035] p-4 sm:p-5">
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
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            10. MANUAL_LISTING_PACKAGE · 11. MANUAL_EBAY_HANDOFF
          </p>
          <h2 id="manual-package-heading" className="mt-2 text-2xl font-black">
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
        </section>

        <section
          id="manual-listing-registration"
          aria-labelledby="manual-registration-heading"
          className="mt-5 rounded-[32px] border border-white/10 bg-white/[0.035] p-5 sm:p-7"
        >
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            12. MANUAL_LISTING_REGISTRATION
          </p>
          <h2 id="manual-registration-heading" className="mt-2 text-2xl font-black">
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
      className="scroll-mt-24 rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-5"
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
  return [...new Set(value.split(/\r?\n|,/)
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
            Human-reviewed title · máximo 80
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
