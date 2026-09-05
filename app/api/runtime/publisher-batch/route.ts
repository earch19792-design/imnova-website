export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbayDraftWriteEnvironmentBoundary } from
  "@/lib/ebay/environment-boundaries"
import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

function runtimeHandoffFailure(errorClass: string, upstreamStatus: number) {
  return NextResponse.json({ success: false,
    stage: "RUNTIME_AUTHORITY_HANDOFF", error: errorClass, errorClass,
    upstreamStatus, retrySafety: "ENGINEERING_CONFIGURATION_REQUIRED",
    officialCurrentState: "NOT_STARTED",
    safety: { runtimeAuthority: true, ownerAuthorizationRequired: true,
      executorInvoked: false, marketplaceWrites: 0 } }, { status: 503 })
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const protectionBypass = request.headers.get(
    "x-vercel-protection-bypass") ?? ""
  const target = new URL("/api/admin/ebay/draft-only", request.url)
  try {
    const response = await fetch(target, { method: "POST", cache: "no-store",
      headers: { Authorization: authorization,
        "Content-Type": "application/json",
        ...(protectionBypass
          ? { "x-vercel-protection-bypass": protectionBypass } : {}) },
      body: JSON.stringify({ action: "batch_runtime" }) })
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().includes("application/json")) {
      return runtimeHandoffFailure(
        "PUBLISHER_BATCH_RUNTIME_UPSTREAM_NON_JSON", response.status)
    }
    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== "object") return runtimeHandoffFailure(
      "PUBLISHER_BATCH_RUNTIME_UPSTREAM_INVALID_JSON", response.status)
    return NextResponse.json(payload, { status: response.status })
  } catch {
    return runtimeHandoffFailure(
      "PUBLISHER_BATCH_RUNTIME_UPSTREAM_FETCH_FAILED", 0)
  }
}

export function GET() {
  const boundary = getEbayDraftWriteEnvironmentBoundary()
  return sellerOsPostOnlyGetResponseV1({
    boundaryClassification: boundary.productionDedicatedPreprodBound
      ? "SELLER_OS_DEDICATED_PREPROD" : "BLOCKED",
    branchMatches: boundary.branchMatches,
    allowedBranch: boundary.allowedBranch,
    observedGitRef: boundary.observedGitRef,
    deploymentAttestedGitRef: boundary.deploymentAttestedGitRef,
    branchAuthority: boundary.branchAuthority,
    environmentAllowed: boundary.environmentAllowed,
    productionDedicatedPreprodBound:
      boundary.productionDedicatedPreprodBound,
    target: boundary.target,
    targetEnabled: boundary.targetEnabled,
    writeAllowed: boundary.writeAllowed,
    valuesDisplayed: false,
  })
}
