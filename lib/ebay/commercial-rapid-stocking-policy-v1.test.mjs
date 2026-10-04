import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  classifyRapidStockingEvaluationV1,
  SELLER_OS_RAPID_STOCKING_POLICY_V1,
} from './commercial-rapid-stocking-policy-v1.ts'

const candidate = { productId: '1', variantId: '2', supplierSku: 'PET-1',
  supplierQuantity: 1 }

test('rapid stocking permanently requires unit first and at least four dollars', () => {
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.minimumExpectedNetProfitUsd, 4)
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.targetQualifiedDrafts, 10)
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.rules.unitFirst, true)
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.rules.packSizesAreNeverInvented, true)
})

test('only GO evaluations at the profit floor classify as qualified drafts', () => {
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'GO', candidate,
    economics: { expectedNetProfit: 4 }, reasonCodes: [] }),
  'PROVEN_UNIT_DRAFT')
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'GO',
    candidate: { ...candidate, supplierQuantity: 2 },
    economics: { expectedNetProfit: 5 }, reasonCodes: [] }),
  'PROVEN_PACK_DRAFT')
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'REJECT', candidate,
    economics: { expectedNetProfit: 3.99 },
    reasonCodes: ['SOLD_MARKET_DOES_NOT_SUPPORT_TARGET_NET'] }),
  'REJECT_MARGIN')
})

test('a no-history product is a controlled test candidate and is never called proven', () => {
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'UNPROVEN', candidate,
    economics: { expectedNetProfit: null },
    reasonCodes: ['EXACT_CLOSE_REALIZED_SOLD_UNPROVEN'] }),
  'CONTROLLED_TEST_CANDIDATE')
})

test('shipping is never fixed or recalculated outside Luna Shipping Capture', () => {
  const runtime = readFileSync(new URL(
    './commercial-golden-path-runtime-v1.ts', import.meta.url), 'utf8')
  assert.match(runtime, /readCommercialTraceShippingReceiptV1/)
  assert.match(runtime, /readLunaShippingQty1OpportunityReceiptV1/)
  assert.match(runtime, /binding: \{ productId: key\.productId/)
  assert.match(runtime, /ensureLunaShippingQty1OpportunityJobV1/)
  assert.match(runtime, /LUNA_SHIPPING_CAPTURE_EXTENSION/)
  assert.match(runtime, /LUNA_SHIPPING_CAPTURE_REQUIRED/)
  assert.doesNotMatch(runtime, /amountUsdPerOrder|9\.99|ownerFlatShipping/)
  assert.doesNotMatch(runtime, /attemptLunaAuthenticatedHttpShippingQuoteV1/)
})

test('a durable shipping job wakes Luna Shipping Capture without waiting for idle backoff', () => {
  const analysis = readFileSync(new URL(
    '../../app/admin/ebay/opportunity-queue/research/autonomous-category-analysis-v1.tsx',
    import.meta.url), 'utf8')
  const worker = readFileSync(new URL(
    '../../app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx',
    import.meta.url), 'utf8')
  const route = readFileSync(new URL(
    '../../app/api/admin/ebay/luna-shipping-capture/route.ts',
    import.meta.url), 'utf8')
  assert.match(analysis, /publishSellerOsLunaShippingDurableWorkSignalV1/)
  assert.match(worker, /readSellerOsLunaShippingDurableWorkSignalV1/)
  assert.match(worker, /confirmDurableWorkSignal\(\)/)
  assert.match(worker, /:consumed-v2/)
  assert.match(worker, /loadJobs\(undefined, "AUTO", signal\)/)
  assert.match(worker, /durableWorkRecoveryRef\.current\?\.\(\)/)
  assert.match(worker,
    /postShippingContinuation[\s\S]*QUICK_PICK_POST_SHIPPING_CONTINUATION_V1[\s\S]*scopedCandidateCount[\s\S]*forceDurableWorkRecoveryRef\.current\?\.\(\)/)
  assert.equal(worker.match(/postShipping\.contractVersion/g)?.length, 2,
    'both stock rejection and successful shipping capture must continue the durable batch')
  assert.match(worker, /Reintentar trabajo pendiente ahora/)
  assert.match(route, /certifySellerOsLunaShippingDurableWorkSignalV1/)
  assert.match(route, /if \(!durableWorkSignal\) \{[\s\S]*?gate_seller_os_shipping_capture_v1/)
  assert.match(route, /durableWorkSignalWake: Boolean\(durableWorkSignal\)/)
})

test('Quick Pick emits the same durable Shipping wake signal for waiting cards', () => {
  const quickPick = readFileSync(
    'app/admin/ebay/quick-pick/page.tsx', 'utf8')
  assert.match(quickPick,
    /publishSellerOsLunaShippingDurableWorkSignalV1/)
  assert.match(quickPick, /card\.stages\.SHIPPING === "WAITING"/)
  assert.match(quickPick, /signalId: crypto\.randomUUID\(\)/)
  assert.ok(quickPick.indexOf('wakeLunaShippingForWaitingCardsV1(payload.result.cards)') >
    quickPick.indexOf('action: "PROCESS"'))
})

test('the autonomous batch releases a stalled screen and exposes a safe retry', () => {
  const analysis = readFileSync(new URL(
    '../../app/admin/ebay/opportunity-queue/research/autonomous-category-analysis-v1.tsx',
    import.meta.url), 'utf8')
  assert.match(analysis, /AUTONOMOUS_CATEGORY_ANALYSIS_UI_TIMEOUT_MS = 120_000/)
  assert.match(analysis, /const controller = new AbortController\(\)/)
  assert.match(analysis, /signal: controller\.signal/)
  assert.match(analysis, /controller\.signal\.aborted/)
  assert.match(analysis, /El trabajo durable no se pierde/)
  assert.match(analysis, /Forzar reintento seguro/)
})

test('the browser worker consumes queued stocking research through an explicit safe plan', () => {
  const runner = readFileSync(new URL(
    '../../app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx',
    import.meta.url), 'utf8')
  const operator = readFileSync(new URL(
    '../../app/api/admin/ebay/live-optimization-operator/route.ts',
    import.meta.url), 'utf8')
  const acquisition = readFileSync(new URL(
    './ebay-mayel-live-market-revalidation-v1.ts', import.meta.url), 'utf8')
  assert.match(runner, /"READ_AUTONOMOUS_RESEARCH_ACQUISITION"/)
  assert.match(runner, /"READ_NORMAL_LUNA_RESEARCH_ACQUISITION"/)
  assert.match(runner, /canaryState === "CANARY" \? "NORMAL_LUNA"/)
  assert.match(runner, /Number\(state\.claimablePlanCount \?\? 0\) > 0/)
  assert.match(runner, /Number\(state\.activeClaimCount \?\? 0\) === 0/)
  assert.match(runner, /\{ planId: state\.nextPlanId \}/)
  assert.match(runner,
    /result\.planId === undefined \? \{ \.\.\.result, planId: null \} : result/)
  assert.match(runner, /const acquisitionAllowed = acquisitionLane === "GLOBAL" \|\|/)
  assert.match(runner, /acquisitionLane === "NORMAL_LUNA"/)
  assert.match(runner,
    /carril \$\{queueState\.canaryState\}\/\$\{queueState\.acquisitionLane\}/)
  assert.match(runner, /cola \$\{queueState\.pendingPlanCount\}/)
  assert.match(runner, /reclamables \$\{queueState\.claimablePlanCount\}/)
  assert.match(runner, /activos \$\{queueState\.activeClaimCount\}/)
  assert.match(runner, /lotes protegidos \$\{queueState\.excludedBatchPlanCount\}/)
  assert.match(operator,
    /READ_NORMAL_LUNA_RESEARCH_ACQUISITION[\s\S]*?sourceContexts: \["LUNA_PRE_RESEARCH"\][\s\S]*?excludePreResearchBatchPlans: true/)
  assert.match(acquisition,
    /seller_os_pre_research_batch_members_v1[\s\S]*?excludedPlanIds[\s\S]*?!excludedPlanIds\.has/)
  assert.doesNotMatch(runner,
    /READ_AUTONOMOUS_RESEARCH_ACQUISITION[\s\S]{0,500}planId:\s*(?:null|undefined)[\s\S]{0,300}CLAIM_AUTONOMOUS_RESEARCH_PLAN/)
})

test('stocking and Luna shipping renew a rejected owner session once', () => {
  const authenticatedFetch = readFileSync(new URL(
    '../seller-os/seller-os-authenticated-fetch-v1.ts', import.meta.url), 'utf8')
  const analysis = readFileSync(new URL(
    '../../app/admin/ebay/opportunity-queue/research/autonomous-category-analysis-v1.tsx',
    import.meta.url), 'utf8')
  const worker = readFileSync(new URL(
    '../../app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx',
    import.meta.url), 'utf8')
  assert.match(authenticatedFetch, /initialResponse\.status !== 401/)
  assert.match(authenticatedFetch, /supabase\.auth\.refreshSession\(\)/)
  assert.match(authenticatedFetch, /\/api\/admin\/session/)
  assert.match(analysis, /sellerOsAuthenticatedFetchV1/)
  assert.match(worker, /sellerOsAuthenticatedFetchV1/)
})
