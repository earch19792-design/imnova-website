type JsonObject = Record<string, unknown>

const MAX_MESSAGE_LENGTH = 280

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function sanitizeMobileReviewHttpMessage(
  value: unknown,
  fallback: string,
) {
  if (typeof value !== "string") return fallback

  const sanitized = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/Bearer\s+[^\s"'<]+/gi, "Bearer [REDACTADO]")
    .replace(/(access[_-]?token|refresh[_-]?token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTADO]")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()

  return sanitized ? sanitized.slice(0, MAX_MESSAGE_LENGTH) : fallback
}

export function getMobileReviewPayloadError(
  payload: unknown,
  fallback: string,
) {
  if (!isJsonObject(payload)) return fallback

  const directMessage = payload.error ?? payload.message ?? payload.detail
  if (typeof directMessage === "string") {
    return sanitizeMobileReviewHttpMessage(directMessage, fallback)
  }

  const errors = payload.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0]
    if (typeof first === "string") {
      return sanitizeMobileReviewHttpMessage(first, fallback)
    }
    if (isJsonObject(first)) {
      const nestedMessage = first.message ?? first.longMessage ?? first.error
      if (typeof nestedMessage === "string") {
        return sanitizeMobileReviewHttpMessage(nestedMessage, fallback)
      }
    }
  }

  return fallback
}

export async function readMobileReviewJson<T extends JsonObject>(
  response: Response,
  fallback: string,
): Promise<T> {
  const rawBody = await response.text()
  const httpLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`

  if (!rawBody.trim()) {
    if (!response.ok) throw new Error(`${fallback} · ${httpLabel}`)
    return {} as T
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    const detail = sanitizeMobileReviewHttpMessage(rawBody, fallback)
    throw new Error(`${fallback} · ${httpLabel}: ${detail}`)
  }

  if (!isJsonObject(payload)) {
    throw new Error(`${fallback} · ${httpLabel}: respuesta JSON inválida`)
  }

  if (!response.ok) {
    const detail = getMobileReviewPayloadError(payload, fallback)
    throw new Error(`${detail} · ${httpLabel}`)
  }

  return payload as T
}

export function getMobileReviewRequestError(
  error: unknown,
  fallback: string,
) {
  return error instanceof Error
    ? sanitizeMobileReviewHttpMessage(error.message, fallback)
    : fallback
}
