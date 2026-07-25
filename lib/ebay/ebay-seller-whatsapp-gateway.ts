import { getEbayProRuntimeBoundary } from "./environment-boundaries"

type FetchLike = typeof fetch

export type SellerWhatsAppGatewayConfiguration = {
  enabled: boolean
  configurationComplete: boolean
  ready: boolean
  status: "DISABLED" | "NOT_READY" | "READY"
  provider: "meta_cloud_api"
  recipientConfigured: boolean
  phoneNumberIdConfigured: boolean
  businessAccountIdConfigured: boolean
  accessTokenConfigured: boolean
  immediateTemplateConfigured: boolean
  digestTemplateConfigured: boolean
  templateLanguage: string
  preflightStatus: "NOT_RUN" | "PASSED" | "FAILED" | "EXPIRED"
  preflightCheckedAt: string | null
  preflightExpiresAt: string | null
  deliveryAttemptAllowed: boolean
  realDeliveryPermitted: boolean
}

export type SellerWhatsAppTemplatePreflight = {
  approved: boolean
  languageMatches: boolean
  bodyParametersValid: boolean
  compatible: boolean
  errorCode: string | null
}

export type SellerWhatsAppPreflightResult = {
  success: boolean
  status: "PASSED" | "FAILED"
  checkedAt: string
  expiresAt: string
  cached: boolean
  phoneNumberAccessible: boolean
  phoneNumberErrorCode: string | null
  templates: {
    immediate: SellerWhatsAppTemplatePreflight
    digest: SellerWhatsAppTemplatePreflight
  }
  errorCodes: string[]
}

export type SellerWhatsAppTemplateMessage = {
  deliveryClass: "immediate" | "digest"
  priorityLabel: string
  title: string
  summary: string
  action: string
}

export type SellerWhatsAppGatewayResult = {
  success: boolean
  statusCode: number | null
  providerMessageId: string | null
  errorCode: string | null
}

function env(name: string) {
  return process.env[name]?.trim() ?? ""
}

function normalizeSellerRecipient(value: string) {
  const digits = value.replace(/\D/g, "")
  return digits.length >= 8 && digits.length <= 15 ? digits : ""
}

function safeText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

const META_GRAPH_VERSION = "v25.0"
const PREFLIGHT_SUCCESS_TTL_MS = 5 * 60 * 1_000
const PREFLIGHT_FAILURE_TTL_MS = 30 * 1_000
const APPROVED_TEMPLATE_TEXT_BUDGET = {
  priority: 40,
  title: 90,
  summary: 220,
  action: 300,
} as const

let preflightCache: {
  key: string
  expiresAtMs: number
  result: SellerWhatsAppPreflightResult
} | null = null

function preflightConfigurationKey() {
  return [
    env("WHATSAPP_PHONE_NUMBER_ID"),
    env("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    env("EBAY_SELLER_WHATSAPP_TEMPLATE_NAME"),
    env("EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME"),
    env("EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE") || "es",
  ].join("|")
}

function currentPreflightCache(now = Date.now()) {
  if (!preflightCache || preflightCache.key !== preflightConfigurationKey()) {
    return null
  }
  return preflightCache.expiresAtMs > now ? preflightCache : null
}

export function getSellerWhatsAppPreflightSnapshot() {
  if (!preflightCache || preflightCache.key !== preflightConfigurationKey()) {
    return null
  }
  return {
    ...preflightCache.result,
    cached: true,
    expired: preflightCache.expiresAtMs <= Date.now(),
  }
}

export function getSellerWhatsAppGatewayConfiguration(): SellerWhatsAppGatewayConfiguration {
  const environmentBoundary = getEbayProRuntimeBoundary({
    pathname: "/api/admin/ebay/seller-whatsapp-alerts",
    method: "POST",
  })
  const enabled = env("EBAY_SELLER_WHATSAPP_ENABLED").toLowerCase() === "true"
  const recipientConfigured = Boolean(
    normalizeSellerRecipient(env("EBAY_SELLER_WHATSAPP_RECIPIENT")),
  )
  const phoneNumberIdConfigured = Boolean(env("WHATSAPP_PHONE_NUMBER_ID"))
  const businessAccountIdConfigured = Boolean(
    env("WHATSAPP_BUSINESS_ACCOUNT_ID"),
  )
  const accessTokenConfigured = Boolean(env("WHATSAPP_ACCESS_TOKEN"))
  const immediateTemplateConfigured = Boolean(
    env("EBAY_SELLER_WHATSAPP_TEMPLATE_NAME"),
  )
  const digestTemplateConfigured = Boolean(
    env("EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME"),
  )
  const configurationComplete =
    recipientConfigured &&
    phoneNumberIdConfigured &&
    businessAccountIdConfigured &&
    accessTokenConfigured &&
    immediateTemplateConfigured &&
    digestTemplateConfigured
  const cachedPreflight = currentPreflightCache()
  const ready = configurationComplete && cachedPreflight?.result.success === true
  const preflightStatus = cachedPreflight
    ? cachedPreflight.result.success ? "PASSED" : "FAILED"
    : preflightCache?.key === preflightConfigurationKey()
      ? "EXPIRED"
      : "NOT_RUN"

  return {
    enabled,
    configurationComplete,
    ready,
    status: !ready ? "NOT_READY" : !enabled ? "DISABLED" : "READY",
    provider: "meta_cloud_api",
    recipientConfigured,
    phoneNumberIdConfigured,
    businessAccountIdConfigured,
    accessTokenConfigured,
    immediateTemplateConfigured,
    digestTemplateConfigured,
    templateLanguage:
      env("EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE") || "es",
    preflightStatus,
    preflightCheckedAt: preflightCache?.result.checkedAt ?? null,
    preflightExpiresAt: preflightCache?.result.expiresAt ?? null,
    deliveryAttemptAllowed: enabled && configurationComplete
      && !environmentBoundary.blocked,
    realDeliveryPermitted: enabled && ready && !environmentBoundary.blocked,
  }
}

function safeProviderErrorCode(value: unknown, status: number) {
  const object = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {}
  const providerError = object.error && typeof object.error === "object"
    ? object.error as Record<string, unknown>
    : {}
  const raw = String(providerError.code ?? "")
  return /^\d{1,10}$/.test(raw)
    ? `META_${raw}`
    : `META_HTTP_${status}`
}

function safeRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function responseJson(response: Response) {
  try {
    return JSON.parse(await response.text()) as unknown
  } catch {
    return null
  }
}

function templatePreflight(
  data: unknown,
  expectedName: string,
  expectedLanguage: string,
): SellerWhatsAppTemplatePreflight {
  const rows = Array.isArray(safeRecord(data).data)
    ? safeRecord(data).data as unknown[]
    : []
  const named = rows.map(safeRecord).filter((row) => row.name === expectedName)
  const template = named.find((row) => row.language === expectedLanguage)
  if (!template) {
    return {
      approved: false,
      languageMatches: false,
      bodyParametersValid: false,
      compatible: false,
      errorCode: named.length
        ? "SELLER_WHATSAPP_TEMPLATE_LANGUAGE_MISMATCH"
        : "SELLER_WHATSAPP_TEMPLATE_NOT_FOUND",
    }
  }

  const components = Array.isArray(template.components)
    ? template.components.map(safeRecord)
    : []
  const bodies = components.filter((component) => component.type === "BODY")
  const bodyText = typeof bodies[0]?.text === "string" ? bodies[0].text : ""
  const positionalParameters = [...bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((match) => Number(match[1]))
  const allVariables = [...bodyText.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
  const bodyParametersValid = bodies.length === 1 &&
    allVariables.length === 4 &&
    positionalParameters.length === 4 &&
    positionalParameters.every((value, index) => value === index + 1)
  const unsupportedDynamicComponent = components.some((component) => {
    if (component.type === "BODY") return false
    if (
      component.type === "HEADER" &&
      ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(String(component.format))
    ) return true
    return JSON.stringify(component).includes("{{")
  })
  const approved = template.status === "APPROVED"
  const compatible = approved && bodyParametersValid && !unsupportedDynamicComponent
  return {
    approved,
    languageMatches: true,
    bodyParametersValid,
    compatible,
    errorCode: !approved
      ? "SELLER_WHATSAPP_TEMPLATE_NOT_APPROVED"
      : !bodyParametersValid
        ? "SELLER_WHATSAPP_TEMPLATE_BODY_PARAMETERS_INVALID"
        : unsupportedDynamicComponent
          ? "SELLER_WHATSAPP_TEMPLATE_DYNAMIC_COMPONENT_UNSUPPORTED"
          : null,
  }
}

function failedTemplatePreflight(errorCode: string): SellerWhatsAppTemplatePreflight {
  return {
    approved: false,
    languageMatches: false,
    bodyParametersValid: false,
    compatible: false,
    errorCode,
  }
}

export async function preflightSellerWhatsAppGateway(
  options: {
    fetchImpl?: FetchLike
    timeoutMs?: number
    force?: boolean
  } = {},
): Promise<SellerWhatsAppPreflightResult> {
  const now = Date.now()
  const cached = !options.force ? currentPreflightCache(now) : null
  if (cached) return { ...cached.result, cached: true }

  const configuration = {
    recipient: normalizeSellerRecipient(env("EBAY_SELLER_WHATSAPP_RECIPIENT")),
    token: env("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
    businessAccountId: env("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    immediateTemplateName: env("EBAY_SELLER_WHATSAPP_TEMPLATE_NAME"),
    digestTemplateName: env("EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME"),
    language: env("EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE") || "es",
  }
  const missingCodes = [
    !configuration.recipient && "SELLER_WHATSAPP_RECIPIENT_MISSING",
    !configuration.token && "SELLER_WHATSAPP_ACCESS_TOKEN_MISSING",
    !configuration.phoneNumberId && "SELLER_WHATSAPP_PHONE_NUMBER_ID_MISSING",
    !configuration.businessAccountId && "SELLER_WHATSAPP_BUSINESS_ACCOUNT_ID_MISSING",
    !configuration.immediateTemplateName && "SELLER_WHATSAPP_IMMEDIATE_TEMPLATE_MISSING",
    !configuration.digestTemplateName && "SELLER_WHATSAPP_DIGEST_TEMPLATE_MISSING",
  ].filter((value): value is string => Boolean(value))

  const buildResult = (
    success: boolean,
    phoneNumberAccessible: boolean,
    phoneNumberErrorCode: string | null,
    immediate: SellerWhatsAppTemplatePreflight,
    digest: SellerWhatsAppTemplatePreflight,
    errorCodes: string[],
  ) => {
    const checkedAtMs = Date.now()
    const expiresAtMs = checkedAtMs + (
      success ? PREFLIGHT_SUCCESS_TTL_MS : PREFLIGHT_FAILURE_TTL_MS
    )
    const result: SellerWhatsAppPreflightResult = {
      success,
      status: success ? "PASSED" : "FAILED",
      checkedAt: new Date(checkedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      cached: false,
      phoneNumberAccessible,
      phoneNumberErrorCode,
      templates: { immediate, digest },
      errorCodes: [...new Set(errorCodes)],
    }
    preflightCache = {
      key: preflightConfigurationKey(),
      expiresAtMs,
      result,
    }
    return result
  }

  if (missingCodes.length) {
    const configurationError = "SELLER_WHATSAPP_PREFLIGHT_CONFIGURATION_INCOMPLETE"
    return buildResult(
      false,
      false,
      configuration.phoneNumberId ? null : "SELLER_WHATSAPP_PHONE_NUMBER_ID_MISSING",
      failedTemplatePreflight(configurationError),
      failedTemplatePreflight(configurationError),
      missingCodes,
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1_000, Math.min(options.timeoutMs ?? 10_000, 20_000)),
  )
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { Authorization: `Bearer ${configuration.token}` }
  const templateUrl = (name: string) => {
    const params = new URLSearchParams({
      name,
      fields: "name,status,language,components",
      limit: "100",
    })
    return `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(configuration.businessAccountId)}/message_templates?${params}`
  }

  try {
    const [phoneResponse, immediateResponse, digestResponse] = await Promise.all([
      fetchImpl(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(configuration.phoneNumberId)}?fields=id`,
        { headers, signal: controller.signal },
      ),
      fetchImpl(templateUrl(configuration.immediateTemplateName), {
        headers,
        signal: controller.signal,
      }),
      fetchImpl(templateUrl(configuration.digestTemplateName), {
        headers,
        signal: controller.signal,
      }),
    ])
    const [phoneData, immediateData, digestData] = await Promise.all([
      responseJson(phoneResponse),
      responseJson(immediateResponse),
      responseJson(digestResponse),
    ])
    const phoneNumberAccessible = phoneResponse.ok &&
      safeRecord(phoneData).id === configuration.phoneNumberId
    const phoneNumberErrorCode = phoneNumberAccessible
      ? null
      : phoneResponse.ok
        ? "SELLER_WHATSAPP_PHONE_NUMBER_ID_MISMATCH"
        : safeProviderErrorCode(phoneData, phoneResponse.status)
    const immediate = immediateResponse.ok
      ? templatePreflight(
          immediateData,
          configuration.immediateTemplateName,
          configuration.language,
        )
      : failedTemplatePreflight(
          safeProviderErrorCode(immediateData, immediateResponse.status),
        )
    const digest = digestResponse.ok
      ? templatePreflight(
          digestData,
          configuration.digestTemplateName,
          configuration.language,
        )
      : failedTemplatePreflight(
          safeProviderErrorCode(digestData, digestResponse.status),
        )
    const errorCodes = [
      phoneNumberErrorCode,
      immediate.errorCode,
      digest.errorCode,
    ].filter((value): value is string => Boolean(value))
    return buildResult(
      phoneNumberAccessible && immediate.compatible && digest.compatible,
      phoneNumberAccessible,
      phoneNumberErrorCode,
      immediate,
      digest,
      errorCodes,
    )
  } catch (error) {
    const errorCode = error instanceof Error && error.name === "AbortError"
      ? "META_REQUEST_TIMEOUT"
      : "META_REQUEST_FAILED"
    return buildResult(
      false,
      false,
      errorCode,
      failedTemplatePreflight(errorCode),
      failedTemplatePreflight(errorCode),
      [errorCode],
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function sendSellerWhatsAppApprovedTemplate(
  message: SellerWhatsAppTemplateMessage,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<SellerWhatsAppGatewayResult> {
  const configuration = getSellerWhatsAppGatewayConfiguration()
  const environmentBoundary = getEbayProRuntimeBoundary({
    pathname: "/api/admin/ebay/seller-whatsapp-alerts",
    method: "POST",
  })
  if (environmentBoundary.blocked) {
    return {
      success: false,
      statusCode: null,
      providerMessageId: null,
      errorCode: "SELLER_WHATSAPP_ENVIRONMENT_BLOCKED",
    }
  }
  if (!configuration.enabled) {
    return {
      success: false,
      statusCode: null,
      providerMessageId: null,
      errorCode: "SELLER_WHATSAPP_DISABLED",
    }
  }
  if (!configuration.configurationComplete) {
    return {
      success: false,
      statusCode: null,
      providerMessageId: null,
      errorCode: "SELLER_WHATSAPP_NOT_READY",
    }
  }
  const preflight = await preflightSellerWhatsAppGateway({
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  if (!preflight.success) {
    return {
      success: false,
      statusCode: null,
      providerMessageId: null,
      errorCode: "SELLER_WHATSAPP_PREFLIGHT_FAILED",
    }
  }

  const token = env("WHATSAPP_ACCESS_TOKEN")
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID")
  const recipient = normalizeSellerRecipient(
    env("EBAY_SELLER_WHATSAPP_RECIPIENT"),
  )
  const templateName = message.deliveryClass === "digest"
    ? env("EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME")
    : env("EBAY_SELLER_WHATSAPP_TEMPLATE_NAME")
  const templateLanguage =
    env("EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE") || "es"
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1_000, Math.min(options.timeoutMs ?? 10_000, 20_000)),
  )

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLanguage },
            components: [{
              type: "body",
              parameters: [
                { type: "text", text: safeText(message.priorityLabel, APPROVED_TEMPLATE_TEXT_BUDGET.priority) },
                { type: "text", text: safeText(message.title, APPROVED_TEMPLATE_TEXT_BUDGET.title) },
                { type: "text", text: safeText(message.summary, APPROVED_TEMPLATE_TEXT_BUDGET.summary) },
                { type: "text", text: safeText(message.action, APPROVED_TEMPLATE_TEXT_BUDGET.action) },
              ],
            }],
          },
        }),
        signal: controller.signal,
      },
    )

    const responseText = await response.text()
    let data: unknown = null
    try {
      data = JSON.parse(responseText)
    } catch {
      data = null
    }
    const record = data && typeof data === "object"
      ? data as Record<string, unknown>
      : {}
    const messages = Array.isArray(record.messages)
      ? record.messages as Array<Record<string, unknown>>
      : []
    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        providerMessageId: null,
        errorCode: safeProviderErrorCode(data, response.status),
      }
    }
    const providerMessageId = typeof messages[0]?.id === "string"
      ? messages[0].id.slice(0, 300)
      : null
    return {
      success: true,
      statusCode: response.status,
      providerMessageId,
      errorCode: null,
    }
  } catch (error) {
    return {
      success: false,
      statusCode: null,
      providerMessageId: null,
      errorCode: error instanceof Error && error.name === "AbortError"
        ? "META_REQUEST_TIMEOUT"
        : "META_REQUEST_FAILED",
    }
  } finally {
    clearTimeout(timeout)
  }
}
