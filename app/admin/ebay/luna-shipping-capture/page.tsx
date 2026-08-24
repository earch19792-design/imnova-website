"use client"

import { useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"
import type { LunaChromeShippingJobV1 } from
  "@/lib/ebay/ebay-luna-chrome-shipping-capture-v1"

const PORT_NAME = "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1"
const LUNA_SHIPPING_EXTENSION_ID = "mhpkojahbbfdgodeaecggpjaplllgclk"
const LUNA_SHIPPING_QUOTE_CAPTURE_VERSION = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const EXTENSION_PING = "SELLER_OS_LUNA_SHIPPING_PING"
const EXTENSION_READY = "LUNA_SHIPPING_EXTENSION_READY"

type ExternalPort = {
  postMessage: (message: unknown) => void
  disconnect: () => void
  onMessage: { addListener: (listener: (message: any) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
}

type ChromeRuntime = {
  connect: (extensionId: string, options: { name: string }) => ExternalPort
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (response: any) => void,
  ) => void
  lastError?: { message?: string }
}

declare global {
  interface Window { chrome?: { runtime?: ChromeRuntime } }
}

type Result = {
  candidateId: string
  shippingUsd: number
  economicsStatus: string
  contributionProfitUsd: number | null
  contributionMarginPercent: number | null
}

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
      runtime.sendMessage(LUNA_SHIPPING_EXTENSION_ID, {
        type: EXTENSION_PING,
      }, (response) => {
        const lastError = window.chrome?.runtime?.lastError?.message
        if (lastError) {
          finish(new Error("LUNA_SHIPPING_EXTENSION_DISCONNECTED"))
          return
        }
        if (response?.type !== EXTENSION_READY ||
            response?.extensionId !== LUNA_SHIPPING_EXTENSION_ID ||
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
  const [results, setResults] = useState<Result[]>([])
  const jobsRef = useRef<LunaChromeShippingJobV1[]>([])
  const indexRef = useRef(0)
  const portRef = useRef<ExternalPort | null>(null)

  useEffect(() => {
    let active = true
    const fail = (value: unknown) => {
      if (!active) return
      setStatus("BLOCKED")
      setError(value instanceof Error ? value.message
        : "LUNA_SHIPPING_CAPTURE_FAILED")
    }
    const start = async () => {
      if (!window.chrome?.runtime?.connect ||
          !window.chrome.runtime.sendMessage) {
        throw new Error("LUNA_SHIPPING_EXTENSION_NOT_INSTALLED")
      }
      setStatus("PINGING_EXTENSION")
      await pingExtension(window.chrome.runtime)
      setStatus("EXTENSION_CONNECTED")
      if (new URLSearchParams(window.location.search)
          .get("runShipping") !== "1") return
      const requestedCandidate = new URLSearchParams(window.location.search)
        .get("candidateId")
      const payload = await adminPost("resolve_jobs", {
        candidateIds: requestedCandidate ? [requestedCandidate] : undefined,
      })
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : []
      if (!jobs.length || jobs.some((job: any) =>
        job?.contractVersion !== LUNA_SHIPPING_QUOTE_CAPTURE_VERSION)) {
        throw new Error("LUNA_SHIPPING_EXTENSION_JOB_UNAVAILABLE")
      }
      jobsRef.current = jobs
      const port = window.chrome.runtime.connect(LUNA_SHIPPING_EXTENSION_ID,
        { name: PORT_NAME })
      portRef.current = port
      const sendCurrent = () => {
        const job = jobsRef.current[indexRef.current]
        if (!job) {
          setStatus("COMPLETED")
          return
        }
        setStatus(indexRef.current === 0 ? "RUNNING_CANARY" : "RUNNING_NEXT")
        port.postMessage({ type: "START_SHIPPING_JOB", job })
      }
      port.onMessage.addListener((message) => {
        if (!active || message?.type !== "LUNA_SHIPPING_JOB_RESULT") return
        const job = jobsRef.current[indexRef.current]
        if (!job || message.capture?.candidateId !== job.identity.candidateId) {
          fail(new Error("LUNA_SHIPPING_EXTENSION_RESULT_SCOPE_MISMATCH"))
          return
        }
        if (message.success !== true) {
          fail(new Error(typeof message.error === "string"
            ? message.error : "LUNA_SHIPPING_EXTENSION_JOB_FAILED"))
          return
        }
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
        void adminPost("certify_capture", { capture },
          capture.captureSessionId)
          .then((certified) => {
            const economics = certified.result?.economics ?? {}
            setResults((current) => [...current, {
              candidateId: job.identity.candidateId,
              shippingUsd: Number(certified.result.capture.shippingUsd),
              economicsStatus: String(economics.status ?? "UNPROVEN"),
              contributionProfitUsd: economics.contributionProfitUsd ?? null,
              contributionMarginPercent:
                economics.contributionMarginPercent ?? null,
            }])
            indexRef.current += 1
            sendCurrent()
          }).catch(fail)
      })
      port.onDisconnect.addListener(() => {
        if (active && indexRef.current < jobsRef.current.length) {
          fail(new Error("LUNA_SHIPPING_EXTENSION_DISCONNECTED"))
        }
      })
      sendCurrent()
    }
    void start().catch(fail)
    return () => {
      active = false
      portRef.current?.disconnect()
      portRef.current = null
    }
  }, [])

  return <main className="min-h-screen bg-[#07111a] px-4 py-10 text-white">
    <section className="mx-auto max-w-2xl rounded-3xl border border-white/15 bg-white/[0.05] p-6">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100">Seller OS · Luna shipping</p>
      <h1 className="mt-3 text-2xl font-black">Captura automática de envío</h1>
      <p className="mt-2 text-sm text-white/65">La extensión usa únicamente la sesión normal ya autenticada de Chrome. No lee cookies, credenciales ni almacenamiento del navegador y nunca completa una compra.</p>
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-widest text-white/50">Estado</p>
        <p className="mt-2 text-lg font-black">{status}</p>
        {error && <code className="mt-3 block break-all text-sm text-rose-100">{error}</code>}
      </div>
      {results.map((result) => <dl key={result.candidateId} className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-emerald-200/20 p-4 text-sm">
        <div className="col-span-2"><dt className="text-white/50">Candidato</dt><dd className="break-all font-bold">{result.candidateId}</dd></div>
        <div><dt className="text-white/50">Envío</dt><dd>${result.shippingUsd.toFixed(2)}</dd></div>
        <div><dt className="text-white/50">Economía</dt><dd>{result.economicsStatus}</dd></div>
        <div><dt className="text-white/50">Contribución</dt><dd>{result.contributionProfitUsd === null ? "N/D" : `$${result.contributionProfitUsd.toFixed(2)}`}</dd></div>
        <div><dt className="text-white/50">Margen</dt><dd>{result.contributionMarginPercent === null ? "N/D" : `${result.contributionMarginPercent.toFixed(2)}%`}</dd></div>
      </dl>)}
    </section>
  </main>
}
