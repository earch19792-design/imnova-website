import { createHash } from "node:crypto"

type JsonRecord = Record<string, unknown>

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : ""
const sha256 = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")

export const CURRENT_PREPUBLICATION_ARTIFACT_AUTHORITY_V1 =
  "SELLER_OS_CURRENT_PREPUBLICATION_ARTIFACT_AUTHORITY_V1" as const
// Durable fail-closed hold requested for the selected physical greenfield.
// It releases automatically only when CURRENT runtime evidence records PROVEN.
export const CURRENT_MARKET_PRICE_PROOF_REQUIRED_SKUS_V1 = Object.freeze([
  "FL-NH4771198",
])

export type CurrentPrepublicationArtifactAuthorityV1 = Readonly<{
  version: typeof CURRENT_PREPUBLICATION_ARTIFACT_AUTHORITY_V1
  accountKey: string
  packageId: string
  opportunityId: string
  candidateKey: string
  actorUserId: string
  productId: string
  variantId: string
  supplierSku: string
  productTruthDigest: string
  packageGeneration: string
  bindingDigest: string
  permittedOperations: readonly [
    "createOrReplaceInventoryItem", "createOffer"
  ]
  publicationCommitAllowed: false
  publicMarketplaceExposureAllowed: false
  adsAllowed: false
  blindRetryAllowed: false
  ownerRoutineApprovalRequired: false
  codexRuntimeDependency: false
}>

function conditionCode(value: unknown) {
  const normalized = text(value).toUpperCase()
  if (["NEW", "NEW_OTHER", "NEW_WITH_DEFECTS", "USED_EXCELLENT",
    "USED_GOOD", "USED_ACCEPTABLE"].includes(normalized)) return normalized
  const byId: Record<string, string> = {
    "1000": "NEW", "1500": "NEW_OTHER", "1750": "NEW_WITH_DEFECTS",
    "2000": "USED_EXCELLENT", "3000": "USED_GOOD",
    "4000": "USED_ACCEPTABLE",
  }
  return byId[normalized] ?? ""
}

function explicitMarketPriceSupport(packageData: JsonRecord,
  assessment: JsonRecord) {
  const values: string[] = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    for (const [key, nested] of Object.entries(value as JsonRecord)) {
      if (key === "marketPriceSupport" && text(nested)) {
        values.push(text(nested))
      } else visit(nested)
    }
  }
  visit(packageData)
  visit(assessment)
  return values
}

export function evaluateCurrentPrepublicationArtifactPolicyV1(input: Readonly<{
  listingPackage: unknown
  opportunity: unknown
  accountProfile: unknown
  accountKey: string
  now?: Date
}>) {
  const listingPackage = record(input.listingPackage)
  const packageData = record(listingPackage.package_data)
  const opportunity = record(input.opportunity)
  const assessment = record(opportunity.assessment)
  const canonical = record(assessment.canonicalMarketplaceReadinessV1)
  const marker = record(packageData.currentPublicationFactoryV1)
  const exposure = record(packageData.packageExposurePolicyV1)
  const exposureBinding = record(exposure.binding)
  const condition = record(packageData.conditionAuthority)
  const profile = record(input.accountProfile)
  const pricing = record(packageData.pricing)
  const now = input.now ?? new Date()
  const blockers: string[] = []
  const packageId = text(listingPackage.id)
  const opportunityId = text(listingPackage.opportunity_id)
  const candidateKey = text(listingPackage.candidate_key)
  const actorUserId = text(listingPackage.created_by)
    || text(profile.selected_by)
  const productId = text(opportunity.supplier_product_id)
  const variantId = text(opportunity.supplier_variant_id)
  const supplierSku = text(opportunity.supplier_sku)
  const productTruthDigest = text(record(assessment.productTruth)
    .evidenceDigest)
  const packageGeneration = text(marker.generation)

  if (marker.version !== "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1"
      || marker.authorityPolicy !== "CURRENT_ONLY"
      || marker.reuseLegacyPreparation !== false
      || marker.packageId !== packageId
      || marker.accountKey !== input.accountKey
      || marker.productId !== productId
      || marker.variantId !== variantId
      || marker.supplierSku !== supplierSku
      || !packageGeneration) blockers.push("CURRENT_FACTORY_BINDING_REQUIRED")
  if (listingPackage.account_key !== input.accountKey
      || opportunity.id !== opportunityId
      || opportunity.candidate_key !== candidateKey
      || !actorUserId) blockers.push("CURRENT_EXACT_PACKAGE_IDENTITY_REQUIRED")
  if (!/^sha256:[a-f0-9]{64}$/.test(productTruthDigest)
      || canonical.productTruthDigest !== productTruthDigest
      || canonical.ready !== true
      || canonical.listingPolicyReady !== true
      || canonical.requiredItemSpecificsReady !== true) {
    blockers.push("CURRENT_PRODUCT_TRUTH_AND_LISTING_AUTHORITY_REQUIRED")
  }
  if (exposure.version !== "SELLER_OS_PACKAGE_LISTING_EXPOSURE_V1"
      || exposure.sourcePolicy !==
        "SELLER_OS_CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1"
      || exposure.status !== "ACTIVE"
      || exposure.quantity !== 1
      || exposure.supplierQuantityInferred !== false
      || exposure.publicationAuthorized !== false
      || exposureBinding.accountKey !== input.accountKey
      || exposureBinding.packageId !== packageId
      || exposureBinding.productId !== productId
      || exposureBinding.variantId !== variantId
      || exposureBinding.sku !== supplierSku
      || exposureBinding.productTruthDigest !== productTruthDigest) {
    blockers.push("CURRENT_ROUTINE_EXPOSURE_AUTHORITY_REQUIRED")
  }
  const resolvedCondition = conditionCode(
    condition.conditionCode ?? packageData.conditionId)
  if (!resolvedCondition || condition.factInvented !== false
      || condition.lunaProductId !== productId
      || condition.lunaVariantId !== variantId
      || condition.supplierSku !== supplierSku
      || String(condition.categoryId ?? "") !==
        String(packageData.categoryId ?? "")) {
    blockers.push("CURRENT_CONDITION_AUTHORITY_REQUIRED")
  }
  const aspects = record(packageData.aspects)
  if (!text(packageData.categoryId)
      || !["Brand", "Style", "Type"].every((key) => text(aspects[key]))) {
    blockers.push("CURRENT_CATEGORY_AND_REQUIRED_SPECIFICS_REQUIRED")
  }
  if (!(typeof pricing.targetPrice === "number"
      && Number.isFinite(pricing.targetPrice) && pricing.targetPrice > 0
      && pricing.currency === "USD")) {
    blockers.push("CURRENT_PRICE_AUTHORITY_REQUIRED")
  }
  const marketPriceSupport = explicitMarketPriceSupport(
    packageData, assessment)
  const currentMarketPriceProofRequired =
    CURRENT_MARKET_PRICE_PROOF_REQUIRED_SKUS_V1.includes(supplierSku)
  const sameLinkReentry = Array.isArray(marker.historicalReferences)
    && marker.historicalReferences.some((entry) =>
      record(entry).use === "AUDIT_LINEAGE_DEDUP_ONLY")
  if ((currentMarketPriceProofRequired
      && !marketPriceSupport.includes("PROVEN"))
      || (!sameLinkReentry
      && marketPriceSupport.some((support) => support.includes("UNPROVEN")))) {
    blockers.push("MARKET_PRICE_SUPPORT_NOT_PROVEN")
  }
  const policyValues = [profile.fulfillment_policy_id,
    profile.payment_policy_id, profile.return_policy_id,
    profile.merchant_location_key].map(text)
  if (profile.account_key !== input.accountKey
      || profile.marketplace_id !== "EBAY_US"
      || policyValues.some((value) => !value)
      || !Number.isFinite(Date.parse(text(profile.verified_at)))
      || Date.parse(text(profile.expires_at)) <= now.getTime()) {
    blockers.push("CURRENT_ACCOUNT_POLICY_AUTHORITY_REQUIRED")
  }
  const uniqueBlockers = [...new Set(blockers)]
  if (uniqueBlockers.length) return Object.freeze({
    pass: false as const, blockers: uniqueBlockers,
    publicationCommitAllowed: false as const,
    publicMarketplaceExposureAllowed: false as const,
    codexRuntimeDependency: false as const,
  })

  const bindingBase = { accountKey: input.accountKey, packageId,
    opportunityId, candidateKey, actorUserId, productId, variantId,
    supplierSku, productTruthDigest, packageGeneration }
  const permittedOperations: readonly [
    "createOrReplaceInventoryItem", "createOffer"
  ] = ["createOrReplaceInventoryItem", "createOffer"]
  const authority: CurrentPrepublicationArtifactAuthorityV1 = Object.freeze({
    version: CURRENT_PREPUBLICATION_ARTIFACT_AUTHORITY_V1,
    ...bindingBase,
    bindingDigest: `sha256:${sha256(bindingBase)}`,
    permittedOperations,
    publicationCommitAllowed: false,
    publicMarketplaceExposureAllowed: false,
    adsAllowed: false,
    blindRetryAllowed: false,
    ownerRoutineApprovalRequired: false,
    codexRuntimeDependency: false,
  })
  return Object.freeze({ pass: true as const, blockers: [], authority,
    actorBindingRequired: !text(listingPackage.created_by),
    draftConfiguration: Object.freeze({ quantity: 1,
      condition: resolvedCondition,
      merchantLocationKey: policyValues[3],
      businessPolicies: Object.freeze({ fulfillmentPolicyId: policyValues[0],
        paymentPolicyId: policyValues[1], returnPolicyId: policyValues[2] }),
      imageAuthorization: Object.freeze({ rightsBasis: "supplier_authorized",
        source: "luna" }),
    }),
    publicationCommitAllowed: false as const,
    publicMarketplaceExposureAllowed: false as const,
    codexRuntimeDependency: false as const,
  })
}

export function bindCurrentPrepublicationArtifactAuthorityV1(
  payload: unknown,
  authority: CurrentPrepublicationArtifactAuthorityV1,
) {
  const value = record(payload)
  return { ...value, compliance: { ...record(value.compliance),
    currentPrepublicationArtifactAuthorityV1: authority } }
}

export function readCurrentPrepublicationArtifactAuthorityV1(
  payload: unknown,
) {
  const authority = record(record(payload).compliance)
    .currentPrepublicationArtifactAuthorityV1
  const value = record(authority)
  const base = { accountKey: text(value.accountKey),
    packageId: text(value.packageId), opportunityId: text(value.opportunityId),
    candidateKey: text(value.candidateKey), actorUserId: text(value.actorUserId),
    productId: text(value.productId), variantId: text(value.variantId),
    supplierSku: text(value.supplierSku),
    productTruthDigest: text(value.productTruthDigest),
    packageGeneration: text(value.packageGeneration) }
  const valid = value.version === CURRENT_PREPUBLICATION_ARTIFACT_AUTHORITY_V1
    && value.bindingDigest === `sha256:${sha256(base)}`
    && JSON.stringify(value.permittedOperations) === JSON.stringify(
      ["createOrReplaceInventoryItem", "createOffer"])
    && value.publicationCommitAllowed === false
    && value.publicMarketplaceExposureAllowed === false
    && value.adsAllowed === false && value.blindRetryAllowed === false
    && value.ownerRoutineApprovalRequired === false
    && value.codexRuntimeDependency === false
    && Object.values(base).every(Boolean)
  return valid ? value as CurrentPrepublicationArtifactAuthorityV1 : null
}
