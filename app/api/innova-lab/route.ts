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
      imageUrl,
    } = body

    const result =
      await sendWhatsAppUpdate(
        product,
        status,
        progress,
        imageUrl
      )

    if (
      process.env.NODE_ENV ===
      "development"
    ) {

      console.log(
        "WHATSAPP RESULT:",
        result
      )

    }

    return NextResponse.json({

      success:
        result.success,

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
        error: String(error),
      },
      {
        status: 500,
      }
    )

  }

}
