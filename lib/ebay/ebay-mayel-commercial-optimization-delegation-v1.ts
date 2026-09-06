import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { readMayelFullVisualDelegationV1 } from
  "./ebay-mayel-full-visual-delegation-server-v1"

export const MAYEL_COMMERCIAL_OPTIMIZATION_DELEGATION_VERSION =
  "MAYEL_FULL_LISTING_COMMERCIAL_OPTIMIZATION_DELEGATION_V1" as const
export const MAYEL_COMMERCIAL_OPTIMIZATION_DELEGATION_CONFIRMATION =
  "AUTORIZAR MAYEL OPTIMIZACION COMERCIAL DE LISTINGS" as const
export const MAYEL_COMMERCIAL_OPTIMIZATION_DELEGATION_REVOKE_CONFIRMATION =
  "REVOCAR DELEGACION COMERCIAL DE MAYEL" as const

export const MAYEL_COMMERCIAL_OPTIMIZATION_ALLOWED_ACTIONS = Object.freeze([
  "TITLE", "DESCRIPTION", "ITEM_SPECIFICS",
  "SUPPORTED_LISTING_ATTRIBUTES", "KEYWORD_INTELLIGENCE",
  "MARKET_REVALIDATION", "CATEGORY_RECOMMENDATION",
] as const)

export const MAYEL_COMMERCIAL_OPTIMIZATION_FORBIDDEN_ACTIONS = Object.freeze([
  "UNPROVEN_PRODUCT_FACTS", "CATEGORY_AUTO_WRITE_WITHOUT_CERTIFICATION",
  "PRICE_DIRECT_WRITE", "QUANTITY", "CONDITION", "BUSINESS_POLICIES",
  "SKU", "PRODUCT_IDENTITY", "PROMOTION", "SPEND", "BUYER_MESSAGES",
  "REFUNDS", "RETURNS_ACTION", "ORDER_ACTION", "END_LISTING",
  "CREDENTIAL_ACCESS",
] as const)

export const MAYEL_COMMERCIAL_OPTIMIZATION_VALIDATION_POLICY = Object.freeze({
  productTruthRequiredForFactualWrites: true,
  keywordsOnlyInEbaySupportedFields: true,
  categoryWriteRequiresSeparateCertification: true,
  freshOfficialPrewriteReadbackRequired: true,
  correctManagementModelExecutorRequired: true,
  singleBoundedWriteRequired: true,
  officialPostwriteReadbackRequired: true,
  unknownResultAutoRetry: false,
})

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

function publicAuthority(row: JsonRecord | null) {
  if (!row?.id) return null
  return Object.freeze({
    authorityId: String(row.id), status: String(row.status),
    scope: String(row.scope), contractVersion: String(row.contract_version),
    ownerConfirmedAt: typeof row.owner_confirmed_at === "string"
      ? row.owner_confirmed_at : null,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    authorityDigest: String(row.authority_digest ?? ""),
    ownerPerListingApproval: false as const,
    allowedActions: MAYEL_COMMERCIAL_OPTIMIZATION_ALLOWED_ACTIONS,
    forbiddenActions: MAYEL_COMMERCIAL_OPTIMIZATION_FORBIDDEN_ACTIONS,
    validationPolicy: MAYEL_COMMERCIAL_OPTIMIZATION_VALIDATION_POLICY,
  })
}

async function activeAuthority(input: { supabase: SupabaseClient
  accountKey: string }) {
  const read = await input.supabase.from(
    "ebay_mayel_commercial_optimization_delegation_authorities_v1")
    .select("*").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE")
    .limit(1).maybeSingle()
  if (read.error) throw new Error("MAYEL_COMMERCIAL_DELEGATION_READ_FAILED")
  return read.data as JsonRecord | null
}

export async function readMayelCommercialOptimizationDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerAuthenticated: boolean
}) {
  const [activeRead, visual] = await Promise.all([
    activeAuthority(input).then((authority) => ({ authority, error: null }))
      .catch((error) => ({ authority: null, error: error instanceof Error
        ? error.message : "MAYEL_COMMERCIAL_DELEGATION_READ_FAILED" })),
    readMayelFullVisualDelegationV1(input),
  ])
  const active = publicAuthority(activeRead.authority)
  const predicates = Object.freeze([
    { code: "OWNER_AUTHENTICATED", pass: input.ownerAuthenticated },
    { code: "EBAY_ACCOUNT_IDENTITY_PROVEN",
      pass: visual.globalAccountIdentityProven },
    { code: "MAYEL_WORKSPACE_READY", pass: visual.predicates.find((row) =>
      row.code === "MAYEL_WORKSPACE_READY")?.pass === true },
    { code: "COMMERCIAL_SCOPE_VALID", pass: true },
    { code: "AUTHORITY_STORAGE_READY", pass: activeRead.error === null },
    { code: "REVOCATION_READY", pass: activeRead.error === null },
  ])
  const blocker = predicates.find((row) => row.pass !== true)?.code ?? null
  return Object.freeze({
    contractVersion: MAYEL_COMMERCIAL_OPTIMIZATION_DELEGATION_VERSION,
    active,
    fullListingCommercialDelegationActive: active?.status === "ACTIVE",
    mayelContentOptimizationAuthority: active?.status === "ACTIVE",
    mayelKeywordOptimizationAuthority: active?.status === "ACTIVE",
    mayelMarketRevalidationAuthority: active?.status === "ACTIVE",
    ownerPerListingApproval: false as const,
    authorizationButtonEnabled: !active && blocker === null,
    firstBlockingPredicate: active ? null : blocker,
    predicates,
    allowedActions: MAYEL_COMMERCIAL_OPTIMIZATION_ALLOWED_ACTIONS,
    forbiddenActions: MAYEL_COMMERCIAL_OPTIMIZATION_FORBIDDEN_ACTIONS,
    validationPolicy: MAYEL_COMMERCIAL_OPTIMIZATION_VALIDATION_POLICY,
    categoryRecommendationOnlyUntilCertified: true as const,
    marketplaceWrites: 0 as const,
  })
}

export async function authorizeMayelCommercialOptimizationDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
}) {
  const current = await readMayelCommercialOptimizationDelegationV1({
    ...input, ownerAuthenticated: true })
  if (current.active) return { authority: current.active, idempotent: true,
    marketplaceWrites: 0 as const }
  if (!current.authorizationButtonEnabled) throw new Error(
    `MAYEL_COMMERCIAL_DELEGATION_BLOCKED_${current.firstBlockingPredicate ?? "UNKNOWN"}`)
  const material = {
    authorityId: randomUUID(), ownerUserId: input.ownerUserId,
    marketplaceAccountKey: input.accountKey, marketplaceId: "EBAY_US",
    scope: "FULL_LISTING_CONTENT_AND_MARKET_OPTIMIZATION",
    contractVersion: MAYEL_COMMERCIAL_OPTIMIZATION_DELEGATION_VERSION,
    allowedActions: MAYEL_COMMERCIAL_OPTIMIZATION_ALLOWED_ACTIONS,
    forbiddenActions: MAYEL_COMMERCIAL_OPTIMIZATION_FORBIDDEN_ACTIONS,
    validationPolicy: MAYEL_COMMERCIAL_OPTIMIZATION_VALIDATION_POLICY,
    sourceAuthority: "OWNER_ONE_TIME_LISTING_COMMERCIAL_DELEGATION",
    accountIdentityAuthority: "EBAY_OFFICIAL_IDENTITY_BOUND",
    ownerConfirmedAt: new Date().toISOString(),
  }
  const authorityDigest = digest(material)
  const inserted = await input.supabase.from(
    "ebay_mayel_commercial_optimization_delegation_authorities_v1")
    .insert({ id: material.authorityId, owner_user_id: input.ownerUserId,
      marketplace_account_key: input.accountKey,
      marketplace_id: material.marketplaceId, scope: material.scope,
      contract_version: material.contractVersion,
      allowed_actions: material.allowedActions,
      forbidden_actions: material.forbiddenActions,
      validation_policy: material.validationPolicy,
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
    throw new Error("MAYEL_COMMERCIAL_DELEGATION_PERSIST_FAILED")
  }
  const authority = publicAuthority(inserted.data)
  if (!authority || authority.authorityDigest !== authorityDigest) {
    throw new Error("MAYEL_COMMERCIAL_DELEGATION_READBACK_FAILED")
  }
  return { authority, idempotent: false, marketplaceWrites: 0 as const }
}

export async function revokeMayelCommercialOptimizationDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
}) {
  const current = await activeAuthority(input)
  if (!current) return { authority: null, idempotent: true,
    marketplaceWrites: 0 as const }
  const revokedAt = new Date().toISOString()
  const updated = await input.supabase.from(
    "ebay_mayel_commercial_optimization_delegation_authorities_v1")
    .update({ status: "REVOKED", revoked_at: revokedAt,
      revoked_by: input.ownerUserId }).eq("id", current.id)
    .eq("status", "ACTIVE").select("*").single()
  if (updated.error || !updated.data) throw new Error(
    "MAYEL_COMMERCIAL_DELEGATION_REVOCATION_FAILED")
  return { authority: publicAuthority(updated.data), idempotent: false,
    marketplaceWrites: 0 as const }
}
