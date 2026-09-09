import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createSellerOsBackgroundWorkloadControllerV1,
  holdSellerOsCrossTabBrowserLeaderV1 } from '../seller-os/background-workload-optimization-v1.ts'

const control = readFileSync('app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx', 'utf8')
const route = readFileSync('app/api/admin/ebay/luna-shipping-capture/route.ts', 'utf8')
class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
}
function setup(storage = new MemoryStorage(), random = () => .5) {
  let now = 1_800_000_000_000
  const controller = createSellerOsBackgroundWorkloadControllerV1({
    producer: 'LUNA_SHIPPING', storage, random, now: () => now,
  })
  controller.setLeaderState('BROWSER_LEADER')
  return { controller, storage, at: () => now, advance: (ms) => { now += ms } }
}
function reachMaximum(s) {
  for (let n = 0; n < 5; n++) {
    assert.equal(s.controller.acquireClaimPermit().allowed, true)
    s.controller.recordEmptyPoll()
    s.controller.releaseClaimPermit()
    s.advance(s.controller.nextDelayMs())
  }
}

test('EMPTY_15MIN_MAX_ONE_CLAIM_PASS', () => {
  for (const random of [() => 0, () => .5, () => 1]) {
    const s = setup(undefined, random)
    reachMaximum(s)
    let claims = 0
    for (let seconds = 0; seconds < 900; seconds += 30) {
      if (s.controller.acquireClaimPermit().allowed) {
        claims++
        s.controller.recordEmptyPoll()
        s.controller.releaseClaimPermit()
      }
      s.advance(30_000)
    }
    assert.equal(claims, 1)
    assert.equal(s.controller.metrics().currentBackoffMs, 900_000)
  }
})
test('HEARTBEAT_60S_NO_CLAIM_PASS', () => {
  const s = setup()
  reachMaximum(s)
  s.controller.acquireClaimPermit()
  s.controller.recordEmptyPoll()
  s.controller.releaseClaimPermit()
  const deadline = s.controller.metrics().emptyBackoffUntilMs
  let heartbeats = 0
  for (let seconds = 0; seconds < 900; seconds += 60) {
    assert.equal(s.controller.acquirePollPermit().allowed, true)
    heartbeats++
    s.controller.recordProbeSuccess(100)
    assert.equal(s.controller.acquireClaimPermit().allowed, false)
    assert.equal(s.controller.metrics().emptyBackoffUntilMs, deadline)
    s.advance(60_000)
  }
  assert.equal(heartbeats, 15)
  const heartbeat = control.slice(control.indexOf('const heartbeat = () =>'), control.indexOf('heartbeatNowRef.current = heartbeat'))
  assert.doesNotMatch(heartbeat, /acquisitionWake|attemptProductionAcquisition|loadJobs|resolve_jobs/)
})
test('SUPERVISOR_NO_CLAIM_PASS', () => {
  for (const marker of ['message?.type === BINDING_STORAGE_DIAGNOSTIC',
    'message?.type === "LUNA_CANONICAL_DESTINATION_STATUS"',
    'message?.type === "LUNA_SHIPPING_ACTIVE_JOB_STATUS"']) {
    const start = control.indexOf(marker)
    const end = control.indexOf('\n        if (message?.type', start + marker.length)
    const handler = control.slice(start, end)
    assert.match(handler, /scheduleProductionAcquisition/)
    assert.doesNotMatch(handler, /attemptProductionAcquisition\(|loadJobs\(/)
  }
})
test('BACKOFF_EXPIRY_REENABLES_ONE_CLAIM_PASS', () => {
  const s = setup()
  reachMaximum(s)
  s.controller.acquireClaimPermit()
  s.controller.recordEmptyPoll()
  s.controller.releaseClaimPermit()
  s.advance(899_999)
  assert.equal(s.controller.acquireClaimPermit().allowed, false)
  s.advance(1)
  assert.equal(s.controller.acquireClaimPermit().allowed, true)
  assert.equal(s.controller.acquireClaimPermit().allowed, false)
})
test('WORK_FOUND_RESETS_BACKOFF_PASS', () => {
  const s = setup()
  reachMaximum(s)
  assert.equal(s.controller.acquireClaimPermit().allowed, true)
  s.controller.recordClaimedJobs(1)
  s.controller.releaseClaimPermit()
  assert.equal(s.controller.metrics().emptyBackoffUntilMs, 0)
  assert.equal(s.controller.metrics().currentBackoffMs, 0)
  assert.equal(s.controller.acquireClaimPermit().allowed, true)
  assert.equal(s.controller.recordEmptyPoll(), 60_000)
})
test('FOLLOWER_NEVER_CLAIMS_PASS', () => {
  const s = setup()
  s.controller.setLeaderState('FOLLOWER')
  assert.equal(s.controller.acquireClaimPermit().allowed, false)
  s.controller.setLeaderState('STOPPED')
  assert.equal(s.controller.acquireClaimPermit().allowed, false)
  assert.match(route, /verifySellerOsBrowserWorkloadLeaseV1\([\s\S]*?LUNA_SHIPPING/)
  assert.ok(route.indexOf('if (!authority.claimAuthorityGranted)', route.indexOf('body.action === "resolve_jobs"')) < route.indexOf('const acquisition = await acquireLunaChromeShippingJobsV1'))
})
test('MULTI_TAB_SINGLE_CLAIM_PASS', async () => {
  const storage = new MemoryStorage()
  const s = setup(storage)
  reachMaximum(s)
  let release, claims = 0
  const held = new Promise(resolve => { release = resolve })
  let queue = Promise.resolve()
  const locks = { request(_name, _options, run) {
    const next = queue.then(() => run({}))
    queue = next.catch(() => {})
    return next
  } }
  const second = setup(storage)
  second.advance(s.at() - second.at())
  const firstRun = holdSellerOsCrossTabBrowserLeaderV1({ scope: 'LUNA_SHIPPING',
    signal: new AbortController().signal, locks,
    onLeaderState: state => s.controller.setLeaderState(state),
    run: async () => {
      if (s.controller.acquireClaimPermit().allowed) claims++
      s.controller.recordEmptyPoll()
      s.controller.releaseClaimPermit()
      await held
    } })
  const secondRun = holdSellerOsCrossTabBrowserLeaderV1({ scope: 'LUNA_SHIPPING',
    signal: new AbortController().signal, locks,
    onLeaderState: state => second.controller.setLeaderState(state),
    run: async () => { if (second.controller.acquireClaimPermit().allowed) claims++ } })
  await new Promise(resolve => setImmediate(resolve))
  release()
  await Promise.all([firstRun, secondRun])
  assert.equal(claims, 1)
})
test('NO_REGRESSION_REAL_WORK_PASS', () => {
  const s = setup()
  for (let job = 0; job < 3; job++) {
    assert.equal(s.controller.acquireClaimPermit().allowed, true)
    s.controller.recordClaimedJobs(1)
    s.controller.releaseClaimPermit()
  }
  assert.equal(s.controller.metrics().claimedJobs, 3)
  assert.equal(s.controller.recordEmptyPoll(), 60_000)
  s.advance(60_000)
  assert.equal(s.controller.acquireClaimPermit().allowed, true)
})
test('SHIPPING_RELOAD_PRESERVES_EMPTY_DEADLINE_PASS', () => {
  const s = setup()
  reachMaximum(s)
  s.controller.acquireClaimPermit()
  s.controller.recordEmptyPoll()
  s.controller.releaseClaimPermit()
  const reloaded = createSellerOsBackgroundWorkloadControllerV1({ producer: 'LUNA_SHIPPING',
    storage: s.storage, now: s.at })
  reloaded.setLeaderState('BROWSER_LEADER')
  assert.equal(reloaded.acquireClaimPermit().allowed, false)
  s.advance(900_000)
  assert.equal(reloaded.acquireClaimPermit().allowed, true)
})
test('SELLER_OS_OPERATIONAL_EFFICIENCY_GATE_V1', () => {
  assert.match(control, /workloadController.acquireClaimPermit\(\)/)
  assert.match(control, /workloadController.releaseClaimPermit\(\)/)
  assert.equal((control.match(/setInterval\(/g) ?? []).length, 1)
  assert.match(control, /SELLER_OS_BACKGROUND_HEARTBEAT_INTERVAL_MS/)
})
