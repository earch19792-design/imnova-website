type ProductLaunchEmailInput = {
  emails: string[]
  product: string
  imageUrl?: string
}

type DistributionChannelEmailInput = {
  emails: string[]
  product: string
  channelName: string
  locationLabel: string
  productUrl?: string
  mapUrl?: string
}

type EmailSendResultItem = {
  email: string
  success: boolean
  status?: number
  data?: unknown
  error?: string
}

const emailPattern =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmailAddress(
  email: string
) {
  return email.trim().toLowerCase()
}

function getUniqueValidEmails(
  emails: string[]
) {
  return Array.from(
    new Set(
      emails
        .map(normalizeEmailAddress)
        .filter(email =>
          emailPattern.test(email)
        )
    )
  )
}

function getProductLaunchEmailText(
  product: string
) {
  return [
    "Ya esta disponible en IMNOVA.",
    "",
    `Producto: ${product}`,
    "",
    "La comunidad de IMNOVA ya puede adquirirlo en IMNOVA Store o los canales autorizados.",
    "",
    "Gracias por ser parte de las personas que ayudan a validar y llevar nuevas ideas al mercado.",
    "",
    "IMNOVA",
  ].join("\n")
}

function getProductLaunchEmailHtml({
  product,
  imageUrl,
}: {
  product: string
  imageUrl?: string
}) {
  const safeProduct =
    product || "Producto IMNOVA"

  const imageBlock =
    imageUrl &&
    imageUrl.startsWith("https://")
      ? `
        <img
          src="${imageUrl}"
          alt="${safeProduct}"
          style="width:100%;max-width:560px;border-radius:20px;display:block;margin:0 auto 28px;object-fit:cover;"
        />
      `
      : ""

  return `
    <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#0b0f12;border:1px solid rgba(103,232,249,0.18);border-radius:28px;overflow:hidden;">
              <tr>
                <td style="padding:34px 28px;">
                  <p style="margin:0 0 18px;color:#67e8f9;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;">
                    Lanzamiento IMNOVA
                  </p>

                  ${imageBlock}

                  <h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.08;font-weight:900;">
                    Ya esta disponible.
                  </h1>

                  <p style="margin:22px 0 0;color:#d4d4d8;font-size:18px;line-height:1.55;">
                    <strong style="color:#ffffff;">Producto:</strong> ${safeProduct}
                  </p>

                  <p style="margin:20px 0 0;color:#d4d4d8;font-size:16px;line-height:1.7;">
                    La comunidad de IMNOVA ya puede adquirirlo en IMNOVA Store o los canales autorizados.
                  </p>

                  <p style="margin:20px 0 0;color:#a1a1aa;font-size:14px;line-height:1.7;">
                    Te avisamos porque seleccionaste intereses conectados con este lanzamiento.
                    Sin spam. Solo avances y oportunidades relevantes para ti.
                  </p>

                  <p style="margin:28px 0 0;color:#67e8f9;font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">
                    Gracias por construir lo proximo con IMNOVA.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `
}

export async function sendProductLaunchEmail({
  emails,
  product,
  imageUrl,
}: ProductLaunchEmailInput) {
  const apiKey =
    process.env.RESEND_API_KEY?.trim()

  const from =
    process.env.EMAIL_FROM?.trim()

  const recipients =
    getUniqueValidEmails(emails)

  if (recipients.length === 0) {
    return {
      success: false,
      error:
        "NO_PRODUCT_LAUNCH_EMAIL_RECIPIENTS",
      total: 0,
      successful: 0,
      failed: 0,
      results: [] as EmailSendResultItem[],
    }
  }

  if (!apiKey || !from) {
    return {
      success: false,
      error:
        "EMAIL_PRODUCT_LAUNCH_NOT_CONFIGURED",
      total:
        recipients.length,
      successful: 0,
      failed:
        recipients.length,
      results:
        recipients.map(email => ({
          email,
          success: false,
          error:
            "EMAIL_PRODUCT_LAUNCH_NOT_CONFIGURED",
        })),
    }
  }

  const results:
    EmailSendResultItem[] = []

  for (const email of recipients) {
    try {
      await new Promise(resolve =>
        setTimeout(resolve, 150)
      )

      const response =
        await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${apiKey}`,
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                from,
                to: [
                  email,
                ],
                subject:
                  `${product} ya esta disponible en IMNOVA`,
                text:
                  getProductLaunchEmailText(
                    product
                  ),
                html:
                  getProductLaunchEmailHtml({
                    product,
                    imageUrl,
                  }),
              }),
          }
        )

      const responseText =
        await response.text()

      let data:
        unknown = responseText

      try {
        data =
          JSON.parse(responseText)
      } catch {
        data =
          responseText
      }

      if (!response.ok) {
        console.error(
          "PRODUCT LAUNCH EMAIL META ERROR:",
          {
            status:
              response.status,
            email,
            data,
          }
        )
      }

      results.push({
        email,
        success:
          response.ok,
        status:
          response.status,
        data,
      })
    } catch (error) {
      console.error(
        "PRODUCT LAUNCH EMAIL ERROR:",
        email,
        error
      )

      results.push({
        email,
        success: false,
        error:
          String(error),
      })
    }
  }

  const successful =
    results.filter(
      result => result.success
    ).length

  return {
    success:
      successful > 0,
    total:
      recipients.length,
    successful,
    failed:
      recipients.length - successful,
    results,
  }
}

function getDistributionChannelEmailText({
  product,
  channelName,
  locationLabel,
  productUrl,
  mapUrl,
}: Omit<
  DistributionChannelEmailInput,
  "emails"
>) {
  return [
    "Nuevo punto de compra IMNOVA.",
    "",
    `Producto: ${product}`,
    `Distribuidor: ${channelName}`,
    `Ubicacion: ${locationLabel}`,
    "",
    productUrl
      ? `Comprar o revisar producto: ${productUrl}`
      : "",
    mapUrl
      ? `Ver mapa: ${mapUrl}`
      : "",
    "",
    "Te avisamos porque seleccionaste intereses relacionados con este producto.",
    "",
    "IMNOVA",
  ]
    .filter(line => line !== "")
    .join("\n")
}

function getDistributionChannelEmailHtml({
  product,
  channelName,
  locationLabel,
  productUrl,
  mapUrl,
}: Omit<
  DistributionChannelEmailInput,
  "emails"
>) {
  const safeProduct =
    product || "Producto IMNOVA"

  const safeChannelName =
    channelName || "Nuevo distribuidor IMNOVA"

  const safeLocationLabel =
    locationLabel || "Ubicacion disponible"

  const actionButtons =
    [
      productUrl &&
        productUrl.startsWith("http")
        ? `<a href="${productUrl}" style="display:inline-block;margin:18px 10px 0 0;border-radius:14px;background:#67e8f9;color:#020617;padding:12px 18px;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">Ver producto</a>`
        : "",
      mapUrl &&
        mapUrl.startsWith("http")
        ? `<a href="${mapUrl}" style="display:inline-block;margin:18px 0 0;border-radius:14px;border:1px solid rgba(103,232,249,0.35);color:#cffafe;padding:12px 18px;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">Ver ubicacion</a>`
        : "",
    ].join("")

  return `
    <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#0b0f12;border:1px solid rgba(103,232,249,0.18);border-radius:28px;overflow:hidden;">
              <tr>
                <td style="padding:34px 28px;">
                  <p style="margin:0 0 18px;color:#67e8f9;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;">
                    Nuevo punto de compra
                  </p>

                  <h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.08;font-weight:900;">
                    Ahora tambien puedes encontrarlo en ${safeChannelName}.
                  </h1>

                  <p style="margin:22px 0 0;color:#d4d4d8;font-size:18px;line-height:1.55;">
                    <strong style="color:#ffffff;">Producto:</strong> ${safeProduct}
                  </p>

                  <p style="margin:14px 0 0;color:#d4d4d8;font-size:16px;line-height:1.7;">
                    <strong style="color:#ffffff;">Ubicacion:</strong> ${safeLocationLabel}
                  </p>

                  ${actionButtons}

                  <p style="margin:24px 0 0;color:#a1a1aa;font-size:14px;line-height:1.7;">
                    Te avisamos porque seleccionaste intereses relacionados con este producto.
                    Sin spam. Solo avances, disponibilidad y oportunidades relevantes para ti.
                  </p>

                  <p style="margin:28px 0 0;color:#67e8f9;font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">
                    IMNOVA
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `
}

export async function sendDistributionChannelEmail({
  emails,
  product,
  channelName,
  locationLabel,
  productUrl,
  mapUrl,
}: DistributionChannelEmailInput) {
  const apiKey =
    process.env.RESEND_API_KEY?.trim()

  const from =
    process.env.EMAIL_FROM?.trim()

  const recipients =
    getUniqueValidEmails(emails)

  if (recipients.length === 0) {
    return {
      success: false,
      error:
        "NO_DISTRIBUTION_CHANNEL_EMAIL_RECIPIENTS",
      total: 0,
      successful: 0,
      failed: 0,
      results: [] as EmailSendResultItem[],
    }
  }

  if (!apiKey || !from) {
    return {
      success: false,
      error:
        "EMAIL_DISTRIBUTION_CHANNEL_NOT_CONFIGURED",
      total:
        recipients.length,
      successful: 0,
      failed:
        recipients.length,
      results:
        recipients.map(email => ({
          email,
          success: false,
          error:
            "EMAIL_DISTRIBUTION_CHANNEL_NOT_CONFIGURED",
        })),
    }
  }

  const results:
    EmailSendResultItem[] = []

  for (const email of recipients) {
    try {
      await new Promise(resolve =>
        setTimeout(resolve, 150)
      )

      const response =
        await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${apiKey}`,
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                from,
                to: [
                  email,
                ],
                subject:
                  `${product} ya tiene nuevo punto de compra IMNOVA`,
                text:
                  getDistributionChannelEmailText({
                    product,
                    channelName,
                    locationLabel,
                    productUrl,
                    mapUrl,
                  }),
                html:
                  getDistributionChannelEmailHtml({
                    product,
                    channelName,
                    locationLabel,
                    productUrl,
                    mapUrl,
                  }),
              }),
          }
        )

      const responseText =
        await response.text()

      let data:
        unknown = responseText

      try {
        data =
          JSON.parse(responseText)
      } catch {
        data =
          responseText
      }

      if (!response.ok) {
        console.error(
          "DISTRIBUTION CHANNEL EMAIL META ERROR:",
          {
            status:
              response.status,
            email,
            data,
          }
        )
      }

      results.push({
        email,
        success:
          response.ok,
        status:
          response.status,
        data,
      })
    } catch (error) {
      console.error(
        "DISTRIBUTION CHANNEL EMAIL ERROR:",
        email,
        error
      )

      results.push({
        email,
        success: false,
        error:
          String(error),
      })
    }
  }

  const successful =
    results.filter(
      result => result.success
    ).length

  return {
    success:
      successful > 0,
    total:
      recipients.length,
    successful,
    failed:
      recipients.length - successful,
    results,
  }
}
