import { createHash } from "node:crypto"

export const MAYEL_VISUAL_WORKSTATION_VERSION =
  "MAYEL_CHATGPT_SUBSCRIPTION_VISUAL_WORKSTATION_PHASE_A_V1"
export const MAYEL_PRODUCT_EVIDENCE_PACK_VERSION =
  "MAYEL_PRODUCT_EVIDENCE_PACK_V1"
export const MAYEL_CHATGPT_VISUAL_PROMPT_VERSION =
  "MAYEL_CHATGPT_VISUAL_PROMPT_V1"
export const MAYEL_VISUAL_MANIFEST_VERSION = "MAYEL_VISUAL_MANIFEST_V1"

export const MAYEL_VISUAL_OUTPUT_ROLES = Object.freeze([
  "DETAIL",
  "PACKAGE_CONTENTS",
  "DIMENSIONS",
  "PRIMARY_BENEFIT",
  "LIFESTYLE",
  "HUMAN_USE",
] as const)

export type MayelVisualOutputRole =
  typeof MAYEL_VISUAL_OUTPUT_ROLES[number]

export const MAYEL_VISUAL_REJECTION_REASONS = Object.freeze([
  "IDENTITY_DRIFT",
  "INCORRECT_COLOR",
  "INVENTED_ACCESSORY",
  "INCORRECT_TEXT",
  "INCORRECT_DIMENSION",
  "LOW_QUALITY",
  "ROLE_MISMATCH",
  "OTHER_SAFE_REASON",
] as const)

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 1000) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized && normalized.length <= maximum ? normalized : null
}

function texts(value: unknown, maximumItems = 20, maximumLength = 500) {
  const values = Array.isArray(value) ? value : value === undefined ||
    value === null ? [] : [value]
  return [...new Set(values.map((entry) => text(entry, maximumLength))
    .filter((entry): entry is string => Boolean(entry)))].slice(0, maximumItems)
}

function collectTexts(values: readonly unknown[], maximumItems = 20,
  maximumLength = 500) {
  return [...new Set(values.flatMap((value) =>
    texts(value, maximumItems, maximumLength)))].slice(0, maximumItems)
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]))
}

export function mayelVisualDigestV1(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stable(value))).digest("hex")}`
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const found = text(value)
    if (found) return found
  }
  return null
}

function aspectValues(value: unknown) {
  const aspects = record(value)
  return Object.fromEntries(Object.entries(aspects).flatMap(([key, entry]) => {
    const name = text(key, 120)
    const values = texts(entry, 12, 300)
    return name && values.length ? [[name, values]] : []
  }))
}

function aspect(evidence: JsonRecord, names: readonly string[]) {
  const wanted = names.map((name) => name.toLowerCase())
  for (const [key, values] of Object.entries(evidence)) {
    if (wanted.includes(key.toLowerCase())) return texts(values, 12, 300)
  }
  return []
}

export type MayelSourceImageReferenceV1 = Readonly<{
  referenceId: string
  sha256: string
  url: string | null
  storagePath: string | null
  authority: "AUTHORIZED_LUNA_SOURCE_PACK" |
    "APPROVED_CANONICAL_LISTING_ASSET"
  position: number
}>

export type MayelProductEvidencePackV1 = Readonly<{
  contractVersion: typeof MAYEL_PRODUCT_EVIDENCE_PACK_VERSION
  ebayItemId: string
  sku: string
  lunaProductId: string
  lunaVariantId: string
  productTitle: string
  category: string | null
  productType: readonly string[]
  brand: readonly string[]
  color: readonly string[]
  materialsProven: readonly string[]
  packageContentsProven: readonly string[]
  quantityOrPackCount: readonly string[]
  dimensionsProven: readonly string[]
  allowedProductBenefits: readonly string[]
  allowedUseCases: readonly string[]
  prohibitedOrUnprovenClaims: readonly string[]
  sourceImageSet: readonly MayelSourceImageReferenceV1[]
  sourceImageSetDigest: string
  productTruthVersion: string
  productTruthDigest: string
  semantics: Readonly<{
    unknownIsNotNone: true
    unprovenIsNotFalse: true
    missingEvidenceIsNotPermissionToInfer: true
    generatedImageIsProductTruthAuthority: false
  }>
}>

export function buildMayelProductEvidencePackV1(input: {
  ebayItemId: string
  sku: string
  packageData: unknown
  sourceImages: readonly MayelSourceImageReferenceV1[]
}): MayelProductEvidencePackV1 {
  const packageData = record(input.packageData)
  const assessment = record(record(packageData.evidenceSnapshot).assessment)
  const truth = record(assessment.productTruth)
  const candidate = record(assessment.candidate)
  const evidence = aspectValues(packageData.aspects)
  const proven = aspectValues(truth.provenProductValues)
  const facts = { ...evidence, ...proven }
  const productTruthDigest = text(truth.evidenceDigest, 100)
  const productTruthVersion = text(truth.authorityClass, 160)
  const lunaProductId = firstText(truth.lunaProductId,
    candidate.supplierProductId)
  const lunaVariantId = firstText(truth.lunaVariantId,
    candidate.supplierVariantId)
  const sourceImages = [...input.sourceImages]
    .sort((left, right) => left.position - right.position)
  const sourceImageSetDigest = mayelVisualDigestV1(sourceImages.map((image) => ({
    referenceId: image.referenceId,
    sha256: image.sha256,
    authority: image.authority,
    position: image.position,
  })))
  if (!/^\d{9,20}$/.test(input.ebayItemId) || !text(input.sku, 100) ||
      !lunaProductId || !lunaVariantId || !productTruthDigest ||
      !/^sha256:[0-9a-f]{64}$/.test(productTruthDigest) ||
      !productTruthVersion ||
      !/(?:LUNA.*EXACT.*PRODUCT_TRUTH|PRODUCT_TRUTH.*EXACT)/i
        .test(productTruthVersion) ||
      sourceImages.length < 1) {
    throw new Error("MAYEL_VISUAL_PRODUCT_EVIDENCE_INCOMPLETE")
  }
  const allowedProductBenefits = collectTexts([
    truth.allowedProductBenefits, truth.benefits, candidate.benefits,
  ], 12, 500)
  const allowedUseCases = collectTexts([
    truth.allowedUseCases, truth.useCases, candidate.useCases,
  ], 12, 500)
  const knownUnknowns = texts(truth.knownUnknownAspectNames, 30, 120)
  return Object.freeze({
    contractVersion: MAYEL_PRODUCT_EVIDENCE_PACK_VERSION,
    ebayItemId: input.ebayItemId,
    sku: input.sku,
    lunaProductId,
    lunaVariantId,
    productTitle: firstText(packageData.title, truth.title, candidate.title) ??
      input.sku,
    category: firstText(packageData.categoryName, packageData.categoryId),
    productType: aspect(facts, ["Type", "Product Type"]),
    brand: aspect(facts, ["Brand"]),
    color: aspect(facts, ["Color", "Colour"]),
    materialsProven: aspect(facts, ["Material", "Materials"]),
    packageContentsProven: aspect(facts,
      ["Package Contents", "Items Included", "Included Components"]),
    quantityOrPackCount: aspect(facts,
      ["Pack Quantity", "Number in Pack", "Quantity"]),
    dimensionsProven: aspect(facts,
      ["Dimensions", "Item Length", "Item Width", "Item Height", "Size"]),
    allowedProductBenefits,
    allowedUseCases,
    prohibitedOrUnprovenClaims: [...new Set([
      ...knownUnknowns.map((name) => `${name}: UNPROVEN`),
      "No medical, cosmetic, safety, performance, or comparative claim unless it is listed above as proven.",
      "Do not add accessories, parts, dimensions, materials, logos, or functions that are not proven above.",
    ])],
    sourceImageSet: sourceImages,
    sourceImageSetDigest,
    productTruthVersion,
    productTruthDigest,
    semantics: Object.freeze({ unknownIsNotNone: true,
      unprovenIsNotFalse: true,
      missingEvidenceIsNotPermissionToInfer: true,
      generatedImageIsProductTruthAuthority: false }),
  })
}

export type MayelVisualPromptV1 = Readonly<{
  contractVersion: typeof MAYEL_CHATGPT_VISUAL_PROMPT_VERSION
  text: string
  digest: string
  slots: readonly Readonly<{
    role: MayelVisualOutputRole
    status: "READY" | "BLOCKED_MISSING_EVIDENCE"
    requiredEvidence: string
  }>[]
  textAiCallCount: 0
  imageApiCallCount: 0
}>

export function buildMayelChatGptVisualPromptV1(
  pack: MayelProductEvidencePackV1,
): MayelVisualPromptV1 {
  const slots = MAYEL_VISUAL_OUTPUT_ROLES.map((role) => {
    const supported = role === "DETAIL" ||
      role === "PACKAGE_CONTENTS" && pack.packageContentsProven.length > 0 ||
      role === "DIMENSIONS" && pack.dimensionsProven.length > 0 ||
      role === "PRIMARY_BENEFIT" && pack.allowedProductBenefits.length > 0 ||
      ["LIFESTYLE", "HUMAN_USE"].includes(role) &&
        pack.allowedUseCases.length > 0
    return Object.freeze({ role,
      status: supported ? "READY" as const :
        "BLOCKED_MISSING_EVIDENCE" as const,
      requiredEvidence: role === "DETAIL" ?
        "identidad del producto demostrada por las imágenes fuente" :
        role === "PACKAGE_CONTENTS" ?
          "contenido del paquete demostrado" :
          role === "DIMENSIONS" ? "dimensiones demostradas" :
            role === "PRIMARY_BENEFIT" ?
              "beneficio del producto demostrado" :
              "caso de uso demostrado" })
  })
  const facts = (label: string, values: readonly string[]) =>
    `${label}: ${values.length ? values.join(" | ") :
      "NO DEMOSTRADO — no inferir"}`
  const roleLabel: Record<MayelVisualOutputRole, string> = {
    DETAIL: "DETALLE",
    PACKAGE_CONTENTS: "CONTENIDO DEL PAQUETE",
    DIMENSIONS: "DIMENSIONES",
    PRIMARY_BENEFIT: "BENEFICIO PRINCIPAL",
    LIFESTYLE: "LIFESTYLE / CONTEXTO ASPIRACIONAL",
    HUMAN_USE: "USO HUMANO",
  }
  const localizedClaim = (claim: string) => {
    if (claim === "No medical, cosmetic, safety, performance, or comparative claim unless it is listed above as proven.") {
      return "No agregues afirmaciones médicas, cosméticas, de seguridad, rendimiento o comparación salvo que aparezcan arriba como demostradas."
    }
    if (claim === "Do not add accessories, parts, dimensions, materials, logos, or functions that are not proven above.") {
      return "No agregues accesorios, piezas, dimensiones, materiales, logos ni funciones que no estén demostrados arriba."
    }
    return claim.replace(/: UNPROVEN$/u, ": NO DEMOSTRADO")
  }
  const textValue = [
    "Actúa como director de arte especializado en fotografía comercial para e-commerce.",
    "Trabaja con exactamente UN producto en esta conversación nueva de ChatGPT.",
    "Mantén el producto exactamente igual a las imágenes fuente.",
    "Usa todas las imágenes fuente originales cargadas como autoridad del producto en CADA generación.",
    "Nunca uses una imagen generada anteriormente como única autoridad del producto.",
    "Antes de generar cualquier imagen, valida qué slots cuentan con evidencia suficiente.",
    "Genera una imagen por vez y espera aprobación antes de continuar.",
    "Contrato interno: MAYEL_CHATGPT_VISUAL_PROMPT_V1",
    "",
    `Producto: ${pack.productTitle}`,
    `Seller OS SKU: ${pack.sku}`,
    `Categoría: ${pack.category ?? "NO DEMOSTRADA"}`,
    facts("Tipo", pack.productType),
    facts("Marca", pack.brand),
    facts("Color", pack.color),
    facts("Materiales", pack.materialsProven),
    facts("Contenido del paquete", pack.packageContentsProven),
    facts("Cantidad o número de piezas", pack.quantityOrPackCount),
    facts("Dimensiones", pack.dimensionsProven),
    facts("Beneficios permitidos", pack.allowedProductBenefits),
    facts("Casos de uso permitidos", pack.allowedUseCases),
    "",
    "BLOQUEO DE FIDELIDAD DEL PRODUCTO — obligatorio:",
    "- Conserva exactamente el producto fotografiado; no lo redibujes ni lo rediseñes.",
    "- No cambies el color, la forma, los logos visibles, la variante ni la cantidad de piezas.",
    "- No inventes accesorios, contenido del paquete, medidas, materiales, funciones ni beneficios.",
    "- No uses imágenes de competidores ni elementos con marcas de competidores.",
    "- No agregues texto salvo que el slot solicitado necesite explícitamente texto demostrado.",
    "",
    "VALIDACIÓN DE EVIDENCIA:",
    "- Genera únicamente los slots marcados como LISTO.",
    "- Si falta la evidencia requerida, no generes ese slot.",
    "- Que algo parezca probable no significa que esté demostrado.",
    "",
    "Crea únicamente las imágenes secundarias LISTAS indicadas a continuación, un archivo por slot:",
    ...slots.map((slot, index) =>
      `${String(index + 1).padStart(2, "0")}_${slot.role} — ${roleLabel[slot.role]}: ${
        slot.status === "READY" ? "LISTO" :
          "BLOQUEADO: FALTA EVIDENCIA"}`),
    "",
    "Prohibido o no demostrado:",
    ...pack.prohibitedOrUnprovenClaims.map((claim) =>
      `- ${localizedClaim(claim)}`),
    "",
    "AUTOCOMPROBACIÓN ANTES DE ENTREGAR CADA IMAGEN:",
    "- Confirma que la identidad, el color, la forma, los logos visibles, la variante y la cantidad de piezas coinciden con las imágenes fuente.",
    "- Confirma que no agregaste accesorios, texto, medidas, materiales, funciones ni beneficios no demostrados.",
    "- Confirma que la imagen cumple el propósito del slot solicitado.",
    "- Si alguna comprobación falla, no entregues esa imagen; corrígela usando nuevamente las imágenes fuente originales.",
    "",
    "INSTRUCCIONES DE APROBACIÓN:",
    "- Presenta una sola imagen por vez y espera la revisión de Mayel antes de continuar con el siguiente slot.",
    "- Mayel comparará cada resultado contra las imágenes originales y podrá aprobarlo o rechazarlo.",
    "- Una aprobación visual no autoriza cambios en eBay.",
    "",
    "INSTRUCCIONES FINALES:",
    "Mantén sin cambios la imagen principal actual. Estos resultados son imágenes secundarias para revisión humana en Seller OS.",
    "No generes slots bloqueados por falta de evidencia y no sustituyas hechos desconocidos con suposiciones.",
  ].join("\n")
  return Object.freeze({ contractVersion: MAYEL_CHATGPT_VISUAL_PROMPT_VERSION,
    text: textValue, digest: mayelVisualDigestV1(textValue), slots,
    textAiCallCount: 0, imageApiCallCount: 0 })
}

export type MayelApprovedVisualAssetV1 = Readonly<{
  assetId: string
  role: MayelVisualOutputRole
  outputSha256: string
  publicUrl: string
}>

export function buildMayelVisualManifestV1(input: {
  visualTaskId: string
  ebayItemId: string
  currentImages: readonly string[]
  assets: readonly MayelApprovedVisualAssetV1[]
  productTruthDigest: string
  sourceImageSetDigest: string
}) {
  const currentImages = [...new Set(input.currentImages.filter((url) =>
    /^https:\/\//.test(url)))].slice(0, 24)
  const roleRank = new Map(MAYEL_VISUAL_OUTPUT_ROLES.map((role, index) =>
    [role, index]))
  const assets = [...input.assets].sort((left, right) =>
    (roleRank.get(left.role) ?? 99) - (roleRank.get(right.role) ?? 99))
  const currentMainImage = currentImages[0] ?? null
  const currentSecondaryImages = currentImages.slice(1)
  const proposedOrderedImages = [
    ...(currentMainImage ? [{ position: 0, role: "CURRENT_MAIN" as const,
      assetId: null, outputSha256: null, publicUrl: currentMainImage }] : []),
    ...assets.map((asset, index) => ({ position: index + 1,
      role: asset.role, assetId: asset.assetId,
      outputSha256: asset.outputSha256, publicUrl: asset.publicUrl })),
    ...currentSecondaryImages.map((publicUrl, index) => ({
      position: assets.length + index + 1,
      role: "CURRENT_SECONDARY" as const,
      assetId: null, outputSha256: null, publicUrl,
    })),
  ].slice(0, 24)
  const material = {
    contractVersion: MAYEL_VISUAL_MANIFEST_VERSION,
    visualTaskId: input.visualTaskId,
    ebayItemId: input.ebayItemId,
    currentMainImage,
    currentSecondaryImages,
    proposedOrderedImages,
    productTruthDigest: input.productTruthDigest,
    sourceImageSetDigest: input.sourceImageSetDigest,
    currentMainImagePreserved: true,
    separateExplicitOwnerApprovalRequiredForMainImage: true,
    fieldsToChange: ["IMAGES_ONLY"],
  }
  return Object.freeze({ ...material,
    visualManifestDigest: mayelVisualDigestV1(material) })
}

export function validateMayelHumanQaV1(input: unknown,
  role: MayelVisualOutputRole) {
  const qa = record(input)
  const required = ["productIdentityPreserved", "colorPreserved",
    "shapePreserved", "partCountPreserved", "visibleLogosPreserved",
    "noInventedAccessories", "noUnsupportedClaims", "noUnauthorizedText",
    "roleMatchesOutput"]
  if (role === "DIMENSIONS") required.push("dimensionTextMatchesProductTruth")
  return required.every((key) => qa[key] === true)
}
