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

  /* =========================================
  VALIDACIÓN
  ========================================= */

  if (!token || !phoneId) {

    console.error(
      "FALTAN VARIABLES DE ENTORNO"
    )

    return

  }

  /* =========================================
  LOOP PHONES
  ========================================= */

  for (const phone of phones) {

    try {

      /* =========================================
      DELAY ANTI RATE LIMIT
      ========================================= */

      await new Promise(

        resolve =>

          setTimeout(
            resolve,
            300
          )

      )

      let payload

      /* =========================================
      ENVÍA IMAGEN SI EXISTE imageUrl
      ========================================= */

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

        /* =========================================
        SOLO TEXTO
        ========================================= */

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

      /* =========================================
      DEBUG
      ========================================= */

      console.log(
        "ENVIANDO A:",
        phone
      )

      console.log(
        "IMAGE URL:",
        imageUrl
      )

      /* =========================================
      FETCH META API
      ========================================= */

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

          body: JSON.stringify(
            payload
          ),

        }

      )

      /* =========================================
      RAW RESPONSE
      ========================================= */

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

      /* =========================================
      LOGS
      ========================================= */

      console.log(
        "STATUS:",
        response.status
      )

      console.log(
        "PHONE:",
        phone
      )

      if (!response.ok) {

        console.error(
          "META ERROR:",
          data
        )

      } else {

        console.log(
          "META SUCCESS:",
          data
        )

      }

    } catch (error) {

      console.error(
        "WHATSAPP ERROR:",
        error
      )

    }

  }

}