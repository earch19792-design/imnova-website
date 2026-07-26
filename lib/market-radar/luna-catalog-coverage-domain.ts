import { createHash } from "node:crypto"

export const LUNA_CATALOG_COVERAGE_MANIFEST_VERSION =
  "LUNA_CATALOG_COVERAGE_V1_2026_07_26"
export const LUNA_CATALOG_HYDRATION_CURSOR_VERSION =
  "LUNA_INVENTORY_ROUND_ROBIN_V1_2026_07_26"

export type LunaCatalogCoverageStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "TRUNCATED"
  | "FAILED"

export type LunaCatalogPageCheckpoint = {
  collection: string
  page: number
  pageLimit: number
  maxPages: number
  receivedProducts: number
  uniqueProducts: number
  uniqueVariants: number
  missingIdentityCount: number
  duplicateProductCount: number
  collisionCount: number
  attempts: number
  sourceObservedAt: string
  fetchedAt: string
  checksum: string
  etag: string | null
  errorCode: string | null
}

export type LunaCatalogPersistedPage<T> = {
  checkpoint: LunaCatalogPageCheckpoint
  products: T[]
}

export function buildLunaCatalogResumeState<T>(
  persistedPages: LunaCatalogPersistedPage<T>[]
) {
  const ordered = [...persistedPages]
    .sort(
      (left, right) =>
        left.checkpoint.page -
        right.checkpoint.page
    )
  const pages: LunaCatalogPageCheckpoint[] = []
  const products: T[] = []
  let nextPage = 1
  let terminal = false

  for (const persisted of ordered) {
    const checkpoint =
      persisted.checkpoint
    if (checkpoint.page < nextPage) {
      continue
    }
    if (
      checkpoint.page !== nextPage ||
      checkpoint.errorCode
    ) {
      break
    }
    pages.push(checkpoint)
    products.push(...persisted.products)
    nextPage += 1
    terminal =
      checkpoint.page >= checkpoint.maxPages ||
      checkpoint.receivedProducts <
        checkpoint.pageLimit
    if (terminal) {
      nextPage =
        checkpoint.maxPages + 1
      break
    }
  }

  return {
    nextPage,
    terminal,
    pages,
    products,
  }
}

export type LunaCatalogCollectionCoverage = {
  collection: string
  status: LunaCatalogCoverageStatus
  expectedTotal: number | null
  receivedProducts: number
  uniqueProducts: number
  uniqueVariants: number
  missingIdentityCount: number
  duplicateProductCount: number
  collisionCount: number
  lastPage: number
  lastPageProductCount: number
  pageLimit: number
  maxPages: number
  sourceObservedAt: string
  fetchedAt: string
  checksum: string
  errorCode: string | null
  pages: LunaCatalogPageCheckpoint[]
}

export type LunaCatalogCoverageManifest = {
  manifestVersion: typeof LUNA_CATALOG_COVERAGE_MANIFEST_VERSION
  status: LunaCatalogCoverageStatus
  expectedProducts: number | null
  receivedProducts: number
  uniqueProducts: number
  uniqueVariants: number
  missingIdentityCount: number
  duplicateProductCount: number
  collisionCount: number
  coveragePercent: number | null
  sourceObservedAt: string
  fetchedAt: string
  checksum: string
  collections: LunaCatalogCollectionCoverage[]
}

function finiteNonNegativeInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key =>
      `${JSON.stringify(key)}:${stableStringify(record[key])}`
    ).join(",")}}`
  }
  return JSON.stringify(value)
}

export function lunaCatalogChecksum(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

export function safeLunaCatalogErrorCode(value: unknown) {
  const candidate = value instanceof Error
    ? value.message
    : typeof value === "string" ? value : ""
  return /^[A-Z0-9_]{3,120}$/.test(candidate)
    ? candidate
    : "LUNA_CATALOG_FETCH_FAILED"
}

export function isRetryableLunaStatus(status: number) {
  return status === 429 || [500, 502, 503, 504].includes(status)
}

export function lunaRetryDelayMs(input: {
  attempt: number
  retryAfter?: string | null
  nowMs?: number
  jitterUnit?: number
  baseDelayMs?: number
  maximumDelayMs?: number
}) {
  const maximumDelayMs = Math.max(1_000, input.maximumDelayMs ?? 30_000)
  const retryAfterSeconds = Number(input.retryAfter)
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(maximumDelayMs, Math.round(retryAfterSeconds * 1_000))
  }
  if (input.retryAfter) {
    const retryAt = Date.parse(input.retryAfter)
    const nowMs = input.nowMs ?? Date.now()
    if (Number.isFinite(retryAt) && retryAt > nowMs) {
      return Math.min(maximumDelayMs, retryAt - nowMs)
    }
  }
  const attempt = Math.max(0, Math.trunc(input.attempt))
  const base = Math.max(100, input.baseDelayMs ?? 500)
  const jitter = Math.max(0, Math.min(1, input.jitterUnit ?? 0.5))
  return Math.min(
    maximumDelayMs,
    Math.round(base * (2 ** attempt) + base * jitter),
  )
}

export function evaluateLunaCatalogExecutionWindow(input: {
  nowMs: number
  deadlineAtMs: number
  pagesProcessed: number
  maxPages: number
  minimumRemainingMs: number
}) {
  const remainingMs = Math.max(
    0,
    Math.trunc(input.deadlineAtMs - input.nowMs),
  )
  const pageBudgetReached =
    input.pagesProcessed >= Math.max(1, Math.trunc(input.maxPages))
  const deadlineReached =
    remainingMs <= Math.max(0, Math.trunc(input.minimumRemainingMs))
  return {
    canStartNextPage:
      !pageBudgetReached && !deadlineReached,
    remainingMs,
    reason:
      pageBudgetReached
        ? "PAGE_LIMIT" as const
        : deadlineReached
          ? "DEADLINE" as const
          : null,
  }
}

export function evaluateLunaCollectionCoverage(input: {
  collection: string
  expectedTotal?: number | null
  pages: LunaCatalogPageCheckpoint[]
}): LunaCatalogCollectionCoverage {
  const pages = [...input.pages].sort((left, right) => left.page - right.page)
  const expectedTotal = finiteNonNegativeInteger(input.expectedTotal)
  const receivedProducts = pages.reduce((sum, page) => sum + page.receivedProducts, 0)
  const uniqueProducts = pages.reduce((sum, page) => sum + page.uniqueProducts, 0)
  const uniqueVariants = pages.reduce((sum, page) => sum + page.uniqueVariants, 0)
  const missingIdentityCount = pages.reduce((sum, page) => sum + page.missingIdentityCount, 0)
  const duplicateProductCount = pages.reduce((sum, page) => sum + page.duplicateProductCount, 0)
  const collisionCount = pages.reduce((sum, page) => sum + page.collisionCount, 0)
  const lastPage = pages.at(-1)
  const errorPage = pages.find(page => page.errorCode)
  const reachedHardLimitWithFullPage = Boolean(
    lastPage &&
    lastPage.page === lastPage.maxPages &&
    lastPage.receivedProducts >= lastPage.pageLimit,
  )
  const status: LunaCatalogCoverageStatus = receivedProducts === 0
    ? "FAILED"
    : reachedHardLimitWithFullPage
      ? "TRUNCATED"
      : errorPage
        ? "PARTIAL"
        : expectedTotal !== null &&
            uniqueProducts >= expectedTotal &&
            Boolean(lastPage && lastPage.receivedProducts < lastPage.pageLimit)
          ? "COMPLETE"
          // A short final page is useful but not an authoritative total.
          : "PARTIAL"
  return {
    collection: input.collection,
    status,
    expectedTotal,
    receivedProducts,
    uniqueProducts,
    uniqueVariants,
    missingIdentityCount,
    duplicateProductCount,
    collisionCount,
    lastPage: lastPage?.page ?? 0,
    lastPageProductCount: lastPage?.receivedProducts ?? 0,
    pageLimit: lastPage?.pageLimit ?? 0,
    maxPages: lastPage?.maxPages ?? 0,
    sourceObservedAt: lastPage?.sourceObservedAt ?? new Date(0).toISOString(),
    fetchedAt: lastPage?.fetchedAt ?? new Date(0).toISOString(),
    checksum: lunaCatalogChecksum(pages.map(page => page.checksum)),
    errorCode: errorPage?.errorCode ?? null,
    pages,
  }
}

export function buildLunaCatalogCoverageManifest(input: {
  collections: LunaCatalogCollectionCoverage[]
  uniqueProducts: number
  uniqueVariants: number
}): LunaCatalogCoverageManifest {
  const collections = [...input.collections]
    .sort((left, right) => left.collection.localeCompare(right.collection))
  const allFailed = collections.length === 0 ||
    collections.every(collection => collection.status === "FAILED")
  const anyTruncated = collections.some(collection => collection.status === "TRUNCATED")
  const allComplete = collections.length > 0 &&
    collections.every(collection => collection.status === "COMPLETE")
  const status: LunaCatalogCoverageStatus = allFailed
    ? "FAILED"
    : anyTruncated
      ? "TRUNCATED"
      : allComplete
        ? "COMPLETE"
        : "PARTIAL"
  const expectedTotals = collections.map(collection => collection.expectedTotal)
  const expectedProducts = expectedTotals.every(
    (value): value is number => value !== null,
  )
    ? expectedTotals.reduce((sum, value) => sum + value, 0)
    : null
  const coveragePercent = expectedProducts && expectedProducts > 0
    ? Number(Math.min(100, (input.uniqueProducts / expectedProducts) * 100).toFixed(2))
    : null
  return {
    manifestVersion: LUNA_CATALOG_COVERAGE_MANIFEST_VERSION,
    status,
    expectedProducts,
    receivedProducts: collections.reduce((sum, collection) => sum + collection.receivedProducts, 0),
    uniqueProducts: input.uniqueProducts,
    uniqueVariants: input.uniqueVariants,
    missingIdentityCount: collections.reduce((sum, collection) => sum + collection.missingIdentityCount, 0),
    duplicateProductCount: collections.reduce((sum, collection) => sum + collection.duplicateProductCount, 0),
    collisionCount: collections.reduce((sum, collection) => sum + collection.collisionCount, 0),
    coveragePercent,
    sourceObservedAt: collections.map(collection => collection.sourceObservedAt).sort().at(-1) ??
      new Date(0).toISOString(),
    fetchedAt: collections.map(collection => collection.fetchedAt).sort().at(-1) ??
      new Date(0).toISOString(),
    checksum: lunaCatalogChecksum(collections.map(collection => ({
      collection: collection.collection,
      checksum: collection.checksum,
    }))),
    collections,
  }
}

export function selectLunaRoundRobinWindow<T>(input: {
  candidates: T[]
  cursor: number
  limit: number
  key: (candidate: T) => string
}) {
  const candidates = [...input.candidates]
    .sort((left, right) => input.key(left).localeCompare(input.key(right)))
  if (!candidates.length) {
    return { selected: [] as T[], startCursor: 0, nextCursor: 0, total: 0 }
  }
  const limit = Math.max(1, Math.min(Math.trunc(input.limit), candidates.length))
  const startCursor = (
    (Math.trunc(input.cursor) % candidates.length) + candidates.length
  ) % candidates.length
  const selected = Array.from(
    { length: limit },
    (_, index) => candidates[(startCursor + index) % candidates.length],
  )
  return {
    selected,
    startCursor,
    nextCursor: (startCursor + limit) % candidates.length,
    total: candidates.length,
  }
}

export function mergeLunaVariantSets<T>(
  current: T[],
  incoming: T[],
  identity: (variant: T, index: number) => string,
) {
  const merged = new Map<string, T>()
  current.forEach((variant, index) => merged.set(identity(variant, index), variant))
  incoming.forEach((variant, index) => {
    const key = identity(variant, current.length + index)
    const previous = merged.get(key)
    merged.set(
      key,
      previous && typeof previous === "object" && typeof variant === "object"
        ? { ...previous, ...variant }
        : variant,
    )
  })
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, variant]) => variant)
}
