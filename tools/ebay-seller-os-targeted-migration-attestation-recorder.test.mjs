import assert from "node:assert/strict"
import test from "node:test"

import { recordSellerOsTargetedMigrationAttestationV1 } from
  "./ebay-seller-os-targeted-migration-attestation-recorder.mjs"

const subject = (fingerprint = `sha256:${"a".repeat(64)}`) => ({
  status: "AVAILABLE", headSha: "18cedb53d9d8e396302132a779a2a93a30044e23",
  workingTreeStatus: "DIRTY", fingerprint,
})
const evidence = () => ({
  ledgerSnapshot: { localCount: 258, appliedCount: 261, pendingLocalCount: 14,
    remoteOnlyCount: 17, localLedgerDigest: `sha256:${"c".repeat(64)}`,
    appliedLedgerDigest: `sha256:${"d".repeat(64)}` },
  targetResults: [
    { migrationId: "20260823023000",
      migrationName: "create_seller_os_daily_dollar_radar_autopilot",
      ledgerStatus: "APPLIED", artifactDigest:
        "sha256:5956e9209c98da3b3b2255500f6f5f31c34eeb95a1579147a08777d89845b6ff",
      evidenceSource: "SUPABASE_MANAGEMENT_API_READ_ONLY",
      findingCodes: ["TARGET_MIGRATION_LEDGER_RECEIPT_PRESENT"], limitationCodes: [] },
    { migrationId: "20260823034507",
      migrationName: "create_seller_os_profitability_frontier_and_schedule_policy",
      ledgerStatus: "APPLIED", artifactDigest:
        "sha256:8e69b0e1b65cabd34e082ae7d81b5388e72337e12504539aeca3fa16b2183747",
      evidenceSource: "SUPABASE_MANAGEMENT_API_READ_ONLY",
      findingCodes: ["TARGET_MIGRATION_LEDGER_RECEIPT_PRESENT"], limitationCodes: [] },
  ],
})

test("fixed recorder publishes exact bounded OP-LAUNCH Radar post-apply coverage", async () => {
  let payload = null
  const result = await recordSellerOsTargetedMigrationAttestationV1({
    now: () => new Date("2026-08-20T15:00:00.000Z"),
    readSubject: async () => subject(),
    readEvidence: async () => evidence(),
    publish: async (value) => { payload = value },
  })
  assert.equal(result.localOnlyCount, 15)
  assert.equal(result.remoteOnlyCount, 17)
  assert.equal(result.targetCount, 2)
  assert.equal(result.appliedCount, 261)
  assert.equal(payload.artifactVersion, "SELLER_OS_TARGETED_MIGRATION_ATTESTATION_V1")
  assert.equal(payload.localOnlyResults.length, 15)
  assert.equal(payload.remoteOnlyResults.length, 17)
  assert.deepEqual(payload.ledgerSnapshot, {
    localCount: 258, appliedCount: 261, pendingLocalCount: 14, remoteOnlyCount: 17,
    localLedgerDigest: `sha256:${"c".repeat(64)}`,
    appliedLedgerDigest: `sha256:${"d".repeat(64)}`,
  })
  assert.equal(payload.decision.classification, "TARGETED_OP_LAUNCH_I02W_STORAGE_APPLIED")
  assert.equal(payload.decision.databaseMutationAuthorized, false)
  assert.equal(payload.decision.repositoryMutationAuthorized, false)
  assert.equal(payload.schemaDrift.conclusion, "SCHEMA_DRIFT_PRESENT")
  assert.equal(payload.localOnlyResults.at(-1).artifactRole,
    "LOCAL_ONLY_NEW_TARGETED_ARTIFACT")
  assert.equal(payload.localOnlyResults.at(-1).classification,
    "EXACT_OPERATION_ALREADY_PRESENT")
  assert.equal(payload.localOnlyResults.at(-1).expectedOperationDigest,
    `sha256:b2ea4dafef462d86d068f35baa505f2064b07dcf113e6fe542e7af76b637d387`)
  assert.equal(payload.localOnlyResults.at(-1).observedOperationDigest,
    `sha256:b2ea4dafef462d86d068f35baa505f2064b07dcf113e6fe542e7af76b637d387`)
  assert.deepEqual(payload.targetResults.map((entry) =>
    [entry.migrationId, entry.ledgerStatus]), [
    ["20260823023000", "APPLIED"], ["20260823034507", "APPLIED"],
  ])
  assert.equal(payload.localOnlyResults.some((entry) =>
    entry.migrationId === "20260821193830"), false)
  assert.equal(payload.localOnlyResults[0].evidenceSource, "SUPABASE_MCP_READ_ONLY")
  assert.equal(payload.remoteOnlyResults[0].classification,
    "HISTORICAL_REMOTE_OPERATION_PROVEN")
  assert.equal(payload.remoteOnlyResults[2].classification,
    "REMOTE_OPERATION_CURRENTLY_PRESENT")
  assert.equal(payload.remoteOnlyResults[15].classification,
    "REMOTE_OPERATION_SUPERSEDED")
  assert.doesNotMatch(JSON.stringify(payload), /select\s|insert\s|update\s|delete\s|\/home\/|password|token/i)
})

test("fixed recorder refuses to publish when the exact workspace changes", async () => {
  let calls = 0
  await assert.rejects(recordSellerOsTargetedMigrationAttestationV1({
    readSubject: async () => subject(calls++ ? `sha256:${"b".repeat(64)}` : undefined),
    readEvidence: async () => evidence(),
    publish: async () => assert.fail("must not publish unstable evidence"),
  }), /TARGETED_ATTESTATION_WORKSPACE_CHANGED/)
})
