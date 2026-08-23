import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const previous = require.extensions[".ts"]
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename,
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ES2022 } })
  module._compile(output.outputText, filename)
}
const { parseSellerOsTargetedMigrationAttestationV1,
  SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1, SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1,
  SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION } =
  require("./ebay-seller-os-targeted-migration-attestation-v1.ts")
if (previous) require.extensions[".ts"] = previous
else delete require.extensions[".ts"]

const HEAD = "18cedb53d9d8e396302132a779a2a93a30044e23"
const FINGERPRINT = `sha256:${"a".repeat(64)}`
const CURRENT = { status: "AVAILABLE", headSha: HEAD, workingTreeStatus: "DIRTY",
  fingerprint: FINGERPRINT }
function artifact(overrides = {}) {
  return { artifactVersion: SELLER_OS_TARGETED_MIGRATION_ATTESTATION_CONTRACT_VERSION,
    observedAt: "2026-08-20T13:00:00.000Z", subject: { headSha: HEAD,
      workingTreeStatus: "DIRTY", workspaceFingerprint: FINGERPRINT },
    ledgerSnapshot: { localCount: 256, appliedCount: 258, pendingLocalCount: 15,
      remoteOnlyCount: 17, localLedgerDigest: `sha256:${"c".repeat(64)}`,
      appliedLedgerDigest: `sha256:${"d".repeat(64)}` },
    localOnlyResults: SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1.map((migrationId) => ({ migrationId,
      migrationName: `migration_${migrationId}`,
      classification: migrationId === "20260823001407" ? "NOT_PRESENT" : "EXACT_OPERATION_ALREADY_PRESENT",
      confidence: "HIGH", artifactRole: migrationId === "20260823001407"
        ? "LOCAL_ONLY_NEW_TARGETED_ARTIFACT" : null,
      expectedOperationDigest: null, observedOperationDigest: null,
      evidenceSource: "FIXED_READONLY_TEST", findingCodes: [], limitationCodes: [] })),
    remoteOnlyResults: SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1.map((migrationId) => ({ migrationId,
      migrationName: `migration_${migrationId}`,
      classification: "REMOTE_OPERATION_CURRENTLY_PRESENT", confidence: "HIGH",
      historicalArtifactDigest: null, appliedArtifactDigest: null,
      evidenceSource: "FIXED_READONLY_TEST", findingCodes: [], limitationCodes: [] })),
    decision: { classification: "SAFE_TO_APPLY_TARGETED_OP_LAUNCH_RADAR_HOTFIX",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false },
    schemaDrift: { conclusion: "SCHEMA_DRIFT_PROVEN_NONE", method: "FIXED_READONLY_TEST",
      checkedAt: "2026-08-20T13:00:00.000Z" },
    limitations: [], ...overrides }
}

test("complete exact target coverage is available only for the exact workspace", () => {
  const observed = parseSellerOsTargetedMigrationAttestationV1(artifact(), CURRENT)
  assert.equal(observed.status, "AVAILABLE")
  assert.equal(observed.evidenceCompleteness, "COMPLETE")
  assert.deepEqual(observed.localOnlyCoverage, { expectedCount: 15, evaluatedCount: 15,
    complete: true })
  assert.deepEqual(observed.remoteOnlyCoverage, { expectedCount: 17, evaluatedCount: 17,
    complete: true })
  assert.deepEqual(observed.ledgerSnapshot, artifact().ledgerSnapshot)
})

test("post-apply target receipt is exact and cannot authorize another mutation", () => {
  const input = artifact({
    ledgerSnapshot: { localCount: 256, appliedCount: 259, pendingLocalCount: 14,
      remoteOnlyCount: 17, localLedgerDigest: `sha256:${"c".repeat(64)}`,
      appliedLedgerDigest: `sha256:${"e".repeat(64)}` },
    decision: { classification: "TARGETED_OP_LAUNCH_RADAR_HOTFIX_APPLIED",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false },
  })
  const target = input.localOnlyResults.at(-1)
  target.classification = "EXACT_OPERATION_ALREADY_PRESENT"
  target.expectedOperationDigest = `sha256:${"f".repeat(64)}`
  target.observedOperationDigest = target.expectedOperationDigest
  const observed = parseSellerOsTargetedMigrationAttestationV1(input, CURRENT)
  assert.equal(observed.status, "AVAILABLE")
  assert.equal(observed.evidenceCompleteness, "COMPLETE")
  assert.equal(observed.ledgerSnapshot.appliedCount, 259)
  assert.equal(observed.ledgerSnapshot.pendingLocalCount, 14)
  assert.equal(observed.decision.classification, "TARGETED_OP_LAUNCH_RADAR_HOTFIX_APPLIED")
  assert.equal(observed.decision.databaseMutationAuthorized, false)
})

test("I02W post-apply receipt requires both exact applied targets and ledger 261", () => {
  const input = artifact({
    ledgerSnapshot: { localCount: 258, appliedCount: 261, pendingLocalCount: 14,
      remoteOnlyCount: 17, localLedgerDigest: `sha256:${"c".repeat(64)}`,
      appliedLedgerDigest: `sha256:${"e".repeat(64)}` },
    targetResults: [
      { migrationId: "20260823023000",
        migrationName: "create_seller_os_daily_dollar_radar_autopilot",
        ledgerStatus: "APPLIED", artifactDigest: `sha256:${"1".repeat(64)}`,
        evidenceSource: "SUPABASE_MANAGEMENT_API_READ_ONLY",
        findingCodes: ["TARGET_MIGRATION_LEDGER_RECEIPT_PRESENT"], limitationCodes: [] },
      { migrationId: "20260823034507",
        migrationName: "create_seller_os_profitability_frontier_and_schedule_policy",
        ledgerStatus: "APPLIED", artifactDigest: `sha256:${"2".repeat(64)}`,
        evidenceSource: "SUPABASE_MANAGEMENT_API_READ_ONLY",
        findingCodes: ["TARGET_MIGRATION_LEDGER_RECEIPT_PRESENT"], limitationCodes: [] },
    ],
    decision: { classification: "TARGETED_OP_LAUNCH_I02W_STORAGE_APPLIED",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false },
  })
  const historicalTarget = input.localOnlyResults.at(-1)
  historicalTarget.classification = "EXACT_OPERATION_ALREADY_PRESENT"
  historicalTarget.expectedOperationDigest = `sha256:${"f".repeat(64)}`
  historicalTarget.observedOperationDigest = historicalTarget.expectedOperationDigest
  const observed = parseSellerOsTargetedMigrationAttestationV1(input, CURRENT)
  assert.equal(observed.status, "AVAILABLE")
  assert.equal(observed.evidenceCompleteness, "COMPLETE")
  assert.equal(observed.subject.workspaceMatch, true)
  assert.equal(observed.ledgerSnapshot.appliedCount, 261)
  assert.deepEqual(observed.targetResults.map((entry) =>
    [entry.migrationId, entry.ledgerStatus]), [
    ["20260823023000", "APPLIED"], ["20260823034507", "APPLIED"],
  ])
})

test("target role and decision must describe the same pending or applied state", () => {
  const wrongDecision = artifact({ decision: {
    classification: "SAFE_TO_APPLY_TARGETED_P2_DELTA",
    databaseMutationAuthorized: false, repositoryMutationAuthorized: false,
  } })
  assert.equal(parseSellerOsTargetedMigrationAttestationV1(
    wrongDecision, CURRENT).status, "UNAVAILABLE")
  const wrongRole = artifact()
  wrongRole.localOnlyResults.at(-2).artifactRole = "LOCAL_ONLY_NEW_TARGETED_ARTIFACT"
  assert.equal(parseSellerOsTargetedMigrationAttestationV1(
    wrongRole, CURRENT).status, "UNAVAILABLE")
})

test("partial, duplicate, and unknown target evidence does not become complete", () => {
  const partial = parseSellerOsTargetedMigrationAttestationV1(artifact({ localOnlyResults: [] }), CURRENT)
  assert.equal(partial.status, "PARTIAL")
  assert.equal(partial.localOnlyCoverage.complete, false)
  const duplicate = artifact()
  duplicate.localOnlyResults[1].migrationId = duplicate.localOnlyResults[0].migrationId
  assert.equal(parseSellerOsTargetedMigrationAttestationV1(duplicate, CURRENT).status, "UNAVAILABLE")
  const unknown = artifact()
  unknown.remoteOnlyResults[0].migrationId = "20269999999999"
  assert.equal(parseSellerOsTargetedMigrationAttestationV1(unknown, CURRENT).status, "UNAVAILABLE")
})

test("head or dirty-workspace fingerprint mismatch is stale, not current", () => {
  const headChanged = parseSellerOsTargetedMigrationAttestationV1(artifact(), {
    ...CURRENT, headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
  assert.equal(headChanged.status, "STALE")
  const workspaceChanged = parseSellerOsTargetedMigrationAttestationV1(artifact(), {
    ...CURRENT, fingerprint: `sha256:${"b".repeat(64)}` })
  assert.equal(workspaceChanged.status, "STALE")
  assert.equal(workspaceChanged.subject.workspaceMatch, false)
})

test("artifact preserves uncertainty, bounded decision enums, and no execution authorization", () => {
  const input = artifact()
  input.localOnlyResults[0].classification = "NOT_PRESENT"
  input.localOnlyResults[0].limitationCodes = ["READ_ONLY_EVIDENCE"]
  const observed = parseSellerOsTargetedMigrationAttestationV1(input, CURRENT)
  assert.equal(observed.status, "AVAILABLE")
  assert.equal(observed.evidenceCompleteness, "PARTIAL")
  assert.equal(observed.decision.databaseMutationAuthorized, false)
  assert.equal(observed.decision.repositoryMutationAuthorized, false)
  assert.doesNotMatch(JSON.stringify(observed), /select\s|\/home\/|password|token|create\s|alter\s/i)
})

test("malformed unsafe artifact cannot expose arbitrary payloads", () => {
  const unsafe = artifact({ limitations: ["bad limitation with spaces"] })
  const observed = parseSellerOsTargetedMigrationAttestationV1(unsafe, CURRENT)
  assert.equal(observed.status, "UNAVAILABLE")
  assert.doesNotMatch(JSON.stringify(observed), /bad limitation/)
})
