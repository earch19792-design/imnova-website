// Request-local scheduling and sanitized diagnostics for the existing Product
// Case reader. No new evidence authority, cache, persistence or retry framework.
export const PRODUCT_CASE_INTERNAL_BUDGET_MS = 18_000
export const PRODUCT_CASE_CRITICAL_BUDGET_MS = 7_000
export const PRODUCT_CASE_READ_BUDGET_MS = 4_000
export const PRODUCT_CASE_IDENTITY_MAX_ATTEMPTS = 2
// One short fixed delay, charged to the existing 7s critical deadline. After a
// 4s first attempt this leaves at most 2.85s for attempt two, not another 4s.
export const PRODUCT_CASE_IDENTITY_RETRY_DELAY_MS = 150

export type ProductCaseReadResultV1 = Readonly<{ data: unknown; error: unknown; status?: number }>
type Query = PromiseLike<ProductCaseReadResultV1> & {
  abortSignal?: (signal: AbortSignal) => Query
  retry?: (enabled: boolean) => Query
}
export type ProductCaseReadDiagnosticV1 = {
  DEPENDENCY: string; AUTHORITY: string; CRITICAL: boolean
  LATENCY_MS: number; DB_READ_COUNT: number; EXTERNAL_CALL_COUNT: 0
  RETRY_COUNT: number; TIMEOUT_BUDGET_MS: number
  ATTEMPT_COUNT: number; FIRST_FAILURE_CLASS: string | null
  LAST_FAILURE_CLASS: string | null; RETRY_PERFORMED: boolean
  FIRST_FAILURE_HTTP_STATUS: number | null; LAST_FAILURE_HTTP_STATUS: number | null
  RECOVERED_AFTER_RETRY: boolean; BUDGET_REMAINING_MS: number
  STATUS: "AVAILABLE" | "UNAVAILABLE" | "NOT_APPLICABLE"
  FAILURE_MODE: string | null; DATABASE_ERROR_CODE: string | null
  HTTP_STATUS: number | null
}
export class ProductCaseCriticalReadFailureV1 extends Error {
  readonly dependency: string
  readonly failureCode: string
  constructor(dependency: string, failureCode: string) {
    super("PRODUCT_CASE_CRITICAL_IDENTITY_UNAVAILABLE")
    this.dependency = dependency
    this.failureCode = failureCode
  }
}
function databaseCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code) : ""
  return /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code) ? code : null
}
// Deliberately narrow allowlist. An opaque fetch rejection/status 0, SQL error,
// app 500, authentication error or deterministic not-found is NOT proof of an
// origin transport failure. Never inspect or emit raw error messages/bodies.
export function classifyProductCaseReadFailureV1(result: ProductCaseReadResultV1) {
  const code = databaseCode(result.error)
  const status = result.status ?? 0
  if (!result.error) return { failureClass: null, retryable: false }
  const failureClass = status === 401 || status === 403 || code === "42501" ||
      /^PGRST30\d$/.test(code ?? "") ? "SUPABASE_DATA_API_AUTHORIZATION_FAILURE"
    : code === "57014" ? "PRODUCT_CASE_DATABASE_STATEMENT_TIMEOUT"
    : code ? "SUPABASE_DATA_API_DATA_OR_SCHEMA_FAILURE"
    : status === 404 ? "SUPABASE_DATA_API_NOT_FOUND"
    : status === 521 ? "SUPABASE_DATA_API_ORIGIN_CONNECTION_FAILURE"
    : status >= 400 && status < 500 ? "SUPABASE_DATA_API_REQUEST_REJECTED"
    : status >= 500 ? "PRODUCT_CASE_DATABASE_HTTP_UNAVAILABLE"
    : "PRODUCT_CASE_DATABASE_READ_UNAVAILABLE"
  return { failureClass,
    retryable: failureClass === "SUPABASE_DATA_API_ORIGIN_CONNECTION_FAILURE" }
}
export function createProductCaseReadBudgetV1(options: {
  internalBudgetMs?: number; perReadBudgetMs?: number
} = {}) {
  const startedAt = Date.now()
  // Only trusted in-process callers can shorten budgets (tests); never extend.
  const internalBudgetMs = Math.max(2, Math.min(PRODUCT_CASE_INTERNAL_BUDGET_MS,
    options.internalBudgetMs ?? PRODUCT_CASE_INTERNAL_BUDGET_MS))
  const reserveMs = Math.min(1_000, Math.floor(internalBudgetMs / 10))
  const deadlineAt = startedAt + internalBudgetMs - reserveMs
  const criticalDeadlineAt = Math.min(deadlineAt, startedAt + PRODUCT_CASE_CRITICAL_BUDGET_MS)
  const perReadBudgetMs = Math.max(1, Math.min(PRODUCT_CASE_READ_BUDGET_MS,
    options.perReadBudgetMs ?? PRODUCT_CASE_READ_BUDGET_MS))
  const readers: ProductCaseReadDiagnosticV1[] = []
  const active = new Set<AbortController>()
  let closed = false
  function unavailable(code: string): ProductCaseReadResultV1 {
    return { data: null, error: { code } }
  }
  function blankRetryDiagnostic() {
    return { ATTEMPT_COUNT: 0, FIRST_FAILURE_CLASS: null as string | null,
      LAST_FAILURE_CLASS: null as string | null, RETRY_PERFORMED: false,
      FIRST_FAILURE_HTTP_STATUS: null as number | null, LAST_FAILURE_HTTP_STATUS: null as number | null,
      RECOVERED_AFTER_RETRY: false, BUDGET_REMAINING_MS: Math.max(0, deadlineAt - Date.now()) }
  }
  return {
    async read(input: { dependency: string; authority: string; critical?: boolean;
      retrySafety?: "READ_ONLY_IDEMPOTENT_CRITICAL_IDENTITY";
      query: () => Query }): Promise<ProductCaseReadResultV1> {
      const began = Date.now()
      const readDeadlineAt = input.critical ? criticalDeadlineAt : deadlineAt
      const retryEligible = input.critical === true &&
        input.retrySafety === "READ_ONLY_IDEMPOTENT_CRITICAL_IDENTITY"
      const maxAttempts = retryEligible ? PRODUCT_CASE_IDENTITY_MAX_ATTEMPTS : 1
      const remaining = Math.max(0, readDeadlineAt - began)
      const row: ProductCaseReadDiagnosticV1 = {
        DEPENDENCY: input.dependency, AUTHORITY: input.authority,
        CRITICAL: input.critical === true, LATENCY_MS: 0,
        DB_READ_COUNT: 0, EXTERNAL_CALL_COUNT: 0, RETRY_COUNT: 0,
        TIMEOUT_BUDGET_MS: Math.min(perReadBudgetMs, remaining), STATUS: "UNAVAILABLE",
        FAILURE_MODE: "PRODUCT_CASE_READ_PENDING", DATABASE_ERROR_CODE: null, HTTP_STATUS: null,
        ...blankRetryDiagnostic(),
      }
      readers.push(row)
      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const attemptStartedAt = Date.now()
          const attemptDeadlineAt = Math.min(attemptStartedAt + perReadBudgetMs, readDeadlineAt)
          const allowance = Math.max(0, attemptDeadlineAt - attemptStartedAt)
          // Classify by the scheduled bound, not timer jitter (a timer can fire
          // just before Date.now crosses the corresponding millisecond).
          const attemptTimeoutCode = attemptDeadlineAt >= deadlineAt
            ? "PRODUCT_CASE_GLOBAL_DEADLINE_EXHAUSTED" : "PRODUCT_CASE_DEPENDENCY_TIMEOUT"
          if (closed || allowance <= 0) {
            // Preserve the last classified provider failure if a retry cannot
            // start; budget exhaustion must not erase the diagnostic cause.
            row.FAILURE_MODE = row.LAST_FAILURE_CLASS ?? "PRODUCT_CASE_GLOBAL_DEADLINE_EXHAUSTED"
            break
          }
          const controller = new AbortController()
          active.add(controller)
          let timer: ReturnType<typeof setTimeout> | undefined
          let expired = false
          let result: ProductCaseReadResultV1
          try {
            // A fresh builder/signal on EVERY attempt, with SDK retries off.
            let query = input.query() // Programming errors must propagate.
            if (query.retry) query = query.retry(false)
            if (query.abortSignal) query = query.abortSignal(controller.signal)
            row.DB_READ_COUNT++
            row.ATTEMPT_COUNT++
            row.RETRY_COUNT = row.ATTEMPT_COUNT - 1
            row.RETRY_PERFORMED = row.RETRY_COUNT > 0
            result = await Promise.race([
              Promise.resolve(query),
              new Promise<ProductCaseReadResultV1>((resolve) => {
                timer = setTimeout(() => {
                  expired = true
                  // Settle independently of an SDK/transport that ignores abort.
                  resolve(unavailable(attemptTimeoutCode))
                  controller.abort()
                }, allowance)
              }),
            ])
          } catch (error) {
            if (expired && error instanceof Error &&
                ["AbortError", "TimeoutError"].includes(error.name)) result = unavailable(attemptTimeoutCode)
            else throw error
          } finally {
            if (timer) clearTimeout(timer)
            active.delete(controller)
          }
          expired ||= Date.now() >= attemptDeadlineAt
          row.HTTP_STATUS = typeof result.status === "number" ? result.status : null
          if (!result.error && !expired) {
            row.STATUS = "AVAILABLE"
            row.FAILURE_MODE = null
            row.RECOVERED_AFTER_RETRY = row.RETRY_PERFORMED
            return result // Including empty/not-found: never retry or invent identity.
          }
          row.DATABASE_ERROR_CODE = databaseCode(result.error)
          const failure = expired ? { failureClass: attemptTimeoutCode, retryable: false }
            : classifyProductCaseReadFailureV1(result)
          // If recovery of a proven origin failure runs out of time, preserve
          // that origin failure on the closed case; LAST_FAILURE_CLASS still
          // explicitly records the recovery timeout. Never relabel a subsequent
          // auth/data error as transient, or invent origin failure on timeout alone.
          row.FAILURE_MODE = expired && row.FIRST_FAILURE_CLASS ===
            "SUPABASE_DATA_API_ORIGIN_CONNECTION_FAILURE"
            ? row.FIRST_FAILURE_CLASS : failure.failureClass
          if (!row.FIRST_FAILURE_CLASS) row.FIRST_FAILURE_HTTP_STATUS = row.HTTP_STATUS
          row.LAST_FAILURE_HTTP_STATUS = row.HTTP_STATUS
          row.FIRST_FAILURE_CLASS ??= failure.failureClass
          row.LAST_FAILURE_CLASS = failure.failureClass
          if (!retryEligible || !failure.retryable || attempt + 1 >= maxAttempts || closed) break
          // Do not start a backoff that consumes the remaining critical budget.
          if (readDeadlineAt - Date.now() <= PRODUCT_CASE_IDENTITY_RETRY_DELAY_MS) break
          await new Promise(resolve => setTimeout(resolve, PRODUCT_CASE_IDENTITY_RETRY_DELAY_MS))
        }
        const code = row.FAILURE_MODE ?? "PRODUCT_CASE_DATABASE_READ_UNAVAILABLE"
        if (input.critical) throw new ProductCaseCriticalReadFailureV1(input.dependency, code)
        return unavailable(code)
      } catch (error) {
        if (error instanceof ProductCaseCriticalReadFailureV1) throw error
        // Supabase normally returns expected fetch/SQL errors as ReadResult.
        // A rejected programming exception is not a missing evidence field.
        row.STATUS = "UNAVAILABLE"
        row.FAILURE_MODE = "PRODUCT_CASE_UNEXPECTED_RUNTIME_EXCEPTION"
        throw error
      } finally {
        row.LATENCY_MS = Date.now() - began
        row.BUDGET_REMAINING_MS = Math.max(0, deadlineAt - Date.now())
      }
    },
    skip(dependency: string, authority: string, prerequisiteFailure?: string | null) {
      readers.push({ DEPENDENCY: dependency, AUTHORITY: authority, CRITICAL: false,
        LATENCY_MS: 0, DB_READ_COUNT: 0, EXTERNAL_CALL_COUNT: 0, RETRY_COUNT: 0,
        TIMEOUT_BUDGET_MS: 0, STATUS: prerequisiteFailure ? "UNAVAILABLE" : "NOT_APPLICABLE",
        FAILURE_MODE: prerequisiteFailure ? "PRODUCT_CASE_PREREQUISITE_UNAVAILABLE" : null,
        DATABASE_ERROR_CODE: null, HTTP_STATUS: null, ...blankRetryDiagnostic() })
      return prerequisiteFailure ? unavailable("PRODUCT_CASE_PREREQUISITE_UNAVAILABLE")
        : { data: null, error: null }
    },
    failure(dependency: string) {
      return readers.find((r) => r.DEPENDENCY === dependency && r.FAILURE_MODE)?.FAILURE_MODE ?? null
    },
    snapshot() {
      const critical = readers.filter(r => r.CRITICAL)
      return { INTERNAL_BUDGET_MS: internalBudgetMs, ELAPSED_MS: Date.now() - startedAt,
        DB_READ_COUNT: readers.reduce((n, r) => n + r.DB_READ_COUNT, 0),
        EXTERNAL_CALL_COUNT: 0, RETRY_COUNT: readers.reduce((n, r) => n + r.RETRY_COUNT, 0),
        READERS: readers.map(r => ({ ...r })), SDK_RETRIES_DISABLED: true,
        IDENTITY_READ: { MAX_ATTEMPTS_PER_READ: PRODUCT_CASE_IDENTITY_MAX_ATTEMPTS,
          PER_ATTEMPT_TIMEOUT_MS: perReadBudgetMs,
          OVERALL_BUDGET_MS: criticalDeadlineAt - startedAt,
          ATTEMPT_COUNT: critical.reduce((n, r) => n + r.ATTEMPT_COUNT, 0),
          FIRST_FAILURE_CLASS: critical.find(r => r.FIRST_FAILURE_CLASS)?.FIRST_FAILURE_CLASS ?? null,
          LAST_FAILURE_CLASS: [...critical].reverse().find(r => r.LAST_FAILURE_CLASS)?.LAST_FAILURE_CLASS ?? null,
          RETRY_PERFORMED: critical.some(r => r.RETRY_PERFORMED),
          RECOVERED_AFTER_RETRY: critical.some(r => r.RECOVERED_AFTER_RETRY) &&
            critical.every(r => r.STATUS === "AVAILABLE"),
          TOTAL_IDENTITY_READ_LATENCY_MS: critical.reduce((n, r) => n + r.LATENCY_MS, 0),
          BUDGET_REMAINING_MS: Math.max(0, criticalDeadlineAt - Date.now()) },
        BUDGET_REMAINING_MS: Math.max(0, deadlineAt - Date.now()),
        EXISTING_DURABLE_AUTHORITIES_ONLY: true }
    },
    close() { closed = true; for (const controller of active) controller.abort() },
  }
}
export type ProductCaseReadBudgetV1 = ReturnType<typeof createProductCaseReadBudgetV1>
