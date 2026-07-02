export const runtime =
  "nodejs"

import { NextResponse } from "next/server"
import {
  getEbaySandboxOauthScaffoldStatus,
} from "@/lib/ebay/oauth-scaffold"

export function GET() {
  return NextResponse.json(
    getEbaySandboxOauthScaffoldStatus(),
    {
      status:
        200,
    }
  )
}
