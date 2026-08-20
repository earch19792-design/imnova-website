import { lstat, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  SELLER_OS_CANONICAL_REPOSITORY_V1,
} from "./ebay-seller-os-dev-status-v1"
import {
  SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
  collectSellerOsWorkspaceFingerprintV1,
  type SellerOsWorkspaceFingerprintV1,
} from "./ebay-seller-os-workspace-fingerprint-v1.mjs"

export const SELLER_OS_CI_STATUS_CONTRACT_VERSION = "SELLER_OS_CI_STATUS_V1"
export const SELLER_OS_VALIDATION_EVIDENCE_VERSION = "SELLER_OS_VALIDATION_EVIDENCE_V1"
export const SELLER_OS_CI_STATUS_ARTIFACT_V1 = Object.freeze({
  relativePath: ".seller-os/validation-evidence-v1.json",
  absolutePath: resolve(SELLER_OS_CANONICAL_REPOSITORY_V1.directory,
    ".seller-os/validation-evidence-v1.json"),
})

export const SELLER_OS_CI_STATUS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_ci_status",
  title: "Get Seller OS CI and validation status",
  description: "Read only bounded, SHA-bound Seller OS validation evidence from one fixed local artifact. This tool never runs tests, builds, audits, shell commands, or caller-supplied commands.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

const MAX_ARTIFACT_BYTES = 96 * 1024
const MAX_FAILURE_SUMMARIES = 20
const MAX_LIMITATIONS = 24
const MAX_SUMMARY_IDENTIFIER_LENGTH = 180

type CheckStatusV1 = "PASS" | "FAIL" | "NOT_RUN" | "UNAVAILABLE"
type ValidationStatusV1 = "PASS" | "FAIL" | "PARTIAL" | "STALE" | "UNAVAILABLE"
type ValidationSourceV1 = "LOCAL_VALIDATION" | "CI_PROVIDER" | "EXISTING_ARTIFACT" | "UNAVAILABLE"
type ValidationSubjectTypeV1 = "CLEAN_COMMITTED_HEAD" | "DIRTY_WORKTREE_SNAPSHOT" | "UNAVAILABLE"
type WorkingTreeStatusV1 = "CLEAN" | "DIRTY" | "UNAVAILABLE"

type CheckResultV1 = Readonly<{
  status: CheckStatusV1
  exitCode: number | null
  durationMs: number | null
  completedAt: string | null
}>

type TestCheckResultV1 = CheckResultV1 & Readonly<{
  scope: "FULL_SELLER_OS_SUITE" | null
  passed: number | null
  failed: number | null
  skipped: number | null
  failureSummaries: readonly Readonly<{
    check: "tests"
    identifier: string
    classification: "TEST_FAILURE"
  }>[]
  failuresTruncated: boolean
}>

export type SellerOsCiStatusV1 = Readonly<{
  contractVersion: typeof SELLER_OS_CI_STATUS_CONTRACT_VERSION
  observedAt: string
  currentHead: Readonly<{ sha: string | null }>
  validation: Readonly<{
    status: ValidationStatusV1
    validatedHeadSha: string | null
    startedAt: string | null
    completedAt: string | null
    freshness: "CURRENT_SUBJECT" | "STALE_HEAD" | "STALE_WORKSPACE" | "UNKNOWN"
    source: ValidationSourceV1
  }>
  validationSubject: Readonly<{
    type: ValidationSubjectTypeV1
    validatedWorkingTreeStatus: WorkingTreeStatusV1
    currentWorkingTreeStatus: WorkingTreeStatusV1
    validatedWorkspaceFingerprint: string | null
    currentWorkspaceFingerprint: string | null
    workspaceMatch: boolean | null
    fingerprintVersion: typeof SELLER_OS_WORKSPACE_FINGERPRINT_VERSION
    workspaceStableDuringValidation: boolean | null
  }>
  provenance: Readonly<{
    producerId: "SELLER_OS_VALIDATION_RECORDER" | null
    producerVersion: "SELLER_OS_VALIDATION_RECORDER_V2" | null
  }>
  checks: Readonly<{
    tests: TestCheckResultV1
    typecheck: CheckResultV1
    lint: CheckResultV1
    build: CheckResultV1
    sellerOsAudit: CheckResultV1
  }>
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"
  limitations: readonly string[]
  safety: Readonly<{
    readOnly: true
    arbitraryCommandAllowed: false
    callerControlledCommandAllowed: false
    callerControlledWorkingDirectoryAllowed: false
    fullLogsIncluded: false
    fileContentsIncluded: false
    credentialsIncluded: false
    environmentValuesIncluded: false
    marketplaceWrites: 0
    inventoryWrites: 0
    productCaseMutations: 0
    lunaLinkMutations: 0
    whatsappSends: 0
  }>
}>

export type SellerOsCiStatusAdapterV1 = Readonly<{
  readArtifact: () => Promise<string>
  readCurrentSubject: () => Promise<SellerOsWorkspaceFingerprintV1>
}>

const SAFETY = Object.freeze({
  readOnly: true as const,
  arbitraryCommandAllowed: false as const,
  callerControlledCommandAllowed: false as const,
  callerControlledWorkingDirectoryAllowed: false as const,
  fullLogsIncluded: false as const,
  fileContentsIncluded: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  marketplaceWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  whatsappSends: 0 as const,
})

const UNAVAILABLE_CHECK: CheckResultV1 = Object.freeze({
  status: "UNAVAILABLE", exitCode: null, durationMs: null, completedAt: null,
})
const UNAVAILABLE_TEST_CHECK: TestCheckResultV1 = Object.freeze({
  ...UNAVAILABLE_CHECK, scope: null, passed: null, failed: null, skipped: null,
  failureSummaries: Object.freeze([]), failuresTruncated: false,
})

const DEFAULT_ADAPTER: SellerOsCiStatusAdapterV1 = Object.freeze({
  readArtifact: async () => {
    const stat = await lstat(SELLER_OS_CI_STATUS_ARTIFACT_V1.absolutePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) {
      throw new Error("SELLER_OS_CI_STATUS_ARTIFACT_NOT_TRUSTWORTHY")
    }
    const artifact = await readFile(SELLER_OS_CI_STATUS_ARTIFACT_V1.absolutePath, "utf8")
    if (Buffer.byteLength(artifact, "utf8") > MAX_ARTIFACT_BYTES) {
      throw new Error("SELLER_OS_CI_STATUS_ARTIFACT_NOT_BOUNDED")
    }
    return artifact
  },
  readCurrentSubject: collectSellerOsWorkspaceFingerprintV1,
})

function safeSha(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value.trim())
    ? value.trim().toLowerCase() : null
}

function safeTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 100) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : null
}

function safeExitCode(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255
    ? value : null
}

function safeCheckStatus(value: unknown): CheckStatusV1 | null {
  return value === "PASS" || value === "FAIL" || value === "NOT_RUN" ||
    value === "UNAVAILABLE" ? value : null
}

function safeSource(value: unknown): ValidationSourceV1 | null {
  return value === "LOCAL_VALIDATION" || value === "CI_PROVIDER" ||
    value === "EXISTING_ARTIFACT" ? value : null
}

function safeFingerprint(value: unknown) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
    ? value : null
}

function safeWorkingTreeStatus(value: unknown): WorkingTreeStatusV1 {
  return value === "CLEAN" || value === "DIRTY" ? value : "UNAVAILABLE"
}

function safeSubjectType(value: unknown): ValidationSubjectTypeV1 {
  return value === "CLEAN_COMMITTED_HEAD" || value === "DIRTY_WORKTREE_SNAPSHOT"
    ? value : "UNAVAILABLE"
}

function normalizeCurrentSubject(value: unknown) {
  if (!isRecord(value) || value.status !== "AVAILABLE" ||
      value.fingerprintVersion !== SELLER_OS_WORKSPACE_FINGERPRINT_VERSION) return null
  const headSha = safeSha(value.headSha)
  const fingerprint = safeFingerprint(value.fingerprint)
  const workingTreeStatus = safeWorkingTreeStatus(value.workingTreeStatus)
  return headSha && fingerprint && workingTreeStatus !== "UNAVAILABLE"
    ? { headSha, fingerprint, workingTreeStatus } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseCheck(value: unknown, limitations: string[], name: string): CheckResultV1 {
  if (!isRecord(value)) {
    limitations.push(`VALIDATION_CHECK_${name}_UNAVAILABLE`)
    return UNAVAILABLE_CHECK
  }
  const status = safeCheckStatus(value.status)
  if (!status) {
    limitations.push(`VALIDATION_CHECK_${name}_MALFORMED`)
    return UNAVAILABLE_CHECK
  }
  const exitCode = value.exitCode === null ? null : safeExitCode(value.exitCode)
  const durationMs = value.durationMs === null ? null : safeNumber(value.durationMs)
  const completedAt = value.completedAt === null ? null : safeTimestamp(value.completedAt)
  const malformed = (value.exitCode !== null && exitCode === null) ||
      (value.durationMs !== null && durationMs === null) ||
      (value.completedAt !== null && completedAt === null)
  if (malformed) {
    limitations.push(`VALIDATION_CHECK_${name}_PARTIAL`)
    return UNAVAILABLE_CHECK
  }
  return Object.freeze({ status, exitCode, durationMs, completedAt })
}

function safeFailureIdentifier(value: unknown) {
  if (!isRecord(value) || typeof value.identifier !== "string" ||
      value.identifier.length === 0 || value.identifier.length > MAX_SUMMARY_IDENTIFIER_LENGTH ||
      value.identifier.startsWith("/") || value.identifier.includes("..") ||
      !/^[a-zA-Z0-9 _.,:;#()[\]{}./-]+$/.test(value.identifier)) return null
  const identifier = value.identifier.trim()
  return /(?:api.?key|token|secret|password|authorization|bearer|credential|private.?key)/i.test(identifier)
    ? null : identifier
}

function parseTests(value: unknown, limitations: string[]): TestCheckResultV1 {
  const base = parseCheck(value, limitations, "TESTS")
  if (!isRecord(value)) return UNAVAILABLE_TEST_CHECK
  if (Object.keys(value).some((key) => !["status", "exitCode", "durationMs", "completedAt",
    "scope", "passed", "failed", "skipped", "failureSummaries", "failuresTruncated"].includes(key))) {
    limitations.push("VALIDATION_TEST_FIELDS_OMITTED_UNSAFE")
  }
  const scope = value.scope === "FULL_SELLER_OS_SUITE" ? "FULL_SELLER_OS_SUITE" : null
  if (!scope && base.status !== "UNAVAILABLE") limitations.push("VALIDATION_TEST_SCOPE_UNAVAILABLE")
  const toCount = (input: unknown) => input === null ? null : safeNumber(input)
  const passed = toCount(value.passed)
  const failed = toCount(value.failed)
  const skipped = toCount(value.skipped)
  if ((value.passed !== null && passed === null) || (value.failed !== null && failed === null) ||
      (value.skipped !== null && skipped === null)) limitations.push("VALIDATION_TEST_COUNTS_PARTIAL")
  const summaries: Array<{ check: "tests"; identifier: string; classification: "TEST_FAILURE" }> = []
  const rawSummaries = Array.isArray(value.failureSummaries) ? value.failureSummaries : []
  if (!Array.isArray(value.failureSummaries) && value.failureSummaries !== undefined) {
    limitations.push("VALIDATION_FAILURE_SUMMARIES_OMITTED_UNSAFE")
  }
  for (const raw of rawSummaries) {
    const identifier = safeFailureIdentifier(raw)
    if (identifier && summaries.length < MAX_FAILURE_SUMMARIES) {
      summaries.push(Object.freeze({ check: "tests", identifier, classification: "TEST_FAILURE" }))
    } else if (!identifier) {
      limitations.push("VALIDATION_FAILURE_SUMMARY_OMITTED_UNSAFE")
    }
  }
  const failuresTruncated = value.failuresTruncated === true || rawSummaries.length > MAX_FAILURE_SUMMARIES
  return Object.freeze({ ...base, scope, passed, failed, skipped,
    failureSummaries: Object.freeze(summaries), failuresTruncated })
}

function boundedLimitations(limitations: readonly string[]) {
  return Object.freeze([...new Set(limitations)].sort().slice(0, MAX_LIMITATIONS))
}

export function createUnavailableSellerOsCiStatusV1(
  timestamp = new Date().toISOString(), currentSubject?: SellerOsWorkspaceFingerprintV1 | null,
): SellerOsCiStatusV1 {
  const current = normalizeCurrentSubject(currentSubject)
  return Object.freeze({
    contractVersion: SELLER_OS_CI_STATUS_CONTRACT_VERSION,
    observedAt: timestamp,
    currentHead: Object.freeze({ sha: current?.headSha ?? null }),
    validation: Object.freeze({ status: "UNAVAILABLE", validatedHeadSha: null,
      startedAt: null, completedAt: null, freshness: "UNKNOWN", source: "UNAVAILABLE" }),
    validationSubject: Object.freeze({ type: "UNAVAILABLE",
      validatedWorkingTreeStatus: "UNAVAILABLE",
      currentWorkingTreeStatus: current?.workingTreeStatus ?? "UNAVAILABLE",
      validatedWorkspaceFingerprint: null,
      currentWorkspaceFingerprint: current?.fingerprint ?? null,
      workspaceMatch: null,
      fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
      workspaceStableDuringValidation: null }),
    provenance: Object.freeze({ producerId: null, producerVersion: null }),
    checks: Object.freeze({ tests: UNAVAILABLE_TEST_CHECK, typecheck: UNAVAILABLE_CHECK,
      lint: UNAVAILABLE_CHECK, build: UNAVAILABLE_CHECK, sellerOsAudit: UNAVAILABLE_CHECK }),
    evidenceCompleteness: "UNAVAILABLE",
    limitations: Object.freeze(["VALIDATION_EVIDENCE_UNAVAILABLE"]),
    safety: SAFETY,
  })
}

export async function collectSellerOsCiStatusV1(options: {
  adapter?: SellerOsCiStatusAdapterV1
  now?: () => Date
} = {}): Promise<SellerOsCiStatusV1> {
  const observedAt = (() => {
    try { return (options.now ?? (() => new Date()))().toISOString() } catch { return new Date().toISOString() }
  })()
  const adapter = options.adapter ?? DEFAULT_ADAPTER
  const [artifactResult, currentSubjectResult] = await Promise.allSettled([
    adapter.readArtifact(), adapter.readCurrentSubject(),
  ])
  const currentSubject = currentSubjectResult.status === "fulfilled"
    ? normalizeCurrentSubject(currentSubjectResult.value) : null
  const currentHead = currentSubject?.headSha ?? null
  if (artifactResult.status !== "fulfilled") {
    return createUnavailableSellerOsCiStatusV1(observedAt,
      currentSubjectResult.status === "fulfilled" ? currentSubjectResult.value : null)
  }
  if (Buffer.byteLength(artifactResult.value, "utf8") > MAX_ARTIFACT_BYTES) {
    return createUnavailableSellerOsCiStatusV1(observedAt,
      currentSubjectResult.status === "fulfilled" ? currentSubjectResult.value : null)
  }
  let artifact: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(artifactResult.value)
    if (!isRecord(parsed) || parsed.artifactVersion !== SELLER_OS_VALIDATION_EVIDENCE_VERSION) {
      return createUnavailableSellerOsCiStatusV1(observedAt,
        currentSubjectResult.status === "fulfilled" ? currentSubjectResult.value : null)
    }
    artifact = parsed
  } catch {
    return createUnavailableSellerOsCiStatusV1(observedAt,
      currentSubjectResult.status === "fulfilled" ? currentSubjectResult.value : null)
  }

  const limitations: string[] = []
  if (Object.keys(artifact).some((key) => !["artifactVersion", "source", "validatedHeadSha",
    "startedAt", "completedAt", "headChangedDuringValidation",
    "workspaceChangedDuringValidation", "validationSubject", "producer", "checks"].includes(key))) {
    limitations.push("VALIDATION_ARTIFACT_FIELDS_OMITTED_UNSAFE")
  }
  const validatedHeadSha = safeSha(artifact.validatedHeadSha)
  const startedAt = safeTimestamp(artifact.startedAt)
  const completedAt = safeTimestamp(artifact.completedAt)
  const source = safeSource(artifact.source) ?? "UNAVAILABLE"
  if (!validatedHeadSha) limitations.push("VALIDATED_HEAD_SHA_UNAVAILABLE")
  if (!startedAt || !completedAt) limitations.push("VALIDATION_TIMESTAMPS_PARTIAL")
  if (source === "UNAVAILABLE") limitations.push("VALIDATION_SOURCE_UNAVAILABLE")
  if (artifact.headChangedDuringValidation === true) limitations.push("VALIDATION_HEAD_CHANGED_DURING_RUN")
  if (artifact.workspaceChangedDuringValidation === true) {
    limitations.push("VALIDATION_WORKSPACE_CHANGED_DURING_RUN")
  }
  const subjectRecord = isRecord(artifact.validationSubject)
    ? artifact.validationSubject : null
  const subjectType = safeSubjectType(subjectRecord?.type)
  const validatedWorkingTreeStatus = safeWorkingTreeStatus(
    subjectRecord?.validatedWorkingTreeStatus,
  )
  const validatedWorkspaceFingerprint = safeFingerprint(
    subjectRecord?.validatedWorkspaceFingerprint,
  )
  const fingerprintVersion = subjectRecord?.fingerprintVersion ===
    SELLER_OS_WORKSPACE_FINGERPRINT_VERSION
    ? SELLER_OS_WORKSPACE_FINGERPRINT_VERSION : null
  const workspaceStableDuringValidation = subjectRecord?.workspaceStableDuringValidation === true
    ? true : subjectRecord?.workspaceStableDuringValidation === false ? false : null
  const cleanSubjectConsistent = subjectType === "CLEAN_COMMITTED_HEAD" &&
    validatedWorkingTreeStatus === "CLEAN"
  const dirtySubjectConsistent = subjectType === "DIRTY_WORKTREE_SNAPSHOT" &&
    validatedWorkingTreeStatus === "DIRTY"
  const subjectBound = Boolean(subjectRecord && validatedWorkspaceFingerprint && fingerprintVersion &&
    workspaceStableDuringValidation === true &&
    (cleanSubjectConsistent || dirtySubjectConsistent))
  if (!subjectBound) {
    limitations.push(currentSubject?.workingTreeStatus === "DIRTY"
      ? "DIRTY_WORKTREE_VALIDATION_SUBJECT_UNBOUND"
      : "VALIDATION_WORKSPACE_FINGERPRINT_UNAVAILABLE")
  }
  const workspaceMatch = subjectBound && currentSubject
    ? validatedWorkspaceFingerprint === currentSubject.fingerprint : null
  const producerRecord = isRecord(artifact.producer) ? artifact.producer : null
  const producerId = producerRecord?.id === "SELLER_OS_VALIDATION_RECORDER"
    ? "SELLER_OS_VALIDATION_RECORDER" as const : null
  const producerVersion = producerRecord?.version === "SELLER_OS_VALIDATION_RECORDER_V2"
    ? "SELLER_OS_VALIDATION_RECORDER_V2" as const : null
  if (!producerId || !producerVersion) limitations.push("VALIDATION_PRODUCER_UNAVAILABLE")
  const checksRecord = isRecord(artifact.checks) ? artifact.checks : null
  if (!checksRecord) limitations.push("VALIDATION_CHECKS_UNAVAILABLE")
  const tests = parseTests(checksRecord?.tests, limitations)
  const typecheck = parseCheck(checksRecord?.typecheck, limitations, "TYPECHECK")
  const lint = parseCheck(checksRecord?.lint, limitations, "LINT")
  const build = parseCheck(checksRecord?.build, limitations, "BUILD")
  const sellerOsAudit = parseCheck(checksRecord?.sellerOsAudit, limitations, "SELLER_OS_AUDIT")
  const allChecks = [tests, typecheck, lint, build, sellerOsAudit]
  const allChecksPassed = allChecks.every((check) => check.status === "PASS")
  const anyCheckFailed = allChecks.some((check) => check.status === "FAIL")
  const allChecksExecuted = allChecks.every((check) => check.status === "PASS" || check.status === "FAIL")
  const freshness = currentHead && validatedHeadSha
    ? currentHead !== validatedHeadSha ? "STALE_HEAD" as const
      : workspaceMatch === false ? "STALE_WORKSPACE" as const
        : workspaceMatch === true ? "CURRENT_SUBJECT" as const : "UNKNOWN" as const
    : "UNKNOWN" as const
  let status: ValidationStatusV1
  if (!currentSubject || !currentHead) {
    limitations.push("CURRENT_WORKSPACE_SUBJECT_UNAVAILABLE")
    status = "UNAVAILABLE"
  } else if (!validatedHeadSha || artifact.headChangedDuringValidation === true ||
      artifact.workspaceChangedDuringValidation === true) {
    status = "PARTIAL"
  } else if (freshness === "STALE_HEAD" || freshness === "STALE_WORKSPACE") {
    status = "STALE"
  } else if (!subjectBound || workspaceMatch !== true) {
    status = "PARTIAL"
  } else if (anyCheckFailed) {
    status = "FAIL"
  } else if (allChecksPassed) {
    status = "PASS"
  } else {
    status = "PARTIAL"
  }
  const completeness = allChecksExecuted && validatedHeadSha && source !== "UNAVAILABLE" &&
    subjectBound && currentSubject && producerId && producerVersion
    ? "COMPLETE" as const : "PARTIAL" as const
  return Object.freeze({
    contractVersion: SELLER_OS_CI_STATUS_CONTRACT_VERSION,
    observedAt,
    currentHead: Object.freeze({ sha: currentHead }),
    validation: Object.freeze({ status, validatedHeadSha, startedAt, completedAt,
      freshness, source }),
    validationSubject: Object.freeze({ type: subjectBound ? subjectType : "UNAVAILABLE",
      validatedWorkingTreeStatus: subjectBound
        ? validatedWorkingTreeStatus : "UNAVAILABLE",
      currentWorkingTreeStatus: currentSubject?.workingTreeStatus ?? "UNAVAILABLE",
      validatedWorkspaceFingerprint: subjectBound ? validatedWorkspaceFingerprint : null,
      currentWorkspaceFingerprint: currentSubject?.fingerprint ?? null,
      workspaceMatch,
      fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
      workspaceStableDuringValidation }),
    provenance: Object.freeze({ producerId, producerVersion }),
    checks: Object.freeze({ tests, typecheck, lint, build, sellerOsAudit }),
    evidenceCompleteness: completeness,
    limitations: boundedLimitations(limitations),
    safety: SAFETY,
  })
}
