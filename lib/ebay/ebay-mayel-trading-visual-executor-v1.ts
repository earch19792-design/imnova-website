import { createHash } from "node:crypto"

import {
  buildOfficialTradingPictureReadbackV1,
  normalizeOfficialTradingPictureUrlV1,
} from "./ebay-active-listing-image-revision-service"

export const MAYEL_TRADING_VISUAL_EXECUTOR_V1 =
  "EBAY_TRADING_REVISE_FIXED_PRICE_ITEM_PICTURE_DETAILS_ONLY_V1" as const
export const MAYEL_TRADING_VISUAL_WRITE_OPERATION =
  "ReviseFixedPriceItem" as const
export const MAYEL_TRADING_VISUAL_ALLOWED_DIFF_DOMAIN =
  "PICTURE_DETAILS_ONLY" as const
export const MAYEL_TRADING_MEDIA_PREPARATION_ROUTE =
  "EBAY_MEDIA_CREATE_IMAGE_FROM_URL_GET_IMAGE_EPS_V1" as const
export const MAYEL_TRADING_MEDIA_IMAGE_ENDPOINT =
  "https://apim.ebay.com/commerce/media/v1_beta/image" as const
export const MAYEL_TRADING_MAX_REVISE_CALLS = 1 as const

const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const TRADING_COMPATIBILITY_LEVEL = "1423"
const TRADING_SITE_ID_US = "0"
const MEDIA_TIMEOUT_MS = 25_000
const TRADING_WRITE_TIMEOUT_MS = 25_000

type FetchLike = typeof fetch

export const MAYEL_TRADING_PROTECTED_FIELDS = Object.freeze([
  "TITLE",
  "PRICE",
  "QUANTITY",
  "CATEGORY",
  "CONDITION",
  "SKU",
  "PRODUCT_IDENTITY",
  "POLICIES",
  "DESCRIPTION",
  "ITEM_SPECIFICS",
  "SHIPPING",
  "RETURNS",
  "PAYMENT",
  "PROMOTION",
] as const)

export type MayelTradingProtectedField =
  (typeof MAYEL_TRADING_PROTECTED_FIELDS)[number]

export type MayelTradingImageHostClass =
  | "EBAY_EPS"
  | "APPROVED_MAYEL_STORAGE"
  | "EXTERNAL"
  | "OTHER"

export type MayelTradingVisualDryRunV1 = Readonly<{
  executorImplemented: true
  executorRoute: typeof MAYEL_TRADING_VISUAL_EXECUTOR_V1
  mediaPreparationRoute: typeof MAYEL_TRADING_MEDIA_PREPARATION_ROUTE
  tradingVisualWriteOperation: typeof MAYEL_TRADING_VISUAL_WRITE_OPERATION
  pictureSetWriteSemantics: "FULL_ORDERED_REPLACEMENT"
  mainImageSemantics: "PICTURE_URL_POSITION_1"
  allowedDiffDomain: typeof MAYEL_TRADING_VISUAL_ALLOWED_DIFF_DOMAIN
  currentImageCount: number
  proposedImageCount: number
  currentHeroPreserved: boolean
  mayelAssetHostClassBefore: MayelTradingImageHostClass
  mayelAssetHostClassForWrite: "EBAY_EPS"
  proposedImageSetValid: boolean
  mainImageChange: boolean
  protectedFieldsUnchanged: boolean
  unauthorizedFieldDiffCount: number
  singleWriteGuardActive: true
  ambiguousWriteRetryDisabled: true
  mediaPreparationAvailable: boolean
  mediaPreparationAuthorized: boolean
  safeToExecuteVisualChange: boolean
  blocker: string | null
  currentImageDigest: string
  proposedSourceImageDigest: string
  preparationBindingDigest: string
  finalIdempotencyBindingReady: false
}>

type DryRunInput = {
  accountKey: string
  itemId: string
  manifestId: string
  manifestDigest: string
  managementModel: string
  correctEbayApi: string | null
  accountIdentityProven: boolean
  listingIdentityProven: boolean
  listingActive: boolean
  manifestValid: boolean
  visualOnlyDiff: boolean
  unauthorizedFieldDiffs: readonly string[]
  currentOfficialImageUrls: readonly string[]
  expectedCurrentImageDigest: string
  proposedSourceImageUrls: readonly string[]
  mayelAssetUrl: string
  mayelAssetAuthorized: boolean
  approvedMayelStorageUrl: (url: string) => boolean
  pictureSource: string | null
  mediaPreparationAvailable: boolean
  mediaPreparationAuthorized: boolean
  durableReviseAttemptCount: number
}

type ExactPictureSetInput = {
  currentOfficialImageUrls: readonly string[]
  proposedSourceImageUrls: readonly string[]
  mayelAssetUrl: string
  preparedMayelEpsUrl: string
}

type DelegatedPictureSetInput = {
  currentOfficialImageUrls: readonly string[]
  proposedSourceImageUrls: readonly string[]
  preparedAssets: readonly Readonly<{
    sourceUrl: string
    epsImageUrl: string
  }>[]
}

type MediaPreparationResult = Readonly<{
  imageId: string
  epsImageUrl: string
  expirationDate: string | null
  sourceImageDigest: string
  mediaReceiptDigest: string
}>

export type TradingVisualWriteResultV1 = Readonly<{
  status: "ACCEPTED" | "REJECTED" | "AMBIGUOUS"
  httpStatus: number | null
  ebayErrorId: string | null
  ack: string | null
  reviseCallCount: 1
  retryAllowed: false
  readbackRequired: boolean
}>

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]))
}

function canonicalDigest(value: unknown) {
  return sha256(JSON.stringify(canonical(value)))
}

function exactUuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value.trim()) ? value.trim() : null
}

function exactDigest(value: unknown) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
    ? value : null
}

function exactItemId(value: unknown) {
  return typeof value === "string" && /^\d{9,20}$/.test(value)
    ? value : null
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function xmlTagValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  ))
  return match?.[1]?.replace(/<[^>]*>/g, " ").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim() || null
}

export function classifyMayelTradingImageHostV1(
  value: string,
  approvedMayelStorageUrl: (url: string) => boolean = () => false,
): MayelTradingImageHostClass {
  if (approvedMayelStorageUrl(value)) return "APPROVED_MAYEL_STORAGE"
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return "OTHER"
    }
    const host = url.hostname.toLowerCase()
    if (host === "ebayimg.com" || host.endsWith(".ebayimg.com")) {
      return "EBAY_EPS"
    }
    return host ? "EXTERNAL" : "OTHER"
  } catch { return "OTHER" }
}

export function buildMayelTradingVisualIdempotencyBindingV1(input: {
  accountKey: string
  itemId: string
  manifestId: string
  manifestDigest: string
  beforeImageDigest: string
  proposedImageDigest: string
  operation?: typeof MAYEL_TRADING_VISUAL_WRITE_OPERATION
}) {
  if (!input.accountKey || !exactItemId(input.itemId)
    || !exactUuid(input.manifestId) || !exactDigest(input.manifestDigest)
    || !exactDigest(input.beforeImageDigest)
    || !exactDigest(input.proposedImageDigest)
    || (input.operation ?? MAYEL_TRADING_VISUAL_WRITE_OPERATION) !==
      MAYEL_TRADING_VISUAL_WRITE_OPERATION) {
    throw new Error("MAYEL_TRADING_VISUAL_IDEMPOTENCY_BINDING_INVALID")
  }
  return canonicalDigest({ account: input.accountKey,
    itemId: input.itemId, manifestId: input.manifestId,
    manifestDigest: input.manifestDigest,
    beforeImageDigest: input.beforeImageDigest,
    proposedImageDigest: input.proposedImageDigest,
    operation: MAYEL_TRADING_VISUAL_WRITE_OPERATION })
}

/**
 * Builds the fail-closed dry-run contract. The proposed source set is exact,
 * but the approved Mayel source URL is deliberately not sent to Trading. At
 * execution time it must first resolve through Media API to an EPS URL.
 */
export function buildMayelTradingVisualDryRunV1(
  input: DryRunInput,
): MayelTradingVisualDryRunV1 {
  const current = input.currentOfficialImageUrls.map(
    normalizeOfficialTradingPictureUrlV1)
  const proposedSource = input.proposedSourceImageUrls.map(
    normalizeOfficialTradingPictureUrlV1)
  const currentValid = current.every((url): url is string => url !== null)
  const proposedValid = proposedSource.every(
    (url): url is string => url !== null)
  const currentUrls = currentValid ? current as string[] : []
  const proposedSourceUrls = proposedValid ? proposedSource as string[] : []
  const currentReadback = buildOfficialTradingPictureReadbackV1(currentUrls)
  const currentImageDigest = currentReadback.officialImageSetDigest
  const proposedSourceImageDigest = proposedValid
    ? buildOfficialTradingPictureReadbackV1(proposedSourceUrls)
      .officialImageSetDigest
    : sha256("INVALID_PROPOSED_SOURCE_IMAGE_SET")
  const assetHostBefore = classifyMayelTradingImageHostV1(
    input.mayelAssetUrl, input.approvedMayelStorageUrl)
  const currentAllEps = currentUrls.length > 0 && currentUrls.every((url) =>
    classifyMayelTradingImageHostV1(url) === "EBAY_EPS")
  const pictureSourceCompatible = input.pictureSource === null
    ? currentAllEps
    : input.pictureSource.toUpperCase() === "EPS" && currentAllEps
  const mainImageChange = Boolean(currentUrls[0]
    && proposedSourceUrls[0] !== currentUrls[0])
  const mayelCount = proposedSourceUrls.filter((url) =>
    url === normalizeOfficialTradingPictureUrlV1(input.mayelAssetUrl)).length
  const exactCanarySet = currentUrls.length === 1
    && proposedSourceUrls.length === 2
    && proposedSourceUrls[0] === currentUrls[0]
    && proposedSourceUrls[1] ===
      normalizeOfficialTradingPictureUrlV1(input.mayelAssetUrl)
    && mayelCount === 1
    && new Set(proposedSourceUrls).size === proposedSourceUrls.length
  const unauthorizedFieldDiffCount = input.unauthorizedFieldDiffs.length
  const protectedFieldsUnchanged = unauthorizedFieldDiffCount === 0
  const preparationBindingDigest = canonicalDigest({
    account: input.accountKey,
    itemId: input.itemId,
    manifestId: input.manifestId,
    manifestDigest: input.manifestDigest,
    beforeImageDigest: currentImageDigest,
    proposedSourceImageDigest,
    operation: MAYEL_TRADING_VISUAL_WRITE_OPERATION,
  })
  let blocker: string | null = null
  if (input.managementModel !== "TRADING_MANAGED"
    || input.correctEbayApi !== "TRADING_API") {
    blocker = "MAYEL_TRADING_VISUAL_WRONG_MANAGEMENT_ROUTE"
  } else if (!input.accountIdentityProven || !input.listingIdentityProven
    || !input.listingActive) {
    blocker = "MAYEL_TRADING_VISUAL_IDENTITY_UNPROVEN"
  } else if (!exactItemId(input.itemId) || !exactUuid(input.manifestId)
    || !exactDigest(input.manifestDigest)) {
    blocker = "MAYEL_TRADING_VISUAL_BINDING_INVALID"
  } else if (!currentValid || currentUrls.length === 0
    || currentImageDigest !== input.expectedCurrentImageDigest) {
    blocker = "SAFE_REBASE_REQUIRED"
  } else if (!input.manifestValid) {
    blocker = "MAYEL_TRADING_VISUAL_MANIFEST_INVALID"
  } else if (!input.visualOnlyDiff || !protectedFieldsUnchanged) {
    blocker = "MAYEL_TRADING_VISUAL_NON_VISUAL_DIFF_BLOCKED"
  } else if (!input.mayelAssetAuthorized
    || assetHostBefore !== "APPROVED_MAYEL_STORAGE") {
    blocker = "MAYEL_TRADING_VISUAL_ASSET_UNPROVEN"
  } else if (!pictureSourceCompatible) {
    blocker = "MAYEL_TRADING_VISUAL_MIXED_HOSTING_BLOCKED"
  } else if (!input.mediaPreparationAvailable
    || !input.mediaPreparationAuthorized) {
    blocker = "MAYEL_TRADING_VISUAL_MEDIA_PREPARATION_UNAVAILABLE"
  } else if (!exactCanarySet || proposedSourceUrls.length > 24) {
    blocker = "MAYEL_TRADING_VISUAL_PROPOSED_SET_INVALID"
  } else if (mainImageChange) {
    blocker = "MAYEL_TRADING_VISUAL_MAIN_IMAGE_CHANGED"
  } else if (input.durableReviseAttemptCount !== 0) {
    blocker = "MAYEL_TRADING_VISUAL_SECOND_WRITE_BLOCKED"
  }
  return Object.freeze({
    executorImplemented: true,
    executorRoute: MAYEL_TRADING_VISUAL_EXECUTOR_V1,
    mediaPreparationRoute: MAYEL_TRADING_MEDIA_PREPARATION_ROUTE,
    tradingVisualWriteOperation: MAYEL_TRADING_VISUAL_WRITE_OPERATION,
    pictureSetWriteSemantics: "FULL_ORDERED_REPLACEMENT",
    mainImageSemantics: "PICTURE_URL_POSITION_1",
    allowedDiffDomain: MAYEL_TRADING_VISUAL_ALLOWED_DIFF_DOMAIN,
    currentImageCount: currentUrls.length,
    proposedImageCount: proposedSourceUrls.length,
    currentHeroPreserved: !mainImageChange && currentUrls.length > 0,
    mayelAssetHostClassBefore: assetHostBefore,
    mayelAssetHostClassForWrite: "EBAY_EPS",
    proposedImageSetValid: blocker === null,
    mainImageChange,
    protectedFieldsUnchanged,
    unauthorizedFieldDiffCount,
    singleWriteGuardActive: true,
    ambiguousWriteRetryDisabled: true,
    mediaPreparationAvailable: input.mediaPreparationAvailable,
    mediaPreparationAuthorized: input.mediaPreparationAuthorized,
    safeToExecuteVisualChange: blocker === null,
    blocker,
    currentImageDigest,
    proposedSourceImageDigest,
    preparationBindingDigest,
    // Media API must first return the exact EPS URL. Only then can the exact
    // proposed image digest and final write idempotency binding be computed.
    finalIdempotencyBindingReady: false,
  })
}

/** Resolves the one approved source image to an official EPS URL. */
export async function prepareMayelAssetWithEbayMediaV1(input: {
  accessToken: string
  sourceImageUrl: string
  approvedMayelStorageUrl: (url: string) => boolean
  fetchImpl?: FetchLike
}): Promise<MediaPreparationResult> {
  if (!input.accessToken || !input.approvedMayelStorageUrl(input.sourceImageUrl)) {
    throw new Error("MAYEL_TRADING_MEDIA_PREPARATION_INPUT_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const createUrl = `${MAYEL_TRADING_MEDIA_IMAGE_ENDPOINT}/create_image_from_url`
  const created = await fetchImpl(createUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl: input.sourceImageUrl }),
    cache: "no-store",
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  })
  const createdBody = await created.json().catch(() => ({})) as
    Record<string, unknown>
  if (created.status !== 201) {
    throw new Error(`MAYEL_TRADING_MEDIA_CREATE_HTTP_${created.status}`)
  }
  const location = created.headers.get("location") ?? ""
  let imageId = ""
  try {
    // eBay may return either an absolute resource URI or the same official
    // resource path relative to the Media API origin. Both identify the same
    // created resource; accepting the relative form avoids losing a durable
    // 201 response and accidentally preparing the same source again.
    const url = new URL(location, `${MAYEL_TRADING_MEDIA_IMAGE_ENDPOINT}/`)
    const hostAllowed = url.hostname === "api.ebay.com"
      || url.hostname === "apim.ebay.com"
    const matched = url.pathname.match(
      /^\/commerce\/media\/v1_beta\/image\/([A-Za-z0-9_-]{1,200})\/?$/)
    if (url.protocol === "https:" && hostAllowed && matched) imageId = matched[1]
  } catch { imageId = "" }
  if (!imageId && typeof createdBody.imageId === "string"
    && /^[A-Za-z0-9_-]{1,200}$/.test(createdBody.imageId)) {
    imageId = createdBody.imageId
  }
  if (!imageId) {
    const createdEpsUrl = normalizeOfficialTradingPictureUrlV1(
      createdBody.imageUrl)
    if (createdEpsUrl
      && classifyMayelTradingImageHostV1(createdEpsUrl) === "EBAY_EPS") {
      try {
        const epsUrl = new URL(createdEpsUrl)
        imageId = epsUrl.pathname.match(
          /^\/00\/s\/[A-Za-z0-9_-]+\/z\/([A-Za-z0-9_-]{1,200})\//)
          ?.[1] ?? ""
      } catch { imageId = "" }
    }
  }
  if (!imageId) throw new Error("MAYEL_TRADING_MEDIA_IMAGE_ID_MISSING")
  const getUrl = `${MAYEL_TRADING_MEDIA_IMAGE_ENDPOINT}/${encodeURIComponent(imageId)}`
  const readback = await fetchImpl(getUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  })
  const readbackBody = await readback.json().catch(() => ({})) as
    Record<string, unknown>
  if (!readback.ok) {
    throw new Error(`MAYEL_TRADING_MEDIA_READBACK_HTTP_${readback.status}`)
  }
  const epsImageUrl = normalizeOfficialTradingPictureUrlV1(
    readbackBody.imageUrl ?? createdBody.imageUrl)
  if (!epsImageUrl
    || classifyMayelTradingImageHostV1(epsImageUrl) !== "EBAY_EPS") {
    throw new Error("MAYEL_TRADING_MEDIA_EPS_URL_INVALID")
  }
  const expirationDate = typeof readbackBody.expirationDate === "string"
    ? readbackBody.expirationDate : typeof createdBody.expirationDate === "string"
      ? createdBody.expirationDate : null
  return Object.freeze({ imageId, epsImageUrl, expirationDate,
    sourceImageDigest: sha256(input.sourceImageUrl),
    mediaReceiptDigest: canonicalDigest({ imageId, epsImageUrl,
      expirationDate, sourceImageDigest: sha256(input.sourceImageUrl),
      route: MAYEL_TRADING_MEDIA_PREPARATION_ROUTE }) })
}

export function buildExactMayelTradingPictureSetV1(
  input: ExactPictureSetInput,
) {
  const current = input.currentOfficialImageUrls.map(
    normalizeOfficialTradingPictureUrlV1)
  const proposed = input.proposedSourceImageUrls.map(
    normalizeOfficialTradingPictureUrlV1)
  const mayelSource = normalizeOfficialTradingPictureUrlV1(input.mayelAssetUrl)
  const mayelEps = normalizeOfficialTradingPictureUrlV1(
    input.preparedMayelEpsUrl)
  if (current.some((url) => url === null) || proposed.some((url) => url === null)
    || !mayelSource || !mayelEps
    || classifyMayelTradingImageHostV1(mayelEps) !== "EBAY_EPS") {
    throw new Error("MAYEL_TRADING_VISUAL_EXACT_SET_INVALID")
  }
  const currentUrls = current as string[]
  const proposedSourceUrls = proposed as string[]
  const exact = proposedSourceUrls.map((url) =>
    url === mayelSource ? mayelEps : url)
  if (currentUrls.length !== 1 || exact.length !== 2
    || exact[0] !== currentUrls[0] || exact[1] !== mayelEps
    || !exact.every((url) =>
      classifyMayelTradingImageHostV1(url) === "EBAY_EPS")
    || new Set(exact).size !== exact.length) {
    throw new Error("MAYEL_TRADING_VISUAL_EXACT_SET_INVALID")
  }
  return Object.freeze({
    pictureUrls: Object.freeze(exact),
    imageSetDigest: buildOfficialTradingPictureReadbackV1(exact)
      .officialImageSetDigest,
    mainImageUnchanged: true as const,
    mayelAssetPresent: true as const,
    pictureSource: "EPS" as const,
  })
}

/**
 * Resolves a Mayel-controlled ordered gallery into the exact all-EPS set that
 * Trading accepts. Unlike the historical 1 -> 2 canary contract, this shared
 * delegated contract supports the complete ordered manifest and a delegated
 * hero change while retaining the same fail-closed image-only boundary.
 */
export function buildDelegatedMayelTradingPictureSetV1(
  input: DelegatedPictureSetInput,
) {
  const current = input.currentOfficialImageUrls.map(
    normalizeOfficialTradingPictureUrlV1)
  const proposed = input.proposedSourceImageUrls.map(
    normalizeOfficialTradingPictureUrlV1)
  if (current.some((url) => url === null) || current.length < 1
    || proposed.some((url) => url === null)
    || proposed.length < 1 || proposed.length > 24) {
    throw new Error("MAYEL_TRADING_VISUAL_DELEGATED_SET_INVALID")
  }
  const prepared = new Map<string, string>()
  for (const value of input.preparedAssets) {
    const source = normalizeOfficialTradingPictureUrlV1(value.sourceUrl)
    const eps = normalizeOfficialTradingPictureUrlV1(value.epsImageUrl)
    if (!source || !eps
      || classifyMayelTradingImageHostV1(source) === "EBAY_EPS"
      || classifyMayelTradingImageHostV1(source) === "OTHER"
      || classifyMayelTradingImageHostV1(eps) !== "EBAY_EPS"
      || prepared.has(source)) {
      throw new Error("MAYEL_TRADING_VISUAL_DELEGATED_SET_INVALID")
    }
    prepared.set(source, eps)
  }
  const exact = (proposed as string[]).map((url) =>
    classifyMayelTradingImageHostV1(url) === "EBAY_EPS"
      ? url : prepared.get(url) ?? "")
  if (exact.some((url) => classifyMayelTradingImageHostV1(url) !== "EBAY_EPS")
    || new Set(exact).size !== exact.length
    || prepared.size < 1
    || [...prepared.keys()].some((source) => !(proposed as string[])
      .includes(source))) {
    throw new Error("MAYEL_TRADING_VISUAL_DELEGATED_SET_INVALID")
  }
  const currentUrls = current as string[]
  return Object.freeze({
    pictureUrls: Object.freeze(exact),
    imageSetDigest: buildOfficialTradingPictureReadbackV1(exact)
      .officialImageSetDigest,
    mainImageChanged: exact[0] !== currentUrls[0],
    heroPositionMatchExpected: true as const,
    preparedAssetCount: prepared.size,
    pictureSource: "EPS" as const,
  })
}

export function buildReviseFixedPriceItemPicturesOnlyXmlV1(input: {
  itemId: string
  pictureUrls: readonly string[]
}) {
  if (!exactItemId(input.itemId) || input.pictureUrls.length < 1
    || input.pictureUrls.length > 24
    || new Set(input.pictureUrls).size !== input.pictureUrls.length
    || !input.pictureUrls.every((url) =>
      normalizeOfficialTradingPictureUrlV1(url) === url
      && classifyMayelTradingImageHostV1(url) === "EBAY_EPS")
    || input.pictureUrls.reduce((sum, url) => sum + url.length, 0) > 3_975) {
    throw new Error("MAYEL_TRADING_VISUAL_WRITE_SET_INVALID")
  }
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<ReviseFixedPriceItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<Item><ItemID>${input.itemId}</ItemID>` +
    "<PictureDetails><PictureSource>EPS</PictureSource>" +
    input.pictureUrls.map((url) =>
      `<PictureURL>${xmlEscape(url)}</PictureURL>`).join("") +
    "</PictureDetails></Item></ReviseFixedPriceItemRequest>"
}

export function assertMayelTradingProtectedFieldsUnchangedV1(input: {
  differences: readonly string[]
}) {
  const normalized = [...new Set(input.differences.map((value) =>
    String(value).trim().toUpperCase()).filter(Boolean))]
  if (normalized.length > 0) {
    throw new Error("MAYEL_TRADING_VISUAL_NON_VISUAL_DIFF_BLOCKED")
  }
  return Object.freeze({ protectedFieldsUnchanged: true as const,
    unauthorizedFieldDiffCount: 0 as const,
    protectedFields: MAYEL_TRADING_PROTECTED_FIELDS })
}

export async function reviseMayelTradingPicturesOnceV1(input: {
  accessToken: string
  itemId: string
  pictureUrls: readonly string[]
  durableReviseAttemptCount: number
  idempotencyBindingDigest: string
  durableSingleWriteClaim: Readonly<{
    claimed: true
    claimToken: string
    idempotencyBindingDigest: string
    reviseCallOrdinal: 1
  }>
  fetchImpl?: FetchLike
}): Promise<TradingVisualWriteResultV1> {
  if (!input.accessToken || !exactDigest(input.idempotencyBindingDigest)) {
    throw new Error("MAYEL_TRADING_VISUAL_WRITE_BINDING_INVALID")
  }
  if (input.durableReviseAttemptCount !== 0) {
    throw new Error("MAYEL_TRADING_VISUAL_SECOND_WRITE_BLOCKED")
  }
  if (input.durableSingleWriteClaim.claimed !== true
    || !exactUuid(input.durableSingleWriteClaim.claimToken)
    || input.durableSingleWriteClaim.idempotencyBindingDigest !==
      input.idempotencyBindingDigest
    || input.durableSingleWriteClaim.reviseCallOrdinal !== 1) {
    throw new Error("MAYEL_TRADING_VISUAL_DURABLE_CLAIM_REQUIRED")
  }
  const body = buildReviseFixedPriceItemPicturesOnlyXmlV1({
    itemId: input.itemId, pictureUrls: input.pictureUrls })
  const fetchImpl = input.fetchImpl ?? fetch
  let response: Response
  let responseXml = ""
  try {
    response = await fetchImpl(TRADING_ENDPOINT, { method: "POST",
      headers: { "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": MAYEL_TRADING_VISUAL_WRITE_OPERATION,
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
        "X-EBAY-API-SITEID": TRADING_SITE_ID_US,
        "X-EBAY-API-IAF-TOKEN": input.accessToken },
      body, cache: "no-store",
      signal: AbortSignal.timeout(TRADING_WRITE_TIMEOUT_MS) })
    responseXml = await response.text()
  } catch {
    return Object.freeze({ status: "AMBIGUOUS", httpStatus: null,
      ebayErrorId: null, ack: null, reviseCallCount: 1,
      retryAllowed: false, readbackRequired: true })
  }
  const ack = xmlTagValue(responseXml, "Ack")
  const errorId = xmlTagValue(responseXml, "ErrorCode")
  const accepted = response.ok
    && ["success", "warning"].includes(ack?.toLowerCase() ?? "")
  const ambiguous = response.status >= 500 || !ack
  return Object.freeze({
    status: accepted ? "ACCEPTED" : ambiguous ? "AMBIGUOUS" : "REJECTED",
    httpStatus: response.status,
    ebayErrorId: /^\d{1,20}$/.test(errorId ?? "") ? errorId : null,
    ack,
    reviseCallCount: 1,
    retryAllowed: false,
    readbackRequired: accepted || ambiguous,
  })
}
