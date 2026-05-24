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

    await sendWhatsAppUpdate(

      message,

      imageUrl

    )

    return NextResponse.json({

      success: true,

    })

  } catch (error) {

    console.error(
      "API ERROR:",
      error
    )

    return NextResponse.json(

      {
        success: false,
      },

      {
        status: 500,
      }

    )

  }

}