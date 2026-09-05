export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const protectionBypass = request.headers.get(
    "x-vercel-protection-bypass") ?? ""
  const target = new URL("/api/admin/ebay/draft-only", request.url)
  const response = await fetch(target, { method: "POST", cache: "no-store",
    headers: { Authorization: authorization,
      "Content-Type": "application/json",
      ...(protectionBypass
        ? { "x-vercel-protection-bypass": protectionBypass } : {}) },
    body: JSON.stringify({ action: "batch_runtime" }) })
  const payload = await response.json().catch(() => ({
    success: false, error: "PUBLISHER_BATCH_RUNTIME_INVALID_RESPONSE" }))
  return NextResponse.json(payload, { status: response.status })
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
