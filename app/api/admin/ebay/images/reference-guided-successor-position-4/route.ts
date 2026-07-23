export const runtime = "nodejs"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { validateAdminApiRequest } from "@/lib/supabase-admin"

const AUTHORIZED_BRANCH = "feature/centralize-ebay-mobile-command-center"
const STAGING_PROJECT_REF = "vsfthqydfrdzulldbfbe"
const EXECUTION_CONFIRMATION =
  "RUN_ONE_STAGING_SUCCESSOR_V2_POSITION_4_PROVIDER_CALL_5"
const FEATURE_FLAG = "OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return message.match(/[A-Z][A-Z0-9_:.-]{2,180}/)?.[0]
    ?? "SUCCESSOR_POSITION_4_EXECUTION_FAILED"
}

function assertPreviewBoundary() {
  let projectRef = ""
  try {
    projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.split(".")[0] ?? ""
  } catch {
    projectRef = ""
  }
  if (process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== AUTHORIZED_BRANCH ||
    projectRef !== STAGING_PROJECT_REF) {
    throw new Error("SUCCESSOR_POSITION_4_PREVIEW_STAGING_REQUIRED")
  }
  if (!process.env.OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_IMAGE_MODEL?.trim() !== "gpt-image-2") {
    throw new Error("SUCCESSOR_POSITION_4_PROVIDER_CONFIGURATION_INVALID")
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || validation.authenticationMode !== "service_role") {
    return NextResponse.json({ success: false,
      error: validation.error ?? "service_role_required" },
    { status: validation.status && validation.status !== 200
      ? validation.status : 403 })
  }
  try {
    assertPreviewBoundary()
    const body = record(await req.json())
    if (body.confirmation !== EXECUTION_CONFIRMATION) {
      throw new Error("SUCCESSOR_POSITION_4_EXPLICIT_CONFIRMATION_REQUIRED")
    }
    process.env[FEATURE_FLAG] = "true"
    process.env.CANARY_EXECUTION_ENVIRONMENT = "preview"
    // No prompt, plan, position, reference or hash is accepted from the caller.
    const executed = await import(
      "@/scripts/execute-reference-guided-successor-position-4.mjs"
    ) as { executionResult: Record<string, unknown> }
    const response = NextResponse.json({ success: true,
      ...executed.executionResult })
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch (error) {
    const code = safeCode(error)
    return NextResponse.json({ success: false, error: code,
      automaticRetryOccurred: false, ebayWrites: 0,
      productionChanged: false }, { status: 409 })
  } finally {
    process.env[FEATURE_FLAG] = "false"
    process.env.CANARY_EXECUTION_ENVIRONMENT = "disabled"
  }
}
