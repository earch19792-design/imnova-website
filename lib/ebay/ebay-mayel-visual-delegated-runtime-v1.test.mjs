import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const runtime = readFileSync(new URL(
  "./ebay-mayel-visual-delegated-runtime-v1.ts", import.meta.url), "utf8")
const orchestrator = readFileSync(new URL(
  "../seller-os/operational-integrity-runtime-v1.ts", import.meta.url), "utf8")
const rebase = readFileSync(new URL(
  "./ebay-mayel-visual-safe-rebase-runtime-v1.ts", import.meta.url), "utf8")
const phaseBServer = readFileSync(new URL(
  "./ebay-mayel-visual-phase-b-server-v1.ts", import.meta.url), "utf8")

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

test("Media identity loss has one delayed durable retry without listing retry", () => {
  assert.match(phaseBServer, /MAYEL_TRADING_VISUAL_EXECUTOR_V5/)
  assert.match(phaseBServer, /SAFE_BOUNDED_MEDIA_REPREPARATION/)
  assert.match(phaseBServer, /MAYEL_TRADING_MEDIA_MAX_CREATE_CALLS = 2/)
  assert.match(phaseBServer,
    /MAYEL_TRADING_MEDIA_IDENTITY_RETRY_DELAY_MS = 15 \* 60 \* 1_000/)
  assert.match(phaseBServer, /identityLossOnlyRetry: true/)
  assert.match(phaseBServer, /ambiguousListingWriteRetryAllowed: false/)
  assert.match(phaseBServer, /recovery_attempt_count: priorAttempts \+ 1/)
  assert.match(phaseBServer,
    /\.eq\("recovery_attempt_count", priorAttempts\)/)
  assert.match(phaseBServer, /MAYEL_TRADING_MEDIA_RETRY_EXHAUSTED/)
})
