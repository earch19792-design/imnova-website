type OpenAiServerFetchInput = {
  endpoint: string | URL
  apiKey: string
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
  cache?: RequestCache
  signal?: AbortSignal | null
  fetchImpl?: typeof fetch
}

type OpenAiResponseLimitInput = {
  maximumBytes: number
  tooLargeErrorCode: string
  missingBodyErrorCode: string
}

function assertServerRuntime() {
  if (typeof window !== "undefined") {
    throw new Error("OPENAI_SERVER_TRANSPORT_BROWSER_FORBIDDEN")
  }
}

function resolveAllowedOpenAiEndpoint(endpoint: string | URL) {
  let resolved: URL

  try {
    resolved = endpoint instanceof URL ? new URL(endpoint.toString()) : new URL(endpoint)
  } catch {
    throw new Error("OPENAI_SERVER_ENDPOINT_FORBIDDEN")
  }

  if (
    resolved.protocol !== "https:" ||
    resolved.hostname !== "api.openai.com" ||
    (resolved.port !== "" && resolved.port !== "443") ||
    resolved.username !== "" ||
    resolved.password !== "" ||
    resolved.hash !== ""
  ) {
    throw new Error("OPENAI_SERVER_ENDPOINT_FORBIDDEN")
  }

  return resolved.toString()
}

export async function openAiServerFetch(input: OpenAiServerFetchInput) {
  assertServerRuntime()

  const apiKey = input.apiKey.trim()
  if (!apiKey) {
    throw new Error("OPENAI_SERVER_API_KEY_REQUIRED")
  }

  const sourceEntries = input.headers instanceof Headers
    ? [...input.headers.entries()]
    : Array.isArray(input.headers)
      ? input.headers
      : Object.entries(input.headers ?? {})
  if (sourceEntries.some(([name]) => name.toLowerCase() === "authorization")) {
    throw new Error("OPENAI_SERVER_AUTHORIZATION_HEADER_FORBIDDEN")
  }
  const headers = Object.fromEntries(sourceEntries.map(([name, value]) => [
    name,
    String(value),
  ]))
  headers.Authorization = `Bearer ${apiKey}`

  const request: RequestInit = {
    method: input.method ?? "POST",
    headers,
  }

  if (input.body !== undefined) {
    request.body = input.body
  }
  if (input.cache !== undefined) {
    request.cache = input.cache
  }
  if (input.signal !== undefined) {
    request.signal = input.signal
  }

  return (input.fetchImpl ?? fetch)(resolveAllowedOpenAiEndpoint(input.endpoint), request)
}

export async function readOpenAiResponseTextWithLimit(
  response: Response,
  input: OpenAiResponseLimitInput,
) {
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes <= 0) {
    throw new Error("OPENAI_SERVER_RESPONSE_LIMIT_INVALID")
  }

  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > input.maximumBytes) {
    throw new Error(input.tooLargeErrorCode)
  }
  if (!response.body) {
    throw new Error(input.missingBodyErrorCode)
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > input.maximumBytes) {
        await reader.cancel()
        throw new Error(input.tooLargeErrorCode)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8")
}
