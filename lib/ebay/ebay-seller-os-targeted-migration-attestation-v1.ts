import { lstat, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { SELLER_OS_CANONICAL_REPOSITORY_V1 } from "./ebay-seller-os-dev-status-v1"
import type { SellerOsWorkspaceFingerprintV1 } from "./ebay-seller-os-workspace-fingerprint-v1.mjs"

export const SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION =
  "SELLER_OS_TARGETED_MIGRATION_ATTESTATION_V1" as const
export const SELLER_OS_TARGETED_MIGRATION_ATTESTATION_ARTIFACT_V1 = resolve(
  SELLER_OS_CANONICAL_REPOSITORY_V1.directory,
  ".seller-os/targeted-migration-attestation-v1.json",
)

export const SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1 = Object.freeze([
  "20260717160000", "20260719150000", "20260719214500", "20260719220000",
  "20260723012000", "20260723013000", "20260724008000", "20260725001000",
  "20260725002000", "20260725003000", "20260725004000", "20260725004500",
  "20260725004600", "20260725005000",
] as const)
export const SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1 = Object.freeze([
  "20260725013000", "20260726140000", "20260726141000", "20260726142000",
  "20260726144000",
] as const)

const MAX_ARTIFACT_BYTES = 96 * 1024
const MAX_LIMITATIONS = 24
const SHA256 = /^sha256:[a-f0-9]{64}$/
const HEAD_SHA = /^[a-f0-9]{40}$/
const LIMITATION = /^[A-Z0-9_:-]{1,120}$/
const EVIDENCE_SOURCE = /^[A-Z0-9_:-]{1,120}$/
const LOCAL_CLASSIFICATIONS = new Set([
  "OPERATION_PRESENT_EQUIVALENT", "OPERATION_ABSENT", "OPERATION_PARTIALLY_PRESENT",
  "OPERATION_CONFLICTED", "ATTESTATION_UNAVAILABLE", "ATTESTATION_INSUFFICIENT",
])
const REMOTE_CLASSIFICATIONS = new Set([
  "EXACT_APPLIED_OPERATION_PROVEN", "HISTORICAL_ARTIFACT_PROVEN_APPLIED",
  "APPLIED_OPERATION_ATTESTATION_ONLY", "OPERATION_EQUIVALENCE_UNPROVEN",
  "ARTIFACT_UNAVAILABLE",
])
const CONFIDENCES = new Set(["HIGH", "MEDIUM", "LOW", "UNPROVEN"])
const DECISIONS = new Set([
  "REPOSITORY_HISTORY_RECONCILIATION_ONLY", "REPOSITORY_HISTORY_REPAIR_REQUIRED",
  "DATABASE_MIGRATION_EXECUTION_REQUIRED", "DATABASE_LEDGER_REPAIR_REQUIRED",
  "SCHEMA_RECONCILIATION_REQUIRED", "MIXED_REMEDIATION_REQUIRED",
  "INSUFFICIENT_EVIDENCE",
])
const DRIFT_STATUSES = new Set(["MATCHED", "DRIFT_DETECTED", "UNPROVEN", "UNAVAILABLE"])

type AttestationStatus = "AVAILABLE" | "PARTIAL" | "STALE" | "UNAVAILABLE"
type Completeness = "COMPLETE" | "PARTIAL" | "UNAVAILABLE"

export type SellerOsTargetedMigrationAttestationV1 = Readonly<{
  contractVersion: typeof SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION
  status: AttestationStatus
  observedAt: string | null
  subject: Readonly<{
    headSha: string | null
    workingTreeStatus: "CLEAN" | "DIRTY" | "UNAVAILABLE"
    workspaceFingerprint: string | null
    workspaceMatch: boolean | null
  }>
  localOnlyCoverage: Readonly<{ expectedCount: 14; evaluatedCount: number; complete: boolean }>
  remoteOnlyCoverage: Readonly<{ expectedCount: 5; evaluatedCount: number; complete: boolean }>
  localOnlyResults: readonly Readonly<{
    migrationId: string; classification: string; confidence: string
    expectedOperationDigest: string | null; observedOperationDigest: string | null
    evidenceSource: string | null; limitationCodes: readonly string[]
  }>[]
  remoteOnlyResults: readonly Readonly<{
    migrationId: string; classification: string; confidence: string
    historicalArtifactDigest: string | null; appliedArtifactDigest: string | null
    evidenceSource: string | null; limitationCodes: readonly string[]
  }>[]
  decision: Readonly<{
    classification: string; databaseMutationAuthorized: false; repositoryMutationAuthorized: false
  }>
  schemaDrift: Readonly<{ status: "MATCHED" | "DRIFT_DETECTED" | "UNPROVEN" | "UNAVAILABLE" }>
  evidenceCompleteness: Completeness
  limitations: readonly string[]
}>

type Artifact = Record<string, unknown>

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
function safeTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 100 || Number.isNaN(Date.parse(value))) return null
  return new Date(value).toISOString()
}
function safeDigest(value: unknown) { return typeof value === "string" && SHA256.test(value) ? value : null }
function safeCode(value: unknown) { return typeof value === "string" && LIMITATION.test(value) ? value : null }
function safeCodes(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_LIMITATIONS) return null
  const values = value.map(safeCode)
  return values.every(Boolean) && new Set(values).size === values.length ? Object.freeze(values as string[]) : null
}
function expectedIds(ids: readonly string[], result: unknown) {
  if (!Array.isArray(result) || result.length > ids.length) return false
  const seen = new Set<string>()
  for (const entry of result) {
    if (!record(entry) || typeof entry.migrationId !== "string" ||
        !ids.includes(entry.migrationId) || seen.has(entry.migrationId)) return false
    seen.add(entry.migrationId)
  }
  return true
}
function unavailable(limitation: string): SellerOsTargetedMigrationAttestationV1 {
  return Object.freeze({
    contractVersion: SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION,
    status: "UNAVAILABLE", observedAt: null,
    subject: Object.freeze({ headSha: null, workingTreeStatus: "UNAVAILABLE",
      workspaceFingerprint: null, workspaceMatch: null }),
    localOnlyCoverage: Object.freeze({ expectedCount: 14, evaluatedCount: 0, complete: false }),
    remoteOnlyCoverage: Object.freeze({ expectedCount: 5, evaluatedCount: 0, complete: false }),
    localOnlyResults: Object.freeze([]), remoteOnlyResults: Object.freeze([]),
    decision: Object.freeze({ classification: "INSUFFICIENT_EVIDENCE",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false }),
    schemaDrift: Object.freeze({ status: "UNPROVEN" }), evidenceCompleteness: "UNAVAILABLE",
    limitations: Object.freeze([limitation]),
  })
}

function parseLocal(entry: unknown) {
  if (!record(entry) || typeof entry.migrationId !== "string" ||
      !LOCAL_CLASSIFICATIONS.has(String(entry.classification)) ||
      !CONFIDENCES.has(String(entry.confidence))) return null
  const limitationCodes = safeCodes(entry.limitationCodes)
  if (!limitationCodes) return null
  return Object.freeze({ migrationId: entry.migrationId, classification: String(entry.classification),
    confidence: String(entry.confidence), expectedOperationDigest: safeDigest(entry.expectedOperationDigest),
    observedOperationDigest: safeDigest(entry.observedOperationDigest),
    evidenceSource: safeCode(entry.evidenceSource), limitationCodes })
}
function parseRemote(entry: unknown) {
  if (!record(entry) || typeof entry.migrationId !== "string" ||
      !REMOTE_CLASSIFICATIONS.has(String(entry.classification)) ||
      !CONFIDENCES.has(String(entry.confidence))) return null
  const limitationCodes = safeCodes(entry.limitationCodes)
  if (!limitationCodes) return null
  return Object.freeze({ migrationId: entry.migrationId, classification: String(entry.classification),
    confidence: String(entry.confidence), historicalArtifactDigest: safeDigest(entry.historicalArtifactDigest),
    appliedArtifactDigest: safeDigest(entry.appliedArtifactDigest),
    evidenceSource: safeCode(entry.evidenceSource), limitationCodes })
}

export function parseSellerOsTargetedMigrationAttestationV1(
  input: unknown,
  currentSubject: SellerOsWorkspaceFingerprintV1 | null,
): SellerOsTargetedMigrationAttestationV1 {
  if (!record(input) || input.artifactVersion !== SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION ||
      !record(input.subject) || !record(input.decision) || !record(input.schemaDrift) ||
      !Array.isArray(input.localOnlyResults) || !Array.isArray(input.remoteOnlyResults) ||
      !expectedIds(SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1, input.localOnlyResults) ||
      !expectedIds(SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1, input.remoteOnlyResults)) {
    return unavailable("TARGETED_ATTESTATION_ARTIFACT_MALFORMED")
  }
  const localOnlyResults = input.localOnlyResults.map(parseLocal)
  const remoteOnlyResults = input.remoteOnlyResults.map(parseRemote)
  const limitations = safeCodes(input.limitations)
  const artifactSubject = input.subject
  const headSha = typeof artifactSubject.headSha === "string" && HEAD_SHA.test(artifactSubject.headSha)
    ? artifactSubject.headSha : null
  const workspaceFingerprint = safeDigest(artifactSubject.workspaceFingerprint)
  const workingTreeStatus = artifactSubject.workingTreeStatus === "CLEAN" ||
    artifactSubject.workingTreeStatus === "DIRTY" ? artifactSubject.workingTreeStatus : "UNAVAILABLE"
  const decision = String(input.decision.classification)
  const drift = String(input.schemaDrift.status)
  if (localOnlyResults.some((entry) => !entry) || remoteOnlyResults.some((entry) => !entry) ||
      !limitations || !headSha || !workspaceFingerprint || workingTreeStatus === "UNAVAILABLE" ||
      !DECISIONS.has(decision) || !DRIFT_STATUSES.has(drift) ||
      input.decision.databaseMutationAuthorized !== false || input.decision.repositoryMutationAuthorized !== false) {
    return unavailable("TARGETED_ATTESTATION_ARTIFACT_MALFORMED")
  }
  const local = Object.freeze(localOnlyResults as NonNullable<(typeof localOnlyResults)[number]>[])
  const remote = Object.freeze(remoteOnlyResults as NonNullable<(typeof remoteOnlyResults)[number]>[])
  const localComplete = local.length === SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1.length
  const remoteComplete = remote.length === SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1.length
  const currentAvailable = currentSubject?.status === "AVAILABLE"
  const workspaceMatch = currentAvailable
    ? currentSubject.headSha === headSha && currentSubject.fingerprint === workspaceFingerprint &&
      currentSubject.workingTreeStatus === workingTreeStatus : null
  const status: AttestationStatus = !currentAvailable ? "UNAVAILABLE"
    : workspaceMatch === false ? "STALE"
    : localComplete && remoteComplete ? "AVAILABLE" : "PARTIAL"
  const hasUncertainty = [...local, ...remote].some((entry) =>
    entry.classification.includes("INSUFFICIENT") || entry.classification.includes("UNAVAILABLE") ||
    entry.classification.includes("UNPROVEN") || entry.limitationCodes.length > 0)
  return Object.freeze({
    contractVersion: SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION,
    status, observedAt: safeTimestamp(input.observedAt),
    subject: Object.freeze({ headSha, workingTreeStatus, workspaceFingerprint, workspaceMatch }),
    localOnlyCoverage: Object.freeze({ expectedCount: 14, evaluatedCount: local.length,
      complete: localComplete }),
    remoteOnlyCoverage: Object.freeze({ expectedCount: 5, evaluatedCount: remote.length,
      complete: remoteComplete }),
    localOnlyResults: local, remoteOnlyResults: remote,
    decision: Object.freeze({ classification: decision, databaseMutationAuthorized: false,
      repositoryMutationAuthorized: false }),
    schemaDrift: Object.freeze({ status: drift as SellerOsTargetedMigrationAttestationV1["schemaDrift"]["status"] }),
    evidenceCompleteness: status === "UNAVAILABLE" ? "UNAVAILABLE" :
      !localComplete || !remoteComplete || hasUncertainty || limitations.length ? "PARTIAL" : "COMPLETE",
    limitations: Object.freeze(limitations),
  })
}

export async function readSellerOsTargetedMigrationAttestationArtifactV1() {
  let stat
  try { stat = await lstat(SELLER_OS_TARGETED_MIGRATION_ATTESTATION_ARTIFACT_V1) } catch {
    throw new Error("TARGETED_ATTESTATION_ARTIFACT_UNAVAILABLE")
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_ARTIFACT_BYTES) {
    throw new Error("TARGETED_ATTESTATION_ARTIFACT_UNAVAILABLE")
  }
  return readFile(SELLER_OS_TARGETED_MIGRATION_ATTESTATION_ARTIFACT_V1, "utf8")
}

export function unavailableSellerOsTargetedMigrationAttestationV1() {
  return unavailable("TARGETED_ATTESTATION_ARTIFACT_UNAVAILABLE")
}
