"use client"

import { useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"
import type { LunaChromeShippingJobV1 } from
  "@/lib/ebay/ebay-luna-chrome-shipping-capture-v1"

const PORT_NAME = "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1"
const EXTENSION_ID = "mhpkojahbbfdgodeaecggpjaplllgclk"
const CONTRACT = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const EXTENSION_PING = "SELLER_OS_LUNA_SHIPPING_PING"
const EXTENSION_READY = "LUNA_SHIPPING_EXTENSION_READY"
const CANARY_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60"
const CANARY_NAME = "5-in-1 Microcurrent Facial Device for Skin Tightening & Lifting"

type ExternalPort = {
  postMessage: (message: unknown) => void
  disconnect: () => void
  onMessage: { addListener: (listener: (message: any) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
}

type ChromeRuntime = {
  connect: (extensionId: string, options: { name: string }) => ExternalPort
  sendMessage: (extensionId: string, message: unknown,
    callback: (response: any) => void) => void
  lastError?: { message?: string }
}

declare global {
  interface Window { chrome?: { runtime?: ChromeRuntime } }
}

type Result = {
  candidateId: string
  productName: string
  subtotalUsd: number
  shippingUsd: number
  totalUsd: number
  identityVerified: boolean
  capturePostAccepted: boolean
  captureResultDurable: boolean
  durableReadbackMatch: boolean
  economicsStatus: string
  contributionProfitUsd: number | null
  contributionMarginPercent: number | null
}

type RuntimeTrace = {
  authClassification: string
  noExplicitAuthFailure: boolean
  productIdentityVerified: boolean
  addToCartElementFound: boolean
  addToCartClickDispatched: boolean
  cartMutationConfirmed: boolean
  authenticatedOperationConfirmed: boolean
}

const EMPTY_RUNTIME_TRACE: RuntimeTrace = Object.freeze({
  authClassification: "NOT_CHECKED",
  noExplicitAuthFailure: false,
  productIdentityVerified: false,
  addToCartElementFound: false,
  addToCartClickDispatched: false,
  cartMutationConfirmed: false,
  authenticatedOperationConfirmed: false,
})

async function adminPost(action: string, body: Record<string, unknown>,
  idempotencyKey?: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("LUNA_SHIPPING_ADMIN_SESSION_REQUIRED")
  const response = await fetch("/api/admin/ebay/luna-shipping-capture", {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: JSON.stringify({ action, ...body }),
  })
  const payload = await response.json() as any
  if (!response.ok || !payload.success) {
    throw new Error(typeof payload.error === "string"
      ? payload.error : "LUNA_SHIPPING_CAPTURE_REQUEST_FAILED")
  }
  return payload
}

function pingExtension(runtime: ChromeRuntime) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error("LUNA_SHIPPING_EXTENSION_PING_TIMEOUT"))
    }, 5_000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    }
    try {
      runtime.sendMessage(EXTENSION_ID, { type: EXTENSION_PING }, (response) => {
        if (window.chrome?.runtime?.lastError?.message) {
          finish(new Error("LUNA_SHIPPING_EXTENSION_DISCONNECTED"))
          return
        }
        if (response?.type !== EXTENSION_READY ||
            response?.extensionId !== EXTENSION_ID ||
            response?.sellerOsOriginValidated !== true) {
          finish(new Error("LUNA_SHIPPING_EXTENSION_HANDSHAKE_INVALID"))
          return
        }
        finish()
      })
    } catch {
      finish(new Error("LUNA_SHIPPING_EXTENSION_DISCONNECTED"))
    }
  })
}

export default function LunaShippingCapturePage() {
  const [status, setStatus] = useState("CONNECTING_EXTENSION")
  const [error, setError] = useState("")
  const [connected, setConnected] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRuntimeState, setLastRuntimeState] = useState("NOT_STARTED")
  const [runtimeTrace, setRuntimeTrace] = useState<RuntimeTrace>(EMPTY_RUNTIME_TRACE)
  const [results, setResults] = useState<Result[]>([])
  const triggerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let active = true
    let jobs: LunaChromeShippingJobV1[] = []
    let index = 0
    let mode: "CANARY" | "AUTO" = "CANARY"
    let busy = false
    let extensionReady = false
    let port: ExternalPort | null = null

    const fail = (value: unknown) => {
      if (!active) return
      busy = false
      setRunning(false)
      setStatus("FAIL")
      setError(value instanceof Error ? value.message
        : "LUNA_SHIPPING_CAPTURE_FAILED")
    }

    const sendCurrent = () => {
      const job = jobs[index]
      if (!job || !port) return
      setStatus(mode === "CANARY" && index === 0
        ? "CANARY_DISPATCHED" : "CAPTURING")
      setLastRuntimeState("CANARY_DISPATCHED")
      port.postMessage({ type: "START_SHIPPING_JOB", job })
      window.setTimeout(() => {
        if (active && busy) setStatus("CAPTURING")
      }, 0)
    }

    const loadJobs = async (candidateIds: readonly string[] | undefined,
      nextMode: "CANARY" | "AUTO") => {
      const payload = await adminPost("resolve_jobs", { candidateIds })
      const resolved = Array.isArray(payload.jobs) ? payload.jobs : []
      if (resolved.some((job: any) => job?.contractVersion !== CONTRACT)) {
        throw new Error("LUNA_SHIPPING_EXTENSION_JOB_UNAVAILABLE")
      }
      if (!resolved.length) {
        busy = false
        setRunning(false)
        setStatus("PASS")
        return
      }
      jobs = resolved
      index = 0
      mode = nextMode
      busy = true
      setRunning(true)
      sendCurrent()
    }

    const beginCanary = () => {
      if (busy || !extensionReady) return
      setError("")
      setResults([])
      setLastRuntimeState("CANARY_DISPATCHED")
      setRuntimeTrace(EMPTY_RUNTIME_TRACE)
      void loadJobs([CANARY_ID], "CANARY").catch(fail)
    }
    triggerRef.current = beginCanary

    const start = async () => {
      const runtime = window.chrome?.runtime
      if (!runtime?.connect || !runtime.sendMessage) {
        throw new Error("LUNA_SHIPPING_EXTENSION_NOT_INSTALLED")
      }
      setStatus("PINGING_EXTENSION")
      await pingExtension(runtime)
      if (!active) return
      extensionReady = true
      setConnected(true)
      setStatus("EXTENSION_CONNECTED")
      port = runtime.connect(EXTENSION_ID, { name: PORT_NAME })
      port.onMessage.addListener((message) => {
        if (!active) return
        if (message?.type === "LUNA_SHIPPING_JOB_PROGRESS") {
          const allowed = new Set(["CONTENT_SCRIPT_LOADED",
            "ACTIVE_JOB_REQUESTED", "ACTIVE_JOB_RECOVERED",
            "PRODUCT_PAGE_DOM_READY", "PRODUCT_IDENTITY_CHECK_STARTED",
            "AUTH_EXPLICITLY_FAILED", "AUTH_CHALLENGE_PRESENT",
            "AUTH_NOT_YET_REQUIRED", "AUTHENTICATED_OPERATION_CONFIRMED",
            "PRODUCT_IDENTITY_VERIFIED", "ADD_TO_CART_ELEMENT_FOUND",
            "ADD_TO_CART_CLICK_DISPATCHED", "CART_MUTATION_CONFIRMED",
            "SHIPPING_CAPTURE_STARTED", "RESULT_POSTED"])
          if (allowed.has(message.state) &&
              message.candidateId === jobs[index]?.identity.candidateId) {
            setStatus(message.state)
            setLastRuntimeState(message.state)
            setRuntimeTrace((current) => ({ ...current,
              ...(message.state.startsWith("AUTH_")
                ? { authClassification: message.state } : {}),
              ...(message.state === "AUTH_NOT_YET_REQUIRED" ||
                  message.state === "AUTHENTICATED_OPERATION_CONFIRMED"
                ? { noExplicitAuthFailure: true } : {}),
              ...(message.state === "PRODUCT_IDENTITY_VERIFIED"
                ? { productIdentityVerified: true } : {}),
              ...(message.state === "ADD_TO_CART_ELEMENT_FOUND"
                ? { addToCartElementFound: true } : {}),
              ...(message.state === "ADD_TO_CART_CLICK_DISPATCHED"
                ? { addToCartClickDispatched: true } : {}),
              ...(message.state === "CART_MUTATION_CONFIRMED"
                ? { cartMutationConfirmed: true } : {}),
              ...(message.state === "AUTHENTICATED_OPERATION_CONFIRMED"
                ? { authenticatedOperationConfirmed: true } : {}),
            }))
          }
          return
        }
        if (!active || message?.type !== "LUNA_SHIPPING_JOB_RESULT") return
        const job = jobs[index]
        if (!job || message.capture?.candidateId !== job.identity.candidateId) {
          fail(new Error("LUNA_SHIPPING_EXTENSION_RESULT_SCOPE_MISMATCH"))
          return
        }
        if (message.success !== true) {
          if (typeof message.lastRuntimeState === "string") {
            setLastRuntimeState(message.lastRuntimeState)
          }
          fail(new Error(typeof message.error === "string"
            ? message.error : "LUNA_SHIPPING_EXTENSION_JOB_FAILED"))
          return
        }
        setStatus("RESULT_POSTED")
        const capture = {
          candidateId: message.capture.candidateId,
          lunaProductId: message.capture.lunaProductId,
          lunaVariantId: message.capture.lunaVariantId,
          supplierSku: message.capture.supplierSku,
          quantity: message.capture.quantity,
          subtotalUsd: message.capture.subtotalUsd,
          shippingUsd: message.capture.shippingUsd,
          totalUsd: message.capture.totalUsd,
          currency: message.capture.currency,
          observedAt: message.capture.observedAt,
          acquisitionMethod: message.capture.acquisitionMethod,
          evidenceDigest: message.capture.extensionEvidenceDigest,
          captureSessionId: message.capture.captureSessionId,
          nonce: message.capture.nonce,
        }
        void adminPost("certify_capture", { capture }, capture.captureSessionId)
          .then(async (certified) => {
            if (!active) return
            const result = certified.result ?? {}
            const economics = result.economics ?? {}
            setStatus("RESULT_PERSISTED")
            setResults((current) => [...current, {
              candidateId: job.identity.candidateId,
              productName: String(result.productName ?? job.productName),
              subtotalUsd: Number(result.capture?.subtotalUsd),
              shippingUsd: Number(result.capture?.shippingUsd),
              totalUsd: Number(result.capture?.totalUsd),
              identityVerified: result.quote?.exactLunaIdentity === true,
              capturePostAccepted: result.capturePostAccepted === true,
              captureResultDurable: result.captureResultDurable === true,
              durableReadbackMatch: result.durableReadbackMatch === true,
              economicsStatus: String(economics.status ?? "UNPROVEN"),
              contributionProfitUsd: economics.contributionProfitUsd ?? null,
              contributionMarginPercent:
                economics.contributionMarginPercent ?? null,
            }])
            setStatus("ECONOMICS_EVALUATED")
            index += 1
            if (index < jobs.length) {
              sendCurrent()
              return
            }
            await loadJobs(undefined, "AUTO")
          }).catch(fail)
      })
      port.onDisconnect.addListener(() => {
        if (active && busy) {
          fail(new Error("LUNA_SHIPPING_EXTENSION_DISCONNECTED"))
        }
      })
      const params = new URLSearchParams(window.location.search)
      if (params.get("runShipping") === "1") beginCanary()
    }
    void start().catch(fail)
    return () => {
      active = false
      triggerRef.current = null
      port?.disconnect()
    }
  }, [])

  return <main className="min-h-screen bg-[#07111a] px-4 py-10 text-white">
    <section className="mx-auto max-w-2xl rounded-3xl border border-white/15 bg-white/[0.05] p-6">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100">Seller OS · Luna shipping</p>
      <h1 className="mt-3 text-2xl font-black">Captura automática de envío</h1>
      <p className="mt-2 text-sm text-white/65">La extensión usa la sesión normal ya autenticada de Chrome. No lee cookies ni credenciales y nunca completa una compra.</p>
      <button type="button" disabled={!connected || running}
        onClick={() => triggerRef.current?.()}
        className="mt-6 w-full rounded-2xl bg-cyan-300 px-5 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        Ejecutar canary de shipping
      </button>
      <p className="mt-2 text-xs text-white/50">Certificación inicial: {CANARY_NAME}</p>
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-widest text-white/50">Estado</p>
        <p className="mt-2 text-lg font-black">{status}</p>
        <code className="mt-2 block break-all text-xs text-cyan-100">
          LAST_RUNTIME_STATE={lastRuntimeState}
        </code>
        <code className="mt-2 block whitespace-pre-wrap text-xs text-cyan-100">
          {`AUTH_CLASSIFICATION=${runtimeTrace.authClassification}\n` +
            `NO_EXPLICIT_AUTH_FAILURE=${runtimeTrace.noExplicitAuthFailure}\n` +
            `PRODUCT_IDENTITY_VERIFIED=${runtimeTrace.productIdentityVerified}\n` +
            `ADD_TO_CART_ELEMENT_FOUND=${runtimeTrace.addToCartElementFound}\n` +
            `ADD_TO_CART_CLICK_DISPATCHED=${runtimeTrace.addToCartClickDispatched}\n` +
            `CART_MUTATION_CONFIRMED=${runtimeTrace.cartMutationConfirmed}\n` +
            `AUTHENTICATED_OPERATION_CONFIRMED=${runtimeTrace.authenticatedOperationConfirmed}`}
        </code>
        {error && <code className="mt-3 block break-all text-sm text-rose-100">
          FINAL_BLOCKER={error}
        </code>}
      </div>
      {results.map((result) => <dl key={`${result.candidateId}:${result.shippingUsd}`}
        className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-emerald-200/20 p-4 text-sm">
        <div className="col-span-2"><dt className="text-white/50">Producto</dt><dd className="font-bold">{result.productName}</dd></div>
        <div><dt className="text-white/50">Subtotal</dt><dd>${result.subtotalUsd.toFixed(2)}</dd></div>
        <div><dt className="text-white/50">Envío</dt><dd>${result.shippingUsd.toFixed(2)}</dd></div>
        <div><dt className="text-white/50">Total</dt><dd>${result.totalUsd.toFixed(2)}</dd></div>
        <div><dt className="text-white/50">Identidad</dt><dd>{result.identityVerified ? "VERIFICADA" : "NO PROBADA"}</dd></div>
        <div><dt className="text-white/50">Persistencia</dt><dd>{result.capturePostAccepted && result.captureResultDurable && result.durableReadbackMatch ? "DURABLE" : "NO PROBADA"}</dd></div>
        <div><dt className="text-white/50">Economía</dt><dd>{result.economicsStatus}</dd></div>
        <div><dt className="text-white/50">Contribución</dt><dd>{result.contributionProfitUsd === null ? "N/D" : `$${result.contributionProfitUsd.toFixed(2)}`}</dd></div>
        <div><dt className="text-white/50">Margen</dt><dd>{result.contributionMarginPercent === null ? "N/D" : `${result.contributionMarginPercent.toFixed(2)}%`}</dd></div>
      </dl>)}
    </section>
  </main>
}
