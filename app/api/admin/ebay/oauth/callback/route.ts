export const runtime =
  "nodejs"

import { NextResponse } from "next/server"
import {
  getBlockedOauthCallbackResponse,
} from "@/lib/ebay/oauth-scaffold"

export function GET() {
  return NextResponse.json(
    getBlockedOauthCallbackResponse(),
    {
      status:
        501,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      },
    }
  )
}
