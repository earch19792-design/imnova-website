type FetchLike = typeof fetch

export type SellerWhatsAppGatewayConfiguration = {
  enabled: boolean
  ready: boolean
  status: "DISABLED" | "NOT_READY" | "READY"
  provider: "meta_cloud_api"
  recipientConfigured: boolean
  phoneNumberIdConfigured: boolean
  accessTokenConfigured: boolean
  immediateTemplateConfigured: boolean
  digestTemplateConfigured: boolean
  templateLanguage: string
  realDeliveryPermitted: boolean
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

export function getSellerWhatsAppGatewayConfiguration(): SellerWhatsAppGatewayConfiguration {
  const enabled = env("EBAY_SELLER_WHATSAPP_ENABLED").toLowerCase() === "true"
  const recipientConfigured = Boolean(
    normalizeSellerRecipient(env("EBAY_SELLER_WHATSAPP_RECIPIENT")),
  )
  const phoneNumberIdConfigured = Boolean(env("WHATSAPP_PHONE_NUMBER_ID"))
  const accessTokenConfigured = Boolean(env("WHATSAPP_ACCESS_TOKEN"))
  const immediateTemplateConfigured = Boolean(
    env("EBAY_SELLER_WHATSAPP_TEMPLATE_NAME"),
  )
  const digestTemplateConfigured = Boolean(
    env("EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME"),
  )
  const ready =
    recipientConfigured &&
    phoneNumberIdConfigured &&
    accessTokenConfigured &&
    immediateTemplateConfigured &&
    digestTemplateConfigured

  return {
    enabled,
    ready,
    status: !ready ? "NOT_READY" : !enabled ? "DISABLED" : "READY",
    provider: "meta_cloud_api",
    recipientConfigured,
    phoneNumberIdConfigured,
    accessTokenConfigured,
    immediateTemplateConfigured,
    digestTemplateConfigured,
    templateLanguage:
      env("EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE") || "es",
    realDeliveryPermitted: enabled && ready,
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

export async function sendSellerWhatsAppApprovedTemplate(
  message: SellerWhatsAppTemplateMessage,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<SellerWhatsAppGatewayResult> {
  const configuration = getSellerWhatsAppGatewayConfiguration()
  if (!configuration.enabled) {
    return {
      success: false,
      statusCode: null,
      providerMessageId: null,
      errorCode: "SELLER_WHATSAPP_DISABLED",
    }
  }
  if (!configuration.ready) {
    return {
      success: false,
      statusCode: null,
      providerMessageId: null,
      errorCode: "SELLER_WHATSAPP_NOT_READY",
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
      `https://graph.facebook.com/v25.0/${encodeURIComponent(phoneNumberId)}/messages`,
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
                { type: "text", text: safeText(message.priorityLabel, 40) },
                { type: "text", text: safeText(message.title, 120) },
                { type: "text", text: safeText(message.summary, 500) },
                { type: "text", text: safeText(message.action, 500) },
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
