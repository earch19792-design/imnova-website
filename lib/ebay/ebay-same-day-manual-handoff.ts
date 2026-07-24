import { createHash } from "node:crypto"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { ebayConditionContractFromVerifiedFact } from "./ebay-manual-listing-domain.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { normalizeEbayCompliantFulfillmentBasis } from "./ebay-fulfillment-policy-compliance.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { parseAuthoritativeFactsInputPackage } from "./ebay-product-facts-readiness.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { buildVerifiedEbayTitle } from "./ebay-verified-title-strategy.ts"

export const SAME_DAY_MANUAL_HANDOFF_VERSION = "SELLER_HUB_FACTS_ONLY_V10_2026_07_24"

type JsonRecord = Record<string, unknown>
type SafeFact = { scope: string; key: string; value: unknown; unit: string | null; status: string }
type SafeRequirement = {
  aspectName: string
  required: boolean
  mappedFactKey: string | null
  status: string
  selectedValue: string | null
  allowedValues: string[]
  selectionOnly: boolean
  allowedValuesComplete: boolean
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}
function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum) : ""
}
function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]))
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}
export function hashSameDayManualHandoffPackage(value: unknown) {
  return hash(value)
}
function unique(values: string[]) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))]
}
function aspectValueKey(value: unknown) {
  return text(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "")
}
function validImageUrl(value: unknown) {
  try {
    const url = new URL(text(value, 2_000))
    return url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

export function bindCurrentAuthoritativeFactsForManualHandoff(input: {
  factsSummary: unknown
  boundFacts: { factRunId: string; package: unknown } | null
}) {
  const summary = record(input.factsSummary)
  const boundPackage = parseAuthoritativeFactsInputPackage(input.boundFacts?.package)
  if (!input.boundFacts || !boundPackage ||
    text(summary.factRunId) !== text(input.boundFacts.factRunId)) {
    throw new Error("SAME_DAY_PILOT_AUTHORITATIVE_FACT_PACKAGE_STALE")
  }
  return {
    ...summary,
    authoritativeFactsPackage: boundPackage,
    factRunId: input.boundFacts.factRunId,
    currentRunBound: true,
  }
}
export function buildVerifiedManualSellerHubHandoff(input: {
  candidateId: string
  factRunId: string
  productTitle: string
  supplierSku: string
  listingQuantity: number
  salePrice: number
  fulfillmentBasis: unknown
  economics: JsonRecord
  factsSummary: JsonRecord
  lunaImageUrls: string[]
  policies: {
    categoryId: string | null
    conditionId: string | null
    fulfillmentPolicyId: string | null
    paymentPolicyId: string | null
    returnPolicyId: string | null
    verifiedSourceAt: string | null
  }
  generatedAt: string
}) {
  const gates = record(input.factsSummary.gates)
  const authoritativeFactsPackage = parseAuthoritativeFactsInputPackage(
    input.factsSummary.authoritativeFactsPackage,
  )
  const facts = authoritativeFactsPackage?.facts.map((fact): SafeFact => ({
    scope: fact.scope, key: fact.key, value: fact.value, unit: fact.unit,
    status: fact.verificationStatus,
  })) ?? []
  const requirements = Array.isArray(input.factsSummary.resolvedRequirements)
    ? input.factsSummary.resolvedRequirements.map(record).map((requirement): SafeRequirement => ({
      aspectName: text(requirement.aspectName), required: requirement.required === true,
      mappedFactKey: text(requirement.mappedFactKey) || null,
      status: text(requirement.status), selectedValue: text(requirement.selectedValue) || null,
      allowedValues: Array.isArray(requirement.allowedValues)
        ? requirement.allowedValues.map((value) => text(value)).filter(Boolean)
        : [],
      selectionOnly: requirement.selectionOnly === true,
      allowedValuesComplete: requirement.allowedValuesComplete === true,
    }))
    : []
  const taxonomy = record(input.factsSummary.taxonomy)
  const categoryId = text(input.policies.categoryId || taxonomy.categoryId)
  const fulfillmentBasis = normalizeEbayCompliantFulfillmentBasis(
    input.fulfillmentBasis,
  )
  const lunaConfirmation = record(input.economics.lunaConfirmation)
  const images = unique(input.lunaImageUrls.map(validImageUrl).filter((value): value is string => Boolean(value))).slice(0, 24)
  const trusted = new Set(["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"])
  const fact = (scope: string, key: string) => facts.find((entry) => entry.scope === scope && entry.key === key && trusted.has(entry.status))
  const blockers: string[] = []
  if (input.factsSummary.currentRunBound !== true || text(input.factsSummary.factRunId) !== text(input.factRunId)) blockers.push("CURRENT_FACT_RUN_REQUIRED")
  if (!authoritativeFactsPackage) blockers.push("AUTHORITATIVE_FACT_PACKAGE_REQUIRED")
  if (gates.OPENAI_INPUT_READY !== true) blockers.push("VERIFIED_CONTENT_FACTS_NOT_READY")
  if (!/^\d+$/.test(categoryId)) blockers.push("CATEGORY_REQUIRED")
  if (!text(input.policies.conditionId)) blockers.push("CONDITION_REQUIRED")
  if (![input.policies.fulfillmentPolicyId, input.policies.paymentPolicyId, input.policies.returnPolicyId].every((value) => text(value))) blockers.push("VERIFIED_BUSINESS_POLICIES_REQUIRED")
  if (!images.length) blockers.push("AUTHORIZED_LUNA_IMAGE_REQUIRED")
  if (!(input.listingQuantity >= 1)) blockers.push("LISTING_QUANTITY_REQUIRED")
  if (!(input.salePrice > 0) || input.economics.operatorPriceApproved !== true || input.economics.passesProfitGate !== true) blockers.push("OPERATOR_PRICE_AND_ECONOMICS_REQUIRED")
  if (!fulfillmentBasis) blockers.push("COMPLIANT_FULFILLMENT_BASIS_REQUIRED")
  if (!["AVAILABLE_QUANTITY_NOT_SHOWN", "AVAILABLE_EXACT_QUANTITY"].includes(text(lunaConfirmation.status)) ||
    text(lunaConfirmation.source) !== "OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE" ||
    !Number.isFinite(Date.parse(text(lunaConfirmation.confirmedAt)))) {
    blockers.push("OPERATOR_LUNA_CONFIRMATION_REQUIRED")
  }
  const shippingKeys = ["shippingWeight", "shippingLength", "shippingWidth", "shippingHeight"]
  const confirmedShipping = shippingKeys.every((key) => fact("SHIPPING_PACKAGE", key))
  const conservativeShippingReserve = number(record(input.economics.config).estimatedOutboundShipping)
  const conservativeShippingReserveReady = conservativeShippingReserve !== null &&
    conservativeShippingReserve > 0
  if (!confirmedShipping && gates.SHIPPING_ESTIMATE_READY !== true &&
    !conservativeShippingReserveReady) blockers.push("SHIPPING_ESTIMATE_REQUIRED")
  for (const requirement of requirements) {
    const authoritativeFact = requirement.mappedFactKey
      ? fact("PRODUCT_UNIT", requirement.mappedFactKey) ?? fact("OFFER_PACK", requirement.mappedFactKey)
      : null
    const authoritativeValue = text(authoritativeFact?.value)
    const selectedValueAuthorized = Boolean(requirement.selectedValue && authoritativeValue &&
      aspectValueKey(authoritativeValue) === aspectValueKey(requirement.selectedValue))
    if (requirement.required && !["SATISFIED_VERIFIED", "SATISFIED_CORROBORATED", "NOT_APPLICABLE"].includes(requirement.status)) {
      blockers.push(`REQUIRED_ASPECT_${text(requirement.aspectName).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`)
    }
    if (requirement.required && requirement.selectedValue && !selectedValueAuthorized) {
      blockers.push(`REQUIRED_ASPECT_AUTHORITY_${text(requirement.aspectName).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`)
    }
    if (requirement.selectedValue && requirement.selectionOnly &&
      requirement.allowedValuesComplete && requirement.allowedValues.length &&
      !requirement.allowedValues.some((value) => aspectValueKey(value) === aspectValueKey(requirement.selectedValue))) {
      blockers.push(`ASPECT_VALUE_NOT_ALLOWED_${text(requirement.aspectName).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`)
    }
  }
  const exactName = text(fact("PRODUCT_UNIT", "exactProductName")?.value || input.productTitle)
  const brand = text(fact("PRODUCT_UNIT", "brand")?.value)
  const condition = text(fact("PRODUCT_UNIT", "condition")?.value)
  const conditionContract = ebayConditionContractFromVerifiedFact(condition)
  const selectedConditionId = text(input.policies.conditionId)
  if (!conditionContract) blockers.push("VERIFIED_CONDITION_ID_MAPPING_REQUIRED")
  if (conditionContract && selectedConditionId !== conditionContract.conditionId) blockers.push("CONDITION_ID_FACT_MISMATCH")
  if (!exactName || !condition) blockers.push("CORE_PRODUCT_FACTS_REQUIRED")
  const dedupedBlockers = unique(blockers)
  if (dedupedBlockers.length) {
    return { ready: false as const, blockers: dedupedBlockers, package: null, packageHash: null,
      safety: { openAiCalls: 0, ebayWrites: 0, competitorContentUsed: false, productionChanged: false } }
  }

  const aspects: Record<string, string[]> = {}
  for (const requirement of requirements) {
    const authoritativeFact = requirement.mappedFactKey
      ? fact("PRODUCT_UNIT", requirement.mappedFactKey) ?? fact("OFFER_PACK", requirement.mappedFactKey)
      : null
    const authoritativeValue = text(authoritativeFact?.value)
    if (requirement.selectedValue && authoritativeValue &&
      aspectValueKey(authoritativeValue) === aspectValueKey(requirement.selectedValue) &&
      ["SATISFIED_VERIFIED", "SATISFIED_CORROBORATED"].includes(requirement.status)) {
      aspects[requirement.aspectName] = [requirement.selectedValue]
    }
  }
  const addAspect = (name: string, key: string) => {
    const value = text(fact("PRODUCT_UNIT", key)?.value)
    if (value && !aspects[name]) aspects[name] = [value]
  }
  addAspect("Brand", "brand")
  addAspect("MPN", "mpn")
  addAspect("UPC", "upc")
  addAspect("Model", "model")
  const totalUnitFact = fact("OFFER_PACK", "totalUnitCount") ??
    fact("PRODUCT_UNIT", "unitCount")
  const totalUnitCount = number(totalUnitFact?.value)
  const wholeUnitCount = totalUnitCount !== null &&
    Number.isInteger(totalUnitCount) && totalUnitCount >= 1
    ? totalUnitCount
    : null
  const unitQuantityRequirement = requirements.find((requirement) =>
    requirement.aspectName.toLocaleLowerCase("en-US") === "unit quantity")
  if (wholeUnitCount && unitQuantityRequirement &&
    (!unitQuantityRequirement.selectionOnly ||
      !unitQuantityRequirement.allowedValuesComplete ||
      !unitQuantityRequirement.allowedValues.length ||
      unitQuantityRequirement.allowedValues.some((value) =>
        aspectValueKey(value) === aspectValueKey(String(wholeUnitCount))))) {
    aspects[unitQuantityRequirement.aspectName] = [String(wholeUnitCount)]
  }
  const unitTypeRequirement = requirements.find((requirement) =>
    requirement.aspectName.toLocaleLowerCase("en-US") === "unit type")
  const countBasedUnit = text(totalUnitFact?.unit)
    .toLocaleLowerCase("en-US") === "count"
  if (wholeUnitCount && countBasedUnit && unitTypeRequirement &&
    (!unitTypeRequirement.selectionOnly ||
      !unitTypeRequirement.allowedValuesComplete ||
      unitTypeRequirement.allowedValues.some((value) =>
        aspectValueKey(value) === aspectValueKey("Unit")))) {
    aspects[unitTypeRequirement.aspectName] = ["Unit"]
  }
  const title = buildVerifiedEbayTitle({
    productTitle: exactName || input.productTitle,
    brand,
    productType: text(fact("PRODUCT_UNIT", "type")?.value || fact("PRODUCT_UNIT", "productType")?.value),
    packCount: number(fact("OFFER_PACK", "totalUnitCount")?.value),
    color: text(fact("PRODUCT_UNIT", "color")?.value),
    audience: text(fact("PRODUCT_UNIT", "audience")?.value || fact("PRODUCT_UNIT", "department")?.value),
    relationship: text(fact("PRODUCT_UNIT", "relationship")?.value),
  })
  const includedCount = wholeUnitCount ? String(wholeUnitCount) : ""
  const descriptionLines = [
    exactName,
    "Product details",
    brand ? `- Brand: ${brand}` : "",
    `- Condition: ${condition}`,
    includedCount
      ? `- Package quantity: ${includedCount} ${wholeUnitCount === 1 ? "unit" : "units"}`
      : "",
    "",
    "Package contents",
    includedCount
      ? `- ${includedCount} ${wholeUnitCount === 1 ? "unit" : "units"} of the exact product named above`
      : "- The exact product and presentation shown in the approved photos",
    "",
    "Please review the approved photos and item specifics before ordering to confirm that the exact product, variant, and package quantity meet your needs.",
    "Only the item and quantity described in this listing are included.",
  ].filter(Boolean)
  const shipping = confirmedShipping
    ? { status: "CONFIRMED", values: Object.fromEntries(shippingKeys.map((key) => {
      const entry = fact("SHIPPING_PACKAGE", key)!
      return [key, { value: entry.value, unit: entry.unit, verificationStatus: entry.status }]
    })), operatorConfirmationRequired: false, estimatedValuesExcluded: true }
    : { status: "ESTIMATE_ONLY_NOT_FOR_LISTING", values: {}, operatorConfirmationRequired: true,
      estimatedValuesExcluded: true,
      conservativeEconomicReserveUsd: conservativeShippingReserveReady
        ? conservativeShippingReserve : null,
      operatorAction: "Confirma peso y dimensiones en Seller OS o utiliza una política de envío verificada que no los requiera." }
  const feePolicy = record(input.economics.feePolicy)
  const controlledRiskOverride = record(input.economics.controlledRiskOverride)
  const controlledRisk = controlledRiskOverride.authorized === true
  const exactEbayFeeProfile = feePolicy.exactFeeClaimed === true
  const warnings = [
    ...(!confirmedShipping ? ["SHIPPING_CONFIRMATION_REQUIRED_IN_SELLER_OS"] : []),
    ...(!exactEbayFeeProfile ? ["EBAY_FEE_PROFILE_ESTIMATE_NOT_EXACT"] : []),
    ...(controlledRisk ? [
      "CONTROLLED_RISK_MANUAL_EXCEPTION",
      "PROMOTION_MUST_REMAIN_DISABLED",
      "VOLUNTARY_RETURNS_NOT_ACCEPTED_WHERE_EBAY_ALLOWS",
      "EBAY_MONEY_BACK_GUARANTEE_STILL_APPLIES",
    ] : []),
    ...requirements.filter((requirement) => !requirement.required &&
      requirement.status === "MISSING_OPTIONAL" &&
      !aspects[requirement.aspectName]?.length)
      .map((requirement) => `OPTIONAL_ASPECT_MISSING_${text(requirement.aspectName).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`),
  ]
  const listingPackage = {
    version: SAME_DAY_MANUAL_HANDOFF_VERSION,
    candidateId: input.candidateId,
    factRunId: input.factRunId,
    title,
    categoryId,
    conditionId: conditionContract!.conditionId,
    conditionLabel: conditionContract!.canonicalLabel,
    itemSpecifics: aspects,
    description: descriptionLines.join("\n\n"),
    price: Number(input.salePrice.toFixed(2)),
    quantity: input.listingQuantity,
    customLabel: text(input.supplierSku, 50),
    fulfillmentCompliance: {
      basis: fulfillmentBasis!,
      operatorAttested: true,
      documentsStored: false,
      piiStored: false,
      sellerArbitrageAllowed: false,
    },
    supplierConfirmation: {
      source: "OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE",
      status: text(lunaConfirmation.status),
      confirmedAt: text(lunaConfirmation.confirmedAt),
      quantityVisible: lunaConfirmation.quantityVisible === true,
      confirmedQuantity: lunaConfirmation.quantityVisible === true ? number(lunaConfirmation.confirmedQuantity) : null,
      recheckAfterSale: lunaConfirmation.recheckAfterSale === true,
      ebayConfirmedSupplierStock: false,
      actorIdentifierStored: false,
      piiStored: false,
    },
    images: { urls: images, count: images.length, source: "LUNA_AUTHORIZED_CATALOG", competitorImages: 0 },
    shipping,
    publicationReadiness: confirmedShipping ? "READY_WITH_CONFIRMED_SHIPPING" : "READY_FOR_MANUAL_SHIPPING_CONFIRMATION",
    qualityWarnings: warnings,
    businessPolicies: {
      fulfillmentPolicyId: text(input.policies.fulfillmentPolicyId),
      paymentPolicyId: text(input.policies.paymentPolicyId),
      returnPolicyId: text(input.policies.returnPolicyId),
      verifiedSourceAt: text(input.policies.verifiedSourceAt),
    },
    controlledRiskPolicy: controlledRisk ? {
      version: text(controlledRiskOverride.version),
      minimumNetMarginPercent: number(controlledRiskOverride.minimumNetMarginPercent),
      promotion: "DO_NOT_PROMOTE",
      voluntaryReturns: "SELECT_NO_RETURNS_WHERE_EBAY_ALLOWS",
      ebayMoneyBackGuaranteeStillApplies: true,
      automaticPricingUsed: false,
      manualPublicationOnly: false,
      finalHumanAuthorizationRequired: true,
      sellerOsPublicationAfterAuthorization: true,
      unattendedPublicationAllowed: false,
    } : null,
    operatorChecklist: [
      "Confirmar que el producto y pack físicos coinciden con este paquete.",
      fulfillmentBasis === "OWNED_INVENTORY"
        ? "Confirmar que el inventario ya es propio antes de publicar."
        : "Confirmar que permanece vigente el acuerdo de fulfillment con el proveedor mayorista autorizado.",
      ...(!confirmedShipping ? ["Confirmar peso/dimensiones o seleccionar una política de envío verificada compatible en Seller OS."] : []),
      ...(!exactEbayFeeProfile ? ["Revisar en Seller OS la tarifa estimada según categoría y plan de tienda antes de autorizar; la reserva económica es conservadora."] : []),
      ...(controlledRisk ? [
        "No activar Promoted Listings ni publicidad para esta prueba de margen reducido.",
        "Seleccionar una política sin devoluciones voluntarias sólo donde eBay y la categoría lo permitan; la Garantía al cliente de eBay continúa aplicando.",
        "Confirmar que el precio sigue dentro de la ventana autorizada antes de publicar.",
      ] : []),
      "Usar únicamente las imágenes Luna incluidas y aprobadas.",
      "Revisar título, categoría, specifics, precio, cantidad, Custom Label, envío y políticas en Seller OS.",
      "Autorizar primero el Offer UNPUBLISHED y después el preview final exacto.",
      "Seller OS publicará una sola vez, verificará ACTIVE, guardará el Item ID y activará el monitoreo.",
    ],
    generatedAt: input.generatedAt,
    safety: { factsOnly: true, openAiCalls: 0, ebayWrites: 0, competitorContentUsed: false,
      automaticPricingUsed: false, operatorPriceApproved: true, productionChanged: false,
      controlledRiskManualException: controlledRisk,
      promotedListingsAllowed: controlledRisk ? false : null,
      authoritativeFactPackageHash: authoritativeFactsPackage!.factPackageHash },
  }
  const packageHash = hash(listingPackage)
  return { ready: true as const, blockers: [], warnings, package: listingPackage, packageHash,
    safety: listingPackage.safety }
}
