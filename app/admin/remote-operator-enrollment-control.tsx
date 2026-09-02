"use client"

import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type EnrollmentState =
  | "LOADING"
  | "AVAILABLE"
  | "INVITATION_READY"
  | "CONFIGURED"
  | "UNAVAILABLE"

async function ownerEnrollmentRequest(method: "GET" | "POST") {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) {
    throw new Error("OWNER_SESSION_REQUIRED")
  }
  const response = await fetch(
    "/api/admin/remote-live-operator-enrollment",
    {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    },
  )
  const payload = await response.json().catch(() => null) as
    Record<string, unknown> | null
  if (!response.ok || payload?.success !== true) {
    throw new Error(typeof payload?.error === "string"
      ? payload.error : "REMOTE_OPERATOR_ENROLLMENT_UNAVAILABLE")
  }
  return payload
}

export function RemoteOperatorEnrollmentControl() {
  const [state, setState] = useState<EnrollmentState>("LOADING")
  const [setupUrl, setSetupUrl] = useState("")
  const [message, setMessage] = useState("")

  const refresh = useCallback(async () => {
    try {
      const payload = await ownerEnrollmentRequest("GET")
      setState(payload.configured === true ? "CONFIGURED" : "AVAILABLE")
      setMessage("")
    } catch {
      setState("UNAVAILABLE")
      setMessage("No pude comprobar el acceso remoto ahora.")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function createInvitation() {
    setMessage("")
    try {
      const payload = await ownerEnrollmentRequest("POST")
      const url = typeof payload.setupUrl === "string" ? payload.setupUrl : ""
      if (!url) throw new Error("REMOTE_OPERATOR_INVITATION_UNAVAILABLE")
      setSetupUrl(url)
      setState("INVITATION_READY")
      setMessage("Enlace privado listo · vence en 15 minutos.")
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (code === "REMOTE_OPERATOR_ALREADY_CONFIGURED") {
        setState("CONFIGURED")
        setMessage("El acceso remoto ya fue creado. El alta inicial está cerrada.")
      } else {
        setState("UNAVAILABLE")
        setMessage("No pude preparar el acceso remoto ahora. No se creó ninguna cuenta.")
      }
    }
  }

  async function copyInvitation() {
    if (!setupUrl) return
    try {
      await navigator.clipboard.writeText(setupUrl)
      setMessage("Enlace privado copiado. Compártelo sólo con la asistente.")
    } catch {
      setMessage("No pude copiar el enlace. Usa Compartir acceso.")
    }
  }

  async function shareInvitation() {
    if (!setupUrl || !navigator.share) {
      await copyInvitation()
      return
    }
    try {
      await navigator.share({
        title: "Acceso a Seller OS",
        text: "Crea tu acceso remoto de Seller OS. Este enlace vence en 15 minutos y funciona para un único alta.",
        url: setupUrl,
      })
      setMessage("Acceso compartido de forma segura.")
    } catch {
      setMessage("No se compartió el enlace. Puedes volver a intentarlo.")
    }
  }

  return <section className="mt-4 rounded-2xl border border-violet-200/15 bg-black/20 p-4"
    data-remote-operator-enrollment>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-100/60">Acceso de asistente</p>
        <h3 className="mt-1 font-black text-white">
          {state === "CONFIGURED" ? "Acceso remoto creado" :
            "Alta inicial de una sola vez"}
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-white/55">
          {state === "CONFIGURED"
            ? "La asistente ya tiene su usuario. El registro quedó cerrado."
            : "Genera una invitación privada. La asistente elegirá su usuario y contraseña; después no podrá crearse otra cuenta remota."}
        </p>
      </div>
      {state === "LOADING" && <span className="rounded-full border border-white/10 px-3 py-2 text-xs font-black text-white/45">COMPROBANDO</span>}
      {state === "CONFIGURED" && <span className="rounded-full bg-emerald-200 px-3 py-2 text-xs font-black text-emerald-950">CONFIGURADO</span>}
    </div>
    {state === "AVAILABLE" && <button type="button"
      onClick={() => void createInvitation()}
      className="mt-4 min-h-12 rounded-xl bg-violet-200 px-5 text-sm font-black text-violet-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-100">
      CREAR INVITACIÓN PRIVADA
    </button>}
    {state === "INVITATION_READY" && <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <button type="button" onClick={() => void copyInvitation()}
        className="min-h-12 rounded-xl bg-violet-200 px-5 text-sm font-black text-violet-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-100">
        COPIAR ENLACE PRIVADO
      </button>
      <button type="button" onClick={() => void shareInvitation()}
        className="min-h-12 rounded-xl border border-violet-200/30 px-5 text-sm font-black text-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-100">
        COMPARTIR ACCESO
      </button>
    </div>}
    {state === "UNAVAILABLE" && <button type="button"
      onClick={() => void refresh()}
      className="mt-4 min-h-12 rounded-xl border border-white/15 px-5 text-sm font-black text-white/70">
      REINTENTAR
    </button>}
    {message && <p className="mt-3 text-sm font-bold leading-5 text-white/65"
      aria-live="polite">{message}</p>}
  </section>
}
