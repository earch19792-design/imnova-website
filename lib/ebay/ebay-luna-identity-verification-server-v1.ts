import "server-only"

import { resolveServerOwnedLunaSessionValueV1 } from
  "./ebay-luna-protected-session-server-v1"
import {
  buildSellerOsLunaIdentityVerificationEvidenceV1,
  isSellerOsLunaIdentityVerificationTargetV1,
  sellerOsLunaIdentityProductJsonUrlV1,
  type SellerOsLunaIdentityVerificationTargetV1,
} from "./ebay-luna-identity-verification-v1"

const MAXIMUM_RESPONSE_BYTES = 1_000_000
const DEFAULT_TIMEOUT_MS = 12_000

async function responseTextBounded(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > MAXIMUM_RESPONSE_BYTES) {
    throw new Error("LUNA_IDENTITY_RESPONSE_TOO_LARGE")
  }
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      bytes += value.byteLength
      if (bytes > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error("LUNA_IDENTITY_RESPONSE_TOO_LARGE")
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

export function createSellerOsLunaIdentityVerificationServerV1(input: Readonly<{
  fetchImpl?: typeof fetch
  resolveSession?: () => Promise<string | null>
  now?: () => string
  timeoutMs?: number
}> = {}) {
  const fetchImpl = input.fetchImpl ?? fetch
  const resolveSession = input.resolveSession ?? (() =>
    resolveServerOwnedLunaSessionValueV1())
  const timeoutMs = Math.max(1_000,
    Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 20_000))
  return async function verify(
    target: SellerOsLunaIdentityVerificationTargetV1,
  ) {
    if (!isSellerOsLunaIdentityVerificationTargetV1(target)) {
      throw new Error("LUNA_IDENTITY_TARGET_NOT_SERVER_RESOLVED")
    }
    const productJsonUrl = sellerOsLunaIdentityProductJsonUrlV1(target)
    const protectedSession = await resolveSession()
    if (!protectedSession) throw new Error("LUNA_REAUTH_REQUIRED")
    let response: Response
    try {
      response = await fetchImpl(productJsonUrl, {
        method: "GET",
        headers: {
          Accept: "application/json, application/javascript;q=0.9, text/javascript;q=0.8",
          Cookie: protectedSession,
          "User-Agent": "Seller-OS-Luna-Identity-Verification/1.0",
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new Error("LUNA_IDENTITY_SOURCE_UNAVAILABLE")
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("LUNA_IDENTITY_REDIRECT_REJECTED")
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("LUNA_REAUTH_REQUIRED")
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("LUNA_IDENTITY_SOURCE_UNAVAILABLE")
    }
    const contentType = response.headers.get("content-type") ?? ""
    if (!/^(?:application\/(?:json|javascript)|text\/javascript)(?:;|$)/i
      .test(contentType.trim())) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("LUNA_IDENTITY_PARSE_CONTRACT_CHANGED")
    }
    const raw = await responseTextBounded(response)
    let payload: unknown
    try { payload = JSON.parse(raw) } catch {
      throw new Error("LUNA_IDENTITY_PARSE_CONTRACT_CHANGED")
    }
    return buildSellerOsLunaIdentityVerificationEvidenceV1({
      target,
      payload,
      observedAt: input.now?.() ?? new Date().toISOString(),
    })
  }
}

/** Creating this reader is inert; calling it performs one bounded product read. */
export const fetchSellerOsLunaIdentityVerificationV1 =
  createSellerOsLunaIdentityVerificationServerV1()
