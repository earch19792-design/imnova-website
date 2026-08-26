import { createHash } from "node:crypto"

import type { CommercialMonitorGetDto } from
  "./commercial-monitor-readonly-contract"
import { currentLiveListingsForMonitorV1,
  resolveCrossModuleLivePortfolioIntegrityV1 } from
  "./ebay-seller-os-live-portfolio-integrity-v1"

export const SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_VERSION =
  "SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_V1" as const

export const SELLER_OS_LUNA_SUPPLIER_LINKAGE_RESOURCE_V1 = Object.freeze({
  id: "seller-os://phase-2/luna-supplier-linkage",
  title: "Seller OS Luna supplier linkage certification",
  description: "Read the fixed canonical seller account's bounded, variant-specific eBay listing to Luna supplier linkage evidence and human-review state. This resource never reads stock as identity, mutates Luna, or changes a listing.",
})

export const SELLER_OS_LUNA_SUPPLIER_LINKAGE_MAXIMUM_ENTRIES = 50

export type SellerOsLunaSupplierLinkageStatusV1 =
  | "UNPROVEN"
  | "CANDIDATE"
  | "HUMAN_REVIEW"
  | "CERTIFIED"
  | "REJECTED"
  | "STALE"

export type SellerOsLunaSupplierApprovalEvidenceV1 = Readonly<{
  ebayItemId: string
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  approvedAt: string
  approvalProvenance: string
  decisionReference: string
  sourceUpdatedAt: string | null
  variantPresence: "PRESENT" | "MISSING" | "UNPROVEN"
  productTitle: string | null
  variantTitle: string | null
  evidenceReferences: readonly string[]
}>

export type SellerOsLunaSupplierComponentEvidenceV1 = Readonly<{
  lunaProductId: string
  lunaVariantId: string | null
  lunaProductHasVariants: boolean
  lunaSku: string
  productTitle: string | null
  variantTitle: string | null
  supplierQuantityRequired: number
  variantPresence: "PRESENT" | "MISSING" | "UNPROVEN"
  evidenceReferences: readonly string[]
  exactSupplierSku: boolean
  exactVariantAttributes: boolean
  colorMatch: boolean | null
  sizeMatch: boolean | null
  packCountMatch: boolean | null
}>

export type SellerOsLunaSupplierCandidateEvidenceV1 = Readonly<{
  ebayItemId: string
  lunaProductId: string | null
  lunaVariantId: string | null
  lunaProductHasVariants: boolean | null
  lunaSku: string | null
  lunaModel: string | null
  productTitle: string | null
  variantTitle: string | null
  observedAt: string | null
  sourceUpdatedAt: string | null
  evidenceReferences: readonly string[]
  exactSupplierSku: boolean
  exactModelNumber: boolean
  exactVariantAttributes: boolean
  titleSimilarityOnly: boolean
  colorMatch: boolean | null
  sizeMatch: boolean | null
  packCountMatch: boolean | null
  listingPackCount: number | null
  supplierUnitCount: number | null
  supplierQuantityPerSale: number | null
  supplierComponents: readonly SellerOsLunaSupplierComponentEvidenceV1[]
  historicalApprovedRelationship: boolean
  variantPresence: "PRESENT" | "MISSING" | "UNPROVEN"
  humanDecision: Readonly<{
    status: "PENDING" | "APPROVED" | "REJECTED" | "KEPT_UNPROVEN" |
      "EXPIRED" | "CANCELLED"
    decidedAt: string | null
    decisionReference: string | null
    version: string
  }> | null
}>

export type SellerOsLunaSupplierLinkageRepositoryEvidenceV1 = Readonly<{
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"
  observedAt: string
  approvalEvidence: readonly SellerOsLunaSupplierApprovalEvidenceV1[]
  candidateEvidence: readonly SellerOsLunaSupplierCandidateEvidenceV1[]
  decisionEvidence?: readonly Readonly<{
    ebayItemId: string
    status: "APPROVED" | "REJECTED" | "KEPT_UNPROVEN"
    decidedAt: string
    decisionReference: string
    version: string
    evidenceDigest: string
  }>[]
  rowsRead: number
  truncated: boolean
  limitationCodes: readonly string[]
}>

type ListingInput = Readonly<{
  itemId: string
  sku: string | null
  title: string | null
  listingType: "INDIVIDUAL" | "PACK" | "BUNDLE" | "KIT" | "UNKNOWN"
  observedAt: string | null
  evidenceReferences: readonly string[]
}>

type ConflictInput = Readonly<{
  itemId: string
  evidenceReferences: readonly string[]
  titleRepresentations: readonly string[]
  skuRepresentations: readonly string[]
  identityRepresentationConflict: boolean
}>

function normalized(value: unknown, maximum = 200) {
  if (typeof value !== "string") return null
  const result = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  return result || null
}

function sha256(parts: readonly unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

function stableIdentity(prefix: string, parts: readonly unknown[]) {
  return `${prefix}:sha256:${sha256(parts)}`
}

function unique(values: readonly (string | null | undefined)[], maximum = 24) {
  return [...new Set(values.filter((value): value is string =>
    Boolean(value && /^[A-Za-z0-9_:.\-/]{1,240}$/.test(value))))]
    .sort().slice(0, maximum)
}

function validPositiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value) : null
}

function candidateIdentity(accountKey: string, candidate:
SellerOsLunaSupplierCandidateEvidenceV1) {
  const components = candidateComponents(candidate)
  if (!components.complete || components.values.length === 0) return null
  return stableIdentity("luna-linkage-v1", [
    accountKey, "EBAY_US", candidate.ebayItemId,
    components.values.map((component) => [
      component.lunaProductId,
      component.lunaVariantId ?? "NO_VARIANT",
      component.lunaSku,
      component.supplierQuantityRequired,
    ]),
    SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_VERSION,
  ])
}

function approvalIdentity(accountKey: string,
  approval: SellerOsLunaSupplierApprovalEvidenceV1) {
  return stableIdentity("luna-linkage-v1", [
    accountKey, "EBAY_US", approval.ebayItemId, approval.lunaProductId,
    approval.lunaVariantId, SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_VERSION,
  ])
}

function candidateStrength(candidate: SellerOsLunaSupplierCandidateEvidenceV1) {
  const components = candidateComponents(candidate)
  if (!components.complete) return 0
  if (candidate.titleSimilarityOnly) return 1
  let score = 0
  if (components.values.every((component) => component.exactSupplierSku)) {
    score += 4
  }
  if (candidate.exactModelNumber) score += 3
  if (components.values.every((component) =>
    component.exactVariantAttributes)) score += 4
  if (candidate.historicalApprovedRelationship) score += 2
  return score
}

function multiplierFor(candidate: SellerOsLunaSupplierCandidateEvidenceV1 | null) {
  if (!candidate) return null
  const explicit = validPositiveInteger(candidate.supplierQuantityPerSale)
  if (explicit) return explicit
  const listingUnits = validPositiveInteger(candidate.listingPackCount)
  const supplierUnits = validPositiveInteger(candidate.supplierUnitCount)
  if (!listingUnits || !supplierUnits || listingUnits % supplierUnits !== 0) {
    return null
  }
  return listingUnits / supplierUnits
}

function candidateHasMaterialMismatch(candidate:
SellerOsLunaSupplierCandidateEvidenceV1) {
  const components = candidateComponents(candidate).values
  return candidate.colorMatch === false || candidate.sizeMatch === false ||
    candidate.packCountMatch === false || components.some((component) =>
      component.colorMatch === false || component.sizeMatch === false ||
      component.packCountMatch === false)
}

function candidateVariantComplete(candidate:
SellerOsLunaSupplierCandidateEvidenceV1) {
  return candidateComponents(candidate).complete
}

type NormalizedSupplierComponent = Readonly<{
  lunaProductId: string
  lunaVariantId: string | null
  lunaProductHasVariants: boolean
  lunaSku: string
  productTitle: string | null
  variantTitle: string | null
  supplierQuantityRequired: number
  variantPresence: "PRESENT" | "MISSING" | "UNPROVEN"
  evidenceReferences: readonly string[]
  exactSupplierSku: boolean
  exactVariantAttributes: boolean
  colorMatch: boolean | null
  sizeMatch: boolean | null
  packCountMatch: boolean | null
}>

function candidateComponents(candidate:
SellerOsLunaSupplierCandidateEvidenceV1): Readonly<{
  values: readonly NormalizedSupplierComponent[]
  explicit: boolean
  complete: boolean
}> {
  const explicit = candidate.supplierComponents.length > 0
  const source: readonly SellerOsLunaSupplierComponentEvidenceV1[] = explicit
    ? candidate.supplierComponents
    : [{
        lunaProductId: candidate.lunaProductId ?? "",
        lunaVariantId: candidate.lunaVariantId,
        lunaProductHasVariants: candidate.lunaProductHasVariants ?? true,
        lunaSku: candidate.lunaSku ?? "",
        productTitle: candidate.productTitle,
        variantTitle: candidate.variantTitle,
        supplierQuantityRequired: multiplierFor(candidate) ?? 1,
        variantPresence: candidate.variantPresence,
        evidenceReferences: candidate.evidenceReferences,
        exactSupplierSku: candidate.exactSupplierSku,
        exactVariantAttributes: candidate.exactVariantAttributes,
        colorMatch: candidate.colorMatch,
        sizeMatch: candidate.sizeMatch,
        packCountMatch: candidate.packCountMatch,
      }]
  const normalizedComponents = source.flatMap((component) => {
    const productId = normalized(component.lunaProductId, 100)
    const variantId = normalized(component.lunaVariantId, 100)
    const sku = normalized(component.lunaSku, 120)
    const quantity = validPositiveInteger(component.supplierQuantityRequired)
    if (!productId || !sku || !quantity ||
        (component.lunaProductHasVariants && !variantId)) return []
    return [Object.freeze({
      lunaProductId: productId,
      lunaVariantId: variantId,
      lunaProductHasVariants: component.lunaProductHasVariants,
      lunaSku: sku,
      productTitle: normalized(component.productTitle),
      variantTitle: normalized(component.variantTitle),
      supplierQuantityRequired: quantity,
      variantPresence: component.variantPresence,
      evidenceReferences: Object.freeze(unique(component.evidenceReferences)),
      exactSupplierSku: component.exactSupplierSku,
      exactVariantAttributes: component.exactVariantAttributes,
      colorMatch: component.colorMatch,
      sizeMatch: component.sizeMatch,
      packCountMatch: component.packCountMatch,
    })]
  }).sort((left, right) => JSON.stringify([
    left.lunaProductId, left.lunaVariantId, left.lunaSku,
    left.supplierQuantityRequired,
  ]).localeCompare(JSON.stringify([
    right.lunaProductId, right.lunaVariantId, right.lunaSku,
    right.supplierQuantityRequired,
  ])))
  return Object.freeze({
    values: Object.freeze(normalizedComponents),
    explicit,
    complete: normalizedComponents.length === source.length &&
      normalizedComponents.length > 0,
  })
}

function sortCandidates(values: readonly SellerOsLunaSupplierCandidateEvidenceV1[]) {
  return [...values].sort((left, right) =>
    candidateStrength(right) - candidateStrength(left) ||
    JSON.stringify([left.lunaProductId, left.lunaVariantId, left.lunaSku])
      .localeCompare(JSON.stringify([
        right.lunaProductId, right.lunaVariantId, right.lunaSku,
      ])))
}

function projectEntry(input: Readonly<{
  accountKey: string
  listing: ListingInput
  conflict: ConflictInput | null
  approvals: readonly SellerOsLunaSupplierApprovalEvidenceV1[]
  candidates: readonly SellerOsLunaSupplierCandidateEvidenceV1[]
  decisions: readonly NonNullable<
    SellerOsLunaSupplierLinkageRepositoryEvidenceV1["decisionEvidence"]>[number][]
  observedAt: string
}>) {
  const listingIdentityId = stableIdentity("ebay-listing-identity-v1", [
    input.accountKey, "EBAY_US", input.listing.itemId,
  ])
  const approvalIdentities = new Set(input.approvals.map((approval) =>
    approvalIdentity(input.accountKey, approval)))
  const approval = input.approvals[0] ?? null
  const candidates = sortCandidates([...new Map(input.candidates.flatMap(
    (candidate) => {
      const identity = candidateIdentity(input.accountKey, candidate)
      return identity ? [[identity, candidate] as const] : []
    }),
  ).values()])
  const topCandidate = candidates[0] ?? null
  const componentSet = topCandidate ? candidateComponents(topCandidate) : null
  const topStrength = topCandidate ? candidateStrength(topCandidate) : 0
  const equallyPlausible = topStrength > 0 && candidates.filter((candidate) =>
    candidateStrength(candidate) === topStrength).length > 1
  const candidateMismatch = topCandidate
    ? candidateHasMaterialMismatch(topCandidate) : false
  const variantIncomplete = topCandidate
    ? !candidateVariantComplete(topCandidate) : false
  const titleOnly = Boolean(topCandidate?.titleSimilarityOnly)
  const allCandidateComponentsPresent = Boolean(componentSet?.complete &&
    componentSet.values.every((component) =>
      component.variantPresence === "PRESENT"))
  const strongCandidate = Boolean(topCandidate && topStrength >= 8 &&
    !candidateMismatch && !variantIncomplete && !titleOnly &&
    allCandidateComponentsPresent)
  const durableDecision = [...input.decisions].sort((left, right) =>
    right.version.localeCompare(left.version))[0] ?? null
  const decision = topCandidate?.humanDecision ?? (durableDecision
    ? Object.freeze({
        status: durableDecision.status,
        decidedAt: durableDecision.decidedAt,
        decisionReference: durableDecision.decisionReference,
        version: durableDecision.version,
      })
    : null)
  const scalarSupplierQuantityPerSale = multiplierFor(topCandidate)
  const isBundle = ["PACK", "BUNDLE", "KIT"].includes(
    input.listing.listingType)
  const explicitComponents = componentSet?.explicit === true
  const multiComponentBom = Boolean(componentSet?.complete &&
    componentSet.values.length > 1)
  const singleComponentMultiplier = Boolean(componentSet?.complete &&
    componentSet.values.length === 1 && (
      explicitComponents || scalarSupplierQuantityPerSale !== null
    ))
  const bundleSemanticsComplete = !isBundle || multiComponentBom ||
    singleComponentMultiplier
  const bundleRequiresMultiplier = isBundle && !bundleSemanticsComplete
  const individualHasMultipleComponents = !isBundle &&
    Boolean(componentSet && componentSet.values.length > 1)
  const bundleHumanDecisionMissing = isBundle && bundleSemanticsComplete &&
    Boolean(approval) && decision?.status !== "APPROVED"
  const candidateComponentVariantMissing = Boolean(componentSet?.values.some(
    (component) => component.variantPresence === "MISSING"))
  const approvedComponentVariantMissing = decision?.status === "APPROVED" &&
    candidateComponentVariantMissing

  let status: SellerOsLunaSupplierLinkageStatusV1 = "UNPROVEN"
  if (input.conflict?.identityRepresentationConflict ||
      approvalIdentities.size > 1 || equallyPlausible || candidateMismatch ||
      variantIncomplete || bundleRequiresMultiplier ||
      individualHasMultipleComponents || bundleHumanDecisionMissing) {
    status = "HUMAN_REVIEW"
  } else if (approval?.variantPresence === "MISSING" ||
      approvedComponentVariantMissing) {
    status = "STALE"
  } else if (approval) {
    status = "CERTIFIED"
  } else if (decision?.status === "REJECTED") {
    status = "REJECTED"
  } else if (decision?.status === "KEPT_UNPROVEN") {
    status = "UNPROVEN"
  } else if (decision?.status === "APPROVED" && strongCandidate) {
    status = "CERTIFIED"
  } else if (decision?.status === "APPROVED") {
    status = "HUMAN_REVIEW"
  } else if (strongCandidate) {
    status = "CANDIDATE"
  }

  const useCandidateComponents = Boolean(componentSet?.complete && (
    isBundle || multiComponentBom || decision?.status === "APPROVED"
  ))
  const projectedComponents: readonly NormalizedSupplierComponent[] =
    useCandidateComponents
      ? componentSet!.values
      : approval ? [Object.freeze({
          lunaProductId: approval.lunaProductId,
          lunaVariantId: approval.lunaVariantId,
          lunaProductHasVariants: true,
          lunaSku: approval.lunaSku,
          productTitle: approval.productTitle,
          variantTitle: approval.variantTitle,
          supplierQuantityRequired: 1,
          variantPresence: approval.variantPresence,
          evidenceReferences: approval.evidenceReferences,
          exactSupplierSku: true,
          exactVariantAttributes: true,
          colorMatch: null,
          sizeMatch: null,
          packCountMatch: null,
        })]
      : componentSet?.values ?? []
  const identityCandidate = projectedComponents.length === 1
    ? projectedComponents[0]
    : approval ? {
    lunaProductId: approval.lunaProductId,
    lunaVariantId: approval.lunaVariantId,
    lunaProductHasVariants: true,
    lunaSku: approval.lunaSku,
    productTitle: approval.productTitle,
    variantTitle: approval.variantTitle,
    sourceUpdatedAt: approval.sourceUpdatedAt,
  } : topCandidate ? {
    lunaProductId: topCandidate.lunaProductId,
    lunaVariantId: topCandidate.lunaVariantId,
    lunaProductHasVariants: topCandidate.lunaProductHasVariants,
    lunaSku: topCandidate.lunaSku,
    productTitle: topCandidate.productTitle,
    variantTitle: topCandidate.variantTitle,
    sourceUpdatedAt: topCandidate.sourceUpdatedAt,
  } : null
  const linkageId = useCandidateComponents && topCandidate
    ? candidateIdentity(input.accountKey, topCandidate)
    : approval ? approvalIdentity(input.accountKey, approval)
      : topCandidate ? candidateIdentity(input.accountKey, topCandidate) : null
  const reasonCodes = unique([
    ...(input.conflict?.identityRepresentationConflict
      ? ["LISTING_IDENTITY_REPRESENTATION_CONFLICT"] : []),
    ...(approvalIdentities.size > 1
      ? ["MULTIPLE_APPROVED_SUPPLIER_IDENTITIES"] : []),
    ...(equallyPlausible ? ["MULTIPLE_EQUALLY_PLAUSIBLE_LUNA_CANDIDATES"] : []),
    ...(candidateMismatch ? ["STRUCTURED_VARIANT_ATTRIBUTE_MISMATCH"] : []),
    ...(variantIncomplete ? ["EXACT_LUNA_VARIANT_REQUIRED"] : []),
    ...(bundleRequiresMultiplier ? ["SUPPLIER_QUANTITY_MULTIPLIER_REQUIRED"] : []),
    ...(individualHasMultipleComponents
      ? ["LISTING_TYPE_COMPONENT_COUNT_CONFLICT"] : []),
    ...(bundleHumanDecisionMissing
      ? ["BUNDLE_BOM_HUMAN_APPROVAL_REQUIRED"] : []),
    ...(titleOnly ? ["TITLE_SIMILARITY_NOT_AUTHORITY"] : []),
    ...(approval?.variantPresence === "MISSING"
      ? ["CERTIFIED_LUNA_VARIANT_NO_LONGER_PRESENT"] : []),
    ...(candidateComponentVariantMissing && !approval
      ? ["LUNA_CANDIDATE_VARIANT_NOT_CURRENTLY_PRESENT"] : []),
    ...(status === "UNPROVEN" ? ["LUNA_HUMAN_APPROVED_LINK_REQUIRED"] : []),
    ...(status === "CANDIDATE" ? ["LUNA_HUMAN_APPROVAL_REQUIRED"] : []),
    ...(status === "REJECTED" ? ["LUNA_LINKAGE_CANDIDATE_REJECTED"] : []),
    ...(decision?.status === "KEPT_UNPROVEN"
      ? ["LUNA_LINKAGE_KEPT_UNPROVEN_BY_HUMAN"] : []),
    "P2_I01_LINKAGE_ONLY_STOCK_NOT_CERTIFIED",
  ])
  const evidenceReferences = unique([
    ...input.listing.evidenceReferences,
    ...(input.conflict?.evidenceReferences ?? []),
    ...(approval?.evidenceReferences ?? []),
    ...(topCandidate?.evidenceReferences ?? []),
  ])
  const decisionStatus = approval ? "APPROVED" as const
    : decision?.status ?? "PENDING" as const
  const approvalDecisionReference = approval?.decisionReference ??
    decision?.decisionReference ?? null
  const approvalDecisionAt = approval?.approvedAt ?? decision?.decidedAt ?? null
  const identitySourceUpdatedAt = approval?.sourceUpdatedAt ??
    topCandidate?.sourceUpdatedAt ?? null
  return Object.freeze({
    listingIdentityId,
    linkageId,
    ebayItemId: input.listing.itemId,
    ebaySku: input.listing.sku,
    listingTitle: input.listing.title,
    listingVariantOptions: Object.freeze([] as string[]),
    listingType: input.listing.listingType,
    lunaIdentity: Object.freeze({
      productId: projectedComponents.length > 1
        ? null : identityCandidate?.lunaProductId ?? null,
      variantId: projectedComponents.length > 1
        ? null : identityCandidate?.lunaVariantId ?? null,
      variantSemantics: projectedComponents.length > 1
        ? "MULTI_COMPONENT_BOM" as const
        : identityCandidate
        ? identityCandidate.lunaProductHasVariants === false
          ? "PRODUCT_HAS_NO_VARIANTS" as const
          : "EXACT_VARIANT_REQUIRED" as const
        : "UNPROVEN" as const,
      sku: identityCandidate?.lunaSku ?? null,
      productTitle: identityCandidate?.productTitle ?? null,
      variantTitle: identityCandidate?.variantTitle ?? null,
    }),
    lunaComponents: Object.freeze(projectedComponents.map((component) =>
      Object.freeze({
        componentIdentityId: stableIdentity("luna-component-identity-v1", [
          component.lunaProductId,
          component.lunaVariantId ?? "NO_VARIANT",
          component.lunaSku,
        ]),
        productId: component.lunaProductId,
        variantId: component.lunaVariantId,
        variantSemantics: component.lunaProductHasVariants
          ? "EXACT_VARIANT_REQUIRED" as const
          : "PRODUCT_HAS_NO_VARIANTS" as const,
        sku: component.lunaSku,
        productTitle: component.productTitle,
        variantTitle: component.variantTitle,
        supplierQuantityRequired: component.supplierQuantityRequired,
        variantPresence: component.variantPresence,
        evidenceReferences: component.evidenceReferences,
        matchSignals: Object.freeze({
          exactSupplierSku: component.exactSupplierSku,
          exactVariantAttributes: component.exactVariantAttributes,
          colorMatch: component.colorMatch,
          sizeMatch: component.sizeMatch,
          packCountMatch: component.packCountMatch,
        }),
      }))),
    status,
    confidence: status === "CERTIFIED" ? "HIGH" as const
      : status === "CANDIDATE" ? "HIGH" as const
        : status === "HUMAN_REVIEW" && topCandidate ? "MEDIUM" as const
          : "UNPROVEN" as const,
    evidencePackage: Object.freeze({
      listing: Object.freeze({
        ebayItemId: input.listing.itemId,
        ebaySku: input.listing.sku,
        listingTitle: input.listing.title,
        variantOptions: Object.freeze([] as string[]),
        listingType: input.listing.listingType,
      }),
      luna: Object.freeze({
        productId: projectedComponents.length > 1
          ? null : identityCandidate?.lunaProductId ?? null,
        variantId: projectedComponents.length > 1
          ? null : identityCandidate?.lunaVariantId ?? null,
        sku: projectedComponents.length > 1
          ? null : identityCandidate?.lunaSku ?? null,
        model: topCandidate?.lunaModel ?? null,
        productTitle: identityCandidate?.productTitle ?? null,
        variantTitle: identityCandidate?.variantTitle ?? null,
      }),
      matchSignals: Object.freeze({
        exactSupplierSku: topCandidate?.exactSupplierSku ?? null,
        exactModelNumber: topCandidate?.exactModelNumber ?? null,
        exactVariantAttributes: topCandidate?.exactVariantAttributes ?? null,
        titleSimilarityOnly: topCandidate?.titleSimilarityOnly ?? null,
        colorMatch: topCandidate?.colorMatch ?? null,
        sizeMatch: topCandidate?.sizeMatch ?? null,
        packCountMatch: topCandidate?.packCountMatch ?? null,
      }),
      dimensions: null,
      observedAt: topCandidate?.observedAt ?? input.listing.observedAt,
      sourceUpdatedAt: identitySourceUpdatedAt,
      evidenceReferences,
      reasonCodes,
    }),
    supplierQuantityPerSale: projectedComponents.length === 1
      ? projectedComponents[0].supplierQuantityRequired : null,
    bundleSemantics: Object.freeze({
      mode: !isBundle ? "NOT_APPLICABLE" as const
        : multiComponentBom ? "MULTI_COMPONENT_BOM" as const
          : singleComponentMultiplier
            ? "SINGLE_COMPONENT_MULTIPLIER" as const
            : "UNPROVEN" as const,
      listingPackCount: topCandidate?.listingPackCount ?? null,
      supplierUnitCount: topCandidate?.supplierUnitCount ?? null,
      multiplierStatus: bundleSemanticsComplete
        ? "AVAILABLE" as const : "UNPROVEN" as const,
      inferredFromTitle: false as const,
      componentCount: projectedComponents.length,
      components: Object.freeze(projectedComponents.map((component) =>
        Object.freeze({
          productId: component.lunaProductId,
          variantId: component.lunaVariantId,
          sku: component.lunaSku,
          supplierQuantityRequired: component.supplierQuantityRequired,
        }))),
    }),
    humanReview: Object.freeze({
      contractVersion: "SELLER_OS_HUMAN_REVIEW_GATE_V1" as const,
      required: status !== "CERTIFIED" && status !== "REJECTED",
      reasonCodes,
      evidenceReferences,
      requestedAt: input.observedAt,
      decisionStatus,
      decisionAt: approvalDecisionAt,
      decisionReference: approvalDecisionReference,
      decisionVersion: approval ? "LUNA_WATCHER_APPROVAL_V1"
        : decision?.version ?? null,
      authorityRequired: "HUMAN_APPROVAL_REQUIRED" as const,
      operatorIdentityIncluded: false as const,
    }),
    provenance: Object.freeze({
      contractVersion: "SELLER_OS_EVIDENCE_PROVENANCE_POLICY_V1" as const,
      authorityClass: status === "CERTIFIED"
        ? "DURABLY_PERSISTED_FACT" as const
        : topCandidate ? "DIRECT_OBSERVATION" as const : "UNPROVEN" as const,
      source: approval ? "EBAY_ACTIVE_LISTING_LUNA_APPROVAL_ENVELOPE"
        : topCandidate ? "LUNA_LINKAGE_CANDIDATE_EVIDENCE"
          : "SELLER_OS_CANONICAL_CURRENT_LIVE_COHORT",
      sourceContractVersion: approval
        ? "LUNA_SUPPLIER_STOCK_WATCHER_V1_2026_08_12"
        : SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_VERSION,
      operation: "CERTIFY_EBAY_LISTING_TO_LUNA_VARIANT_IDENTITY",
      accountBinding: "CANONICAL_SELLER_ACCOUNT",
      observedAt: input.observedAt,
      sourceUpdatedAt: identitySourceUpdatedAt ?? input.listing.observedAt,
      evidenceReferences,
      evidenceCompleteness: status === "CERTIFIED" ? "COMPLETE" as const
        : topCandidate || input.conflict ? "PARTIAL" as const : "UNAVAILABLE" as const,
      limitations: reasonCodes,
    }),
    stockCertification: Object.freeze({
      status: "NOT_EVALUATED" as const,
      outOfStock: null,
      safeCapacity: null,
      automaticPauseAllowed: false as const,
      unknownIsZero: false as const,
    }),
  })
}

export function buildSellerOsLunaSupplierLinkageStatusV1(input: Readonly<{
  accountKey: string
  accountAlias: string | null
  accountBindingMatched: boolean
  scope: Readonly<{
    identityStatus: "CERTIFIED" | "PARTIAL" | "UNPROVEN"
    scopeId: string
    observedAt: string | null
    itemIds: readonly string[]
    historicalOrNonliveCount: number
    limitationCodes?: readonly string[]
  }>
  listings: readonly ListingInput[]
  conflicts?: readonly ConflictInput[]
  repositoryEvidence: SellerOsLunaSupplierLinkageRepositoryEvidenceV1
}>) {
  const authoritativeScope = input.scope.identityStatus === "CERTIFIED" &&
    input.accountBindingMatched && Boolean(normalized(input.accountKey, 200))
  if (!authoritativeScope) {
    return createUnavailableSellerOsLunaSupplierLinkageStatusV1(
      [
        "CANONICAL_CURRENT_LIVE_COHORT_UNPROVEN",
        ...(input.scope.limitationCodes ?? []),
      ],
    )
  }
  const listingByItem = new Map(input.listings.map((listing) =>
    [listing.itemId, listing]))
  const conflictsByItem = new Map((input.conflicts ?? []).map((conflict) =>
    [conflict.itemId, conflict]))
  const entries = input.scope.itemIds.slice(0,
    SELLER_OS_LUNA_SUPPLIER_LINKAGE_MAXIMUM_ENTRIES).flatMap((itemId) => {
    const listing = listingByItem.get(itemId)
    if (!listing) return []
    return [projectEntry({
      accountKey: input.accountKey,
      listing,
      conflict: conflictsByItem.get(itemId) ?? null,
      approvals: input.repositoryEvidence.approvalEvidence.filter((row) =>
        row.ebayItemId === itemId),
      candidates: input.repositoryEvidence.candidateEvidence.filter((row) =>
        row.ebayItemId === itemId),
      decisions: (input.repositoryEvidence.decisionEvidence ?? []).filter(
        (row) => row.ebayItemId === itemId),
      observedAt: input.scope.observedAt ?? input.repositoryEvidence.observedAt,
    })]
  })
  const count = (status: SellerOsLunaSupplierLinkageStatusV1) =>
    entries.filter((entry) => entry.status === status).length
  const certifiedCount = count("CERTIFIED")
  const liveCount = input.scope.itemIds.length
  const truncated = liveCount > entries.length || input.repositoryEvidence.truncated
  const status = input.repositoryEvidence.status === "UNAVAILABLE"
    ? "PARTIAL" as const : "AVAILABLE" as const
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_VERSION,
    status,
    observedAt: input.scope.observedAt ?? input.repositoryEvidence.observedAt,
    bounded: true as const,
    maximumEntries: SELLER_OS_LUNA_SUPPLIER_LINKAGE_MAXIMUM_ENTRIES,
    truncated,
    scope: Object.freeze({
      scopeId: input.scope.scopeId,
      scopeType: "CURRENT_LIVE_COHORT_SCOPE" as const,
      identityStatus: input.scope.identityStatus,
      currentLiveListingCount: liveCount,
      historicalOrNonliveEvidenceCount: input.scope.historicalOrNonliveCount,
      historicalOrNonliveIncludedInDenominator: false as const,
      accountAlias: input.accountAlias,
      accountBinding: "MATCHED" as const,
    }),
    counts: Object.freeze({
      currentLive: liveCount,
      certified: certifiedCount,
      candidate: count("CANDIDATE"),
      humanReview: count("HUMAN_REVIEW"),
      unproven: count("UNPROVEN"),
      rejected: count("REJECTED"),
      stale: count("STALE"),
    }),
    coveragePercent: liveCount === 0 ? null
      : Number(((certifiedCount / liveCount) * 100).toFixed(2)),
    relationshipGrain:
      "CANONICAL_EBAY_ACCOUNT_EBAY_ITEM_ID_TO_LUNA_PRODUCT_ID_LUNA_VARIANT_ID" as const,
    candidatePolicy: Object.freeze({
      exactSkuAndExactVariantMayCreateCandidate: true as const,
      titleOnlyMayAutoCertify: false as const,
      ambiguousCandidatesRequireHumanReview: true as const,
      exactVariantRequiredWhenProductHasVariants: true as const,
      structuredBundleMultiplierRequiredForBundles: true as const,
    }),
    persistence: Object.freeze({
      certifiedApprovalStore:
        "SELLER_OS_LUNA_LINKAGE_DECISIONS_V1_WITH_LEGACY_READ_FALLBACK" as const,
      historicalMappingStore: "EBAY_MANUAL_LISTING_LINKS" as const,
      historicalMappingAutoCertifies: false as const,
      durableDecisionContract:
        "SELLER_OS_LUNA_LINKAGE_DECISION_V1" as const,
      durableDecisionSupportsMultiplierAndBom: true as const,
      approvalEnvelopeReadOnlyInThisSurface: true as const,
      writesByThisRead: 0 as const,
    }),
    entries: Object.freeze(entries),
    evidenceCompleteness: entries.every((entry) =>
      entry.status === "CERTIFIED") && !truncated
      ? "COMPLETE" as const : "PARTIAL" as const,
    limitations: Object.freeze(unique([
      ...input.repositoryEvidence.limitationCodes,
      ...(truncated ? ["LUNA_LINKAGE_RESULTS_TRUNCATED"] : []),
      ...(count("UNPROVEN") > 0 ? ["LUNA_HUMAN_APPROVED_LINK_REQUIRED"] : []),
      ...(count("HUMAN_REVIEW") > 0
        ? ["LUNA_LINKAGE_HUMAN_REVIEW_REQUIRED"] : []),
      ...(count("STALE") > 0 ? ["LUNA_CERTIFIED_LINK_STALE"] : []),
      ...(input.scope.historicalOrNonliveCount > 0
        ? ["HISTORICAL_NONLIVE_LINKAGE_EVIDENCE_EXCLUDED"] : []),
      "P2_I01_DOES_NOT_CERTIFY_STOCK_OR_AUTHORIZE_OOS_ACTIONS",
    ], 40)),
    safety: SAFETY,
  })
}

export function buildSellerOsLunaSupplierLinkageStatusFromMonitorV1(
  input: Readonly<{
    monitor: CommercialMonitorGetDto
    accountKey: string
    repositoryEvidence: SellerOsLunaSupplierLinkageRepositoryEvidenceV1
  }>,
) {
  const integrity = resolveCrossModuleLivePortfolioIntegrityV1(input.monitor)
  const listings = currentLiveListingsForMonitorV1(input.monitor)
  return buildSellerOsLunaSupplierLinkageStatusV1({
    accountKey: input.accountKey,
    accountAlias: input.monitor.marketplace.accountAlias,
    accountBindingMatched: input.monitor.liveCertification.account.bindingMatched,
    scope: {
      identityStatus: integrity.canonicalCohort.identityStatus,
      scopeId: integrity.canonicalCohort.scopeId,
      observedAt: integrity.canonicalCohort.observedAt,
      itemIds: integrity.canonicalCohort.itemIds,
      historicalOrNonliveCount: integrity.stockCohort.nonLiveEvidenceRowCount,
      limitationCodes: [
        ...(input.monitor.liveCertification.discovery.gapCodes ?? []),
        ...(input.monitor.liveCertification.account.limitationCode
          ? [input.monitor.liveCertification.account.limitationCode]
          : []),
      ],
    },
    listings: listings.map((listing) => ({
      itemId: listing.identity.itemId,
      sku: listing.identity.sku,
      title: listing.identity.title,
      listingType: listing.composition.listingType,
      observedAt: listing.identity.lastObservedAt,
      evidenceReferences: listing.evidenceReferences.map((reference) =>
        reference.reference),
    })),
    conflicts: integrity.stockCohort.duplicateItemIds.map((conflict) => ({
      itemId: conflict.itemId,
      evidenceReferences: conflict.evidenceRows.map((row) =>
        row.evidenceReference),
      titleRepresentations: conflict.titleRepresentations,
      skuRepresentations: conflict.skuRepresentations,
      identityRepresentationConflict: conflict.identityRepresentationConflict,
    })),
    repositoryEvidence: input.repositoryEvidence,
  })
}

const SAFETY = Object.freeze({
  readOnlySurface: true as const,
  buyerPiiIncluded: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  lunaLoginSecretsIncluded: false as const,
  cookiesIncluded: false as const,
  rawSensitivePayloadIncluded: false as const,
  arbitraryAccountAllowed: false as const,
  arbitrarySupplierUrlAllowed: false as const,
  arbitraryUrlFetchAllowed: false as const,
  arbitrarySqlAllowed: false as const,
  callerTokenAllowed: false as const,
  callerControlledFilePathAllowed: false as const,
  databaseWritesByThisRead: 0 as const,
  marketplaceWritesByThisRead: 0 as const,
  ebayPauseWritesByThisRead: 0 as const,
  ebayReviseWritesByThisRead: 0 as const,
  inventoryWritesByThisRead: 0 as const,
  listingWritesByThisRead: 0 as const,
  lunaLinkMutationsByThisRead: 0 as const,
  lunaMutationsByThisRead: 0 as const,
  whatsappSendsByThisRead: 0 as const,
  buyerMessageSendsByThisRead: 0 as const,
  paymentTransactionsByThisRead: 0 as const,
})

export type SellerOsLunaSupplierLinkageReadV1 =
  | ReturnType<typeof buildSellerOsLunaSupplierLinkageStatusV1>
  | ReturnType<typeof createUnavailableSellerOsLunaSupplierLinkageStatusV1>

export function createUnavailableSellerOsLunaSupplierLinkageStatusV1(
  limitationCode: string | readonly string[] =
    "LUNA_SUPPLIER_LINKAGE_EVIDENCE_UNAVAILABLE",
) {
  const limitationCodes = unique(Array.isArray(limitationCode)
    ? [...limitationCode]
    : [limitationCode])
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_VERSION,
    status: "UNAVAILABLE" as const,
    observedAt: null,
    bounded: true as const,
    maximumEntries: SELLER_OS_LUNA_SUPPLIER_LINKAGE_MAXIMUM_ENTRIES,
    truncated: false as const,
    scope: null,
    counts: Object.freeze({ currentLive: null, certified: null,
      candidate: null, humanReview: null, unproven: null, rejected: null,
      stale: null }),
    coveragePercent: null,
    entries: Object.freeze([]),
    evidenceCompleteness: "UNAVAILABLE" as const,
    limitations: Object.freeze(limitationCodes),
    safety: SAFETY,
  })
}
