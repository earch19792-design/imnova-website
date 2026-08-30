"use client"

import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  LockKeyhole,
  MonitorUp,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"

const ENDPOINT = "/api/admin/ebay/luna-protected-session"
const EXTENSION_BUILD_ID = "LUNA_OWNER_SESSION_HANDOFF_EXTENSION_V1"
const EXTENSION_PROBE = "SELLER_OS_LUNA_OWNER_EXTENSION_PROBE_V1"
const EXTENSION_READY = "SELLER_OS_LUNA_OWNER_EXTENSION_READY_V1"
const EXTENSION_PREPARE = "SELLER_OS_LUNA_OWNER_EXTENSION_PREPARE_V1"
const EXTENSION_PREPARED = "SELLER_OS_LUNA_OWNER_EXTENSION_PREPARED_V1"
const EXTENSION_ENVELOPE =
  "SELLER_OS_LUNA_OWNER_EXTENSION_PAGE_ENVELOPE_V1"

type StatusPayload = {
  success?: boolean
  error?: string
  prerequisites?: {
    lunaProtectedSessionStatus?: string
    canonicalServerReadReadiness?: string
    schemaArtifactStatus?: string
    schemaAppliedStatus?: string
    storageReadiness?: string
    humanBootstrapRequired?: boolean
  }
  browserRuntime?: {
    status?: string
    browserContextActive?: boolean
    browserWorker?: string
    browserVisibleToHuman?: boolean
    profile?: string
    profileReuse?: boolean
    remoteDebuggingPublic?: boolean
  }
  ceremony?: {
    phase?: string
    failureCode?: string | null
    expiresAt?: string
    blockedHost?: string | null
    storedAt?: string | null
    sessionDigest?: string | null
    postLoginHost?: string | null
    postLoginPathClass?: string | null
    authenticatedStateProven?: boolean
  } | null
  operatorAction?: {
    status?: string
    instructionCode?: string | null
    acceptsCallerCredentials?: boolean
    acceptsCallerCookies?: boolean
    browserContextRecoveryRequired?: boolean
    ceremonyStartAllowed?: boolean
    ceremonyReady?: boolean
    csrfReadyForCurrentAdmin?: boolean
    csrfToken?: string | null
    csrfExpiresAt?: string | null
    csrfSingleUse?: boolean | null
    csrfAdminSessionBound?: boolean | null
    csrfCeremonyInstanceBound?: boolean | null
    csrfOriginBound?: boolean | null
    csrfCeremonyStateBound?: boolean | null
    ownerWorkstationHandoffAvailable?: boolean
    ownerWorkstationHandoffRequiresAdmin?: boolean
    ownerWorkstationLongLivedSecretRequired?: boolean
  }
}

type OwnerHandoffChallenge = {
  contractVersion: string
  challengeId: string
  nonce: string
  publicKeyPem: string
  expiresAt: string
  environmentBinding: string
  targetOrigin: string
  uploadPath: string
  oneTime: true
  ownerAdminCreated: true
  plaintextSessionAccepted: false
}

async function adminToken() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  return data.session.access_token
}

export default function LunaProtectedSessionPage() {
  const [payload, setPayload] = useState<StatusPayload | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [ownerHandoffPrepared, setOwnerHandoffPrepared] = useState(false)
  const [extensionReady, setExtensionReady] = useState(false)
  const [extensionVersion, setExtensionVersion] = useState("")
  const transferIdRef = useRef<string | null>(null)
  const extensionAckTimerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const token = await adminToken()
      const response = await fetch(ENDPOINT, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${token}` },
      })
      const result = await response.json() as StatusPayload
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "LUNA_SESSION_STATUS_FAILED")
      }
      setPayload(result)
      setError("")
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message : "LUNA_SESSION_STATUS_FAILED")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!payload?.ceremony || !["LAUNCHING", "AWAITING_HUMAN_LOGIN",
      "COMPLETING"].includes(payload.ceremony.phase ?? "")) return
    const timer = window.setInterval(() => { void refresh() }, 4_000)
    return () => window.clearInterval(timer)
  }, [payload?.ceremony, refresh])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin ||
          !event.data || typeof event.data !== "object" ||
          event.data.buildId !== EXTENSION_BUILD_ID) return
      if (event.data.type === EXTENSION_READY) {
        setExtensionReady(true)
        setExtensionVersion(typeof event.data.version === "string"
          ? event.data.version : "observed")
        return
      }
      if (event.data.type === EXTENSION_PREPARED &&
          event.data.transferId === transferIdRef.current) {
        if (extensionAckTimerRef.current !== null) {
          window.clearTimeout(extensionAckTimerRef.current)
          extensionAckTimerRef.current = null
        }
        setOwnerHandoffPrepared(true)
        setExtensionReady(true)
        return
      }
      if (event.data.type !== EXTENSION_ENVELOPE ||
          event.data.transferId !== transferIdRef.current ||
          !event.data.envelope || typeof event.data.envelope !== "object") return
      transferIdRef.current = null
      setBusy(true)
      setError("")
      void fetch(ENDPOINT, {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event.data.envelope),
      }).then(async (response) => {
        const result = await response.json() as StatusPayload & {
          status?: string
        }
        if (!response.ok || !result.success || result.status !== "SESSION_READY") {
          throw new Error(result.error ?? "LUNA_OWNER_HANDOFF_UPLOAD_REJECTED")
        }
        setOwnerHandoffPrepared(false)
        await refresh()
      }).catch((cause) => {
        setError(cause instanceof Error
          ? cause.message : "LUNA_OWNER_HANDOFF_UPLOAD_REJECTED")
      }).finally(() => setBusy(false))
    }
    window.addEventListener("message", receive)
    window.postMessage({ type: EXTENSION_PROBE }, window.location.origin)
    return () => {
      window.removeEventListener("message", receive)
      if (extensionAckTimerRef.current !== null) {
        window.clearTimeout(extensionAckTimerRef.current)
      }
    }
  }, [refresh])

  const prepareOwnerHandoff = useCallback(async () => {
    setBusy(true)
    setError("")
    setOwnerHandoffPrepared(false)
    try {
      if (!extensionReady) {
        throw new Error("LUNA_OWNER_HANDOFF_EXTENSION_NOT_OBSERVED")
      }
      const csrfToken = payload?.operatorAction?.csrfToken
      if (!csrfToken) throw new Error("LUNA_CEREMONY_CSRF_UNAVAILABLE")
      const token = await adminToken()
      const response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Seller-OS-CSRF": csrfToken,
        },
        body: JSON.stringify({ action: "OWNER_HANDOFF" }),
      })
      const result = await response.json() as StatusPayload & {
        challenge?: OwnerHandoffChallenge
      }
      const challenge = result.challenge
      if (!response.ok || !result.success || !challenge ||
          challenge.oneTime !== true ||
          challenge.ownerAdminCreated !== true ||
          challenge.plaintextSessionAccepted !== false) {
        throw new Error(result.error ?? "LUNA_OWNER_HANDOFF_START_FAILED")
      }
      const transferId = window.crypto.randomUUID()
      transferIdRef.current = transferId
      window.postMessage({
        type: EXTENSION_PREPARE,
        transferId,
        challenge,
      }, window.location.origin)
      extensionAckTimerRef.current = window.setTimeout(() => {
        if (transferIdRef.current === transferId) {
          transferIdRef.current = null
          setError("LUNA_OWNER_HANDOFF_EXTENSION_PREPARE_TIMEOUT")
        }
      }, 2_500)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message : "LUNA_OWNER_HANDOFF_START_FAILED")
    } finally {
      setBusy(false)
    }
  }, [extensionReady, payload?.operatorAction?.csrfToken, refresh])

  const status = payload?.prerequisites
  const phase = payload?.ceremony?.phase ?? "NOT_STARTED"
  const configured = status?.lunaProtectedSessionStatus === "SESSION_READY"
  const browserContextActive =
    payload?.browserRuntime?.browserContextActive === true

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin/ebay/operational-readiness"
          className="inline-flex items-center gap-2 text-xs font-bold text-cyan-800">
          <ArrowLeft size={14} /> Operational Readiness
        </Link>
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <LockKeyhole className="text-cyan-700" />
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                Seller OS · Luna protected session
              </p>
              <h1 className="text-2xl font-black">Renovación owner desde Chrome</h1>
            </div>
          </div>

          {error && <div className="mt-5 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            <CircleX size={18} className="shrink-0" /> {error}
          </div>}

          {!payload ? <p className="mt-5 text-sm text-slate-500">
            Leyendo estado seguro…
          </p> : <div className="mt-6 space-y-5">
            <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Session</dt>
                <dd className="font-black">{status?.lunaProtectedSessionStatus}</dd></div>
              <div><dt className="text-slate-500">Server read</dt>
                <dd className="font-black">{status?.canonicalServerReadReadiness}</dd></div>
              <div><dt className="text-slate-500">Vault schema</dt>
                <dd className="font-black">{status?.schemaAppliedStatus}</dd></div>
              <div><dt className="text-slate-500">Browser worker</dt>
                <dd className="font-black">{payload.browserRuntime?.status}</dd></div>
              <div><dt className="text-slate-500">Browser context</dt>
                <dd className="font-black">{browserContextActive
                  ? "ACTIVE" : "ABSENT"}</dd></div>
              <div><dt className="text-slate-500">Ceremony</dt>
                <dd className="font-black">{phase}</dd></div>
              <div><dt className="text-slate-500">Profile</dt>
                <dd className="font-black">{payload.browserRuntime?.profile}</dd></div>
            </dl>

            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-5">
              <h2 className="font-black text-cyan-950">Flujo humano seguro</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-cyan-950">
                <li>Abre Luna en tu Chrome normal y confirma que ya estás conectada.</li>
                <li>Vuelve aquí y prepara un challenge de un solo uso.</li>
                <li>Abre la extensión owner-only y pulsa “Transferir sesión a Seller OS”.</li>
                <li>Seller OS valida la sesión y confirma <strong>SESSION_READY</strong>.</li>
              </ol>
            </div>

            {status?.humanBootstrapRequired === true &&
              payload.browserRuntime?.status !== "READY" &&
              payload.operatorAction?.ownerWorkstationHandoffAvailable === true &&
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 text-violet-950">
                <h2 className="font-black">Luna necesita volver a iniciar sesión</h2>
                <p className="mt-2 text-sm leading-6">
                  La extensión usa la sesión ya autenticada de Chrome normal.
                  No abre un navegador, no navega Luna y cifra en memoria antes
                  de que el material salga de la workstation.
                </p>
                <p className="mt-3 text-sm font-black">
                  Extensión owner: {extensionReady
                    ? `OBSERVED · ${extensionVersion}` : "NO OBSERVADA"}
                </p>
                <button type="button" disabled={busy ||
                    !extensionReady ||
                    payload.operatorAction?.csrfReadyForCurrentAdmin !== true}
                  onClick={() => { void prepareOwnerHandoff() }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-800 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                  <MonitorUp size={18} /> Renovar sesión
                </button>
                {ownerHandoffPrepared && <div className="mt-4 rounded-lg bg-white p-4 text-sm">
                  <p className="font-black">Challenge fresco recibido por la extensión.</p>
                  <p className="mt-2">Mantén una sola pestaña Luna autenticada,
                    abre el icono <strong>Seller OS — Luna Owner Session Handoff</strong>
                    y pulsa <strong>Transferir sesión a Seller OS</strong>.</p>
                  <p className="mt-2">Chrome solicitará acceso temporal sólo a
                    Luna y la extensión lo revocará al terminar.</p>
                </div>}
              </div>}

            {payload.ceremony?.failureCode &&
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-black">{payload.ceremony.failureCode}</p>
                {payload.ceremony.blockedHost && <p className="mt-1">
                  Host bloqueado para revisión: {payload.ceremony.blockedHost}
                </p>}
              </div>}

            {configured && <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CircleCheck size={18} className="shrink-0" />
              <p>La sesión está almacenada en Vault y la lectura autenticada acotada fue reconocida.</p>
            </div>}

            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy}
                onClick={() => { void refresh() }}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">
                Actualizar estado
              </button>
            </div>

            <div className="flex gap-2 text-sm text-emerald-800">
              <ShieldCheck size={18} className="shrink-0" />
              <p>Vault es el único destino. No hay Playwright, CDP, navegación,
                almacenamiento de sesión, polling ni acciones eBay.</p>
            </div>
          </div>}
        </section>
      </div>
    </main>
  )
}
