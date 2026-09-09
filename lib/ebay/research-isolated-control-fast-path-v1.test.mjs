import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = readFileSync(
  "app/admin/ebay/opportunity-queue/research/page.tsx", "utf8")
const gate = readFileSync(
  "app/admin/ebay/opportunity-queue/research/research-worker-control-owner-gate-v1.tsx",
  "utf8")
const normal = readFileSync(
  "app/admin/ebay/opportunity-queue/research/normal-research-page.tsx", "utf8")
const provider = readFileSync("app/admin/admin-owner-runtime-provider.tsx", "utf8")
const runner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")

test("WORKER_CONTROL_OWNER_ADMIN_AUTH_PASS", () => {
  assert.match(gate, /validateAdminSession\(\)/)
  assert.match(gate, /result\.isAdmin \? "AUTHORIZED" : "DENIED"/)
  assert.doesNotMatch(gate, /validateSellerOsSession/)
})

test("WORKER_CONTROL_MOUNTS_MAYEL_RUNNER_PASS", () => {
  assert.match(page, /params\.browserWorkerControl === "1"/)
  assert.match(page, /<ResearchWorkerControlOwnerGateV1 \/>/)
  assert.match(gate, /<MayelMarketRevalidationRunner \/>/)
})

test("WORKER_CONTROL_GATE_ONLY_CANNOT_CLAIM_PASS", () => {
  assert.match(runner,
    /const gateOnly = browserWorkerControl && !planId && !autonomous/)
  const gate = runner.indexOf("if (gateOnly)")
  const claim = runner.indexOf("CLAIM_AUTONOMOUS_RESEARCH_PLAN")
  assert.ok(gate >= 0 && claim > gate)
  assert.match(runner.slice(gate, claim), /leadershipAbort\.signal/)
  assert.doesNotMatch(runner.slice(gate, claim), /CLAIM_AUTONOMOUS_RESEARCH_PLAN/)
})

test("WORKER_CONTROL_NO_COMMAND_CENTER_PASS", () => {
  assert.doesNotMatch(page + gate, /command-center/)
})

test("WORKER_CONTROL_NO_LOOP2_POOL_PASS", () => {
  assert.doesNotMatch(page + gate, /Loop2Top20OpportunityPool/)
})

test("WORKER_CONTROL_NO_LUNA_QUICK_PICK_PASS", () => {
  assert.match(provider,
    /!pathname\.startsWith\("\/admin\/ebay\/luna-shipping-capture"\) &&\s*!isolatedResearchWorkerControl/)
  assert.doesNotMatch(page + gate, /luna-quick-pick/)
})

test("WORKER_CONTROL_V2_HEARTBEAT_PASS", () => {
  assert.match(runner, /HEARTBEAT_PRODUCT_RESEARCH_WORKER/)
  assert.match(runner, /leaderSessionId/)
})

test("WORKER_CONTROL_LEADER_PASS", () => {
  assert.match(runner, /holdSellerOsCrossTabBrowserLeaderV1/)
  assert.match(runner, /claimAuthorityGranted/)
})

test("WORKER_CONTROL_CAPABILITY_PASS", () => {
  assert.match(runner, /PRODUCT_RESEARCH_WORKER_CAPABILITY_INVALID/)
  assert.match(runner, /INDEPENDENT_WORKER_LIVENESS/)
})

test("WORKER_CONTROL_CHROME_PORT_PASS", () => {
  assert.match(runner, /establishEbayOneClickResearchHandshake/)
  assert.match(runner, /extensionCommand/)
})

test("WORKER_CONTROL_CLAIM_DISPATCH_FINISH_PASS", () => {
  assert.match(runner, /CLAIM_AUTONOMOUS_RESEARCH_PLAN/)
  assert.match(runner, /IMNOVA_EBAY_ONE_CLICK_RESEARCH_QUERY_V1/)
  assert.match(runner, /COMPLETE_MARKET_REVALIDATION/)
  assert.match(runner, /RELEASE_AUTONOMOUS_RESEARCH_PLAN/)
})

test("NORMAL_RESEARCH_UI_UNCHANGED_PASS", () => {
  assert.match(page, /return <NormalResearchPage \/>/)
  assert.match(normal, /<SmartStockingListingIntakeCard \/>/)
  assert.match(normal, /<Loop2Top20OpportunityPool surface="opportunities">/)
})

test("NO_NEW_POLLING_PASS and SELLER_OS_OPERATIONAL_EFFICIENCY_GATE_V1", () => {
  assert.doesNotMatch(page + gate, /setInterval|setTimeout|fetch\(|supabase\./)
  assert.match(gate, /It deliberately owns no polling, claims, commercial reads/)
})
