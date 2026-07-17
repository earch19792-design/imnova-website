import {
  probeEbayProductionIdentityReadOnly,
  type EbayProductionIdentityReadOnlyProbeResult,
} from "./ebay-manual-listing-trading-readonly"

export const EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION =
  "VALIDATE_EBAY_IDENTITY_READ_ONLY" as const

type AdminValidation = {
  ok: boolean
  status?: number
  error?: string | null
}

type BootstrapDependencies = {
  validateAdminApiRequest: (req: Request) => Promise<AdminValidation>
  probe?: () => Promise<EbayProductionIdentityReadOnlyProbeResult>
  environment?: NodeJS.ProcessEnv
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

function exactConfirmation(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  return keys.length === 1 &&
    keys[0] === "confirmation" &&
    record.confirmation === EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION
}

export function getEbayIdentityBootstrapSafetyError(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.EBAY_DRAFT_ONLY_WRITES_ENABLED !== "false") {
    return "UNSAFE_GLOBAL_WRITES_FLAG"
  }
  if (environment.EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED !== "false") {
    return "UNSAFE_PRODUCTION_WRITES_FLAG"
  }
  if (environment.EBAY_SELLER_WHATSAPP_ENABLED !== "false") {
    return "UNSAFE_WHATSAPP_FLAG"
  }
  if (environment.EBAY_DRAFT_ONLY_TARGET !== "SANDBOX") {
    return "UNSAFE_DRAFT_TARGET"
  }
  return null
}

function safeProbeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  if (code === "EBAY_TRADING_CONFIGURED_FINGERPRINT_MISMATCH") return code
  if (code === "EBAY_TRADING_READONLY_NOT_CONFIGURED") return code
  if (code === "EBAY_TRADING_GETUSER_IDENTITY_MISSING") return code
  if (/^EBAY_TRADING_OAUTH_[0-9]{3}$/.test(code)) return code
  if (/^EBAY_TRADING_GETUSER_[0-9]{3}$/.test(code)) return code
  return "EBAY_TRADING_GETUSER_500"
}

export async function handleEbayProductionIdentityBootstrapRequest(
  req: Request,
  dependencies: BootstrapDependencies,
) {
  const validation = await dependencies.validateAdminApiRequest(req)
  if (!validation.ok) {
    return json(
      { error: validation.error ?? "admin_forbidden" },
      validation.status === 401 ? 401 : 403,
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: "EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION_REQUIRED" }, 400)
  }
  if (!exactConfirmation(body)) {
    return json({ error: "EBAY_IDENTITY_BOOTSTRAP_CONFIRMATION_REQUIRED" }, 400)
  }

  const safetyError = getEbayIdentityBootstrapSafetyError(
    dependencies.environment,
  )
  if (safetyError) return json({ error: safetyError }, 409)

  try {
    const result = await (
      dependencies.probe ?? probeEbayProductionIdentityReadOnly
    )()
    return json(result)
  } catch (error) {
    const code = safeProbeError(error)
    return json(
      { error: code },
      code === "EBAY_TRADING_READONLY_NOT_CONFIGURED" ? 503 : 502,
    )
  }
}
