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

function safeReturnPath() {
  const value = new URLSearchParams(window.location.search).get("returnTo")
  return value && /^\/admin(?:\/|$)/.test(value) && !value.startsWith("//")
    ? value : "/admin/ebay/mayel"
}

async function authorizedPost(body: JsonRecord) {
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
  const payload = await response.json() as JsonRecord
  if (!response.ok || payload.success !== true) {
    throw new Error(typeof payload.error === "string" ? payload.error :
      "MARKET_REVALIDATION_REQUEST_FAILED")
  }
  return payload
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
    if ((!planId && !autonomous) || started.current) return
    started.current = true
    setActive(true)
    void (async () => {
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
      const workerId = `product-research-browser:${crypto.randomUUID()}`
      const maximumPlans = autonomous ? 4 : 1
      let completed = 0
      for (; completed < maximumPlans; completed += 1) {
        const capabilityObservedAt = new Date().toISOString()
        const claimPayload = await authorizedPost({
          action: "CLAIM_AUTONOMOUS_RESEARCH_PLAN", workerId,
          ...(planId ? { planId } : {}),
          workerCapability: {
            handshakeStatus: "PASS", workerCapability: "PASS",
            extensionIdentityMatch:
              probe.extensionId === probe.bridgeExtensionId,
            extensionId: probe.extensionId,
            extensionVersion: probe.extensionVersion,
            observedAt: capabilityObservedAt,
            cookieAccess: probe.cookieAccess,
            marketplaceWrites: probe.marketplaceWrites,
          },
        })
        const claim = claimPayload.result as JsonRecord
        if (claim.claimed !== true) break
        const claimedPlanId = String(claim.planId ?? "")
        try {
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
          await authorizedPost({ action: "RELEASE_AUTONOMOUS_RESEARCH_PLAN",
            workerId, planId: claimedPlanId,
            errorCode: error instanceof Error ? error.message :
              "PRODUCT_RESEARCH_WORKER_FAILED" }).catch(() => undefined)
          throw error
        }
        if (!autonomous) break
      }
      setState("Mercado revalidado. Volviendo a Mayel…")
      window.setTimeout(() => window.location.replace(
        autonomous ? safeReturnPath() :
          `/admin/ebay/mayel?marketRevalidation=${planId}`), 900)
    })().catch((error) => {
      setFailed(true)
      setState(error instanceof Error ? error.message :
        "No fue posible cerrar la investigación automática.")
    })
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
