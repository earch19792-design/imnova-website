import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, extname, join, normalize, relative, resolve } from "node:path"
import test from "node:test"

import { getEbayProRuntimeBoundary } from
  "../lib/ebay/environment-boundaries.ts"

const root = process.cwd()
const canonicalRoute = "app/api/admin/ebay/monitor/route.ts"
const canonicalPage = "app/admin/ebay/monitor/page.tsx"
const registeredRuntimeGraphAdditions = Object.freeze([
  "lib/ebay/ebay-analytics-last-known-good-v1.ts",
  "lib/ebay/ebay-current-live-authority-v1.ts",
  "lib/ebay/ebay-luna-canonical-stock-read-model-adapter-v1.ts",
  "lib/ebay/ebay-official-orders-read-v1.ts",
  "lib/ebay/ebay-sale-alerts-read-v1.ts",
  "lib/ebay/ebay-sales-order-event-foundation-v1.ts",
  "lib/ebay/ebay-sales-order-events-read-v1.ts",
  "lib/ebay/ebay-sales-order-read-model-v1.ts",
  "lib/ebay/ebay-sales-order-readonly-audit-repository-v1.ts",
  "lib/ebay/ebay-seller-os-workflow-foundation-v1.ts",
  "lib/marketplace/commercial-monitor-domain.ts",
  "lib/seller-os-access-control.ts",
])

function read(path) {
  return readFileSync(join(root, path), "utf8")
}

function resolveLocalImport(fromPath, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null
  const base = specifier.startsWith("@/")
    ? join(root, specifier.slice(2))
    : resolve(dirname(join(root, fromPath)), specifier)
  const candidates = extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.jsx`,
        `${base}.mjs`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
        join(base, "index.js"),
      ]
  const absolute = candidates.find(existsSync)
  return absolute ? normalize(relative(root, absolute)) : null
}

function localImports(path) {
  const source = read(path)
  const imports = []
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = resolveLocalImport(path, match[1])
      if (target) imports.push(target)
    }
  }
  return [...new Set(imports)]
}

function dependencyGraph(entries) {
  const pending = [...entries]
  const visited = new Set()
  while (pending.length) {
    const path = pending.shift()
    if (!path || visited.has(path)) continue
    visited.add(path)
    pending.push(...localImports(path))
  }
  return [...visited].sort()
}

const routeGraph = dependencyGraph([canonicalRoute])
const uiGraph = dependencyGraph([canonicalPage])
const runtimeGraph = [...new Set([...routeGraph, ...uiGraph])].sort()

test("la API canónica exporta GET solamente y autentica antes del cliente admin", () => {
  const route = read(canonicalRoute)
  const handlers = [...route.matchAll(
    /export\s+(?:(?:async\s+)?function|(?:const|let|var))\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
  )]
    .map((match) => match[1])
  assert.deepEqual(handlers, ["GET"])
  assert.doesNotMatch(route, /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)/)
  assert.ok(
    route.indexOf("validateAdminApiRequest(req)") <
      route.indexOf("getSupabaseAdminClient()"),
    "admin validation must precede creation of the service-role client",
  )
  assert.match(route, /Cache-Control["']:\s*["']private, no-store, max-age=0/)
  assert.match(route, /X-Commercial-Monitor-Mode["']:\s*["']READ_ONLY/)
  assert.match(route, /getEbayProRuntimeBoundary/)
  assert.match(route, /COMMERCIAL_MONITOR_PREVIEW_ONLY/)
  assert.match(route, /\^\[A-Z0-9_\]\+\$/)
})

test("el repositorio canónico sólo contiene SELECTs y ninguna ejecución externa", () => {
  const repository = read(
    "lib/ebay/commercial-monitor-readonly-repository.ts",
  )
  assert.match(repository, /\.select\(/)
  assert.doesNotMatch(
    repository,
    /\.(?:insert|update|upsert|delete|rpc)\s*\(/,
  )
  assert.doesNotMatch(repository, /\bfetch\s*\(/)
  assert.doesNotMatch(repository, /alert_delivery_outbox|commercial_alert_events/)
  const routeRuntime = routeGraph.map(read).join("\n")
  assert.doesNotMatch(
    routeRuntime,
    /\.(?:insert|upsert|delete)\s*\(/,
  )
  assert.doesNotMatch(routeRuntime, /\bfetch\s*\(/)

  const updateCalls = routeGraph.flatMap((path) => {
    const calls = read(path).match(/\.update\s*\(/g) ?? []
    return calls.map(() => path)
  })
  assert.deepEqual(updateCalls.sort(), [
    "lib/ebay/commercial-monitor-readonly-utilities.mjs",
    "lib/ebay/ebay-commercial-monitor-live-readonly.ts",
    "lib/ebay/ebay-current-live-authority-v1.ts",
    "lib/ebay/ebay-luna-canonical-stock-read-model-adapter-v1.ts",
    "lib/ebay/ebay-seller-account-scope.ts",
    "lib/marketplace/commercial-monitor-domain.ts",
  ])
  assert.match(
    read("lib/ebay/commercial-monitor-readonly-utilities.mjs"),
    /createHash\("sha256"\)\.update\(JSON\.stringify\(parts\)\)/,
  )
  assert.match(
    read("lib/ebay/ebay-seller-account-scope.ts"),
    /createHash\("sha256"\)\s*\.update\(`PRODUCTION:\$\{userId\}`\)/,
  )
  assert.match(
    read("lib/ebay/ebay-commercial-monitor-live-readonly.ts"),
    /createHash\("sha256"\)\s*\.update\(`EBAY_MONITOR_EVIDENCE:\$\{value\}`\)/,
  )
  assert.match(
    read("lib/ebay/ebay-luna-canonical-stock-read-model-adapter-v1.ts"),
    /createHash\("sha256"\)\s*\.update\(JSON\.stringify\(parts\)\)/,
  )
  assert.match(
    read("lib/marketplace/commercial-monitor-domain.ts"),
    /createHash\("sha256"\)\.update\(JSON\.stringify\(parts\)\)/,
  )

  const monitorOwnedRuntime = routeGraph
    .filter((path) =>
      path === canonicalRoute || path.includes("commercial-monitor-readonly"),
    )
    .map(read)
    .join("\n")
  assert.doesNotMatch(monitorOwnedRuntime, /\.rpc\s*\(/)

  const adminBoundary = read("lib/supabase-admin.ts")
  const adminRpcs = [...adminBoundary.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1])
  assert.deepEqual(adminRpcs, ["is_admin"])
})

test("el grafo canónico excluye writers, dispatchers, WhatsApp y runners mutantes", () => {
  const forbidden = [
    /ebay-commercial-monitor-service/,
    /commercial-monitor-panel/,
    /commercial-alert-dispatcher/,
    /commercial-improvement-action/,
    /whatsapp/i,
    /title-revision/,
    /image-revision/,
    /publication/,
    /tracking-write/,
    /inventory.*(?:write|update|revise)/i,
    /(?:offer|listing).*(?:publish|revise|end)/i,
    /fulfillment.*(?:action|write|service)/i,
    /buyer.*message/i,
    /targeted-active-listing-luna-monitor/,
    /competitor-watch-service/,
    /command-center-automation/,
  ]
  for (const path of runtimeGraph) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(path, pattern, `forbidden runtime dependency: ${path}`)
    }
  }
  assert.ok(routeGraph.includes(
    "lib/ebay/commercial-monitor-readonly-repository.ts",
  ))
  assert.ok(routeGraph.includes(
    "lib/ebay/commercial-monitor-readonly-service.ts",
  ))
  assert.ok(routeGraph.includes(
    "lib/ebay/ebay-sales-order-readonly-audit-repository-v1.ts",
  ))
  const salesAuditReader = read(
    "lib/ebay/ebay-sales-order-readonly-audit-repository-v1.ts",
  )
  assert.match(salesAuditReader, /\.select\(/)
  assert.doesNotMatch(
    salesAuditReader,
    /\.(?:insert|update|upsert|delete|rpc)\s*\(/,
  )
  assert.doesNotMatch(salesAuditReader, /\bfetch\s*\(/)
})

test("el reader live usa una allowlist cerrada y nunca persiste respuestas", () => {
  const reader = read(
    "lib/ebay/ebay-commercial-monitor-live-readonly.ts",
  )
  const domain = read(
    "lib/ebay/ebay-commercial-monitor-live-readonly-domain.ts",
  )
  assert.match(reader, /assertEbayMonitorReadonlyRequest/)
  assert.equal((reader.match(/input\.fetchImpl\(/g) ?? []).length, 1)
  assert.match(
    domain,
    /"GetUser"[\s\S]*"GetMyeBaySelling"[\s\S]*"GetItem"/,
  )
  assert.match(domain, /"TRADING_GET_ITEM_MARKETPLACE"/)
  assert.match(reader, /<OutputSelector>Item\.ItemID<\/OutputSelector>/)
  assert.match(reader, /<OutputSelector>Item\.Site<\/OutputSelector>/)
  assert.match(domain, /tradingHeaderCallName !== expectedTradingCall/)
  assert.match(domain, /root !== `\$\{expectedTradingCall\}Request`/)
  assert.doesNotMatch(domain, /"(?:AddItem|ReviseItem|EndItem|AddFixedPriceItem|ReviseFixedPriceItem)"/)
  assert.doesNotMatch(reader, /\.(?:insert|upsert|delete|rpc)\s*\(/)
  assert.equal((reader.match(/\.update\s*\(/g) ?? []).length, 1)
  assert.match(reader, /createHash\("sha256"\)\s*\.update\(/)
  assert.doesNotMatch(reader, /createShippingFulfillment|publishOffer|apply_improvement/)
  assert.match(reader, /marketplaceWrites:\s*0/)
  assert.match(reader, /databaseWrites:\s*0/)
  assert.match(reader, /tokenPersisted:\s*false/)
  assert.match(reader, /rawPayloadsReturned:\s*false/)
  assert.match(reader, /buyerPiiReturned:\s*false/)
  assert.match(reader, /representationEligible:\s*false as const/)
  assert.match(reader, /analyticsEligible:\s*false as const/)
  assert.match(reader, /sellerWideEnumeration\.identities/)
  assert.doesNotMatch(
    read("lib/ebay/commercial-monitor-readonly-contract.ts"),
    /sellerWideEnumeration|currentLiveListings|representationEligible|analyticsEligible/,
  )
  assert.match(reader, /refreshToken:\s*dedicatedRefresh/)
  assert.doesNotMatch(
    reader,
    /refreshToken:\s*dedicatedRefresh\s*\|\|\s*general\.refreshToken/,
  )
  assert.match(reader, /REQUEST_BUDGET_MS\s*=\s*24_000/)
  assert.match(reader, /REQUEST_MAX_CALLS\s*=\s*60/)
  assert.match(reader, /redirect:\s*"error"/)
  assert.match(reader, /"READ_REQUIRED"/)
})

test("fixtures, tests y JSON modelado no pueden entrar como fallback runtime", () => {
  for (const path of runtimeGraph) {
    assert.doesNotMatch(path, /(?:^|\/)(?:fixtures?|__tests__)(?:\/|$)/i)
    assert.doesNotMatch(path, /\.test\.[cm]?[jt]sx?$/)
    assert.notEqual(extname(path), ".json")
  }
  const runtimeSource = runtimeGraph.map(read).join("\n")
  assert.doesNotMatch(runtimeSource, /fixtureUsed|syntheticFallbackUsed:\s*true/)
})

test("el Item ID histórico y la tupla sintética no existen en el runtime canónico", () => {
  const runtimeSource = runtimeGraph.map(read).join("\n")
  assert.doesNotMatch(runtimeSource, /366543596425/)
  assert.doesNotMatch(
    runtimeSource,
    /impressions\s*:\s*18[\s\S]{0,240}views\s*:\s*1[\s\S]{0,240}transactions\s*:\s*0[\s\S]{0,240}ctr\s*:\s*5\.6/,
  )
  assert.doesNotMatch(runtimeSource, /\?\?\s*0|\|\|\s*0/)
  const reconciliation = read(
    "lib/ebay/ebay-commercial-analytics-reconciliation.ts",
  )
  assert.doesNotMatch(reconciliation, /366543596425/)
  assert.doesNotMatch(reconciliation, /impressions\s*:\s*18/)
  assert.match(reconciliation, /INSUFFICIENT_EVIDENCE/)
  assert.match(reconciliation, /syntheticFallbackUsed:\s*false/)
})

test("la UI contiene las secciones canónicas y sólo un control GET de actualización", () => {
  const clientPath =
    "app/admin/ebay/monitor/commercial-monitor-readonly-client.tsx"
  const client = read(clientPath)
  const canonicalDashboard = read(
    "app/admin/ebay/monitor/commercial-monitor-canonical-dashboard.tsx",
  )
  const canonicalUi = `${client}\n${canonicalDashboard}`
  for (const heading of [
    "Resumen",
    "Listings",
    "Kits y componentes",
    "Stock Guard",
    "Tráfico y conversión",
    "Plan de acción",
    "Experimentos",
    "Aprendizaje",
    "Calidad de datos",
    "Timeline / Auditoría",
  ]) {
    assert.match(client, new RegExp(heading.replace("/", "\\/")))
  }
  assert.match(canonicalDashboard, /Solo lectura/)
  assert.match(client, /Product Case/)
  assert.match(client, /NO_TOCAR/)
  assert.match(client, /dispatchAllowed/)
  assert.match(client, /whatsappCalled/)
  assert.match(client, /deliveryAttempted/)
  assert.match(client, /listing\.discovery\.livePresence\.status/)
  assert.match(client, /String\(alert\.dispatchAllowed\)/)
  assert.match(client, /String\(alert\.whatsappCalled\)/)
  assert.match(client, /String\(alert\.deliveryAttempted\)/)
  assert.match(client, /alert\.componentReference\.componentId/)
  assert.match(client, /alert\.componentReference\.sku/)
  assert.equal((canonicalUi.match(/onClick=/g) ?? []).length, 2)
  assert.match(canonicalDashboard, /onClick=\{onRefresh\}/)
  assert.match(canonicalDashboard, /Ver todas las publicaciones/)
  assert.match(canonicalDashboard, /dashboardKpis\.accountTraffic/)
  assert.match(canonicalDashboard, /dashboardKpis\.livePortfolio|const livePortfolio =/)
  assert.match(canonicalDashboard, /Actualizar datos/)
  assert.match(client, /fetch\("\/api\/admin\/ebay\/monitor"/)
  assert.doesNotMatch(client, /method:\s*["']POST["']/)
  assert.doesNotMatch(client, /<form\b/)
  assert.doesNotMatch(uiGraph.map(read).join("\n"), /formAction=|method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/)
  assert.doesNotMatch(client, /applyImprovement|prepareImprovement|runWhatsApp|publishOffer|ReviseItem|EndItem/)
})

test("hub y mobile review montan el entry card y no el panel mutable", () => {
  const hub = read("app/admin/ebay-seller-os/page.tsx")
  const mobile = read("app/admin/ebay/mobile-review/page.tsx")
  assert.match(hub, /commercial-monitor-readonly-entry-card/)
  assert.match(mobile, /commercial-monitor-readonly-entry-card/)
  assert.doesNotMatch(hub, /mobile-review\/commercial-monitor-panel/)
  assert.doesNotMatch(mobile, /from\s+["']\.\/commercial-monitor-panel["']/)
  assert.match(hub, /href:\s*["']\/admin\/ebay\/monitor["']/)
})

test("los boundaries incluyen UI y API canónicas y bloquean Production", () => {
  const boundary = read("lib/ebay/environment-boundaries.ts")
  assert.match(boundary, /["']\/admin\/ebay\/monitor["']/)
  assert.match(boundary, /["']\/api\/admin\/ebay\/monitor["']/)
  assert.match(boundary, /EBAY_PRO_BLOCKED_IN_PRODUCTION_PATHS/)
  assert.match(boundary, /runtime\.isProductionRuntime/)
  for (const pathname of [
    "/admin/ebay/monitor",
    "/api/admin/ebay/monitor",
  ]) {
    assert.equal(getEbayProRuntimeBoundary({
      pathname,
      method: "GET",
      vercelEnv: "production",
      nodeEnv: "production",
      ebayProRuntime: "production_core",
    }).blocked, true)
    assert.equal(getEbayProRuntimeBoundary({
      pathname,
      method: "GET",
      vercelEnv: "preview",
      nodeEnv: "production",
      ebayProRuntime: "staging",
    }).blocked, false)
  }
})

test("Product Case, experimentos, alertas y Assistant DTO son fail-closed", () => {
  const contract = read(
    "lib/ebay/commercial-monitor-readonly-contract.ts",
  )
  const service = read(
    "lib/ebay/commercial-monitor-readonly-service.ts",
  )
  const repository = read(
    "lib/ebay/commercial-monitor-readonly-repository.ts",
  )
  assert.match(contract, /status:\s*["']AVAILABLE["']/)
  assert.match(contract, /status:\s*["']MISSING["']/)
  assert.match(contract, /status:\s*["']UNPROVEN["']/)
  assert.match(contract, /PRODUCT_CASE_LINK_MISSING/)
  assert.match(contract, /PRODUCT_CASE_LINK_UNPROVEN/)
  assert.match(contract, /lifecycleState === ["']RUNNING["'][\s\S]*?["']NO_TOCAR["']/)
  assert.match(contract, /dispatchAllowed:\s*false/)
  assert.match(contract, /whatsappCalled:\s*false/)
  assert.match(contract, /deliveryAttempted:\s*false/)
  assert.match(contract, /commercial_monitor\.get/)
  assert.match(contract, /containsSensitiveAssistantMaterial/)
  assert.match(contract, /containsPrivateBuyerData/)
  assert.match(service, /const productCase = resolveProductCaseLink\(\)/)
  assert.match(service, /resolveExperiment\(authoritativeExperimentLookup\(/)
  assert.match(repository, /EXPERIMENT_REGISTRY_REMOTE_DDL_REQUIRED/)
  assert.match(service, /if \(input\.sources\.experiments\.status === ["']ERROR["']\) return \{ completed: false \}/)
  assert.match(service, /LISTING_PRICE_SOURCE_PROVENANCE_UNAVAILABLE/)
  assert.match(service, /WATCH_COUNT_SOURCE_PROVENANCE_UNAVAILABLE/)
  assert.match(service, /oldestRequiredEvidenceTimestamp/)
  assert.doesNotMatch(service, /productCaseId:\s*["'][^"']+["']/)
})

test("capabilities externas permanecen deny-by-default", () => {
  const contract = read(
    "lib/ebay/commercial-monitor-readonly-contract.ts",
  )
  const service = read(
    "lib/ebay/commercial-monitor-readonly-service.ts",
  )
  const source = `${contract}\n${service}`
  for (const invariant of [
    "canPublishAutomatically: false",
    "canReviseInventoryAutomatically: false",
    "canPauseListingAutomatically: false",
    "canReactivateListingAutomatically: false",
    "ebayBuyerMessageAutoSend: false",
    "ebayTrackingWriteEnabled: false",
    "whatsappSaleAlertEnabled: false",
    "postSaleShadowMode: true",
    "marketplaceWritesAllowed: false",
    "dispatchAllowed: false",
    "buyerMessagesAllowed: false",
  ]) {
    assert.match(source, new RegExp(invariant.replaceAll(" ", "\\s*")))
  }
  assert.match(service, /PAUSED_FOR_MONITORING_MILESTONE/)
  assert.match(service, /resumePolicy:\s*["']RESUME_FROM_LAST_VERIFIED_GATE["']/)
  assert.match(service, /manualGoldenPath:\s*["']PRESERVE["']/)
  assert.match(service, /reset:\s*false/)
})

test("el grafo canónico se mantiene físicamente pequeño y auditable", () => {
  assert.ok(routeGraph.length > 3)
  assert.ok(uiGraph.length > 3)
  assert.ok(runtimeGraph.includes("lib/seller-os/presentation.ts"))
  assert.deepEqual(
    runtimeGraph.filter((path) => registeredRuntimeGraphAdditions.includes(path)),
    [...registeredRuntimeGraphAdditions].sort(),
  )
  const baselineRuntimeGraph = runtimeGraph.filter((path) =>
    !registeredRuntimeGraphAdditions.includes(path))
  assert.ok(
    baselineRuntimeGraph.length < 27,
    `unexpected dependency expansion: ${runtimeGraph.join(", ")}`,
  )
})
