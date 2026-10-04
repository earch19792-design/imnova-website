import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const runtimeErrors = await import(
  "../seller-os/supabase-runtime-error-classification-v1.ts")

const heartbeat = readFileSync(
  "lib/seller-os/browser-worker-capability-v1.ts", "utf8")
const queueService = readFileSync(
  "lib/ebay/ebay-first-luna-scan-service.ts", "utf8")
const queuePage = readFileSync(
  "app/admin/ebay/opportunity-queue/page.tsx", "utf8")

test("heartbeat preserves schema, transient, and unclassified boundaries", () => {
  assert.equal(runtimeErrors.sellerOsBrowserWorkerHeartbeatFailureCodeV1({
    code: "PGRST202",
    message: "Could not find the function in the schema cache",
  }), "SELLER_OS_BROWSER_WORKER_HEARTBEAT_SCHEMA_UNAVAILABLE")
  assert.equal(runtimeErrors.sellerOsBrowserWorkerHeartbeatFailureCodeV1({
    code: "57014", message: "canceling statement due to statement timeout",
  }), "SELLER_OS_BROWSER_WORKER_HEARTBEAT_TEMPORARILY_UNAVAILABLE")
  assert.equal(runtimeErrors.sellerOsBrowserWorkerHeartbeatFailureCodeV1({
    code: "42501", message: "permission denied",
  }), "SELLER_OS_BROWSER_WORKER_HEARTBEAT_PERSIST_FAILED")
  assert.match(heartbeat,
    /sellerOsBrowserWorkerHeartbeatFailureCodeV1\(write\.error\)/)
})

test("queue outage is distinct from a schema mismatch", () => {
  assert.equal(runtimeErrors.sellerOsOpportunityQueueReadFailureCodeV1({
    statusText: "503 Service Unavailable",
  }), "EBAY_LUNA_QUEUE_TEMPORARILY_UNAVAILABLE")
  assert.equal(runtimeErrors.sellerOsOpportunityQueueReadFailureCodeV1({
    code: "42703", message: "column does not exist",
  }), "EBAY_LUNA_QUEUE_SCHEMA_UNAVAILABLE")
  assert.match(queueService,
    /sellerOsOpportunityQueueReadFailureCodeV1\(firstError\)/)
  assert.doesNotMatch(queuePage,
    /migración de la cola todavía no está aplicada/i)
  assert.match(queuePage, /EBAY_LUNA_QUEUE_TEMPORARILY_UNAVAILABLE/)
  assert.match(queuePage, /Tu avance sigue guardado/)
})

test("classifier returns only bounded public error classes", () => {
  const secretText = "password=never-return-this-value"
  assert.equal(runtimeErrors.classifySellerOsSupabaseRuntimeFailureV1({
    code: "UNKNOWN", message: secretText,
  }), "UNCLASSIFIED")
  assert.equal(runtimeErrors.sellerOsOpportunityQueueReadFailureCodeV1({
    code: "UNKNOWN", message: secretText,
  }), "EBAY_LUNA_QUEUE_DASHBOARD_READ_FAILED")
})
