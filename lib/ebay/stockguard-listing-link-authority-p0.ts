import type { SupabaseClient } from "@supabase/supabase-js"

export const STOCKGUARD_LISTING_LINK_AUTHORITY_P0 =
  "STOCKGUARD_LISTING_LINK_AUTHORITY_P0_2026_09_19" as const

export type ListingLinkLifecycleV1 =
  | "ACTIVE"
  | "SUPERSEDED"
  | "UNLINKED"
  | "INVALIDATED"

export type ListingLinkAuthorityRowV1 = Readonly<{
  authority_id: string
  account_key: string
  marketplace_id: "EBAY_US"
  ebay_item_id: string
  ebay_sku: string
  seller_os_product_id: string
  luna_product_id: string
  luna_variant_id: string
  luna_sku: string
  supplier_quantity_required: number
  evidence_maximum_age_seconds: number
  components: readonly Record<string, unknown>[]
  identity_key: string
  linkage_id: string
  source_decision_id: string
  lifecycle_state: ListingLinkLifecycleV1
  previous_authority_id: string | null
  transition_reason_code: string
  actor_type: "OWNER" | "SYSTEM"
  actor_reference: string
  identity_preflight_status: string
  source_fingerprint: string | null
  identity_engine_version: string | null
  preflight_contract_version: string | null
  activated_at: string
  ended_at: string | null
  created_at: string
  updated_at: string
}>

export type ListingIdentityQuarantineRowV1 = Readonly<{
  quarantine_id: string
  account_key: string
  marketplace_id: "EBAY_US"
  ebay_item_id: string
  ebay_sku: string
  quarantine_state: "ACTIVE" | "RESOLVED"
  reason_code: string
  conflicting_item_ids: readonly string[]
  authority_id: string | null
  observed_at: string
  resolved_at: string | null
}>

type LiveListing = Readonly<{
  ebay_item_id: string
  ebay_sku: string | null
  listing_status: string
}>

const ITEM_ID = /^\d{9,20}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DECISION_ID = /^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$/
const AUTHORITY_ID = /^listing-link-authority-v1:sha256:[0-9a-f]{64}$/
const REASON = /^[A-Z][A-Z0-9_]{2,119}$/

function text(value: unknown, maximum = 240) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum) : null
}

function normalizedSku(value: unknown) {
  return text(value, 160)?.toUpperCase() ?? null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export function projectStockguardListingAuthorityP0(input: Readonly<{
  listing: LiveListing
  liveListings: readonly LiveListing[]
  authorities: readonly ListingLinkAuthorityRowV1[]
  quarantines: readonly ListingIdentityQuarantineRowV1[]
}>) {
  const itemId = input.listing.ebay_item_id
  const sku = normalizedSku(input.listing.ebay_sku)
  const history = input.authorities.filter((row) =>
    row.ebay_item_id === itemId).sort((left, right) =>
    Date.parse(right.updated_at) - Date.parse(left.updated_at))
  const active = history.find((row) => row.lifecycle_state === "ACTIVE") ?? null
  const quarantine = input.quarantines.find((row) =>
    row.ebay_item_id === itemId && row.quarantine_state === "ACTIVE") ?? null
  const conflictingLiveItemIds = sku ? input.liveListings.filter((row) =>
    row.listing_status === "active" && normalizedSku(row.ebay_sku) === sku &&
    row.ebay_item_id !== itemId).map((row) => row.ebay_item_id).sort() : []
  const activeSkuAuthorities = sku ? input.authorities.filter((row) =>
    row.lifecycle_state === "ACTIVE" && normalizedSku(row.ebay_sku) === sku) : []
  const activeIdentityAuthorities = active ? input.authorities.filter((row) =>
    row.lifecycle_state === "ACTIVE" && row.identity_key === active.identity_key) : []
  const exactActiveAuthority = Boolean(active && sku &&
    normalizedSku(active.ebay_sku) === sku && activeSkuAuthorities.length === 1 &&
    activeIdentityAuthorities.length === 1)
  const stockguardEligible = input.listing.listing_status === "active" &&
    exactActiveAuthority && !quarantine
  return Object.freeze({
    contractVersion: STOCKGUARD_LISTING_LINK_AUTHORITY_P0,
    itemId,
    ebaySku: input.listing.ebay_sku,
    lifecycleState: active?.lifecycle_state ?? history[0]?.lifecycle_state ?? null,
    latestAuthority: history[0] ?? null,
    authority: active,
    quarantine,
    conflictingLiveItemIds: Object.freeze(conflictingLiveItemIds),
    liveSkuCardinality: sku ? conflictingLiveItemIds.length + 1 : 0,
    activeSkuAuthorityCardinality: activeSkuAuthorities.length,
    activeIdentityAuthorityCardinality: activeIdentityAuthorities.length,
    stockguardEligible,
    limitationCode: stockguardEligible ? null : quarantine
      ? "QUARANTINED_DUPLICATE_SKU"
      : !active ? "CANONICAL_ACTIVE_LINK_AUTHORITY_REQUIRED"
      : !exactActiveAuthority ? "CANONICAL_LINK_AUTHORITY_CARDINALITY_INVALID"
      : "CURRENT_LIVE_LISTING_REQUIRED",
  })
}

export function resolveCanonicalReverseListingAuthorityP0(input: Readonly<{
  identityKey?: string
  sellerOsProductId?: string
  lunaTuple?: Readonly<{ productId: string; variantId: string; sku: string }>
  ebaySku?: string
  authorities: readonly ListingLinkAuthorityRowV1[]
  quarantines: readonly ListingIdentityQuarantineRowV1[]
}>) {
  const rows = input.authorities.filter((row) => input.identityKey
    ? row.identity_key === input.identityKey
    : input.sellerOsProductId ? row.seller_os_product_id === input.sellerOsProductId
    : input.lunaTuple ? row.luna_product_id === input.lunaTuple.productId &&
      row.luna_variant_id === input.lunaTuple.variantId &&
      row.luna_sku === input.lunaTuple.sku
    : input.ebaySku ? normalizedSku(row.ebay_sku) === normalizedSku(input.ebaySku)
    : false)
  const active = rows.filter((row) => row.lifecycle_state === "ACTIVE")
  const quarantineByItem = new Map(input.quarantines.filter((row) =>
    row.quarantine_state === "ACTIVE").map((row) => [row.ebay_item_id, row]))
  return Object.freeze({
    contractVersion: STOCKGUARD_LISTING_LINK_AUTHORITY_P0,
    identityKey: input.identityKey ?? rows[0]?.identity_key ?? null,
    authoritative: active.length === 1 && !quarantineByItem.has(active[0].ebay_item_id)
      ? active[0] : null,
    activeCardinality: active.length,
    history: Object.freeze(rows.map((row) => Object.freeze({
      authorityId: row.authority_id,
      itemId: row.ebay_item_id,
      state: quarantineByItem.has(row.ebay_item_id)
        ? "QUARANTINED_DUPLICATE_SKU" : row.lifecycle_state,
      previousAuthorityId: row.previous_authority_id,
    }))),
  })
}

export async function readCanonicalReverseListingAuthorityP0(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  identityKey?: string
  sellerOsProductId?: string
  lunaTuple?: Readonly<{ productId: string; variantId: string; sku: string }>
  ebaySku?: string
}>) {
  const selectorCount = Number(Boolean(input.identityKey)) +
    Number(Boolean(input.sellerOsProductId)) + Number(Boolean(input.lunaTuple)) +
    Number(Boolean(input.ebaySku))
  if (selectorCount !== 1) throw new Error("LISTING_LINK_REVERSE_SELECTOR_INVALID")
  let query = input.supabase.from("seller_os_listing_product_link_authorities_v1")
    .select("*").eq("account_key", input.accountKey)
  if (input.identityKey) query = query.eq("identity_key", input.identityKey)
  if (input.sellerOsProductId) {
    query = query.eq("seller_os_product_id", input.sellerOsProductId)
  }
  if (input.lunaTuple) query = query.eq("luna_product_id", input.lunaTuple.productId)
    .eq("luna_variant_id", input.lunaTuple.variantId).eq("luna_sku", input.lunaTuple.sku)
  if (input.ebaySku) query = query.eq("ebay_sku", input.ebaySku)
  const authorityRead = await query.order("updated_at", { ascending: false })
  if (authorityRead.error) throw new Error("LISTING_LINK_REVERSE_READ_FAILED")
  const authorities = (authorityRead.data ?? []) as ListingLinkAuthorityRowV1[]
  const itemIds = [...new Set(authorities.map((row) => row.ebay_item_id))]
  const quarantineRead = itemIds.length
    ? await input.supabase.from("seller_os_listing_identity_quarantines_v1")
      .select("*").eq("account_key", input.accountKey).in("ebay_item_id", itemIds)
    : { data: [], error: null }
  if (quarantineRead.error) throw new Error("LISTING_LINK_REVERSE_READ_FAILED")
  return resolveCanonicalReverseListingAuthorityP0({ ...input, authorities,
    quarantines: (quarantineRead.data ?? []) as ListingIdentityQuarantineRowV1[] })
}

export type ListingAuthorityMutationAction =
  | "CREATE"
  | "REPLACE"
  | "UNLINK"
  | "INVALIDATE"

export function parseListingAuthorityMutationP0(value: unknown) {
  const input = record(value)
  const action = text(input.action, 40)?.toUpperCase() as
    ListingAuthorityMutationAction | undefined
  const ebayItemId = text(input.ebayItemId, 20)
  const sourceDecisionId = text(input.sourceDecisionId, 120)
  const expectedAuthorityId = text(input.expectedAuthorityId, 120)
  const reasonCode = text(input.reasonCode, 120)
  if (!action || !["CREATE", "REPLACE", "UNLINK", "INVALIDATE"].includes(action) ||
      !ebayItemId || !ITEM_ID.test(ebayItemId) || !reasonCode ||
      !REASON.test(reasonCode)) {
    throw new Error("LISTING_LINK_AUTHORITY_INPUT_INVALID")
  }
  if ((action === "CREATE" || action === "REPLACE") &&
      (!sourceDecisionId || !DECISION_ID.test(sourceDecisionId))) {
    throw new Error("LISTING_LINK_AUTHORITY_SOURCE_DECISION_REQUIRED")
  }
  if ((action === "UNLINK" || action === "INVALIDATE") &&
      (!expectedAuthorityId || !AUTHORITY_ID.test(expectedAuthorityId))) {
    throw new Error("LISTING_LINK_AUTHORITY_EXPECTED_ACTIVE_REQUIRED")
  }
  return Object.freeze({ action, ebayItemId, sourceDecisionId,
    expectedAuthorityId, reasonCode })
}

export async function readStockguardListingLinkAuthorityP0(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ebayItemId: string
}>) {
  if (!ITEM_ID.test(input.ebayItemId)) {
    throw new Error("LISTING_LINK_AUTHORITY_ITEM_ID_INVALID")
  }
  const listingRead = await input.supabase.from("ebay_active_listings")
    .select("ebay_item_id,ebay_sku,listing_status")
    .eq("account_key", input.accountKey).eq("ebay_item_id", input.ebayItemId)
    .maybeSingle()
  if (listingRead.error || !listingRead.data) {
    throw new Error("LISTING_LINK_AUTHORITY_LIVE_LISTING_REQUIRED")
  }
  const listing = listingRead.data as LiveListing
  const sku = text(listing.ebay_sku, 160)
  const [liveRead, authorityItemRead, authoritySkuRead, quarantineRead] = await Promise.all([
    sku ? input.supabase.from("ebay_active_listings")
      .select("ebay_item_id,ebay_sku,listing_status")
      .eq("account_key", input.accountKey).eq("listing_status", "active")
      .eq("ebay_sku", sku) : Promise.resolve({ data: [listing], error: null }),
    input.supabase.from("seller_os_listing_product_link_authorities_v1")
      .select("*").eq("account_key", input.accountKey)
      .eq("ebay_item_id", input.ebayItemId)
      .order("updated_at", { ascending: false }),
    sku ? input.supabase.from("seller_os_listing_product_link_authorities_v1")
      .select("*").eq("account_key", input.accountKey).eq("ebay_sku", sku)
      .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    input.supabase.from("seller_os_listing_identity_quarantines_v1")
      .select("*").eq("account_key", input.accountKey)
      .eq("ebay_item_id", input.ebayItemId)
      .order("observed_at", { ascending: false }),
  ])
  if (liveRead.error || authorityItemRead.error || authoritySkuRead.error ||
      quarantineRead.error) {
    throw new Error("LISTING_LINK_AUTHORITY_READ_FAILED")
  }
  const authorities = [...new Map([
    ...(authorityItemRead.data ?? []), ...(authoritySkuRead.data ?? []),
  ].map((row) => [String(row.authority_id), row])).values()]
  return projectStockguardListingAuthorityP0({ listing,
    liveListings: (liveRead.data ?? []) as LiveListing[],
    authorities: authorities as ListingLinkAuthorityRowV1[],
    quarantines: (quarantineRead.data ?? []) as ListingIdentityQuarantineRowV1[] })
}

const RPC_BY_ACTION: Record<ListingAuthorityMutationAction, string> = {
  CREATE: "create_seller_os_listing_product_link_authority_v1",
  REPLACE: "replace_seller_os_listing_product_link_authority_v1",
  UNLINK: "unlink_seller_os_listing_product_link_authority_v1",
  INVALIDATE: "invalidate_seller_os_listing_product_link_authority_v1",
}

export async function mutateStockguardListingLinkAuthorityP0(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  mutation: ReturnType<typeof parseListingAuthorityMutationP0>
}>) {
  if (!UUID.test(input.actorUserId)) {
    throw new Error("LISTING_LINK_AUTHORITY_OWNER_REQUIRED")
  }
  const mutation = input.mutation
  const { data, error } = await input.supabase.rpc(RPC_BY_ACTION[mutation.action], {
    p_account_key: input.accountKey,
    p_ebay_item_id: mutation.ebayItemId,
    p_source_decision_id: mutation.sourceDecisionId,
    p_expected_authority_id: mutation.expectedAuthorityId,
    p_actor_type: "OWNER",
    p_actor_reference: `OWNER:${input.actorUserId}`,
    p_reason_code: mutation.reasonCode,
  })
  if (error) {
    const code = typeof error.message === "string" &&
      /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message)
      ? error.message : "LISTING_LINK_AUTHORITY_WRITE_FAILED"
    throw new Error(code)
  }
  const result = record(data)
  const readback = await readStockguardListingLinkAuthorityP0({
    supabase: input.supabase, accountKey: input.accountKey,
    ebayItemId: mutation.ebayItemId,
  })
  const expectedState = mutation.action === "UNLINK" ? "UNLINKED"
    : mutation.action === "INVALIDATE" ? "INVALIDATED" : "ACTIVE"
  if (readback.lifecycleState !== expectedState ||
      (expectedState === "ACTIVE" && !readback.authority)) {
    throw new Error("LISTING_LINK_AUTHORITY_READBACK_MISMATCH")
  }
  return Object.freeze({ result, readback, marketplaceWrites: 0 as const,
    stockWrites: 0 as const })
}

export async function ensureStockguardAuthorityFromDecisionP0(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ebayItemId: string
  sourceDecisionId: string
  actorUserId: string | null
  automatedDeterministic: boolean
}>) {
  const current = await readStockguardListingLinkAuthorityP0(input)
  if (current.authority?.source_decision_id === input.sourceDecisionId &&
      current.stockguardEligible) return current
  if (input.automatedDeterministic && current.lifecycleState &&
      current.lifecycleState !== "ACTIVE") {
    throw new Error("LISTING_LINK_AUTHORITY_TOMBSTONE_BLOCKED")
  }
  const action: ListingAuthorityMutationAction = current.latestAuthority
    ? "REPLACE" : "CREATE"
  const { data, error } = await input.supabase.rpc(RPC_BY_ACTION[action], {
    p_account_key: input.accountKey,
    p_ebay_item_id: input.ebayItemId,
    p_source_decision_id: input.sourceDecisionId,
    p_expected_authority_id: current.latestAuthority?.authority_id ?? null,
    p_actor_type: input.actorUserId ? "OWNER" : "SYSTEM",
    p_actor_reference: input.actorUserId
      ? `OWNER:${input.actorUserId}` : "SYSTEM:UNMANAGED_LIVE_AUTO_INTAKE",
    p_reason_code: action === "CREATE"
      ? "CERTIFIED_LINK_AUTHORITY_CREATED" : "CERTIFIED_LINK_AUTHORITY_REPLACED",
  })
  if (error || !data) throw new Error("LISTING_LINK_AUTHORITY_WRITE_FAILED")
  return readStockguardListingLinkAuthorityP0(input)
}
