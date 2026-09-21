const port = Number(process.env.LUNA_CHROME_CDP_PORT ?? 9334)
const expectedExtensionId = "mhpkojahbbfdgodeaecggpjaplllgclk"
const expectedVersion = "1.0.57"
const sellerOsOrigin = "https://imnova-seller-os-preprod.vercel.app"
const controlPrefix =
  `${sellerOsOrigin}/admin/ebay/luna-shipping-capture`

const delay = (milliseconds) => new Promise((resolve) =>
  setTimeout(resolve, milliseconds))

async function waitFor(read, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (last) return last
    } catch (error) { last = error }
    await delay(200)
  }
  throw new Error(`CHROME_REAL_TEST_TIMEOUT:${description}:${String(last)}`)
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })
  let sequence = 0
  const pending = new Map()
  const listeners = new Map()
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(String(message.data))
    if (payload.id) {
      const waiter = pending.get(payload.id)
      if (!waiter) return
      pending.delete(payload.id)
      if (payload.error) waiter.reject(new Error(payload.error.message))
      else waiter.resolve(payload.result)
      return
    }
    for (const listener of listeners.get(payload.method) ?? []) {
      listener(payload.params)
    }
  })
  return {
    close: () => socket.close(),
    on(method, listener) {
      const current = listeners.get(method) ?? []
      listeners.set(method, [...current, listener])
    },
    send(method, params = {}) {
      const id = ++sequence
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

function runtimeValue(result) {
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ?? "RUNTIME_EVALUATION_FAILED")
  }
  return result?.result?.value
}

async function evaluate(client, expression) {
  return runtimeValue(await client.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  }))
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const controlTarget = targets.find((target) => target.type === "page" &&
  target.url.startsWith(controlPrefix)) ?? targets.find((target) =>
  target.type === "page" && target.url.startsWith(`${sellerOsOrigin}/`))
if (!controlTarget) {
  throw new Error("CHROME_REAL_SELLER_OS_TARGET_NOT_FOUND")
}

const page = await connectCdp(controlTarget.webSocketDebuggerUrl)
const diagnostics = []
const recordText = (source, text) => diagnostics.push({ source,
  text: String(text ?? "") })
for (const [client, source] of [[page, "CONTROL_PAGE"]]) {
  client.on("Log.entryAdded", ({ entry }) => recordText(source, entry?.text))
  client.on("Runtime.exceptionThrown", ({ exceptionDetails }) =>
    recordText(source, exceptionDetails?.exception?.description ??
      exceptionDetails?.text))
  client.on("Runtime.consoleAPICalled", ({ args }) =>
    recordText(source, args?.map((arg) => arg.value ?? arg.description).join(" ")))
  await client.send("Runtime.enable")
  await client.send("Log.enable")
}
await page.send("Page.enable")

const externalMessagingAvailable = await evaluate(page,
  "typeof chrome?.runtime?.connect === 'function'")
if (!externalMessagingAvailable) {
  throw new Error("CHROME_REAL_EXTERNAL_MESSAGING_UNAVAILABLE")
}
await evaluate(page, `(() => {
  window.__sellerOsLifecycleProbe = { pagehide: 0, pageshow: 0,
    persistedHide: false, persistedShow: false, disconnects: 0,
    runtimeLastErrorConsumed: false, reconnects: 0 };
  window.__sellerOsLifecycleConnect = () => {
    const nextPort = chrome.runtime.connect(${JSON.stringify(expectedExtensionId)},
      { name: "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1" });
    window.__sellerOsLifecyclePort = nextPort;
    nextPort.onDisconnect.addListener(() => {
      const runtimeDisconnectError = chrome.runtime.lastError?.message ?? "";
      window.__sellerOsLifecycleProbe.runtimeLastErrorConsumed =
        typeof runtimeDisconnectError === "string";
      window.__sellerOsLifecycleProbe.disconnects += 1;
    });
    nextPort.postMessage({
      type: "SELLER_OS_LUNA_SHIPPING_PORT_HANDSHAKE_V1",
      portGeneration: window.__sellerOsLifecycleProbe.reconnects + 1,
    });
    window.__sellerOsLifecycleProbe.reconnects += 1;
  };
  window.addEventListener("pagehide", (event) => {
    window.__sellerOsLifecycleProbe.pagehide += 1;
    window.__sellerOsLifecycleProbe.persistedHide = event.persisted;
    const hiddenPort = window.__sellerOsLifecyclePort;
    window.__sellerOsLifecyclePort = null;
    try { hiddenPort?.disconnect(); } catch {}
  });
  window.addEventListener("pageshow", (event) => {
    window.__sellerOsLifecycleProbe.pageshow += 1;
    window.__sellerOsLifecycleProbe.persistedShow = event.persisted;
    if (event.persisted) window.__sellerOsLifecycleConnect();
  });
  window.__sellerOsLifecycleConnect();
  return true;
})()`)
const workerTarget = await waitFor(async () => {
  const currentTargets = await (await fetch(
    `http://127.0.0.1:${port}/json`)).json()
  return currentTargets.find((target) => target.type === "service_worker" &&
    target.url === `chrome-extension://${expectedExtensionId}/background.js`)
}, "EXTENSION_SERVICE_WORKER_WAKE")
const worker = await connectCdp(workerTarget.webSocketDebuggerUrl)
worker.on("Log.entryAdded", ({ entry }) =>
  recordText("SERVICE_WORKER", entry?.text))
worker.on("Runtime.exceptionThrown", ({ exceptionDetails }) =>
  recordText("SERVICE_WORKER", exceptionDetails?.exception?.description ??
    exceptionDetails?.text))
worker.on("Runtime.consoleAPICalled", ({ args }) =>
  recordText("SERVICE_WORKER", args?.map((arg) =>
    arg.value ?? arg.description).join(" ")))
await worker.send("Runtime.enable")
await worker.send("Log.enable")
const extensionVersion = await evaluate(worker,
  "chrome.runtime.getManifest().version")
if (extensionVersion !== expectedVersion) {
  throw new Error(`CHROME_REAL_EXTENSION_VERSION_MISMATCH:${extensionVersion}`)
}
await waitFor(() => evaluate(worker, "sellerPort !== null"),
  "INITIAL_EXTERNAL_PORT")

const candidateId = `sha256:${"b".repeat(64)}`
const captureSessionId = "chrome-real-bfcache-session-v1"
await evaluate(worker, `(() => {
  activeJob = { captureSessionId: ${JSON.stringify(captureSessionId)},
    identity: { candidateId: ${JSON.stringify(candidateId)} } };
  activeJobPhase = "PRODUCT_PAGE";
  armActiveJobTimeout();
  return true;
})()`)

const initialHistory = await page.send("Page.getNavigationHistory")
await page.send("Page.navigate", { url: `${sellerOsOrigin}/terms` })
await waitFor(() => evaluate(worker, "sellerPort === null"),
  "PORT_DISCONNECT_ON_PAGEHIDE")
const jobSurvivedDisconnect = await evaluate(worker,
  `activeJob?.captureSessionId === ${JSON.stringify(captureSessionId)}`)
const awayHistory = await page.send("Page.getNavigationHistory")
const priorEntry = awayHistory.entries[awayHistory.currentIndex - 1] ??
  initialHistory.entries[initialHistory.currentIndex]
await page.send("Page.navigateToHistoryEntry", { entryId: priorEntry.id })
const lifecycleProbe = await waitFor(async () => {
  const value = await evaluate(page,
    "globalThis.__sellerOsLifecycleProbe ?? null")
  return value?.pageshow > 0 ? value : null
}, "BFCACHE_PAGESHOW")
const reconnected = await waitFor(() => evaluate(worker,
  "sellerPort !== null"), "EXTERNAL_PORT_RECONNECT")

const tabFixture = await evaluate(worker, `(async () => {
  const tabs = await chrome.tabs.query({});
  const userTab = tabs.find((tab) => tab.url === "about:blank") ??
    tabs.find((tab) => !String(tab.url ?? "").startsWith(${JSON.stringify(controlPrefix)}));
  if (!Number.isInteger(userTab?.id)) throw new Error("USER_TAB_FIXTURE_MISSING");
  const owned = await chrome.tabs.create({
    url: "about:blank#seller-os-owned-lifecycle-test", active: false,
  });
  await registerOwnedRunTab(owned.id, ${JSON.stringify(captureSessionId)});
  activeTabId = owned.id;
  return { userTabId: userTab.id, ownedTabId: owned.id };
})()`)
const cleanup = await evaluate(worker, `(async () => {
  const result = await terminateActiveJob("SUCCESS");
  const tabs = await chrome.tabs.query({});
  return { result, tabIds: tabs.map((tab) => tab.id),
    ownedLedgerTabs: [...ownedRunTabs.keys()],
    ownedLedgerWindows: [...ownedRunWindows.keys()] };
})()`)

await delay(500)
const uncheckedRuntimeErrors = diagnostics.filter((entry) =>
  /Unchecked runtime\.lastError/i.test(entry.text))
const report = {
  contract: "LUNA_BROWSER_LIFECYCLE_HARDENING_V1_CHROME_REAL",
  chromeProduct: (await (await fetch(
    `http://127.0.0.1:${port}/json/version`)).json()).Browser,
  extensionId: expectedExtensionId,
  extensionVersion,
  PASS_BFCACHE_PORT_CLOSE_HANDLED: uncheckedRuntimeErrors.length === 0,
  PASS_BFCACHE_RECONNECT: lifecycleProbe.persistedShow === true && reconnected,
  PASS_JOB_STATE_SURVIVES_PORT_CLOSE: jobSurvivedDisconnect === true,
  PASS_CLEANUP_ON_SUCCESS:
    !cleanup.tabIds.includes(tabFixture.ownedTabId),
  PASS_USER_TABS_PRESERVED:
    cleanup.tabIds.includes(tabFixture.userTabId),
  PASS_ZERO_ORPHAN_WINDOWS:
    cleanup.result.orphanOwnedTabsAfterRun === 0 &&
    cleanup.result.orphanOwnedWindowsAfterRun === 0 &&
    cleanup.ownedLedgerTabs.length === 0 &&
    cleanup.ownedLedgerWindows.length === 0,
  BFCache: lifecycleProbe,
  cleanup: cleanup.result,
  ownedTabId: tabFixture.ownedTabId,
  userTabId: tabFixture.userTabId,
  uncheckedRuntimeErrors,
}
page.close()
worker.close()
console.log(JSON.stringify(report))
if (!Object.entries(report).filter(([key]) => key.startsWith("PASS_"))
  .every(([, value]) => value === true)) process.exitCode = 1
