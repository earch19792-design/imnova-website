const fallbackLaunchImageUrl =
  "https://imnova-website-z1qh.vercel.app/images/mash-coffee.png"

const fallbackRecipientPhones = [
  "50558199840",
]

export function normalizeWhatsAppPhone(
  phone: string
) {

  const digits =
    phone.replace(/\D/g, "")

  if (!digits) {
    return null
  }

  if (digits.length === 8) {
    return `505${digits}`
  }

  return digits

}

function getWhatsAppRecipientPhones(
  additionalPhones: string[] = []
) {

  const configuredPhones =
    process.env.WHATSAPP_RECIPIENT_PHONES
      ?.split(",")
      .map((phone) =>
        normalizeWhatsAppPhone(phone)
      )
      .filter(
        (phone): phone is string =>
          Boolean(phone)
      ) || []

  const communityPhones =
    additionalPhones
      .map((phone) =>
        normalizeWhatsAppPhone(phone)
      )
      .filter(
        (phone): phone is string =>
          Boolean(phone)
      )

  const phones =
    configuredPhones.length > 0
      ? [
          ...configuredPhones,
          ...communityPhones,
        ]
      : [
          ...fallbackRecipientPhones,
          ...communityPhones,
        ]

  return Array.from(new Set(phones))

}

function getNormalizedRecipientPhones(
  recipientPhones: string[] = []
) {
  return Array.from(
    new Set(
      recipientPhones
        .map((phone) =>
          normalizeWhatsAppPhone(phone)
        )
        .filter(
          (phone): phone is string =>
            Boolean(phone)
        )
    )
  )
}

function maskPhone(
  phone?: string | null
) {
  const digits =
    (phone || "").replace(/\D/g, "")

  if (digits.length <= 4) {
    return "****"
  }

  return `***${digits.slice(-4)}`
}

function getSafeWhatsAppData(
  data: any
) {
  return {
    messageId:
      data?.messages?.[0]?.id ||
      null,
    messageStatus:
      data?.messages?.[0]?.message_status ||
      null,
    waId:
      data?.contacts?.[0]?.wa_id
        ? maskPhone(
            data.contacts[0].wa_id
          )
        : null,
    error:
      data?.error
        ? {
            message:
              data.error.message,
            type:
              data.error.type,
            code:
              data.error.code,
          }
        : null,
  }
}

export function isValidAbsoluteUrl(
  imageUrl?: string
) {

  return Boolean(
    imageUrl &&
    imageUrl.startsWith("https://")
  )

}

export async function sendWhatsAppWelcome({
  phone,
  name,
}: {
  phone: string
  name?: string | null
}) {

  const token =
    process.env.WHATSAPP_ACCESS_TOKEN?.trim()

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

  const templateName =
    process.env.WHATSAPP_WELCOME_TEMPLATE_NAME?.trim()

  const normalizedPhone =
    normalizeWhatsAppPhone(phone)

  if (
    !token ||
    !phoneId ||
    !templateName
  ) {
    return {
      success: false,
      error:
        "WHATSAPP_WELCOME_NOT_CONFIGURED",
    }
  }

  if (!normalizedPhone) {
    return {
      success: false,
      error:
        "INVALID_WHATSAPP_PHONE",
    }
  }

  const memberName =
    name?.trim() || "miembro IMNOVA"

  const templateHasNameParam =
    process.env.WHATSAPP_WELCOME_TEMPLATE_HAS_NAME_PARAM ===
    "true"

  const baseTemplate = {
    name:
      templateName,
    language: {
      code:
        "es",
    },
  }

  const payloadWithName = {
    messaging_product:
      "whatsapp",
    to:
      normalizedPhone,
    type:
      "template",
    template: {
      ...baseTemplate,
      components: [
        {
          type:
            "body",
          parameters: [
            {
              type:
                "text",
              text:
                memberName,
            },
          ],
        },
      ],
    },
  }

  const payloadWithoutParams = {
    messaging_product:
      "whatsapp",
    to:
      normalizedPhone,
    type:
      "template",
    template: {
      ...baseTemplate,
    },
  }

  try {
    const sendTemplate =
      async (
        payload:
          typeof payloadWithName |
          typeof payloadWithoutParams
      ) => {
        const response =
          await fetch(
            `https://graph.facebook.com/v25.0/${phoneId}/messages`,
            {
              method:
                "POST",
              headers: {
                Authorization:
                  `Bearer ${token}`,
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify(payload),
            }
          )

        const responseText =
          await response.text()

        let data

        try {
          data =
            JSON.parse(responseText)
        } catch {
          data =
            responseText
        }

        return {
          response,
          data,
        }
      }

    const firstPayload =
      templateHasNameParam
        ? payloadWithName
        : payloadWithoutParams

    const fallbackPayload =
      templateHasNameParam
        ? payloadWithoutParams
        : payloadWithName

    let {
      response,
      data,
    } =
      await sendTemplate(
        firstPayload
      )

    const errorMessage =
      typeof data?.error?.message ===
      "string"
        ? data.error.message.toLowerCase()
        : ""

    const shouldRetryAlternativePayload =
      !response.ok

    if (shouldRetryAlternativePayload) {
      const retryResult =
        await sendTemplate(
          fallbackPayload
        )

      if (
        retryResult.response.ok ||
        errorMessage.includes("parameter") ||
        errorMessage.includes("component") ||
        errorMessage.includes("localizable") ||
        errorMessage.includes("number of parameters") ||
        errorMessage.includes("param")
      ) {
        response =
          retryResult.response
        data =
          retryResult.data
      }
    }

    if (!response.ok) {
      console.error(
        "WHATSAPP WELCOME META ERROR:",
        {
          status:
            response.status,
          phone:
            maskPhone(
              normalizedPhone
            ),
          data:
            getSafeWhatsAppData(data),
        }
      )

      return {
        success: false,
        status:
          response.status,
        error:
          "WHATSAPP_WELCOME_FAILED",
        data:
          getSafeWhatsAppData(data),
      }
    }

    return {
      success: true,
      status:
        response.status,
      phone:
        maskPhone(
          normalizedPhone
        ),
      waId:
        data?.contacts?.[0]?.wa_id
          ? maskPhone(
              data.contacts[0].wa_id
            )
          : null,
      messageId:
        data?.messages?.[0]?.id ||
        null,
      messageStatus:
        data?.messages?.[0]?.message_status ||
        null,
      data:
        getSafeWhatsAppData(data),
    }
  } catch (error) {
    console.error(
      "WHATSAPP WELCOME ERROR:",
      error
    )

    return {
      success: false,
      error:
        String(error),
    }
  }

}

export async function sendWhatsAppUpdate(
  product: string,
  status: string,
  progress: string,
  imageUrl = "",
  recipientPhones: string[] = []
) {

  const token =
    process.env.WHATSAPP_ACCESS_TOKEN?.trim()

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

  const phones =
    getWhatsAppRecipientPhones(
      recipientPhones
    )

  if (!token || !phoneId) {

    console.error(
      "FALTAN VARIABLES DE ENTORNO WHATSAPP"
    )

    return {
      success: false,
      error:
        "FALTAN VARIABLES DE ENTORNO WHATSAPP",
    }

  }

  const results = []

  for (const phone of phones) {

    try {

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 300)
      )

      const isProductLaunch =
        status === "Disponible"

      const selectedTemplate =
        isProductLaunch
          ? process.env.WHATSAPP_PRODUCT_LAUNCH_TEMPLATE_NAME?.trim() ||
            "imnova_product_launch"
          : "imnova_update"

      const selectedImageUrl =
        isValidAbsoluteUrl(imageUrl)
          ? imageUrl
          : fallbackLaunchImageUrl

      const template =
        isProductLaunch
          ? {
              name:
                selectedTemplate,

              language: {
                code:
                  "es",
              },

              components: [
                {
                  type:
                    "header",
                  parameters: [
                    {
                      type:
                        "image",
                      image: {
                        link:
                          selectedImageUrl,
                      },
                    },
                  ],
                },
                {
                  type:
                    "body",
                  parameters: [
                    {
                      type:
                        "text",
                      text:
                        product,
                    },
                  ],
                },
              ],
            }
          : {
              name:
                selectedTemplate,

              language: {
                code:
                  "es",
              },

              components: [
                {
                  type:
                    "body",
                  parameters: [
                    {
                      type:
                        "text",
                      text:
                        product,
                    },
                    {
                      type:
                        "text",
                      text:
                        status,
                    },
                    {
                      type:
                        "text",
                      text:
                        progress,
                    },
                  ],
                },
              ],
            }

      const payload = {
        messaging_product:
          "whatsapp",

        to:
          phone,

        type:
          "template",

        template,
      }

      const response =
        await fetch(
          `https://graph.facebook.com/v25.0/${phoneId}/messages`,
          {
            method:
              "POST",

            headers: {
              Authorization:
                `Bearer ${token}`,

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(payload),
          }
        )

      const text =
        await response.text()

      let data

      try {

        data =
          JSON.parse(text)

      } catch {

        data =
          text

      }

      console.log(
        "WHATSAPP META RESPONSE:",
        {
          phone:
            maskPhone(phone),
          status:
            response.status,
          ok:
            response.ok,
          data:
            getSafeWhatsAppData(data),
        }
      )

      if (!response.ok) {

        console.error(
          "WHATSAPP META ERROR:",
          {
            status:
              response.status,
            ok:
              response.ok,
            phone:
              maskPhone(phone),
            responseBody:
              getSafeWhatsAppData(data),
          }
        )

      }

      results.push({
        phone:
          maskPhone(phone),
        success:
          response.ok,
        status:
          response.status,
        data:
          getSafeWhatsAppData(data),
      })

    } catch (error) {

      console.error(
        "WHATSAPP ERROR:",
        maskPhone(phone),
        error
      )

      results.push({
        phone:
          maskPhone(phone),
        success:
          false,
        error:
          String(error),
      })

    }

  }

  const successful =
    results.filter(
      (result) =>
        result.success
    ).length

  return {
    success:
      successful > 0,
    total:
      phones.length,
    successful,
    failed:
      phones.length -
      successful,
    results,
  }

}

export async function sendWhatsAppDistributionChannel({
  product,
  channelName,
  locationLabel,
  recipientPhones,
}: {
  product: string
  channelName: string
  locationLabel: string
  recipientPhones: string[]
}) {

  const token =
    process.env.WHATSAPP_ACCESS_TOKEN?.trim()

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

  const templateName =
    process.env.WHATSAPP_DISTRIBUTION_CHANNEL_TEMPLATE_NAME?.trim() ||
    "imnova_distribution_channel"

  const phones =
    getNormalizedRecipientPhones(
      recipientPhones
    )

  if (!token || !phoneId || !templateName) {

    console.error(
      "FALTAN VARIABLES DE ENTORNO WHATSAPP PARA CANAL DE DISTRIBUCION"
    )

    return {
      success: false,
      error:
        "WHATSAPP_DISTRIBUTION_CHANNEL_NOT_CONFIGURED",
      total:
        phones.length,
      successful: 0,
      failed:
        phones.length,
      results: [],
    }

  }

  if (phones.length === 0) {
    return {
      success: false,
      error:
        "NO_DISTRIBUTION_CHANNEL_WHATSAPP_RECIPIENTS",
      total: 0,
      successful: 0,
      failed: 0,
      results: [],
    }
  }

  const results = []

  for (const phone of phones) {

    try {

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 300)
      )

      const payload = {
        messaging_product:
          "whatsapp",
        to:
          phone,
        type:
          "template",
        template: {
          name:
            templateName,
          language: {
            code:
              "es",
          },
          components: [
            {
              type:
                "body",
              parameters: [
                {
                  type:
                    "text",
                  text:
                    product || "Producto IMNOVA",
                },
                {
                  type:
                    "text",
                  text:
                    channelName || "nuevo distribuidor IMNOVA",
                },
                {
                  type:
                    "text",
                  text:
                    locationLabel || "ubicacion disponible",
                },
              ],
            },
          ],
        },
      }

      const response =
        await fetch(
          `https://graph.facebook.com/v25.0/${phoneId}/messages`,
          {
            method:
              "POST",
            headers: {
              Authorization:
                `Bearer ${token}`,
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(payload),
          }
        )

      const text =
        await response.text()

      let data

      try {
        data =
          JSON.parse(text)
      } catch {
        data =
          text
      }

      if (!response.ok) {
        console.error(
          "WHATSAPP DISTRIBUTION CHANNEL META ERROR:",
          {
            status:
              response.status,
            ok:
              response.ok,
            phone:
              maskPhone(phone),
            responseBody:
              getSafeWhatsAppData(data),
          }
        )
      }

      results.push({
        phone:
          maskPhone(phone),
        success:
          response.ok,
        status:
          response.status,
        data:
          getSafeWhatsAppData(data),
      })

    } catch (error) {

      console.error(
        "WHATSAPP DISTRIBUTION CHANNEL ERROR:",
        maskPhone(phone),
        error
      )

      results.push({
        phone:
          maskPhone(phone),
        success:
          false,
        error:
          String(error),
      })

    }

  }

  const successful =
    results.filter(
      (result) =>
        result.success
    ).length

  return {
    success:
      successful > 0,
    total:
      phones.length,
    successful,
    failed:
      phones.length -
      successful,
    results,
  }

}

export async function auditWhatsAppTemplateDefinition() {

  const token =
    process.env.WHATSAPP_ACCESS_TOKEN?.trim()

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

  const businessAccountId =
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim()

  if (!token || !phoneId || !businessAccountId) {

    console.error(
      "FALTAN VARIABLES DE ENTORNO WHATSAPP PARA AUDITAR TEMPLATE"
    )

    return {
      success: false,
      error:
        "FALTAN VARIABLES DE ENTORNO WHATSAPP PARA AUDITAR TEMPLATE",
      required:
        [
          "WHATSAPP_ACCESS_TOKEN",
          "WHATSAPP_PHONE_NUMBER_ID",
          "WHATSAPP_BUSINESS_ACCOUNT_ID",
        ],
    }

  }

  const fields =
    [
      "name",
      "status",
      "category",
      "language",
      "components",
    ].join(",")

  const params =
    new URLSearchParams({
      name:
        "imnova_update",
      fields,
    })

  const templateResponse =
    await fetch(
      `https://graph.facebook.com/v25.0/${businessAccountId}/message_templates?${params.toString()}`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    )

  const templateData =
    await templateResponse.json()

  const template =
    templateData?.data?.[0]

  const variables =
    template?.components?.flatMap(
      (component: any) => {
        const text =
          component.text || ""

        const matches =
          [...text.matchAll(/\{\{([^}]+)\}\}/g)]

        return matches.map(
          (match) => ({
            component:
              component.type,
            variable:
              match[1],
            expectedType:
              component.type === "HEADER" &&
              component.format
                ? String(component.format).toLowerCase()
                : "text",
          })
        )
      }
    ) || []

  console.log(
    "WHATSAPP TEMPLATE STATUS:",
    template?.status
  )

  console.log(
    "WHATSAPP TEMPLATE CATEGORY:",
    template?.category
  )

  console.log(
    "WHATSAPP TEMPLATE LANGUAGE:",
    template?.language
  )

  console.log(
    "WHATSAPP TEMPLATE COMPONENTS:",
    JSON.stringify(template?.components, null, 2)
  )

  console.log(
    "WHATSAPP TEMPLATE VARIABLES:",
    JSON.stringify(variables, null, 2)
  )

  return {
    success:
      templateResponse.ok,
    status:
      template?.status,
    category:
      template?.category,
    language:
      template?.language,
    components:
      template?.components,
    variables,
    raw:
      templateData,
  }

}
