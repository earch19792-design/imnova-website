export const EBAY_PRO_PRODUCTION_ISOLATION_VERSION =
  "EBAY_PRO_PRODUCTION_ISOLATION_FAST_V1"
export const EBAY_SELLER_OS_CANONICAL_BOUNDARY_VERSION =
  "EBAY_SELLER_OS_CANONICAL_BOUNDARY_V2"

export const EBAY_SELLER_OS_UI_PATHS = [
  "/admin/ebay-seller-os",
  "/admin/ebay/mobile-review",
  "/admin/ebay/opportunity-queue",
  "/admin/ebay/listing-workspace",
  "/admin/ebay/listing-optimization",
  "/admin/ebay/listings/register",
  "/admin/ebay-image-generator",
  "/admin/ebay/seller-performance",
  "/admin/ebay-pro",
] as const

export const EBAY_SELLER_OS_API_PATHS = [
  "/api/admin/ebay/images",
  "/api/admin/ebay/listings/register",
  "/api/admin/ebay/draft-only",
  "/api/admin/ebay/account-policies",
  "/api/admin/ebay/active-listings/sync",
  "/api/admin/ebay/command-center",
  "/api/admin/ebay/configuration",
  "/api/admin/ebay/identity/bootstrap",
  "/api/admin/ebay/seller-performance",
  "/api/admin/ebay/seller-keyword-demand",
  "/api/admin/ebay/seller-whatsapp-alerts",
  "/api/admin/ebay/commercial-monitor",
  "/api/admin/ebay/luna-opportunities",
  "/api/admin/ebay/luna-opportunity-queue",
  "/api/admin/ebay/luna-product-import",
  "/api/admin/ebay/listing-optimization",
  "/api/admin/ebay/publication-oauth",
] as const

const LEGACY_EBAY_PRO_PATHS = [
  "/admin/market-radar",
  "/admin/ebay-listing",
  "/admin/ebay-listing-package",
  "/admin/ebay-listings",
  "/api/admin/market-radar",
  "/api/admin/ebay-winner-pipeline",
  "/api/admin/active-listing-risks",
  "/api/admin/ebay/oauth",
] as const

export const EBAY_PRO_BLOCKED_IN_PRODUCTION_PATHS = [
  ...EBAY_SELLER_OS_UI_PATHS,
  ...EBAY_SELLER_OS_API_PATHS,
  ...LEGACY_EBAY_PRO_PATHS,
] as const

type EbayProBoundaryInput = {
  vercelEnv?: string | null
  nodeEnv?: string | null
  ebayProRuntime?: string | null
  pathname?: string | null
  method?: string | null
  vercelGitCommitRef?: string | null
  allowedProductionBranch?: string | null
  draftTarget?: string | null
  draftMasterEnabled?: boolean
  draftProductionEnabled?: boolean
}

type DraftWriteBoundaryInput = Pick<
  EbayProBoundaryInput,
  | "vercelEnv"
  | "nodeEnv"
  | "ebayProRuntime"
  | "vercelGitCommitRef"
  | "allowedProductionBranch"
  | "draftTarget"
  | "draftMasterEnabled"
  | "draftProductionEnabled"
>

function normalizeValue(value: string | null | undefined) {
  return value?.trim().toLowerCase() || ""
}

function rawValue(value: string | null | undefined) {
  return value?.trim() || ""
}

function pathMatches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isEbayProPath(pathname: string | null | undefined) {
  const cleanPathname = pathname?.trim() || "/"
  return EBAY_PRO_BLOCKED_IN_PRODUCTION_PATHS.some((blockedPath) =>
    pathMatches(cleanPathname, blockedPath))
}

export function isEbaySellerOsPath(pathname: string | null | undefined) {
  const cleanPathname = pathname?.trim() || "/"
  return [...EBAY_SELLER_OS_UI_PATHS, ...EBAY_SELLER_OS_API_PATHS]
    .some((surface) => pathMatches(cleanPathname, surface))
}

function runtimeState(input: EbayProBoundaryInput) {
  const vercelEnv = normalizeValue(input.vercelEnv ?? process.env.VERCEL_ENV)
  const nodeEnv = normalizeValue(input.nodeEnv ?? process.env.NODE_ENV)
  const ebayProRuntime = normalizeValue(
    input.ebayProRuntime ?? process.env.EBAY_PRO_RUNTIME,
  )
  const runtimeAllowsEbayPro = [
    "staging",
    "local_vm_lab",
    "development",
  ].includes(ebayProRuntime)
  const runtimeBlocksEbayPro = ["production_core", "production"]
    .includes(ebayProRuntime)
  const isProductionRuntime = runtimeBlocksEbayPro
    || vercelEnv === "production"
    || (!vercelEnv && !runtimeAllowsEbayPro && nodeEnv === "production")
  return {
    vercelEnv,
    nodeEnv,
    ebayProRuntime,
    isProductionRuntime,
    runtime: isProductionRuntime
      ? "production_core"
      : runtimeAllowsEbayPro
        ? ebayProRuntime
        : vercelEnv === "preview"
          ? "preview"
          : "development_or_preview",
  }
}

export function getEbayDraftWriteEnvironmentBoundary(
  input: DraftWriteBoundaryInput = {},
) {
  const runtime = runtimeState(input)
  const target = rawValue(
    input.draftTarget ?? process.env.EBAY_DRAFT_ONLY_TARGET ?? "SANDBOX",
  ).toUpperCase()
  const allowedBranch = rawValue(
    input.allowedProductionBranch
      ?? process.env.EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH,
  )
  const gitRef = rawValue(
    input.vercelGitCommitRef ?? process.env.VERCEL_GIT_COMMIT_REF,
  )
  const masterEnabled = input.draftMasterEnabled
    ?? process.env.EBAY_DRAFT_ONLY_WRITES_ENABLED === "true"
  const productionEnabled = input.draftProductionEnabled
    ?? process.env.EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED === "true"
  const targetValid = target === "SANDBOX" || target === "PRODUCTION"
  const productionPreviewBound = target === "PRODUCTION"
    && runtime.vercelEnv === "preview"
    && Boolean(allowedBranch)
    && gitRef === allowedBranch
    && !runtime.isProductionRuntime
  const environmentAllowed = target === "SANDBOX"
    ? !runtime.isProductionRuntime
    : productionPreviewBound
  const targetEnabled = target === "SANDBOX"
    ? environmentAllowed
    : environmentAllowed && productionEnabled
  return {
    target,
    targetValid,
    masterEnabled,
    productionEnabled,
    allowedBranchConfigured: Boolean(allowedBranch),
    branchMatches: Boolean(allowedBranch) && gitRef === allowedBranch,
    environmentAllowed,
    targetEnabled,
    writeAllowed: targetValid && masterEnabled && targetEnabled,
    productionDeploymentBlocked: runtime.isProductionRuntime,
  }
}

export function getEbayProRuntimeBoundary(input: EbayProBoundaryInput = {}) {
  const runtime = runtimeState(input)
  const pathname = input.pathname || "/"
  const method = rawValue(input.method || "GET").toUpperCase()
  const isApiPath = pathname.startsWith("/api/")
  const isWriteRequest = isApiPath && !["GET", "HEAD", "OPTIONS"].includes(method)
  const isDraftOnlyRequest = pathMatches(pathname, "/api/admin/ebay/draft-only")
  const isWhatsAppRequest = pathMatches(
    pathname,
    "/api/admin/ebay/seller-whatsapp-alerts",
  )
  const isBlockedPath = isEbayProPath(pathname)
  const draftBoundary = getEbayDraftWriteEnvironmentBoundary(input)
  const previewDraftEnvironmentMismatch = isDraftOnlyRequest
    && isWriteRequest
    && draftBoundary.target === "PRODUCTION"
    && !draftBoundary.environmentAllowed
  const blocked = isBlockedPath && (
    runtime.isProductionRuntime || previewDraftEnvironmentMismatch
  )
  const accessKind = !isApiPath
    ? "ui_read"
    : !isWriteRequest
      ? "api_read"
      : isDraftOnlyRequest
        ? "draft_write_control"
        : isWhatsAppRequest
          ? "whatsapp_control"
          : "seller_os_write"

  return {
    isolationVersion: EBAY_PRO_PRODUCTION_ISOLATION_VERSION,
    productionCoreProtected: true,
    runtime: runtime.runtime,
    isProductionRuntime: runtime.isProductionRuntime,
    isEbayProPath: isBlockedPath,
    isSellerOsPath: isEbaySellerOsPath(pathname),
    isApiPath,
    isWriteRequest,
    accessKind,
    draftBoundary,
    ebayProAllowed: !blocked,
    blocked,
    blockedPaths: EBAY_PRO_BLOCKED_IN_PRODUCTION_PATHS,
  }
}

export function isEbayProAllowed(input: EbayProBoundaryInput = {}) {
  return getEbayProRuntimeBoundary(input).ebayProAllowed
}

export function getBlockedEbayProResponsePayload(pathname: string) {
  return {
    error: "ebay_pro_disabled_by_environment_boundary",
    message: "Seller OS is not available in this deployment environment.",
    productionCoreProtected: true,
    pathname,
    isolationVersion: EBAY_PRO_PRODUCTION_ISOLATION_VERSION,
  }
}
