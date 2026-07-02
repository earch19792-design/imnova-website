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
    }
  )
}
