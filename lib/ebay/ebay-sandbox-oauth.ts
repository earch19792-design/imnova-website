export const EBAY_SANDBOX_OAUTH_VERSION =
  "EBAY_SANDBOX_OAUTH_V1"

export const EBAY_SANDBOX_AUTH_URL =
  "https://auth.sandbox.ebay.com/oauth2/authorize"
export const EBAY_SANDBOX_TOKEN_URL =
  "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
export const EBAY_PRODUCTION_AUTH_URL =
  "https://auth.ebay.com/oauth2/authorize"
export const EBAY_PRODUCTION_TOKEN_URL =
  "https://api.ebay.com/identity/v1/oauth2/token"

export const DEFAULT_EBAY_SANDBOX_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
] as const

const sourceDataClass =
  "LOOP_148_EBAY_SANDBOX_OAUTH"
const approvalPhrase =
  "APPROVE_LOOP_148_EBAY_SANDBOX_OAUTH"

type OAuthInput = {
  targetEnv?: string | null
  clientId?: string | null
  clientSecret?: string | null
  runame?: string | null
  scopes?: string[] | string | null
  approval?: string | null
  authCode?: string | null
  callbackUrl?: string | null
  state?: string | null
}

type OAuthOptions = {
  requireClientSecret?: boolean | null
  requireAuthCode?: boolean | null
  requireApproval?: boolean | null
  authUrl?: string | null
  tokenUrl?: string | null
  tokenOutputFile?: string | null
  repoRoot?: string | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeScopes(scopes: OAuthInput["scopes"]) {
  if (Array.isArray(scopes)) {
    return scopes
      .map(scope => normalizeText(scope))
      .filter((scope): scope is string => scope !== null)
  }

  if (typeof scopes === "string" && scopes.trim().length > 0) {
    return scopes
      .split(/[,\s]+/)
      .map(scope => normalizeText(scope))
      .filter((scope): scope is string => scope !== null)
  }

  return [...DEFAULT_EBAY_SANDBOX_SCOPES]
}

function isSandboxAuthEndpoint(value: string) {
  return value === EBAY_SANDBOX_AUTH_URL
}

function isSandboxTokenEndpoint(value: string) {
  return value === EBAY_SANDBOX_TOKEN_URL
}

function hasProductionEndpoint(value: string | null | undefined) {
  return value === EBAY_PRODUCTION_AUTH_URL ||
    value === EBAY_PRODUCTION_TOKEN_URL ||
    value === "https://api.ebay.com" ||
    value === "https://auth.ebay.com"
}

function redact(value: unknown, visible = 4) {
  const text =
    normalizeText(value)

  if (text === null) {
    return null
  }

  if (text.length <= visible) {
    return "***"
  }

  return `${text.slice(0, visible)}...REDACTED`
}

export function buildEbaySandboxOAuthConfig(
  input: OAuthInput = {},
  options: OAuthOptions = {},
) {
  const authUrl =
    normalizeText(options.authUrl) ?? EBAY_SANDBOX_AUTH_URL
  const tokenUrl =
    normalizeText(options.tokenUrl) ?? EBAY_SANDBOX_TOKEN_URL

  return {
    oauthVersion:
      EBAY_SANDBOX_OAUTH_VERSION,
    sourceDataClass,
    targetEnv:
      normalizeText(input.targetEnv) ?? "sandbox",
    clientId:
      normalizeText(input.clientId),
    clientSecret:
      normalizeText(input.clientSecret),
    runame:
      normalizeText(input.runame),
    scopes:
      normalizeScopes(input.scopes),
    approval:
      normalizeText(input.approval),
    authCode:
      normalizeText(input.authCode),
    callbackUrl:
      normalizeText(input.callbackUrl),
    state:
      normalizeText(input.state),
    authUrl,
    tokenUrl,
    productionBlocked:
      true,
    draftCreated:
      false,
    publicationCreated:
      false,
    stagingWriteExecuted:
      false,
    ebayProductionUsed:
      false,
  }
}

export function validateEbaySandboxOAuthConfig(
  config: ReturnType<typeof buildEbaySandboxOAuthConfig>,
  options: OAuthOptions = {},
) {
  const errors: string[] = []
  const warnings: string[] = []

  if (config.targetEnv !== "sandbox") {
    errors.push("target env must be sandbox")
  }

  if (config.clientId === null) {
    errors.push("missing sandbox client id")
  }

  if (config.runame === null) {
    errors.push("missing sandbox RuName")
  }

  if (options.requireClientSecret === true && config.clientSecret === null) {
    errors.push("missing sandbox client secret")
  }

  if (options.requireAuthCode === true && config.authCode === null) {
    errors.push("missing sandbox auth code")
  }

  if (options.requireApproval === true && config.approval !== approvalPhrase) {
    errors.push("missing exact LOOP 148 sandbox OAuth approval")
  }

  if (!isSandboxAuthEndpoint(config.authUrl)) {
    errors.push("authorization endpoint must be eBay Sandbox")
  }

  if (!isSandboxTokenEndpoint(config.tokenUrl)) {
    errors.push("token endpoint must be eBay Sandbox")
  }

  if (hasProductionEndpoint(config.authUrl) || hasProductionEndpoint(config.tokenUrl)) {
    errors.push("production OAuth endpoint is blocked")
  }

  if (config.scopes.length === 0) {
    warnings.push("no scopes configured")
  }

  return {
    valid:
      errors.length === 0,
    errors,
    warnings,
    productionBlocked:
      true,
    sandboxEndpoint:
      isSandboxAuthEndpoint(config.authUrl) && isSandboxTokenEndpoint(config.tokenUrl),
  }
}

export function buildEbaySandboxAuthorizationUrl(
  config: ReturnType<typeof buildEbaySandboxOAuthConfig>,
  options: OAuthOptions = {},
) {
  const validation =
    validateEbaySandboxOAuthConfig(
      config,
      {
        ...options,
        requireClientSecret:
          false,
        requireAuthCode:
          false,
      },
    )

  if (!validation.valid) {
    return {
      authUrlBuilt:
        false,
      authorizationUrl:
        null,
      sandboxEndpoint:
        validation.sandboxEndpoint,
      errors:
        validation.errors,
      warnings:
        validation.warnings,
    }
  }

  const url =
    new URL(config.authUrl)
  url.searchParams.set("client_id", config.clientId ?? "")
  url.searchParams.set("redirect_uri", config.runame ?? "")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", config.scopes.join(" "))
  if (config.state !== null) {
    url.searchParams.set("state", config.state)
  }

  return {
    authUrlBuilt:
      true,
    authorizationUrl:
      url.toString(),
    sandboxEndpoint:
      true,
    scopes:
      [...config.scopes],
    errors:
      [],
    warnings:
      validation.warnings,
  }
}

export function parseEbaySandboxCallback(
  input: Pick<OAuthInput, "callbackUrl" | "authCode" | "state"> = {},
  options: OAuthOptions = {},
) {
  void options
  const callbackUrl =
    normalizeText(input.callbackUrl)
  const directAuthCode =
    normalizeText(input.authCode)
  const directState =
    normalizeText(input.state)
  const errors: string[] = []
  let authCode =
    directAuthCode
  let state =
    directState

  if (callbackUrl !== null) {
    try {
      const parsed =
        new URL(callbackUrl)
      authCode =
        normalizeText(parsed.searchParams.get("code")) ?? authCode
      state =
        normalizeText(parsed.searchParams.get("state")) ?? state
    } catch {
      errors.push("callback URL is not parseable")
    }
  }

  if (authCode === null) {
    errors.push("missing sandbox auth code")
  }

  return {
    callbackParsed:
      errors.length === 0,
    authCodePresent:
      authCode !== null,
    authCode,
    authCodeRedacted:
      redact(authCode),
    state,
    stateRedacted:
      redact(state),
    errors,
  }
}

export function buildEbaySandboxTokenExchangeRequest(
  config: ReturnType<typeof buildEbaySandboxOAuthConfig>,
  callback: ReturnType<typeof parseEbaySandboxCallback>,
  options: OAuthOptions = {},
) {
  const validation =
    validateEbaySandboxOAuthConfig(
      {
        ...config,
        authCode:
          callback.authCode,
      },
      {
        ...options,
        requireApproval:
          true,
        requireClientSecret:
          true,
        requireAuthCode:
          true,
      },
    )
  const errors =
    [...validation.errors]

  if (!callback.callbackParsed) {
    errors.push(...callback.errors)
  }

  if (errors.length > 0) {
    return {
      tokenExchangeReady:
        false,
      method:
        "POST",
      tokenUrl:
        config.tokenUrl,
      sandboxEndpoint:
        validation.sandboxEndpoint,
      headers:
        {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Authorization:
            "Basic REDACTED",
        },
      bodyPreview:
        {
          grant_type:
            "authorization_code",
          code:
            callback.authCodeRedacted,
          redirect_uri:
            config.runame,
        },
      requestBody:
        null,
      errors,
      warnings:
        validation.warnings,
    }
  }

  const requestBody =
    new URLSearchParams()
  requestBody.set("grant_type", "authorization_code")
  requestBody.set("code", callback.authCode ?? "")
  requestBody.set("redirect_uri", config.runame ?? "")

  return {
    tokenExchangeReady:
      true,
    method:
      "POST",
    tokenUrl:
      config.tokenUrl,
    sandboxEndpoint:
      true,
    headers:
      {
        "Content-Type":
          "application/x-www-form-urlencoded",
        Authorization:
          "Basic REDACTED",
      },
    bodyPreview:
      {
        grant_type:
          "authorization_code",
        code:
          callback.authCodeRedacted,
        redirect_uri:
          config.runame,
      },
    requestBody:
      requestBody.toString(),
    errors:
      [],
    warnings:
      validation.warnings,
  }
}

export function sanitizeEbayOAuthReport(
  report: Record<string, unknown>,
  options: OAuthOptions = {},
) {
  void options
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(report)) {
    const lowered =
      key.toLowerCase()

    if (
      lowered.includes("secret") ||
      lowered.includes("token") ||
      lowered.includes("code")
    ) {
      sanitized[key] =
        typeof value === "string"
          ? redact(value)
          : typeof value === "boolean"
            ? value
            : value === null || value === undefined
              ? value
              : "REDACTED"
      continue
    }

    sanitized[key] =
      value
  }

  return sanitized
}

export function summarizeEbaySandboxOAuthReadiness(
  result: {
    sandboxAuthUrlReady?: boolean | null
    tokenExchangeExecuted?: boolean | null
    tokenStored?: boolean | null
    productionBlocked?: boolean | null
    draftCreated?: boolean | null
    publicationCreated?: boolean | null
    stagingWriteExecuted?: boolean | null
    ebayProductionUsed?: boolean | null
    ebaySandboxReady?: boolean | null
    errors?: string[] | null
    warnings?: string[] | null
  },
) {
  return {
    sandboxAuthUrlReady:
      result.sandboxAuthUrlReady === true,
    tokenExchangeExecuted:
      result.tokenExchangeExecuted === true,
    tokenStored:
      result.tokenStored === true,
    productionBlocked:
      result.productionBlocked !== false,
    draftCreated:
      false,
    publicationCreated:
      false,
    stagingWriteExecuted:
      false,
    ebayProductionUsed:
      false,
    ebaySandboxReady:
      result.ebaySandboxReady === true,
    errors:
      result.errors ?? [],
    warnings:
      result.warnings ?? [],
    nextLoop:
      "149",
  }
}

export function getEbaySandboxOAuthChecklist() {
  return [
    "confirm target env is sandbox",
    "confirm Sandbox auth and token endpoints are used",
    "confirm Production OAuth endpoints are blocked",
    "confirm secrets, auth codes, and tokens are redacted",
    "confirm token exchange requires explicit LOOP 148 approval",
    "confirm optional token output is /tmp only",
    "confirm no draft, publication, Staging write, WhatsApp real send, OpenAI, or Production API",
    "confirm next loop is 149 — eBay Sandbox Draft Listing",
  ]
}
