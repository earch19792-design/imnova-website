export const EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_VERSION =
  "EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_V1" as const

export type DraftOnlyPrewriteCorrelationV1 = Readonly<{
  version: typeof EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_VERSION
  requestId: string
  observedAt: string
  listingPackageId: string
  packageDigest: string | null
  authorizationId: string | null
  priorAuthorizationId: string | null
  attemptId: string | null
}>

export type DraftOnlyPrewriteFailureV1 = DraftOnlyPrewriteCorrelationV1 &
  Readonly<{
    httpStatus: number
    errorCode: string
    blockers: readonly string[]
  }>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function nullableUuid(value: unknown) {
  const normalized = text(value)
  if (!normalized) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : null
}

function parseCorrelation(value: unknown): DraftOnlyPrewriteCorrelationV1 | null {
  const input = record(value)
  const requestId = text(input.requestId)
  const observedAt = text(input.observedAt)
  const listingPackageId = nullableUuid(input.listingPackageId)
  const rawPackageDigest = text(input.packageDigest)
  const packageDigest = /^sha256:[0-9a-f]{64}$/.test(rawPackageDigest)
    ? rawPackageDigest : null
  if (
    input.version !== EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_VERSION
    || !/^[A-Za-z0-9._:-]{8,160}$/.test(requestId)
    || !Number.isFinite(Date.parse(observedAt))
    || !listingPackageId
  ) return null
  return {
    version: EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_VERSION,
    requestId,
    observedAt: new Date(observedAt).toISOString(),
    listingPackageId,
    packageDigest,
    authorizationId: nullableUuid(input.authorizationId),
    priorAuthorizationId: nullableUuid(input.priorAuthorizationId),
    attemptId: nullableUuid(input.attemptId),
  }
}

export function parseDraftOnlyPrewriteFailureV1(
  value: unknown,
): DraftOnlyPrewriteFailureV1 | null {
  const input = record(value)
  const correlation = parseCorrelation(input)
  const httpStatus = Number(input.httpStatus)
  const errorCode = text(input.errorCode)
  if (
    !correlation
    || httpStatus !== 409
    || !/^[A-Z0-9_]{3,180}$/.test(errorCode)
  ) return null
  return {
    ...correlation,
    httpStatus,
    errorCode,
    blockers: Array.isArray(input.blockers)
      ? input.blockers.map(text).filter(Boolean).slice(0, 30)
      : [],
  }
}

export function parseDraftOnlyPrewriteAuthorizationCorrelationV1(
  value: unknown,
) {
  return parseCorrelation(value)
}

/**
 * GET readiness alone can never turn a failed POST into history. The failure
 * becomes historical only after a later, distinct authorization request
 * succeeds for the same package digest and explicitly supersedes/reuses the
 * authorization that the failure was correlated to.
 */
export function draftOnlyPrewriteFailureResolvedV1(input: Readonly<{
  failure: DraftOnlyPrewriteFailureV1
  success: DraftOnlyPrewriteCorrelationV1
}>) {
  const failure = input.failure
  const success = input.success
  const failureAuthorizationId = failure.authorizationId
  return Boolean(
    failure.httpStatus === 409
    && failure.requestId !== success.requestId
    && failure.listingPackageId === success.listingPackageId
    && failure.packageDigest
    && failure.packageDigest === success.packageDigest
    && failureAuthorizationId
    && (
      success.priorAuthorizationId === failureAuthorizationId
      || success.authorizationId === failureAuthorizationId
    )
    && Date.parse(success.observedAt) >= Date.parse(failure.observedAt)
  )
}
