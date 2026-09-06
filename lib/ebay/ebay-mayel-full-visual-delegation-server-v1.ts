import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { readCanonicalEbayAccountIdentityAuthorityV1 } from
  "./ebay-account-policy-readonly-gateway"
import {
  buildMayelFullVisualDelegationPredicatesV1,
  MAYEL_FULL_VISUAL_ALLOWED_ACTIONS,
  MAYEL_FULL_VISUAL_DELEGATION_VERSION,
  MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS,
  MAYEL_VISUAL_EXECUTION_BOUNDARY_VERSION,
  mayelFullVisualDelegationDigestV1,
  mayelFullVisualDelegationMaterialV1,
  mayelFullVisualScopeContractValidV1,
} from "./ebay-mayel-full-visual-delegation-v1"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function publicAuthority(value: unknown) {
  const row = record(value)
  if (!row.id) return null
  return Object.freeze({
    authorityId: String(row.id),
    contractVersion: String(row.contract_version),
    scope: String(row.scope),
    marketplaceId: String(row.marketplace_id),
    status: String(row.status),
    allowedActions: Array.isArray(row.allowed_actions)
      ? row.allowed_actions.map(String) : [],
    forbiddenActions: Array.isArray(row.forbidden_actions)
      ? row.forbidden_actions.map(String) : [],
    mainImageAuthority: row.main_image_authority === true,
    ownerPerImageApproval: row.owner_per_image_approval === true,
    ownerPerListingVisualApproval:
      row.owner_per_listing_visual_approval === true,
    ownerConfirmedAt: typeof row.owner_confirmed_at === "string"
      ? row.owner_confirmed_at : null,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    authorityDigest: typeof row.authority_digest === "string"
      ? row.authority_digest : null,
  })
}

async function activeAuthority(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const { data, error } = await input.supabase
    .from("ebay_mayel_visual_delegation_authorities_v1")
    .select("*")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("status", "ACTIVE")
    .maybeSingle()
  if (error) throw new Error("MAYEL_VISUAL_DELEGATION_READ_FAILED")
  return data as JsonRecord | null
}

export async function readMayelFullVisualDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerAuthenticated: boolean
  fetchImpl?: typeof fetch
}) {
  const [{ count: taskCount, error: workspaceError }, authorityResult,
    identityResult] = await Promise.all([
    input.supabase.from("ebay_mayel_visual_tasks_v1")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_account_key", input.accountKey),
    activeAuthority(input)
      .then((authority) => ({ authority, error: null as string | null }))
      .catch((error) => ({ authority: null,
        error: error instanceof Error ? error.message :
          "MAYEL_VISUAL_DELEGATION_READ_FAILED" })),
    input.ownerAuthenticated
      ? readCanonicalEbayAccountIdentityAuthorityV1(
        input.fetchImpl ?? fetch)
        .then((authority) => ({ authority, error: null as string | null }))
        .catch((error) => ({ authority: null,
          error: error instanceof Error ? error.message :
            "EBAY_IDENTITY_PREFLIGHT_FAILED" }))
      : Promise.resolve({ authority: null, error: null as string | null }),
  ])
  const authorityStorageReady = authorityResult.error === null
  const predicateState = buildMayelFullVisualDelegationPredicatesV1({
    ownerAuthenticated: input.ownerAuthenticated,
    workspaceReady: !workspaceError,
    accountIdentityProven:
      identityResult.authority?.status === "BOUND",
    delegationScopeValid: mayelFullVisualScopeContractValidV1(),
    authorityStorageReady,
    revocationReady: authorityStorageReady,
  })
  const active = publicAuthority(authorityResult.authority)
  return Object.freeze({
    contractVersion: MAYEL_FULL_VISUAL_DELEGATION_VERSION,
    authorizationButtonRendered: input.ownerAuthenticated,
    authorizationButtonDisabled: Boolean(active)
      || !predicateState.buttonEnabled,
    authorizationButtonEnabled: !active && predicateState.buttonEnabled,
    disableReason: active ? "La delegación visual ya está activa."
      : predicateState.disableReason,
    firstBlockingPredicate: active ? null
      : predicateState.firstBlockingPredicate,
    predicates: predicateState.predicates,
    active,
    fullVisualDelegationActive: active?.status === "ACTIVE",
    workspaceTaskCount: taskCount ?? null,
    globalDelegationEligible: predicateState.buttonEnabled,
    globalAccountIdentityProven:
      identityResult.authority?.status === "BOUND",
    accountIdentity: identityResult.authority ? {
      status: identityResult.authority.status,
      sourceAuthority: identityResult.authority.sourceAuthority,
      observedAt: identityResult.authority.observedAt,
      marketplaceId: identityResult.authority.marketplaceId,
    } : null,
    authorityStorageReady,
    revocationReady: authorityStorageReady,
    identityReadStatus: identityResult.authority
      ? "OFFICIAL_IDENTITY_READ_PASS" : "OFFICIAL_IDENTITY_READ_FAILED",
    identityFailureClass: identityResult.error,
    scope: {
      allowedActions: MAYEL_FULL_VISUAL_ALLOWED_ACTIONS,
      forbiddenActions: MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS,
      mainImageAuthority: true,
      ownerPerImageApproval: false,
      ownerPerListingVisualApproval: false,
    },
    taskExecutionReadinessIsSeparate: true,
    marketplaceWrites: 0,
  })
}

export async function authorizeMayelFullVisualDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  fetchImpl?: typeof fetch
}) {
  const current = await readMayelFullVisualDelegationV1({ ...input,
    ownerAuthenticated: true })
  if (current.active) return Object.freeze({ authority: current.active,
    idempotent: true, marketplaceWrites: 0 })
  if (!current.authorizationButtonEnabled) {
    throw new Error(current.firstBlockingPredicate
      ? `MAYEL_VISUAL_DELEGATION_BLOCKED_${current.firstBlockingPredicate}`
      : "MAYEL_VISUAL_DELEGATION_PREREQUISITES_FAILED")
  }
  const authorityId = randomUUID()
  const ownerConfirmedAt = new Date().toISOString()
  const material = mayelFullVisualDelegationMaterialV1({ authorityId,
    ownerUserId: input.ownerUserId, accountKey: input.accountKey,
    ownerConfirmedAt })
  const authorityDigest = mayelFullVisualDelegationDigestV1(material)
  const { data, error } = await input.supabase
    .from("ebay_mayel_visual_delegation_authorities_v1")
    .insert({
      id: authorityId,
      owner_user_id: input.ownerUserId,
      marketplace_account_key: input.accountKey,
      marketplace_id: material.marketplaceId,
      scope: material.scope,
      contract_version: material.contractVersion,
      allowed_actions: material.allowedActions,
      forbidden_actions: material.forbiddenActions,
      main_image_authority: material.mainImageAuthority,
      owner_per_image_approval: material.ownerPerImageApproval,
      owner_per_listing_visual_approval:
        material.ownerPerListingVisualApproval,
      source_authority: material.sourceAuthority,
      account_identity_authority: material.accountIdentityAuthority,
      execution_boundary_version: material.executionBoundaryVersion,
      authority_digest: authorityDigest,
      status: "ACTIVE",
      owner_confirmed_at: ownerConfirmedAt,
    }).select("*").single()
  if (error || !data) {
    if (error?.code === "23505") {
      const concurrent = await activeAuthority(input)
      if (concurrent) return Object.freeze({
        authority: publicAuthority(concurrent), idempotent: true,
        marketplaceWrites: 0 })
    }
    throw new Error("MAYEL_VISUAL_DELEGATION_PERSIST_FAILED")
  }
  const persisted = publicAuthority(data)
  if (!persisted || persisted.authorityDigest !== authorityDigest
    || persisted.status !== "ACTIVE") {
    throw new Error("MAYEL_VISUAL_DELEGATION_DURABLE_READBACK_FAILED")
  }
  return Object.freeze({ authority: persisted, idempotent: false,
    marketplaceWrites: 0 })
}

export async function revokeMayelFullVisualDelegationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
}) {
  const current = await activeAuthority(input)
  if (!current) return Object.freeze({ authority: null, idempotent: true,
    marketplaceWrites: 0 })
  const revokedAt = new Date().toISOString()
  const { data, error } = await input.supabase
    .from("ebay_mayel_visual_delegation_authorities_v1")
    .update({ status: "REVOKED", revoked_at: revokedAt,
      revoked_by: input.ownerUserId })
    .eq("id", String(current.id)).eq("status", "ACTIVE")
    .select("*").single()
  if (error || !data) {
    throw new Error("MAYEL_VISUAL_DELEGATION_REVOCATION_FAILED")
  }
  const persisted = publicAuthority(data)
  if (!persisted || persisted.status !== "REVOKED"
    || !persisted.revokedAt) {
    throw new Error("MAYEL_VISUAL_DELEGATION_REVOCATION_READBACK_FAILED")
  }
  return Object.freeze({ authority: persisted, idempotent: false,
    marketplaceWrites: 0 })
}
