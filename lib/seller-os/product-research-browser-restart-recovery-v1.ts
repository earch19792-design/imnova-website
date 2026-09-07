export const PRODUCT_RESEARCH_WORKER_CONTROL_PATH =
  "/admin/ebay/opportunity-queue/research" as const

export const PRODUCT_RESEARCH_WORKER_CONTROL_AUTH_RECOVERY = Object.freeze({
  version: "PRODUCT_RESEARCH_WORKER_CONTROL_AUTH_RECOVERY_V1",
  maxAttempts: 3,
  retryDelayMs: 1_000,
})

type SessionRead = Readonly<{
  authorized: boolean
  accessToken: string | null
  error: string | null
}>

export function isProductResearchWorkerControlReturnPath(
  value: string | null | undefined,
) {
  if (!value) return false
  try {
    const parsed = new URL(value, "https://seller-os.invalid")
    return parsed.origin === "https://seller-os.invalid" &&
      parsed.pathname === PRODUCT_RESEARCH_WORKER_CONTROL_PATH &&
      parsed.searchParams.get("mayelResearchWorker") === "auto" &&
      parsed.searchParams.get("browserWorkerControl") === "1"
  } catch {
    return false
  }
}

export async function recoverProductResearchWorkerControlSessionV1(
  input: Readonly<{
    returnTo: string | null | undefined
    readSession: () => Promise<SessionRead>
    establishProtectedSession: (accessToken: string) => Promise<boolean>
    wait?: (delayMs: number) => Promise<void>
  }>,
) {
  if (!isProductResearchWorkerControlReturnPath(input.returnTo)) {
    return Object.freeze({ status: "NOT_APPLICABLE" as const, attempts: 0 })
  }
  const wait = input.wait ?? ((delayMs: number) =>
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)))
  let lastError = "SESSION_REQUIRED"
  for (let attempt = 1;
    attempt <= PRODUCT_RESEARCH_WORKER_CONTROL_AUTH_RECOVERY.maxAttempts;
    attempt += 1) {
    const session = await input.readSession().catch(() => ({
      authorized: false, accessToken: null, error: "SESSION_READ_UNAVAILABLE",
    }))
    lastError = session.error ?? "SESSION_REQUIRED"
    if (session.authorized && session.accessToken) {
      const established = await input.establishProtectedSession(
        session.accessToken).catch(() => false)
      if (established) return Object.freeze({
        status: "CONTROL_PAGE_RECOVERED" as const,
        attempts: attempt,
      })
      lastError = "PROTECTED_SESSION_ESTABLISHMENT_FAILED"
    } else if (lastError === "NO_SESSION") {
      return Object.freeze({
        status: "WAITING_AUTH_REQUIRED" as const,
        attempts: attempt,
        blockerCode: "AUTHENTICATED_CONTROL_PAGE_NOT_BOOTSTRAPPED" as const,
      })
    }
    if (attempt < PRODUCT_RESEARCH_WORKER_CONTROL_AUTH_RECOVERY.maxAttempts) {
      await wait(PRODUCT_RESEARCH_WORKER_CONTROL_AUTH_RECOVERY.retryDelayMs)
    }
  }
  return Object.freeze({
    status: "WAITING_AUTH_REQUIRED" as const,
    attempts: PRODUCT_RESEARCH_WORKER_CONTROL_AUTH_RECOVERY.maxAttempts,
    blockerCode: "AUTHENTICATED_CONTROL_PAGE_NOT_BOOTSTRAPPED" as const,
    lastError,
  })
}
