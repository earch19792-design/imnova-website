import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  P2_I02A_STORAGE_READINESS_V1,
  SELLER_OS_LUNA_PROTECTED_SESSION_BOOTSTRAP_PATH,
  assessSellerOsLunaProtectedSessionV1,
  assertAllowedLunaRedirectV1,
  buildSellerOsLunaAutomationPrerequisitesStatusV1,
  createSellerOsCanonicalLunaServerReadResolverV1,
} = await import("./ebay-luna-automation-prerequisites-v1.ts")

const {
  buildLunaStockCheckJobV1,
  buildLunaStockObservationSchedulerPlanV1,
  buildLunaStockObservationWindowV1,
  buildSellerOsLunaStockObservationV1,
  claimLunaStockCheckJobV1,
  createSellerOsLunaStockObservationPrebuildStatusV1,
} = await import("./ebay-luna-stock-observation-v1.ts")
const { createSellerOsLunaStockObservationRepositoryV1 } = await import(
  "./ebay-luna-stock-observation-repository-v1.ts"
)
const { createSellerOsLunaCanonicalServerReadV1 } = await import(
  "./ebay-luna-canonical-server-read-v1.ts"
)

const NOW = "2026-08-21T19:00:00.000Z"
const LINKAGE_ID =
  "luna-linkage-v1:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const COMPONENT_ID =
  "luna-component-identity-v1:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const MIGRATION_URL = new URL(
  "../../supabase/migrations/20260821193830_create_seller_os_luna_stock_observation_storage.sql",
  import.meta.url,
)
const migration = await readFile(MIGRATION_URL, "utf8")

function component(overrides = {}) {
  return {
    componentIdentityId: COMPONENT_ID,
    productId: "luna-z6",
    variantId: "luna-z6-black",
    variantSemantics: "EXACT_VARIANT_REQUIRED",
    sku: "Z6-BLACK",
    canonicalSourceUrl: "https://www.lunaportex.com/products/luna-z6",
    supplierQuantityRequired: 2,
    ...overrides,
  }
}

function linkage(status = "CERTIFIED", overrides = {}) {
  return {
    linkageId: LINKAGE_ID,
    status,
    ebayItemId: "123456789012",
    ebaySku: "EBAY-Z6-BLACK",
    components: [component()],
    bundleMode: "SINGLE_COMPONENT_MULTIPLIER",
    ...overrides,
  }
}

function resolverFor(value = linkage()) {
  return createSellerOsCanonicalLunaServerReadResolverV1({
    loadLinkageById: async (linkageId) => linkageId === LINKAGE_ID
      ? value : null,
  })
}

function session(overrides = {}) {
  return assessSellerOsLunaProtectedSessionV1({
    now: NOW,
    secretPresent: true,
    storage: "SUPABASE_VAULT",
    serverOwned: true,
    clientExposed: false,
    expiresAt: "2026-08-22T19:00:00.000Z",
    validation: "VALID",
    ...overrides,
  })
}

test("duplicate logical job insert is rejected by the frozen unique grain", () => {
  assert.match(migration,
    /unique\s*\(\s*linkage_id,\s*observation_window_start,\s*contract_version\s*\)/s)
})

test("duplicate observation insert is rejected by component and attempt grain", () => {
  assert.match(migration,
    /unique\s*\(\s*stock_check_job_id,\s*component_identity_id,\s*attempt_number\s*\)/s)
})

test("two workers cannot own the same live window", () => {
  assert.match(migration, /for update;/)
  assert.match(migration, /workflow_state = 'IN_PROGRESS'[\s\S]*lease_expires_at > p_now/)
  assert.match(migration, /'ACTIVE_LEASE'/)
})

test("lease expiry before dispatch fails the explicit verification gate", () => {
  assert.match(migration, /verify_seller_os_luna_stock_check_lease_v1/)
  assert.match(migration, /job\.lease_expires_at > p_now/)
})

test("success receipt prevents a duplicate effective dispatch", () => {
  assert.match(migration, /success_receipt_digest is not null/)
  assert.match(migration, /'SUCCESS_RECEIPT_PRESENT'/)
  assert.match(migration, /SELLER_OS_LUNA_STOCK_CHECK_RECEIPT_CONFLICT/)
})

test("contradictory observation identity fails closed", () => {
  assert.match(migration, /observation_id text primary key/)
  assert.match(migration, /seller_os_luna_stock_observations_logical_grain_unique/)
})

test("session ready is server-owned, Vault-backed, and sanitized", () => {
  const result = session()
  assert.equal(result.status, "SESSION_READY")
  assert.equal(result.ownership, "SERVER_OWNED")
  assert.equal(result.encryptedOrIsolated, true)
  assert.equal(result.secretsReturned, false)
  assert.equal(result.cookiesReturned, false)
})

test("session absent requires the safe human bootstrap route", () => {
  const result = session({ secretPresent: false, storage: "NONE",
    expiresAt: null, validation: "AUTH_REQUIRED" })
  assert.equal(result.status, "SESSION_NOT_CONFIGURED")
  assert.equal(result.humanBootstrapRequired, true)
  assert.equal(result.bootstrapPath,
    SELLER_OS_LUNA_PROTECTED_SESSION_BOOTSTRAP_PATH)
})

test("expired session is never treated as usable", () => {
  const result = session({ expiresAt: "2026-08-21T18:59:59.000Z" })
  assert.equal(result.status, "SESSION_EXPIRED")
  assert.equal(result.canonicalServerReadReadiness,
    "BLOCKED_BY_PROTECTED_SESSION")
})

test("invalid credentials state fails closed without exposing a value", () => {
  const result = session({ validation: "AUTH_FAILED" })
  assert.equal(result.status, "AUTH_FAILED")
  assert.equal(result.secretsReturned, false)
})

test("arbitrary Luna URL supplied by a caller is rejected", async () => {
  await assert.rejects(resolverFor()({ linkageId: LINKAGE_ID,
    componentIdentityId: COMPONENT_ID,
    url: "https://www.lunaportex.com/products/other" }),
  /LUNA_CANONICAL_SERVER_READ_CALLER_INPUT_REJECTED/)
})

test("non-Luna host in repository evidence is rejected", async () => {
  await assert.rejects(resolverFor(linkage("CERTIFIED", {
    components: [component({
      canonicalSourceUrl: "https://example.com/products/luna-z6",
    })],
  }))({ linkageId: LINKAGE_ID, componentIdentityId: COMPONENT_ID }),
  /LUNA_CANONICAL_SERVER_READ_URL_REJECTED/)
})

test("redirect outside the fixed host allowlist is rejected", () => {
  assert.throws(() => assertAllowedLunaRedirectV1({
    currentUrl: "https://www.lunaportex.com/products/luna-z6",
    location: "https://example.com/products/luna-z6",
  }), /LUNA_CANONICAL_SERVER_READ_REDIRECT_REJECTED/)
})

test("caller cookie is rejected before repository resolution", async () => {
  await assert.rejects(resolverFor()({ linkageId: LINKAGE_ID,
    componentIdentityId: COMPONENT_ID, cookie: "fixture=value" }),
  /LUNA_CANONICAL_SERVER_READ_CALLER_SECRET_REJECTED/)
})

test("caller credential is rejected before repository resolution", async () => {
  await assert.rejects(resolverFor()({ linkageId: LINKAGE_ID,
    componentIdentityId: COMPONENT_ID, password: "fixture" }),
  /LUNA_CANONICAL_SERVER_READ_CALLER_SECRET_REJECTED/)
})

test("raw HTML has no persistence column", () => {
  const observations = migration.match(
    /create table public\.seller_os_luna_stock_observations \([\s\S]*?\n\);/,
  )?.[0] ?? ""
  assert.doesNotMatch(observations, /raw_html|html_payload|response_body/i)
})

test("cookies are Vault-only and never exposed by the status route", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-protected-session/route.ts",
    import.meta.url,
  ), "utf8")
  assert.match(migration, /vault\.create_secret/)
  assert.match(route, /cookiesIncluded:\s*false/)
  assert.match(route, /vaultSchemaApplied:\s*true/)
  assert.doesNotMatch(route, /LUNAPORTEX_AUTH_COOKIE/)
})

test("credentials are not stored in observation tables or returned", () => {
  const observations = migration.match(
    /create table public\.seller_os_luna_stock_observations \([\s\S]*?\n\);/,
  )?.[0] ?? ""
  assert.doesNotMatch(observations, /password|credential|session_token|cookie/i)
  assert.equal(buildSellerOsLunaAutomationPrerequisitesStatusV1({
    session: session(),
  }).secretsIncluded, false)
})

test("auth failure never becomes OOS", () => {
  const result = session({ validation: "AUTH_FAILED" })
  assert.equal(result.authFailureMeansStockZero, false)
  assert.notEqual(result.status, "OBSERVED_OUT_OF_STOCK")
})

test("source unavailable never becomes quantity zero", () => {
  const result = session({ validation: "SOURCE_UNAVAILABLE" })
  assert.equal(result.status, "SOURCE_UNAVAILABLE")
  assert.equal(result.sourceUnavailableMeansOutOfStock, false)
  assert.equal("observedSupplierQuantity" in result, false)
})

test("canonical server read resolves only the exact certified variant", async () => {
  const target = await resolverFor()({ linkageId: LINKAGE_ID,
    componentIdentityId: COMPONENT_ID })
  assert.equal(target.lunaVariantId, "luna-z6-black")
  assert.equal(target.lunaSku, "Z6-BLACK")
  assert.equal(target.supplierQuantityRequired, 2)
  assert.equal(target.canonicalProductJsonUrl,
    "https://www.lunaportex.com/products/luna-z6.js")
})

test("bounded server read preserves exact variant, quantity, and multiplier", async () => {
  const requestedUrls = []
  const read = createSellerOsLunaCanonicalServerReadV1({
    loadLinkageById: async () => linkage(),
    readFixedProduct: async (url) => {
      requestedUrls.push(url)
      return {
        productId: "luna-z6",
        variants: [{ id: "luna-z6-black", sku: "Z6-BLACK",
          available: true, sourceInventoryQuantity: 7,
          sourceInventoryQuantityExplicit: true }],
        sourceMode: "AUTHENTICATED_SERVER_HTTP",
        sourceSessionHealth: "SESSION_OK",
        sourceParserVersion: "FIXTURE_V1",
        sourceEvidenceFingerprint: `luna_authenticated_${"d".repeat(40)}`,
      }
    },
    now: () => NOW,
  })
  const result = await read({ linkageId: LINKAGE_ID,
    componentIdentityId: COMPONENT_ID })
  assert.deepEqual(requestedUrls,
    ["https://www.lunaportex.com/products/luna-z6"])
  assert.equal(result.lunaVariantId, "luna-z6-black")
  assert.equal(result.observedSupplierQuantity, 7)
  assert.equal(result.supplierQuantityRequired, 2)
  assert.equal(result.safeSalesCapacity, null)
  assert.equal(result.productionObservationPersisted, false)
})

test("missing exact variant fails closed instead of falling back to parent", async () => {
  const read = createSellerOsLunaCanonicalServerReadV1({
    loadLinkageById: async () => linkage(),
    readFixedProduct: async () => ({
      productId: "luna-z6",
      variants: [{ id: "luna-z6-white", sku: "Z6-WHITE",
        available: true, sourceInventoryQuantity: 10,
        sourceInventoryQuantityExplicit: true }],
      sourceMode: "AUTHENTICATED_SERVER_HTTP",
      sourceSessionHealth: "SESSION_OK",
      sourceParserVersion: "FIXTURE_V1",
      sourceEvidenceFingerprint: `luna_authenticated_${"e".repeat(40)}`,
    }),
    now: () => NOW,
  })
  await assert.rejects(read({ linkageId: LINKAGE_ID,
    componentIdentityId: COMPONENT_ID }), /LUNA_VARIANT_NOT_FOUND/)
})

test("supplier-stated unavailable signal never becomes certified OOS", async () => {
  const read = createSellerOsLunaCanonicalServerReadV1({
    loadLinkageById: async () => linkage(),
    readFixedProduct: async () => ({
      productId: "luna-z6",
      variants: [{ id: "luna-z6-black", sku: "Z6-BLACK",
        available: false, sourceInventoryQuantity: 0,
        sourceInventoryQuantityExplicit: true }],
      sourceMode: "AUTHENTICATED_SERVER_HTTP",
      sourceSessionHealth: "SESSION_OK",
      sourceParserVersion: "FIXTURE_V1",
      sourceEvidenceFingerprint: `luna_authenticated_${"f".repeat(40)}`,
    }),
    now: () => NOW,
  })
  const result = await read({ linkageId: LINKAGE_ID,
    componentIdentityId: COMPONENT_ID })
  assert.equal(result.supplierStatedAvailability, false)
  assert.equal(result.observedSupplierQuantity, 0)
  assert.equal(result.certifiedOos, false)
})

test("uncertified linkage is blocked", async () => {
  await assert.rejects(resolverFor(linkage("CANDIDATE"))({
    linkageId: LINKAGE_ID, componentIdentityId: COMPONENT_ID,
  }), /LINKAGE_NOT_CERTIFIED/)
})

test("scheduler stays disabled while P2-I01 is blocked", () => {
  const plan = buildLunaStockObservationSchedulerPlanV1({
    linkages: [linkage()], now: NOW, p2I01GateCertified: false,
  })
  assert.equal(plan.schedulerStatus, "DISABLED")
  assert.equal(plan.productionSchedulerEnabled, false)
  assert.equal(plan.dispatchableJobCount, 0)
})

test("claim replay retains one effective active worker", () => {
  const job = buildLunaStockCheckJobV1({
    linkage: linkage(),
    observationWindow: buildLunaStockObservationWindowV1({ now: NOW }),
  })
  const first = claimLunaStockCheckJobV1({ job, workerId: "worker-one",
    now: NOW })
  const second = claimLunaStockCheckJobV1({ job, workerId: "worker-two",
    now: NOW, existingLease: first.lease })
  assert.equal(first.claimStatus, "CLAIMED")
  assert.equal(second.claimStatus, "ALREADY_CLAIMED")
})

test("failure observations preserve UNKNOWN and omit zero", () => {
  const job = buildLunaStockCheckJobV1({ linkage: linkage(),
    observationWindow: buildLunaStockObservationWindowV1({ now: NOW }) })
  const result = buildSellerOsLunaStockObservationV1({
    job, componentIdentityId: COMPONENT_ID, attemptNumber: 1,
    observedAt: NOW, failure: new Error("LUNA_NETWORK_ERROR"),
  })
  assert.equal(result.observedSupplierQuantity, null)
  assert.notEqual(result.observationState, "OBSERVED_OUT_OF_STOCK")
  assert.equal(result.downstreamDecision.certifiedOos, false)
})

test("RLS and explicit grants make both tables service-role only", () => {
  for (const table of ["seller_os_luna_stock_check_jobs",
    "seller_os_luna_stock_observations"]) {
    assert.match(migration, new RegExp(
      `alter table public\\.${table} force row level security`,
    ))
    assert.match(migration, new RegExp(
      `revoke all on table public\\.${table}[\\s\\S]*?anon, authenticated, service_role`,
    ))
  }
  assert.doesNotMatch(migration, /grant\s+.+\s+to\s+(?:anon|authenticated)/i)
})

test("targeted storage artifact is applied without activating Luna", () => {
  assert.equal(P2_I02A_STORAGE_READINESS_V1.schemaArtifactStatus,
    "MIGRATION_ARTIFACT_APPLIED")
  assert.equal(P2_I02A_STORAGE_READINESS_V1.schemaAppliedStatus,
    "APPLIED")
  assert.equal(P2_I02A_STORAGE_READINESS_V1.storageReadiness,
    "READY")
  assert.equal(P2_I02A_STORAGE_READINESS_V1.migrationsApplied, 1)
  assert.equal(P2_I02A_STORAGE_READINESS_V1.databaseMutationAuthorized, false)
})

test("durable repository is inert until called and uses only fixed RPCs", async () => {
  const calls = []
  const repository = createSellerOsLunaStockObservationRepositoryV1({
    rpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { data: parameters.p_stock_check_job_id, error: null }
    },
  })
  assert.equal(calls.length, 0)
  const prepared = buildLunaStockCheckJobV1({ linkage: linkage(),
    observationWindow: buildLunaStockObservationWindowV1({ now: NOW }) })
  await repository.ensureJob({
    accountKey: `seller:${"c".repeat(64)}`,
    job: prepared,
  })
  assert.equal(calls[0].name, "ensure_seller_os_luna_stock_check_job_v1")
  assert.equal(Object.keys(calls[0].parameters).some((key) =>
    /url|cookie|credential|password|html/i.test(key)), false)
})

test("repository rejects a contradictory durable identity result", async () => {
  const repository = createSellerOsLunaStockObservationRepositoryV1({
    rpc: async () => ({ data: "contradictory", error: null }),
  })
  const prepared = buildLunaStockCheckJobV1({ linkage: linkage(),
    observationWindow: buildLunaStockObservationWindowV1({ now: NOW }) })
  await assert.rejects(repository.ensureJob({
    accountKey: `seller:${"c".repeat(64)}`,
    job: prepared,
  }), /SELLER_OS_LUNA_STOCK_JOB_IDENTITY_CONFLICT/)
})

test("PREBUILD safety remains zero-write and zero-send", () => {
  const status = createSellerOsLunaStockObservationPrebuildStatusV1({
    observedAt: NOW,
  })
  for (const key of ["productionLunaPolling", "lunaMutations",
    "marketplaceWrites", "ebayPauseWrites", "ebayReviseWrites",
    "inventoryWrites", "productCaseMutations", "whatsappSends",
    "buyerMessageSends", "paymentTransactions"]) {
    assert.equal(status.safety[key], 0, key)
  }
  assert.equal(status.safety.lunaCredentialsIncluded, false)
  assert.equal(status.safety.cookiesIncluded, false)
  assert.equal(status.safety.environmentValuesIncluded, false)
  assert.equal(status.safety.buyerPiiIncluded, false)
})
