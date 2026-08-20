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
    localOnlyResults: SELLER_OS_TARGETED_LOCAL_ONLY_IDS_V1.map((migrationId) => ({ migrationId,
      classification: "OPERATION_PRESENT_EQUIVALENT", confidence: "HIGH",
      expectedOperationDigest: null, observedOperationDigest: null,
      evidenceSource: "FIXED_READONLY_TEST", limitationCodes: [] })),
    remoteOnlyResults: SELLER_OS_TARGETED_REMOTE_ONLY_IDS_V1.map((migrationId) => ({ migrationId,
      classification: "EXACT_APPLIED_OPERATION_PROVEN", confidence: "HIGH",
      historicalArtifactDigest: null, appliedArtifactDigest: null,
      evidenceSource: "FIXED_READONLY_TEST", limitationCodes: [] })),
    decision: { classification: "INSUFFICIENT_EVIDENCE", databaseMutationAuthorized: false,
      repositoryMutationAuthorized: false }, schemaDrift: { status: "UNPROVEN" },
    limitations: [], ...overrides }
}

test("complete exact target coverage is available only for the exact workspace", () => {
  const observed = parseSellerOsTargetedMigrationAttestationV1(artifact(), CURRENT)
  assert.equal(observed.status, "AVAILABLE")
  assert.equal(observed.evidenceCompleteness, "COMPLETE")
  assert.deepEqual(observed.localOnlyCoverage, { expectedCount: 14, evaluatedCount: 14,
    complete: true })
  assert.deepEqual(observed.remoteOnlyCoverage, { expectedCount: 5, evaluatedCount: 5,
    complete: true })
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
  input.localOnlyResults[0].classification = "OPERATION_ABSENT"
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
