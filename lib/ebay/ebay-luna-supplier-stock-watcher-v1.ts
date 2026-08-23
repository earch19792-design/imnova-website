import { createHash } from "node:crypto"

import {
  renderCommercialWhatsAppAlertDryRunV1,
// @ts-ignore -- Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-commercial-whatsapp-alert-engine-v1.ts"
import {
  canonicalLunaApprovalSourceUrlV1,
  LUNA_WATCHER_APPROVAL_CONTRACT_VERSION_V1,
  LUNA_WATCHER_APPROVAL_RAW_PAYLOAD_KEY_V1,
  readLunaWatcherHumanApprovalContractV1 as readSharedLunaWatcherHumanApprovalContractV1,
} from "./commercial-monitor-readonly-utilities.mjs"

export const LUNA_SUPPLIER_STOCK_WATCHER_VERSION =
  LUNA_WATCHER_APPROVAL_CONTRACT_VERSION_V1
export const LUNA_WATCHER_APPROVAL_RAW_PAYLOAD_KEY =
  LUNA_WATCHER_APPROVAL_RAW_PAYLOAD_KEY_V1
export const LUNA_AUTHENTICATED_BROWSER_PARSER_VERSION =
  "LUNA_AUTHENTICATED_BROWSER_CAPTURE_V1" as const

export type LunaWatcherSourceModeV1 =
  | "AUTHENTICATED_SERVER_HTTP"
  | "AUTHENTICATED_WEB_SESSION"
  | "MANUAL_FALLBACK"
  | "LEGACY_PUBLIC_AVAILABILITY_ONLY"

export type LunaWatcherSessionStateV1 =
  | "SESSION_OK"
  | "REAUTH_REQUIRED"
  | "MFA_REQUIRED"
  | "CAPTCHA_BLOCKED"
  | "AUTHORIZATION_DENIED"
  | "SOURCE_CHANGED"
  | "SOURCE_UNAVAILABLE"
  | "VARIANT_UNPROVEN"

export type LunaWatcherStockStateV1 =
  | "IN_STOCK_CONFIRMED"
  | "LOW_STOCK_CONFIRMED"
  | "OUT_OF_STOCK_SIGNAL"
  | "OUT_OF_STOCK_CONFIRMED"
  | "STALE_EVIDENCE"
  | "SOURCE_CHANGED"
  | "SOURCE_UNAVAILABLE"
  | "STOCK_UNKNOWN"

export type LunaWatcherPriorityV1 =
  | "P0_CRITICAL"
  | "P1_HIGH"
  | "P2_STANDARD"
  | "P3_LOW"

export type LunaExactApprovedLinkV1 = {
  accountKey: string
  ebayItemId: string
  ebaySku: string | null
  listingTitle: string | null
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  canonicalSourceUrl: string
  currency: string | null
  classification: "EXACT_PROVEN" | "STRONG_CANDIDATE_HUMAN_REVIEW" |
    "UNPROVEN" | "CONFLICT"
  humanApproved: boolean
  approvedAt: string
  approvalProvenance: string
}

export type LunaAuthenticatedBrowserAgentRequestV1 = {
  contractVersion: typeof LUNA_SUPPLIER_STOCK_WATCHER_VERSION
  requestId: string
  canonicalSourceUrl: string
  expectedIdentity: {
    supplierProductId: string
    supplierVariantId: string
    supplierSku: string
  }
  profile: {
    mode: "PROTECTED_PERSISTENT_BROWSER_PROFILE"
    rawSessionMaterialRequested: false
    loginAutomationAllowed: false
    mfaBypassAllowed: false
    captchaBypassAllowed: false
  }
  capturePolicy: {
    renderedAuthenticatedCatalogOnly: true
    maximumResponseBytes: 8_192
    rawHtmlAllowed: false
    screenshotAllowed: false
    promptTransmissionAllowed: false
  }
}

export type LunaAuthenticatedCaptureV1 = {
  contractVersion: typeof LUNA_SUPPLIER_STOCK_WATCHER_VERSION
  requestId: string
  sourceMode: "AUTHENTICATED_SERVER_HTTP" | "AUTHENTICATED_WEB_SESSION"
  sessionState: LunaWatcherSessionStateV1
  productId: string | null
  variantId: string | null
  supplierSku: string | null
  availability: boolean | null
  quantity: number | null
  quantityExplicit: boolean
  explicitLowStock: boolean
  regularPrice: number | null
  salePrice: number | null
  currency: string | null
  observedAt: string
  parserVersion: string
  selectorContractVersion: string
  sourceEvidenceFingerprint: string
  limitationCode: string | null
  agentAttestation?: {
    persistentProfileUsed: true
    isolatedProfileRequired: true
    sessionMaterialExported: false
    rawHtmlExported: false
    screenshotExported: false
    captchaBypassAttempted: false
    mfaBypassAttempted: false
  }
  serverAttestation?: {
    serverOnly: true
    protectedSessionValuePresent: boolean
    rawSessionMaterialExported: false
    rawResponseExported: false
    redirectFollowed: false
  }
}

export type LunaAuthenticatedBrowserCaptureV1 = LunaAuthenticatedCaptureV1

export type LunaWatcherObservationV1 = {
  contractVersion: typeof LUNA_SUPPLIER_STOCK_WATCHER_VERSION
  linkFingerprint: string
  ebayItemId: string
  ebaySku: string | null
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  sourceMode: "AUTHENTICATED_SERVER_HTTP" | "AUTHENTICATED_WEB_SESSION"
  sourceStatus: LunaWatcherSessionStateV1
  stockState: LunaWatcherStockStateV1
  observedAvailability: boolean | null
  outOfStockSignalCount: number
  quantity: number | null
  quantityExplicit: boolean
  regularPrice: number | null
  salePrice: number | null
  currency: string | null
  observedAt: string | null
  freshness: "FRESH" | "STALE" | "UNKNOWN"
  ageSeconds: number | null
  parserVersion: string
  selectorContractVersion: string
  evidenceFingerprint: string
  limitationCode: string | null
  confirmationPolicy:
    "TWO_CONSISTENT_AUTHENTICATED_WEB_OBSERVATIONS"
  safety: {
    authFailureIsOutOfStock: false
    timeoutIsOutOfStock: false
    missingSelectorIsOutOfStock: false
    sourceChangeIsOutOfStock: false
    staleIsLowStock: false
    unknownIsRisk: false
    ebayWrites: 0
    inventoryWrites: 0
    registryWrites: 0
    whatsappSends: 0
  }
}

type JsonRecord = Record<string, unknown>

const FORBIDDEN_CAPTURE_KEYS = /(?:cookie|authorization|password|secret|(?:access|refresh|bearer|auth).?token|credential|storage.?state|local.?storage|session.?storage|raw.?html|page.?html|outer.?html|inner.?html|screenshot|image(?:data|bytes|url)|prompt|captcha.?solution|mfa.?code)/i
const MAX_SANITIZED_CAPTURE_BYTES = 8_192

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function safeText(value: unknown, maximum = 200) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum) || null
    : null
}

export function canonicalLunaProductUrlV1(value: unknown) {
  return canonicalLunaApprovalSourceUrlV1(value)
}

function safeNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function safeMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Number(parsed.toFixed(2))
    : null
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function linkFingerprint(link: LunaExactApprovedLinkV1) {
  return `luna_link_${hash([
    link.accountKey,
    link.ebayItemId,
    link.ebaySku,
    link.supplierProductId,
    link.supplierVariantId,
    link.supplierSku,
    link.canonicalSourceUrl,
  ]).slice(0, 32)}`
}

function assertExactApprovedLink(link: LunaExactApprovedLinkV1) {
  if (
    link.classification !== "EXACT_PROVEN" ||
    link.humanApproved !== true ||
    !/^\d{9,19}$/.test(link.ebayItemId) ||
    !safeText(link.supplierProductId, 100) ||
    !safeText(link.supplierVariantId, 100) ||
    !safeText(link.supplierSku, 120) ||
    !safeText(link.accountKey, 200) ||
    !safeText(link.approvalProvenance, 200) ||
    !Number.isFinite(Date.parse(link.approvedAt)) ||
    !canonicalLunaProductUrlV1(link.canonicalSourceUrl)
  ) throw new Error("LUNA_WATCHER_EXACT_HUMAN_LINK_REQUIRED")
}

export type LunaWatcherStoredHumanApprovalV1 = {
  contractVersion: typeof LUNA_SUPPLIER_STOCK_WATCHER_VERSION
  classification: "EXACT_PROVEN"
  humanApproved: true
  ebayItemId: string
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  canonicalSourceUrl: string
  approvedAt: string
  approvalProvenance: string
}

/** One approval parser is shared by Stock Guard and the scheduler. */
export function readLunaWatcherHumanApprovalContractV1(input: {
  rawPayload: unknown
  ebayItemId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
}) : LunaWatcherStoredHumanApprovalV1 | null {
  return readSharedLunaWatcherHumanApprovalContractV1(input)
}

/**
 * Safe, credential-free payload fragment for a future authorized Registry
 * persistence operation. Preparing this contract does not persist or activate
 * anything; the authenticated scheduler independently verifies every bound
 * identity field before it will recapture.
 */
export function buildLunaWatcherApprovalPersistenceContractV1(
  link: LunaExactApprovedLinkV1,
) {
  assertExactApprovedLink(link)
  return {
    [LUNA_WATCHER_APPROVAL_RAW_PAYLOAD_KEY]: {
      contractVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
      classification: "EXACT_PROVEN" as const,
      humanApproved: true as const,
      ebayItemId: link.ebayItemId,
      supplierProductId: link.supplierProductId,
      supplierVariantId: link.supplierVariantId,
      supplierSku: link.supplierSku,
      canonicalSourceUrl: link.canonicalSourceUrl,
      approvedAt: link.approvedAt,
      approvalProvenance: link.approvalProvenance,
    },
  }
}

function assertNoForbiddenCaptureFields(value: unknown, path = "capture") {
  if (!value || typeof value !== "object") return
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    if (FORBIDDEN_CAPTURE_KEYS.test(key)) {
      throw new Error("LUNA_WATCHER_CREDENTIAL_OR_RAW_PAGE_FIELD_REJECTED")
    }
    if (entry && typeof entry === "object") {
      assertNoForbiddenCaptureFields(entry, `${path}.${key}`)
    }
  }
}

export function assertSanitizedLunaBrowserCaptureV1(
  value: unknown,
): asserts value is LunaAuthenticatedCaptureV1 {
  let bytes = Number.POSITIVE_INFINITY
  try { bytes = Buffer.byteLength(JSON.stringify(value), "utf8") } catch { bytes = Infinity }
  if (bytes > MAX_SANITIZED_CAPTURE_BYTES) {
    throw new Error("LUNA_WATCHER_CAPTURE_PAYLOAD_TOO_LARGE")
  }
  assertNoForbiddenCaptureFields(value)
  const capture = record(value)
  const attestation = record(capture.agentAttestation)
  const serverAttestation = record(capture.serverAttestation)
  const sessionStates = new Set<LunaWatcherSessionStateV1>([
    "SESSION_OK", "REAUTH_REQUIRED", "MFA_REQUIRED", "CAPTCHA_BLOCKED",
    "AUTHORIZATION_DENIED", "SOURCE_CHANGED", "SOURCE_UNAVAILABLE",
    "VARIANT_UNPROVEN",
  ])
  if (
    capture.contractVersion !== LUNA_SUPPLIER_STOCK_WATCHER_VERSION ||
    !["AUTHENTICATED_SERVER_HTTP", "AUTHENTICATED_WEB_SESSION"]
      .includes(String(capture.sourceMode)) ||
    !sessionStates.has(capture.sessionState as LunaWatcherSessionStateV1) ||
    !safeText(capture.requestId, 120) ||
    !Number.isFinite(Date.parse(String(capture.observedAt ?? ""))) ||
    !safeText(capture.parserVersion, 80) ||
    !safeText(capture.selectorContractVersion, 80) ||
    !/^luna_agent_evidence_[a-f0-9]{24,64}$/.test(String(
      capture.sourceEvidenceFingerprint ?? "",
    )) ||
    (capture.sourceMode === "AUTHENTICATED_WEB_SESSION" && (
      attestation.persistentProfileUsed !== true ||
      attestation.isolatedProfileRequired !== true ||
      attestation.sessionMaterialExported !== false ||
      attestation.rawHtmlExported !== false ||
      attestation.screenshotExported !== false ||
      attestation.captchaBypassAttempted !== false ||
      attestation.mfaBypassAttempted !== false
    )) ||
    (capture.sourceMode === "AUTHENTICATED_SERVER_HTTP" && (
      serverAttestation.serverOnly !== true ||
      typeof serverAttestation.protectedSessionValuePresent !== "boolean" ||
      serverAttestation.rawSessionMaterialExported !== false ||
      serverAttestation.rawResponseExported !== false ||
      serverAttestation.redirectFollowed !== false
    ))
  ) throw new Error("LUNA_WATCHER_SANITIZED_CAPTURE_INVALID")
}

export function buildLunaAuthenticatedBrowserAgentRequestV1(
  link: LunaExactApprovedLinkV1,
) : LunaAuthenticatedBrowserAgentRequestV1 {
  assertExactApprovedLink(link)
  const fingerprint = linkFingerprint(link)
  return {
    contractVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
    requestId: `luna_watch_${hash([fingerprint, link.approvedAt]).slice(0, 32)}`,
    canonicalSourceUrl: link.canonicalSourceUrl,
    expectedIdentity: {
      supplierProductId: link.supplierProductId,
      supplierVariantId: link.supplierVariantId,
      supplierSku: link.supplierSku,
    },
    profile: {
      mode: "PROTECTED_PERSISTENT_BROWSER_PROFILE",
      rawSessionMaterialRequested: false,
      loginAutomationAllowed: false,
      mfaBypassAllowed: false,
      captchaBypassAllowed: false,
    },
    capturePolicy: {
      renderedAuthenticatedCatalogOnly: true,
      maximumResponseBytes: MAX_SANITIZED_CAPTURE_BYTES,
      rawHtmlAllowed: false,
      screenshotAllowed: false,
      promptTransmissionAllowed: false,
    },
  }
}

export type LunaAuthenticatedHttpRequestV1 = {
  contractVersion: typeof LUNA_SUPPLIER_STOCK_WATCHER_VERSION
  requestId: string
  canonicalSourceUrl: string
  expectedIdentity: LunaAuthenticatedBrowserAgentRequestV1["expectedIdentity"]
  transportPolicy: {
    serverOnly: true
    method: "GET"
    maximumRequestsPerAttempt: 2
    maximumResponseBytesPerRequest: 1_000_000
    maximumAttempts: 3
    timeoutMs: 12_000
    redirectMode: "MANUAL"
    rawResponsePersistenceAllowed: false
    credentialLoggingAllowed: false
  }
}

export function buildLunaAuthenticatedHttpRequestV1(
  link: LunaExactApprovedLinkV1,
) : LunaAuthenticatedHttpRequestV1 {
  const request = buildLunaAuthenticatedBrowserAgentRequestV1(link)
  return {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    canonicalSourceUrl: request.canonicalSourceUrl,
    expectedIdentity: request.expectedIdentity,
    transportPolicy: {
      serverOnly: true,
      method: "GET",
      maximumRequestsPerAttempt: 2,
      maximumResponseBytesPerRequest: 1_000_000,
      maximumAttempts: 3,
      timeoutMs: 12_000,
      redirectMode: "MANUAL",
      rawResponsePersistenceAllowed: false,
      credentialLoggingAllowed: false,
    },
  }
}

type LunaHttpResponseEvidenceV1 = {
  status: number
  location: string | null
  contentType: string | null
  body: string
}

function lunaHttpSessionState(input: {
  protectedSessionValuePresent: boolean
  response: LunaHttpResponseEvidenceV1 | null
}) : { state: LunaWatcherSessionStateV1; limitationCode: string | null } {
  if (!input.protectedSessionValuePresent) {
    return { state: "REAUTH_REQUIRED", limitationCode: "LUNA_PROTECTED_SESSION_NOT_PRESENT" }
  }
  if (!input.response) {
    return { state: "SOURCE_UNAVAILABLE", limitationCode: "LUNA_AUTHENTICATED_HTTP_UNAVAILABLE" }
  }
  const { status, location, body } = input.response
  const redirect = `${location ?? ""}`
  const boundedBody = body.slice(0, 500_000)
  if (/captcha|verify you are human|i am not a robot|challenge-platform/i.test(
    `${redirect} ${boundedBody}`,
  )) return { state: "CAPTCHA_BLOCKED", limitationCode: "LUNA_CAPTCHA_REQUIRES_HUMAN" }
  if (/two.factor|multi.factor|verification code|security code|authenticator|\/mfa\b/i.test(
    `${redirect} ${boundedBody}`,
  )) return { state: "MFA_REQUIRED", limitationCode: "LUNA_MFA_REQUIRES_HUMAN" }
  if (status === 401 || /\/account\/(?:login|signin)|\/login|\/signin/i.test(redirect)) {
    return { state: "REAUTH_REQUIRED", limitationCode: "LUNA_REAUTH_REQUIRED" }
  }
  if (status === 403 || /access restricted|authorization denied|not authorized|forbidden/i
      .test(boundedBody)) {
    return { state: "AUTHORIZATION_DENIED", limitationCode: "LUNA_AUTHORIZATION_DENIED" }
  }
  if (status === 460) {
    return { state: "SOURCE_CHANGED", limitationCode: "LUNA_RESPONSE_BOUNDARY_CHANGED" }
  }
  if (status === 429 || status === 408 || status >= 500 || status < 200 || status >= 400) {
    return { state: "SOURCE_UNAVAILABLE",
      limitationCode: `LUNA_AUTHENTICATED_HTTP_${Math.trunc(status)}` }
  }
  if (status >= 300) {
    return { state: "SOURCE_UNAVAILABLE", limitationCode: "LUNA_UNEXPECTED_REDIRECT" }
  }
  const sessionProven = /["']customerId["']?\s*:\s*["']?\d+/i.test(boundedBody) ||
    /href=["'][^"']*\/account\/logout/i.test(boundedBody)
  return sessionProven
    ? { state: "SESSION_OK", limitationCode: null }
    : { state: "REAUTH_REQUIRED", limitationCode: "LUNA_AUTH_SESSION_NOT_PROVEN" }
}

function authenticatedVariantQuantity(value: JsonRecord) {
  for (const key of ["inventory_quantity", "inventoryQuantity", "quantity_available",
    "quantityAvailable", "stock_quantity", "stockQuantity"]) {
    const candidate = safeNonNegativeInteger(value[key])
    if (candidate !== null) return candidate
  }
  return null
}

function shopifyMoney(value: unknown) {
  const parsed = safeMoney(value)
  // Shopify product JSON represents money as integer minor units. Keep a
  // decimal fallback only for a future explicitly-decimal adapter.
  return parsed !== null && Number.isInteger(parsed)
    ? Number((parsed / 100).toFixed(2))
    : parsed
}

function currencyFromAuthenticatedEvidence(payload: JsonRecord, html: string) {
  const payloadCurrency = safeText(payload.currency, 3)?.toUpperCase()
  if (/^[A-Z]{3}$/.test(payloadCurrency ?? "")) return payloadCurrency as string
  const htmlCurrency = html.match(
    /(?:property|name)=["'](?:og:price:currency|currency)["'][^>]*content=["']([A-Z]{3})["']/i,
  )?.[1]?.toUpperCase()
  return /^[A-Z]{3}$/.test(htmlCurrency ?? "") ? htmlCurrency as string : null
}

export function parseLunaAuthenticatedHttpCaptureV1(input: {
  request: LunaAuthenticatedHttpRequestV1
  protectedSessionValuePresent: boolean
  htmlResponse: LunaHttpResponseEvidenceV1 | null
  productResponse: LunaHttpResponseEvidenceV1 | null
  observedAt: string
}) : LunaAuthenticatedCaptureV1 {
  const session = lunaHttpSessionState({
    protectedSessionValuePresent: input.protectedSessionValuePresent,
    response: input.htmlResponse,
  })
  const base = {
    contractVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
    requestId: input.request.requestId,
    sourceMode: "AUTHENTICATED_SERVER_HTTP" as const,
    sessionState: session.state,
    productId: null as string | null,
    variantId: null as string | null,
    supplierSku: null as string | null,
    availability: null as boolean | null,
    quantity: null as number | null,
    quantityExplicit: false,
    explicitLowStock: false,
    regularPrice: null as number | null,
    salePrice: null as number | null,
    currency: null as string | null,
    observedAt: input.observedAt,
    parserVersion: LUNA_AUTHENTICATED_BROWSER_PARSER_VERSION,
    selectorContractVersion: "LUNA_AUTHENTICATED_HTTP_PRODUCT_V1",
    sourceEvidenceFingerprint: "",
    limitationCode: session.limitationCode,
    serverAttestation: {
      serverOnly: true as const,
      protectedSessionValuePresent: input.protectedSessionValuePresent,
      rawSessionMaterialExported: false as const,
      rawResponseExported: false as const,
      redirectFollowed: false as const,
    },
  }
  const finish = (capture: typeof base) => ({
    ...capture,
    sourceEvidenceFingerprint: `luna_agent_evidence_${hash({
      requestId: capture.requestId,
      sourceMode: capture.sourceMode,
      sessionState: capture.sessionState,
      productId: capture.productId,
      variantId: capture.variantId,
      supplierSku: capture.supplierSku,
      availability: capture.availability,
      quantity: capture.quantityExplicit ? capture.quantity : null,
      regularPrice: capture.regularPrice,
      salePrice: capture.salePrice,
      currency: capture.currency,
      observedAt: capture.observedAt,
      parserVersion: capture.parserVersion,
      selectorContractVersion: capture.selectorContractVersion,
      limitationCode: capture.limitationCode,
    }).slice(0, 48)}`,
  })
  if (session.state !== "SESSION_OK") return finish(base)
  const productResponse = input.productResponse
  if (!productResponse) return finish({ ...base, sessionState: "SOURCE_UNAVAILABLE",
    limitationCode: "LUNA_AUTHENTICATED_PRODUCT_RESPONSE_UNAVAILABLE" })
  if (productResponse.status === 401 || productResponse.status >= 300 &&
      productResponse.status < 400 && /login|signin|account/i.test(productResponse.location ?? "")) {
    return finish({ ...base, sessionState: "REAUTH_REQUIRED",
      limitationCode: "LUNA_AUTHENTICATED_PRODUCT_REAUTH_REQUIRED" })
  }
  if (productResponse.status === 403) return finish({ ...base,
    sessionState: "AUTHORIZATION_DENIED", limitationCode: "LUNA_PRODUCT_AUTHORIZATION_DENIED" })
  if (productResponse.status === 460) return finish({ ...base,
    sessionState: "SOURCE_CHANGED", limitationCode: "LUNA_PRODUCT_RESPONSE_BOUNDARY_CHANGED" })
  if (productResponse.status === 429 || productResponse.status === 408 ||
      productResponse.status >= 500) return finish({ ...base,
    sessionState: "SOURCE_UNAVAILABLE",
    limitationCode: `LUNA_AUTHENTICATED_PRODUCT_HTTP_${productResponse.status}` })
  if (productResponse.status < 200 || productResponse.status >= 400) {
    return finish({ ...base, sessionState: "SOURCE_UNAVAILABLE",
      limitationCode: `LUNA_AUTHENTICATED_PRODUCT_HTTP_${productResponse.status}` })
  }
  let payload: JsonRecord
  try { payload = record(JSON.parse(productResponse.body)) } catch {
    return finish({ ...base, sessionState: "SOURCE_CHANGED",
      limitationCode: "LUNA_AUTHENTICATED_PRODUCT_JSON_INVALID" })
  }
  const productId = safeText(String(payload.id ?? ""), 100)
  if (productId !== input.request.expectedIdentity.supplierProductId) {
    return finish({ ...base, sessionState: "SOURCE_CHANGED", productId,
      limitationCode: "LUNA_AUTHENTICATED_PRODUCT_ID_MISMATCH" })
  }
  const variants = Array.isArray(payload.variants)
    ? payload.variants.map(record).filter((variant) =>
        safeText(String(variant.id ?? ""), 100) ===
          input.request.expectedIdentity.supplierVariantId &&
        safeText(variant.sku, 120) === input.request.expectedIdentity.supplierSku)
    : []
  if (variants.length !== 1) return finish({ ...base,
    sessionState: "VARIANT_UNPROVEN", productId,
    limitationCode: "LUNA_AUTHENTICATED_EXACT_VARIANT_UNPROVEN" })
  const variant = variants[0]
  const quantity = authenticatedVariantQuantity(variant)
  const availability = typeof variant.available === "boolean"
    ? variant.available
    : quantity !== null ? quantity > 0 : null
  if (quantity !== null && typeof variant.available === "boolean" &&
      variant.available !== (quantity > 0)) {
    return finish({ ...base, sessionState: "SOURCE_CHANGED", productId,
      variantId: input.request.expectedIdentity.supplierVariantId,
      supplierSku: input.request.expectedIdentity.supplierSku,
      limitationCode: "LUNA_AUTHENTICATED_STOCK_FIELDS_CONFLICT" })
  }
  const currentPrice = shopifyMoney(variant.price)
  const compareAtPrice = shopifyMoney(variant.compare_at_price ?? variant.compareAtPrice)
  const discounted = currentPrice !== null && compareAtPrice !== null &&
    compareAtPrice > currentPrice
  const html = input.htmlResponse?.body ?? ""
  const capture = {
    ...base,
    sessionState: "SESSION_OK" as const,
    productId,
    variantId: input.request.expectedIdentity.supplierVariantId,
    supplierSku: input.request.expectedIdentity.supplierSku,
    availability,
    quantity,
    quantityExplicit: quantity !== null,
    // A product-page banner is not variant-scoped proof. Authenticated HTTP
    // may confirm low stock only from the exact variant's explicit quantity;
    // the isolated browser fallback can attest an exact selected-variant UI.
    explicitLowStock: false,
    regularPrice: discounted ? compareAtPrice : currentPrice,
    salePrice: discounted ? currentPrice : null,
    currency: currencyFromAuthenticatedEvidence(payload, html),
    limitationCode: availability === null
      ? "LUNA_AUTHENTICATED_AVAILABILITY_MISSING" : null,
  }
  return finish(capture)
}

export function resolveLunaWatcherSourcePriorityV1(input: {
  protectedServerSessionPresent?: boolean
  authenticatedBrowserWorkerReady?: boolean
} = {}) {
  const browserReady = input.authenticatedBrowserWorkerReady === true
  return {
    supplier: "LUNA_PORTEX" as const,
    actualMode: "AUTHENTICATED_WEB_SESSION" as const,
    actualAdapter: "EXISTING_CANONICAL_BROWSER_WORKER" as const,
    sourcePriority: [
      { mode: "AUTHENTICATED_WEB_SESSION" as const,
        status: browserReady ? "AVAILABLE" as const : "REAUTH_REQUIRED" as const },
      { mode: "AUTHENTICATED_SERVER_HTTP" as const,
        status: "NON_AUTHORITATIVE_FOR_AUTHENTICATED_STOCK" as const },
      { mode: "MANUAL_FALLBACK" as const, status: "AVAILABLE" as const },
    ],
    browserFallbackEligibility: "AUTHORITATIVE_AUTHENTICATED_PATH" as const,
    unavailableModes: [{ mode: "OFFICIAL_API_FEED_WEBHOOK" as const,
      status: "NOT_AVAILABLE_THIS_MILESTONE" as const }],
    publicCatalogPolicy: "NOT_AUTHORITATIVE_FOR_LUNA_STOCK" as const,
    protectedProfileContract: {
      activated: browserReady,
      persistentProfileRequiredIfLaterAuthorized: false,
      dedicatedIsolatedProfileRequired: true,
      rawSessionMaterialReadBySellerOs: false,
      rawSessionMaterialReturnedInDtos: false,
      rawSessionMaterialStoredInBusinessTables: false,
      rawSessionMaterialIncludedInPrompts: false,
      loginAutomationAllowed: false,
      captchaOrMfaBypassAllowed: false,
    },
  }
}

const WATCHER_SAFETY = Object.freeze({
  authFailureIsOutOfStock: false as const,
  timeoutIsOutOfStock: false as const,
  missingSelectorIsOutOfStock: false as const,
  sourceChangeIsOutOfStock: false as const,
  staleIsLowStock: false as const,
  unknownIsRisk: false as const,
  ebayWrites: 0 as const,
  inventoryWrites: 0 as const,
  registryWrites: 0 as const,
  whatsappSends: 0 as const,
})

export function evaluateLunaAuthenticatedBrowserCaptureV1(input: {
  link: LunaExactApprovedLinkV1
  capture: LunaAuthenticatedCaptureV1
  previous?: LunaWatcherObservationV1 | null
  now?: string
  staleAfterHours?: number
  lowStockThreshold?: number
}) : LunaWatcherObservationV1 {
  assertExactApprovedLink(input.link)
  assertSanitizedLunaBrowserCaptureV1(input.capture)
  const expectedRequest = buildLunaAuthenticatedBrowserAgentRequestV1(input.link)
  if (input.capture.requestId !== expectedRequest.requestId) {
    throw new Error("LUNA_WATCHER_CAPTURE_REQUEST_MISMATCH")
  }
  const fingerprint = linkFingerprint(input.link)
  const now = Date.parse(input.now ?? new Date().toISOString())
  const observedAt = Date.parse(input.capture.observedAt)
  const ageSeconds = Number.isFinite(now) && Number.isFinite(observedAt)
    ? Math.max(0, Math.floor((now - observedAt) / 1_000))
    : null
  const stale = ageSeconds !== null &&
    ageSeconds > Math.max(1, input.staleAfterHours ?? 36) * 3_600
  const identityExact = input.capture.productId === input.link.supplierProductId &&
    input.capture.variantId === input.link.supplierVariantId &&
    input.capture.supplierSku === input.link.supplierSku
  const priorConsistentSignal = Boolean(
    input.previous &&
    input.previous.linkFingerprint === fingerprint &&
    input.previous.sourceStatus === "SESSION_OK" &&
    input.previous.observedAvailability === false &&
    input.previous.outOfStockSignalCount >= 1 &&
    input.previous.observedAt &&
    observedAt > Date.parse(input.previous.observedAt) &&
    observedAt - Date.parse(input.previous.observedAt) <= 48 * 3_600_000,
  )
  let sourceStatus = input.capture.sessionState
  let stockState: LunaWatcherStockStateV1 = "STOCK_UNKNOWN"
  let limitationCode = safeText(input.capture.limitationCode, 120)
  let signalCount = 0
  const explicitQuantity = input.capture.quantityExplicit
    ? safeNonNegativeInteger(input.capture.quantity)
    : null
  const explicitZero = input.capture.quantityExplicit && explicitQuantity === 0

  if (input.capture.sessionState !== "SESSION_OK") {
    stockState = ["SOURCE_CHANGED", "VARIANT_UNPROVEN"].includes(
      input.capture.sessionState,
    ) ? input.capture.sessionState === "SOURCE_CHANGED"
        ? "SOURCE_CHANGED"
        : "STOCK_UNKNOWN"
      : "SOURCE_UNAVAILABLE"
    limitationCode ??= `LUNA_${input.capture.sessionState}`
  } else if (!identityExact) {
    sourceStatus = "VARIANT_UNPROVEN"
    stockState = "STOCK_UNKNOWN"
    limitationCode = "EXACT_AUTHENTICATED_VARIANT_IDENTITY_MISMATCH"
  } else if (stale) {
    stockState = "STALE_EVIDENCE"
    limitationCode = "LUNA_WATCHER_EVIDENCE_STALE"
  } else if (input.capture.availability === false || explicitZero) {
    // Luna's authenticated catalog is still web evidence, not an
    // authoritative supplier API/feed. Even an explicit numeric zero needs
    // a later consistent observation before downstream confirmation.
    signalCount = priorConsistentSignal
      ? Math.min(2, (input.previous?.outOfStockSignalCount ?? 1) + 1)
      : 1
    stockState = signalCount >= 2
      ? "OUT_OF_STOCK_CONFIRMED"
      : "OUT_OF_STOCK_SIGNAL"
    limitationCode = stockState === "OUT_OF_STOCK_SIGNAL"
      ? "SECOND_CONSISTENT_AUTHENTICATED_OBSERVATION_REQUIRED"
      : null
  } else if (input.capture.availability === true && explicitQuantity !== null &&
      explicitQuantity <= Math.max(0, input.lowStockThreshold ?? 3)) {
    stockState = "LOW_STOCK_CONFIRMED"
    limitationCode = null
  } else if (input.capture.availability === true && input.capture.explicitLowStock) {
    stockState = "LOW_STOCK_CONFIRMED"
    limitationCode = null
  } else if (input.capture.availability === true) {
    stockState = "IN_STOCK_CONFIRMED"
    limitationCode = null
  } else {
    stockState = "STOCK_UNKNOWN"
    limitationCode ??= "AUTHENTICATED_AVAILABILITY_NOT_EXPLICIT"
  }

  return {
    contractVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
    linkFingerprint: fingerprint,
    ebayItemId: input.link.ebayItemId,
    ebaySku: safeText(input.link.ebaySku, 120),
    supplierProductId: input.link.supplierProductId,
    supplierVariantId: input.link.supplierVariantId,
    supplierSku: input.link.supplierSku,
    sourceMode: input.capture.sourceMode,
    sourceStatus,
    stockState,
    observedAvailability: input.capture.sessionState === "SESSION_OK"
      ? input.capture.availability
      : null,
    outOfStockSignalCount: ["OUT_OF_STOCK_SIGNAL", "OUT_OF_STOCK_CONFIRMED"]
      .includes(stockState) ? signalCount : 0,
    quantity: input.capture.sessionState === "SESSION_OK" &&
      input.capture.quantityExplicit ? explicitQuantity : null,
    quantityExplicit: input.capture.sessionState === "SESSION_OK" &&
      input.capture.quantityExplicit && explicitQuantity !== null,
    regularPrice: input.capture.sessionState === "SESSION_OK"
      ? safeMoney(input.capture.regularPrice) : null,
    salePrice: input.capture.sessionState === "SESSION_OK"
      ? safeMoney(input.capture.salePrice) : null,
    currency: input.capture.sessionState === "SESSION_OK" &&
      /^[A-Z]{3}$/.test(input.capture.currency ?? "") ? input.capture.currency : null,
    observedAt: Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : null,
    freshness: ageSeconds === null ? "UNKNOWN" : stale ? "STALE" : "FRESH",
    ageSeconds,
    parserVersion: input.capture.parserVersion,
    selectorContractVersion: input.capture.selectorContractVersion,
    evidenceFingerprint: `luna_observation_${hash({
      fingerprint,
      sourceStatus,
      stockState,
      observedAvailability: input.capture.sessionState === "SESSION_OK"
        ? input.capture.availability : null,
      quantity: input.capture.quantityExplicit ? explicitQuantity : null,
      regularPrice: safeMoney(input.capture.regularPrice),
      salePrice: safeMoney(input.capture.salePrice),
      currency: input.capture.currency,
      observedAt: input.capture.observedAt,
      sourceEvidenceFingerprint: input.capture.sourceEvidenceFingerprint,
      parserVersion: input.capture.parserVersion,
      selectorContractVersion: input.capture.selectorContractVersion,
    }).slice(0, 32)}`,
    limitationCode,
    confirmationPolicy:
      "TWO_CONSISTENT_AUTHENTICATED_WEB_OBSERVATIONS",
    safety: { ...WATCHER_SAFETY },
  }
}

function priorityFor(input: {
  state: LunaWatcherStockStateV1
  sourceStatus?: LunaWatcherSessionStateV1
  commercialExposureScore?: number | null
}) : { priority: LunaWatcherPriorityV1; intervalMinutes: number; reason: string } {
  const exposure = Number.isFinite(input.commercialExposureScore)
    ? Math.max(0, Math.min(100, Number(input.commercialExposureScore)))
    : 0
  if (input.state === "OUT_OF_STOCK_CONFIRMED") {
    return { priority: "P0_CRITICAL", intervalMinutes: 15,
      reason: "CONFIRMED_OUT_OF_STOCK" }
  }
  if (["OUT_OF_STOCK_SIGNAL", "LOW_STOCK_CONFIRMED", "SOURCE_CHANGED",
    "SOURCE_UNAVAILABLE", "STALE_EVIDENCE"].includes(input.state) || exposure >= 75) {
    return { priority: "P1_HIGH", intervalMinutes: 60,
      reason: input.state === "IN_STOCK_CONFIRMED"
        ? "HIGH_COMMERCIAL_EXPOSURE" : input.state }
  }
  if (input.state === "STOCK_UNKNOWN" || exposure >= 40) {
    return { priority: "P2_STANDARD", intervalMinutes: 360,
      reason: input.sourceStatus && input.sourceStatus !== "SESSION_OK"
        ? input.sourceStatus
        : input.state === "IN_STOCK_CONFIRMED"
          ? "MEDIUM_COMMERCIAL_EXPOSURE" : input.state }
  }
  return { priority: "P3_LOW", intervalMinutes: 1_440,
    reason: "HEALTHY_LOW_EXPOSURE" }
}

export function scheduleLunaWatcherObservationV1(input: {
  observation: LunaWatcherObservationV1
  commercialExposureScore?: number | null
}) {
  const scheduled = priorityFor({ state: input.observation.stockState,
    sourceStatus: input.observation.sourceStatus,
    commercialExposureScore: input.commercialExposureScore })
  const from = Date.parse(input.observation.observedAt ?? "")
  const next = Number.isFinite(from)
    ? new Date(from + scheduled.intervalMinutes * 60_000).toISOString()
    : null
  return {
    schedulerVersion: "LUNA_ADAPTIVE_SCHEDULER_V1" as const,
    priority: scheduled.priority,
    reason: scheduled.reason,
    lastObservedAt: input.observation.observedAt,
    nextCheckAt: next,
    intervalMinutes: scheduled.intervalMinutes,
    controls: {
      maximumBatchSize: 100,
      maximumConcurrency: 4,
      maximumAttempts: 3,
      exponentialBackoff: true,
      rateLimitAware: true,
      cacheByCanonicalSource: true,
      dedupeByExactProductVariantSku: true,
      dependentListingFanout: true,
      resumeCheckpoints: true,
      staleEvidencePromotion: true,
    },
  }
}

export function buildLunaWatcherAutomaticResponseV1(input: {
  link: LunaExactApprovedLinkV1
  observation: LunaWatcherObservationV1
  publishedQuantity: number | null
}) {
  const confirmed = input.observation.stockState === "OUT_OF_STOCK_CONFIRMED"
  const publishedQuantity = safeNonNegativeInteger(input.publishedQuantity)
  const safeCapacity = confirmed ? 0 : input.observation.quantityExplicit
    ? input.observation.quantity
    : null
  const publishedExposure = confirmed && publishedQuantity !== null
    ? publishedQuantity
    : safeCapacity !== null && publishedQuantity !== null
      ? Math.max(0, publishedQuantity - safeCapacity)
      : null
  const whatsapp = confirmed
    ? renderCommercialWhatsAppAlertDryRunV1({
        accountKey: input.link.accountKey,
        family: "COMPONENT_OUT_OF_STOCK",
        evidenceFingerprint: input.observation.evidenceFingerprint,
        stateVersion: input.observation.contractVersion,
        observedAt: input.observation.observedAt ?? new Date(0).toISOString(),
        rootCause: "LUNA_EXACT_VARIANT_OUT_OF_STOCK_CONFIRMED",
        listing: { itemId: input.link.ebayItemId, title: input.link.listingTitle },
        stock: { riskClass: "OUT_OF_STOCK_CONFIRMED", exactIdentity: true,
          publishedQuantity, safeCapacity, supplierQuantity: input.observation.quantity },
        deepLinkPath: "/admin/ebay/stock-guard",
      })
    : null
  return {
    responseState: confirmed ? "CRITICAL_RESPONSE_PREPARED" as const
      : input.observation.stockState === "OUT_OF_STOCK_SIGNAL"
        ? "AWAITING_CONFIRMING_OBSERVATION" as const
        : "NO_CRITICAL_RESPONSE_REQUIRED" as const,
    criticalException: confirmed ? {
      classification: "READ_ONLY_EXCEPTION_DRY_RUN" as const,
      severity: "CRITICAL" as const,
      reasonCode: "LUNA_OUT_OF_STOCK_CONFIRMED" as const,
      evidenceFingerprint: input.observation.evidenceFingerprint,
    } : null,
    experimentGuardian: confirmed ? {
      state: "HARD_OVERRIDE" as const,
      action: "PAUSE_FOR_EXTERNAL_SIGNAL" as const,
      variablesRemainFrozen: true,
    } : { state: "NO_OVERRIDE" as const, variablesRemainFrozen: true },
    publishedExposure: {
      publishedQuantity,
      safeCapacity,
      exposedQuantity: publishedExposure,
      relationshipProven: publishedQuantity !== null && safeCapacity !== null,
    },
    recommendedActions: confirmed
      ? ["REDUCE_OR_PAUSE_LISTING_HUMAN_APPROVAL", "SEARCH_ALTERNATIVE_SUPPLIER",
          "REVIEW_OPEN_ORDER_EXPOSURE"] as const
      : input.observation.stockState === "OUT_OF_STOCK_SIGNAL"
        ? ["RECAPTURE_FOR_CONFIRMATION"] as const
        : ["CONTINUE_ADAPTIVE_MONITORING"] as const,
    whatsappStockCriticalDryRun: whatsapp,
    stockExceptionCreated: false as const,
    stockExceptionDryRunPrepared: confirmed,
    whatsappSendAttempted: false as const,
    ebayWriteAttempted: false as const,
    inventoryWriteAttempted: false as const,
    registryWriteAttempted: false as const,
  }
}

export async function runLunaSupplierStockRecaptureV1(input: {
  link: LunaExactApprovedLinkV1
  previous?: LunaWatcherObservationV1 | null
  publishedQuantity: number | null
  commercialExposureScore?: number | null
  now?: string
  trigger?: "INITIAL_HUMAN_APPROVAL" | "SCHEDULED" | "MANUAL_REFRESH"
}, dependencies: {
  captureExactVariant: (
    request: LunaAuthenticatedBrowserAgentRequestV1,
  ) => Promise<LunaAuthenticatedCaptureV1>
}) {
  assertExactApprovedLink(input.link)
  const request = buildLunaAuthenticatedBrowserAgentRequestV1(input.link)
  const capture = await dependencies.captureExactVariant(request)
  const observation = evaluateLunaAuthenticatedBrowserCaptureV1({
    link: input.link,
    capture,
    previous: input.previous,
    now: input.now,
  })
  const scheduler = scheduleLunaWatcherObservationV1({
    observation,
    commercialExposureScore: input.commercialExposureScore,
  })
  return {
    watcherVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
    execution: {
      trigger: input.trigger ?? "MANUAL_REFRESH",
      executed: true,
      persistentScheduleRequested: true,
      persistentScheduleActivated: input.trigger === "SCHEDULED",
    },
    source: resolveLunaWatcherSourcePriorityV1({
      authenticatedBrowserWorkerReady:
        capture.sourceMode === "AUTHENTICATED_WEB_SESSION",
    }),
    observation,
    scheduler,
    automaticResponse: buildLunaWatcherAutomaticResponseV1({
      link: input.link,
      observation,
      publishedQuantity: input.publishedQuantity,
    }),
    safety: {
      rawSessionMaterialReceived: false,
      remoteDdl: 0,
      ebayWrites: 0,
      inventoryWrites: 0,
      fulfillmentWrites: 0,
      registryBusinessDataMutations: 0,
      productCaseMutations: 0,
      whatsappSends: 0,
    },
  }
}

export function buildLunaWatcherBatchPlanV1(input: {
  records: Array<{
    link: LunaExactApprovedLinkV1
    dependencyKey?: string | null
    latestObservation: LunaWatcherObservationV1 | null
    nextCheckAt: string | null
    commercialExposureScore?: number | null
  }>
  now?: string
  maximumBatchSize?: number
  maximumConcurrency?: number
  checkpointAfterKey?: string | null
}) {
  const now = Date.parse(input.now ?? new Date().toISOString())
  const maximumBatchSize = Math.max(1, Math.min(input.maximumBatchSize ?? 100, 100))
  const maximumConcurrency = Math.max(1, Math.min(input.maximumConcurrency ?? 4, 4))
  const grouped = new Map<string, typeof input.records>()
  for (const entry of input.records) {
    assertExactApprovedLink(entry.link)
    const key = JSON.stringify([entry.link.supplierProductId,
      entry.link.supplierVariantId, entry.link.supplierSku,
      canonicalLunaProductUrlV1(entry.link.canonicalSourceUrl)])
    grouped.set(key, [...(grouped.get(key) ?? []), entry])
  }
  const ranked = [...grouped.entries()].map(([key, dependents]) => {
    const representative = dependents[0]
    const states = dependents.map((entry) => entry.latestObservation?.stockState ??
      "STOCK_UNKNOWN" as LunaWatcherStockStateV1)
    const state = states.includes("OUT_OF_STOCK_CONFIRMED")
      ? "OUT_OF_STOCK_CONFIRMED" as const
      : states.includes("OUT_OF_STOCK_SIGNAL")
        ? "OUT_OF_STOCK_SIGNAL" as const
        : states.includes("STALE_EVIDENCE")
          ? "STALE_EVIDENCE" as const
          : states[0]
    const exposure = Math.max(...dependents.map((entry) =>
      Number(entry.commercialExposureScore ?? 0)))
    const priority = priorityFor({ state, commercialExposureScore: exposure })
    const nextChecks = dependents.map((entry) => Date.parse(entry.nextCheckAt ?? ""))
      .filter(Number.isFinite)
    const nextCheck = nextChecks.length ? Math.min(...nextChecks) : Number.NaN
    return { key, representative, dependents, priority,
      due: !Number.isFinite(nextCheck) || !Number.isFinite(now) || nextCheck <= now }
  }).filter((row) => row.due)
    .sort((left, right) => left.priority.priority.localeCompare(right.priority.priority) ||
      left.key.localeCompare(right.key))
  const resumed = input.checkpointAfterKey
    ? ranked.filter((row) => row.key > input.checkpointAfterKey!)
    : ranked
  const selected = resumed.slice(0, maximumBatchSize)
  return {
    schedulerVersion: "LUNA_ADAPTIVE_SCHEDULER_V1" as const,
    dueUniqueIdentityCount: ranked.length,
    uniqueExactIdentityCount: grouped.size,
    dependentRecordCount: input.records.length,
    deduplicatedCaptureCount: Math.max(0, input.records.length - grouped.size),
    selected: selected.map((row) => ({
      key: row.key,
      priority: row.priority.priority,
      reason: row.priority.reason,
      canonicalSourceUrl: row.representative.link.canonicalSourceUrl,
      dependentEbayItemIds: [...new Set(row.dependents
        .map((entry) => entry.link.ebayItemId))],
      dependentKeys: [...new Set(row.dependents
        .map((entry) => safeText(entry.dependencyKey, 160)).filter(Boolean))],
    })),
    deferredCount: Math.max(0, resumed.length - selected.length),
    checkpoint: {
      resumeAfterKey: selected.at(-1)?.key ?? input.checkpointAfterKey ?? null,
      complete: resumed.length <= selected.length,
    },
    controls: {
      maximumBatchSize,
      maximumConcurrency,
      maximumAttempts: 3,
      retryBackoff: "EXPONENTIAL_BOUNDED" as const,
      rateLimitAware: true,
      fetchCacheKey: "SUPPLIER_PRODUCT_VARIANT_SKU" as const,
      identityDedupe: true,
      dependentEvidenceFanout: true,
      uncontrolledMarketplaceFanOut: false,
    },
  }
}

/**
 * Legacy public-catalog hardening only. Public Luna data is not selected as
 * the stock source, but a first public unavailable heartbeat must still never
 * become a confirmed downstream stock loss in the older monitor.
 */
export function classifyPublicLunaOutOfStockConfirmationV1(input: {
  observedAvailable: boolean
  previousAvailable: boolean | null
  previousRaw: unknown
}) {
  const previousMonitor = record(record(input.previousRaw)
    .targeted_active_listing_monitor)
  const rawCount = safeNonNegativeInteger(
    previousMonitor.public_out_of_stock_confirmation_count,
  ) ?? 0
  const previousCount = input.previousAvailable === false
    ? Math.max(2, rawCount)
    : input.previousAvailable === null
      ? Math.min(1, rawCount)
      : 0
  if (input.observedAvailable) return {
    stockState: "IN_STOCK_CONFIRMED" as const,
    confirmationCount: 0,
    previousConfirmationCount: previousCount,
    confirmed: true,
    newlyConfirmed: false,
    persistedAvailable: true as boolean | null,
    persistedQuantity: null as number | null,
  }
  const confirmationCount = Math.min(2, previousCount + 1)
  const confirmed = confirmationCount >= 2
  return {
    stockState: confirmed ? "OUT_OF_STOCK_CONFIRMED" as const
      : "OUT_OF_STOCK_SIGNAL" as const,
    confirmationCount,
    previousConfirmationCount: previousCount,
    confirmed,
    newlyConfirmed: confirmed && previousCount < 2,
    persistedAvailable: confirmed ? false : null,
    persistedQuantity: confirmed ? 0 : null,
  }
}

export const LUNA_WATCHER_LARGE_VOLUME_CONTRACT_V1 = Object.freeze({
  newListings: {
    supplierIdentityOrigin: "SOURCING_OR_PRODUCT_CASE_APPROVED_IDENTITY",
    postPublicationManualReconstructionRequired: false,
    exactProductVariantSkuRequired: true,
  },
  existingListings: {
    mode: "BOUNDED_BACKFILL_APPROVAL_QUEUE",
    maximumPageSize: 100,
    firstExactLinkHumanApprovalRequired: true,
    fuzzyAutomaticLinkingAllowed: false,
  },
  sourceWatcher: {
    sourceMode: "AUTHENTICATED_WEB_SESSION",
    protectedServerSessionRequired: false,
    browserFallbackActivated: true,
    browserFallbackEligibility: "AUTHORITATIVE_AUTHENTICATED_PATH",
    dedicatedPersistentProfileRequiredIfLaterAuthorized: false,
    rawSessionMaterialCrossesAgentBoundary: false,
    captchaOrMfaBypassAllowed: false,
  },
  externalExecution: {
    ebayWrites: 0,
    inventoryWrites: 0,
    productCaseMutations: 0,
    whatsappSends: 0,
  },
})
