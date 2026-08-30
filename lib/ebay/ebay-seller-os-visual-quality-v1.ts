import sharp from "sharp"

import type { CommercialListingReadModel, CommercialMonitorGetDto } from
  "./commercial-monitor-readonly-contract"
import { currentLiveListingsForMonitorV1 } from
// @ts-expect-error Node's direct TypeScript test runner requires the extension.
  "./ebay-seller-os-live-portfolio-integrity-v1.ts"

export const SELLER_OS_VISUAL_QUALITY_VERSION =
  "SELLER_OS_VISUAL_QUALITY_V1_2026_08_29" as const

type SignalStatus = "AVAILABLE" | "PARTIAL" | "UNPROVEN"
type EbayImageSourceClass = "ORIGINAL_EBAY_IMAGE" | "EBAY_DERIVATIVE" |
  "THUMBNAIL" | "OTHER"

type VisualSignal<T> = Readonly<{
  status: SignalStatus
  value: T | null
  explanation: string
  limitationCode: string | null
}>

export type SellerOsVisualFindingV1 = Readonly<{
  findingCode: "LOW_FRAME_UTILIZATION" | "EXCESS_DEAD_SPACE" |
    "OFF_CENTER_PRODUCT" | "EDGE_CROPPING_RISK" |
    "WHITE_BACKGROUND_NOT_PROVEN" | "LOW_SOURCE_RESOLUTION"
  severity: "MEDIUM" | "LOW"
  observation: string
  whyItMayMatter: string
  whatToReview: string
  objective: string
  hypothesis: string
  proposedExperiment: string
  evidenceVsHypothesis: "OBSERVATION_AND_HYPOTHESIS_SEPARATED"
}>

export type SellerOsHeroVisualReviewV1 = Readonly<{
  ebayItemId: string
  status: SignalStatus
  evidenceSource: "EBAY_TRADING_GET_MY_EBAY_SELLING" |
    "EBAY_TRADING_GET_ITEM" | null
  heroImageUrl: string | null
  sourceResolution: Readonly<{
    readContractSourceClass: EbayImageSourceClass
    visualAnalyzerSourceClass: EbayImageSourceClass
    originalReadUrlSizeVariant: string | null
    analyzedUrlSizeVariant: string | null
    originalImageUrlAvailable: boolean
    fullResolutionFetchAvailable: boolean
    sourceImageFullResolutionCertified: boolean
    heroDimensionFindingsReferToOriginal: boolean
    certification: string
  }>
  evidenceLimitationCode: string | null
  signals: Readonly<{
    heroAspectRatio: VisualSignal<number>
    imageDimensions: VisualSignal<{ width: number; height: number }>
    backgroundWhiteness: VisualSignal<number>
    mainImageWhiteBackgroundStandard: VisualSignal<boolean>
    pdpFrameUtilization: VisualSignal<number>
    productDominance: VisualSignal<number>
    excessDeadSpace: VisualSignal<boolean>
    productCentering: VisualSignal<number>
    thumbnailClarity: VisualSignal<"STRONG" | "REVIEW" | "UNPROVEN">
    edgeCroppingRisk: VisualSignal<boolean>
    multipleProductOrTextOverlaySignal: VisualSignal<boolean>
    productRecognition: VisualSignal<string>
    visualTrust: VisualSignal<string>
    benefitClarity: VisualSignal<string>
  }>
  predictedHeroScore: Readonly<{
    status: SignalStatus
    value: number | null
    components: ReadonlyArray<Readonly<{
      component: string
      points: number
      maximum: number
      evidence: string
    }>>
    performanceCausalityClaimed: false
  }>
  findings: ReadonlyArray<SellerOsVisualFindingV1>
  actions: readonly ["VER_IMAGEN", "VER_POR_QUE", "PREPARAR_EXPERIMENTO"]
  productTruthProtection: Readonly<{
    exactProductRequired: true
    realColorRequired: true
    realGeometryRequired: true
    exactQuantityAndAccessoriesRequired: true
    realMarksAndTextRequired: true
    generativeChangesAllowed: false
  }>
}>

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 6_000
const MAX_CONCURRENCY = 3

function rounded(value: number, places = 4) {
  return Number(value.toFixed(places))
}

function available<T>(value: T, explanation: string): VisualSignal<T> {
  return { status: "AVAILABLE", value, explanation, limitationCode: null }
}

function partial<T>(value: T, explanation: string, limitationCode: string):
VisualSignal<T> {
  return { status: "PARTIAL", value, explanation, limitationCode }
}

function unproven<T>(explanation: string, limitationCode: string): VisualSignal<T> {
  return { status: "UNPROVEN", value: null, explanation, limitationCode }
}

function officialEbayImageUrl(value: string | null) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !(parsed.hostname === "ebayimg.com" ||
        parsed.hostname.endsWith(".ebayimg.com"))) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function resolveMaximumOfficialEbayImageV1(value: string | null) {
  const official = officialEbayImageUrl(value)
  if (!official) return {
    sourceUrl: null, analyzedUrl: null,
    readContractSourceClass: "OTHER" as const,
    visualAnalyzerSourceClass: "OTHER" as const,
    originalReadUrlSizeVariant: null, analyzedUrlSizeVariant: null,
    originalImageUrlAvailable: false,
    sourceImageFullResolutionCertified: false,
  }
  const parsed = new URL(official)
  const match = parsed.pathname.match(/\/s-l(\d+)\.(jpe?g|png|webp)$/i)
  if (!match) return {
    sourceUrl: official, analyzedUrl: official,
    readContractSourceClass: "ORIGINAL_EBAY_IMAGE" as const,
    visualAnalyzerSourceClass: "ORIGINAL_EBAY_IMAGE" as const,
    originalReadUrlSizeVariant: null, analyzedUrlSizeVariant: "ORIGINAL",
    originalImageUrlAvailable: true,
    sourceImageFullResolutionCertified: true,
  }
  const pixels = Number(match[1])
  const analyzed = new URL(official)
  analyzed.pathname = parsed.pathname.replace(/\/s-l\d+\.(jpe?g|png|webp)$/i,
    `/s-l1600.${match[2]}`)
  return {
    sourceUrl: official, analyzedUrl: analyzed.toString(),
    readContractSourceClass: (pixels <= 300 ? "THUMBNAIL" :
      "EBAY_DERIVATIVE") as EbayImageSourceClass,
    // The analyzer consumes the maximum official derivative resolved above,
    // never the smaller representation supplied by the read contract.
    visualAnalyzerSourceClass: "EBAY_DERIVATIVE" as const,
    originalReadUrlSizeVariant: `s-l${pixels}`,
    analyzedUrlSizeVariant: "s-l1600",
    // eBay exposes a maximum official derivative here, not the raw upload URL.
    originalImageUrlAvailable: false,
    sourceImageFullResolutionCertified: true,
  }
}

function unavailableReview(listing: CommercialListingReadModel, code: string):
SellerOsHeroVisualReviewV1 {
  const resolution = resolveMaximumOfficialEbayImageV1(
    listing.identity.primaryImageUrl)
  const unavailable = <T>(label: string) => unproven<T>(
    `${label} no se puede probar sin una hero oficial accesible.`, code)
  return {
    ebayItemId: listing.identity.itemId,
    status: "UNPROVEN",
    evidenceSource: listing.identity.primaryImageSource,
    heroImageUrl: resolution.analyzedUrl,
    sourceResolution: {
      readContractSourceClass: resolution.readContractSourceClass,
      visualAnalyzerSourceClass: resolution.visualAnalyzerSourceClass,
      originalReadUrlSizeVariant: resolution.originalReadUrlSizeVariant,
      analyzedUrlSizeVariant: resolution.analyzedUrlSizeVariant,
      originalImageUrlAvailable: resolution.originalImageUrlAvailable,
      fullResolutionFetchAvailable: false,
      sourceImageFullResolutionCertified: false,
      heroDimensionFindingsReferToOriginal: false,
      certification: code,
    },
    evidenceLimitationCode: code,
    signals: {
      heroAspectRatio: unavailable<number>("La proporción"),
      imageDimensions: unavailable<{ width: number; height: number }>("Las dimensiones"),
      backgroundWhiteness: unavailable<number>("El fondo"),
      mainImageWhiteBackgroundStandard: unavailable<boolean>("El estándar de fondo blanco"),
      pdpFrameUtilization: unavailable<number>("La utilización del frame"),
      productDominance: unavailable<number>("La dominancia del producto"),
      excessDeadSpace: unavailable<boolean>("El espacio muerto"),
      productCentering: unavailable<number>("El centrado"),
      thumbnailClarity: unavailable<"STRONG" | "REVIEW" | "UNPROVEN">("La claridad en miniatura"),
      edgeCroppingRisk: unavailable<boolean>("El riesgo de recorte"),
      multipleProductOrTextOverlaySignal: unavailable<boolean>("La presencia de texto o productos múltiples"),
      productRecognition: unavailable<string>("El reconocimiento del producto"),
      visualTrust: unavailable<string>("La confianza visual"),
      benefitClarity: unavailable<string>("La claridad de beneficios"),
    },
    predictedHeroScore: { status: "UNPROVEN", value: null, components: [],
      performanceCausalityClaimed: false },
    findings: [],
    actions: ["VER_IMAGEN", "VER_POR_QUE", "PREPARAR_EXPERIMENTO"],
    productTruthProtection: {
      exactProductRequired: true, realColorRequired: true,
      realGeometryRequired: true, exactQuantityAndAccessoriesRequired: true,
      realMarksAndTextRequired: true, generativeChangesAllowed: false,
    },
  }
}

async function downloadOfficialHero(url: string, fetchImage: typeof fetch) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
  try {
    const response = await fetchImage(url, { method: "GET", redirect: "follow",
      cache: "no-store", headers: { Accept: "image/*" }, signal: controller.signal })
    const finalUrl = officialEbayImageUrl(response.url || url)
    const length = Number(response.headers.get("content-length") ?? 0)
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || !finalUrl || !contentType.startsWith("image/") ||
      (length > 0 && length > MAX_IMAGE_BYTES)) {
      throw new Error("IMAGE_EVIDENCE_UNAVAILABLE")
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error("IMAGE_EVIDENCE_UNAVAILABLE")
    }
    return bytes
  } finally {
    clearTimeout(timeout)
  }
}

function visualFinding(input: SellerOsVisualFindingV1) {
  return input
}

export async function analyzeSellerOsHeroImageBytesV1(input: {
  ebayItemId: string
  imageUrl: string
  imageSource: "EBAY_TRADING_GET_MY_EBAY_SELLING" | "EBAY_TRADING_GET_ITEM"
  bytes: Buffer
  sourceResolution?: ReturnType<typeof resolveMaximumOfficialEbayImageV1>
}): Promise<SellerOsHeroVisualReviewV1> {
  const metadata = await sharp(input.bytes, { failOn: "error",
    limitInputPixels: 40_000_000 }).rotate().metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width < 1 || height < 1) throw new Error("IMAGE_EVIDENCE_UNAVAILABLE")
  const { data, info } = await sharp(input.bytes, { failOn: "error",
    limitInputPixels: 40_000_000 }).rotate().resize({ width: 256, height: 256,
    fit: "inside", withoutEnlargement: false }).removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true })
  const pixel = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels
    return [data[offset], data[offset + 1], data[offset + 2]] as const
  }
  let borderSamples = 0
  let whiteBorderSamples = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (x > 2 && x < info.width - 3 && y > 2 && y < info.height - 3) continue
      const channels = pixel(x, y)
      if (Math.min(...channels) >= 240 && Math.max(...channels) -
        Math.min(...channels) <= 18) whiteBorderSamples += 1
      borderSamples += 1
    }
  }
  const whiteness = borderSamples ? whiteBorderSamples / borderSamples : 0
  const whiteBackgroundProven = whiteness >= .9
  const maskUsable = whiteness >= .75
  const columnForeground = new Array<number>(info.width).fill(0)
  const rowForeground = new Array<number>(info.height).fill(0)
  let foregroundPixels = 0
  let edgeComparisons = 0
  let detailEdges = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const channels = pixel(x, y)
      const foreground = Math.min(...channels) < 232 ||
        Math.max(...channels) - Math.min(...channels) > 26
      if (foreground) {
        columnForeground[x] += 1
        rowForeground[y] += 1
        foregroundPixels += 1
      }
      if (x + 1 < info.width && y + 1 < info.height) {
        const horizontal = pixel(x + 1, y)
        const vertical = pixel(x, y + 1)
        const grey = (channels[0] + channels[1] + channels[2]) / 3
        const horizontalGrey = (horizontal[0] + horizontal[1] + horizontal[2]) / 3
        const verticalGrey = (vertical[0] + vertical[1] + vertical[2]) / 3
        if (Math.max(Math.abs(grey - horizontalGrey),
          Math.abs(grey - verticalGrey)) >= 18) detailEdges += 1
        edgeComparisons += 1
      }
    }
  }
  data.fill(0)
  const minimumColumnContinuity = Math.max(2, Math.ceil(info.height * .012))
  const minimumRowContinuity = Math.max(2, Math.ceil(info.width * .012))
  const foregroundColumns = columnForeground.flatMap((count, index) =>
    count >= minimumColumnContinuity ? [index] : [])
  const foregroundRows = rowForeground.flatMap((count, index) =>
    count >= minimumRowContinuity ? [index] : [])
  const left = foregroundColumns[0] ?? info.width
  const right = foregroundColumns.at(-1) ?? -1
  const top = foregroundRows[0] ?? info.height
  const bottom = foregroundRows.at(-1) ?? -1
  const bboxAvailable = maskUsable && foregroundPixels > 0 && right >= left && bottom >= top
  const bboxWidthRatio = bboxAvailable ? (right - left + 1) / info.width : null
  const bboxHeightRatio = bboxAvailable ? (bottom - top + 1) / info.height : null
  const frameUtilization = bboxAvailable && bboxWidthRatio !== null && bboxHeightRatio !== null
    ? bboxWidthRatio * bboxHeightRatio : null
  const dominance = bboxAvailable && bboxWidthRatio !== null && bboxHeightRatio !== null
    ? Math.max(bboxWidthRatio, bboxHeightRatio) : null
  const centerOffset = bboxAvailable
    ? Math.hypot((left + right + 1) / 2 - info.width / 2,
      (top + bottom + 1) / 2 - info.height / 2) /
      Math.hypot(info.width, info.height) : null
  const edgeRisk = bboxAvailable
    ? left <= 1 || top <= 1 || right >= info.width - 2 || bottom >= info.height - 2
    : null
  const deadSpace = frameUtilization === null ? null : 1 - frameUtilization
  const detailRatio = edgeComparisons ? detailEdges / edgeComparisons : 0
  const resolutionStrong = Math.min(width, height) >= 1_000
  const thumbnailStrong = dominance !== null && dominance >= .68 &&
    detailRatio >= .006 && Math.min(width, height) >= 500
  const segmentationLimitation = "WHITE_OR_REFLECTIVE_PRODUCT_MAY_REDUCE_MASK_ACCURACY"
  const findings: SellerOsVisualFindingV1[] = []
  if (!whiteBackgroundProven) findings.push(visualFinding({
    findingCode: "WHITE_BACKGROUND_NOT_PROVEN", severity: "MEDIUM",
    observation: "No se pudo probar un fondo blanco uniforme en el borde de la imagen principal.",
    whyItMayMatter: "Un fondo irregular puede restar claridad al producto en resultados pequeños.",
    whatToReview: "Revisar el fondo sin cambiar el producto, su color ni sus accesorios reales.",
    objective: "MAIN_IMAGE_WHITE_BACKGROUND_STANDARD",
    hypothesis: "A_WHITE_UNIFORM_BACKGROUND_MAY_IMPROVE_VISUAL_CLARITY",
    proposedExperiment: "COMPARE_CURRENT_HERO_WITH_PRODUCT_TRUE_WHITE_BACKGROUND_VARIANT",
    evidenceVsHypothesis: "OBSERVATION_AND_HYPOTHESIS_SEPARATED",
  }))
  if (dominance !== null && dominance < .62) findings.push(visualFinding({
    findingCode: "LOW_FRAME_UTILIZATION", severity: "MEDIUM",
    observation: "El producto ocupa poco espacio en la imagen principal.",
    whyItMayMatter: "En resultados pequeños puede resultar más difícil reconocerlo.",
    whatToReview: "Acercar el producto conservando su forma, color y accesorios reales.",
    objective: "PRODUCT_OCCUPIES_MORE_HERO_FRAME",
    hypothesis: "BETTER_THUMBNAIL_RECOGNITION_MAY_IMPROVE_CTR",
    proposedExperiment: "COMPARE_CURRENT_HERO_WITH_HIGHER_PRODUCT_DOMINANCE_VARIANT",
    evidenceVsHypothesis: "OBSERVATION_AND_HYPOTHESIS_SEPARATED",
  }))
  if (deadSpace !== null && deadSpace > .62 && (dominance ?? 1) < .7) {
    findings.push(visualFinding({
      findingCode: "EXCESS_DEAD_SPACE", severity: "LOW",
      observation: "Hay una proporción amplia de espacio sin producto alrededor del objeto principal.",
      whyItMayMatter: "El espacio sobrante reduce el tamaño útil del producto en miniatura.",
      whatToReview: "Reducir espacio muerto manteniendo márgenes seguros y sin recortar el producto.",
      objective: "REDUCE_EXCESS_DEAD_SPACE",
      hypothesis: "MORE_USEFUL_FRAME_AREA_MAY_IMPROVE_THUMBNAIL_CLARITY",
      proposedExperiment: "COMPARE_SAFE_TIGHTER_CROP_AGAINST_CURRENT_HERO",
      evidenceVsHypothesis: "OBSERVATION_AND_HYPOTHESIS_SEPARATED",
    }))
  }
  if (centerOffset !== null && centerOffset > .11) findings.push(visualFinding({
    findingCode: "OFF_CENTER_PRODUCT", severity: "LOW",
    observation: "El centro visual del producto está alejado del centro del frame.",
    whyItMayMatter: "Un encuadre descentrado puede perder claridad al reducirse.",
    whatToReview: "Centrar el producto sin alterar su geometría ni ocultar partes reales.",
    objective: "CENTER_PRODUCT_SAFELY",
    hypothesis: "A_STABLE_FOCAL_POINT_MAY_IMPROVE_RECOGNITION",
    proposedExperiment: "COMPARE_CENTERED_PRODUCT_TRUE_CROP_WITH_CURRENT_HERO",
    evidenceVsHypothesis: "OBSERVATION_AND_HYPOTHESIS_SEPARATED",
  }))
  if (edgeRisk === true) findings.push(visualFinding({
    findingCode: "EDGE_CROPPING_RISK", severity: "MEDIUM",
    observation: "La máscara objetiva del producto toca un borde de la imagen.",
    whyItMayMatter: "Alguna parte real podría verse recortada en presentaciones pequeñas.",
    whatToReview: "Conservar un margen seguro alrededor del producto completo.",
    objective: "PRESERVE_COMPLETE_PRODUCT_WITH_SAFE_MARGIN",
    hypothesis: "SAFE_MARGINS_MAY_IMPROVE_VISUAL_TRUST",
    proposedExperiment: "COMPARE_SAFE_MARGIN_VARIANT_WITH_CURRENT_HERO",
    evidenceVsHypothesis: "OBSERVATION_AND_HYPOTHESIS_SEPARATED",
  }))
  if (Math.min(width, height) < 500) findings.push(visualFinding({
    findingCode: "LOW_SOURCE_RESOLUTION", severity: "MEDIUM",
    observation: "La dimensión menor de la imagen es inferior a 500 píxeles.",
    whyItMayMatter: "La imagen puede perder detalle al ampliarse o comprimirse.",
    whatToReview: "Usar una fuente autorizada de mayor resolución del mismo producto exacto.",
    objective: "IMPROVE_AUTHORIZED_SOURCE_RESOLUTION",
    hypothesis: "MORE_SOURCE_DETAIL_MAY_IMPROVE_VISUAL_CLARITY",
    proposedExperiment: "COMPARE_HIGHER_RESOLUTION_AUTHORIZED_SOURCE_WITH_CURRENT_HERO",
    evidenceVsHypothesis: "OBSERVATION_AND_HYPOTHESIS_SEPARATED",
  }))
  const components = [
    { component: "WHITE_BACKGROUND", points: whiteBackgroundProven ? 25 :
      Math.round(Math.min(25, whiteness * 25)), maximum: 25,
      evidence: `borderWhiteness=${rounded(whiteness)}` },
    ...(dominance === null ? [] : [{ component: "PRODUCT_DOMINANCE",
      points: Math.round(Math.min(30, (dominance / .78) * 30)), maximum: 30,
      evidence: `longSideCoverage=${rounded(dominance)}` }]),
    ...(centerOffset === null ? [] : [{ component: "CENTERING",
      points: Math.round(Math.max(0, 20 * (1 - centerOffset / .2))), maximum: 20,
      evidence: `normalizedCenterOffset=${rounded(centerOffset)}` }]),
    { component: "SOURCE_RESOLUTION", points: resolutionStrong ? 15 :
      Math.round(Math.min(15, Math.min(width, height) / 1_000 * 15)), maximum: 15,
      evidence: `${width}x${height}` },
    ...(edgeRisk === null ? [] : [{ component: "EDGE_SAFETY",
      points: edgeRisk ? 0 : 10, maximum: 10, evidence: `edgeTouch=${edgeRisk}` }]),
  ]
  const componentMaximum = components.reduce((sum, row) => sum + row.maximum, 0)
  const score = componentMaximum >= 70 ? Math.round(components.reduce(
    (sum, row) => sum + row.points, 0) / componentMaximum * 100) : null
  const maskSignal = <T>(value: T, explanation: string) => maskUsable
    ? partial(value, explanation, segmentationLimitation)
    : unproven<T>(explanation, "NON_WHITE_BACKGROUND_PREVENTS_OBJECTIVE_PRODUCT_MASK")
  return {
    ebayItemId: input.ebayItemId,
    status: maskUsable ? "AVAILABLE" : "PARTIAL",
    evidenceSource: input.imageSource,
    heroImageUrl: input.imageUrl,
    sourceResolution: {
      readContractSourceClass: input.sourceResolution?.readContractSourceClass
        ?? "OTHER",
      visualAnalyzerSourceClass: input.sourceResolution?.visualAnalyzerSourceClass
        ?? "OTHER",
      originalReadUrlSizeVariant:
        input.sourceResolution?.originalReadUrlSizeVariant ?? null,
      analyzedUrlSizeVariant:
        input.sourceResolution?.analyzedUrlSizeVariant ?? null,
      originalImageUrlAvailable:
        input.sourceResolution?.originalImageUrlAvailable ?? false,
      fullResolutionFetchAvailable: true,
      sourceImageFullResolutionCertified:
        input.sourceResolution?.sourceImageFullResolutionCertified ?? false,
      heroDimensionFindingsReferToOriginal:
        input.sourceResolution?.originalImageUrlAvailable ?? false,
      certification: input.sourceResolution?.originalImageUrlAvailable
        ? "ORIGINAL_EBAY_IMAGE_BYTES_DECODED"
        : "MAXIMUM_OFFICIAL_EBAY_DERIVATIVE_BYTES_DECODED",
    },
    evidenceLimitationCode: maskUsable ? null :
      "NON_WHITE_BACKGROUND_LIMITS_DETERMINISTIC_SEGMENTATION",
    signals: {
      heroAspectRatio: available(rounded(width / height),
        "Proporción calculada desde los píxeles de la hero oficial."),
      imageDimensions: available({ width, height },
        "Dimensiones decodificadas de la hero oficial."),
      backgroundWhiteness: available(rounded(whiteness),
        "Fracción del borde que cumple el umbral blanco-neutral reproducible."),
      mainImageWhiteBackgroundStandard: available(whiteBackgroundProven,
        "El estándar se considera probado con al menos 90% del borde blanco-neutral."),
      pdpFrameUtilization: frameUtilization === null
        ? unproven("No se puede separar objetivamente producto y fondo.",
          "OBJECTIVE_FOREGROUND_MASK_UNAVAILABLE")
        : maskSignal(rounded(frameUtilization),
          "Área de la caja del producto respecto al frame completo."),
      productDominance: dominance === null
        ? unproven("No se puede separar objetivamente producto y fondo.",
          "OBJECTIVE_FOREGROUND_MASK_UNAVAILABLE")
        : maskSignal(rounded(dominance),
          "Cobertura del lado dominante del producto respecto al frame."),
      excessDeadSpace: deadSpace === null
        ? unproven("No se puede separar objetivamente producto y fondo.",
          "OBJECTIVE_FOREGROUND_MASK_UNAVAILABLE")
        : maskSignal(deadSpace > .62 && (dominance ?? 1) < .7,
          "Señal derivada de área ocupada y cobertura del lado dominante."),
      productCentering: centerOffset === null
        ? unproven("No se puede separar objetivamente producto y fondo.",
          "OBJECTIVE_FOREGROUND_MASK_UNAVAILABLE")
        : maskSignal(rounded(centerOffset),
          "Distancia normalizada entre el centro de la máscara y el centro del frame."),
      thumbnailClarity: partial(thumbnailStrong ? "STRONG" : "REVIEW",
        "Combina resolución, detalle local y tamaño útil; no prueba reconocimiento semántico.",
        "SEMANTIC_PRODUCT_RECOGNITION_NOT_EVALUATED"),
      edgeCroppingRisk: edgeRisk === null
        ? unproven("No se puede separar objetivamente producto y fondo.",
          "OBJECTIVE_FOREGROUND_MASK_UNAVAILABLE")
        : maskSignal(edgeRisk, "Indica si la máscara toca el borde del frame."),
      multipleProductOrTextOverlaySignal: unproven(
        "Las reglas simples no distinguen con suficiente certeza texto y piezas reales.",
        "SEMANTIC_VISUAL_SIGNAL_REQUIRES_BOUNDED_REVIEW"),
      productRecognition: unproven(
        "El reconocimiento semántico no se infiere de geometría y píxeles básicos.",
        "AI_VISUAL_CONTEXT_NOT_REQUESTED"),
      visualTrust: unproven(
        "La confianza visual requiere contexto semántico adicional.",
        "AI_VISUAL_CONTEXT_NOT_REQUESTED"),
      benefitClarity: unproven(
        "La claridad de beneficios requiere contexto semántico adicional.",
        "AI_VISUAL_CONTEXT_NOT_REQUESTED"),
    },
    predictedHeroScore: score === null
      ? { status: "UNPROVEN", value: null, components,
        performanceCausalityClaimed: false }
      : { status: "PARTIAL", value: score, components,
        performanceCausalityClaimed: false },
    findings,
    actions: ["VER_IMAGEN", "VER_POR_QUE", "PREPARAR_EXPERIMENTO"],
    productTruthProtection: {
      exactProductRequired: true, realColorRequired: true,
      realGeometryRequired: true, exactQuantityAndAccessoriesRequired: true,
      realMarksAndTextRequired: true, generativeChangesAllowed: false,
    },
  }
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number,
  worker: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length)
  let cursor = 0
  async function consume() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) },
    () => consume()))
  return output
}

export async function buildSellerOsCurrentLiveVisualQualityV1(input: {
  monitor: CommercialMonitorGetDto
  fetchImage?: typeof fetch
}) {
  const listings = currentLiveListingsForMonitorV1(input.monitor)
  const fetchImage = input.fetchImage ?? fetch
  const reviews = await mapWithConcurrency(listings, MAX_CONCURRENCY,
    async (listing) => {
      const sourceResolution = resolveMaximumOfficialEbayImageV1(
        listing.identity.primaryImageUrl)
      const imageUrl = sourceResolution.analyzedUrl
      if (!imageUrl || !sourceResolution.sourceImageFullResolutionCertified ||
        !listing.identity.primaryImageSource) {
        return unavailableReview(listing, "IMAGE_EVIDENCE_UNAVAILABLE")
      }
      try {
        const bytes = await downloadOfficialHero(imageUrl, fetchImage)
        return await analyzeSellerOsHeroImageBytesV1({
          ebayItemId: listing.identity.itemId,
          imageUrl,
          imageSource: listing.identity.primaryImageSource,
          bytes,
          sourceResolution,
        })
      } catch {
        return unavailableReview(listing, "IMAGE_EVIDENCE_UNAVAILABLE")
      }
    })
  const availableCount = reviews.filter((row) => row.status === "AVAILABLE").length
  const partialCount = reviews.filter((row) => row.status === "PARTIAL").length
  const unprovenCount = reviews.filter((row) => row.status === "UNPROVEN").length
  const allFindings = reviews.flatMap((review) => review.findings.map((finding) => ({
    ebayItemId: review.ebayItemId,
    heroImageUrl: review.heroImageUrl,
    ...finding,
  })))
  const topVisualFindings = [...allFindings].sort((left, right) =>
    (left.severity === "MEDIUM" ? 0 : 1) - (right.severity === "MEDIUM" ? 0 : 1))
    .slice(0, 12)
  return {
    contractVersion: SELLER_OS_VISUAL_QUALITY_VERSION,
    generatedAt: new Date().toISOString(),
    status: availableCount === listings.length && listings.length > 0
      ? "AVAILABLE" as const : availableCount + partialCount > 0
        ? "PARTIAL" as const : "UNPROVEN" as const,
    authority: "CANONICAL_CURRENT_LIVE_PRIMARY_IMAGE" as const,
    identityGrain: "EBAY_ITEM_ID" as const,
    sourceResolutionPrecheck: {
      analyzedUrlSizeVariant: "s-l1600" as const,
      originalImageUrlAvailable: reviews.some((row) =>
        row.sourceResolution.originalImageUrlAvailable),
      fullResolutionFetchAvailable: reviews.some((row) =>
        row.sourceResolution.fullResolutionFetchAvailable),
      sourceImageFullResolutionCertified: reviews.some((row) =>
        row.sourceResolution.sourceImageFullResolutionCertified),
      heroDimensionFindingsReferToOriginal: reviews.some((row) =>
        row.sourceResolution.heroDimensionFindingsReferToOriginal),
      maximumOfficialDerivativeUsed: reviews.some((row) =>
        row.sourceResolution.certification ===
          "MAXIMUM_OFFICIAL_EBAY_DERIVATIVE_BYTES_DECODED"),
    },
    currentLiveCount: listings.length,
    heroImagesObserved: reviews.filter((row) => row.heroImageUrl !== null).length,
    visualAnalysisAvailableCount: availableCount,
    partialCount,
    unprovenCount,
    topVisualFindings,
    proposedExperimentCount: allFindings.length,
    listings: reviews,
    analyticsContext: {
      visualAnalysisContinuesWithoutAnalytics: true as const,
      visualObservationIsNotCtrCausality: true as const,
      experimentRequiredForOutcomeClaim: true as const,
    },
    ai: {
      deterministicFilterFirst: true as const,
      aiCallCount: 0 as const,
      workload: "seller_os.listing_analysis" as const,
      reason: "DETERMINISTIC_SIGNALS_SUFFICIENT_FOR_INITIAL_VISUAL_DIAGNOSIS" as const,
      oneAiCallPerListing: false as const,
      imageGenerationEnabled: false as const,
      imageGenerationCount: 0 as const,
    },
    faultIsolation: {
      perEbayItemId: true as const,
      imageFailureStopsBatch: false as const,
      analyticsFailureStopsVisualAnalysis: false as const,
      qualityReportFailureStopsVisualAnalysis: false as const,
    },
    safety: {
      ebayListingEdits: 0 as const,
      marketplaceWrites: 0 as const,
      secretExposure: 0 as const,
      autoEditAllowed: false as const,
      scoreLowTriggersAutoEdit: false as const,
    },
  }
}
