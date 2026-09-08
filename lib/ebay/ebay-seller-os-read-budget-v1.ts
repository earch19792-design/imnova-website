// Request-local scheduling/telemetry only. This is not an evidence authority.
export const SELLER_OS_COMMERCIAL_CONTEXT_BUDGET_MS = 18_000
export const SELLER_OS_COMMERCIAL_LIVE_BUDGET_MS = 12_000
export const SELLER_OS_COMMERCIAL_DATABASE_BUDGET_MS = 6_000

export type ReadTimingV1 = {
  dependency: string; elapsedMs: number; status: "AVAILABLE" | "UNAVAILABLE"
  limitationCode: string | null
}

export async function settleReadWithinBudgetV1<T>(input: {
  deadlineAt: number; read: () => Promise<T>; unavailable: (code: string) => T
  dependency: string; timings?: ReadTimingV1[]
}): Promise<T> {
  const started = Date.now()
  const remaining = input.deadlineAt - started
  const timeoutCode = "SELLER_OS_READ_BUDGET_EXHAUSTED"
  let timer: ReturnType<typeof setTimeout> | undefined
  let status: ReadTimingV1["status"] = "AVAILABLE"
  let limitationCode: string | null = null
  try {
    if (remaining <= 0) throw new Error(timeoutCode)
    return await Promise.race([
      Promise.resolve().then(input.read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutCode)), remaining)
      }),
    ])
  } catch (error) {
    status = "UNAVAILABLE"
    limitationCode = error instanceof Error && error.message === timeoutCode
      ? timeoutCode : "SELLER_OS_READ_DEPENDENCY_FAILED"
    return input.unavailable(limitationCode)
  } finally {
    if (timer) clearTimeout(timer)
    input.timings?.push({ dependency: input.dependency,
      elapsedMs: Date.now() - started, status, limitationCode })
  }
}

// Existing Supabase client supplies URL/headers. No new credential or authority.
// Abort both headers and body, and prohibit a late dependent read after expiry.
export function createBudgetedReadonlyFetchV1(input: {
  deadlineAt: number; fetchImpl?: typeof fetch; timings: ReadTimingV1[]
}) : typeof fetch {
  return async (url, init) => {
    const method = (init?.method ?? (url instanceof Request ? url.method : "GET")).toUpperCase()
    if (!["GET", "HEAD"].includes(method)) throw new DOMException("SELLER_OS_READ_ONLY_REQUIRED", "AbortError")
    const remaining = input.deadlineAt - Date.now()
    if (remaining <= 0) throw new DOMException("SELLER_OS_READ_BUDGET_EXHAUSTED", "AbortError")
    const started = Date.now()
    const signal = AbortSignal.timeout(Math.max(1, remaining))
    const inherited = init?.signal ?? (url instanceof Request ? url.signal : null)
    const dependency = new URL(url instanceof Request ? url.url : String(url)).pathname
    let status: ReadTimingV1["status"] = "AVAILABLE"
    try {
      const response = await (input.fetchImpl ?? fetch)(url, { ...init,
        signal: inherited ? AbortSignal.any([signal, inherited]) : signal })
      // Measure full transfer, not just time-to-headers. Preserve status/headers.
      const bytes = await response.arrayBuffer()
      if (!response.ok) status = "UNAVAILABLE"
      // postgrest-js retries 520/network errors by default. Surface the read
      // failure immediately instead of spending the caller's budget on backoff.
      if (response.status === 520) throw new DOMException("DATABASE_READ_HTTP_520", "AbortError")
      return new Response(method === "HEAD" || [204, 205, 304].includes(response.status)
        ? null : bytes, { status: response.status, statusText: response.statusText,
        headers: response.headers })
    } catch (error) {
      status = "UNAVAILABLE"
      throw new DOMException("DATABASE_READ_FAILED_OR_TIMED_OUT", "AbortError")
    } finally {
      input.timings.push({ dependency, elapsedMs: Date.now() - started, status,
        limitationCode: status === "UNAVAILABLE" ? "DATABASE_READ_FAILED_OR_TIMED_OUT" : null })
    }
  }
}
