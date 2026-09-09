import type { SupabaseClient } from "@supabase/supabase-js"
import { readKeywordDecisionHandoffV1, consumeListingPackageKeywordHandoffV1 } from "./keyword-intelligence-handoff-v1"
import type { CommercialComponent, CommercialComponentName } from "./listing-commercial-envelope-v1"
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}

// Exact official/manual linkage already written by the certified publication
// workflow. This reader neither publishes nor creates repair links.
export async function readCommercialPackageBindingV1(input: { supabase: SupabaseClient; accountKey: string; itemId: string; sku: string | null }) {
  const unavailable = (reason: string) => ({ packageId: null as string | null, categoryId: null as string | null,
    components: {} as Partial<Record<CommercialComponentName, Partial<CommercialComponent>>>, reason })
  const [published, manual] = await Promise.all([
    input.supabase.from("ebay_authorized_listing_publications")
      .select("id,listing_package_id,opportunity_id,listing_id,sku,verified_active_at")
      .eq("marketplace_account_key", input.accountKey).eq("listing_id", input.itemId).limit(2),
    input.supabase.from("ebay_manual_listing_links").select("id,ebay_item_id,opportunity_id,candidate_key,verified_at")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US").eq("ebay_item_id", input.itemId)
      .eq("verification_status", "verified").eq("connector_listing_status", "active").limit(2),
  ])
  if (published.error || manual.error) return unavailable("COMMERCIAL_BINDING_READ_UNAVAILABLE")
  if ((published.data?.length ?? 0) > 1 || (manual.data?.length ?? 0) > 1) return unavailable("COMMERCIAL_BINDING_AMBIGUOUS")
  const p = published.data?.[0], m = manual.data?.[0]
  const official = p && p.verified_active_at && p.sku === input.sku ? p : null
  if (!official && !m) return unavailable("OFFICIAL_PACKAGE_BINDING_PENDING")
  if (p && !official) return unavailable("OFFICIAL_PACKAGE_BINDING_UNPROVEN")
  if (official && m && official.opportunity_id !== m.opportunity_id) return unavailable("COMMERCIAL_BINDING_CONFLICT")
  let query = input.supabase.from("ebay_listing_packages").select("id,opportunity_id,candidate_key,status,package_data,updated_at")
    .eq("account_key", input.accountKey).eq("opportunity_id", official?.opportunity_id ?? m!.opportunity_id)
  query = official ? query.eq("id", official.listing_package_id) : query.eq("candidate_key", m!.candidate_key)
  const packages = await query.limit(2)
  if (packages.error || packages.data?.length !== 1) return unavailable("EXACT_CANONICAL_PACKAGE_REQUIRED")
  const pkg = packages.data[0], data = record(pkg.package_data)
  if (m && pkg.candidate_key !== m.candidate_key) return unavailable("COMMERCIAL_CANDIDATE_CONFLICT")
  const queue = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id")
    .eq("id", pkg.opportunity_id).eq("candidate_key", pkg.candidate_key).limit(1).maybeSingle()
  const components: Partial<Record<CommercialComponentName, Partial<CommercialComponent>>> = {}
  const component = (value: unknown): Partial<CommercialComponent> => ({ status: value === null || value === undefined ? "PENDING" : "PROVEN",
    value: value ?? null, reference: `ebay_listing_packages:${pkg.id}:${pkg.updated_at}`, source: "ebay_listing_packages.package_data", observedAt: pkg.updated_at })
  components.listingPackage = component({ id: pkg.id, status: pkg.status })
  components.category = component(data.categoryId ?? null)
  components.itemSpecifics = component(data.itemSpecifics ?? data.aspects ?? null)
  // Preserve assets plus their existing provenance. URLs alone are not proof
  // of authorization to regenerate an image.
  components.images = { ...component(data.imageUrls ?? null), status: "PENDING" }
  if (!queue.error && queue.data) {
    const b = { ACCOUNT_KEY: input.accountKey, PRODUCT_ID: queue.data.supplier_product_id,
      VARIANT_ID: queue.data.supplier_variant_id, CANDIDATE_KEY: pkg.candidate_key, OPPORTUNITY_ID: pkg.opportunity_id }
    const handoff = consumeListingPackageKeywordHandoffV1(await readKeywordDecisionHandoffV1({ supabase: input.supabase, binding: b }), b)
    components.keywordV2_1 = { status: handoff.STATUS === "ACCEPTED" ? "PROVEN" : "PENDING", value: handoff,
      reference: typeof handoff.INPUT_FINGERPRINT === "string" ? handoff.INPUT_FINGERPRINT : null,
      source: "PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1" }
  }
  return { packageId: String(pkg.id), categoryId: typeof data.categoryId === "string" ? data.categoryId : null, components, reason: null }
}
