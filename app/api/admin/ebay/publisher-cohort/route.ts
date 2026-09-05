export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readSellerOsPublisherOperationalCohortV1 } from
  "@/lib/ebay/seller-os-publisher-operational-cohort-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"
import { isSellerOsOwnerRole, sellerOsAccessRoleFromUser } from
  "@/lib/seller-os-access-control"

async function resolveReadOnlyCohortActor(input: Readonly<{
  supabase: ReturnType<typeof getSupabaseAdminClient>
  authenticatedUserId: string | null
  authenticationMode: "service_role" | "admin_user"
}>) {
  if (input.authenticatedUserId) return input.authenticatedUserId
  if (input.authenticationMode !== "service_role") {
    throw new Error("PUBLISHER_COHORT_OWNER_AUTH_REQUIRED")
  }
  const users = await input.supabase.auth.admin.listUsers({ page: 1,
    perPage: 100 })
  if (users.error) throw new Error(
    "PUBLISHER_COHORT_OWNER_AUTHORITY_READ_FAILED")
  const owners = (users.data?.users ?? []).filter((user) =>
    isSellerOsOwnerRole(sellerOsAccessRoleFromUser(user)))
  if (owners.length !== 1) throw new Error(
    "PUBLISHER_COHORT_OWNER_AUTHORITY_CARDINALITY_INVALID")
  return owners[0].id
}

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return NextResponse.json({ success: false,
    error: auth.error ?? "PUBLISHER_COHORT_OWNER_AUTH_REQUIRED" },
  { status: auth.status || 403 })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "PUBLISHER_COHORT_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 })
  try {
    const supabase = getSupabaseAdminClient()
    const actorUserId = await resolveReadOnlyCohortActor({ supabase,
      authenticatedUserId: auth.userId,
      authenticationMode: auth.authenticationMode })
    const cohort = await readSellerOsPublisherOperationalCohortV1({
      supabase, accountKey, actorUserId,
    })
    const response = NextResponse.json({ success: true, cohort })
    response.headers.set("Cache-Control", "private, no-store, max-age=0")
    response.headers.set("X-Seller-Os-Projection",
      "SELLER_OS_PUBLISHER_OPERATIONAL_COHORT_V1")
    const sourceSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    if (sourceSha) response.headers.set("X-Seller-Os-Source-Sha", sourceSha)
    return response
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    return NextResponse.json({ success: false,
      error: /^[A-Z][A-Z0-9_]{2,159}$/.test(code) ? code
        : "PUBLISHER_COHORT_READ_FAILED",
      safety: { readOnly: true, marketplaceWrites: 0,
        databaseMutations: 0, authSessionsCreated: 0 } },
    { status: 503 })
  }
}
