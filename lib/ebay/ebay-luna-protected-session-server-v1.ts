import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseAdminClient } from "../supabase-admin"
import {
  SELLER_OS_LUNA_PROTECTED_SESSION_VERSION,
  assessSellerOsLunaProtectedSessionV1,
} from "./ebay-luna-automation-prerequisites-v1"

const GET_PROTECTED_SESSION_RPC =
  "get_seller_os_luna_protected_session_v1" as const
const STORE_PROTECTED_SESSION_RPC =
  "store_seller_os_luna_protected_session_v1" as const
const COOKIE_HEADER = /^[^=;\s]+=[^\r\n;]*(?:;\s*[^=;\s]+=[^\r\n;]*)*$/
const MAX_SESSION_LIFETIME_MS = 45 * 24 * 60 * 60 * 1_000
const ACTOR_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LUNA_SESSION_HOSTS = new Set([
  "www.lunaportex.com",
  "account.lunaportex.com",
])
const SESSION_PROBE_ENTRYPOINT = "https://www.lunaportex.com/account"
const SESSION_PROBE_TIMEOUT_MS = 12_000
const SESSION_PROBE_MAX_REDIRECTS = 6

type ProtectedSessionEnvelope = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_PROTECTED_SESSION_VERSION
  cookieHeader: string
  capturedAt: string
  validatedAt: string
  expiresAt: string
}>

function parseProtectedSessionEnvelope(
  value: unknown,
  now: number,
): ProtectedSessionEnvelope | null {
  if (typeof value !== "string" || value.length < 80 || value.length > 12_000) {
    return null
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(value) as Record<string, unknown>
  } catch {
    return null
  }
  if (Object.keys(parsed).sort().join(",") !==
      "capturedAt,contractVersion,cookieHeader,expiresAt,validatedAt" ||
      parsed.contractVersion !== SELLER_OS_LUNA_PROTECTED_SESSION_VERSION ||
      typeof parsed.cookieHeader !== "string" ||
      parsed.cookieHeader.length < 8 || parsed.cookieHeader.length > 8_192 ||
      !COOKIE_HEADER.test(parsed.cookieHeader) ||
      /(?:authorization|bearer|password|cookie\s*:)/i.test(parsed.cookieHeader) ||
      typeof parsed.capturedAt !== "string" ||
      typeof parsed.validatedAt !== "string" ||
      typeof parsed.expiresAt !== "string") {
    return null
  }
  const capturedAt = Date.parse(parsed.capturedAt)
  const validatedAt = Date.parse(parsed.validatedAt)
  const expiresAt = Date.parse(parsed.expiresAt)
  if (![capturedAt, validatedAt, expiresAt].every(Number.isFinite) ||
      capturedAt > validatedAt || validatedAt > now + 5 * 60_000 ||
      expiresAt <= validatedAt ||
      expiresAt - capturedAt > MAX_SESSION_LIFETIME_MS) {
    return null
  }
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_PROTECTED_SESSION_VERSION,
    cookieHeader: parsed.cookieHeader,
    capturedAt: new Date(capturedAt).toISOString(),
    validatedAt: new Date(validatedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  })
}

async function readVaultEnvelope(
  client: Pick<SupabaseClient, "rpc">,
  now: number,
) {
  try {
    const { data, error } = await client.rpc(GET_PROTECTED_SESSION_RPC)
    if (error) return { status: "SOURCE_UNAVAILABLE" as const, envelope: null }
    if (data === null || data === undefined || data === "") {
      return { status: "SESSION_NOT_CONFIGURED" as const, envelope: null }
    }
    const envelope = parseProtectedSessionEnvelope(data, now)
    return envelope
      ? { status: "AVAILABLE" as const, envelope }
      : { status: "AUTH_FAILED" as const, envelope: null }
  } catch {
    return { status: "SOURCE_UNAVAILABLE" as const, envelope: null }
  }
}

export async function resolveServerOwnedLunaSessionValueV1(input: {
  client?: Pick<SupabaseClient, "rpc">
  now?: number
} = {}) {
  let client: Pick<SupabaseClient, "rpc">
  try {
    client = input.client ?? getSupabaseAdminClient()
  } catch {
    return null
  }
  const now = input.now ?? Date.now()
  const result = await readVaultEnvelope(client, now)
  return result.envelope && Date.parse(result.envelope.expiresAt) > now
    ? result.envelope.cookieHeader : null
}

export async function auditSellerOsLunaProtectedSessionV1(input: {
  client?: Pick<SupabaseClient, "rpc">
  now?: string
  vaultSchemaApplied?: boolean
} = {}) {
  const nowText = input.now ?? new Date().toISOString()
  const now = Date.parse(nowText)
  const clientExposed = Boolean(
    process.env.NEXT_PUBLIC_LUNAPORTEX_AUTH_COOKIE?.trim(),
  )
  if (input.vaultSchemaApplied !== true) {
    return assessSellerOsLunaProtectedSessionV1({
      now: nowText,
      secretPresent: false,
      storage: "NONE",
      serverOwned: true,
      clientExposed,
      expiresAt: null,
      validation: "AUTH_REQUIRED",
    })
  }
  let client: Pick<SupabaseClient, "rpc">
  try {
    client = input.client ?? getSupabaseAdminClient()
  } catch {
    return assessSellerOsLunaProtectedSessionV1({
      now: nowText,
      secretPresent: false,
      storage: "SUPABASE_VAULT",
      serverOwned: true,
      clientExposed,
      validation: "SOURCE_UNAVAILABLE",
    })
  }
  const result = await readVaultEnvelope(client, Number.isFinite(now) ? now : 0)
  return assessSellerOsLunaProtectedSessionV1({
    now: nowText,
    secretPresent: Boolean(result.envelope),
    storage: "SUPABASE_VAULT",
    serverOwned: true,
    clientExposed,
    expiresAt: result.envelope?.expiresAt ?? null,
    validation: result.status === "AVAILABLE" ? "VALID"
      : result.status === "AUTH_FAILED" ? "AUTH_FAILED"
      : result.status === "SOURCE_UNAVAILABLE" ? "SOURCE_UNAVAILABLE"
          : "AUTH_REQUIRED",
  })
}

function sessionDigest(value: Buffer | string) {
  return `luna-session-v1:sha256:${createHash("sha256")
    .update(SELLER_OS_LUNA_PROTECTED_SESSION_VERSION, "utf8")
    .update("\u0000", "utf8")
    .update(value)
    .digest("hex")}`
}

export async function storeSellerOsLunaProtectedSessionV1(input: Readonly<{
  actorUserId: string
  sessionPayload: Buffer
  now: string
  client?: Pick<SupabaseClient, "rpc">
}>) {
  const now = Date.parse(input.now)
  if (!ACTOR_UUID.test(input.actorUserId) || !Buffer.isBuffer(input.sessionPayload) ||
      input.sessionPayload.length < 80 || input.sessionPayload.length > 12_000 ||
      !Number.isFinite(now)) {
    throw new Error("LUNA_PROTECTED_SESSION_VAULT_INPUT_INVALID")
  }
  const payloadText = input.sessionPayload.toString("utf8")
  if (!parseProtectedSessionEnvelope(payloadText, now)) {
    throw new Error("LUNA_PROTECTED_SESSION_VAULT_INPUT_INVALID")
  }
  let client: Pick<SupabaseClient, "rpc">
  try { client = input.client ?? getSupabaseAdminClient() } catch {
    throw new Error("LUNA_PROTECTED_SESSION_VAULT_UNAVAILABLE")
  }
  try {
    const { data, error } = await client.rpc(STORE_PROTECTED_SESSION_RPC, {
      p_actor: input.actorUserId,
      p_session_payload: payloadText,
      p_now: new Date(now).toISOString(),
    })
    if (error || data !== true) {
      throw new Error("LUNA_PROTECTED_SESSION_VAULT_WRITE_FAILED")
    }
    return Object.freeze({
      storedAt: new Date(now).toISOString(),
      sessionDigest: sessionDigest(input.sessionPayload),
      storage: "SUPABASE_VAULT" as const,
      serviceRoleOnly: true as const,
      secretReturned: false as const,
    })
  } catch (cause) {
    if (cause instanceof Error &&
        cause.message === "LUNA_PROTECTED_SESSION_VAULT_WRITE_FAILED") {
      throw cause
    }
    throw new Error("LUNA_PROTECTED_SESSION_VAULT_UNAVAILABLE")
  }
}

function safeProbeUrl(value: string, base?: string) {
  let parsed: URL
  try { parsed = new URL(value, base) } catch {
    throw new Error("LUNA_PROTECTED_SESSION_REDIRECT_DENIED")
  }
  if (parsed.protocol !== "https:" || !LUNA_SESSION_HOSTS.has(parsed.hostname) ||
      parsed.username || parsed.password || parsed.port || parsed.hash) {
    throw new Error("LUNA_PROTECTED_SESSION_REDIRECT_DENIED")
  }
  return parsed
}

function postLoginPathClass(url: URL) {
  const path = url.pathname.replace(/\/+$/, "") || "/"
  if (/^\/authentication\/(?:login|oauth\/authorize)$/i.test(path) ||
      /^\/account\/(?:login|signin)$/i.test(path) ||
      /^\/(?:login|signin)$/i.test(path)) {
    return "AUTHENTICATION_REQUIRED" as const
  }
  if (/^\/callback$/i.test(path)) return "AUTH_CALLBACK" as const
  if (url.hostname === "account.lunaportex.com") {
    return "LUNA_CUSTOMER_ACCOUNT" as const
  }
  if (/^\/account(?:\/|$)/i.test(path)) return "LUNA_ACCOUNT" as const
  return "LUNA_ALLOWED_POST_LOGIN" as const
}

/**
 * One logical, bounded, non-mutating recognition probe. Response bodies are
 * cancelled and never serialized, persisted, returned, or logged.
 */
export async function probeLunaProtectedSessionHeaderV1(input: Readonly<{
  cookieHeader: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}>) {
  if (input.cookieHeader.length < 8 || input.cookieHeader.length > 8_192 ||
      !COOKIE_HEADER.test(input.cookieHeader)) {
    throw new Error("LUNA_PROTECTED_SESSION_PROBE_INPUT_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(
    1_000,
    Math.min(input.timeoutMs ?? SESSION_PROBE_TIMEOUT_MS, 20_000),
  ))
  timeout.unref?.()
  let current = safeProbeUrl(SESSION_PROBE_ENTRYPOINT)
  try {
    for (let redirectCount = 0;
      redirectCount <= SESSION_PROBE_MAX_REDIRECTS;
      redirectCount += 1) {
      const response = await fetchImpl(current.toString(), {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Cookie: input.cookieHeader,
          "User-Agent": "Seller-OS-Luna-Session-Preflight/1.0",
        },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      })
      await response.body?.cancel().catch(() => undefined)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location")
        if (!location || redirectCount === SESSION_PROBE_MAX_REDIRECTS) {
          throw new Error("LUNA_PROTECTED_SESSION_REDIRECT_LIMIT")
        }
        current = safeProbeUrl(location, current.toString())
        continue
      }
      const pathClass = postLoginPathClass(current)
      const authenticated = response.status >= 200 && response.status < 300 &&
        !["AUTHENTICATION_REQUIRED", "AUTH_CALLBACK"].includes(pathClass)
      return Object.freeze({
        authenticated,
        sourceStatus: authenticated ? "AVAILABLE" as const
          : response.status === 401 || response.status === 403
            ? "AUTH_REQUIRED" as const : "SOURCE_UNAVAILABLE" as const,
        postLoginHost: current.hostname,
        postLoginPathClass: pathClass,
        responseStatusClass: `${Math.floor(response.status / 100)}XX`,
        logicalReadCount: 1 as const,
        responseBodyRead: false as const,
        stockEvaluated: false as const,
        oosInferred: false as const,
      })
    }
    throw new Error("LUNA_PROTECTED_SESSION_REDIRECT_LIMIT")
  } catch (cause) {
    if (cause instanceof Error && /^LUNA_PROTECTED_SESSION_/.test(cause.message)) {
      throw cause
    }
    throw new Error("LUNA_PROTECTED_SESSION_PROBE_UNAVAILABLE")
  } finally {
    clearTimeout(timeout)
  }
}

export async function verifyStoredSellerOsLunaProtectedSessionV1(input: {
  client?: Pick<SupabaseClient, "rpc">
  fetchImpl?: typeof fetch
  now?: number
} = {}) {
  const now = input.now ?? Date.now()
  let client: Pick<SupabaseClient, "rpc">
  try { client = input.client ?? getSupabaseAdminClient() } catch {
    throw new Error("LUNA_PROTECTED_SESSION_VAULT_UNAVAILABLE")
  }
  const stored = await readVaultEnvelope(client, now)
  if (!stored.envelope || Date.parse(stored.envelope.expiresAt) <= now) {
    return Object.freeze({ authenticated: false,
      postLoginHost: null, postLoginPathClass: null,
      sourceStatus: stored.status, logicalReadCount: 0 as const })
  }
  return probeLunaProtectedSessionHeaderV1({
    cookieHeader: stored.envelope.cookieHeader,
    fetchImpl: input.fetchImpl,
  })
}
