import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const runtime = readFileSync(new URL(
  "./ebay-mayel-visual-delegated-runtime-v1.ts", import.meta.url), "utf8")
const orchestrator = readFileSync(new URL(
  "../seller-os/operational-integrity-runtime-v1.ts", import.meta.url), "utf8")
const rebase = readFileSync(new URL(
  "./ebay-mayel-visual-safe-rebase-runtime-v1.ts", import.meta.url), "utf8")

test("normal operational runtime owns delegated visual execution", () => {
  assert.match(orchestrator, /runMayelVisualDelegatedRuntimeV1/)
  assert.match(runtime, /MAX_LISTING_WRITES_PER_RUN = 1/)
  assert.match(runtime, /executeMayelTradingVisualDelegatedManifestV1/)
  assert.doesNotMatch(runtime, /expectedItemId|diagnosticTaskId|confirmation/)
})

test("runtime persists reusable recovery evidence and never blindly retries", () => {
  assert.match(runtime, /seller_os_operational_learning_ledger_v1/)
  assert.match(runtime, /SAFE_IDEMPOTENT_RUNTIME_RESUME/)
  assert.match(runtime, /ambiguousWriteRetryAllowed: false/)
  assert.match(runtime, /freshOfficialPreflight: true/)
  assert.match(runtime, /atomicClaim: true/)
})

test("terminal exact-manifest executions suppress repeat work and close stale blockers", () => {
  assert.match(runtime, /APPLIED_AND_OFFICIALLY_VERIFIED/)
  assert.match(runtime, /verifiedBindings/)
  assert.match(runtime, /pendingTasks/)
  assert.match(runtime, /supersededByOfficialExecution: true/)
  assert.match(runtime, /RESOLVED_BY_READBACK/)
})

test("safe rebase idempotency is manifest fingerprinted, not task terminal", () => {
  assert.doesNotMatch(rebase, /completedTaskIds/)
  assert.match(rebase, /currentOfficialImageSetDigest/)
  assert.match(rebase, /oldDigest/)
})
