import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { buildSellerOsRuntimeHealthAuthorityAuditV1,
  parseSellerOsRuntimeHealthAuthorityV1 } = await import(
  "./runtime-health-authority-v1.ts")

function health(status = "HEALTHY") {
  const observedAt = "2026-09-07T01:30:00.000Z"
  const service = (name) => ({ service: name, status,
    activeState: status === "HEALTHY" ? "active" : null,
    subState: status === "HEALTHY" ? "running" : null,
    result: status === "HEALTHY" ? "success" : null,
    mainPid: status === "HEALTHY" ? 123 : null, restartCount: 0,
    activeEnterTimestamp: "2026-09-05T15:46:13.000Z" })
  return { contractVersion: "SELLER_OS_RUNTIME_HEALTH_V1", observedAt,
    overallStatus: status,
    services: { mcp: service("imnova-seller-os-mcp.service"),
      tunnel: service("imnova-seller-os-tunnel.service"),
      watchdogTimer: { service: "imnova-seller-os-watchdog.timer", status,
        activeState: status === "HEALTHY" ? "active" : null,
        subState: status === "HEALTHY" ? "waiting" : null,
        lastTrigger: "2026-09-07T01:28:40.000Z",
        nextTrigger: "2026-09-07T01:30:40.000Z" } },
    port3000: { host: "127.0.0.1", port: 3000,
      status: status === "HEALTHY" ? "AVAILABLE" : "UNKNOWN", observedAt },
    watchdog: { lastRunAt: "2026-09-07T01:28:40.000Z",
      lastSuccessAt: status === "HEALTHY"
        ? "2026-09-07T01:28:40.000Z" : null,
      lastResult: status === "HEALTHY" ? "success" : null },
    runtimeCatalog: { contractVersion:
      "SELLER_OS_RUNTIME_CATALOG_ATTESTATION_V1", observedAt,
    serviceIdentity: "imnova-seller-os-mcp.service",
    runtimeEntrypointIdentity: "NEXT_APP_ROUTE_SELLER_OS_ASSISTANT_MCP",
    runtimeWorkingDirectoryIdentity: "SELLER_OS_CANONICAL_REPOSITORY",
    runtimeWorkingDirectoryMatch: status === "HEALTHY",
    loadedMcpImplementationVersion: "SELLER_OS_MCP_READONLY_V1",
    catalogSource: "MCP_SERVER_FACTORY_REGISTRATION_LEDGER",
    runtimeCatalogCount: 26, expectedCatalogCount: 26,
    officialOrdersToolPresent: true, salesOrderEventsToolPresent: true,
    recentSalesFeedToolPresent: true, saleAlertsToolPresent: true,
    whatsappSaleAlertStatusToolPresent: true,
    buyerThankYouStatusToolPresent: true,
    exactCatalogMatch: status === "HEALTHY",
    workspaceRuntimeBindingStatus: status === "HEALTHY" ? "MATCHED"
      : "UNAVAILABLE", limitations: [], safety: { readOnly: true,
      callerControlledPathAllowed: false, fileContentsIncluded: false,
      credentialsIncluded: false, environmentValuesIncluded: false } },
    evidenceCompleteness: status === "HEALTHY" ? "COMPLETE" : "UNAVAILABLE",
    limitations: [], safety: { readOnly: true, arbitraryShellAllowed: false,
      callerControlledServiceAllowed: false, credentialsIncluded: false,
      environmentValuesIncluded: false, marketplaceWrites: 0,
      inventoryWrites: 0, productCaseMutations: 0, lunaLinkMutations: 0,
      whatsappSends: 0 } }
}

test("exact runtime health contract becomes one reused integrity receipt", () => {
  const parsed = parseSellerOsRuntimeHealthAuthorityV1(health())
  assert.ok(parsed)
  const audit = buildSellerOsRuntimeHealthAuthorityAuditV1(parsed)
  assert.equal(audit.mechanismVersion, "SELLER_OS_RUNTIME_HEALTH_V1")
  assert.equal(audit.status, "PASS")
  assert.equal(audit.summary.passCount, 6)
  assert.equal(audit.summary.violationCount, 0)
  assert.equal(audit.safety.marketplaceWrites, 0)
})

test("health receipt fingerprints remain stable across observation time", () => {
  const first = health()
  const second = health()
  second.observedAt = "2026-09-07T01:32:00.000Z"
  second.port3000.observedAt = second.observedAt
  second.watchdog.lastSuccessAt = "2026-09-07T01:30:40.000Z"
  const firstAudit = buildSellerOsRuntimeHealthAuthorityAuditV1(first)
  const secondAudit = buildSellerOsRuntimeHealthAuthorityAuditV1(second)
  assert.deepEqual(firstAudit.checks.map((entry) => entry.evidenceFingerprint),
    secondAudit.checks.map((entry) => entry.evidenceFingerprint))
})

test("unobservable contract remains UNKNOWN and never becomes failure", () => {
  const parsed = parseSellerOsRuntimeHealthAuthorityV1(health("UNAVAILABLE"))
  assert.ok(parsed)
  const audit = buildSellerOsRuntimeHealthAuthorityAuditV1(parsed)
  assert.equal(audit.status, "UNKNOWN")
  assert.equal(audit.summary.violationCount, 0)
  assert.ok(audit.summary.unknownCount > 0)
})

test("wrong fixed inspection identity is rejected", () => {
  const invalid = health()
  invalid.services.mcp.service = "attacker.service"
  assert.equal(parseSellerOsRuntimeHealthAuthorityV1(invalid), null)
})

test("cloud route only ingests and reporter only performs read plus receipt post", () => {
  const route = readFileSync(new URL(
    "../../app/api/runtime/health-attestation/route.ts", import.meta.url),
  "utf8")
  const reporter = readFileSync(new URL(
    "../../ops/seller-os-runtime-health/seller-os-runtime-health-reporter.mjs",
    import.meta.url), "utf8")
  const watchdog = readFileSync(new URL(
    "../../ops/seller-os-runtime-health/imnova-seller-os-watchdog",
    import.meta.url), "utf8")
  assert.match(route, /persistSellerOsRuntimeHealthAuthorityV1/)
  assert.match(route, /sellerOsPostOnlyGetResponseV1/)
  assert.doesNotMatch(route, /collectSellerOsRuntimeHealthV1|systemctl|publishOffer/)
  assert.match(reporter, /seller_os_get_runtime_health/)
  assert.match(reporter, /x-vercel-protection-bypass/)
  assert.doesNotMatch(reporter, /process\.exit/)
  assert.match(watchdog, /systemd-run --user --quiet --collect/)
  assert.match(watchdog, /--on-active=5s/)
  assert.match(watchdog, /NODE_BIN.*node/)
  assert.doesNotMatch(watchdog, /^\s*"\$HEALTH_REPORTER"/m)
  assert.doesNotMatch(reporter, /publishOffer|ReviseFixedPriceItem|createOffer/)
})
