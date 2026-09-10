import type { SupabaseClient } from "@supabase/supabase-js"
import { SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1 } from "../ebay/ebay-luna-authoritative-shipping-server-v1"
import { buildEconomicEvidenceV1 } from "./economic-evidence-refresh-v1"
type R = Record<string, unknown>
const record = (v: unknown): R => v && typeof v === "object" && !Array.isArray(v) ? v as R : {}
const rows = (v: unknown) => Array.isArray(v) ? v.map(record) : []

export function resolvePortexShippingAuthorityV1(input: { accountKey: string; itemId: string; sku: string | null;
  linkage: unknown; quote: unknown; destinationFingerprint: string; now: Date }) {
  const l = record(input.linkage), q = record(input.quote)
  const exact = l.account_key === input.accountKey && l.ebay_item_id === input.itemId && l.ebay_sku === input.sku &&
    l.decision === "APPROVE_EXACT_LINKAGE" && typeof l.linkage_id === "string" &&
    q.account_key === input.accountKey && q.ebay_item_id === input.itemId && q.marketplace_id === "EBAY_US" &&
    q.linkage_id === l.linkage_id && q.luna_product_id === l.luna_product_id && q.luna_variant_id === l.luna_variant_id &&
    q.source_sku === l.luna_sku && typeof q.luna_product_id === "string" && typeof q.luna_variant_id === "string" && typeof q.source_sku === "string" &&
    q.destination_fingerprint === input.destinationFingerprint && q.shipping_currency === "USD" && q.supplier_currency === "USD" &&
    q.shipping_cost !== null && q.shipping_cost !== undefined && Number.isFinite(Number(q.shipping_cost)) && Number(q.shipping_cost) >= 0 &&
    q.purchase_performed === false && q.payment_performed === false && q.raw_address_persisted === false && q.credentials_persisted === false &&
    typeof q.evidence_id === "string" && typeof q.source_evidence_digest === "string" && /^sha256:[a-f0-9]{64}$/.test(q.source_evidence_digest) &&
    ["LUNA_AUTHENTICATED_HTTP_CART_SHIPPING", "LUNA_PROTECTED_BROWSER_CHECKOUT_SHIPPING"].includes(String(q.source_authority))
  const fresh = exact && Number(q.maximum_age_seconds) === 21600 && Date.parse(String(q.observed_at)) <= input.now.getTime() &&
    Date.parse(String(q.observed_at)) + 21600000 > input.now.getTime()
  return { proven: fresh, authority: "LUNA_PORTEX_SHIPPING_AUTHORITY", status: fresh ? "PROVEN" : "WAITING_FOR_DATA",
    reason: !exact ? "PORTEX_EXACT_SCOPE_REQUIRED" : !fresh ? "PORTEX_QUOTE_EXPIRED" : null,
    cost: fresh ? Number(q.shipping_cost) : null, reference: fresh ? String(q.evidence_id) : null,
    observedAt: fresh ? String(q.observed_at) : null, unnecessaryCheckoutRefresh: false }
}

/** Projection of existing immutable Portex quotes: no supplier calls, writes,
 * timestamp renewal or fallback to an older quote after a newer invalid one. */
export async function attachPortexShippingEvidenceV1(input: { supabase: SupabaseClient; accountKey: string; rawRows: unknown[]; now: Date }) {
  if (!input.rawRows.length || input.rawRows.length > 20) throw Error("PORTEX_BOUNDED_SCOPE_REQUIRED")
  const rawRows = input.rawRows.map(record), ids = rawRows.map(r => String(r.itemId))
  const [links, quotes] = await Promise.all([
    input.supabase.from("seller_os_luna_linkage_decisions")
      .select("account_key,ebay_item_id,ebay_sku,decision,decision_version,linkage_id,luna_product_id,luna_variant_id,luna_sku")
      .eq("account_key", input.accountKey).in("ebay_item_id", ids).order("decision_version", { ascending: false }).limit(100),
    input.supabase.from("seller_os_live_listing_shipping_evidence")
      .select("evidence_id,account_key,marketplace_id,ebay_item_id,linkage_id,luna_product_id,luna_variant_id,source_sku,destination_fingerprint,supplier_subtotal,supplier_currency,shipping_cost,shipping_currency,observed_at,maximum_age_seconds,source_authority,source_evidence_digest,purchase_performed,payment_performed,raw_address_persisted,credentials_persisted")
      .eq("account_key", input.accountKey).in("ebay_item_id", ids).order("observed_at", { ascending: false }).limit(100),
  ])
  if (links.error || quotes.error) return rawRows
  return rawRows.map(raw => {
    const listing = rows(raw.listings)[0], itemId = String(raw.itemId)
    const quote = rows(quotes.data).find(q => q.ebay_item_id === itemId)
    const authority = resolvePortexShippingAuthorityV1({ ...input, itemId, sku: typeof listing?.ebay_sku === "string" ? listing.ebay_sku : null,
      linkage: rows(links.data).find(l => l.ebay_item_id === itemId), quote,
      destinationFingerprint: SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1.profileDigest })
    if (!authority.proven) return { ...raw, shippingAuthority: authority }
    const evidence = rows(raw.evidence), current = evidence.find(e => e.evidence_type === "LUNA_CURRENT_SHIPPING")
    if (current && Date.parse(String(current.captured_at)) > Date.parse(authority.observedAt!) && current.value_amount !== null) return { ...raw, shippingAuthority: authority }
    const projected = buildEconomicEvidenceV1({ accountKey: input.accountKey, itemId, evidenceType: "LUNA_CURRENT_SHIPPING",
      value: authority.cost, sourceAuthority: authority.authority, sourceEntityId: authority.reference!, capturedAt: authority.observedAt!, status: "FRESH",
      metadata: { destinationFingerprint: quote!.destination_fingerprint, sourceAuthority: quote!.source_authority } })
    return { ...raw, shippingAuthority: authority, evidence: [...evidence.filter(e => e.evidence_type !== "LUNA_CURRENT_SHIPPING"), projected] }
  })
}
