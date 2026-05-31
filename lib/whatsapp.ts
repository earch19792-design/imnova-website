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


    // temporalmente deja SOLO UN NÚMERO
    // para depuración

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

  for (const phone of phones) {

    try {

      await new Promise(

        resolve =>

          setTimeout(
            resolve,
            300
          )

      )

      let payload

      if (imageUrl) {

        payload = {

          messaging_product:
            "whatsapp",

          to: phone,

          type: "image",

          image: {

            link:
              imageUrl,

            caption:
              message,

          },

        }

      } else {

        payload = {

          messaging_product:
            "whatsapp",

          to: phone,

          type: "text",

          text: {

            body:
              message,

          },

        }

      }

      console.log(
        "ENVIANDO A:",
        phone
      )

      const response = await fetch(

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

      const raw =
        await response.text()

      console.log(
        "RAW RESPONSE:",
        raw
      )

      let data

      try {

        data =
          JSON.parse(raw)

      } catch {

        data = raw

      }

      console.log(
        "STATUS:",
        response.status
      )

      if (!response.ok) {

        console.error(
          "META ERROR:",
          data
        )

        return {

          success: false,

          status:
            response.status,

          data,

        }

      }

      console.log(
        "META SUCCESS:",
        data
      )

      return {

        success: true,

        status:
          response.status,

        data,

      }

    } catch (error) {

      console.error(
        "WHATSAPP ERROR:",
        error
      )

      return {

        success: false,

        error:
          String(error),

      }

    }

  }

  return {

    success: false,

    error:
      "NO SE PROCESÓ NINGÚN NÚMERO",

  }

}