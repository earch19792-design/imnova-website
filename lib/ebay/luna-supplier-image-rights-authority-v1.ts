import { createHash } from "node:crypto"

export const LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_VERSION =
  "OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1" as const

export const LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1 = Object.freeze({
  version: LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_VERSION,
  authorityType: "OPERATOR_ATTESTED_SUPPLIER_IMAGE_AUTHORIZATION",
  authorityProvenance: "OPERATOR_ATTESTED",
  supplier: "LUNA_PORTEX / LUNA_MARKETING_LLC",
  supplierKeys: ["lunaportex", "luna-portex"],
  scope: "OFFICIAL_LUNA_PRODUCT_IMAGES_FOR_OPERATOR_MARKETPLACE_LISTINGS",
  status: "AUTHORIZED",
  documentedLicense: false,
  operatorAttested: true,
  inheritedAutomatically: true,
  perProductReconfirmationRequired: false,
  perImageReconfirmationRequired: false,
  authorizationReferenceRequired: false,
})

export type LunaSupplierImageIdentity = Readonly<{
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
}>

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, max = 1_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function exactUrl(value: unknown) {
  const raw = text(value, 2_000)
  if (!raw) return ""
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return ""
    }
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return ""
  }
}

function officialLunaImageHost(value: string) {
  const hostname = new URL(value).hostname.toLowerCase()
  return hostname === "cdn.shopify.com" || hostname === "lunaportex.com" ||
    hostname.endsWith(".lunaportex.com")
}

function exactIdentity(value: LunaSupplierImageIdentity) {
  return Boolean(
    text(value.supplierProductId, 100) &&
    text(value.supplierVariantId, 100) &&
    text(value.supplierSku, 100),
  )
}

export function resolveInheritedLunaSupplierImageRightsV1(input: Readonly<{
  packageCandidateKey: string
  opportunityCandidateKey: string
  opportunityIdentity: LunaSupplierImageIdentity
  catalogIdentity: LunaSupplierImageIdentity
  catalogSourceKey: string
  officialImageUrls: readonly string[]
  sourceUrl: string
}>) {
  const authority = LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1
  if (authority.status !== "AUTHORIZED" || !authority.operatorAttested) {
    throw new Error("LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_INACTIVE")
  }
  if (!text(input.packageCandidateKey, 300) ||
      text(input.packageCandidateKey, 300) !==
        text(input.opportunityCandidateKey, 300)) {
    throw new Error("LUNA_SUPPLIER_IMAGE_PACKAGE_IDENTITY_MISMATCH")
  }
  if (!exactIdentity(input.opportunityIdentity) ||
      !exactIdentity(input.catalogIdentity) ||
      input.opportunityIdentity.supplierProductId !==
        input.catalogIdentity.supplierProductId ||
      input.opportunityIdentity.supplierVariantId !==
        input.catalogIdentity.supplierVariantId ||
      input.opportunityIdentity.supplierSku !==
        input.catalogIdentity.supplierSku) {
    throw new Error("LUNA_SUPPLIER_IMAGE_PRODUCT_IDENTITY_MISMATCH")
  }
  if (!authority.supplierKeys.includes(
    text(input.catalogSourceKey, 100).toLowerCase() as
      typeof authority.supplierKeys[number],
  )) {
    throw new Error("LUNA_SUPPLIER_IMAGE_SOURCE_AUTHORITY_MISMATCH")
  }
  const sourceUrl = exactUrl(input.sourceUrl)
  if (!sourceUrl || !officialLunaImageHost(sourceUrl)) {
    throw new Error("LUNA_SUPPLIER_IMAGE_SOURCE_NOT_OFFICIAL")
  }
  const officialUrls = new Set(input.officialImageUrls.map(exactUrl)
    .filter(Boolean))
  if (!officialUrls.has(sourceUrl)) {
    throw new Error("LUNA_SUPPLIER_IMAGE_EXACT_PRODUCT_SOURCE_MISMATCH")
  }
  const identity = {
    supplierProductId: input.opportunityIdentity.supplierProductId,
    supplierVariantId: input.opportunityIdentity.supplierVariantId,
    supplierSku: input.opportunityIdentity.supplierSku,
  }
  const identityDigest = createHash("sha256").update(JSON.stringify(identity))
    .digest("hex")
  const sourceBindingDigest = createHash("sha256")
    .update(JSON.stringify({ identityDigest, sourceUrl }))
    .digest("hex")
  return {
    rightsBasis: "supplier_authorized" as const,
    authorizationReference:
      "OPERATOR_ATTESTED_LUNA_SUPPLIER_IMAGE_AUTHORIZATION_V1",
    rightsEvidenceConfirmed: true as const,
    imageRights: "PASS_INHERITED" as const,
    sourceClass: "OFFICIAL_LUNA_SOURCE" as const,
    exactProductIdentity: true as const,
    identity,
    identityDigest,
    sourceUrl,
    sourceBindingDigest,
    authority,
  }
}

const ALLOWED_TRANSFORMS = new Set([
  "AUTHORIZED_SOURCE_FRAMED_CONTAIN:PRESERVED_FULL_FRAME",
  "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION:NEAR_NEUTRAL_WHITEN_ONLY",
])

export function evaluateLunaImageAutomaticHappyPathV1(input: Readonly<{
  sourceSha256: string
  outputSha256: string
  transformationVersion: string
  transformation: unknown
  qa: unknown
}>) {
  const transformation = record(input.transformation)
  const qa = record(input.qa)
  const profile = record(qa.sourceVisualProfile)
  const sourceSha256 = text(input.sourceSha256, 64)
  const outputSha256 = text(input.outputSha256, 64)
  const transformClass = `${text(transformation.backgroundMethod, 100)}:${
    text(transformation.sourcePixelsTreatment, 100)}`
  const hashesValid = /^[0-9a-f]{64}$/.test(sourceSha256) &&
    /^[0-9a-f]{64}$/.test(outputSha256) && sourceSha256 !== outputSha256
  const sourceHashPreserved = hashesValid && qa.exactSourceHashRecorded === true
  const onlyAllowedDeterministicTransforms =
    input.transformationVersion === "EBAY_MAIN_IMAGE_SAFE_WHITE_V2" &&
    ALLOWED_TRANSFORMS.has(transformClass) &&
    transformation.generativeAiUsed === false &&
    qa.generativeChangesMade === false
  const outputQualityPass = qa.automaticStatus === "PASSED" &&
    qa.productCoverageVerified === true &&
    qa.outputUnderTwelveMegabytes === true &&
    Number(qa.outputWidth) === 1_600 && Number(qa.outputHeight) === 1_600 &&
    Number(qa.outputEdgeWhiteRatio) >= .9
  const fullFrameEquivalent =
    transformation.sourcePixelsTreatment === "PRESERVED_FULL_FRAME" &&
    qa.fullAuthorizedFramePreserved === true
  const boundedBackgroundNormalizationEquivalent =
    transformation.sourcePixelsTreatment === "NEAR_NEUTRAL_WHITEN_ONLY" &&
    transformation.backgroundMethod ===
      "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION" &&
    profile.productToneRisk === "STANDARD" &&
    Number(qa.sourceCenterChromaticRatio) > .08
  const materialProductEquivalencePass = fullFrameEquivalent ||
    boundedBackgroundNormalizationEquivalent
  const passed = sourceHashPreserved && onlyAllowedDeterministicTransforms &&
    outputQualityPass && materialProductEquivalencePass
  const blockers = [
    ...(!sourceHashPreserved ? ["SOURCE_HASH_NOT_PRESERVED"] : []),
    ...(!onlyAllowedDeterministicTransforms
      ? ["TRANSFORM_NOT_AUTOMATICALLY_ALLOWED"] : []),
    ...(!outputQualityPass ? ["OUTPUT_QUALITY_NOT_PASSED"] : []),
    ...(!materialProductEquivalencePass
      ? ["MATERIAL_PRODUCT_EQUIVALENCE_NOT_PROVEN"] : []),
  ]
  return {
    passed,
    imageOptimization: passed ? "AUTO_PASS" as const : "EXCLUDED" as const,
    imageReadiness: passed
      ? "IMAGE_READY_AUTO_PASS" as const
      : "IMAGE_NOT_READY" as const,
    sourceHashPreserved,
    onlyAllowedDeterministicTransforms,
    outputQualityPass,
    materialProductEquivalencePass,
    humanImageActionRequired: !passed,
    blockers,
  }
}

export function automaticLunaImageQaResultV1(input: Readonly<{
  qa: unknown
  rights: ReturnType<typeof resolveInheritedLunaSupplierImageRightsV1>
  automatic: ReturnType<typeof evaluateLunaImageAutomaticHappyPathV1>
}>) {
  if (!input.automatic.passed) {
    throw new Error("LUNA_IMAGE_AUTOMATIC_HAPPY_PATH_NOT_PASSED")
  }
  return {
    ...record(input.qa),
    humanApprovalRequired: false,
    manualChecksRequired: [],
    approvalMode: "AUTOMATIC_DETERMINISTIC",
    imageReadiness: "IMAGE_READY_AUTO_PASS",
    outputQualityPassed: true,
    materialProductEquivalencePassed: true,
    sourceHashPreserved: true,
    onlyAllowedDeterministicTransforms: true,
    rightsAuthority: {
      version: input.rights.authority.version,
      authorityType: input.rights.authority.authorityType,
      authorityProvenance: input.rights.authority.authorityProvenance,
      documentedLicense: input.rights.authority.documentedLicense,
      operatorAttested: input.rights.authority.operatorAttested,
      supplier: input.rights.authority.supplier,
      scope: input.rights.authority.scope,
      sourceBindingDigest: input.rights.sourceBindingDigest,
      identityDigest: input.rights.identityDigest,
    },
  }
}
