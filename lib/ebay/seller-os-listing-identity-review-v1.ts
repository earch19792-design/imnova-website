import type { ListingCaseProjectionV1 } from "./seller-os-listing-registry-v1"

type Case = ListingCaseProjectionV1 & { case_id: string }
type Catalog = { product_id: string; variant_id: string; sku: string;
  preflight_status: string }
type Decision = { ebay_item_id: string; ebay_sku: string;
  luna_product_id: string; luna_variant_id: string; luna_sku: string;
  decision: string; decision_version: number; evidence_observed_at: string }
type Package = { id: string; opportunity_id: string; candidate_key: string }
type Opportunity = { id: string; candidate_key: string;
  supplier_product_id: string | null; supplier_variant_id: string | null;
  supplier_sku: string | null }

export type ListingIdentityReviewV1 = {
  itemId: string
  customLabel: string | null
  currentTitle: string | null
  origin: string
  identitySource: string
  classification: "DUPLICATE" | "NEEDS_OWNER_REVIEW" |
    "MANUAL_EBAY_NO_LUNA" | "SOURCE_MISSING"
  reasonCode: string
  recommendedOwnerAction: string
  conflictingItemIds: string[]
  candidates: Array<{ productId: string; variantId: string; sku: string;
    opportunityId: string | null; source: string; preflightStatus: string | null }>
}

export function packageIdFromCustomLabelV1(label: string | null) {
  const match = label?.match(/^IMNOVA([0-9A-F]{8})([0-9A-F]{4})([0-9A-F]{4})([0-9A-F]{4})([0-9A-F]{12})$/)
  return match ? `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`
    .toLowerCase() : null
}

export function buildListingIdentityReviewQueueV1(input: {
  cases: readonly Case[]
  catalog: readonly Catalog[]
  decisions: readonly Decision[]
  packages: readonly Package[]
  opportunities: readonly Opportunity[]
}): ListingIdentityReviewV1[] {
  const byLabel = new Map<string, string[]>()
  for (const row of input.cases) {
    const key = row.ebay_custom_label?.trim().toUpperCase()
    if (key) byLabel.set(key, [...(byLabel.get(key) ?? []), row.ebay_item_id])
  }
  const packageById = new Map(input.packages.map((row) => [row.id, row]))
  const opportunityById = new Map(input.opportunities.map((row) => [row.id, row]))
  return input.cases.filter((row) => row.identity_status !== "LINKED_EXACT")
    .map((row) => {
      const label = row.ebay_custom_label?.trim() || null
      const labelKey = label?.toUpperCase() ?? null
      const conflicts = labelKey ? (byLabel.get(labelKey) ?? [])
        .filter((itemId) => itemId !== row.ebay_item_id) : []
      const candidates: ListingIdentityReviewV1["candidates"] = []
      const append = (candidate: ListingIdentityReviewV1["candidates"][number]) => {
        if (!candidates.some((existing) => existing.productId === candidate.productId &&
            existing.variantId === candidate.variantId && existing.sku === candidate.sku)) {
          candidates.push(candidate)
        }
      }
      if (row.luna_product_id && row.luna_variant_id && row.supplier_sku) {
        append({ productId: row.luna_product_id, variantId: row.luna_variant_id,
          sku: row.supplier_sku, opportunityId: row.opportunity_id,
          source: row.identity_source, preflightStatus: null })
      }
      for (const variant of input.catalog.filter((variant) =>
        labelKey && variant.sku.toUpperCase() === labelKey)) {
        const exactOpportunities = input.opportunities.filter((opportunity) =>
          opportunity.supplier_product_id === variant.product_id &&
          opportunity.supplier_variant_id === variant.variant_id &&
          opportunity.supplier_sku === variant.sku)
        append({ productId: variant.product_id, variantId: variant.variant_id,
          sku: variant.sku,
          opportunityId: exactOpportunities.length === 1 ? exactOpportunities[0].id : null,
          source: "CURRENT_LUNA_CATALOG_EXACT_SKU",
          preflightStatus: variant.preflight_status })
      }
      const packageId = packageIdFromCustomLabelV1(label)
      const listingPackage = packageId ? packageById.get(packageId) : null
      const opportunity = listingPackage
        ? opportunityById.get(listingPackage.opportunity_id) : null
      if (opportunity && opportunity.candidate_key === listingPackage?.candidate_key &&
          opportunity.supplier_product_id && opportunity.supplier_variant_id &&
          opportunity.supplier_sku) {
        const current = input.catalog.find((variant) =>
          variant.product_id === opportunity.supplier_product_id &&
          variant.variant_id === opportunity.supplier_variant_id &&
          variant.sku === opportunity.supplier_sku)
        append({ productId: opportunity.supplier_product_id,
          variantId: opportunity.supplier_variant_id,
          sku: opportunity.supplier_sku, opportunityId: opportunity.id,
          source: "EXACT_PACKAGE_LABEL_LINEAGE",
          preflightStatus: current?.preflight_status ?? null })
      }
      const latestDecision = input.decisions.filter((decision) =>
        decision.ebay_item_id === row.ebay_item_id)
        .sort((a, b) => b.decision_version - a.decision_version)[0]
      if (latestDecision?.decision === "APPROVE_EXACT_LINKAGE" &&
          latestDecision.ebay_sku.toUpperCase() === labelKey) {
        const current = input.catalog.find((variant) =>
          variant.product_id === latestDecision.luna_product_id &&
          variant.variant_id === latestDecision.luna_variant_id &&
          variant.sku === latestDecision.luna_sku)
        append({ productId: latestDecision.luna_product_id,
          variantId: latestDecision.luna_variant_id,
          sku: latestDecision.luna_sku, opportunityId: null,
          source: "HISTORICAL_APPROVED_LINKAGE_DECISION",
          preflightStatus: current?.preflight_status ?? null })
      }
      let classification: ListingIdentityReviewV1["classification"] =
        "NEEDS_OWNER_REVIEW"
      let reasonCode = "EXACT_IDENTITY_LINK_NOT_PROVEN"
      let recommendedOwnerAction = "Verificar la identidad exacta con el flujo de Listings."
      if (row.identity_status === "DUPLICATE_IDENTITY" || conflicts.length) {
        classification = "DUPLICATE"
        reasonCode = "DUPLICATE_ACTIVE_CUSTOM_LABEL"
        recommendedOwnerAction = "Corregir el Custom Label duplicado en eBay y volver a verificar ambos Item IDs."
      } else if (row.identity_status === "AMBIGUOUS") {
        reasonCode = "OFFICIAL_LISTING_VARIATION_OR_LINEAGE_AMBIGUOUS"
        recommendedOwnerAction = "Confirmar la variación y la identidad exactas; no vincular por título."
      } else if (!label) {
        classification = "SOURCE_MISSING"
        reasonCode = "OFFICIAL_CUSTOM_LABEL_MISSING"
        recommendedOwnerAction = "Aportar el SKU o declarar que el listing no tiene proveedor Luna."
      } else if (!candidates.length && row.origin === "MANUAL_EBAY") {
        classification = "MANUAL_EBAY_NO_LUNA"
        reasonCode = "MANUAL_LISTING_WITHOUT_LUNA_SOURCE"
        recommendedOwnerAction = "Mantener el caso manual; registrar proveedor y stock si corresponde."
      } else if (!candidates.length) {
        classification = "SOURCE_MISSING"
        reasonCode = "NO_EXACT_LUNA_IDENTITY_IN_CURRENT_SOURCES"
        recommendedOwnerAction = "Confirmar el proveedor de este Item ID; conservar el caso sin asociación Luna."
      } else if (candidates.length > 1) {
        reasonCode = "CONFLICTING_CANONICAL_IDENTITY_CANDIDATES"
        recommendedOwnerAction = "Seleccionar sólo con evidencia exacta de producto y variante."
      } else if (candidates.length === 1 && input.cases.some((other) =>
        other.ebay_item_id !== row.ebay_item_id &&
        other.identity_status === "LINKED_EXACT" &&
        other.luna_product_id === candidates[0].productId &&
        other.luna_variant_id === candidates[0].variantId)) {
        reasonCode = "ACTIVE_SUPPLIER_IDENTITY_ALREADY_LINKED"
        recommendedOwnerAction = "Revisar la relación con el otro Item ID antes de cualquier reemplazo."
      } else if (candidates[0].preflightStatus !== "PREFLIGHT_PASS") {
        reasonCode = "LUNA_IDENTITY_PREFLIGHT_NOT_PASSED"
        recommendedOwnerAction = "Resolver el preflight de identidad antes del vínculo StockGuard."
      } else {
        reasonCode = "EXACT_CANDIDATE_REQUIRES_GUARDED_LINK"
        recommendedOwnerAction = "Verificar el Item ID oficial y vincular la oportunidad exacta."
      }
      return { itemId: row.ebay_item_id, customLabel: label,
        currentTitle: row.ebay_title, origin: row.origin,
        identitySource: row.identity_source, classification,
        reasonCode, recommendedOwnerAction,
        conflictingItemIds: conflicts, candidates }
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
}
