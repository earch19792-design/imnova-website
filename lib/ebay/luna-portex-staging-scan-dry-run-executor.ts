export const LUNA_PORTEX_STAGING_SCAN_DRY_RUN_EXECUTOR_VERSION =
  "LUNA_PORTEX_STAGING_SCAN_DRY_RUN_EXECUTOR_V1"

export const LUNA_PORTEX_STAGING_SCAN_TYPES = {
  PRE_BASELINE_DEMO:
    "PRE_BASELINE_DEMO",
  FIRST_REAL_LUNA_PORTEX_SCAN:
    "FIRST_REAL_LUNA_PORTEX_SCAN",
} as const

type LunaPortexCatalogItem = {
  sourceId?: string | null
  sourceName?: string | null
  scanType?: string | null
  title?: string | null
  category?: string | null
  estimatedCost?: number | null
  estimatedRetailPrice?: number | null
  stockStatus?: string | null
  stockQuantity?: number | null
  currency?: string | null
  notes?: string | null
}

type DryRunInput = {
  catalog?: LunaPortexCatalogItem[] | null
  maxProductsPerDryRun?: number | null
}

const defaultMaxProductsPerDryRun = 20

const safetyChecklist = [
  "confirm Production remains Core-only and off-limits",
  "confirm Staging write paths remain disabled in this loop",
  "exclude PRE_BASELINE_DEMO records",
  "classify eligible records as FIRST_REAL_LUNA_PORTEX_SCAN previews",
  "generate candidate previews without persistence",
  "keep VM/Lab disconnected",
  "keep seller alerts in dry-run mode",
  "avoid all external calls",
] as const

function toNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

export function shouldExcludePreBaselineDemo(item: LunaPortexCatalogItem = {}) {
  return item.scanType === LUNA_PORTEX_STAGING_SCAN_TYPES.PRE_BASELINE_DEMO
}

export function normalizeLunaPortexCatalogItem(
  item: LunaPortexCatalogItem = {},
) {
  const estimatedCost =
    toNumberOrNull(item.estimatedCost)
  const estimatedRetailPrice =
    toNumberOrNull(item.estimatedRetailPrice)
  const stockQuantity =
    toNumberOrNull(item.stockQuantity)
  const stockStatus =
    normalizeText(item.stockStatus) ?? "unknown"
  const warnings = []

  if (normalizeText(item.title) === null) {
    warnings.push("missing title")
  }

  if (normalizeText(item.category) === null) {
    warnings.push("missing category")
  }

  if (estimatedCost === null) {
    warnings.push("missing estimated cost")
  }

  if (estimatedRetailPrice === null) {
    warnings.push("missing estimated retail price")
  }

  if (stockStatus === "unknown") {
    warnings.push("missing stock status")
  }

  return {
    sourceId:
      normalizeText(item.sourceId) ?? "unknown-source-id",
    sourceName:
      normalizeText(item.sourceName) ?? "Luna Portex fixture",
    scanType:
      item.scanType === LUNA_PORTEX_STAGING_SCAN_TYPES.PRE_BASELINE_DEMO
        ? LUNA_PORTEX_STAGING_SCAN_TYPES.PRE_BASELINE_DEMO
        : LUNA_PORTEX_STAGING_SCAN_TYPES.FIRST_REAL_LUNA_PORTEX_SCAN,
    title:
      normalizeText(item.title),
    category:
      normalizeText(item.category),
    estimatedCost,
    estimatedRetailPrice,
    stockStatus,
    stockQuantity:
      stockQuantity ?? 0,
    currency:
      normalizeText(item.currency) ?? "USD",
    notes:
      normalizeText(item.notes),
    warnings,
  }
}

export function buildDryRunCandidatePreview(
  item: ReturnType<typeof normalizeLunaPortexCatalogItem>,
) {
  const estimatedMargin =
    item.estimatedRetailPrice !== null && item.estimatedCost !== null
      ? Number((item.estimatedRetailPrice - item.estimatedCost).toFixed(2))
      : null
  const stockReady =
    item.stockStatus === "in_stock" && item.stockQuantity > 0
  const reviewRequired =
    item.warnings.length > 0 || stockReady === false

  return {
    sourceId:
      item.sourceId,
    title:
      item.title,
    category:
      item.category,
    scanType:
      LUNA_PORTEX_STAGING_SCAN_TYPES.FIRST_REAL_LUNA_PORTEX_SCAN,
    previewOnly:
      true,
    persistCandidate:
      false,
    estimatedMargin,
    stockReady,
    reviewRequired,
    warnings:
      [...item.warnings],
  }
}

export function summarizeDryRunResult(
  result: ReturnType<typeof runLunaPortexStagingScanDryRun>,
) {
  return {
    dryRunVersion:
      result.dryRunVersion,
    totalInput:
      result.totalInput,
    excludedPreBaselineDemo:
      result.excludedPreBaselineDemo,
    normalizedCount:
      result.normalizedItems.length,
    candidatePreviewCount:
      result.candidatePreviews.length,
    warnings:
      [...result.warnings],
    safetyFlags:
      { ...result.safetyFlags },
  }
}

export function getDryRunSafetyChecklist() {
  return [...safetyChecklist]
}

export function runLunaPortexStagingScanDryRun(input: DryRunInput = {}) {
  const maxProductsPerDryRun =
    Math.min(
      Math.max(input.maxProductsPerDryRun ?? defaultMaxProductsPerDryRun, 0),
      defaultMaxProductsPerDryRun,
    )
  const catalog =
    Array.isArray(input.catalog) ? input.catalog : []
  const excluded =
    catalog.filter(shouldExcludePreBaselineDemo)
  const eligible =
    catalog
      .filter((item) => shouldExcludePreBaselineDemo(item) === false)
      .slice(0, maxProductsPerDryRun)
  const normalizedItems =
    eligible.map(normalizeLunaPortexCatalogItem)
  const candidatePreviews =
    normalizedItems
      .filter(
        (item) =>
          item.scanType ===
          LUNA_PORTEX_STAGING_SCAN_TYPES.FIRST_REAL_LUNA_PORTEX_SCAN,
      )
      .map(buildDryRunCandidatePreview)
  const warnings =
    normalizedItems.flatMap((item) =>
      item.warnings.map((warning) => `${item.sourceId}: ${warning}`),
    )

  return {
    dryRunVersion:
      LUNA_PORTEX_STAGING_SCAN_DRY_RUN_EXECUTOR_VERSION,
    status:
      "STAGING_SCAN_DRY_RUN_COMPLETED_WITHOUT_WRITES",
    mode:
      "LOCAL_FIXTURE_ONLY_NO_DB_WRITES",
    totalInput:
      catalog.length,
    excludedPreBaselineDemo:
      excluded.length,
    normalizedItems,
    candidatePreviews,
    warnings,
    safetyChecklist:
      getDryRunSafetyChecklist(),
    safetyFlags:
      {
        noProductionWrites:
          true,
        noStagingWrites:
          true,
        noDbConnections:
          true,
        noExternalCalls:
          true,
        noVmConnection:
          true,
        noMarketplaceApi:
          true,
        noOpenAi:
          true,
        noMessagingDelivery:
          true,
        persistCandidates:
          false,
      },
  }
}
