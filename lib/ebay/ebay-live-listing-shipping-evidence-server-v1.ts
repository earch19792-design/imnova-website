import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { acquireCanonicalLunaShippingV1 } from
  "./ebay-luna-authoritative-shipping-server-v1"
import {
  buildLiveListingShippingEvidenceV1,
  liveListingShippingReadbackMatchesV1,
  liveListingShippingReaderScopeIdV1,
  readLiveListingShippingFreshnessV1,
  type LiveListingShippingEvidenceIdentityV1,
  type LiveListingShippingEvidenceRowV1,
} from "./ebay-live-listing-shipping-evidence-v1"

type Acquire = typeof acquireCanonicalLunaShippingV1
type LiveListingShippingCaptureTargetV1 = Readonly<Omit<
  LiveListingShippingEvidenceIdentityV1, "linkageId">>

function text(value: unknown, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

async function resolveExactCurrentLiveIdentity(input: Readonly<{
  supabase: SupabaseClient
  target: LiveListingShippingCaptureTargetV1
}>) {
  const { supabase, target } = input
  const [activeRead, linkageRead, variantRead] = await Promise.all([
    supabase.from("ebay_active_listings")
      .select("id,ebay_item_id,listing_status,market_radar_product_id,supplier_variant_id,supplier_sku")
      .eq("account_key", target.accountKey)
      .eq("ebay_item_id", target.ebayItemId)
      .eq("listing_status", "active")
      .order("updated_at", { ascending: false }).limit(2),
    supabase.from("seller_os_luna_linkage_decisions")
      .select("decision_id,decision_version,decision,linkage_id,luna_product_id,luna_variant_id,luna_sku")
      .eq("account_key", target.accountKey)
      .eq("marketplace_id", target.marketplaceId)
      .eq("ebay_item_id", target.ebayItemId)
      .order("decision_version", { ascending: false }).limit(1),
    supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,product_url,captured_at")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", target.lunaProductId)
      .eq("supplier_variant_id", target.lunaVariantId)
      .eq("sku", target.sourceSku)
      .limit(2),
  ])
  if (activeRead.error) throw new Error("LIVE_LISTING_SHIPPING_ACTIVE_READ_FAILED")
  if (linkageRead.error) throw new Error("LIVE_LISTING_SHIPPING_LINKAGE_READ_FAILED")
  if (variantRead.error) throw new Error("LIVE_LISTING_SHIPPING_VARIANT_READ_FAILED")
  const active = activeRead.data ?? []
  const linkages = linkageRead.data ?? []
  const variants = variantRead.data ?? []
  if (active.length !== 1) {
    throw new Error("LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED")
  }
  const linkage = linkages[0]
  if (!linkage || linkage.decision !== "APPROVE_EXACT_LINKAGE" ||
      !/^luna-linkage-v1:sha256:[0-9a-f]{64}$/.test(
        String(linkage.linkage_id ?? "")) ||
      String(linkage.luna_product_id ?? "") !== target.lunaProductId ||
      String(linkage.luna_variant_id ?? "") !== target.lunaVariantId ||
      String(linkage.luna_sku ?? "") !== target.sourceSku) {
    throw new Error("LIVE_LISTING_SHIPPING_CERTIFIED_LINKAGE_REQUIRED")
  }
  const listing = active[0]
  if (variants.length !== 1 ||
      String(variants[0].supplier_product_id ?? "") !== target.lunaProductId ||
      String(variants[0].supplier_variant_id ?? "") !== target.lunaVariantId ||
      String(variants[0].sku ?? "") !== target.sourceSku ||
      !text(variants[0].product_url, 2_000)) {
    throw new Error("LIVE_LISTING_SHIPPING_EXACT_LUNA_VARIANT_REQUIRED")
  }
  if ((listing.market_radar_product_id !== null &&
        String(listing.market_radar_product_id) !==
          String(variants[0].product_id ?? "")) ||
      (listing.supplier_variant_id !== null &&
        String(listing.supplier_variant_id) !== target.lunaVariantId) ||
      (listing.supplier_sku !== null &&
        String(listing.supplier_sku) !== target.sourceSku)) {
    throw new Error("LIVE_LISTING_SHIPPING_ACTIVE_LINEAGE_MISMATCH")
  }
  return Object.freeze({
    identity: Object.freeze({ ...target,
      linkageId: String(linkage.linkage_id),
    }) satisfies LiveListingShippingEvidenceIdentityV1,
    canonicalProductUrl: text(variants[0].product_url, 2_000),
    linkageDecisionId: text(linkage.decision_id),
    activeListingRegistryId: text(listing.id),
  })
}

export async function readLatestLiveListingShippingEvidenceV1(input: Readonly<{
  supabase: SupabaseClient
  identity: LiveListingShippingEvidenceIdentityV1
  now?: number
}>) {
  const { data, error } = await input.supabase
    .from("seller_os_live_listing_shipping_evidence")
    .select("evidence_id,account_key,marketplace_id,ebay_item_id,linkage_id,luna_product_id,luna_variant_id,source_sku,destination_fingerprint,supplier_subtotal,supplier_currency,shipping_cost,shipping_currency,observed_at,maximum_age_seconds,source_authority,source_evidence_digest,purchase_performed,payment_performed,raw_address_persisted,credentials_persisted")
    .eq("account_key", input.identity.accountKey)
    .eq("marketplace_id", input.identity.marketplaceId)
    .eq("ebay_item_id", input.identity.ebayItemId)
    .eq("linkage_id", input.identity.linkageId)
    .eq("luna_product_id", input.identity.lunaProductId)
    .eq("luna_variant_id", input.identity.lunaVariantId)
    .eq("source_sku", input.identity.sourceSku)
    .order("observed_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("LIVE_LISTING_SHIPPING_EVIDENCE_READ_FAILED")
  if (!data) return Object.freeze({ status: "UNAVAILABLE" as const,
    evidence: null, freshness: "UNPROVEN" as const })
  const freshness = readLiveListingShippingFreshnessV1({
    row: data as Pick<LiveListingShippingEvidenceRowV1,
      "observed_at" | "maximum_age_seconds">,
    now: input.now,
  })
  return Object.freeze({ status: "AVAILABLE" as const,
    evidence: data as LiveListingShippingEvidenceRowV1,
    freshness: freshness.status, ageSeconds: freshness.ageSeconds })
}

export async function captureLiveListingShippingEvidenceV1(input: Readonly<{
  supabase: SupabaseClient
  target: LiveListingShippingCaptureTargetV1
  acquire?: Acquire
  now?: number
}>) {
  const resolved = await resolveExactCurrentLiveIdentity(input)
  const identity = resolved.identity
  const acquire = input.acquire ?? acquireCanonicalLunaShippingV1
  const acquisition = await acquire({
    readerScopeId: liveListingShippingReaderScopeIdV1(identity),
    canonicalProductUrl: resolved.canonicalProductUrl,
    lunaProductId: identity.lunaProductId,
    lunaVariantId: identity.lunaVariantId,
    supplierSku: identity.sourceSku,
    quantity: 1,
  }, { now: input.now })
  if (acquisition.status !== "AVAILABLE" || !acquisition.quote) {
    throw new Error(acquisition.blocker ||
      "LIVE_LISTING_SHIPPING_LUNA_READER_UNAVAILABLE")
  }
  const evidence = buildLiveListingShippingEvidenceV1({
    identity,
    quote: acquisition.quote,
  })
  const write = await input.supabase
    .from("seller_os_live_listing_shipping_evidence")
    .insert(evidence)
  if (write.error && write.error.code !== "23505") {
    throw new Error("LIVE_LISTING_SHIPPING_EVIDENCE_PERSIST_FAILED")
  }
  const readback = await readLatestLiveListingShippingEvidenceV1({
    supabase: input.supabase,
    identity,
    now: input.now,
  })
  if (!readback.evidence ||
      !liveListingShippingReadbackMatchesV1(evidence, readback.evidence)) {
    throw new Error("LIVE_LISTING_SHIPPING_DURABLE_READBACK_MISMATCH")
  }
  return Object.freeze({
    contractVersion: "LIVE_LISTING_LUNA_SHIPPING_EVIDENCE_V1" as const,
    exactLiveIdentity: true as const,
    supplierLinkage: "CERTIFIED" as const,
    lunaReaderExecuted: true as const,
    acquisitionMethod: evidence.source_authority,
    purchaseBoundaryEnforced: evidence.purchase_performed === false &&
      evidence.payment_performed === false,
    shippingCostStatus: "AVAILABLE" as const,
    shippingCurrencyStatus: "AVAILABLE" as const,
    supplierCurrencyStatus: "AVAILABLE" as const,
    shippingCost: evidence.shipping_cost,
    shippingCurrency: evidence.shipping_currency,
    supplierSubtotal: evidence.supplier_subtotal,
    supplierCurrency: evidence.supplier_currency,
    evidenceFreshness: readback.freshness,
    destinationFingerprint: evidence.destination_fingerprint,
    durableShippingEvidence: true as const,
    durableReadbackMatch: true as const,
    rawAddressPersisted: false as const,
    credentialsPersisted: false as const,
    evidenceId: evidence.evidence_id,
    lineage: resolved,
    marketplaceWrites: 0 as const,
  })
}
