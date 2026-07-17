import { createHash } from "node:crypto"

export const TOP20_CONTINUATION_TOPIC = "ebay-listing-top20-continuation"

export const TOP20_DISPATCH_ERROR_CLASSES = [
  "PROTECTION_REJECTED",
  "AUTH_REJECTED",
  "TOKEN_REJECTED",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "SERVER_ERROR",
  "INVALID_ORIGIN",
] as const

export type Top20DispatchErrorClass = typeof TOP20_DISPATCH_ERROR_CLASSES[number]
export type Top20DispatchTransport = "VERCEL_QUEUE" | "HTTP_FALLBACK"

export type Top20DispatchDiagnostic = {
  attemptNumber: number
  transport: Top20DispatchTransport
  outcome: "ACCEPTED" | "RETRYABLE_ERROR" | "PERMANENT_ERROR" | "PAUSED_RECOVERABLE"
  httpStatus: number | null
  errorClass: Top20DispatchErrorClass | null
  elapsedMs: number
  hostFingerprint: string | null
  bypassConfigured: boolean
  protectionCookiePresent: boolean
  xVercelId: string | null
  queueMessageFingerprint: string | null
  observedAt: string
}

type QueueSend = (
  topic: string,
  message: Record<string, unknown>,
  options: {
    retentionSeconds: number
    idempotencyKey: string
  },
) => Promise<{ messageId?: string | null }>

type HttpDispatchInput = {
  origin: string
  runId: string
  token: string
  protectionBypass?: string | null
  protectionCookie?: string | null
  maxAttempts?: number
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  now?: () => Date
  onAttempt?: (diagnostic: Top20DispatchDiagnostic) => Promise<void> | void
}

type QueueDispatchInput = {
  send: QueueSend
  runId: string
  continuationGeneration: number
  expectedBatch: number
  attemptOffset?: number
  maxAttempts?: number
  deploymentHost?: string | null
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  now?: () => Date
  onAttempt?: (diagnostic: Top20DispatchDiagnostic) => Promise<void> | void
}

const CONTINUATION_PATH = "/api/admin/ebay/listing-ai/approval-queue/continue"

function sha256Truncated(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`
}

export function top20DispatchHostFingerprint(hostOrUrl: string | null | undefined) {
  if (!hostOrUrl) return null
  try {
    const host = hostOrUrl.includes("://")
      ? new URL(hostOrUrl).hostname
      : hostOrUrl
    const normalized = host.trim().toLowerCase()
    if (!/^[a-z0-9.-]+$/.test(normalized)) return null
    return sha256Truncated(normalized)
  } catch {
    return null
  }
}

export function sanitizeTop20VercelId(value: string | null | undefined) {
  const normalized = value?.trim() ?? ""
  return normalized && normalized.length <= 256 && /^[A-Za-z0-9:.,_ -]+$/.test(normalized)
    ? normalized
    : null
}

export function classifyTop20DispatchHttp(input: {
  status: number
  protectionRejected?: boolean
  errorCode?: string | null
}): Top20DispatchErrorClass | null {
  if (input.status >= 200 && input.status < 300) return null
  if (input.protectionRejected && [401, 403].includes(input.status)) return "PROTECTION_REJECTED"
  if (input.errorCode === "TOP20_CONTINUATION_TOKEN_REJECTED") return "TOKEN_REJECTED"
  if ([401, 403].includes(input.status)) return "AUTH_REJECTED"
  if (input.status === 429) return "RATE_LIMITED"
  if (input.status >= 500) return "SERVER_ERROR"
  return "AUTH_REJECTED"
}

export function classifyTop20DispatchError(error: unknown): Top20DispatchErrorClass {
  const value = error instanceof Error ? `${error.name}:${error.message}` : String(error ?? "")
  if (/invalid url|invalid origin|ERR_INVALID_URL/i.test(value)) return "INVALID_ORIGIN"
  if (/abort|timeout|timed out/i.test(value)) return "TIMEOUT"
  if (/unauthorized|invalid.*oidc|authentication/i.test(value)) return "AUTH_REJECTED"
  if (/rate.?limit|429/i.test(value)) return "RATE_LIMITED"
  return "NETWORK_ERROR"
}

export function isRetryableTop20DispatchClass(value: Top20DispatchErrorClass) {
  return ["RATE_LIMITED", "TIMEOUT", "NETWORK_ERROR", "SERVER_ERROR"].includes(value)
}

function backoffWithJitter(attemptIndex: number, random: () => number) {
  const base = Math.min(4_000, 500 * (2 ** attemptIndex))
  return Math.round(base + base * .25 * Math.max(0, Math.min(1, random())))
}

async function recordAttempt(
  callback: ((diagnostic: Top20DispatchDiagnostic) => Promise<void> | void) | undefined,
  diagnostic: Top20DispatchDiagnostic,
) {
  if (callback) await callback(diagnostic)
}

export class Top20DispatchFailure extends Error {
  readonly diagnostic: Top20DispatchDiagnostic

  constructor(diagnostic: Top20DispatchDiagnostic) {
    super("TOP20_CONTINUATION_DISPATCH_FAILED")
    this.name = "Top20DispatchFailure"
    this.diagnostic = diagnostic
  }
}

export async function dispatchTop20ContinuationHttp(input: HttpDispatchInput) {
  const fetchImpl = input.fetchImpl ?? fetch
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const random = input.random ?? Math.random
  const now = input.now ?? (() => new Date())
  const maxAttempts = Math.max(1, Math.min(5, input.maxAttempts ?? 3))
  const hostFingerprint = top20DispatchHostFingerprint(input.origin)
  if (!hostFingerprint) {
    const diagnostic: Top20DispatchDiagnostic = {
      attemptNumber: 1, transport: "HTTP_FALLBACK", outcome: "PERMANENT_ERROR",
      httpStatus: null, errorClass: "INVALID_ORIGIN", elapsedMs: 0,
      hostFingerprint: null, bypassConfigured: Boolean(input.protectionBypass),
      protectionCookiePresent: Boolean(input.protectionCookie), xVercelId: null,
      queueMessageFingerprint: null, observedAt: now().toISOString(),
    }
    await recordAttempt(input.onAttempt, diagnostic)
    throw new Top20DispatchFailure(diagnostic)
  }
  let last: Top20DispatchDiagnostic | null = null
  for (let index = 0; index < maxAttempts; index += 1) {
    const startedAt = Date.now()
    try {
      const response = await fetchImpl(new URL(CONTINUATION_PATH, input.origin), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Top20-Continuation-Token": input.token,
          ...(input.protectionBypass
            ? { "X-Vercel-Protection-Bypass": input.protectionBypass }
            : {}),
          ...(!input.protectionBypass && input.protectionCookie
            ? { Cookie: input.protectionCookie }
            : {}),
        },
        body: JSON.stringify({ runId: input.runId }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      })
      const errorCode = response.headers.get("x-seller-os-error-code")
      const errorClass = classifyTop20DispatchHttp({
        status: response.status,
        protectionRejected: response.headers.get("x-vercel-mitigated") === "challenge",
        errorCode,
      })
      const retryable = errorClass ? isRetryableTop20DispatchClass(errorClass) : false
      last = {
        attemptNumber: index + 1, transport: "HTTP_FALLBACK",
        outcome: errorClass ? retryable ? "RETRYABLE_ERROR" : "PERMANENT_ERROR" : "ACCEPTED",
        httpStatus: response.status, errorClass,
        elapsedMs: Math.min(300_000, Date.now() - startedAt), hostFingerprint,
        bypassConfigured: Boolean(input.protectionBypass),
        protectionCookiePresent: Boolean(input.protectionCookie),
        xVercelId: sanitizeTop20VercelId(response.headers.get("x-vercel-id")),
        queueMessageFingerprint: null, observedAt: now().toISOString(),
      }
      await recordAttempt(input.onAttempt, last)
      if (!errorClass) return last
      if (!retryable) throw new Top20DispatchFailure(last)
    } catch (error) {
      if (error instanceof Top20DispatchFailure) throw error
      const errorClass = classifyTop20DispatchError(error)
      last = {
        attemptNumber: index + 1, transport: "HTTP_FALLBACK", outcome: "RETRYABLE_ERROR",
        httpStatus: null, errorClass, elapsedMs: Math.min(300_000, Date.now() - startedAt),
        hostFingerprint, bypassConfigured: Boolean(input.protectionBypass),
        protectionCookiePresent: Boolean(input.protectionCookie), xVercelId: null,
        queueMessageFingerprint: null, observedAt: now().toISOString(),
      }
      await recordAttempt(input.onAttempt, last)
    }
    if (index + 1 < maxAttempts) await sleep(backoffWithJitter(index, random))
  }
  if (!last) throw new Error("TOP20_CONTINUATION_DISPATCH_FAILED")
  throw new Top20DispatchFailure({ ...last, outcome: "PAUSED_RECOVERABLE" })
}

export async function publishTop20ContinuationQueue(input: QueueDispatchInput) {
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const random = input.random ?? Math.random
  const now = input.now ?? (() => new Date())
  const maxAttempts = Math.max(1, Math.min(5, input.maxAttempts ?? 3))
  const hostFingerprint = top20DispatchHostFingerprint(input.deploymentHost)
  const idempotencyKey = sha256Truncated([
    "TOP20_CONTINUATION_V2", input.runId, input.continuationGeneration,
    input.expectedBatch,
  ].join(":"))
  let last: Top20DispatchDiagnostic | null = null
  for (let index = 0; index < maxAttempts; index += 1) {
    const startedAt = Date.now()
    const attemptNumber = (input.attemptOffset ?? 0) + index + 1
    try {
      const result = await input.send(TOP20_CONTINUATION_TOPIC, {
        version: "TOP20_CONTINUATION_V2",
        runId: input.runId,
        continuationGeneration: input.continuationGeneration,
        expectedBatch: input.expectedBatch,
      }, {
        retentionSeconds: 86_400,
        idempotencyKey,
      })
      const queueMessageFingerprint = result.messageId
        ? sha256Truncated(result.messageId)
        : null
      last = {
        attemptNumber, transport: "VERCEL_QUEUE", outcome: "ACCEPTED",
        httpStatus: null, errorClass: null,
        elapsedMs: Math.min(300_000, Date.now() - startedAt), hostFingerprint,
        bypassConfigured: false, protectionCookiePresent: false, xVercelId: null,
        queueMessageFingerprint, observedAt: now().toISOString(),
      }
      await recordAttempt(input.onAttempt, last)
      return last
    } catch (error) {
      const errorClass = classifyTop20DispatchError(error)
      last = {
        attemptNumber, transport: "VERCEL_QUEUE",
        outcome: isRetryableTop20DispatchClass(errorClass) ? "RETRYABLE_ERROR" : "PERMANENT_ERROR",
        httpStatus: null, errorClass,
        elapsedMs: Math.min(300_000, Date.now() - startedAt), hostFingerprint,
        bypassConfigured: false, protectionCookiePresent: false, xVercelId: null,
        queueMessageFingerprint: null, observedAt: now().toISOString(),
      }
      await recordAttempt(input.onAttempt, last)
      if (!isRetryableTop20DispatchClass(errorClass)) throw new Top20DispatchFailure(last)
    }
    if (index + 1 < maxAttempts) await sleep(backoffWithJitter(index, random))
  }
  if (!last) throw new Error("TOP20_CONTINUATION_DISPATCH_FAILED")
  throw new Top20DispatchFailure({ ...last, outcome: "PAUSED_RECOVERABLE" })
}
