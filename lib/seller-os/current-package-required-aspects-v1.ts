import { projectCurrentFactoryKeywordIdentityV2_1 } from "./current-keyword-continuation-v2-1"
import { resolveRadarRequiredItemSpecificsTruthV1 } from "../ebay/ebay-radar-canonical-marketplace-readiness-v1"
import { buildEbayListingTaxonomyPreflightV1 } from "../ebay/ebay-listing-taxonomy-preflight-v1"
import type { EbayTaxonomyListingIntelligence } from "../ebay/ebay-seller-keyword-demand-gateway"

type Row = Record<string, unknown>
function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
}

/** Preparation only. Reuses canonical supplier-aspect resolution and official
 * Taxonomy binding without invoking Economics, commercial continuation or
 * publication readiness. Missing facts remain explicit blockers.
 */
export function prepareCurrentPackageRequiredAspectsV1(input: Readonly<{
  accountKey: string
  listingPackage: Row
  opportunity: Row
  catalogRow: Row
  taxonomy: EbayTaxonomyListingIntelligence
  now?: Date
}>) {
  const pkg = input.listingPackage
  const data = record(pkg.package_data)
  const identity = projectCurrentFactoryKeywordIdentityV2_1(input)
  const taxonomy = input.taxonomy
  const observed = Date.parse(taxonomy.observedAt ?? "")
  const now = (input.now ?? new Date()).getTime()
  if (!identity.exact || pkg.account_key !== input.accountKey || pkg.status !== "draft" ||
      record(data.currentPublicationFactoryV1).publicationAuthorized !== false) {
    throw new Error("CURRENT_ASPECT_PACKAGE_BINDING_INVALID")
  }
  if (taxonomy.status !== "AVAILABLE" || taxonomy.source !== "EBAY_TAXONOMY_OFFICIAL_READONLY" ||
      taxonomy.taxonomyMarketplaceId !== "EBAY_US" || taxonomy.categoryResolution !== "KNOWN_CATEGORY" ||
      !taxonomy.categoryId || !taxonomy.categoryTreeVersion || !Number.isFinite(observed) ||
      observed > now + 60_000 || now - observed > 6 * 60 * 60_000) {
    throw new Error("CURRENT_ASPECT_OFFICIAL_TAXONOMY_REQUIRED")
  }
  const resolution = resolveRadarRequiredItemSpecificsTruthV1({
    opportunity: input.opportunity,
    productTruth: record(record(input.opportunity.assessment).productTruth),
    catalogRow: input.catalogRow, taxonomy,
  })
  if (!resolution.exactIdentity) throw new Error("CURRENT_ASPECT_SUPPLIER_BINDING_INVALID")
  const context = { marketplaceId: "EBAY_US" as const, listingPackageId: identity.packageId,
    opportunityId: identity.opportunityId, candidateKey: identity.candidateKey }
  const preflight = buildEbayListingTaxonomyPreflightV1({
    context, taxonomy, expectedCategoryId: taxonomy.categoryId,
    existingAspects: {}, provenProductValues: resolution.productTruth.provenProductValues,
    knownUnknownAspectNames: resolution.productTruth.knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements: Object.fromEntries(Object.entries(
      resolution.productTruth.unprovenAspectEvidenceRequirements).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string")),
  })
  return {
    ...data,
    categoryId: taxonomy.categoryId, categoryName: taxonomy.categoryName,
    aspects: preflight.resolvedAspects, taxonomyPreflight: preflight,
    productTruth: { ...record(data.productTruth), sourceEvidence: {
      ...record(record(data.productTruth).sourceEvidence),
      requiredItemSpecificsTruthV1: resolution.evidence,
    } },
    preparationStatus: { ...record(data.preparationStatus),
      readyToPublish: false, publicationAuthorized: false,
      category: "OFFICIAL_TAXONOMY_BOUND",
      requiredAspects: Object.entries(resolution.resolutions).map(([name, entry]) => ({
        name, value: entry.value, status: entry.exactProductSupported
          ? entry.semanticClass === "SUPPLIER_CLAIM" ? "EXPLICIT_SUPPLIER_CLAIM" : "PROVEN"
          : "PRODUCT_EVIDENCE_GAP",
      })),
    },
  }
}
