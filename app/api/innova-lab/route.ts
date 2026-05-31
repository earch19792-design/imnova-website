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

      message,

      imageUrl,

    } = body

    console.log(
      "MESSAGE:",
      message
    )

    console.log(
      "IMAGE URL:",
      imageUrl
    )

    const result =
      await sendWhatsAppUpdate(

        message,

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