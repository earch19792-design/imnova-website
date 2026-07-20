import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const EBAY_ACCOUNT_POLICY_PROFILE_VERSION =
  "EBAY_ACCOUNT_POLICY_PROFILE_V1_2026_07_20"

const EBAY_ACCOUNT_POLICY_PROFILE_TTL_MS = 30 * 24 * 60 * 60 * 1_000

type VerifiedAccountPolicyPreflight = {
  identity: { status: string }
  privilege: { usable: boolean }
  selection: {
    fulfillmentPolicyId: string
    paymentPolicyId: string
    returnPolicyId: string
    merchantLocationKey: string
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function saveVerifiedEbayAccountPolicyProfile(input: {
  supabase: ReturnType<typeof getSupabaseAdminClient>
  accountKey: string
  actorUserId: string
  preflight: VerifiedAccountPolicyPreflight
  now?: Date
}) {
  const policySelectionComplete = [
    input.preflight.selection.fulfillmentPolicyId,
    input.preflight.selection.paymentPolicyId,
    input.preflight.selection.returnPolicyId,
  ].every((value) => Boolean(text(value)))

  if (
    input.preflight.identity.status !== "BOUND" ||
    !input.preflight.privilege.usable ||
    !policySelectionComplete
  ) return false

  const verifiedAt = input.now ?? new Date()
  const { error } = await input.supabase
    .from("ebay_account_policy_profiles")
    .upsert({
      account_key: input.accountKey,
      marketplace_id: "EBAY_US",
      fulfillment_policy_id:
        input.preflight.selection.fulfillmentPolicyId,
      payment_policy_id: input.preflight.selection.paymentPolicyId,
      return_policy_id: input.preflight.selection.returnPolicyId,
      merchant_location_key:
        text(input.preflight.selection.merchantLocationKey) || null,
      verification_source: "EBAY_ACCOUNT_API_GET",
      profile_version: EBAY_ACCOUNT_POLICY_PROFILE_VERSION,
      verified_at: verifiedAt.toISOString(),
      expires_at: new Date(
        verifiedAt.getTime() + EBAY_ACCOUNT_POLICY_PROFILE_TTL_MS,
      ).toISOString(),
      selected_by: input.actorUserId,
      updated_at: verifiedAt.toISOString(),
    }, { onConflict: "account_key,marketplace_id" })

  if (error) throw new Error("EBAY_ACCOUNT_POLICY_PROFILE_SAVE_FAILED")
  return true
}
