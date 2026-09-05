import { createHash, timingSafeEqual } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const SELLER_OS_POST_ONLY_RUNTIME_ROUTE_V1 =
  "SELLER_OS_POST_ONLY_RUNTIME_ROUTE_V1" as const

function safeEqual(left: string, right: string) {
  const provided = Buffer.from(left)
  const expected = Buffer.from(right)
  return provided.length === expected.length &&
    timingSafeEqual(provided, expected)
}

export async function sellerOsPostRuntimeAuthorizedV1(input: Readonly<{
  request: Request
  supabase: SupabaseClient
  environmentSecrets?: readonly (string | null | undefined)[]
  additionalAuthorizationHeaders?: readonly string[]
}>) {
  const headerNames = ["authorization",
    ...(input.additionalAuthorizationHeaders ?? [])]
  const provided = headerNames.flatMap((name) => {
    const value = input.request.headers.get(name)?.trim()
    return value ? [value] : []
  })
  const environmentSecrets = (input.environmentSecrets ?? [])
    .flatMap((value) => value?.trim() ? [value.trim()] : [])
  if (provided.some((header) => environmentSecrets.some((secret) =>
    safeEqual(header, `Bearer ${secret}`)))) return true
  if (provided.length === 0) return false

  const hashes = provided.map((value) =>
    createHash("sha256").update(value).digest("hex"))
  const verification = await input.supabase.rpc(
    "verify_seller_os_post_runtime_authorization_v1", {
      p_authorization_sha256_values: hashes,
    })
  return !verification.error && verification.data === true
}

export function sellerOsPostOnlyGetResponseV1() {
  return NextResponse.json({
    success: false,
    error: "POST_REQUIRED_FOR_RUNTIME_EXECUTION",
    contractVersion: SELLER_OS_POST_ONLY_RUNTIME_ROUTE_V1,
    safety: {
      getBusinessMutations: 0,
      executorInvoked: false,
      marketplaceWrites: 0,
    },
  }, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  })
}
