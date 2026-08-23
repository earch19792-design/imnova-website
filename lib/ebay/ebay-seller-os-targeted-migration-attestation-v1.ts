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
  "20260725004600", "20260725005000", "20260823001407",
] as const)
export const SELLER_OS_TARGETED_ARTIFACT_ID_V1 = "20260823001407" as const
export const SELLER_OS_TARGETED_I02W_IDS_V1 = Object.freeze([
  "20260823023000", "20260823034507",
] as const)
export const SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1 = Object.freeze([
  "20260725013000", "20260725013100", "20260726070000", "20260726071000",
  "20260726072000", "20260726073000", "20260726130000", "20260726131000",
  "20260726132000", "20260726133000", "20260726134000", "20260726135000",
  "20260726140000", "20260726141000", "20260726142000", "20260726144000",
  "20260726145000",
] as const)

const MAX_ARTIFACT_BYTES = 96 * 1024
const MAX_LIMITATIONS = 24
const SHA256 = /^sha256:[a-f0-9]{64}$/
const HEAD_SHA = /^[a-f0-9]{40}$/
const LIMITATION = /^[A-Z0-9_:-]{1,120}$/
const EVIDENCE_SOURCE = /^[A-Z0-9_:-]{1,120}$/
const MIGRATION_NAME = /^[a-z0-9][a-z0-9_]{0,180}$/
const LOCAL_CLASSIFICATIONS = new Set([
  "EXACT_OPERATION_ALREADY_PRESENT", "EQUIVALENT_OPERATION_PRESENT", "PARTIALLY_PRESENT",
  "CONFIGURATION_ONLY", "SCHEDULER_OPERATION", "NOT_PRESENT", "DIVERGENT", "UNKNOWN",
])
const REMOTE_CLASSIFICATIONS = new Set([
  "HISTORICAL_REMOTE_OPERATION_PROVEN", "REMOTE_OPERATION_CURRENTLY_PRESENT",
  "REMOTE_OPERATION_SUPERSEDED", "REMOTE_OPERATION_CONFLICT", "UNKNOWN",
])
const CONFIDENCES = new Set(["HIGH", "MEDIUM", "LOW", "UNPROVEN"])
const DECISIONS = new Set([
  "SAFE_TO_APPLY_TARGETED_P2_DELTA", "BLOCKED_BY_SPECIFIC_SCHEMA_DRIFT",
  "BLOCKED_BY_INSUFFICIENT_EVIDENCE", "BLOCKED_BY_MIGRATION_CONFLICT",
  "TARGETED_P2_DELTA_APPLIED", "SAFE_TO_APPLY_TARGETED_OP_LAUNCH_DELTA",
  "TARGETED_OP_LAUNCH_DELTA_APPLIED", "SAFE_TO_APPLY_TARGETED_OP_LAUNCH_RADAR_HOTFIX",
  "TARGETED_OP_LAUNCH_RADAR_HOTFIX_APPLIED", "TARGETED_OP_LAUNCH_I02W_STORAGE_APPLIED",
])
const DRIFT_CONCLUSIONS = new Set([
  "SCHEMA_DRIFT_PROVEN_NONE", "SCHEMA_DRIFT_PRESENT", "SCHEMA_DRIFT_REMAINS_UNPROVEN",
])

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
  ledgerSnapshot: Readonly<{
    localCount: number | null
    appliedCount: number | null
    pendingLocalCount: number | null
    remoteOnlyCount: number | null
    localLedgerDigest: string | null
    appliedLedgerDigest: string | null
  }>
  localOnlyCoverage: Readonly<{ expectedCount: 15; evaluatedCount: number; complete: boolean }>
  remoteOnlyCoverage: Readonly<{ expectedCount: 17; evaluatedCount: number; complete: boolean }>
  localOnlyResults: readonly Readonly<{
    migrationId: string; migrationName: string; classification: string; confidence: string
    artifactRole: "LOCAL_ONLY_NEW_TARGETED_ARTIFACT" | null
    expectedOperationDigest: string | null; observedOperationDigest: string | null
    evidenceSource: string | null; findingCodes: readonly string[]; limitationCodes: readonly string[]
  }>[]
  remoteOnlyResults: readonly Readonly<{
    migrationId: string; migrationName: string; classification: string; confidence: string
    historicalArtifactDigest: string | null; appliedArtifactDigest: string | null
    evidenceSource: string | null; findingCodes: readonly string[]; limitationCodes: readonly string[]
  }>[]
  targetResults: readonly Readonly<{
    migrationId: string; migrationName: string; ledgerStatus: "APPLIED"
    artifactDigest: string; evidenceSource: string
    findingCodes: readonly string[]; limitationCodes: readonly string[]
  }>[]
  decision: Readonly<{
    classification: string; databaseMutationAuthorized: false; repositoryMutationAuthorized: false
  }>
  schemaDrift: Readonly<{
    conclusion: "SCHEMA_DRIFT_PROVEN_NONE" | "SCHEMA_DRIFT_PRESENT" |
      "SCHEMA_DRIFT_REMAINS_UNPROVEN"
    method: string | null
    checkedAt: string | null
  }>
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
function safeEvidenceSource(value: unknown) {
  return typeof value === "string" && EVIDENCE_SOURCE.test(value) ? value : null
}
function safeMigrationName(value: unknown) {
  return typeof value === "string" && MIGRATION_NAME.test(value) ? value : null
}
function safeCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000
    ? Number(value) : null
}
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
    ledgerSnapshot: Object.freeze({ localCount: null, appliedCount: null,
      pendingLocalCount: null, remoteOnlyCount: null, localLedgerDigest: null,
      appliedLedgerDigest: null }),
    localOnlyCoverage: Object.freeze({ expectedCount: 15, evaluatedCount: 0, complete: false }),
    remoteOnlyCoverage: Object.freeze({ expectedCount: 17, evaluatedCount: 0, complete: false }),
    localOnlyResults: Object.freeze([]), remoteOnlyResults: Object.freeze([]),
    targetResults: Object.freeze([]),
    decision: Object.freeze({ classification: "BLOCKED_BY_INSUFFICIENT_EVIDENCE",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false }),
    schemaDrift: Object.freeze({ conclusion: "SCHEMA_DRIFT_REMAINS_UNPROVEN",
      method: null, checkedAt: null }), evidenceCompleteness: "UNAVAILABLE",
    limitations: Object.freeze([limitation]),
  })
}

function parseLocal(entry: unknown) {
  if (!record(entry) || typeof entry.migrationId !== "string" ||
      !safeMigrationName(entry.migrationName) ||
      !LOCAL_CLASSIFICATIONS.has(String(entry.classification)) ||
      !CONFIDENCES.has(String(entry.confidence))) return null
  const findingCodes = safeCodes(entry.findingCodes)
  const limitationCodes = safeCodes(entry.limitationCodes)
  const artifactRole = entry.artifactRole === "LOCAL_ONLY_NEW_TARGETED_ARTIFACT"
    ? entry.artifactRole : entry.artifactRole === null ? null : undefined
  if (!findingCodes || !limitationCodes || artifactRole === undefined) return null
  return Object.freeze({ migrationId: entry.migrationId,
    migrationName: String(entry.migrationName), classification: String(entry.classification),
    confidence: String(entry.confidence), artifactRole,
    expectedOperationDigest: safeDigest(entry.expectedOperationDigest),
    observedOperationDigest: safeDigest(entry.observedOperationDigest),
    evidenceSource: safeEvidenceSource(entry.evidenceSource), findingCodes, limitationCodes })
}
function parseRemote(entry: unknown) {
  if (!record(entry) || typeof entry.migrationId !== "string" ||
      !safeMigrationName(entry.migrationName) ||
      !REMOTE_CLASSIFICATIONS.has(String(entry.classification)) ||
      !CONFIDENCES.has(String(entry.confidence))) return null
  const findingCodes = safeCodes(entry.findingCodes)
  const limitationCodes = safeCodes(entry.limitationCodes)
  if (!findingCodes || !limitationCodes) return null
  return Object.freeze({ migrationId: entry.migrationId,
    migrationName: String(entry.migrationName), classification: String(entry.classification),
    confidence: String(entry.confidence), historicalArtifactDigest: safeDigest(entry.historicalArtifactDigest),
    appliedArtifactDigest: safeDigest(entry.appliedArtifactDigest),
    evidenceSource: safeEvidenceSource(entry.evidenceSource), findingCodes, limitationCodes })
}

function parseTarget(entry: unknown) {
  if (!record(entry) || typeof entry.migrationId !== "string" ||
      !SELLER_OS_TARGETED_I02W_IDS_V1.includes(entry.migrationId as never) ||
      !safeMigrationName(entry.migrationName) || entry.ledgerStatus !== "APPLIED") return null
  const artifactDigest = safeDigest(entry.artifactDigest)
  const evidenceSource = safeEvidenceSource(entry.evidenceSource)
  const findingCodes = safeCodes(entry.findingCodes)
  const limitationCodes = safeCodes(entry.limitationCodes)
  if (!artifactDigest || !evidenceSource || !findingCodes || !limitationCodes) return null
  return Object.freeze({ migrationId: entry.migrationId,
    migrationName: String(entry.migrationName), ledgerStatus: "APPLIED" as const,
    artifactDigest, evidenceSource, findingCodes, limitationCodes })
}

export function parseSellerOsTargetedMigrationAttestationV1(
  input: unknown,
  currentSubject: SellerOsWorkspaceFingerprintV1 | null,
): SellerOsTargetedMigrationAttestationV1 {
  if (!record(input) || input.artifactVersion !== SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION ||
      !record(input.subject) || !record(input.decision) || !record(input.schemaDrift) ||
      !record(input.ledgerSnapshot) ||
      !Array.isArray(input.localOnlyResults) || !Array.isArray(input.remoteOnlyResults) ||
      !expectedIds(SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1, input.localOnlyResults) ||
      !expectedIds(SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1, input.remoteOnlyResults)) {
    return unavailable("TARGETED_ATTESTATION_ARTIFACT_MALFORMED")
  }
  const localOnlyResults = input.localOnlyResults.map(parseLocal)
  const remoteOnlyResults = input.remoteOnlyResults.map(parseRemote)
  const rawTargetResults = input.targetResults === undefined ? [] : input.targetResults
  if (!Array.isArray(rawTargetResults) ||
      !expectedIds(SELLER_OS_TARGETED_I02W_IDS_V1, rawTargetResults)) {
    return unavailable("TARGETED_ATTESTATION_ARTIFACT_MALFORMED")
  }
  const targetResults = rawTargetResults.map(parseTarget)
  const limitations = safeCodes(input.limitations)
  const artifactSubject = input.subject
  const headSha = typeof artifactSubject.headSha === "string" && HEAD_SHA.test(artifactSubject.headSha)
    ? artifactSubject.headSha : null
  const workspaceFingerprint = safeDigest(artifactSubject.workspaceFingerprint)
  const workingTreeStatus = artifactSubject.workingTreeStatus === "CLEAN" ||
    artifactSubject.workingTreeStatus === "DIRTY" ? artifactSubject.workingTreeStatus : "UNAVAILABLE"
  const observedAt = safeTimestamp(input.observedAt)
  const decision = String(input.decision.classification)
  const driftConclusion = String(input.schemaDrift.conclusion)
  const driftMethod = safeEvidenceSource(input.schemaDrift.method)
  const driftCheckedAt = safeTimestamp(input.schemaDrift.checkedAt)
  const ledger = input.ledgerSnapshot
  const localCount = safeCount(ledger.localCount)
  const appliedCount = safeCount(ledger.appliedCount)
  const pendingLocalCount = safeCount(ledger.pendingLocalCount)
  const remoteOnlyCount = safeCount(ledger.remoteOnlyCount)
  const localLedgerDigest = safeDigest(ledger.localLedgerDigest)
  const appliedLedgerDigest = safeDigest(ledger.appliedLedgerDigest)
  const ledgerValid = localCount !== null && appliedCount !== null &&
    pendingLocalCount !== null &&
    remoteOnlyCount === SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1.length &&
    localCount - pendingLocalCount + remoteOnlyCount === appliedCount &&
    Boolean(localLedgerDigest) && Boolean(appliedLedgerDigest)
  if (localOnlyResults.some((entry) => !entry) || remoteOnlyResults.some((entry) => !entry) ||
      targetResults.some((entry) => !entry) ||
      !limitations || !headSha || !workspaceFingerprint || !observedAt ||
      workingTreeStatus === "UNAVAILABLE" || !ledgerValid ||
      !DECISIONS.has(decision) || !DRIFT_CONCLUSIONS.has(driftConclusion) ||
      !driftMethod || !driftCheckedAt ||
      input.decision.databaseMutationAuthorized !== false || input.decision.repositoryMutationAuthorized !== false) {
    return unavailable("TARGETED_ATTESTATION_ARTIFACT_MALFORMED")
  }
  const local = Object.freeze(localOnlyResults as NonNullable<(typeof localOnlyResults)[number]>[])
  const remote = Object.freeze(remoteOnlyResults as NonNullable<(typeof remoteOnlyResults)[number]>[])
  const targets = Object.freeze(targetResults as NonNullable<(typeof targetResults)[number]>[])
  const localComplete = local.length === SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1.length
  const remoteComplete = remote.length === SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1.length
  const targetedArtifact = local.find((entry) =>
    entry.migrationId === SELLER_OS_TARGETED_ARTIFACT_ID_V1)
  const targetPending = Boolean(targetedArtifact) &&
    targetedArtifact?.classification === "NOT_PRESENT" &&
    pendingLocalCount === 15 && appliedCount === 258
  const targetApplied = Boolean(targetedArtifact) &&
    targetedArtifact?.classification === "EXACT_OPERATION_ALREADY_PRESENT" &&
    targetedArtifact.expectedOperationDigest !== null &&
    targetedArtifact.expectedOperationDigest === targetedArtifact.observedOperationDigest &&
    pendingLocalCount === 14 && appliedCount === 259
  const i02wApplied = targets.length === SELLER_OS_TARGETED_I02W_IDS_V1.length &&
    targetedArtifact?.classification === "EXACT_OPERATION_ALREADY_PRESENT" &&
    targetedArtifact.expectedOperationDigest !== null &&
    targetedArtifact.expectedOperationDigest === targetedArtifact.observedOperationDigest &&
    SELLER_OS_TARGETED_I02W_IDS_V1.every((migrationId) =>
      targets.some((entry) => entry.migrationId === migrationId &&
        entry.ledgerStatus === "APPLIED" && entry.limitationCodes.length === 0)) &&
    localCount === 258 && pendingLocalCount === 14 && appliedCount === 261
  const targetDecisionValid = (targetPending &&
    decision === "SAFE_TO_APPLY_TARGETED_OP_LAUNCH_RADAR_HOTFIX") ||
    (targetApplied && decision === "TARGETED_OP_LAUNCH_RADAR_HOTFIX_APPLIED") ||
    (i02wApplied && decision === "TARGETED_OP_LAUNCH_I02W_STORAGE_APPLIED")
  const artifactRolesValid = !localComplete || (Boolean(targetedArtifact) &&
    (targetPending || targetApplied || i02wApplied) && targetDecisionValid &&
    targetedArtifact?.artifactRole === "LOCAL_ONLY_NEW_TARGETED_ARTIFACT" &&
    local.every((entry) =>
      entry.migrationId === SELLER_OS_TARGETED_ARTIFACT_ID_V1 || entry.artifactRole === null))
  if (!artifactRolesValid) return unavailable("TARGETED_ATTESTATION_ARTIFACT_MALFORMED")
  const currentAvailable = currentSubject?.status === "AVAILABLE"
  const workspaceMatch = currentAvailable
    ? currentSubject.headSha === headSha && currentSubject.fingerprint === workspaceFingerprint &&
      currentSubject.workingTreeStatus === workingTreeStatus : null
  const status: AttestationStatus = !currentAvailable ? "UNAVAILABLE"
    : workspaceMatch === false ? "STALE"
    : localComplete && remoteComplete ? "AVAILABLE" : "PARTIAL"
  const hasUncertainty = [...local, ...remote].some((entry) =>
    entry.classification === "UNKNOWN" || entry.classification === "DIVERGENT" ||
    entry.classification === "REMOTE_OPERATION_CONFLICT" ||
    entry.confidence === "UNPROVEN" || entry.limitationCodes.length > 0) ||
    targets.some((entry) => entry.limitationCodes.length > 0) ||
    driftConclusion === "SCHEMA_DRIFT_REMAINS_UNPROVEN"
  return Object.freeze({
    contractVersion: SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION,
    status, observedAt,
    subject: Object.freeze({ headSha, workingTreeStatus, workspaceFingerprint, workspaceMatch }),
    ledgerSnapshot: Object.freeze({ localCount, appliedCount, pendingLocalCount,
      remoteOnlyCount, localLedgerDigest, appliedLedgerDigest }),
    localOnlyCoverage: Object.freeze({ expectedCount: 15, evaluatedCount: local.length,
      complete: localComplete }),
    remoteOnlyCoverage: Object.freeze({ expectedCount: 17, evaluatedCount: remote.length,
      complete: remoteComplete }),
    localOnlyResults: local, remoteOnlyResults: remote, targetResults: targets,
    decision: Object.freeze({ classification: decision, databaseMutationAuthorized: false,
      repositoryMutationAuthorized: false }),
    schemaDrift: Object.freeze({
      conclusion: driftConclusion as SellerOsTargetedMigrationAttestationV1["schemaDrift"]["conclusion"],
      method: driftMethod, checkedAt: driftCheckedAt,
    }),
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
