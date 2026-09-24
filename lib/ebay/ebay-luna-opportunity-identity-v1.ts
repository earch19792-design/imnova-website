import type { SupabaseClient } from "@supabase/supabase-js"

type ExactLunaIdentity = Readonly<{
  marketplaceId: "EBAY_US"
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
}>

type CatalogRow = Readonly<{
  product_id: string
  source_key: string
  supplier_product_id: string
  supplier_variant_id: string
  sku: string
  title: string
  variant_title: string | null
  barcode: string | null
  price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  captured_at: string | null
}>

type OpportunityIdentityRow = Readonly<{
  id: string
  candidate_key: string
  market_radar_product_id: string | null
  supplier_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
}>

export function canonicalLunaOpportunityCandidateKeyV1(
  supplierProductId: string,
  supplierVariantId: string,
) {
  return `luna-portex:${supplierProductId}:${supplierVariantId}`
}

function matchesIdentity(row: OpportunityIdentityRow, identity: ExactLunaIdentity,
  candidateKey: string, marketRadarProductId: string) {
  return row.candidate_key === candidateKey &&
    row.supplier_product_id === identity.supplierProductId &&
    row.supplier_variant_id === identity.supplierVariantId &&
    row.supplier_sku === identity.supplierSku &&
    row.market_radar_product_id === marketRadarProductId
}

/** Materialize only a verified Luna identity. No market or economic authority is inferred. */
export async function materializeCanonicalLunaOpportunityIdentityV1(input: Readonly<{
  supabase: SupabaseClient
  identity: ExactLunaIdentity
}>) {
  const { identity, supabase } = input
  if (identity.marketplaceId !== "EBAY_US" ||
    !/^\d{1,30}$/.test(identity.supplierProductId) ||
    !/^\d{1,30}$/.test(identity.supplierVariantId) ||
    !identity.supplierSku || identity.supplierSku.length > 120) {
    throw new Error("LUNA_OPPORTUNITY_EXACT_IDENTITY_REQUIRED")
  }
  const candidateKey = canonicalLunaOpportunityCandidateKeyV1(
    identity.supplierProductId, identity.supplierVariantId)
  const catalogRead = await supabase.from("market_radar_latest_variants")
    .select("product_id,source_key,supplier_product_id,supplier_variant_id,sku,title,variant_title,barcode,price,available,inventory_quantity,captured_at")
    .eq("source_key", "lunaportex")
    .eq("supplier_product_id", identity.supplierProductId)
    .eq("supplier_variant_id", identity.supplierVariantId)
    .eq("sku", identity.supplierSku).limit(2)
  const catalogRows = (catalogRead.data ?? []) as CatalogRow[]
  if (catalogRead.error || catalogRows.length !== 1 ||
    !catalogRows[0].product_id || !catalogRows[0].title) {
    throw new Error("LUNA_OPPORTUNITY_EXACT_CATALOG_READ_REQUIRED")
  }
  const catalog = catalogRows[0]
  const [keyRead, identityRead] = await Promise.all([
    supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,market_radar_product_id,supplier_product_id,supplier_variant_id,supplier_sku")
      .eq("candidate_key", candidateKey).limit(2),
    supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,market_radar_product_id,supplier_product_id,supplier_variant_id,supplier_sku")
      .eq("supplier_product_id", identity.supplierProductId)
      .eq("supplier_variant_id", identity.supplierVariantId)
      .eq("supplier_sku", identity.supplierSku).limit(2),
  ])
  const keyed = (keyRead.data ?? []) as OpportunityIdentityRow[]
  const exact = (identityRead.data ?? []) as OpportunityIdentityRow[]
  if (keyRead.error || identityRead.error || keyed.length > 1 || exact.length > 1 ||
    [...keyed, ...exact].some((row) => !matchesIdentity(
      row, identity, candidateKey, catalog.product_id))) {
    throw new Error("LUNA_OPPORTUNITY_IDENTITY_CONFLICT")
  }
  let created = false
  if (!keyed.length && !exact.length) {
    // The normal queue uses this same candidate key and onConflict target.
    // ignoreDuplicates preserves a concurrently created, richer opportunity.
    const write = await supabase.from("ebay_luna_opportunity_queue")
      .upsert({
        candidate_key: candidateKey,
        market_radar_product_id: catalog.product_id,
        supplier_product_id: identity.supplierProductId,
        supplier_variant_id: identity.supplierVariantId,
        supplier_sku: identity.supplierSku,
        product_title: catalog.title,
        variant_title: catalog.variant_title,
        gtin: catalog.barcode,
        queue_status: "watchlist",
        decision: "IDENTITY_ONLY_SOURCE_VERIFIED",
        supplier_price: catalog.price,
        supplier_available: catalog.available,
        supplier_inventory_quantity: catalog.inventory_quantity,
        supplier_snapshot_at: catalog.captured_at,
        assessment: {
          canonicalIdentityIntakeV1: {
            marketplaceId: "EBAY_US",
            source: "market_radar_latest_variants",
            sourceKey: catalog.source_key,
            supplierProductId: identity.supplierProductId,
            supplierVariantId: identity.supplierVariantId,
            supplierSku: identity.supplierSku,
            sourceObservedAt: catalog.captured_at,
            marketEvidenceStatus: "UNKNOWN",
            economicsStatus: "UNKNOWN",
          },
        },
      }, { onConflict: "candidate_key", ignoreDuplicates: true })
    if (write.error) throw new Error("LUNA_OPPORTUNITY_IDENTITY_WRITE_FAILED")
    created = true
  }
  const readback = await supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,market_radar_product_id,supplier_product_id,supplier_variant_id,supplier_sku,queue_status,decision")
    .eq("candidate_key", candidateKey).limit(2)
  const rows = (readback.data ?? []) as (OpportunityIdentityRow & {
    queue_status: string; decision: string
  })[]
  if (readback.error || rows.length !== 1 || !matchesIdentity(
    rows[0], identity, candidateKey, catalog.product_id)) {
    throw new Error("LUNA_OPPORTUNITY_IDENTITY_READBACK_FAILED")
  }
  return Object.freeze({ opportunityId: rows[0].id, candidateKey,
    identityReadback: Object.freeze({ ...identity,
      marketRadarProductId: catalog.product_id,
      queueStatus: rows[0].queue_status,
      decision: rows[0].decision }),
    created, downstreamStagesTriggered: 0 as const,
    taxonomyExecutions: 0 as const, economicsExecutions: 0 as const,
    ebayWrites: 0 as const, publicationWrites: 0 as const,
    inventoryWrites: 0 as const, stockGuardWrites: 0 as const })
}
