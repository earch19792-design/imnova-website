import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const dashboard = readFileSync(
  new URL("./commercial-monitor-canonical-dashboard.tsx", import.meta.url),
  "utf8",
)
const client = readFileSync(
  new URL("./commercial-monitor-readonly-client.tsx", import.meta.url),
  "utf8",
)
const presentation = readFileSync(
  new URL("../../../../lib/seller-os/presentation.ts", import.meta.url),
  "utf8",
)

test("canonical dashboard consumes backend DTO states without synthetic KPI fallbacks", () => {
  assert.ok(dashboard.startsWith('"use client"'))
  for (const expression of [
    "backend.kpis.activeListings.value",
    "selectedTraffic.impressions",
    "selectedTraffic.listingViews",
    "selectedTraffic.ctr",
    "selectedTraffic.quantitySold",
    "backend.kpis.orders.value",
    "backend.capabilities.inventory.inventoryItemsResource",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /value === null \? "—"/)
  assert.match(dashboard, /Sin informe vigente/)
  assert.match(dashboard, /No se generan puntos sintéticos/)
  for (const status of ["UNAVAILABLE_AUTH_PENDING", "UNAVAILABLE_NO_CURRENT_REPORT",
    "DEGRADED", "PARTIAL_CERTIFIED"]) {
    assert.match(presentation, new RegExp(status))
  }
  assert.match(dashboard, /No se inventan valores del Top 10 %/)
  assert.match(dashboard, /suffix="%"/)
  assert.match(dashboard, /Métrica TRANSACTION de eBay Analytics; no equivale a órdenes/)
  assert.match(dashboard, /backend\.trafficScopes\.accountTraffic/)
})

test("canonical dashboard surfaces decisions and review-only Registry state without write controls", () => {
  for (const expression of [
    "VISIBILITY",
    "CTR",
    "CONVERSION",
    "DATA_QUALITY",
    "HEALTHY_WAIT",
    "Portafolio y decisiones comerciales",
    "Plan de acción prioritario",
    "Próximas revisiones",
    "Revisión humana",
    "Experimentos",
    "0 escrituras de marketplace · 0 escrituras del registro",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.doesNotMatch(
    dashboard,
    /fetch\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)["']|ReviseItem|EndItem|publishOffer/,
  )
  assert.equal((dashboard.match(/onClick=/g) ?? []).length, 3)
  assert.match(dashboard, /onClick=\{onRefresh\}/)
  assert.match(dashboard, /ACCOUNT_TRAFFIC/)
  assert.match(dashboard, /CURRENT_LIVE_PORTFOLIO/)
  assert.match(dashboard, /sin usar el portafolio como sustituto/i)
  assert.match(dashboard, /renderedCriticalAlerts\.length/)
  assert.match(dashboard, /priorityActionPlan/)
})

test("canonical dashboard exposes scope integrity without implying unknown stock is safe", () => {
  for (const expression of [
    "backend.livePortfolioIntegrity",
    "Publicaciones canónicas",
    "Evidencia histórica",
    "Item IDs duplicados",
    "Colisiones de SKU activos",
    "Riesgos de stock comprobados",
    "Stock desconocido no se clasifica como riesgo ni como seguro",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /canonicalCohort\.scopeType/)
  assert.match(dashboard, /stockCohort\.nonLiveEvidenceRowCount/)
  assert.match(dashboard, /liveSkuUniqueness\.collisionCount/)
})

test("canonical dashboard prioritizes operator intent and legibility", () => {
  for (const expression of [
    "Monitor comercial de eBay",
    "Solo lectura",
    "Publicaciones activas",
    "Experimentos en curso",
    "Alertas comerciales",
    "Integridad del sistema",
    "Estado del sistema",
    "Tráfico de la cuenta",
    "Portafolio activo",
    "Plan de acción prioritario",
    "Seller OS funciona en modo de solo lectura",
    "Rendimiento general",
    "Distribución por estado",
    "Distribución por tipo",
    "Benchmark de categoría",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /liveRows\.map/)
  assert.match(dashboard, /table-fixed/)
  assert.match(dashboard, /identity\.primaryImageUrl/)
  assert.match(dashboard, /h-16 w-16/)
  assert.match(dashboard, /min-h-\[88px\]/)
  assert.match(dashboard, /listing\.metrics\.impressions\.value/)
  assert.match(dashboard, /listing\.metrics\.ebay_views\.value/)
  assert.match(dashboard, /listing\.metrics\.transactions\.value/)
  assert.doesNotMatch(dashboard, /min-w-\[820px\]|overflow-x-auto/)
  assert.match(dashboard, /No se generan puntos sintéticos/)
  assert.doesNotMatch(dashboard, /rounded-full border-\[11px\]/)
})

test("canonical dashboard uses progressive disclosure for technical integrity", () => {
  assert.match(dashboard, /<details id="system-integrity"/)
  assert.match(dashboard, /Ver detalle técnico/)
  assert.match(dashboard, /presentSellerOsCode\(finding\.invariantCode\)/)
  assert.match(dashboard, /finding\.invariantCode} · {finding\.lifecycle}/)
  assert.match(dashboard, /activeIntegrityFindings\.length/)
  assert.match(dashboard, /mitigatedIntegrityFindings\.length/)
  assert.match(dashboard, /passingIntegrityGuards/)
})

test("commercial and system alerts remain visually and semantically distinct", () => {
  assert.match(dashboard, /Alertas comerciales/)
  assert.match(dashboard, /Integridad del sistema/)
  assert.match(dashboard, /acciones comerciales ejecutables/)
  assert.match(dashboard, /relaciones del registro requieren revisión humana/)
  assert.match(dashboard, /Cero riesgos de stock comprobados no significa/)
})

test("legacy technical diagnostics remain secondary to the canonical dashboard", () => {
  assert.match(client, /CommercialMonitorCanonicalDashboard/)
  assert.match(client, /<details id="advanced-diagnostics"/)
  assert.match(client, /Diagnóstico técnico avanzado/)
  assert.doesNotMatch(client, /Estado comercial verificable, sin ejecutar cambios/)
  assert.match(client, /SellerOsMobileNav active="monitor" hideOnDesktop/)
})

test("live Trading rows remain visible when Quality Report is unavailable", () => {
  assert.match(dashboard, /const liveRows = backend\.decisions\.flatMap/)
  assert.match(dashboard, /qualityUnavailable \? \(/)
  assert.match(dashboard, /Sin informe vigente/)
  assert.match(dashboard, /ImageOff/)
  assert.match(dashboard, /key=\{listing\.identity\.itemId\}/)
  assert.match(dashboard, /decision\.experimentRunning/)
  assert.match(dashboard, /decision\.frozenVariables/)
})
