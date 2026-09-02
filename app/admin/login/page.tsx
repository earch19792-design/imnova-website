"use client"

import { useEffect, useState } from "react"

import { signInSellerOs } from "@/lib/admin-auth"
import { getSafeAdminReturnPath } from "@/lib/admin-auth-return"
import {
  REMOTE_LIVE_OPERATOR_USERNAME_MAX_LENGTH,
  REMOTE_LIVE_OPERATOR_USERNAME_MIN_LENGTH,
} from "@/lib/remote-live-operator-identity"

const ADMIN_SESSION_ESTABLISH_TIMEOUT_MS = 20_000
const REMOTE_PASSWORD_MIN_LENGTH = 12

type LoginPhase =
  | "IDLE"
  | "CREATING_ACCOUNT"
  | "AUTHENTICATING"
  | "ESTABLISHING_SESSION"
  | "OPENING_DASHBOARD"

async function establishProtectedAdminSession(accessToken: string) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    ADMIN_SESSION_ESTABLISH_TIMEOUT_MS,
  )
  try {
    return await fetch("/api/admin/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("admin_session_establishment_timeout")
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

function loginErrorMessage(error: unknown) {
  if (error instanceof Error &&
      error.message === "admin_session_establishment_timeout") {
    return "La sesión segura tardó demasiado. Vuelve a intentarlo en unos segundos."
  }
  return error instanceof Error && error.message
    ? error.message
    : "No se pudo conectar para validar el acceso."
}

function enrollmentErrorMessage(code: unknown) {
  if (code === "REMOTE_OPERATOR_ALREADY_CONFIGURED") {
    return "El alta inicial ya fue utilizada. Inicia sesión con el usuario creado."
  }
  if (code === "REMOTE_OPERATOR_INVITATION_INVALID_OR_EXPIRED" ||
      code === "REMOTE_OPERATOR_INVITATION_INVALID") {
    return "La invitación venció o no es válida. Pide al owner una nueva invitación."
  }
  if (code === "REMOTE_OPERATOR_USERNAME_INVALID") {
    return "Usa entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo."
  }
  if (code === "REMOTE_OPERATOR_DISPLAY_NAME_INVALID") {
    return "Escribe el nombre que quieres ver dentro de Seller OS."
  }
  if (code === "REMOTE_OPERATOR_PASSWORD_POLICY_NOT_MET") {
    return `La contraseña debe tener al menos ${REMOTE_PASSWORD_MIN_LENGTH} caracteres.`
  }
  return "No pude crear el acceso. No se guardó ninguna contraseña en Seller OS."
}

export default function AdminLoginPage() {
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [setupInvitation, setSetupInvitation] = useState<string | null>(null)
  const [setupHydrated, setSetupHydrated] = useState(false)
  const [setupDisplayName, setSetupDisplayName] = useState("")
  const [setupUsername, setSetupUsername] = useState("")
  const [setupPassword, setSetupPassword] = useState("")
  const [setupPasswordConfirmation, setSetupPasswordConfirmation] =
    useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [loginPhase, setLoginPhase] = useState<LoginPhase>("IDLE")

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    const invitation = hash.get("remoteSetup")
    if (invitation) {
      setSetupInvitation(invitation)
      window.history.replaceState(null, "",
        `${window.location.pathname}${window.location.search}`)
    }
    const reason = new URLSearchParams(window.location.search).get("authError")
    if (reason === "ADMIN_AUTH_TEMPORARILY_UNAVAILABLE") {
      setError("La validación tardó demasiado. Tu sesión no fue borrada; vuelve a intentarlo en unos segundos.")
    }
    setSetupHydrated(true)
  }, [])

  async function openSellerOs(loginIdentifier: string, loginPassword: string) {
    setLoginPhase("AUTHENTICATING")
    const result = await signInSellerOs(loginIdentifier, loginPassword)
    if (!result.authorized) {
      throw new Error(result.error || "Usuario o contraseña incorrectos.")
    }
    if (!result.session?.access_token) {
      throw new Error("No se pudo establecer la sesión segura.")
    }
    setLoginPhase("ESTABLISHING_SESSION")
    const sessionResponse = await establishProtectedAdminSession(
      result.session.access_token,
    )
    if (!sessionResponse.ok) {
      const response = await sessionResponse.json().catch(() => null) as
        { error?: unknown } | null
      throw new Error(response?.error === "admin_session_validation_timeout"
        ? "La validación tardó demasiado. Vuelve a intentarlo en unos segundos."
        : "No se pudo proteger la sesión.")
    }
    const returnTo = getSafeAdminReturnPath(
      new URLSearchParams(window.location.search).get("returnTo"),
    )
    setLoginPhase("OPENING_DASHBOARD")
    window.location.replace(returnTo)
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    setIsLoading(true)
    try {
      await openSellerOs(identifier.trim(), password)
    } catch (loginError) {
      setError(loginErrorMessage(loginError))
    } finally {
      setIsLoading(false)
      setLoginPhase("IDLE")
    }
  }

  async function handleFirstEnrollment(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    if (setupPassword !== setupPasswordConfirmation) {
      setError("Las contraseñas no coinciden.")
      return
    }
    if (setupPassword.length < REMOTE_PASSWORD_MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${REMOTE_PASSWORD_MIN_LENGTH} caracteres.`)
      return
    }
    if (!setupInvitation) return
    setIsLoading(true)
    setLoginPhase("CREATING_ACCOUNT")
    let accountCreated = false
    try {
      const response = await fetch(
        "/api/admin/remote-live-operator-enrollment",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitation: setupInvitation,
            displayName: setupDisplayName, username: setupUsername,
            password: setupPassword }),
        },
      )
      const payload = await response.json().catch(() => null) as
        Record<string, unknown> | null
      if (!response.ok || payload?.accountCreated !== true) {
        setError(enrollmentErrorMessage(payload?.error))
        if (payload?.enrollmentClosed === true) setSetupInvitation(null)
        return
      }
      accountCreated = true
      await openSellerOs(setupUsername, setupPassword)
    } catch (setupError) {
      if (accountCreated) {
        setIdentifier(setupUsername)
        setPassword("")
        setSetupPassword("")
        setSetupPasswordConfirmation("")
        setSetupInvitation(null)
        setError("Tu cuenta quedó creada. Inicia sesión con el usuario y contraseña que elegiste.")
      } else {
        setError(loginErrorMessage(setupError))
      }
    } finally {
      setIsLoading(false)
      setLoginPhase("IDLE")
    }
  }

  if (!setupHydrated) return <main
    className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
    <p className="text-sm font-black text-white/60">Preparando acceso seguro…</p>
  </main>

  const firstEnrollment = Boolean(setupInvitation)
  return <main className="flex min-h-screen items-center justify-center bg-black px-5 py-8 sm:px-6">
    <div className="w-full max-w-md rounded-[32px] border border-cyan-400/10 bg-white/[0.03] p-6 shadow-[0_0_80px_rgba(0,255,255,0.08)] backdrop-blur-2xl sm:p-8">
      <header className="mb-7 text-center">
        <p className="text-xs font-black uppercase tracking-[0.35em] text-cyan-300">Seller OS</p>
        <h1 className="mt-4 text-3xl font-black leading-tight text-white sm:text-4xl">
          {firstEnrollment ? "CREA TU ACCESO" : "ACCESO A SELLER OS"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-400">
          {firstEnrollment
            ? "Esta invitación permite crear una sola cuenta de asistente. Elige tu usuario y contraseña; después el alta quedará cerrada."
            : "Acceso privado para owner y asistente autorizada. No existe registro público."}
        </p>
      </header>

      {firstEnrollment ? <form onSubmit={handleFirstEnrollment}
        className="space-y-4" data-remote-first-enrollment>
        <label className="block text-sm font-bold text-white/70">
          Tu nombre
          <input type="text" autoComplete="name" required maxLength={50}
            value={setupDisplayName}
            onChange={(event) => setSetupDisplayName(event.target.value)}
            placeholder="Como quieres que te saludemos"
            className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-white outline-none focus:border-cyan-200/50" />
        </label>
        <label className="block text-sm font-bold text-white/70">
          Usuario
          <input type="text" autoComplete="username" required
            minLength={REMOTE_LIVE_OPERATOR_USERNAME_MIN_LENGTH}
            maxLength={REMOTE_LIVE_OPERATOR_USERNAME_MAX_LENGTH}
            value={setupUsername}
            onChange={(event) => setSetupUsername(event.target.value)}
            placeholder="Tu usuario"
            className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-white outline-none focus:border-cyan-200/50" />
        </label>
        <p className="text-xs leading-5 text-white/40">3–32 caracteres: letras, números, punto, guion o guion bajo.</p>
        <label className="block text-sm font-bold text-white/70">
          Contraseña
          <input type="password" autoComplete="new-password" required
            minLength={REMOTE_PASSWORD_MIN_LENGTH}
            value={setupPassword}
            onChange={(event) => setSetupPassword(event.target.value)}
            placeholder="Mínimo 12 caracteres"
            className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-white outline-none focus:border-cyan-200/50" />
        </label>
        <label className="block text-sm font-bold text-white/70">
          Repite la contraseña
          <input type="password" autoComplete="new-password" required
            minLength={REMOTE_PASSWORD_MIN_LENGTH}
            value={setupPasswordConfirmation}
            onChange={(event) => setSetupPasswordConfirmation(
              event.target.value)}
            placeholder="Repite tu contraseña"
            className="mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-white outline-none focus:border-cyan-200/50" />
        </label>
        {error && <p className="rounded-xl border border-red-300/15 bg-red-300/[0.05] p-3 text-sm font-bold leading-5 text-red-300" aria-live="polite">{error}</p>}
        <button type="submit" disabled={isLoading}
          className="min-h-12 w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-60">
          {isLoading ? loginPhase === "CREATING_ACCOUNT"
            ? "Creando acceso…" : "Abriendo Seller OS…"
            : "CREAR MI ACCESO"}
        </button>
        <p className="text-center text-xs leading-5 text-white/40">Tu contraseña viaja directamente al servicio de autenticación server-side y no se muestra al owner.</p>
      </form> : <form onSubmit={handleLogin} className="space-y-5">
        <input type="text" autoComplete="username" placeholder="Email o usuario"
          required value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          className="min-h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-white outline-none focus:border-cyan-200/50" />
        <input type="password" autoComplete="current-password"
          placeholder="Contraseña" required value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="min-h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-white outline-none focus:border-cyan-200/50" />
        {error && <p className="rounded-xl border border-red-300/15 bg-red-300/[0.05] p-3 text-sm font-bold leading-5 text-red-300" aria-live="polite">{error}</p>}
        <button type="submit" disabled={isLoading}
          className="min-h-12 w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-60">
          {isLoading ? loginPhase === "ESTABLISHING_SESSION"
            ? "Protegiendo sesión..." : loginPhase === "OPENING_DASHBOARD"
              ? "Abriendo Seller OS..." : "Validando credenciales..."
            : "ENTRAR AL SISTEMA"}
        </button>
      </form>}
    </div>
  </main>
}
