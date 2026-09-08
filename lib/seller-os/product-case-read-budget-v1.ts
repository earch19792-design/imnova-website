// Request-local scheduling and sanitized diagnostics for the existing Product
// Case reader. No evidence authority, cache, persistence or retry loop.
export const PRODUCT_CASE_INTERNAL_BUDGET_MS = 18_000
export const PRODUCT_CASE_CRITICAL_BUDGET_MS = 7_000
export const PRODUCT_CASE_READ_BUDGET_MS = 4_000

export type ProductCaseReadResultV1 = Readonly<{ data: unknown; error: unknown; status?: number }>
type Query = PromiseLike<ProductCaseReadResultV1> & {
  abortSignal?: (signal: AbortSignal) => Query
  retry?: (enabled: boolean) => Query
}
export type ProductCaseReadDiagnosticV1 = {
  DEPENDENCY: string; AUTHORITY: string; CRITICAL: boolean
  LATENCY_MS: number; DB_READ_COUNT: number; EXTERNAL_CALL_COUNT: 0
  RETRY_COUNT: 0; TIMEOUT_BUDGET_MS: number
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
  return {
    async read(input: { dependency: string; authority: string; critical?: boolean;
      query: () => Query }): Promise<ProductCaseReadResultV1> {
      const began = Date.now()
      const remaining = Math.max(0, Math.min(perReadBudgetMs,
        (input.critical ? criticalDeadlineAt : deadlineAt) - began))
      const row: ProductCaseReadDiagnosticV1 = {
        DEPENDENCY: input.dependency, AUTHORITY: input.authority,
        CRITICAL: input.critical === true, LATENCY_MS: 0,
        DB_READ_COUNT: 0, EXTERNAL_CALL_COUNT: 0, RETRY_COUNT: 0,
        TIMEOUT_BUDGET_MS: remaining, STATUS: "UNAVAILABLE",
        FAILURE_MODE: "PRODUCT_CASE_READ_PENDING", DATABASE_ERROR_CODE: null, HTTP_STATUS: null,
      }
      readers.push(row)
      const controller = new AbortController()
      active.add(controller)
      let timer: ReturnType<typeof setTimeout> | undefined
      let expired = closed || remaining <= 0
      try {
        let result: ProductCaseReadResultV1
        if (expired) result = unavailable("PRODUCT_CASE_GLOBAL_DEADLINE_EXHAUSTED")
        else {
          let query = input.query() // Programming errors must propagate.
          if (query.retry) query = query.retry(false)
          if (query.abortSignal) query = query.abortSignal(controller.signal)
          row.DB_READ_COUNT = 1
          result = await Promise.race([
            Promise.resolve(query),
            new Promise<ProductCaseReadResultV1>((resolve) => {
              timer = setTimeout(() => {
                expired = true
                controller.abort()
                resolve(unavailable(Date.now() >= deadlineAt
                  ? "PRODUCT_CASE_GLOBAL_DEADLINE_EXHAUSTED"
                  : "PRODUCT_CASE_DEPENDENCY_TIMEOUT"))
              }, remaining)
            }),
          ])
        }
        row.HTTP_STATUS = typeof result.status === "number" ? result.status : null
        if (result.error) {
          row.STATUS = "UNAVAILABLE"
          row.DATABASE_ERROR_CODE = databaseCode(result.error)
          row.FAILURE_MODE = expired
            ? Date.now() >= deadlineAt ? "PRODUCT_CASE_GLOBAL_DEADLINE_EXHAUSTED"
              : "PRODUCT_CASE_DEPENDENCY_TIMEOUT"
            : row.DATABASE_ERROR_CODE === "57014" ? "PRODUCT_CASE_DATABASE_STATEMENT_TIMEOUT"
              : (row.HTTP_STATUS ?? 0) >= 500 ? "PRODUCT_CASE_DATABASE_HTTP_UNAVAILABLE"
              : "PRODUCT_CASE_DATABASE_READ_UNAVAILABLE"
          if (input.critical) throw new ProductCaseCriticalReadFailureV1(
            input.dependency, row.FAILURE_MODE)
          return unavailable(row.FAILURE_MODE)
        }
        row.STATUS = "AVAILABLE"
        row.FAILURE_MODE = null
        return result
      } catch (error) {
        if (error instanceof ProductCaseCriticalReadFailureV1) throw error
        if (expired && error instanceof Error &&
            ["AbortError", "TimeoutError"].includes(error.name)) {
          row.STATUS = "UNAVAILABLE"
          row.FAILURE_MODE = Date.now() >= deadlineAt
            ? "PRODUCT_CASE_GLOBAL_DEADLINE_EXHAUSTED" : "PRODUCT_CASE_DEPENDENCY_TIMEOUT"
          if (input.critical) throw new ProductCaseCriticalReadFailureV1(
            input.dependency, row.FAILURE_MODE)
          return unavailable(row.FAILURE_MODE)
        }
        // Supabase normally returns expected fetch/SQL errors as ReadResult.
        // A rejected programming exception is not a missing evidence field.
        row.STATUS = "UNAVAILABLE"
        row.FAILURE_MODE = "PRODUCT_CASE_UNEXPECTED_RUNTIME_EXCEPTION"
        throw error
      } finally {
        if (timer) clearTimeout(timer)
        active.delete(controller)
        row.LATENCY_MS = Date.now() - began
      }
    },
    skip(dependency: string, authority: string, prerequisiteFailure?: string | null) {
      readers.push({ DEPENDENCY: dependency, AUTHORITY: authority, CRITICAL: false,
        LATENCY_MS: 0, DB_READ_COUNT: 0, EXTERNAL_CALL_COUNT: 0, RETRY_COUNT: 0,
        TIMEOUT_BUDGET_MS: 0, STATUS: prerequisiteFailure ? "UNAVAILABLE" : "NOT_APPLICABLE",
        FAILURE_MODE: prerequisiteFailure ? "PRODUCT_CASE_PREREQUISITE_UNAVAILABLE" : null,
        DATABASE_ERROR_CODE: null, HTTP_STATUS: null })
      return prerequisiteFailure ? unavailable("PRODUCT_CASE_PREREQUISITE_UNAVAILABLE")
        : { data: null, error: null }
    },
    failure(dependency: string) {
      return readers.find((r) => r.DEPENDENCY === dependency && r.FAILURE_MODE)?.FAILURE_MODE ?? null
    },
    snapshot() {
      return { INTERNAL_BUDGET_MS: internalBudgetMs, ELAPSED_MS: Date.now() - startedAt,
        DB_READ_COUNT: readers.reduce((n, r) => n + r.DB_READ_COUNT, 0),
        EXTERNAL_CALL_COUNT: 0, RETRY_COUNT: 0, READERS: readers.map(r => ({ ...r })),
        RETRIES_DISABLED: true, EXISTING_DURABLE_AUTHORITIES_ONLY: true }
    },
    close() { closed = true; for (const controller of active) controller.abort() },
  }
}
export type ProductCaseReadBudgetV1 = ReturnType<typeof createProductCaseReadBudgetV1>
