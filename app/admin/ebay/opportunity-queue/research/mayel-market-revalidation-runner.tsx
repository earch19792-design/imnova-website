"use client"

import { useEffect, useRef, useState } from "react"

import {
  buildEbayOneClickResearchLease,
  buildEbayOneClickResearchPlan,
  attestEbayOneClickResearchExtensionArtifact,
  EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE,
  EBAY_ONE_CLICK_RESEARCH_COMMAND,
  EBAY_ONE_CLICK_RESEARCH_RESULT,
  establishEbayOneClickResearchHandshake,
} from "@/lib/ebay/ebay-one-click-research-session-v1"
import { supabase } from "@/lib/supabase"
import {
  createSellerOsBackgroundWorkloadControllerV1,
  holdSellerOsCrossTabBrowserLeaderV1,
  SELLER_OS_BACKGROUND_HEARTBEAT_INTERVAL_MS,
  sellerOsBackgroundMetricsPublisherV1,
} from "@/lib/seller-os/background-workload-optimization-v1"

type JsonRecord = Record<string, unknown>

function planIdFromLocation() {
  const value = new URLSearchParams(window.location.search)
    .get("mayelMarketRevalidation") ?? ""
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value) ? value : null
}

function autonomousModeFromLocation() {
  return new URLSearchParams(window.location.search)
    .get("mayelResearchWorker") === "auto"
}

function browserWorkerControlModeFromLocation() {
  return new URLSearchParams(window.location.search)
    .get("browserWorkerControl") === "1"
}

function safeReturnPath() {
  const value = new URLSearchParams(window.location.search).get("returnTo")
  return value && /^\/admin(?:\/|$)/.test(value) && !value.startsWith("//")
    ? value : "/admin/ebay/mayel"
}

async function stableProductResearchWorkerId(extensionId: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(
      `SELLER_OS_PRODUCT_RESEARCH_BROWSER_WORKER_V1:${extensionId}`)))
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = Array.from(digest.slice(0, 16), (value) =>
    value.toString(16).padStart(2, "0")).join("")
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  return `product-research-browser:${uuid}`
}

async function authorizedPost(body: JsonRecord) {
  const startedAt = performance.now()
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) throw new Error("SESSION_REQUIRED")
  const response = await fetch(
    "/api/admin/ebay/live-optimization-operator", {
      method: "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  const payload = await response.json().catch(() => ({})) as JsonRecord
  if (!response.ok || payload.success !== true) {
    const error = new Error(typeof payload.error === "string" ? payload.error :
      "MARKET_REVALIDATION_REQUEST_FAILED") as Error & {
        httpStatus?: number
        latencyMs?: number
      }
    error.httpStatus = response.status
    error.latencyMs = performance.now() - startedAt
    throw error
  }
  return Object.assign(payload, {
    backgroundRequestLatencyMs: performance.now() - startedAt,
  })
}

function extensionCommand<T extends JsonRecord>(command: JsonRecord,
  timeoutMs: number): Promise<T & { bridgeExtensionId: string }> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive)
      reject(new Error("PRODUCT_RESEARCH_WORKER_TIMEOUT"))
    }, timeoutMs)
    const receive = (event: MessageEvent) => {
      const message = event.data && typeof event.data === "object"
        ? event.data as JsonRecord : {}
      if (event.source !== window || event.origin !== window.location.origin ||
          message.requestId !== requestId ||
          message.type === EBAY_ONE_CLICK_RESEARCH_BRIDGE_LIFECYCLE) return
      if (message.type !== EBAY_ONE_CLICK_RESEARCH_RESULT) return
      window.clearTimeout(timeout)
      window.removeEventListener("message", receive)
      if (message.success !== true || !message.payload ||
          typeof message.payload !== "object") {
        reject(new Error(typeof message.error === "string" ? message.error :
          "PRODUCT_RESEARCH_WORKER_FAILED"))
        return
      }
      resolve({ ...(message.payload as T),
        bridgeExtensionId: String(message.extensionId ?? "UNKNOWN") })
    }
    window.addEventListener("message", receive)
    window.postMessage({ type: EBAY_ONE_CLICK_RESEARCH_COMMAND,
      requestId, command }, window.location.origin)
  })
}

export function MayelMarketRevalidationRunner() {
  const started = useRef(false)
  const [active, setActive] = useState(false)
  const [state, setState] = useState("Preparando el plan de investigación…")
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const planId = planIdFromLocation()
    const autonomous = autonomousModeFromLocation()
    const browserWorkerControl = browserWorkerControlModeFromLocation()
    const gateOnly = browserWorkerControl && !planId && !autonomous
    if ((!planId && !autonomous && !gateOnly) || started.current) return
    started.current = true
    setActive(true)
    const leadershipAbort = new AbortController()
    const leaderSessionStorageKey =
      "seller-os-product-research-leader-session-v1"
    const storedLeaderSessionId = window.sessionStorage.getItem(
      leaderSessionStorageKey)
    const leaderSessionId = storedLeaderSessionId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(storedLeaderSessionId)
      ? storedLeaderSessionId : crypto.randomUUID()
    window.sessionStorage.setItem(leaderSessionStorageKey, leaderSessionId)
    const controller = createSellerOsBackgroundWorkloadControllerV1({
      producer: "PRODUCT_RESEARCH", storage: window.localStorage,
      publish: sellerOsBackgroundMetricsPublisherV1,
    })
    let heartbeatInterval: number | null = null
    void holdSellerOsCrossTabBrowserLeaderV1({
      scope: "PRODUCT_RESEARCH", signal: leadershipAbort.signal,
      onLeaderState: (leaderState) => controller.setLeaderState(leaderState),
      run: async () => {
      setState("Conectando Product Research…")
      const probe = await establishEbayOneClickResearchHandshake({
        probe: (timeoutMs) => extensionCommand<{
          success: true
          ready: true
          extensionId: string
          extensionVersion: string
          cookieAccess: false
          marketplaceWrites: 0
        }>({
          type: "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1",
        }, timeoutMs),
      })
      if (probe.ready !== true || probe.cookieAccess !== false ||
          probe.marketplaceWrites !== 0) {
        throw new Error("PRODUCT_RESEARCH_WORKER_CAPABILITY_INVALID")
      }
      attestEbayOneClickResearchExtensionArtifact({
        extensionVersion: probe.extensionVersion,
        manifestOriginMatch: probe.extensionId === probe.bridgeExtensionId,
      })
      const workerId = await stableProductResearchWorkerId(probe.extensionId)
      let workerState: "IDLE" | "WORKING" = "IDLE"
      let claimAuthorityGranted = false
      const persistHeartbeat = async (workerState: "IDLE" | "WORKING") => {
        const payload = await authorizedPost({
          action: "HEARTBEAT_PRODUCT_RESEARCH_WORKER", workerId,
          leaderSessionId,
          extensionVersion: probe.extensionVersion,
          extensionIdentityMatch: probe.extensionId === probe.bridgeExtensionId,
          workerState,
        })
        const heartbeat = payload.result as JsonRecord
        if (heartbeat.capabilityFresh !== true ||
            heartbeat.heartbeatSource !== "INDEPENDENT_WORKER_LIVENESS") {
          throw new Error("PRODUCT_RESEARCH_WORKER_HEARTBEAT_INVALID")
        }
        claimAuthorityGranted = heartbeat.claimAuthorityGranted === true
        return Object.assign(heartbeat, {
          backgroundRequestLatencyMs:
            Number(payload.backgroundRequestLatencyMs ?? 0),
        })
      }
      const initialHeartbeatPermit = controller.acquirePollPermit()
      if (!initialHeartbeatPermit.allowed) {
        setState("Supabase está degradado. Esperando la sonda acotada…")
        if (browserWorkerControl) {
          await new Promise<void>((resolve) => {
            const reload = window.setTimeout(() => {
              window.location.reload()
              resolve()
            }, initialHeartbeatPermit.retryInMs)
            leadershipAbort.signal.addEventListener("abort", () => {
              window.clearTimeout(reload)
              resolve()
            }, { once: true })
          })
        } else {
          window.setTimeout(() => window.location.replace(safeReturnPath()),
            initialHeartbeatPermit.retryInMs)
        }
        return
      }
      let heartbeat = await persistHeartbeat(workerState)
      controller.recordProbeSuccess(
        Number(heartbeat.backgroundRequestLatencyMs ?? 0))
      let heartbeatInFlight = false
      heartbeatInterval = window.setInterval(() => {
        if (heartbeatInFlight) {
          controller.suppressDuplicatePoll()
          return
        }
        const permit = controller.acquirePollPermit()
        if (!permit.allowed) return
        heartbeatInFlight = true
        void persistHeartbeat(workerState).then((payload) => {
          controller.recordProbeSuccess(
            Number(payload.backgroundRequestLatencyMs ?? 0))
        }).catch((heartbeatError) => {
          claimAuthorityGranted = false
          const requestError = heartbeatError as Error & {
            httpStatus?: number
            latencyMs?: number
          }
          controller.recordFailure({
            httpStatus: requestError.httpStatus,
            errorCode: requestError.message,
            latencyMs: requestError.latencyMs,
          })
        }).finally(() => { heartbeatInFlight = false })
      }, SELLER_OS_BACKGROUND_HEARTBEAT_INTERVAL_MS)
      if (gateOnly) {
        setState("Worker Research V2 disponible · gate de control activo")
        await new Promise<void>((resolve) => {
          leadershipAbort.signal.addEventListener("abort", () => resolve(),
            { once: true })
        })
        return
      }
      const maximumPlans = autonomous ? 4 : 1
      let completed = 0
      const pollStartedAt = performance.now()
      const permit = controller.acquirePollPermit()
      if (!permit.allowed || !claimAuthorityGranted) {
        controller.suppressDuplicatePoll()
      } else for (; completed < maximumPlans; completed += 1) {
        if (completed > 0) heartbeat = await persistHeartbeat("IDLE")
        const claimPayload = await authorizedPost({
          action: "CLAIM_AUTONOMOUS_RESEARCH_PLAN", workerId,
          leaderSessionId,
          ...(planId ? { planId } : {}),
          workerCapability: {
            handshakeStatus: "PASS", workerCapability: "PASS",
            extensionIdentityMatch:
              probe.extensionId === probe.bridgeExtensionId,
            extensionId: probe.extensionId,
            extensionVersion: probe.extensionVersion,
            observedAt: heartbeat.observedAt,
            heartbeatReceiptId: heartbeat.heartbeatReceiptId,
            heartbeatSource: heartbeat.heartbeatSource,
            cookieAccess: probe.cookieAccess,
            marketplaceWrites: probe.marketplaceWrites,
          },
        })
        const claim = claimPayload.result as JsonRecord
        if (claim.suppressedDuplicatePoll === true) {
          controller.suppressDuplicatePoll()
          break
        }
        if (claim.claimed !== true) {
          controller.recordEmptyPoll(performance.now() - pollStartedAt)
          break
        }
        controller.recordClaimedJobs(1,
          Number(claimPayload.backgroundRequestLatencyMs ?? 0))
        workerState = "WORKING"
        heartbeat = await persistHeartbeat("WORKING")
        const claimedPlanId = String(claim.planId ?? "")
        try {
          const claimedPlan = claim.plan && typeof claim.plan === "object"
            ? claim.plan as JsonRecord : {}
          const plan = buildEbayOneClickResearchPlan(claim.plan as never)
          const lease = buildEbayOneClickResearchLease({
            sessionId: crypto.randomUUID(),
          })
          for (const task of plan.tasks) {
            setState(`Investigando comparables vendidos en eBay · ${completed + 1}/${maximumPlans}…`)
            const captured = await extensionCommand<{
              success: true
              extensionId: string
              extensionVersion: string
              productResearchCapture: JsonRecord
              mainSearchSoldRows: JsonRecord[]
              pagesCaptured?: number
              soldFilterAutomated: boolean
              paginationAutomated: boolean
              cookieAccess: false
              marketplaceWrites: 0
            }>({ type: "IMNOVA_EBAY_ONE_CLICK_RESEARCH_QUERY_V1",
              lease, task, remainingRows: 200 }, 150_000)
            if (captured.cookieAccess !== false ||
                captured.marketplaceWrites !== 0 ||
                captured.extensionId !== probe.extensionId ||
                captured.bridgeExtensionId !== probe.extensionId ||
                captured.soldFilterAutomated !== true ||
                captured.paginationAutomated !== true ||
                !captured.productResearchCapture ||
                !Array.isArray(captured.mainSearchSoldRows)) {
              throw new Error("PRODUCT_RESEARCH_WORKER_RESULT_INVALID")
            }
            const exactPages = Number.isInteger(captured.pagesCaptured) &&
              Number(captured.pagesCaptured) > 0
              ? Number(captured.pagesCaptured)
              : captured.mainSearchSoldRows.length > 60 ? 2 : null
            setState("Guardando evidencia y recalculando mercado…")
            await authorizedPost({ action: "COMPLETE_MARKET_REVALIDATION",
              planId: claimedPlanId, workerId,
              productResearchCapture: captured.productResearchCapture,
              mainSearchSoldRows: captured.mainSearchSoldRows,
              soldFilterAutomated: captured.soldFilterAutomated,
              paginationAutomated: captured.paginationAutomated,
              extensionMarketplaceWrites: captured.marketplaceWrites,
              workerMetrics: { queryCount: plan.tasks.length,
                pagesCaptured: exactPages,
                pagesCapturedMinimum: 1, pagesCapturedMaximum: 2 } })
          }
        } catch (error) {
          workerState = "IDLE"
          await authorizedPost({ action: "RELEASE_AUTONOMOUS_RESEARCH_PLAN",
            workerId, planId: claimedPlanId,
            errorCode: error instanceof Error ? error.message :
              "PRODUCT_RESEARCH_WORKER_FAILED" }).catch(() => undefined)
          if (browserWorkerControl && autonomous) continue
          throw error
        }
        workerState = "IDLE"
        if (!autonomous) break
      }
      if (browserWorkerControl) {
        setState(completed > 0
          ? "Research completado. Buscando trabajo pendiente…"
          : "Worker disponible · sin trabajo pendiente")
        const delayMs = controller.nextDelayMs()
        await new Promise<void>((resolve) => {
          const reload = window.setTimeout(() => {
            if (heartbeatInterval !== null) {
              window.clearInterval(heartbeatInterval)
            }
            window.location.reload()
            resolve()
          }, delayMs)
          leadershipAbort.signal.addEventListener("abort", () => {
            window.clearTimeout(reload)
            if (heartbeatInterval !== null) {
              window.clearInterval(heartbeatInterval)
            }
            resolve()
          }, { once: true })
        })
        return
      }
      if (heartbeatInterval !== null) window.clearInterval(heartbeatInterval)
      setState("Mercado revalidado. Volviendo a Mayel…")
      window.setTimeout(() => window.location.replace(
        autonomous ? safeReturnPath() :
          `/admin/ebay/mayel?marketRevalidation=${planId}`), 900)
      },
    }).catch((error) => {
      if (leadershipAbort.signal.aborted) return
      const requestError = error as Error & {
        httpStatus?: number
        latencyMs?: number
      }
      controller.recordFailure({
        httpStatus: requestError.httpStatus,
        errorCode: requestError.message,
        latencyMs: requestError.latencyMs,
      })
      if (heartbeatInterval !== null) window.clearInterval(heartbeatInterval)
      setFailed(true)
      setState(error instanceof Error ? error.message :
        "No fue posible cerrar la investigación automática.")
      if (browserWorkerControl) {
        window.setTimeout(() => window.location.reload(),
          controller.nextDelayMs())
      } else if (autonomous) {
        window.setTimeout(() => window.location.replace(safeReturnPath()), 4_000)
      }
    })
    return () => {
      leadershipAbort.abort()
      if (heartbeatInterval !== null) window.clearInterval(heartbeatInterval)
    }
  }, [])

  if (!active) return null
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-[#07111d] px-5 text-slate-100">
    <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b1826] p-7 text-center shadow-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
        Seller OS · Product Research
      </p>
      <h1 className="mt-3 text-2xl font-semibold">
        {failed ? "La revalidación quedó pendiente" : "Revalidando mercado"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">{state}</p>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        Seller OS elige consultas, aplica Sold y pagina automáticamente. No se modifica eBay.
      </p>
      {failed && <a href="/admin/ebay/mayel"
        className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950">
        Volver a Mayel
      </a>}
    </section>
  </div>
}
