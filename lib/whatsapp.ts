export async function sendWhatsAppUpdate(

  message: string,

  imageUrl?: string

) {

  const token =
    process.env.WHATSAPP_ACCESS_TOKEN?.trim()

  const phoneId =
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

  const phones = [

    "50558199840",
    "50557812948",
    "50586546986",
    "50586268473",

  ]

  if (!token || !phoneId) {

    console.error(
      "FALTAN VARIABLES DE ENTORNO"
    )

    return {

      success: false,

      error:
        "FALTAN VARIABLES DE ENTORNO",

    }

  }

  const results = []

  for (const phone of phones) {

    try {

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            300
          )
      )

      const payload = {

        messaging_product:
          "whatsapp",

        to: phone,

        type: "template",

        template: {

          name:
            "hello_world",

          language: {

            code:
              "en_US",

          },

        },

      }

      console.log(
        "ENVIANDO A:",
        phone
      )

      const response =
        await fetch(

          `https://graph.facebook.com/v25.0/${phoneId}/messages`,

          {

            method: "POST",

            headers: {

              Authorization:
                `Bearer ${token}`,

              "Content-Type":
                "application/json",

            },

            body:
              JSON.stringify(
                payload
              ),

          }

        )

      const data =
        await response.json()

      console.log(
        "META RESPONSE:",
        data
      )

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

        success: false,

        error:
          String(error),

      })

    }

  }

  const successful =
    results.filter(
      r => r.success
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