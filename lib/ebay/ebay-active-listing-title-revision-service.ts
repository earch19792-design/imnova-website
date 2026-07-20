import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  getEbayTradingReadOnlyAccessToken,
  tradingXmlContainer,
  tradingXmlTagValue,
} from "./ebay-manual-listing-trading-readonly"
import { parseAuthoritativeFactsInputPackage } from "./ebay-product-facts-readiness"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"
import {
  buildVerifiedEbayTitle,
  EBAY_VERIFIED_TITLE_STRATEGY_VERSION,
} from "./ebay-verified-title-strategy"

export const ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION =
  "APLICAR TITULO VERIFICADO AL LISTING ACTIVO"

const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const COMPATIBILITY_LEVEL = "1423"
const SITE_ID_US = "0"
const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 25_000
const SNAPSHOT_VERSION = "EBAY_ACTIVE_LISTING_TITLE_SNAPSHOT_V1"

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
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

function databaseErrorCode(error: unknown, fallback: string) {
  return text(record(error).message, 1_000).match(/[A-Z][A-Z0-9_]{2,160}/)?.[0] ?? fallback
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;").replace(/'/g, "&apos;")
}

function responseAccepted(xml: string) {
  return ["success", "warning"].includes(
    text(tradingXmlTagValue(xml, "Ack"), 20).toLowerCase(),
  )
}

function getUserRequestXml() {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<OutputSelector>User.UserID</OutputSelector></GetUserRequest>"
}

function getItemRequestXml(itemId: string) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${itemId}</ItemID>` + [
      "Item.ItemID", "Item.Title", "Item.Seller.UserID",
      "Item.SellingStatus.ListingStatus", "Item.SKU", "Item.ListingType",
    ].map((selector) => `<OutputSelector>${selector}</OutputSelector>`).join("") +
    "</GetItemRequest>"
}

export function reviseVerifiedTitleRequestXml(itemId: string, targetTitle: string) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<ReviseFixedPriceItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<Item><ItemID>${itemId}</ItemID><Title>${xmlEscape(targetTitle)}</Title></Item>` +
    "</ReviseFixedPriceItemRequest>"
}

async function tradingCall(input: {
  callName: "GetUser" | "GetItem" | "ReviseFixedPriceItem"
  accessToken: string
  body: string
  fetchImpl: FetchLike
  timeoutMs: number
}) {
  const endpoint = new URL(TRADING_ENDPOINT)
  if (endpoint.origin !== "https://api.ebay.com" || endpoint.pathname !== "/ws/api.dll") {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_ENDPOINT_BLOCKED")
  }
  const response = await input.fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": input.callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": SITE_ID_US,
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
    },
    body: input.body,
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
  })
  return { response, xml: await response.text() }
}

type OfficialSnapshot = {
  itemId: string
  listingStatus: string
  ebaySku: string
  listingType: string
  title: string
  observedAt: string
}

async function readOfficialSnapshot(input: {
  accessToken: string
  itemId: string
  expectedSku: string
  accountKey: string
  fetchImpl: FetchLike
}) {
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (!identity.bound || !identity.consistent || !identity.expectedUserId ||
    !identity.expectedAccountFingerprint) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_ACCOUNT_NOT_BOUND")
  }
  const [userResult, itemResult] = await Promise.all([
    tradingCall({ callName: "GetUser", accessToken: input.accessToken,
      body: getUserRequestXml(), fetchImpl: input.fetchImpl, timeoutMs: READ_TIMEOUT_MS }),
    tradingCall({ callName: "GetItem", accessToken: input.accessToken,
      body: getItemRequestXml(input.itemId), fetchImpl: input.fetchImpl, timeoutMs: READ_TIMEOUT_MS }),
  ])
  if (!userResult.response.ok || !responseAccepted(userResult.xml) ||
    !itemResult.response.ok || !responseAccepted(itemResult.xml)) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_OFFICIAL_READ_FAILED")
  }
  const authenticatedUserId = text(
    tradingXmlTagValue(tradingXmlContainer(userResult.xml, "User"), "UserID"), 100,
  )
  const item = tradingXmlContainer(itemResult.xml, "Item")
  const sellerUserId = text(
    tradingXmlTagValue(tradingXmlContainer(item, "Seller"), "UserID"), 100,
  )
  const snapshot = {
    itemId: text(tradingXmlTagValue(item, "ItemID"), 20),
    listingStatus: text(tradingXmlTagValue(
      tradingXmlContainer(item, "SellingStatus"), "ListingStatus",
    ), 40),
    ebaySku: text(tradingXmlTagValue(item, "SKU"), 50),
    listingType: text(tradingXmlTagValue(item, "ListingType"), 40),
    title: text(tradingXmlTagValue(item, "Title"), 80),
    observedAt: new Date().toISOString(),
  } satisfies OfficialSnapshot
  const expectedFingerprint = identity.expectedAccountFingerprint.toLowerCase()
  if (!authenticatedUserId || !sellerUserId ||
    authenticatedUserId.toLowerCase() !== identity.expectedUserId.toLowerCase() ||
    sellerUserId.toLowerCase() !== authenticatedUserId.toLowerCase() ||
    ebayProductionAccountFingerprint(authenticatedUserId) !== expectedFingerprint ||
    !input.accountKey.endsWith(`:${expectedFingerprint}`) ||
    snapshot.itemId !== input.itemId || snapshot.ebaySku !== input.expectedSku ||
    snapshot.listingStatus.toLowerCase() !== "active" ||
    !["fixedpriceitem", "storesfixedprice"].includes(snapshot.listingType.toLowerCase())) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_IDENTITY_MISMATCH")
  }
  return snapshot
}

function snapshotRecord(snapshot: OfficialSnapshot, targetTitle: string, fingerprint: string) {
  return {
    version: SNAPSHOT_VERSION,
    itemId: snapshot.itemId,
    listingStatus: snapshot.listingStatus,
    ebaySku: snapshot.ebaySku,
    listingType: snapshot.listingType,
    accountFingerprint: fingerprint,
    ownershipVerified: true,
    observedTitle: snapshot.title,
    observedTitleHash: sha256(snapshot.title),
    targetTitleHash: sha256(targetTitle),
    titleMatchesTarget: snapshot.title === targetTitle,
    observedAt: snapshot.observedAt,
  }
}

function aspect(packageData: JsonRecord, name: string) {
  const specifics = record(packageData.itemSpecifics)
  const entry = Object.entries(specifics).find(([key]) =>
    key.toLowerCase() === name.toLowerCase())?.[1]
  return text(Array.isArray(entry) ? entry[0] : entry, 120)
}

function deriveTargetTitle(candidate: JsonRecord) {
  const summary = record(candidate.product_facts_summary)
  const authoritative = parseAuthoritativeFactsInputPackage(summary.authoritativeFactsPackage)
  if (!authoritative) throw new Error("EBAY_ACTIVE_TITLE_REVISION_FACTS_REQUIRED")
  const trusted = new Set(["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"])
  const fact = (scope: string, ...keys: string[]) => authoritative.facts.find((entry) =>
    entry.scope === scope && keys.includes(entry.key) && trusted.has(entry.verificationStatus))
  const handoff = record(record(candidate.manual_handoff_package).package)
  const total = Number(fact("OFFER_PACK", "totalUnitCount")?.value)
  const title = buildVerifiedEbayTitle({
    productTitle: text(fact("PRODUCT_UNIT", "exactProductName")?.value, 300)
      || text(candidate.product_title, 300),
    brand: text(fact("PRODUCT_UNIT", "brand")?.value, 120) || aspect(handoff, "Brand"),
    productType: text(fact("PRODUCT_UNIT", "type", "productType")?.value, 120)
      || aspect(handoff, "Type"),
    packCount: Number.isInteger(total) ? total : null,
    color: text(fact("PRODUCT_UNIT", "color")?.value, 120) || aspect(handoff, "Color"),
    audience: text(fact("PRODUCT_UNIT", "audience", "department")?.value, 120),
    relationship: text(fact("PRODUCT_UNIT", "relationship")?.value, 120),
  })
  if (!title || title.length > 80) throw new Error("EBAY_ACTIVE_TITLE_REVISION_TARGET_INVALID")
  return title
}

async function executionByIdempotency(
  supabase: SupabaseClient,
  idempotencyKeyHash: string,
) {
  const { data, error } = await supabase
    .from("ebay_active_listing_title_revision_executions")
    .select("*").eq("idempotency_key_hash", idempotencyKeyHash).maybeSingle()
  if (error) throw new Error("EBAY_ACTIVE_TITLE_REVISION_LEDGER_READ_FAILED")
  return data ? record(data) : null
}

function publicResult(row: JsonRecord, messageCode: string) {
  return {
    executionId: uuid(row.id),
    phase: text(row.phase, 60),
    ebayItemId: text(row.ebay_item_id, 20),
    targetTitle: text(row.target_title, 80),
    titleStrategyVersion: text(row.title_strategy_version, 100),
    ebayWriteAttemptCount: Number(row.ebay_write_attempt_count) || 0,
    ebayWriteDispatched: row.ebay_write_dispatched === true,
    titleVerified: row.phase === "applied_verified",
    reconciled: row.reconciled === true,
    messageCode,
  }
}

export async function prepareVerifiedActiveListingTitle(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  listingPackageId: string
  ebayItemId: string
  idempotencyKey: string
}) {
  const actorId = uuid(input.actorId)
  const listingPackageId = uuid(input.listingPackageId)
  const ebayItemId = text(input.ebayItemId, 20)
  const idempotencyKey = text(input.idempotencyKey, 120)
  if (!actorId || !listingPackageId || !/^\d{9,20}$/.test(ebayItemId) ||
    !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_PREPARE_INVALID")
  }
  const idempotencyKeyHash = sha256(idempotencyKey)
  const packageRead = await input.supabase.from("ebay_listing_packages")
    .select("id,opportunity_id,candidate_key,status,created_by,account_key")
    .eq("id", listingPackageId).eq("account_key", input.accountKey)
    .eq("created_by", actorId).maybeSingle()
  if (packageRead.error || !packageRead.data) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_BOUND_PACKAGE_REQUIRED")
  }
  const listingPackage = record(packageRead.data)
  const candidateRead = await input.supabase.from("ebay_same_day_pilot_candidates")
    .select("id,run_id,opportunity_id,candidate_key,state,machine_state,product_title,product_facts_summary,manual_handoff_package,run:ebay_same_day_pilot_runs!inner(marketplace_account_key,created_by)")
    .eq("opportunity_id", listingPackage.opportunity_id)
    .eq("candidate_key", listingPackage.candidate_key)
    .eq("run.marketplace_account_key", input.accountKey)
    .eq("run.created_by", actorId).maybeSingle()
  if (candidateRead.error || !candidateRead.data) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_CANDIDATE_REQUIRED")
  }
  const candidate = record(candidateRead.data)
  const handoff = record(candidate.manual_handoff_package)
  const handoffPackage = record(handoff.package)
  const packageStatus = text(listingPackage.status, 40)
  const verifiedActiveDraft = packageStatus === "draft"
    && text(candidate.state, 40) === "VERIFIED_ACTIVE"
    && text(candidate.machine_state, 40) === "VERIFIED_ACTIVE"
    && text(handoffPackage.candidateId, 40) === text(candidate.id, 40)
    && /^[0-9a-f]{64}$/.test(text(handoff.packageHash, 64))
  if (packageStatus !== "approved" && !verifiedActiveDraft) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_BOUND_PACKAGE_REQUIRED")
  }
  const linkRead = await input.supabase.from("ebay_manual_listing_links")
    .select("id,opportunity_id,candidate_key,created_by,verification_status,verification_method,connector_listing_status,connector_listing_id,connector_ebay_sku")
    .eq("account_key", input.accountKey).eq("ebay_item_id", ebayItemId)
    .eq("opportunity_id", listingPackage.opportunity_id)
    .eq("candidate_key", listingPackage.candidate_key)
    .eq("created_by", actorId).eq("verification_status", "verified")
    .eq("verification_method", "EBAY_TRADING_GET_ITEM_READONLY")
    .eq("connector_listing_status", "active").maybeSingle()
  if (linkRead.error || !linkRead.data) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_VERIFIED_LINK_REQUIRED")
  }
  const link = record(linkRead.data)
  const activeRead = await input.supabase.from("ebay_active_listings")
    .select("id,account_key,ebay_item_id,ebay_sku,listing_status")
    .eq("id", link.connector_listing_id).eq("account_key", input.accountKey)
    .eq("ebay_item_id", ebayItemId).eq("listing_status", "active").maybeSingle()
  if (activeRead.error || !activeRead.data) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_ACTIVE_LISTING_REQUIRED")
  }
  const active = record(activeRead.data)
  const ebaySku = text(active.ebay_sku, 50)
  if (!ebaySku || ebaySku !== text(link.connector_ebay_sku, 50)) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_SKU_MISMATCH")
  }
  const targetTitle = deriveTargetTitle(candidate)
  const targetTitleHash = sha256(targetTitle)
  const requestHash = sha256([
    EBAY_VERIFIED_TITLE_STRATEGY_VERSION, listingPackageId, text(candidate.id),
    text(link.id), text(active.id), input.accountKey, ebayItemId, ebaySku,
    targetTitleHash,
  ].join("|"))
  const existing = await executionByIdempotency(input.supabase, idempotencyKeyHash)
  if (existing) {
    if (text(existing.request_hash, 64) !== requestHash ||
      text(existing.actor_user_id, 40) !== actorId) {
      throw new Error("EBAY_ACTIVE_TITLE_REVISION_IDEMPOTENCY_MISMATCH")
    }
    return publicResult(existing, "EBAY_ACTIVE_TITLE_REVISION_PREVIEW_READY")
  }
  const { data, error } = await input.supabase
    .from("ebay_active_listing_title_revision_executions")
    .insert({
      listing_package_id: listingPackageId,
      candidate_id: candidate.id,
      opportunity_id: listingPackage.opportunity_id,
      manual_listing_link_id: link.id,
      active_listing_id: active.id,
      actor_user_id: actorId,
      marketplace_account_key: input.accountKey,
      account_fingerprint: input.accountKey.slice(-64),
      ebay_item_id: ebayItemId,
      ebay_sku: ebaySku,
      target_title: targetTitle,
      target_title_hash: targetTitleHash,
      title_strategy_version: EBAY_VERIFIED_TITLE_STRATEGY_VERSION,
      request_hash: requestHash,
      idempotency_key_hash: idempotencyKeyHash,
    }).select("*").single()
  if (error || !data) {
    const raced = await executionByIdempotency(input.supabase, idempotencyKeyHash)
    if (raced && text(raced.request_hash, 64) === requestHash) {
      return publicResult(raced, "EBAY_ACTIVE_TITLE_REVISION_PREVIEW_READY")
    }
    throw new Error(databaseErrorCode(error, "EBAY_ACTIVE_TITLE_REVISION_PREPARE_FAILED"))
  }
  return publicResult(record(data), "EBAY_ACTIVE_TITLE_REVISION_PREVIEW_READY")
}

async function ledgerRow(supabase: SupabaseClient, executionId: string, actorId: string) {
  const { data, error } = await supabase.from("ebay_active_listing_title_revision_executions")
    .select("*").eq("id", executionId).eq("actor_user_id", actorId).single()
  if (error || !data) throw new Error("EBAY_ACTIVE_TITLE_REVISION_LEDGER_INVALID")
  return record(data)
}

async function completeVerified(input: {
  supabase: SupabaseClient
  row: JsonRecord
  actorId: string
  snapshot: JsonRecord
  reconciled: boolean
}) {
  const { data, error } = await input.supabase
    .from("ebay_active_listing_title_revision_executions")
    .update({ phase: "applied_verified", postflight_snapshot: input.snapshot,
      reconciled: input.reconciled, claim_token: null, lease_expires_at: null,
      last_error_code: null, applied_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString() })
    .eq("id", input.row.id).eq("actor_user_id", input.actorId)
    .in("phase", ["preview_ready", "write_in_flight", "write_acknowledged", "outcome_unknown"])
    .select("*").single()
  if (error || !data) throw new Error("EBAY_ACTIVE_TITLE_REVISION_COMPLETE_FAILED")
  return record(data)
}

async function markUnknown(input: {
  supabase: SupabaseClient
  row: JsonRecord
  actorId: string
  code: string
  snapshot?: JsonRecord | null
  httpStatus?: number | null
}) {
  const { data, error } = await input.supabase
    .from("ebay_active_listing_title_revision_executions")
    .update({ phase: "outcome_unknown", postflight_snapshot: input.snapshot ?? null,
      write_http_status: input.httpStatus ?? input.row.write_http_status ?? null,
      last_error_code: input.code, claim_token: null, lease_expires_at: null,
      updated_at: new Date().toISOString() })
    .eq("id", input.row.id).eq("actor_user_id", input.actorId)
    .in("phase", ["write_in_flight", "write_acknowledged", "outcome_unknown"])
    .select("*").single()
  if (error || !data) throw new Error("EBAY_ACTIVE_TITLE_REVISION_OUTCOME_RECORD_FAILED")
  return record(data)
}

export async function applyVerifiedTitleToActiveListing(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  listingPackageId: string
  ebayItemId: string
  idempotencyKey: string
  confirmation: string
  fetchImpl?: FetchLike
}) {
  if (input.confirmation !== ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION) {
    throw new Error("EBAY_ACTIVE_TITLE_REVISION_CONFIRMATION_INVALID")
  }
  const preview = await prepareVerifiedActiveListingTitle(input)
  const actorId = uuid(input.actorId)
  let row = await ledgerRow(input.supabase, preview.executionId, actorId)
  if (row.phase === "applied_verified" || row.phase === "terminal_failure") {
    return publicResult(row, row.phase === "applied_verified"
      ? "EBAY_ACTIVE_TITLE_REVISION_ALREADY_VERIFIED"
      : "EBAY_ACTIVE_TITLE_REVISION_TERMINAL_FAILURE")
  }
  const targetTitle = text(row.target_title, 80)
  const expectedSku = text(row.ebay_sku, 50)
  const fetchImpl = input.fetchImpl ?? fetch
  const accessToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
  const before = await readOfficialSnapshot({ accessToken, itemId: input.ebayItemId,
    expectedSku, accountKey: input.accountKey, fetchImpl })
  const beforeRecord = snapshotRecord(before, targetTitle, text(row.account_fingerprint, 64))
  if (before.title === targetTitle) {
    row = await completeVerified({ supabase: input.supabase, row, actorId,
      snapshot: beforeRecord, reconciled: row.phase !== "preview_ready" })
    return publicResult(row, "EBAY_ACTIVE_TITLE_REVISION_VERIFIED")
  }
  if (row.phase !== "preview_ready") {
    if (row.phase === "write_in_flight") {
      const lease = Date.parse(text(row.lease_expires_at, 60))
      if (Number.isFinite(lease) && lease > Date.now()) {
        return publicResult(row, "EBAY_ACTIVE_TITLE_REVISION_WRITE_IN_PROGRESS")
      }
    }
    row = await markUnknown({ supabase: input.supabase, row, actorId,
      code: "EBAY_ACTIVE_TITLE_REVISION_RECONCILIATION_PENDING", snapshot: beforeRecord })
    return publicResult(row, "EBAY_ACTIVE_TITLE_REVISION_OUTCOME_UNKNOWN")
  }
  const claimToken = randomUUID()
  const now = new Date()
  const { data: claimed, error: claimError } = await input.supabase
    .from("ebay_active_listing_title_revision_executions")
    .update({ phase: "write_in_flight", ebay_write_attempt_count: 1,
      ebay_write_dispatched: true, claim_token: claimToken,
      lease_expires_at: new Date(now.getTime() + 120_000).toISOString(),
      preflight_snapshot: beforeRecord, write_started_at: now.toISOString(),
      last_error_code: null, updated_at: now.toISOString() })
    .eq("id", row.id).eq("actor_user_id", actorId).eq("phase", "preview_ready")
    .eq("ebay_write_attempt_count", 0).select("*").maybeSingle()
  if (claimError) throw new Error("EBAY_ACTIVE_TITLE_REVISION_CLAIM_FAILED")
  if (!claimed) {
    row = await ledgerRow(input.supabase, preview.executionId, actorId)
    return publicResult(row, "EBAY_ACTIVE_TITLE_REVISION_NOT_CLAIMED")
  }
  row = record(claimed)
  let writeStatus: number | null = null
  try {
    const write = await tradingCall({ callName: "ReviseFixedPriceItem", accessToken,
      body: reviseVerifiedTitleRequestXml(input.ebayItemId, targetTitle),
      fetchImpl, timeoutMs: WRITE_TIMEOUT_MS })
    writeStatus = write.response.status
    const ack = text(tradingXmlTagValue(write.xml, "Ack"), 20)
    if (!write.response.ok || !responseAccepted(write.xml)) {
      const ebayCode = text(tradingXmlTagValue(write.xml, "ErrorCode"), 20)
      const code = /^\d{1,20}$/.test(ebayCode)
        ? `EBAY_ACTIVE_TITLE_REVISION_REJECTED_${ebayCode}`
        : "EBAY_ACTIVE_TITLE_REVISION_WRITE_RESPONSE_UNKNOWN"
      const unknown = write.response.status >= 500 || !ack
      if (!unknown) {
        const failure = await input.supabase
          .from("ebay_active_listing_title_revision_executions")
          .update({ phase: "terminal_failure", write_http_status: writeStatus,
            last_error_code: code, claim_token: null, lease_expires_at: null,
            updated_at: new Date().toISOString() })
          .eq("id", row.id).eq("actor_user_id", actorId)
          .eq("phase", "write_in_flight").eq("claim_token", claimToken)
          .select("*").single()
        if (failure.error || !failure.data) throw new Error("EBAY_ACTIVE_TITLE_REVISION_FAILURE_RECORD_FAILED")
        return publicResult(record(failure.data), "EBAY_ACTIVE_TITLE_REVISION_TERMINAL_FAILURE")
      }
      row = await markUnknown({ supabase: input.supabase, row, actorId, code,
        httpStatus: writeStatus })
    } else {
      const acknowledged = await input.supabase
        .from("ebay_active_listing_title_revision_executions")
        .update({ phase: "write_acknowledged", write_http_status: writeStatus,
          write_ack: ack, write_acknowledged_at: new Date().toISOString(),
          claim_token: null, lease_expires_at: null, last_error_code: null,
          updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("actor_user_id", actorId)
        .eq("phase", "write_in_flight").eq("claim_token", claimToken)
        .select("*").single()
      if (acknowledged.error || !acknowledged.data) throw new Error("EBAY_ACTIVE_TITLE_REVISION_ACK_RECORD_FAILED")
      row = record(acknowledged.data)
    }
  } catch (error) {
    if (text(row.phase) === "write_in_flight") {
      row = await markUnknown({ supabase: input.supabase, row, actorId,
        code: error instanceof Error && error.name === "TimeoutError"
          ? "EBAY_ACTIVE_TITLE_REVISION_WRITE_TIMEOUT"
          : "EBAY_ACTIVE_TITLE_REVISION_WRITE_TRANSPORT_UNKNOWN",
        httpStatus: writeStatus })
    }
  }
  try {
    const after = await readOfficialSnapshot({ accessToken, itemId: input.ebayItemId,
      expectedSku, accountKey: input.accountKey, fetchImpl })
    const afterRecord = snapshotRecord(after, targetTitle, text(row.account_fingerprint, 64))
    if (after.title === targetTitle) {
      row = await completeVerified({ supabase: input.supabase, row, actorId,
        snapshot: afterRecord, reconciled: row.phase === "outcome_unknown" })
      return publicResult(row, "EBAY_ACTIVE_TITLE_REVISION_VERIFIED")
    }
    row = await markUnknown({ supabase: input.supabase, row, actorId,
      code: "EBAY_ACTIVE_TITLE_REVISION_READBACK_MISMATCH", snapshot: afterRecord,
      httpStatus: writeStatus })
  } catch {
    row = await markUnknown({ supabase: input.supabase, row, actorId,
      code: "EBAY_ACTIVE_TITLE_REVISION_READBACK_UNAVAILABLE", httpStatus: writeStatus })
  }
  return publicResult(row, "EBAY_ACTIVE_TITLE_REVISION_OUTCOME_UNKNOWN")
}
