export const EBAY_PRO_PRODUCTION_ISOLATION_VERSION =
  "EBAY_PRO_PRODUCTION_ISOLATION_FAST_V1"

export const EBAY_PRO_BLOCKED_IN_PRODUCTION_PATHS = [
  "/admin/market-radar",
  "/admin/ebay-seller-os",
  "/admin/ebay-listing",
  "/admin/ebay-listing-package",
  "/admin/ebay-listings",
  "/admin/ebay-image-generator",
  "/api/admin/market-radar",
  "/api/admin/ebay-winner-pipeline",
  "/api/admin/active-listing-risks",
  "/api/admin/ebay/oauth",
]

type EbayProBoundaryInput = {
  vercelEnv?: string | null
  nodeEnv?: string | null
  ebayProRuntime?: string | null
  pathname?: string | null
}

function normalizeValue(
  value: string | null | undefined
) {
  return (
    value?.trim().toLowerCase() ||
    ""
  )
}

export function isEbayProPath(
  pathname: string | null | undefined
) {
  const cleanPathname =
    pathname?.trim() || "/"

  return EBAY_PRO_BLOCKED_IN_PRODUCTION_PATHS.some(
    blockedPath =>
      cleanPathname === blockedPath ||
      cleanPathname.startsWith(
        `${blockedPath}/`
      )
  )
}

export function getEbayProRuntimeBoundary(
  input: EbayProBoundaryInput = {}
) {
  const vercelEnv =
    normalizeValue(
      input.vercelEnv ??
        process.env.VERCEL_ENV
    )
  const nodeEnv =
    normalizeValue(
      input.nodeEnv ??
        process.env.NODE_ENV
    )
  const ebayProRuntime =
    normalizeValue(
      input.ebayProRuntime ??
        process.env.EBAY_PRO_RUNTIME
    )
  const pathname =
    input.pathname || "/"

  const runtimeAllowsEbayPro =
    ebayProRuntime === "staging" ||
    ebayProRuntime === "local_vm_lab" ||
    ebayProRuntime === "development"

  const runtimeBlocksEbayPro =
    ebayProRuntime === "production_core" ||
    ebayProRuntime === "production"

  const isProductionRuntime =
    runtimeBlocksEbayPro ||
    (
      !runtimeAllowsEbayPro &&
      (
        vercelEnv === "production" ||
        (
          !vercelEnv &&
          nodeEnv === "production"
        )
      )
    )

  const isBlockedPath =
    isEbayProPath(
      pathname
    )

  return {
    isolationVersion:
      EBAY_PRO_PRODUCTION_ISOLATION_VERSION,
    productionCoreProtected:
      true,
    runtime:
      isProductionRuntime
        ? "production_core"
        : runtimeAllowsEbayPro
          ? ebayProRuntime
          : "development_or_preview",
    isProductionRuntime,
    isEbayProPath:
      isBlockedPath,
    ebayProAllowed:
      !(
        isProductionRuntime &&
        isBlockedPath
      ),
    blocked:
      isProductionRuntime &&
      isBlockedPath,
    blockedPaths:
      EBAY_PRO_BLOCKED_IN_PRODUCTION_PATHS,
  }
}

export function isEbayProAllowed(
  input: EbayProBoundaryInput = {}
) {
  return getEbayProRuntimeBoundary(
    input
  ).ebayProAllowed
}

export function getBlockedEbayProResponsePayload(
  pathname: string
) {
  return {
    error:
      "ebay_pro_disabled_in_production",
    message:
      "eBay Professional Seller Suite is available in staging/lab only.",
    productionCoreProtected:
      true,
    pathname,
    isolationVersion:
      EBAY_PRO_PRODUCTION_ISOLATION_VERSION,
  }
}
