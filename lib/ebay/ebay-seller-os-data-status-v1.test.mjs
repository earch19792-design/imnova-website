import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const previousTypeScriptLoader = require.extensions[".ts"]
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ES2022 },
  })
  module._compile(output.outputText, filename)
}

const {
  SELLER_OS_DATA_STATUS_CONTRACT_VERSION,
  SELLER_OS_DATA_STATUS_SCOPE_V1,
  SELLER_OS_DATA_STATUS_TOOL_V1,
  SellerOsDataStatusReadErrorV1,
  collectSellerOsDataStatusV1,
  createUnavailableSellerOsDataStatusV1,
} = require("./ebay-seller-os-data-status-v1.ts")
if (previousTypeScriptLoader) require.extensions[".ts"] = previousTypeScriptLoader
else delete require.extensions[".ts"]
import {
  SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
} from "./ebay-seller-os-workspace-fingerprint-v1.mjs"

const NOW = new Date("2026-08-20T13:00:00.000Z")
const HEAD = "18cedb53d9d8e396302132a779a2a93a30044e23"
const FINGERPRINT = `sha256:${"a".repeat(64)}`

const TARGETED_LOCAL_IDS = [
  "20260717160000", "20260719150000", "20260719214500", "20260719220000",
  "20260723012000", "20260723013000", "20260724008000", "20260725001000",
  "20260725002000", "20260725003000", "20260725004000", "20260725004500",
  "20260725004600", "20260725005000", "20260823001407",
]
const TARGETED_REMOTE_IDS = [
  "20260725013000", "20260725013100", "20260726070000", "20260726071000",
  "20260726072000", "20260726073000", "20260726130000", "20260726131000",
  "20260726132000", "20260726133000", "20260726134000", "20260726135000",
  "20260726140000", "20260726141000", "20260726142000", "20260726144000",
  "20260726145000",
]
function targetedArtifact(overrides = {}) {
  return JSON.stringify({ artifactVersion: "SELLER_OS_TARGETED_MIGRATION_ATTESTATION_V1",
    observedAt: NOW.toISOString(), subject: { headSha: HEAD, workingTreeStatus: "DIRTY",
      workspaceFingerprint: FINGERPRINT },
    ledgerSnapshot: { localCount: 256, appliedCount: 258, pendingLocalCount: 15,
      remoteOnlyCount: 17, localLedgerDigest: `sha256:${"c".repeat(64)}`,
      appliedLedgerDigest: `sha256:${"d".repeat(64)}` },
    localOnlyResults: TARGETED_LOCAL_IDS.map((migrationId) => ({ migrationId,
      migrationName: `migration_${migrationId}`,
      classification: migrationId === "20260823001407" ? "NOT_PRESENT" : "EXACT_OPERATION_ALREADY_PRESENT",
      confidence: "HIGH", artifactRole: migrationId === "20260823001407"
        ? "LOCAL_ONLY_NEW_TARGETED_ARTIFACT" : null,
      expectedOperationDigest: null, observedOperationDigest: null,
      evidenceSource: "FIXED_READONLY_TEST", findingCodes: [], limitationCodes: [] })),
    remoteOnlyResults: TARGETED_REMOTE_IDS.map((migrationId) => ({ migrationId,
      migrationName: `migration_${migrationId}`,
      classification: "REMOTE_OPERATION_CURRENTLY_PRESENT", confidence: "HIGH",
      historicalArtifactDigest: null, appliedArtifactDigest: null,
      evidenceSource: "FIXED_READONLY_TEST", findingCodes: [], limitationCodes: [] })),
    decision: { classification: "SAFE_TO_APPLY_TARGETED_OP_LAUNCH_RADAR_HOTFIX",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false },
    schemaDrift: { conclusion: "SCHEMA_DRIFT_REMAINS_UNPROVEN",
      method: "FIXED_READONLY_TEST", checkedAt: NOW.toISOString() },
    limitations: [], ...overrides })
}

function subject(overrides = {}) {
  return { status: "AVAILABLE", headSha: HEAD, workingTreeStatus: "DIRTY",
    fingerprint: FINGERPRINT,
    fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
    limitations: [], ...overrides }
}

function adapter(overrides = {}) {
  return {
    readCurrentSubject: async () => subject(),
    readLocalMigrationFiles: async () => [
      "20260801000100_first.sql", "20260801000200_second.sql",
    ],
    readAppliedMigrationLedger: async () => ({
      ids: ["20260801000100", "20260801000200"], count: 2, complete: true,
    }),
    readSchemaDrift: async () => ({ status: "UNPROVEN", method: null,
      checkedAt: null }),
    readTargetedAttestationArtifact: async () => targetedArtifact(),
    ...overrides,
  }
}

function collect(overrides = {}) {
  return collectSellerOsDataStatusV1({ adapter: adapter(overrides), now: () => NOW })
}

test("matching local and authoritative applied migrations reconcile without inventing drift", async () => {
  const observed = await collect()
  assert.equal(observed.contractVersion, SELLER_OS_DATA_STATUS_CONTRACT_VERSION)
  assert.deepEqual(observed.currentSubject, { headSha: HEAD,
    workingTreeStatus: "DIRTY", workspaceFingerprint: FINGERPRINT,
    fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION })
  assert.equal(observed.dataLayer.connectivity, "AVAILABLE")
  assert.equal(observed.migrations.local.count, 2)
  assert.deepEqual(observed.migrations.local.entries, [
    { id: "20260801000100", name: "first" },
    { id: "20260801000200", name: "second" },
  ])
  assert.equal(observed.migrations.applied.count, 2)
  assert.equal(observed.migrations.pending.status, "NONE")
  assert.equal(observed.migrations.pending.count, 0)
  assert.equal(observed.migrations.remoteOnly.status, "NONE")
  assert.equal(observed.schemaDrift.status, "UNPROVEN")
  assert.equal(observed.overallStatus, "HEALTHY")
  assert.equal(observed.evidenceCompleteness, "PARTIAL")
})

test("a positively observed empty local and applied migration set preserves zero", async () => {
  const observed = await collect({ readLocalMigrationFiles: async () => [],
    readAppliedMigrationLedger: async () => ({ ids: [], count: 0, complete: true }) })
  assert.equal(observed.migrations.local.count, 0)
  assert.equal(observed.migrations.applied.count, 0)
  assert.equal(observed.migrations.pending.count, 0)
  assert.equal(observed.migrations.remoteOnly.count, 0)
  assert.equal(observed.migrations.local.latestId, null)
})

test("one pending local migration is explicit and blocks", async () => {
  const observed = await collect({ readAppliedMigrationLedger: async () => ({
    ids: ["20260801000100"], count: 1, complete: true,
  }) })
  assert.deepEqual(observed.migrations.pending, { status: "PRESENT", count: 1,
    ids: ["20260801000200"], entriesTruncated: false })
  assert.equal(observed.overallStatus, "BLOCKED")
})

test("one remote-only migration is explicit and blocks", async () => {
  const observed = await collect({ readAppliedMigrationLedger: async () => ({
    ids: ["20260801000100", "20260801000200", "20260801000300"],
    count: 3, complete: true,
  }) })
  assert.deepEqual(observed.migrations.remoteOnly, { status: "PRESENT", count: 1,
    ids: ["20260801000300"], entriesTruncated: false })
  assert.equal(observed.overallStatus, "BLOCKED")
})

test("pending and remote-only differences remain independently visible", async () => {
  const observed = await collect({ readAppliedMigrationLedger: async () => ({
    ids: ["20260801000100", "20260801000300"], count: 2, complete: true,
  }) })
  assert.deepEqual(observed.migrations.pending.ids, ["20260801000200"])
  assert.deepEqual(observed.migrations.remoteOnly.ids, ["20260801000300"])
  assert.equal(observed.migrations.pending.status, "PRESENT")
  assert.equal(observed.migrations.remoteOnly.status, "PRESENT")
})

test("missing local source never becomes zero migrations or no pending migrations", async () => {
  const observed = await collect({ readLocalMigrationFiles: async () => {
    throw new Error("permission denied /secret/path")
  } })
  assert.equal(observed.migrations.local.status, "UNAVAILABLE")
  assert.equal(observed.migrations.local.count, null)
  assert.equal(observed.migrations.pending.status, "UNAVAILABLE")
  assert.equal(observed.migrations.pending.count, null)
  assert.doesNotMatch(JSON.stringify(observed), /permission denied|secret\/path/)
})

test("missing ledger never becomes zero applied or no pending migrations", async () => {
  const observed = await collect({ readAppliedMigrationLedger: async () => {
    throw new Error("ledger denied with credential")
  } })
  assert.equal(observed.migrations.applied.status, "UNAVAILABLE")
  assert.equal(observed.migrations.applied.count, null)
  assert.equal(observed.migrations.pending.status, "UNAVAILABLE")
  assert.equal(observed.dataLayer.status, "UNAVAILABLE")
  assert.equal(observed.dataLayer.connectivity, "UNAVAILABLE")
  assert.doesNotMatch(JSON.stringify(observed), /ledger denied with credential/)
})

for (const [classification, limitation] of [
  ["CONFIGURATION_NOT_AVAILABLE",
    "APPLIED_MIGRATION_CONFIGURATION_NOT_AVAILABLE"],
  ["AUTHENTICATION_NOT_AVAILABLE",
    "APPLIED_MIGRATION_AUTHENTICATION_NOT_AVAILABLE"],
  ["AUTHORITATIVE_LEDGER_PERMISSION_DENIED",
    "APPLIED_MIGRATION_AUTHORITATIVE_LEDGER_PERMISSION_DENIED"],
  ["MIGRATION_LEDGER_NOT_FOUND",
    "APPLIED_MIGRATION_MIGRATION_LEDGER_NOT_FOUND"],
] ) {
  test(`${classification} keeps authoritative connectivity unavailable`, async () => {
    const observed = await collect({ readAppliedMigrationLedger: async () => {
      throw new SellerOsDataStatusReadErrorV1(classification)
    } })
    assert.equal(observed.dataLayer.connectivity, "UNAVAILABLE")
    assert.equal(observed.dataLayer.status, "UNAVAILABLE")
    assert.equal(observed.overallStatus, "UNAVAILABLE")
    assert.equal(observed.migrations.local.count, 2)
    assert.equal(observed.migrations.applied.count, null)
    assert.ok(observed.limitations.includes(limitation))
  })
}

test("malformed and duplicate migration evidence fails closed", async () => {
  const local = await collect({ readLocalMigrationFiles: async () => [
    "20260801000100_first.sql", "20260801000100_duplicate.sql", "bad.sql",
  ] })
  assert.equal(local.migrations.local.status, "UNAVAILABLE")
  assert.equal(local.migrations.local.count, null)
  assert.equal(local.migrations.pending.status, "UNAVAILABLE")

  const applied = await collect({ readAppliedMigrationLedger: async () => ({
    ids: ["20260801000100", "20260801000100", "bad"], count: 3, complete: true,
  }) })
  assert.equal(applied.migrations.applied.status, "UNAVAILABLE")
  assert.equal(applied.migrations.pending.status, "UNAVAILABLE")
})

test("migration entries and reconciliation IDs are bounded with exact counts", async () => {
  const files = Array.from({ length: 105 }, (_, index) =>
    `202608${String(index).padStart(8, "0")}_migration_${index}.sql`)
  const ids = files.map((file) => file.slice(0, 14))
  const observed = await collect({ readLocalMigrationFiles: async () => files,
    readAppliedMigrationLedger: async () => ({ ids: [], count: 0, complete: true }) })
  assert.equal(observed.migrations.local.count, 105)
  assert.equal(observed.migrations.local.entries.length, 100)
  assert.equal(observed.migrations.local.entriesTruncated, true)
  assert.equal(observed.migrations.pending.count, 105)
  assert.equal(observed.migrations.pending.ids.length, 100)
  assert.equal(observed.migrations.pending.entriesTruncated, true)
  assert.deepEqual(observed.migrations.pending.ids, ids.slice(0, 100).sort())
})

test("full internal sets prove a match despite bounded external migration entries", async () => {
  const files = Array.from({ length: 105 }, (_, index) =>
    `202608${String(index).padStart(8, "0")}_migration_${index}.sql`)
  const ids = files.map((file) => file.slice(0, 14))
  const observed = await collect({ readLocalMigrationFiles: async () => files,
    readAppliedMigrationLedger: async () => ({ ids, count: ids.length, complete: true }) })
  assert.equal(observed.migrations.local.entriesTruncated, true)
  assert.equal(observed.migrations.applied.entriesTruncated, true)
  assert.equal(observed.migrations.pending.status, "NONE")
  assert.equal(observed.migrations.pending.count, 0)
  assert.equal(observed.migrations.remoteOnly.status, "NONE")
  assert.equal(observed.migrations.remoteOnly.count, 0)
})

test("unknown applied count stays null and cannot prove connectivity or reconciliation", async () => {
  const observed = await collect({ readAppliedMigrationLedger: async () => ({
    ids: ["20260801000100", "20260801000200"], count: null, complete: true,
  }) })
  assert.equal(observed.migrations.applied.count, null)
  assert.equal(observed.migrations.applied.status, "UNAVAILABLE")
  assert.equal(observed.dataLayer.connectivity, "UNAVAILABLE")
  assert.equal(observed.migrations.pending.count, null)
})

test("incomplete ledger keeps exact observed count but forbids reconciliation", async () => {
  const observed = await collect({ readAppliedMigrationLedger: async () => ({
    ids: ["20260801000100"], count: 2, complete: false,
  }) })
  assert.equal(observed.migrations.applied.status, "UNAVAILABLE")
  assert.equal(observed.migrations.applied.count, 2)
  assert.equal(observed.dataLayer.connectivity, "UNAVAILABLE")
  assert.equal(observed.migrations.pending.count, null)
  assert.ok(observed.limitations.includes("APPLIED_MIGRATION_LEDGER_INCOMPLETE"))
})

test("authoritative matched and drift-detected evidence preserve provenance", async () => {
  const matched = await collect({ readSchemaDrift: async () => ({ status: "MATCHED",
    method: "AUTHORITATIVE_SCHEMA_CHECKSUM_V1", checkedAt: NOW.toISOString() }) })
  assert.deepEqual(matched.schemaDrift, { status: "MATCHED",
    conclusion: "SCHEMA_DRIFT_PROVEN_NONE",
    method: "AUTHORITATIVE_SCHEMA_CHECKSUM_V1", checkedAt: NOW.toISOString() })
  assert.equal(matched.evidenceCompleteness, "COMPLETE")
  const drifted = await collect({ readSchemaDrift: async () => ({
    status: "DRIFT_DETECTED", method: "AUTHORITATIVE_SCHEMA_CHECKSUM_V1",
    checkedAt: NOW.toISOString() }) })
  assert.equal(drifted.overallStatus, "BLOCKED")
})

test("unsupported or malformed drift proof never becomes MATCHED", async () => {
  const unsupported = await collect()
  assert.equal(unsupported.schemaDrift.status, "UNPROVEN")
  const malformed = await collect({ readSchemaDrift: async () => ({ status: "MATCHED",
    method: "unsafe method with spaces", checkedAt: "not-a-time" }) })
  assert.equal(malformed.schemaDrift.status, "UNAVAILABLE")
  assert.ok(malformed.limitations.includes("SCHEMA_DRIFT_EVIDENCE_MALFORMED"))
})

test("workspace changes during collection invalidate subject binding", async () => {
  let call = 0
  const observed = await collect({ readCurrentSubject: async () => {
    call += 1
    return subject({ fingerprint: call === 1 ? FINGERPRINT : `sha256:${"b".repeat(64)}` })
  } })
  assert.equal(observed.currentSubject.headSha, null)
  assert.equal(observed.currentSubject.workspaceFingerprint, null)
  assert.equal(observed.overallStatus, "DEGRADED")
  assert.ok(observed.limitations.includes(
    "WORKSPACE_CHANGED_OR_UNAVAILABLE_DURING_DATA_STATUS_COLLECTION"))
})

test("collector failure response is bounded, versioned, and unknown numeric values are null", () => {
  const observed = createUnavailableSellerOsDataStatusV1(NOW.toISOString())
  assert.equal(observed.contractVersion, SELLER_OS_DATA_STATUS_CONTRACT_VERSION)
  assert.equal(observed.migrations.local.count, null)
  assert.equal(observed.migrations.applied.count, null)
  assert.equal(observed.overallStatus, "UNAVAILABLE")
})

test("targeted attestation is workspace-bound without rewriting migration-ledger truth", async () => {
  const observed = await collect({ readAppliedMigrationLedger: async () => ({
    ids: ["20260801000100"], count: 1, complete: true,
  }) })
  assert.equal(observed.targetedAttestation.contractVersion,
    "SELLER_OS_TARGETED_MIGRATION_ATTESTATION_V1")
  assert.equal(observed.targetedAttestation.status, "AVAILABLE")
  assert.deepEqual(observed.targetedAttestation.localOnlyCoverage,
    { expectedCount: 15, evaluatedCount: 15, complete: true })
  assert.deepEqual(observed.targetedAttestation.remoteOnlyCoverage,
    { expectedCount: 17, evaluatedCount: 17, complete: true })
  assert.equal(observed.targetedAttestation.decision.databaseMutationAuthorized, false)
  assert.equal(observed.targetedAttestation.decision.repositoryMutationAuthorized, false)
  assert.equal(observed.migrations.pending.status, "PRESENT")
})

test("fresh RCA-04 attestation supplies the bounded authoritative drift conclusion", async () => {
  const observed = await collect({ readTargetedAttestationArtifact: async () =>
    targetedArtifact({ schemaDrift: { conclusion: "SCHEMA_DRIFT_PRESENT",
      method: "RCA04_FIXED_READONLY_LEDGER_CATALOG_RECONCILIATION",
      checkedAt: NOW.toISOString() } }) })
  assert.deepEqual(observed.schemaDrift, { status: "DRIFT_DETECTED",
    conclusion: "SCHEMA_DRIFT_PRESENT",
    method: "RCA04_FIXED_READONLY_LEDGER_CATALOG_RECONCILIATION",
    checkedAt: NOW.toISOString() })
  assert.equal(observed.overallStatus, "BLOCKED")
  assert.equal(observed.targetedAttestation.decision.classification,
    "SAFE_TO_APPLY_TARGETED_OP_LAUNCH_RADAR_HOTFIX")
  assert.equal(observed.targetedAttestation.decision.databaseMutationAuthorized, false)
})

test("missing, malformed, stale, and partial targeted artifacts fail closed", async () => {
  const missing = await collect({ readTargetedAttestationArtifact: async () => {
    throw new Error("not found")
  } })
  assert.equal(missing.targetedAttestation.status, "UNAVAILABLE")
  const malformed = await collect({ readTargetedAttestationArtifact: async () => "{}" })
  assert.equal(malformed.targetedAttestation.status, "UNAVAILABLE")
  const partial = await collect({ readTargetedAttestationArtifact: async () => targetedArtifact({
    localOnlyResults: [],
  }) })
  assert.equal(partial.targetedAttestation.status, "PARTIAL")
  const stale = await collect({ readTargetedAttestationArtifact: async () => targetedArtifact({
    subject: { headSha: HEAD, workingTreeStatus: "DIRTY",
      workspaceFingerprint: `sha256:${"b".repeat(64)}` },
  }) })
  assert.equal(stale.targetedAttestation.status, "STALE")
  assert.equal(stale.targetedAttestation.subject.workspaceMatch, false)
})

test("fixed collector boundary has no arbitrary SQL, caller scope, writes, or unsafe payloads", () => {
  const source = readFileSync(new URL("./ebay-seller-os-data-status-v1.ts", import.meta.url),
    "utf8")
  assert.deepEqual(SELLER_OS_DATA_STATUS_SCOPE_V1, {
    repositoryId: "SELLER_OS_CANONICAL_REPOSITORY",
    migrationDirectory: "supabase/migrations",
    provider: "SUPABASE",
    appliedMigrationLedger: "supabase_migrations.schema_migrations",
    appliedMigrationReadMethod: "SUPABASE_MANAGEMENT_API_FIXED_READONLY_QUERY",
  })
  assert.equal(SELLER_OS_DATA_STATUS_TOOL_V1.annotations.readOnlyHint, true)
  assert.equal(SELLER_OS_DATA_STATUS_TOOL_V1.annotations.destructiveHint, false)
  assert.doesNotMatch(source, /execFile|spawn\(|shell\s*:|callerControlledSqlAllowed:\s*true/)
  assert.doesNotMatch(source, /\.(?:insert|update|upsert|delete|rpc)\s*\(/)
  assert.doesNotMatch(source, /migration(?:Apply|Rollback)Allowed:\s*true/)
  assert.doesNotMatch(source, /process\.env|connectionString|remoteUrl/)
})

test("external contract includes no SQL bodies, row data, paths, credentials, or environment values", async () => {
  const observed = await collect()
  const serialized = JSON.stringify(observed)
  assert.doesNotMatch(serialized, /select\s|\.sql|\/home\/|SUPABASE_SERVICE_ROLE|password|token/i)
  assert.deepEqual(observed.safety, {
    readOnly: true, arbitrarySqlAllowed: false, callerControlledSqlAllowed: false,
    callerControlledTableAllowed: false, schemaMutationAllowed: false,
    migrationApplyAllowed: false, migrationRollbackAllowed: false,
    databaseWritesAllowed: false, credentialsIncluded: false,
    environmentValuesIncluded: false, rowDataIncluded: false,
    marketplaceWrites: 0, inventoryWrites: 0, productCaseMutations: 0,
    lunaLinkMutations: 0, whatsappSends: 0,
  })
})
