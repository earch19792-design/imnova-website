import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { readMayelFullVisualDelegationV1 } from
  "./ebay-mayel-full-visual-delegation-server-v1"

export const MAYEL_PROMOTION_SPEND_DELEGATION_VERSION =
  "MAYEL_PROMOTION_SPEND_DELEGATION_V1" as const
export const MAYEL_PROMOTION_SPEND_DELEGATION_CONFIRMATION =
  "AUTORIZAR MAYEL PROMOCION DENTRO DE LIMITES" as const
export const MAYEL_PROMOTION_SPEND_DELEGATION_REVOKE_CONFIRMATION =
  "REVOCAR DELEGACION DE PROMOCION DE MAYEL" as const

export const MAYEL_PROMOTION_VALIDATION_POLICY = Object.freeze({
  promotionCapabilityProven: true, ebayAccountEligible: true,
  economicsProven: true, profitFloorRequired: true,
  marginFloorRequired: true, roiFloorRequired: true,
  spendWithinOwnerCeilings: true, noExperimentConflict: true,
  freshOfficialPrewriteReadbackRequired: true,
  singleBoundedWriteRequired: true,
  officialPostwriteReadbackRequired: true,
  unknownResultAutoRetry: false,
})

export type MayelPromotionSpendCeilingsV1 = Readonly<{
  maxAdSpendPerListing: number
  maxAdSpendPerDay: number
  maxPortfolioAdSpendPerDay: number
  maxAdRatePercent: number
  minExpectedProfitAfterAds: number
  minMarginAfterAdsPercent: number
  minRoiAfterAdsPercent: number
}>

type JsonRecord = Record<string, unknown>

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]))
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stable(value))).digest("hex")}`
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function validateMayelPromotionSpendCeilingsV1(
  value: unknown,
): MayelPromotionSpendCeilingsV1 | null {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
  const limits = {
    maxAdSpendPerListing: finite(row.maxAdSpendPerListing),
    maxAdSpendPerDay: finite(row.maxAdSpendPerDay),
    maxPortfolioAdSpendPerDay: finite(row.maxPortfolioAdSpendPerDay),
    maxAdRatePercent: finite(row.maxAdRatePercent),
    minExpectedProfitAfterAds: finite(row.minExpectedProfitAfterAds),
    minMarginAfterAdsPercent: finite(row.minMarginAfterAdsPercent),
    minRoiAfterAdsPercent: finite(row.minRoiAfterAdsPercent),
  }
  if (limits.maxAdSpendPerListing === null ||
      limits.maxAdSpendPerDay === null ||
      limits.maxPortfolioAdSpendPerDay === null ||
      limits.maxAdRatePercent === null ||
      limits.minExpectedProfitAfterAds === null ||
      limits.minMarginAfterAdsPercent === null ||
      limits.minRoiAfterAdsPercent === null ||
      limits.maxAdSpendPerListing <= 0 || limits.maxAdSpendPerDay <= 0 ||
      limits.maxPortfolioAdSpendPerDay <= 0 ||
      limits.maxAdRatePercent <= 0 || limits.maxAdRatePercent > 100 ||
      limits.minExpectedProfitAfterAds < 0 ||
      limits.minMarginAfterAdsPercent < 0 ||
      limits.minMarginAfterAdsPercent > 100 ||
      limits.minRoiAfterAdsPercent < 0) return null
  return Object.freeze(limits as MayelPromotionSpendCeilingsV1)
}

function publicAuthority(row: JsonRecord | null) {
  if (!row?.id) return null
  return Object.freeze({
    authorityId: String(row.id), status: String(row.status),
    scope: String(row.scope), contractVersion: String(row.contract_version),
    ownerConfirmedAt: typeof row.owner_confirmed_at === "string"
      ? row.owner_confirmed_at : null,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    authorityDigest: String(row.authority_digest ?? ""),
    ceilings: Object.freeze({
      maxAdSpendPerListing: Number(row.max_ad_spend_per_listing),
      maxAdSpendPerDay: Number(row.max_ad_spend_per_day),
      maxPortfolioAdSpendPerDay:
        Number(row.max_portfolio_ad_spend_per_day),
      maxAdRatePercent: Number(row.max_ad_rate_percent),
      minExpectedProfitAfterAds: Number(row.min_expected_profit_after_ads),
      minMarginAfterAdsPercent:
        Number(row.min_margin_after_ads_percent),
      minRoiAfterAdsPercent: Number(row.min_roi_after_ads_percent),
    }),
    ownerPerPromotionApproval: false as const,
    validationPolicy: MAYEL_PROMOTION_VALIDATION_POLICY,
  })
}

async function activeAuthority(input: { supabase: SupabaseClient
  accountKey: string }) {
  const read = await input.supabase.from(
    "ebay_mayel_promotion_spend_delegation_authorities_v1")
    .select("*").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE")
    .limit(1).maybeSingle()
  if (read.error) throw new Error("MAYEL_PROMOTION_DELEGATION_READ_FAILED")
  return read.data as JsonRecord | null
}

export async function readMayelPromotionSpendDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerAuthenticated: boolean
}) {
  const [activeRead, visual] = await Promise.all([
    activeAuthority(input).then((authority) => ({ authority, error: null }))
      .catch((error) => ({ authority: null, error: error instanceof Error
        ? error.message : "MAYEL_PROMOTION_DELEGATION_READ_FAILED" })),
    readMayelFullVisualDelegationV1(input),
  ])
  const active = publicAuthority(activeRead.authority)
  const predicates = Object.freeze([
    { code: "OWNER_AUTHENTICATED", pass: input.ownerAuthenticated },
    { code: "EBAY_ACCOUNT_IDENTITY_PROVEN",
      pass: visual.globalAccountIdentityProven },
    { code: "MAYEL_WORKSPACE_READY", pass: visual.predicates.find((row) =>
      row.code === "MAYEL_WORKSPACE_READY")?.pass === true },
    { code: "PROMOTION_SCOPE_VALID", pass: true },
    { code: "AUTHORITY_STORAGE_READY", pass: activeRead.error === null },
    { code: "REVOCATION_READY", pass: activeRead.error === null },
  ])
  const blocker = predicates.find((row) => row.pass !== true)?.code ?? null
  return Object.freeze({
    contractVersion: MAYEL_PROMOTION_SPEND_DELEGATION_VERSION,
    active, promotionSpendDelegationActive: active?.status === "ACTIVE",
    ownerPerPromotionApproval: false as const,
    ownerCeilingsRequired: true as const,
    authorizationButtonEnabled: !active && blocker === null,
    firstBlockingPredicate: active ? null : blocker,
    predicates, validationPolicy: MAYEL_PROMOTION_VALIDATION_POLICY,
    recommendationOnlyWhenCapabilityUnproven: true as const,
    directWriteWithoutValidatedCeilings: false as const,
    marketplaceWrites: 0 as const,
  })
}

export async function authorizeMayelPromotionSpendDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  ceilings: unknown
}) {
  const current = await readMayelPromotionSpendDelegationV1({
    ...input, ownerAuthenticated: true })
  if (current.active) return { authority: current.active, idempotent: true,
    marketplaceWrites: 0 as const }
  if (!current.authorizationButtonEnabled) throw new Error(
    `MAYEL_PROMOTION_DELEGATION_BLOCKED_${current.firstBlockingPredicate ?? "UNKNOWN"}`)
  const ceilings = validateMayelPromotionSpendCeilingsV1(input.ceilings)
  if (!ceilings) throw new Error("MAYEL_PROMOTION_CEILINGS_INVALID")
  const material = {
    authorityId: randomUUID(), ownerUserId: input.ownerUserId,
    marketplaceAccountKey: input.accountKey, marketplaceId: "EBAY_US",
    scope: "CAPPED_VALIDATED_PROMOTION_SPEND",
    contractVersion: MAYEL_PROMOTION_SPEND_DELEGATION_VERSION,
    ceilings, validationPolicy: MAYEL_PROMOTION_VALIDATION_POLICY,
    allowedActions:
      ["PROMOTED_LISTINGS_CPS_ACTIVATE_OR_ADJUST_WITHIN_CEILINGS"],
    forbiddenActions: ["PRICE", "QUANTITY", "CATEGORY", "CONDITION",
      "BUSINESS_POLICIES", "PRODUCT_IDENTITY", "SKU", "BUYER_MESSAGES",
      "REFUNDS", "RETURNS_ACTION", "ORDER_ACTION", "END_LISTING",
      "SEND_OFFERS", "UNBOUNDED_SPEND"],
    sourceAuthority: "OWNER_ONE_TIME_CAPPED_PROMOTION_DELEGATION",
    accountIdentityAuthority: "EBAY_OFFICIAL_IDENTITY_BOUND",
    ownerConfirmedAt: new Date().toISOString(),
  }
  const authorityDigest = digest(material)
  const inserted = await input.supabase.from(
    "ebay_mayel_promotion_spend_delegation_authorities_v1")
    .insert({ id: material.authorityId, owner_user_id: input.ownerUserId,
      marketplace_account_key: input.accountKey,
      marketplace_id: material.marketplaceId, scope: material.scope,
      contract_version: material.contractVersion,
      max_ad_spend_per_listing: ceilings.maxAdSpendPerListing,
      max_ad_spend_per_day: ceilings.maxAdSpendPerDay,
      max_portfolio_ad_spend_per_day:
        ceilings.maxPortfolioAdSpendPerDay,
      max_ad_rate_percent: ceilings.maxAdRatePercent,
      min_expected_profit_after_ads: ceilings.minExpectedProfitAfterAds,
      min_margin_after_ads_percent: ceilings.minMarginAfterAdsPercent,
      min_roi_after_ads_percent: ceilings.minRoiAfterAdsPercent,
      validation_policy: material.validationPolicy,
      allowed_actions: material.allowedActions,
      forbidden_actions: material.forbiddenActions,
      source_authority: material.sourceAuthority,
      account_identity_authority: material.accountIdentityAuthority,
      authority_digest: authorityDigest, status: "ACTIVE",
      owner_confirmed_at: material.ownerConfirmedAt })
    .select("*").single()
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === "23505") {
      const concurrent = await activeAuthority(input)
      if (concurrent) return { authority: publicAuthority(concurrent),
        idempotent: true, marketplaceWrites: 0 as const }
    }
    throw new Error("MAYEL_PROMOTION_DELEGATION_PERSIST_FAILED")
  }
  const authority = publicAuthority(inserted.data)
  if (!authority || authority.authorityDigest !== authorityDigest) {
    throw new Error("MAYEL_PROMOTION_DELEGATION_READBACK_FAILED")
  }
  return { authority, idempotent: false, marketplaceWrites: 0 as const }
}

export async function revokeMayelPromotionSpendDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
}) {
  const current = await activeAuthority(input)
  if (!current) return { authority: null, idempotent: true,
    marketplaceWrites: 0 as const }
  const revokedAt = new Date().toISOString()
  const updated = await input.supabase.from(
    "ebay_mayel_promotion_spend_delegation_authorities_v1")
    .update({ status: "REVOKED", revoked_at: revokedAt,
      revoked_by: input.ownerUserId }).eq("id", current.id)
    .eq("status", "ACTIVE").select("*").single()
  if (updated.error || !updated.data) throw new Error(
    "MAYEL_PROMOTION_DELEGATION_REVOCATION_FAILED")
  return { authority: publicAuthority(updated.data), idempotent: false,
    marketplaceWrites: 0 as const }
}
