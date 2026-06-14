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
  name: _name,
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

  const payload = {
    messaging_product:
      "whatsapp",
    to:
      normalizedPhone,
    type:
      "template",
    template: {
      name:
        templateName,
      language: {
        code:
          "es",
      },
    },
  }

  try {
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

    if (!response.ok) {
      console.error(
        "WHATSAPP WELCOME META ERROR:",
        {
          status:
            response.status,
          phone:
            normalizedPhone,
          data,
        }
      )

      return {
        success: false,
        status:
          response.status,
        error:
          "WHATSAPP_WELCOME_FAILED",
        data,
      }
    }

    return {
      success: true,
      status:
        response.status,
      phone:
        normalizedPhone,
      messageId:
        data?.messages?.[0]?.id ||
        null,
      data,
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

      const selectedTemplate =
        status === "Disponible"
          ? "imnova_product_launch"
          : "imnova_update"

      const selectedImageUrl =
        isValidAbsoluteUrl(imageUrl)
          ? imageUrl
          : fallbackLaunchImageUrl

      const template =
        selectedTemplate === "imnova_product_launch"
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

      console.log("WHATSAPP PRODUCT:", product)
      console.log("WHATSAPP STATUS:", status)
      console.log("WHATSAPP PROGRESS:", progress)
      console.log(
        "WHATSAPP TEMPLATE SELECTED:",
        selectedTemplate
      )

      console.log(
        "WHATSAPP PAYLOAD:",
        JSON.stringify(payload, null, 2)
      )

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
        "WAMID:",
        data?.messages?.[0]?.id
      )

      console.log(
        "META RESPONSE:",
        JSON.stringify(
          data,
          null,
          2
        )
      )

      console.log(
        "WHATSAPP META RESPONSE:",
        {
          phone,
          status:
            response.status,
          ok:
            response.ok,
          data,
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
            phone,
            responseBody:
              data,
          }
        )

      }

      results.push({
        phone,
        success:
          response.ok,
        status:
          response.status,
        data,
      })

    } catch (error) {

      console.error(
        "WHATSAPP ERROR:",
        phone,
        error
      )

      results.push({
        phone,
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
