export const runtime =
  "nodejs"

import { NextResponse } from "next/server"
import {
  getBlockedOauthStartResponse,
} from "@/lib/ebay/oauth-scaffold"

export function POST() {
  return NextResponse.json(
    getBlockedOauthStartResponse(),
    {
      status:
        501,
    }
  )
}
