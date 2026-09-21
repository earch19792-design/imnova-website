import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { webcrypto } from "node:crypto"

const backgroundPath =
  "tools/browser-extensions/luna-shipping-capture/background.js"
const pagePath =
  "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx"
const backgroundSource = readFileSync(backgroundPath, "utf8")
const pageSource = readFileSync(pagePath, "utf8")

const event = (capture = () => {}) => ({ addListener: capture })

function harness() {
  const existingTabs = new Set([1])
  const existingWindows = new Set([1])
  const removedTabs = []
  const removedWindows = []
  const timers = []
  const storage = {}
  let connectExternal
  let runtimeMessage
  let runtimeErrorReads = 0
  let runtimeError = null
  const runtime = {
    id: "mhpkojahbbfdgodeaecggpjaplllgclk",
    getManifest: () => ({
      version: "1.0.57",
      host_permissions: ["https://shop.app/*"],
      content_scripts: [{ matches: ["https://shop.app/*"] }],
    }),
    onInstalled: event(), onStartup: event(), onMessageExternal: event(),
    onConnectExternal: event((listener) => { connectExternal = listener }),
    onMessage: event((listener) => { runtimeMessage = listener }),
  }
  Object.defineProperty(runtime, "lastError", {
    configurable: true,
    get() { runtimeErrorReads += 1; return runtimeError },
  })
  const chrome = {
    runtime,
    storage: {
      local: {
        get(_key, callback) { callback({}) },
        set(_value, callback) { callback?.() },
      },
      session: {
        get(key, callback) { callback({ [key]: storage[key] }) },
        set(value, callback) { Object.assign(storage, value); callback?.() },
      },
    },
    tabs: {
      create: async () => ({ id: 10, windowId: 1 }),
      update: async () => ({}),
      query: async () => [],
      get(id, callback) {
        runtimeError = existingTabs.has(id) ? null : { message: "No tab" }
        callback(existingTabs.has(id) ? { id } : undefined)
        runtimeError = null
      },
      remove(id, callback) {
        removedTabs.push(id)
        existingTabs.delete(id)
        callback?.()
      },
      sendMessage() {},
      onRemoved: event(), onUpdated: event(),
    },
    windows: {
      get(id, callback) {
        runtimeError = existingWindows.has(id) ? null : { message: "No window" }
        callback(existingWindows.has(id) ? { id } : undefined)
        runtimeError = null
      },
      remove(id, callback) {
        removedWindows.push(id)
        existingWindows.delete(id)
        callback?.()
      },
    },
    alarms: { create() {}, onAlarm: event() },
    scripting: { executeScript: async () => [] },
    webNavigation: { onCommitted: event(), onCompleted: event() },
  }
  const setTimeoutFake = (callback, milliseconds) => {
    const timer = { callback, milliseconds, cleared: false }
    timers.push(timer)
    return timer
  }
  const clearTimeoutFake = (timer) => { if (timer) timer.cleared = true }
  const context = { chrome, crypto: webcrypto, URL, TextDecoder, TextEncoder,
    Uint8Array, atob, btoa, setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake }
  runInNewContext(`${backgroundSource}\n;globalThis.__lifecycle = {
    registerOwnedRunTab, registerOwnedRunWindow, cleanupOwnedRunContexts,
    terminateActiveJob, failActiveJob, armActiveJobTimeout,
    setActive(job, tabId) { activeJob = job; activeTabId = tabId },
    active() { return activeJob },
    cleanup() { return lastOwnedContextCleanup },
    ownedTabs() { return [...ownedRunTabs.keys()] },
    ownedWindows() { return [...ownedRunWindows.keys()] },
  }`, context)
  const api = context.__lifecycle
  const job = { captureSessionId: "session-owned-1",
    identity: { candidateId: `sha256:${"a".repeat(64)}` } }
  const connect = () => {
    let onMessage
    let onDisconnect
    const posted = []
    const port = {
      name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1",
      sender: { url: "https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture" },
      disconnect() { onDisconnect?.() },
      postMessage(message) { posted.push(message) },
      onMessage: event((listener) => { onMessage = listener }),
      onDisconnect: event((listener) => { onDisconnect = listener }),
    }
    connectExternal(port)
    return { port, posted, message: (value) => onMessage(value),
      disconnect: () => onDisconnect() }
  }
  return { api, job, connect, runtimeMessage, existingTabs, existingWindows,
    removedTabs, removedWindows, timers,
    setRuntimeError(value) { runtimeError = value },
    runtimeErrorReads: () => runtimeErrorReads }
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

test("PASS_BFCACHE_PORT_CLOSE_HANDLED", async () => {
  const h = harness()
  const connection = h.connect()
  h.api.setActive(h.job, 10)
  h.setRuntimeError({ message: "The page keeping the extension port is moved into back/forward cache." })
  const readsBefore = h.runtimeErrorReads()
  connection.disconnect()
  assert.ok(h.runtimeErrorReads() > readsBefore)
  assert.equal(h.api.active(), h.job)
  assert.match(pageSource,
    /nextPort\.onDisconnect\.addListener\(\(\) => \{[\s\S]*?runtime\?\.lastError\?\.message/)
})

test("PASS_BFCACHE_RECONNECT", () => {
  const pageShow = pageSource.match(
    /const handlePageShow = \(event: PageTransitionEvent\) => \{[\s\S]*?\n      \}/)?.[0] ?? ""
  assert.match(pageShow, /event\.persisted/)
  assert.match(pageShow, /acquireCurrentPort\(jobToResume\)/)
  assert.match(pageSource,
    /acquireCurrentPort = async \(jobToResume\)[\s\S]*?runtime\.connect\(EXTENSION_ID/)
  assert.match(pageSource, /RESUME_ACTIVE_LUNA_SHIPPING_JOB/)
})

test("PASS_JOB_STATE_SURVIVES_PORT_CLOSE", () => {
  const h = harness()
  const first = h.connect()
  h.api.setActive(h.job, 10)
  first.disconnect()
  assert.equal(h.api.active(), h.job)
  const second = h.connect()
  second.message({ type: "SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS" })
  assert.equal(second.posted.at(-1).active, true)
  assert.equal(second.posted.at(-1).job.captureSessionId, h.job.captureSessionId)
})

test("PASS_CLEANUP_ON_SUCCESS", async () => {
  const h = harness()
  h.existingTabs.add(10)
  h.api.setActive(h.job, 10)
  await h.api.registerOwnedRunTab(10, h.job.captureSessionId)
  const result = await h.api.terminateActiveJob("SUCCESS")
  assert.deepEqual(h.removedTabs, [10])
  assert.equal(result.orphanOwnedTabsAfterRun, 0)
  assert.equal(h.api.active(), null)
})

test("PASS_CLEANUP_ON_FAILURE", async () => {
  const h = harness()
  h.existingTabs.add(10)
  h.api.setActive(h.job, 10)
  await h.api.registerOwnedRunTab(10, h.job.captureSessionId)
  h.api.failActiveJob("LUNA_TEST_FAILURE")
  await settle()
  assert.deepEqual(h.removedTabs, [10])
  assert.equal(h.api.cleanup().orphanOwnedTabsAfterRun, 0)
})

test("PASS_CLEANUP_ON_TIMEOUT", async () => {
  const h = harness()
  h.existingTabs.add(10)
  h.api.setActive(h.job, 10)
  await h.api.registerOwnedRunTab(10, h.job.captureSessionId)
  h.api.armActiveJobTimeout()
  const timeout = h.timers.find((timer) => timer.milliseconds === 600_000)
  assert.ok(timeout)
  timeout.callback()
  await settle()
  assert.deepEqual(h.removedTabs, [10])
  assert.equal(h.api.cleanup().reason, "LUNA_SHIPPING_JOB_TIMEOUT")
})

test("PASS_CLEANUP_ON_CANCEL", async () => {
  const h = harness()
  h.existingTabs.add(10)
  h.api.setActive(h.job, 10)
  await h.api.registerOwnedRunTab(10, h.job.captureSessionId)
  const connection = h.connect()
  connection.message({ type: "SELLER_OS_CANCEL_LUNA_SHIPPING_JOB_V1",
    captureSessionId: h.job.captureSessionId,
    candidateId: h.job.identity.candidateId })
  await settle()
  assert.deepEqual(h.removedTabs, [10])
  assert.equal(h.api.cleanup().reason, "LUNA_SHIPPING_JOB_CANCELLED")
})

test("PASS_USER_TABS_PRESERVED", async () => {
  const h = harness()
  h.existingTabs.add(10)
  await h.api.registerOwnedRunTab(10, h.job.captureSessionId)
  await h.api.cleanupOwnedRunContexts("TEST")
  assert.equal(h.existingTabs.has(1), true)
  assert.equal(h.removedTabs.includes(1), false)
  assert.deepEqual(h.removedTabs, [10])
})

test("PASS_ZERO_ORPHAN_WINDOWS", async () => {
  const h = harness()
  h.existingWindows.add(20)
  await h.api.registerOwnedRunWindow(20, h.job.captureSessionId)
  const result = await h.api.cleanupOwnedRunContexts("TEST")
  assert.deepEqual(h.removedWindows, [20])
  assert.equal(result.orphanOwnedWindowsAfterRun, 0)
  assert.equal(result.orphanOwnedTabsAfterRun, 0)
  assert.equal(h.api.ownedWindows().length, 0)
  assert.equal(h.api.ownedTabs().length, 0)
})
