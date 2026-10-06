import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
  POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
} from "./ebay-sales-order-event-foundation-v1.ts"

export const SELLER_OS_BUYER_THANK_YOU_POLICY_VERSION =
  "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU_V1" as const
export const SELLER_OS_BUYER_THANK_YOU_POLICY_NAME =
  "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU" as const
export const SELLER_OS_BUYER_THANK_YOU_AUTHORITY =
  "OWNER_AUTHORIZED_FIXED_TEMPLATE" as const
export const SELLER_OS_BUYER_THANK_YOU_MESSAGE_GRAIN =
  "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER" as const
export const SELLER_OS_BUYER_THANK_YOU_MARKETPLACE = "EBAY_US" as const

type PolicyRow = Readonly<{
  marketplace_account_key: string
  marketplace: string
  policy_name: string
  policy_version: string
  execution_authority: string
  template_version: string
  template_sha256: string
  message_grain: string
  owner_authorized_at: string
  active: boolean
}>

function templateSha256() {
  return createHash("sha256")
    .update(POST_PURCHASE_THANK_YOU_TEMPLATE_V1, "utf8")
    .digest("hex")
}

function safeIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null
}

function unavailable(
  status: "NOT_AUTHORIZED" | "UNAVAILABLE",
  observedAt: string,
  limitationCode: string,
) {
  return Object.freeze({
    contractVersion: SELLER_OS_BUYER_THANK_YOU_POLICY_VERSION,
    policyName: SELLER_OS_BUYER_THANK_YOU_POLICY_NAME,
    status,
    marketplace: SELLER_OS_BUYER_THANK_YOU_MARKETPLACE,
    accountBinding: "CANONICAL_EBAY_US_ACCOUNT" as const,
    executionAuthority: "HUMAN_APPROVAL_REQUIRED" as const,
    templateVersion: POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
    templateSha256: templateSha256(),
    messageGrain: SELLER_OS_BUYER_THANK_YOU_MESSAGE_GRAIN,
    ownerAuthorizedAt: null,
    arbitraryTextAllowed: false as const,
    arbitraryRecipientAllowed: false as const,
    unrelatedMarketplaceWritesAllowed: false as const,
    observedAt,
    limitationCodes: Object.freeze([limitationCode]),
  })
}

export function createUnavailableSellerOsBuyerThankYouPolicyV1(
  limitationCode = "BUYER_THANK_YOU_OWNER_POLICY_UNAVAILABLE",
  observedAt = new Date().toISOString(),
) {
  return unavailable("UNAVAILABLE", observedAt, limitationCode)
}

export function createUnauthorizedSellerOsBuyerThankYouPolicyV1(
  limitationCode = "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU_NOT_PERSISTED",
  observedAt = new Date().toISOString(),
) {
  return unavailable("NOT_AUTHORIZED", observedAt, limitationCode)
}

function authorized(row: PolicyRow, observedAt: string) {
  return Object.freeze({
    contractVersion: SELLER_OS_BUYER_THANK_YOU_POLICY_VERSION,
    policyName: SELLER_OS_BUYER_THANK_YOU_POLICY_NAME,
    status: "AUTHORIZED" as const,
    marketplace: SELLER_OS_BUYER_THANK_YOU_MARKETPLACE,
    accountBinding: "CANONICAL_EBAY_US_ACCOUNT" as const,
    executionAuthority: SELLER_OS_BUYER_THANK_YOU_AUTHORITY,
    templateVersion: POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
    templateSha256: templateSha256(),
    messageGrain: SELLER_OS_BUYER_THANK_YOU_MESSAGE_GRAIN,
    ownerAuthorizedAt: safeIso(row.owner_authorized_at),
    arbitraryTextAllowed: false as const,
    arbitraryRecipientAllowed: false as const,
    unrelatedMarketplaceWritesAllowed: false as const,
    observedAt,
    limitationCodes: Object.freeze([] as string[]),
  })
}

export type SellerOsBuyerThankYouPolicyV1 =
  | ReturnType<typeof authorized>
  | ReturnType<typeof createUnavailableSellerOsBuyerThankYouPolicyV1>
  | ReturnType<typeof createUnauthorizedSellerOsBuyerThankYouPolicyV1>

/**
 * Read the one fixed-template owner policy for the already-bound canonical
 * account. The account key is used only as an exact database predicate and is
 * never returned through the status or MCP surfaces.
 */
export async function readSellerOsBuyerThankYouPolicyV1(
  supabase: SupabaseClient,
  accountKey: string,
  observedAt = new Date().toISOString(),
): Promise<SellerOsBuyerThankYouPolicyV1> {
  if (!accountKey || accountKey.length > 256) {
    return createUnavailableSellerOsBuyerThankYouPolicyV1(
      "BUYER_THANK_YOU_OWNER_POLICY_ACCOUNT_SCOPE_INVALID",
      observedAt,
    )
  }
  const { data, error } = await supabase
    .from("seller_os_buyer_thank_you_policies_v1")
    .select("marketplace_account_key,marketplace,policy_name,policy_version,execution_authority,template_version,template_sha256,message_grain,owner_authorized_at,active")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", SELLER_OS_BUYER_THANK_YOU_MARKETPLACE)
    .eq("active", true)
    .maybeSingle()
  if (error) return createUnavailableSellerOsBuyerThankYouPolicyV1(
    "BUYER_THANK_YOU_OWNER_POLICY_READ_FAILED",
    observedAt,
  )
  if (!data) return createUnauthorizedSellerOsBuyerThankYouPolicyV1(
    "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU_NOT_PERSISTED",
    observedAt,
  )
  const row = data as PolicyRow
  const valid = row.marketplace_account_key === accountKey &&
    row.marketplace === SELLER_OS_BUYER_THANK_YOU_MARKETPLACE &&
    row.policy_name === SELLER_OS_BUYER_THANK_YOU_POLICY_NAME &&
    row.policy_version === SELLER_OS_BUYER_THANK_YOU_POLICY_VERSION &&
    row.execution_authority === SELLER_OS_BUYER_THANK_YOU_AUTHORITY &&
    row.template_version === POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION &&
    row.template_sha256 === templateSha256() &&
    row.message_grain === SELLER_OS_BUYER_THANK_YOU_MESSAGE_GRAIN &&
    row.active === true && safeIso(row.owner_authorized_at) !== null
  return valid
    ? authorized(row, observedAt)
    : createUnauthorizedSellerOsBuyerThankYouPolicyV1(
        "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU_POLICY_MISMATCH",
        observedAt,
      )
}
