export const runtime =
  "nodejs"

import { NextResponse } from "next/server"
import {
  getBlockedEbaySandboxEnvConfigurationResponse,
} from "@/lib/ebay/sandbox-env"

export function GET() {
  return NextResponse.json(
    getBlockedEbaySandboxEnvConfigurationResponse(),
    {
      status:
        200,
    }
  )
}
