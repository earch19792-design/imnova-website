export const EBAY_PRO_PRODUCTION_ISOLATION_VERSION =
  "EBAY_PRO_PRODUCTION_ISOLATION_FAST_V1"
export const EBAY_SELLER_OS_CANONICAL_BOUNDARY_VERSION =
  "EBAY_SELLER_OS_CANONICAL_BOUNDARY_V2"
export const SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION =
  "SELLER_OS_DEDICATED_PREPROD"

const SELLER_OS_DEDICATED_PREPROD_PROJECT_ID =
  "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222"
const SELLER_OS_DEDICATED_PREPROD_PRODUCTION_URL =
  "imnova-seller-os-preprod.vercel.app"
const SELLER_OS_DEDICATED_PREPROD_SUPABASE_REF =
  "vsfthqydfrdzulldbfbe"

export const EBAY_SELLER_OS_UI_PATHS = [
  "/admin/ebay-seller-os",
  "/admin/ebay/mobile-review",
  "/admin/ebay/opportunity-queue",
  "/admin/ebay/listing-workspace",
  "/admin/ebay/listing-optimization",
  "/admin/ebay/listings/register",
  "/admin/ebay/luna-protected-session",
  "/admin/ebay-image-generator",
  "/admin/ebay/seller-performance",
  "/admin/ebay/monitor",
  "/admin/ebay/copilot",
  "/admin/ebay/strategic-review",
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
  "/api/admin/ebay/monitor",
  "/api/admin/ebay/intelligence",
  "/api/admin/ebay/assistant/mcp",
  "/api/admin/ebay/copilot",
  "/api/admin/ebay/strategic-review",
  "/api/seller-os/assistant/mcp",
  "/api/seller-os/assistant/cloud-read-relay",
  "/api/admin/ebay/seller-keyword-demand",
  "/api/admin/ebay/seller-whatsapp-alerts",
  "/api/admin/ebay/commercial-monitor",
  "/api/admin/ebay/luna-opportunities",
  "/api/admin/ebay/luna-opportunity-queue",
  "/api/admin/ebay/luna-product-import",
  "/api/admin/ebay/luna-protected-session",
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
  vercelTargetEnv?: string | null
  vercelSystem?: string | null
  vercelProjectId?: string | null
  vercelProjectProductionUrl?: string | null
  nodeEnv?: string | null
  ebayProRuntime?: string | null
  supabaseUrl?: string | null
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
  | "vercelTargetEnv"
  | "vercelSystem"
  | "vercelProjectId"
  | "vercelProjectProductionUrl"
  | "nodeEnv"
  | "ebayProRuntime"
  | "supabaseUrl"
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

function supabaseProjectRef(value: string | null | undefined) {
  const candidate = rawValue(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    const suffix = ".supabase.co"
    const host = url.hostname.toLowerCase()
    const ref = host.endsWith(suffix) ? host.slice(0, -suffix.length) : ""
    const exactOrigin = url.protocol === "https:" && !url.port &&
      !url.username && !url.password && url.pathname === "/" &&
      !url.search && !url.hash
    return exactOrigin && /^[a-z0-9]{20}$/.test(ref) ? ref : null
  } catch {
    return null
  }
}

function dedicatedPreprodState(input: EbayProBoundaryInput) {
  const vercelEnv = normalizeValue(input.vercelEnv ?? process.env.VERCEL_ENV)
  const vercelTargetEnv = normalizeValue(
    input.vercelTargetEnv ?? process.env.VERCEL_TARGET_ENV,
  )
  const vercelSystem = rawValue(input.vercelSystem ?? process.env.VERCEL)
  const vercelProjectId = rawValue(
    input.vercelProjectId ?? process.env.VERCEL_PROJECT_ID,
  )
  const vercelProjectProductionUrl = normalizeValue(
    input.vercelProjectProductionUrl
      ?? process.env.VERCEL_PROJECT_PRODUCTION_URL,
  )
  const ebayProRuntime = normalizeValue(
    input.ebayProRuntime ?? process.env.EBAY_PRO_RUNTIME,
  )
  const configuredSupabaseRef = supabaseProjectRef(
    input.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  )
  const signals = {
    vercelSystem: vercelSystem === "1",
    vercelEnvironment: vercelEnv === "production",
    vercelTargetEnvironment: vercelTargetEnv === "production",
    vercelProjectId:
      vercelProjectId === SELLER_OS_DEDICATED_PREPROD_PROJECT_ID,
    vercelProjectProductionUrl:
      vercelProjectProductionUrl ===
        SELLER_OS_DEDICATED_PREPROD_PRODUCTION_URL,
    stagingRuntimeIntent: ebayProRuntime === "staging",
    stagingSupabaseProject:
      configuredSupabaseRef === SELLER_OS_DEDICATED_PREPROD_SUPABASE_REF,
  }
  const certified = Object.values(signals).every(Boolean)
  const failedSignal = Object.entries(signals)
    .find(([, matched]) => !matched)?.[0] ?? null
  return {
    classification: certified
      ? SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION
      : null,
    certified,
    failedSignal,
    signals,
  }
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
  const dedicatedPreprod = dedicatedPreprodState(input)
  const isProductionRuntime = runtimeBlocksEbayPro
    || (vercelEnv === "production" && !dedicatedPreprod.certified)
    || (!vercelEnv && !runtimeAllowsEbayPro && nodeEnv === "production")
  return {
    vercelEnv,
    nodeEnv,
    ebayProRuntime,
    boundaryClassification: dedicatedPreprod.certified
      ? SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION
      : isProductionRuntime
        ? "PRODUCTION_CORE"
        : "NON_PRODUCTION",
    dedicatedPreprod,
    isProductionRuntime,
    runtime: dedicatedPreprod.certified
      ? "seller_os_dedicated_preprod"
      : isProductionRuntime
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
    boundaryClassification: runtime.boundaryClassification,
    dedicatedPreprod: runtime.dedicatedPreprod,
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
