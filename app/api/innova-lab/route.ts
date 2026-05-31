export const runtime = "nodejs"

import { NextResponse } from "next/server"

import {
  sendWhatsAppUpdate,
} from "../../../lib/whatsapp"

export async function POST(
  req: Request
) {

  try {

    const body =
      await req.json()

    const {

      product,

      status,

      progress,

      message,

      imageUrl,

    } = body

    const finalMessage =

      message ||

      `🚀 IMNOVA LABS UPDATE

Producto: ${product || "N/A"}

Estado: ${status || "N/A"}

Progreso: ${progress || "N/A"}

Fecha: ${new Date().toLocaleString()}
`

    console.log(
      "FINAL MESSAGE:",
      finalMessage
    )

    console.log(
      "IMAGE URL:",
      imageUrl
    )

    const result =
      await sendWhatsAppUpdate(

        finalMessage,

        imageUrl

      )

    console.log(
      "WHATSAPP RESULT:",
      result
    )

    return NextResponse.json({

      success: true,

      result,

    })

  } catch (error) {

    console.error(
      "API ERROR:",
      error
    )

    return NextResponse.json(

      {

        success: false,

        error:
          String(error),

      },

      {

        status: 500,

      }

    )

  }

}