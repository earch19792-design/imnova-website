import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  isProvenSupplierLinkageV1,
  type CommercialListingReadModel,
} from "./commercial-monitor-readonly-contract"
import {
  ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION,
  applyPreparedVerifiedActiveListingTitle,
} from "./ebay-active-listing-title-revision-service"
import { buildVerifiedEbayTitle } from "./ebay-verified-title-strategy"
import {
  SELLER_OS_ACCESS_ROLES,
  sellerOsAccessRoleFromUser,
} from "../seller-os-access-control"

export const REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORITY =
  "REMOTE_OPERATOR_SAFE_TITLE_CANARY" as const
export const REMOTE_OPERATOR_SAFE_TITLE_CANARY_STRATEGY =
  "REMOTE_OPERATOR_VERIFIED_COLOR_TITLE_ENRICHMENT_V1" as const

type JsonRecord = Record<string, unknown>

type CanonicalCommercialException = Readonly<{
  entityKey: string
  entityType?: string
  classification: string
  reasonCodes?: readonly string[]
  recommendedAction?: string
  actionBlockedByEvidence?: boolean
  experimentProtectionExists?: boolean
  lastObservationTime?: string | null
  dedupeIdentity: string
  material?: boolean
}>

export type RemoteOperatorSafeMutationCanaryV1 = Readonly<{
  ebayItemId: string
  currentLive: true
  actionType: "TITLE_ENRICHMENT"
  currentValue: string
  proposedValue: string
  sourceAuthority: "COMMERCIAL_EXCEPTION_QUEUE"
  sourceSignalId: string
  observedAt: string
  sourceEvidence: string
  productTruthSupported: true
  productTruthSupport: string
  ownerApprovalRequired: true
  ownerApprovalStatus: "PENDING_OWNER_APPROVAL" | "AUTHORIZED" |
    "APPLYING" | "VERIFYING" | "CONFIRMED" | "UNAVAILABLE"
  authorizationId: string | null
  applyAvailable: boolean
  reversible: true
  economicsChanged: false
  idempotency: true
  doubleTapSafe: true
  officialReadbackRequired: true
  ambiguousOutcomeAutoRetry: false
}>

type CanaryContext = Readonly<{
  candidate: RemoteOperatorSafeMutationCanaryV1
  listingPackageId: string
  opportunityId: string
  manualListingLinkId: string
  activeListingId: string
  ebaySku: string
  authorityActorUserId: string
  productTruthReference: string
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function validObservedAt(value: unknown) {
  const normalized = text(value, 80)
  return Number.isFinite(Date.parse(normalized))
    ? new Date(normalized).toISOString() : ""
}

function safeDatabaseCode(error: unknown, fallback: string) {
  return text(record(error).message, 1_000)
    .match(/[A-Z][A-Z0-9_]{2,160}/)?.[0] ?? fallback
}

function authorizationStatus(row: JsonRecord | null) {
  const phase = text(row?.phase, 60)
  if (!row) return "PENDING_OWNER_APPROVAL" as const
  if (phase === "preview_ready") return "AUTHORIZED" as const
  if (phase === "write_in_flight") return "APPLYING" as const
  if (phase === "write_acknowledged" || phase === "outcome_unknown") {
    return "VERIFYING" as const
  }
  if (phase === "applied_verified") return "CONFIRMED" as const
  return "UNAVAILABLE" as const
}

function confirmedColorEvidence(packageRow: JsonRecord) {
  const packageData = record(packageRow.package_data)
  const aspects = record(packageData.aspects)
  const color = text(aspects.Color, 80)
  const evidenceSnapshot = record(packageData.evidenceSnapshot)
  const assessment = record(evidenceSnapshot.assessment)
  const productTruth = record(assessment.productTruth)
  const confirmations = rows(productTruth.humanConfirmedAspectEvidenceV1)
  const evidence = confirmations.find((entry) =>
    text(entry.aspectName, 80).toLowerCase() === "color" &&
    text(entry.normalizedValue, 80).toLowerCase() === color.toLowerCase() &&
    text(entry.provenance, 100) ===
      "OPERATOR_CONFIRMED_EXACT_SUPPLIER_EVIDENCE" &&
    text(entry.authorityClass, 100) ===
      "SELLER_OS_HUMAN_CONFIRMED_PRODUCT_TRUTH_EVIDENCE_V1" &&
    uuid(entry.confirmedBy) === uuid(packageRow.created_by) &&
    uuid(entry.listingPackageId) === uuid(packageRow.id))
  const digest = text(evidence?.evidenceDigest, 80)
  const truthDigest = text(productTruth.evidenceDigest, 80)
  return color && evidence && /^sha256:[0-9a-f]{64}$/.test(digest) &&
    /^sha256:[0-9a-f]{64}$/.test(truthDigest)
    ? { color, evidence, productTruth, truthDigest } : null
}

function listingIsExactAndFresh(listing: CommercialListingReadModel) {
  return listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
    listing.discovery.livePresence.source ===
      "EBAY_TRADING_GET_MY_EBAY_SELLING" &&
    listing.identity.marketplaceCertification.status === "US_CERTIFIED" &&
    /^\d{9,20}$/.test(listing.identity.itemId) &&
    Boolean(listing.identity.title) && Boolean(listing.identity.sku) &&
    isProvenSupplierLinkageV1(listing.stock) &&
    listing.stock.state === "IN_STOCK_SIGNAL" &&
    listing.stock.freshness.status === "FRESH"
}

export function selectRemoteOperatorSafeMutationCanaryV1(input: {
  listings: readonly CommercialListingReadModel[]
  commercialExceptions: readonly CanonicalCommercialException[]
  manualListingLinks: readonly unknown[]
  listingPackages: readonly unknown[]
  activeListings: readonly unknown[]
  publications: readonly unknown[]
  authorizations?: readonly unknown[]
  operatorUserId: string | null
  executionEnabled: boolean
}): CanaryContext | null {
  const links = rows(input.manualListingLinks)
  const packages = rows(input.listingPackages)
  const activeListings = rows(input.activeListings)
  const publications = rows(input.publications)
  const authorizations = rows(input.authorizations)
  const operatorUserId = uuid(input.operatorUserId)
  for (const signal of input.commercialExceptions) {
    if (signal.entityType !== "EBAY_LIVE_LISTING" ||
      signal.material === false ||
      signal.classification !== "ACTIONABLE_COMMERCIAL" ||
      signal.recommendedAction !== "IMPROVE_CTR" ||
      signal.actionBlockedByEvidence === true ||
      signal.experimentProtectionExists === true ||
      !/^\d{9,20}$/.test(signal.entityKey)) continue
    const listing = input.listings.find((row) =>
      row.identity.itemId === signal.entityKey)
    if (!listing || !listingIsExactAndFresh(listing)) continue
    const currentTitle = text(listing.identity.title, 80)
    const currentSku = text(listing.identity.sku, 50)
    const link = links.find((row) =>
      text(row.ebay_item_id, 20) === signal.entityKey &&
      text(row.verification_status, 40) === "verified" &&
      text(row.verification_method, 80) ===
        "EBAY_TRADING_GET_ITEM_READONLY" &&
      text(row.connector_listing_status, 40) === "active" &&
      text(row.connector_ebay_sku, 50) === currentSku &&
      uuid(row.id) && uuid(row.opportunity_id) &&
      uuid(row.connector_listing_id) && uuid(row.created_by) &&
      text(row.candidate_key, 240))
    if (!link) continue
    const packageRow = packages.find((row) =>
      uuid(row.opportunity_id) === uuid(link.opportunity_id) &&
      text(row.candidate_key, 240) === text(link.candidate_key, 240) &&
      uuid(row.created_by) === uuid(link.created_by) &&
      text(row.status, 40) === "approved" && uuid(row.id))
    if (!packageRow || text(record(packageRow.package_data).title, 80) !==
        currentTitle) continue
    const active = activeListings.find((row) =>
      uuid(row.id) === uuid(link.connector_listing_id) &&
      text(row.ebay_item_id, 20) === signal.entityKey &&
      text(row.ebay_sku, 50) === currentSku &&
      text(row.listing_status, 40) === "active")
    const publication = publications.find((row) =>
      uuid(row.listing_package_id) === uuid(packageRow.id) &&
      text(row.listing_id, 20) === signal.entityKey &&
      text(row.phase, 60) === "monitor_registered" &&
      validObservedAt(row.monitor_registered_at))
    if (!active || !publication) continue
    const confirmed = confirmedColorEvidence(packageRow)
    if (!confirmed ||
      confirmed.productTruth.exactIdentityVerified !== true ||
      text(confirmed.productTruth.authorityClass, 100) !==
        "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1" ||
      text(confirmed.productTruth.lunaProductId, 80) !==
        text(listing.stock.supplierProductId, 80) ||
      text(confirmed.productTruth.lunaVariantId, 80) !==
        text(listing.stock.supplierVariantId, 80) ||
      text(confirmed.productTruth.supplierSku, 80) !==
        text(listing.stock.supplierSku, 80)) continue
    const proposedTitle = buildVerifiedEbayTitle({
      productTitle: currentTitle,
      color: confirmed.color,
    })
    if (!proposedTitle || proposedTitle === currentTitle ||
      proposedTitle !== `${currentTitle} ${confirmed.color}` ||
      proposedTitle.length > 80) continue
    const observedAt = validObservedAt(signal.lastObservationTime)
    const sourceSignalId = text(signal.dedupeIdentity, 160)
    if (!observedAt || !/^[A-Za-z0-9._:-]{3,160}$/.test(sourceSignalId)) {
      continue
    }
    const authorization = authorizations.find((row) =>
      text(row.execution_authority, 80) ===
        REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORITY &&
      text(row.ebay_item_id, 20) === signal.entityKey &&
      text(row.source_authority, 80) === "COMMERCIAL_EXCEPTION_QUEUE" &&
      text(row.source_signal_id, 160) === sourceSignalId &&
      text(row.authorized_current_title, 80) === currentTitle &&
      text(row.target_title, 80) === proposedTitle &&
      text(row.product_truth_reference, 80) === confirmed.truthDigest &&
      (!operatorUserId || uuid(row.actor_user_id) === operatorUserId)) ?? null
    const status = authorizationStatus(authorization)
    return Object.freeze({
      candidate: Object.freeze({
        ebayItemId: signal.entityKey,
        currentLive: true as const,
        actionType: "TITLE_ENRICHMENT" as const,
        currentValue: currentTitle,
        proposedValue: proposedTitle,
        sourceAuthority: "COMMERCIAL_EXCEPTION_QUEUE" as const,
        sourceSignalId,
        observedAt,
        sourceEvidence:
          "Seller OS observó que muchas personas ven este producto, pero pocas entran.",
        productTruthSupported: true as const,
        productTruthSupport:
          `Producto exacto ✓ · Color ${confirmed.color} confirmado`,
        ownerApprovalRequired: true as const,
        ownerApprovalStatus: status,
        authorizationId: authorization ? uuid(authorization.id) || null : null,
        applyAvailable: status === "AUTHORIZED" &&
          Boolean(operatorUserId) && input.executionEnabled,
        reversible: true as const,
        economicsChanged: false as const,
        idempotency: true as const,
        doubleTapSafe: true as const,
        officialReadbackRequired: true as const,
        ambiguousOutcomeAutoRetry: false as const,
      }),
      listingPackageId: uuid(packageRow.id),
      opportunityId: uuid(packageRow.opportunity_id),
      manualListingLinkId: uuid(link.id),
      activeListingId: uuid(active.id),
      ebaySku: currentSku,
      authorityActorUserId: uuid(packageRow.created_by),
      productTruthReference: confirmed.truthDigest,
    })
  }
  return null
}

async function loadContext(input: {
  supabase: SupabaseClient
  accountKey: string
  listings: readonly CommercialListingReadModel[]
  commercialExceptions: readonly CanonicalCommercialException[]
  operatorUserId: string | null
  executionEnabled: boolean
}) {
  const itemIds = [...new Set(input.commercialExceptions.filter((row) =>
    row.entityType === "EBAY_LIVE_LISTING" && row.material !== false &&
    /^\d{9,20}$/.test(row.entityKey)).map((row) => row.entityKey))]
  if (!itemIds.length) return null
  const linksRead = await input.supabase.from("ebay_manual_listing_links")
    .select("id,opportunity_id,candidate_key,created_by,ebay_item_id,connector_listing_id,connector_ebay_sku,verification_status,verification_method,connector_listing_status")
    .eq("account_key", input.accountKey).in("ebay_item_id", itemIds)
    .eq("verification_status", "verified")
    .eq("verification_method", "EBAY_TRADING_GET_ITEM_READONLY")
    .eq("connector_listing_status", "active")
  if (linksRead.error) {
    throw new Error("REMOTE_OPERATOR_CANARY_LINKAGE_READ_FAILED")
  }
  const links = rows(linksRead.data)
  const opportunityIds = [...new Set(links.map((row) =>
    uuid(row.opportunity_id)).filter(Boolean))]
  if (!opportunityIds.length) return null
  const [packagesRead, activeRead, publicationsRead, authorizationsRead] =
    await Promise.all([
      input.supabase.from("ebay_listing_packages")
        .select("id,opportunity_id,candidate_key,status,created_by,account_key,package_data")
        .eq("account_key", input.accountKey).eq("status", "approved")
        .in("opportunity_id", opportunityIds),
      input.supabase.from("ebay_active_listings")
        .select("id,account_key,ebay_item_id,ebay_sku,listing_status")
        .eq("account_key", input.accountKey).eq("listing_status", "active")
        .in("ebay_item_id", itemIds),
      input.supabase.from("ebay_authorized_listing_publications")
        .select("id,listing_package_id,listing_id,phase,monitor_registered_at")
        .eq("marketplace_account_key", input.accountKey)
        .eq("phase", "monitor_registered").in("listing_id", itemIds),
      input.supabase.from("ebay_active_listing_title_revision_executions")
        .select("id,actor_user_id,execution_authority,ebay_item_id,source_authority,source_signal_id,authorized_current_title,target_title,product_truth_reference,phase")
        .eq("marketplace_account_key", input.accountKey)
        .eq("execution_authority", REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORITY)
        .in("ebay_item_id", itemIds).order("created_at", { ascending: false }),
    ])
  if (packagesRead.error || activeRead.error || publicationsRead.error ||
      authorizationsRead.error) {
    throw new Error("REMOTE_OPERATOR_CANARY_LINEAGE_READ_FAILED")
  }
  return selectRemoteOperatorSafeMutationCanaryV1({
    listings: input.listings,
    commercialExceptions: input.commercialExceptions,
    manualListingLinks: links,
    listingPackages: packagesRead.data ?? [],
    activeListings: activeRead.data ?? [],
    publications: publicationsRead.data ?? [],
    authorizations: authorizationsRead.data ?? [],
    operatorUserId: input.operatorUserId,
    executionEnabled: input.executionEnabled,
  })
}

export async function readRemoteOperatorSafeMutationCanaryV1(input: {
  supabase: SupabaseClient
  accountKey: string
  listings: readonly CommercialListingReadModel[]
  commercialExceptions: readonly CanonicalCommercialException[]
  operatorUserId: string | null
  executionEnabled: boolean
}) {
  return (await loadContext(input))?.candidate ?? null
}

export async function resolveRemoteOperatorUserIdV1(
  supabase: SupabaseClient,
) {
  const matches: string[] = []
  for (let page = 1; page <= 10; page += 1) {
    const read = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (read.error) throw new Error("REMOTE_OPERATOR_ACCOUNT_READ_FAILED")
    for (const user of read.data.users) {
      if (!user.banned_until && sellerOsAccessRoleFromUser(user) ===
          SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator) {
        matches.push(user.id)
      }
    }
    if (read.data.users.length < 100) break
  }
  const unique = [...new Set(matches)]
  if (unique.length > 1) throw new Error("REMOTE_OPERATOR_SINGLETON_VIOLATED")
  return unique[0] ?? null
}

export async function authorizeRemoteOperatorSafeMutationCanaryV1(input: {
  supabase: SupabaseClient
  accountKey: string
  listings: readonly CommercialListingReadModel[]
  commercialExceptions: readonly CanonicalCommercialException[]
  ownerUserId: string
  operatorUserId: string
  expectedItemId: string
  expectedSourceSignalId: string
  executionEnabled: boolean
}) {
  const ownerUserId = uuid(input.ownerUserId)
  const operatorUserId = uuid(input.operatorUserId)
  if (!ownerUserId || !operatorUserId || ownerUserId === operatorUserId) {
    throw new Error("REMOTE_OPERATOR_CANARY_OWNER_AUTHORITY_REQUIRED")
  }
  const context = await loadContext({ ...input, operatorUserId })
  if (!context || context.candidate.ebayItemId !== input.expectedItemId ||
      context.candidate.sourceSignalId !== input.expectedSourceSignalId) {
    throw new Error("REMOTE_OPERATOR_CANARY_CURRENT_CANDIDATE_REQUIRED")
  }
  if (context.candidate.authorizationId) return context.candidate
  const targetTitleHash = sha256(context.candidate.proposedValue)
  const idempotencyKeyHash = sha256([
    REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORITY,
    input.accountKey,
    context.candidate.ebayItemId,
    context.candidate.sourceSignalId,
    targetTitleHash,
    operatorUserId,
  ].join("|"))
  const requestHash = sha256([
    REMOTE_OPERATOR_SAFE_TITLE_CANARY_STRATEGY,
    context.listingPackageId,
    context.opportunityId,
    context.manualListingLinkId,
    context.activeListingId,
    input.accountKey,
    context.candidate.ebayItemId,
    context.ebaySku,
    sha256(context.candidate.currentValue),
    targetTitleHash,
    context.candidate.sourceSignalId,
    context.candidate.observedAt,
    context.productTruthReference,
    ownerUserId,
    operatorUserId,
  ].join("|"))
  const existing = await input.supabase
    .from("ebay_active_listing_title_revision_executions")
    .select("*").eq("idempotency_key_hash", idempotencyKeyHash).maybeSingle()
  if (existing.error) {
    throw new Error("REMOTE_OPERATOR_CANARY_AUTHORIZATION_READ_FAILED")
  }
  if (existing.data) {
    const row = record(existing.data)
    if (text(row.request_hash, 64) !== requestHash ||
      uuid(row.owner_approved_by) !== ownerUserId ||
      uuid(row.actor_user_id) !== operatorUserId) {
      throw new Error("REMOTE_OPERATOR_CANARY_AUTHORIZATION_CONFLICT")
    }
    return (await loadContext({ ...input, operatorUserId }))!.candidate
  }
  const approvedAt = new Date().toISOString()
  const insert = await input.supabase
    .from("ebay_active_listing_title_revision_executions").insert({
      listing_package_id: context.listingPackageId,
      candidate_id: null,
      opportunity_id: context.opportunityId,
      manual_listing_link_id: context.manualListingLinkId,
      active_listing_id: context.activeListingId,
      actor_user_id: operatorUserId,
      marketplace_account_key: input.accountKey,
      account_fingerprint: input.accountKey.slice(-64),
      ebay_item_id: context.candidate.ebayItemId,
      ebay_sku: context.ebaySku,
      target_title: context.candidate.proposedValue,
      target_title_hash: targetTitleHash,
      title_strategy_version: REMOTE_OPERATOR_SAFE_TITLE_CANARY_STRATEGY,
      request_hash: requestHash,
      idempotency_key_hash: idempotencyKeyHash,
      execution_authority: REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORITY,
      source_authority: context.candidate.sourceAuthority,
      source_signal_id: context.candidate.sourceSignalId,
      source_observed_at: context.candidate.observedAt,
      authorized_current_title: context.candidate.currentValue,
      authorized_current_title_hash: sha256(context.candidate.currentValue),
      product_truth_reference: context.productTruthReference,
      owner_approved_by: ownerUserId,
      owner_approved_at: approvedAt,
    }).select("id").single()
  if (insert.error || !insert.data) {
    throw new Error(safeDatabaseCode(insert.error,
      "REMOTE_OPERATOR_CANARY_AUTHORIZATION_FAILED"))
  }
  return (await loadContext({ ...input, operatorUserId }))!.candidate
}

async function bindOperatorIdempotencyKey(input: {
  supabase: SupabaseClient
  authorizationId: string
  operatorUserId: string
  idempotencyKey: string
}) {
  const hash = sha256(input.idempotencyKey)
  const current = await input.supabase
    .from("ebay_active_listing_title_revision_executions")
    .select("id,operator_idempotency_key_hash")
    .eq("id", input.authorizationId).eq("actor_user_id", input.operatorUserId)
    .eq("execution_authority", REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORITY)
    .single()
  if (current.error || !current.data) {
    throw new Error("REMOTE_OPERATOR_CANARY_AUTHORIZATION_INVALID")
  }
  const existing = text(current.data.operator_idempotency_key_hash, 64)
  if (existing && existing !== hash) {
    throw new Error("REMOTE_OPERATOR_CANARY_IDEMPOTENCY_MISMATCH")
  }
  if (existing === hash) return
  const bound = await input.supabase
    .from("ebay_active_listing_title_revision_executions")
    .update({ operator_idempotency_key_hash: hash,
      updated_at: new Date().toISOString() })
    .eq("id", input.authorizationId).eq("actor_user_id", input.operatorUserId)
    .is("operator_idempotency_key_hash", null).select("id").maybeSingle()
  if (bound.error) throw new Error("REMOTE_OPERATOR_CANARY_IDEMPOTENCY_BIND_FAILED")
  if (!bound.data) {
    const raced = await input.supabase
      .from("ebay_active_listing_title_revision_executions")
      .select("operator_idempotency_key_hash").eq("id", input.authorizationId)
      .eq("actor_user_id", input.operatorUserId).single()
    if (raced.error || text(raced.data?.operator_idempotency_key_hash, 64) !==
        hash) throw new Error("REMOTE_OPERATOR_CANARY_IDEMPOTENCY_MISMATCH")
  }
}

export async function applyRemoteOperatorSafeMutationCanaryV1(input: {
  supabase: SupabaseClient
  accountKey: string
  listings: readonly CommercialListingReadModel[]
  commercialExceptions: readonly CanonicalCommercialException[]
  operatorUserId: string
  authorizationId: string
  idempotencyKey: string
  executionEnabled: boolean
  fetchImpl?: typeof fetch
}) {
  const operatorUserId = uuid(input.operatorUserId)
  const authorizationId = uuid(input.authorizationId)
  const idempotencyKey = text(input.idempotencyKey, 120)
  if (!input.executionEnabled) {
    throw new Error("REMOTE_OPERATOR_CANARY_PHYSICAL_ENABLEMENT_REQUIRED")
  }
  if (!operatorUserId || !authorizationId ||
    !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    throw new Error("REMOTE_OPERATOR_CANARY_APPLY_INVALID")
  }
  const context = await loadContext({ ...input, operatorUserId })
  if (!context || context.candidate.authorizationId !== authorizationId ||
      context.candidate.ownerApprovalStatus !== "AUTHORIZED") {
    throw new Error("REMOTE_OPERATOR_CANARY_OWNER_APPROVAL_REQUIRED")
  }
  await bindOperatorIdempotencyKey({ supabase: input.supabase,
    authorizationId, operatorUserId, idempotencyKey })
  return applyPreparedVerifiedActiveListingTitle({
    supabase: input.supabase,
    accountKey: input.accountKey,
    actorId: operatorUserId,
    executionId: authorizationId,
    ebayItemId: context.candidate.ebayItemId,
    confirmation: ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION,
    expectedCurrentTitle: context.candidate.currentValue,
    fetchImpl: input.fetchImpl,
  })
}
