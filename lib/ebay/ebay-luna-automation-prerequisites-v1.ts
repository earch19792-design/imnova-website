export const SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION =
  "SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_V1" as const

export const SELLER_OS_LUNA_PROTECTED_SESSION_VERSION =
  "SELLER_OS_LUNA_PROTECTED_SESSION_V1" as const

export const SELLER_OS_LUNA_PROTECTED_SESSION_BOOTSTRAP_PATH =
  "/admin/ebay/luna-protected-session" as const

export const SELLER_OS_LUNA_PROTECTED_SESSION_STATES_V1 = Object.freeze([
  "SESSION_NOT_CONFIGURED",
  "SESSION_READY",
  "SESSION_EXPIRED",
  "AUTH_REQUIRED",
  "AUTH_FAILED",
  "SOURCE_UNAVAILABLE",
] as const)

export type SellerOsLunaProtectedSessionStateV1 =
  typeof SELLER_OS_LUNA_PROTECTED_SESSION_STATES_V1[number]

export const P2_I02A_STORAGE_READINESS_V1 = Object.freeze({
  storageReadiness: "READY" as const,
  schemaArtifactStatus: "MIGRATION_ARTIFACT_APPLIED" as const,
  schemaAppliedStatus: "APPLIED" as const,
  migrationArtifact:
    "20260821193830_create_seller_os_luna_stock_observation_storage.sql" as const,
  migrationsCreated: 1 as const,
  migrationsApplied: 1 as const,
  dataGateStatus: "TARGETED_P2_DELTA_APPLIED" as const,
  dataGateReason: "HISTORICAL_SCHEMA_DRIFT_REMAINS_OUT_OF_SCOPE" as const,
  databaseMutationAuthorized: false as const,
})

const FIXED_LUNA_HOSTS = new Set(["lunaportex.com", "www.lunaportex.com"])
const SAFE_ID = /^[A-Za-z0-9_:.\/-]{1,240}$/
const SECRET_KEY = /(?:password|cookie|authorization|credential|secret|(?:access|refresh|bearer|auth).?token|session.?value)/i

type LunaLinkageComponent = Readonly<{
  componentIdentityId: string
  productId: string
  variantId: string | null
  variantSemantics: "EXACT_VARIANT_REQUIRED" | "PRODUCT_HAS_NO_VARIANTS"
  sku: string
  canonicalSourceUrl: string
  supplierQuantityRequired: number
}>

type LunaCertifiedLinkage = Readonly<{
  linkageId: string | null
  status: string
  components: readonly LunaLinkageComponent[]
}>

function exactObjectKeys(value: object, keys: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",")
}

function assertNoCallerSecrets(value: unknown) {
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      throw new Error("LUNA_CANONICAL_SERVER_READ_CALLER_SECRET_REJECTED")
    }
    assertNoCallerSecrets(child)
  }
}

function fixedLunaProductUrl(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("LUNA_CANONICAL_SERVER_READ_URL_REJECTED")
  }
  if (parsed.protocol !== "https:" || !FIXED_LUNA_HOSTS.has(parsed.hostname) ||
      parsed.username || parsed.password || parsed.port || parsed.search ||
      parsed.hash || !/^\/products\/[A-Za-z0-9][A-Za-z0-9-]{0,220}\/?$/.test(
        parsed.pathname,
      )) {
    throw new Error("LUNA_CANONICAL_SERVER_READ_URL_REJECTED")
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "")
  return parsed.toString()
}

export function assessSellerOsLunaProtectedSessionV1(input: Readonly<{
  now: string
  secretPresent: boolean
  storage: "SUPABASE_VAULT" | "SERVER_ENV_LEGACY" | "NONE"
  serverOwned: boolean
  clientExposed: boolean
  expiresAt?: string | null
  validation:
    | "NOT_RUN"
    | "VALID"
    | "AUTH_REQUIRED"
    | "AUTH_FAILED"
    | "SOURCE_UNAVAILABLE"
}>) {
  const now = Date.parse(input.now)
  const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN
  let status: SellerOsLunaProtectedSessionStateV1
  if (!Number.isFinite(now) || input.clientExposed ||
      (input.secretPresent && !input.serverOwned)) {
    status = "AUTH_FAILED"
  } else if (!input.secretPresent || input.storage === "NONE") {
    status = "SESSION_NOT_CONFIGURED"
  } else if (input.expiresAt && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    status = "SESSION_EXPIRED"
  } else if (input.validation === "VALID") {
    status = "SESSION_READY"
  } else if (input.validation === "AUTH_FAILED") {
    status = "AUTH_FAILED"
  } else if (input.validation === "SOURCE_UNAVAILABLE") {
    status = "SOURCE_UNAVAILABLE"
  } else {
    status = "AUTH_REQUIRED"
  }
  const humanBootstrapRequired = [
    "SESSION_NOT_CONFIGURED", "SESSION_EXPIRED", "AUTH_REQUIRED", "AUTH_FAILED",
  ].includes(status)
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_PROTECTED_SESSION_VERSION,
    status,
    ownership: "SERVER_OWNED" as const,
    storage: input.storage,
    encryptedOrIsolated: input.storage === "SUPABASE_VAULT",
    backendOnly: input.serverOwned && !input.clientExposed,
    humanBootstrapRequired,
    bootstrapPath: humanBootstrapRequired
      ? SELLER_OS_LUNA_PROTECTED_SESSION_BOOTSTRAP_PATH : null,
    canonicalServerReadReadiness: status === "SESSION_READY"
      ? "READY_FOR_GATED_ACTIVATION" as const
      : "BLOCKED_BY_PROTECTED_SESSION" as const,
    secretsReturned: false as const,
    cookiesReturned: false as const,
    environmentValuesReturned: false as const,
    authFailureMeansStockZero: false as const,
    sourceUnavailableMeansOutOfStock: false as const,
  })
}

export function assertAllowedLunaRedirectV1(input: Readonly<{
  currentUrl: string
  location: string
}>) {
  const current = fixedLunaProductUrl(input.currentUrl)
  let redirected: string
  try {
    redirected = fixedLunaProductUrl(new URL(input.location, current).toString())
  } catch {
    throw new Error("LUNA_CANONICAL_SERVER_READ_REDIRECT_REJECTED")
  }
  const currentUrl = new URL(current)
  const redirectedUrl = new URL(redirected)
  if (redirectedUrl.pathname !== currentUrl.pathname) {
    throw new Error("LUNA_CANONICAL_SERVER_READ_REDIRECT_REJECTED")
  }
  return redirected
}

export function createSellerOsCanonicalLunaServerReadResolverV1(input: Readonly<{
  loadLinkageById: (linkageId: string) => Promise<LunaCertifiedLinkage | null>
}>) {
  return async function resolve(request: Readonly<{
    linkageId: string
    componentIdentityId: string
  }>) {
    assertNoCallerSecrets(request)
    if (!request || typeof request !== "object" ||
        !exactObjectKeys(request, ["linkageId", "componentIdentityId"]) ||
        !SAFE_ID.test(request.linkageId) ||
        !SAFE_ID.test(request.componentIdentityId)) {
      throw new Error("LUNA_CANONICAL_SERVER_READ_CALLER_INPUT_REJECTED")
    }
    const linkage = await input.loadLinkageById(request.linkageId)
    if (!linkage || linkage.status !== "CERTIFIED" ||
        linkage.linkageId !== request.linkageId) {
      throw new Error("LINKAGE_NOT_CERTIFIED")
    }
    const component = linkage.components.find((candidate) =>
      candidate.componentIdentityId === request.componentIdentityId)
    if (!component || !SAFE_ID.test(component.componentIdentityId) ||
        !component.productId || !component.sku ||
        !Number.isSafeInteger(component.supplierQuantityRequired) ||
        component.supplierQuantityRequired < 1 ||
        (component.variantSemantics === "EXACT_VARIANT_REQUIRED" &&
          !component.variantId) ||
        (component.variantSemantics === "PRODUCT_HAS_NO_VARIANTS" &&
          component.variantId !== null)) {
      throw new Error("LUNA_CANONICAL_SERVER_READ_EXACT_VARIANT_REQUIRED")
    }
    const canonicalSourceUrl = fixedLunaProductUrl(component.canonicalSourceUrl)
    return Object.freeze({
      contractVersion: SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION,
      linkageId: request.linkageId,
      componentIdentityId: component.componentIdentityId,
      lunaProductId: component.productId,
      lunaVariantId: component.variantId,
      lunaSku: component.sku,
      supplierQuantityRequired: component.supplierQuantityRequired,
      canonicalSourceUrl,
      canonicalProductJsonUrl: `${canonicalSourceUrl}.js`,
      acquisitionMethod: "CANONICAL_SERVER_READ" as const,
      requestMethod: "GET" as const,
      callerUrlAccepted: false as const,
      callerCredentialAccepted: false as const,
      callerCookieAccepted: false as const,
      mutationAllowed: false as const,
    })
  }
}

export function buildSellerOsLunaAutomationPrerequisitesStatusV1(input: Readonly<{
  session: ReturnType<typeof assessSellerOsLunaProtectedSessionV1>
}>) {
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_AUTOMATION_PREREQUISITES_VERSION,
    ...P2_I02A_STORAGE_READINESS_V1,
    lunaProtectedSessionStatus: input.session.status,
    canonicalServerReadReadiness: input.session.canonicalServerReadReadiness,
    humanBootstrapRequired: input.session.humanBootstrapRequired,
    humanBootstrapPath: input.session.bootstrapPath,
    sessionOwnership: input.session.ownership,
    sessionStorage: "SUPABASE_VAULT" as const,
    schedulerStatus: "DISABLED" as const,
    productionSchedulerEnabled: false as const,
    productionLunaPolling: 0 as const,
    p2I01Dependency: "BLOCKED" as const,
    p2I01Blocker: "EXTERNAL_EBAY_QUOTA_BLOCKER" as const,
    secretsIncluded: false as const,
    cookiesIncluded: false as const,
    environmentValuesIncluded: false as const,
  })
}
