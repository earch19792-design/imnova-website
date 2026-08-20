import assert from "node:assert/strict"
import test from "node:test"

import { recordSellerOsTargetedMigrationAttestationV1 } from
  "./ebay-seller-os-targeted-migration-attestation-recorder.mjs"

const subject = (fingerprint = `sha256:${"a".repeat(64)}`) => ({
  status: "AVAILABLE", headSha: "18cedb53d9d8e396302132a779a2a93a30044e23",
  workingTreeStatus: "DIRTY", fingerprint,
})

test("fixed recorder publishes exact bounded RCA-03 coverage without execution authorization", async () => {
  let payload = null
  const result = await recordSellerOsTargetedMigrationAttestationV1({
    now: () => new Date("2026-08-20T15:00:00.000Z"),
    readSubject: async () => subject(),
    publish: async (value) => { payload = value },
  })
  assert.equal(result.localOnlyCount, 14)
  assert.equal(result.remoteOnlyCount, 5)
  assert.equal(payload.artifactVersion, "SELLER_OS_TARGETED_MIGRATION_ATTESTATION_V1")
  assert.equal(payload.localOnlyResults.length, 14)
  assert.equal(payload.remoteOnlyResults.length, 5)
  assert.equal(payload.decision.databaseMutationAuthorized, false)
  assert.equal(payload.decision.repositoryMutationAuthorized, false)
  assert.equal(payload.schemaDrift.status, "UNPROVEN")
  assert.doesNotMatch(JSON.stringify(payload), /select\s|insert\s|update\s|delete\s|\/home\/|password|token/i)
})

test("fixed recorder refuses to publish when the exact workspace changes", async () => {
  let calls = 0
  await assert.rejects(recordSellerOsTargetedMigrationAttestationV1({
    readSubject: async () => subject(calls++ ? `sha256:${"b".repeat(64)}` : undefined),
    publish: async () => assert.fail("must not publish unstable evidence"),
  }), /TARGETED_ATTESTATION_WORKSPACE_CHANGED/)
})
