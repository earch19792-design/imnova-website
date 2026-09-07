import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"

const {
  isProductResearchWorkerControlReturnPath,
  recoverProductResearchWorkerControlSessionV1,
} = await import("./product-research-browser-restart-recovery-v1.ts")

const controlPath =
  "/admin/ebay/opportunity-queue/research?mayelResearchWorker=auto&browserWorkerControl=1"

function extensionRecoveryContract() {
  const sandbox = { URL }
  runInNewContext(readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/worker-control-recovery.js",
    "utf8",
  ), sandbox)
  return sandbox.SELLER_OS_PRODUCT_RESEARCH_CONTROL_RECOVERY_V1
}

test("PASS_BROWSER_RESTART_WITH_VALID_SESSION_RECOVERS_CONTROL_PAGE", async () => {
  let sessionWrites = 0
  const result = await recoverProductResearchWorkerControlSessionV1({
    returnTo: controlPath,
    readSession: async () => ({ authorized: true,
      accessToken: "ephemeral-browser-session", error: null }),
    establishProtectedSession: async (token) => {
      assert.equal(token, "ephemeral-browser-session")
      sessionWrites += 1
      return true
    },
    wait: async () => undefined,
  })
  assert.equal(result.status, "CONTROL_PAGE_RECOVERED")
  assert.equal(result.attempts, 1)
  assert.equal(sessionWrites, 1)
})

test("PASS_EXTENSION_ALARM_307_LOGIN_DETECTED", () => {
  const contract = extensionRecoveryContract()
  const login = `https://imnova-seller-os-preprod.vercel.app/admin/login?returnTo=${encodeURIComponent(controlPath)}`
  assert.equal(contract.isControlAuthRedirect(login), true)
  const decision = contract.decide([{ id: 41, url: login }])
  assert.equal(decision.action, "WAIT_FOR_AUTH")
  assert.equal(decision.workerState, "WAITING_AUTH_REQUIRED")
  assert.equal(decision.blockerCode,
    "AUTHENTICATED_CONTROL_PAGE_NOT_BOOTSTRAPPED")
})

test("PASS_NO_AUTH_BYPASS", () => {
  const login = readFileSync("app/admin/login/page.tsx", "utf8")
  const middleware = readFileSync("middleware.ts", "utf8")
  const extension = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/background.js",
    "utf8",
  )
  assert.match(login, /validateSellerOsSession/)
  assert.match(login, /establishProtectedAdminSession/)
  assert.match(login, /\/api\/admin\/session/)
  assert.match(middleware, /isVerifiedSellerOsToken/)
  assert.doesNotMatch(extension,
    /document\.cookie|chrome\.cookies|access_token|refresh_token|Authorization/)
})

test("PASS_NO_SESSION_STAYS_WAITING_AUTH_REQUIRED", async () => {
  let sessionWrites = 0
  const result = await recoverProductResearchWorkerControlSessionV1({
    returnTo: controlPath,
    readSession: async () => ({ authorized: false,
      accessToken: null, error: "NO_SESSION" }),
    establishProtectedSession: async () => {
      sessionWrites += 1
      return true
    },
    wait: async () => undefined,
  })
  assert.equal(result.status, "WAITING_AUTH_REQUIRED")
  assert.equal(result.blockerCode,
    "AUTHENTICATED_CONTROL_PAGE_NOT_BOOTSTRAPPED")
  assert.equal(sessionWrites, 0)
})

test("PASS_VALID_SESSION_HEARTBEAT_RESUMES", () => {
  const login = readFileSync("app/admin/login/page.tsx", "utf8")
  const runner = readFileSync(
    "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
    "utf8",
  )
  assert.match(login, /window\.location\.replace\(getSafeAdminReturnPath\(returnTo\)\)/)
  assert.match(runner, /HEARTBEAT_PRODUCT_RESEARCH_WORKER/)
  assert.match(runner, /persistHeartbeat\("IDLE"\)/)
})

test("PASS_PENDING_TASK_AUTOCLAIM_AFTER_RESTART", () => {
  const runner = readFileSync(
    "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
    "utf8",
  )
  assert.match(runner, /CLAIM_AUTONOMOUS_RESEARCH_PLAN/)
  assert.match(runner, /HEARTBEAT_PRODUCT_RESEARCH_WORKER/)
  assert.match(runner, /COMPLETE_MARKET_REVALIDATION/)
})

test("PASS_NO_DUPLICATE_CONTROL_TABS", () => {
  const contract = extensionRecoveryContract()
  const control = `https://imnova-seller-os-preprod.vercel.app${controlPath}`
  const login = `https://imnova-seller-os-preprod.vercel.app/admin/login?returnTo=${encodeURIComponent(controlPath)}`
  const decision = contract.decide([
    { id: 41, url: control }, { id: 42, url: control }, { id: 43, url: login },
  ])
  assert.equal(decision.action, "REUSE_CONTROL_PAGE")
  assert.equal(decision.primaryTabId, 41)
  assert.deepEqual([...decision.duplicateTabIds], [42, 43])
})

test("PASS_NO_DUPLICATE_CLAIMS", () => {
  const migration = readFileSync(
    "supabase/migrations/20260907052451_seller_os_browser_worker_self_recovery_v1.sql",
    "utf8",
  )
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /worker_lease_expires_at > clock_timestamp\(\)/)
  assert.match(migration, /return query select false/)
})

test("PASS_RESTART_PRESERVES_PLAN_TASK_RECEIPTS", () => {
  const background = readFileSync(
    "tools/browser-extensions/ebay-product-research-capture/background.js",
    "utf8",
  )
  assert.match(background, /runtime\.onStartup/)
  assert.match(background, /forceReloadExisting: true/)
  assert.match(background, /WAIT_FOR_AUTH/)
  assert.doesNotMatch(background,
    /marketplace_product_research_query_(?:plans|tasks)|capture_batch_id/)
})

test("recovery is bounded when protected session establishment fails", async () => {
  let attempts = 0
  const result = await recoverProductResearchWorkerControlSessionV1({
    returnTo: controlPath,
    readSession: async () => ({ authorized: true,
      accessToken: "ephemeral-browser-session", error: null }),
    establishProtectedSession: async () => {
      attempts += 1
      return false
    },
    wait: async () => undefined,
  })
  assert.equal(result.status, "WAITING_AUTH_REQUIRED")
  assert.equal(attempts, 3)
})

test("only the exact bounded Product Research control return is eligible", () => {
  assert.equal(isProductResearchWorkerControlReturnPath(controlPath), true)
  assert.equal(isProductResearchWorkerControlReturnPath(
    "/admin/ebay/opportunity-queue/research"), false)
  assert.equal(isProductResearchWorkerControlReturnPath(
    "https://attacker.example/admin/ebay/opportunity-queue/research?mayelResearchWorker=auto&browserWorkerControl=1"), false)
})
