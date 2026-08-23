import { createHash } from "node:crypto"

export const SELLER_OS_LUNA_IDENTITY_VERIFICATION_VERSION =
  "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1" as const

const TARGET_BRAND = Symbol("SELLER_OS_LUNA_IDENTITY_VERIFICATION_TARGET_V1")
const FIXED_LUNA_HOSTS = new Set(["lunaportex.com", "www.lunaportex.com"])
const SAFE_REFERENCE = /^[A-Za-z0-9_.:\/-]{1,240}$/
const NUMERIC_ID = /^\d{1,30}$/
const MAXIMUM_VARIANTS = 500
const MAXIMUM_OPTIONS = 12

type JsonRecord = Record<string, unknown>

export type SellerOsLunaIdentityVerificationClassificationV1 =
  | "EXACT_UNIQUE_MATCH"
  | "AMBIGUOUS_MATCH"
  | "CONFLICTING_MATCH"
  | "NO_MATCH"
  | "IDENTITY_EVIDENCE_INCOMPLETE"

export type SellerOsLunaIdentityVerificationTargetV1 = Readonly<{
  currentCohortId: string
  candidateId: string
  candidateEvidenceDigest: string
  ebayItemId: string
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  canonicalSourceUrl: string
}>

type BrandedTarget = SellerOsLunaIdentityVerificationTargetV1 & Readonly<{
  [TARGET_BRAND]: true
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function safeText(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const result = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  return result || null
}

function exactKeys(value: object, expected: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",")
}

function canonicalLunaProductUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) {
    throw new Error("LUNA_IDENTITY_TARGET_URL_REJECTED")
  }
  let parsed: URL
  try { parsed = new URL(value) } catch {
    throw new Error("LUNA_IDENTITY_TARGET_URL_REJECTED")
  }
  const pathname = parsed.pathname.replace(/\/$/, "")
  const encodedHandle = pathname.startsWith("/products/")
    ? pathname.slice("/products/".length) : ""
  let decodedHandle = ""
  try { decodedHandle = decodeURIComponent(encodedHandle) } catch {
    throw new Error("LUNA_IDENTITY_TARGET_URL_REJECTED")
  }
  if (parsed.protocol !== "https:" || !FIXED_LUNA_HOSTS.has(parsed.hostname) ||
      parsed.username || parsed.password || parsed.port || parsed.search ||
      parsed.hash || !encodedHandle || encodedHandle.length > 600 ||
      decodedHandle.length > 240 || encodedHandle.includes("/") ||
      decodedHandle === "." || decodedHandle === ".." ||
      /[\u0000-\u0020\u007f/\\?#%]/u.test(decodedHandle)) {
    throw new Error("LUNA_IDENTITY_TARGET_URL_REJECTED")
  }
  parsed.pathname = pathname
  return parsed.toString()
}

function assertReference(value: unknown, code: string) {
  if (typeof value !== "string" || !SAFE_REFERENCE.test(value)) {
    throw new Error(code)
  }
  return value
}

/**
 * This factory is intended only for the server-side canonical repository.
 * The non-enumerable symbol prevents request JSON from masquerading as a
 * resolved target, while the exact-key check rejects caller secret/URL extras.
 */
export function createSellerOsLunaIdentityVerificationTargetV1(
  input: SellerOsLunaIdentityVerificationTargetV1,
): SellerOsLunaIdentityVerificationTargetV1 {
  if (!input || typeof input !== "object" || !exactKeys(input, [
    "currentCohortId", "candidateId", "candidateEvidenceDigest", "ebayItemId",
    "lunaProductId", "lunaVariantId", "lunaSku", "canonicalSourceUrl",
  ]) || !/^\d{9,19}$/.test(input.ebayItemId) ||
      !NUMERIC_ID.test(input.lunaProductId) ||
      !NUMERIC_ID.test(input.lunaVariantId)) {
    throw new Error("LUNA_IDENTITY_TARGET_INVALID")
  }
  const lunaSku = safeText(input.lunaSku, 120)
  if (!lunaSku) throw new Error("LUNA_IDENTITY_TARGET_INVALID")
  const canonicalSourceUrl = canonicalLunaProductUrl(input.canonicalSourceUrl)
  const target = {
    currentCohortId: assertReference(input.currentCohortId,
      "LUNA_IDENTITY_TARGET_INVALID"),
    candidateId: assertReference(input.candidateId,
      "LUNA_IDENTITY_TARGET_INVALID"),
    candidateEvidenceDigest: assertReference(input.candidateEvidenceDigest,
      "LUNA_IDENTITY_TARGET_INVALID"),
    ebayItemId: input.ebayItemId,
    lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId,
    lunaSku,
  } as unknown as SellerOsLunaIdentityVerificationTargetV1 &
    Partial<BrandedTarget>
  Object.defineProperty(target, "canonicalSourceUrl", {
    value: canonicalSourceUrl, enumerable: false, configurable: false,
    writable: false,
  })
  Object.defineProperty(target, TARGET_BRAND, {
    value: true, enumerable: false, configurable: false, writable: false,
  })
  return Object.freeze(target) as BrandedTarget
}

export function isSellerOsLunaIdentityVerificationTargetV1(
  value: unknown,
): value is SellerOsLunaIdentityVerificationTargetV1 {
  return Boolean(value && typeof value === "object" &&
    (value as Partial<BrandedTarget>)[TARGET_BRAND] === true)
}

export function sellerOsLunaIdentityProductJsonUrlV1(
  target: SellerOsLunaIdentityVerificationTargetV1,
) {
  if (!isSellerOsLunaIdentityVerificationTargetV1(target)) {
    throw new Error("LUNA_IDENTITY_TARGET_NOT_SERVER_RESOLVED")
  }
  return `${canonicalLunaProductUrl(target.canonicalSourceUrl)}.js`
}

function optionNames(payload: JsonRecord) {
  if (!Array.isArray(payload.options) || payload.options.length > MAXIMUM_OPTIONS) {
    return [] as string[]
  }
  return payload.options.flatMap((entry) => {
    const candidate = typeof entry === "string" ? entry : record(entry).name
    const name = safeText(candidate, 80)
    return name ? [name] : []
  })
}

function optionValues(variant: JsonRecord) {
  if (Array.isArray(variant.options)) {
    if (variant.options.length > MAXIMUM_OPTIONS) return [] as string[]
    return variant.options.flatMap((entry) => {
      const value = safeText(entry, 120)
      return value ? [value] : []
    })
  }
  return [variant.option1, variant.option2, variant.option3].flatMap((entry) => {
    const value = safeText(entry, 120)
    return value ? [value] : []
  })
}

function normalizedVariant(value: unknown, names: readonly string[]) {
  const variant = record(value)
  const id = String(variant.id ?? "")
  const sku = safeText(variant.sku, 120)
  if (!NUMERIC_ID.test(id) || !sku) return null
  const title = safeText(variant.title, 240) ?? "Default Title"
  const values = optionValues(variant)
  const structuredVariantAttributes = values.slice(0, MAXIMUM_OPTIONS)
    .map((optionValue, index) => Object.freeze({
      name: names[index] ?? `OPTION_${index + 1}`,
      value: optionValue,
    }))
    .filter((attribute) =>
      attribute.value.toLocaleLowerCase("en-US") !== "default title")
  return Object.freeze({
    id,
    sku,
    title,
    barcode: safeText(variant.barcode, 120),
    model: safeText(variant.model ?? variant.mpn, 120),
    structuredVariantAttributes: Object.freeze(structuredVariantAttributes),
  })
}

function digest(value: unknown) {
  return `luna-identity-v1:sha256:${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex")}`
}

function safeObservedAt(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error("LUNA_IDENTITY_CLOCK_INVALID")
  return new Date(parsed).toISOString()
}

/**
 * Parses only supplier identity facts. Commerce facts in the upstream Shopify
 * document are deliberately never accessed, spread, returned, or hashed.
 */
export function buildSellerOsLunaIdentityVerificationEvidenceV1(input: Readonly<{
  target: SellerOsLunaIdentityVerificationTargetV1
  payload: unknown
  observedAt: string
}>) {
  if (!isSellerOsLunaIdentityVerificationTargetV1(input.target)) {
    throw new Error("LUNA_IDENTITY_TARGET_NOT_SERVER_RESOLVED")
  }
  const observedAt = safeObservedAt(input.observedAt)
  const payload = record(input.payload)
  const productId = String(payload.id ?? "")
  const productTitle = safeText(payload.title, 240)
  const handle = safeText(payload.handle, 240)
  if (!NUMERIC_ID.test(productId) || !productTitle || !handle ||
      !Array.isArray(payload.variants) ||
      payload.variants.length < 1 || payload.variants.length > MAXIMUM_VARIANTS) {
    throw new Error("LUNA_IDENTITY_PARSE_CONTRACT_CHANGED")
  }
  const sourcePath = new URL(input.target.canonicalSourceUrl).pathname
  const expectedHandle = decodeURIComponent(sourcePath.slice("/products/".length))
  const names = optionNames(payload)
  const variants = payload.variants.map((variant) =>
    normalizedVariant(variant, names)).filter((variant) => variant !== null)
  if (!variants.length || variants.length !== payload.variants.length) {
    throw new Error("LUNA_IDENTITY_PARSE_CONTRACT_CHANGED")
  }
  const exact = variants.filter((variant) =>
    variant.id === input.target.lunaVariantId &&
    variant.sku === input.target.lunaSku)
  const variantIdMatches = variants.filter((variant) =>
    variant.id === input.target.lunaVariantId)
  const skuMatches = variants.filter((variant) =>
    variant.sku === input.target.lunaSku)
  const productMatches = productId === input.target.lunaProductId &&
    handle === expectedHandle
  let classification: SellerOsLunaIdentityVerificationClassificationV1
  if (!productMatches) classification = "CONFLICTING_MATCH"
  else if (exact.length > 1) classification = "AMBIGUOUS_MATCH"
  else if (exact.length === 1) classification = "EXACT_UNIQUE_MATCH"
  else if (variantIdMatches.length || skuMatches.length) {
    classification = "CONFLICTING_MATCH"
  } else classification = "NO_MATCH"

  const matched = productMatches && exact.length === 1 ? exact[0] : null
  const defaultTitleOnly = Boolean(matched &&
    matched.title.toLocaleLowerCase("en-US") === "default title" &&
    matched.structuredVariantAttributes.length === 0)
  const identity = Object.freeze({
    productId: productMatches ? productId : null,
    productTitle: productMatches ? productTitle : null,
    handle: productMatches ? handle : null,
    variantId: matched?.id ?? null,
    variantTitle: matched?.title ?? null,
    sku: matched?.sku ?? null,
    barcode: matched?.barcode ?? null,
    model: matched?.model ?? null,
    structuredVariantAttributes: matched?.structuredVariantAttributes ??
      Object.freeze([]),
  })
  const evidenceDigest = digest({
    contractVersion: SELLER_OS_LUNA_IDENTITY_VERIFICATION_VERSION,
    currentCohortId: input.target.currentCohortId,
    candidateId: input.target.candidateId,
    candidateEvidenceDigest: input.target.candidateEvidenceDigest,
    ebayItemId: input.target.ebayItemId,
    expected: {
      productId: input.target.lunaProductId,
      variantId: input.target.lunaVariantId,
      sku: input.target.lunaSku,
    },
    classification,
    identity,
  })
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_IDENTITY_VERIFICATION_VERSION,
    currentCohortId: input.target.currentCohortId,
    candidateId: input.target.candidateId,
    candidateEvidenceDigest: input.target.candidateEvidenceDigest,
    ebayItemId: input.target.ebayItemId,
    classification,
    currentLunaIdentity: identity,
    defaultTitleOnly,
    configurationProven: Boolean(matched &&
      matched.structuredVariantAttributes.length > 0),
    observedAt,
    evidenceDigest,
    evidenceReference: `luna-current-identity:${evidenceDigest.split(":").at(-1)}`,
    acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY" as const,
    sourceStatus: "AVAILABLE" as const,
    commerceFactsUsedForIdentity: false as const,
    rawSourceIncluded: false as const,
    sessionMaterialIncluded: false as const,
  })
}
