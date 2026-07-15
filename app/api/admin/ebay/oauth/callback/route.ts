export const runtime =
  "nodejs"

import { NextResponse } from "next/server"
import {
  getBlockedOauthCallbackResponse,
} from "@/lib/ebay/oauth-scaffold"
import {
  GET as processCommercialOrdersCallback,
} from "@/app/api/admin/ebay/commercial-orders-oauth/callback/route"

export function GET(req: Request) {
  const url = new URL(req.url)
  const state = url.searchParams.get("state")?.trim() ?? ""
  const hasOAuthResult = Boolean(
    url.searchParams.get("code") || url.searchParams.get("error")
  )
  if (/^[A-Za-z0-9_-]{43}$/.test(state) && hasOAuthResult) {
    return processCommercialOrdersCallback(req)
  }
  return NextResponse.json(
    getBlockedOauthCallbackResponse(),
    {
      status:
        501,
    }
  )
}
