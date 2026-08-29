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
    "livePortfolio.activeListings.value",
    "livePortfolio.impressions.value",
    "livePortfolio.ebayViews.value",
    "livePortfolio.averageCtr.value",
    "livePortfolio.quantitySold.value",
    "dashboardKpis.orders.value",
    "backend.capabilities.inventory.inventoryItemsResource",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /value === null \? "—"/)
  assert.match(dashboard, /Listing Quality Report todavía no conectado/)
  assert.match(dashboard, /value === null && status === "AVAILABLE"/)
  assert.match(dashboard, /\? "Error de datos"/)
  assert.doesNotMatch(dashboard, /Rendimiento de las 10 publicaciones activas/)
  assert.match(dashboard, /No se generan puntos sintéticos/)
  for (const status of ["UNAVAILABLE_AUTH_PENDING", "UNAVAILABLE_NO_CURRENT_REPORT",
    "DEGRADED", "PARTIAL_CERTIFIED"]) {
    assert.match(presentation, new RegExp(status))
  }
  assert.match(dashboard, /No se inventan valores del Top 10 %/)
  assert.match(dashboard, /suffix="%"/)
  assert.match(dashboard, /Métrica TRANSACTION de eBay Analytics; no equivale a órdenes/)
  assert.match(dashboard, /dashboardKpis\.accountTraffic/)
  assert.doesNotMatch(dashboard, /selectedTraffic|setTrafficScope/)
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
    "0 escrituras desde el Monitor · 0 escrituras del registro",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.doesNotMatch(
    dashboard,
    /fetch\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)["']|ReviseItem|EndItem|publishOffer/,
  )
  assert.equal((dashboard.match(/onClick=/g) ?? []).length, 2)
  assert.match(dashboard, /onClick=\{onRefresh\}/)
  assert.match(dashboard, /Tráfico de la cuenta/)
  assert.match(dashboard, /Portafolio LIVE actual/)
  assert.match(dashboard, /Sus denominadores nunca se mezclan con el portafolio LIVE/)
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
    "Portafolio LIVE actual",
    "Veces que eBay mostró tus productos · Impresiones",
    "Personas que entraron a verlos · Vistas",
    "CTR · Tasa de clics",
    "¿Qué significa?",
    "Inventario protegido",
    "con evidencia fresca",
    "requieren atención",
    "Plan de acción prioritario",
    "Este Monitor funciona en modo de solo lectura",
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

test("human review, incomplete evidence, and Registry review keep distinct authorities", () => {
  assert.match(dashboard,
    /const operationalManualReview = backend\.operationalHealth\.manualReview/)
  assert.match(dashboard, /operationalManualReview\.status === "AVAILABLE"/)
  assert.doesNotMatch(dashboard, /const decisionHumanReviewCount =/)
  assert.match(dashboard, /publicaciones requieren revisión humana/)
  assert.match(dashboard, /relaciones del registro requieren revisión humana/)
  assert.match(dashboard, /Publicaciones:.*no comprobado/s)
  assert.match(dashboard, /Relaciones del registro: no comprobadas/)
  assert.match(dashboard, /publicaciones presentan evidencia incompleta/)
  assert.match(dashboard, />Evidencia</)
  assert.doesNotMatch(dashboard,
    /<p><strong>\{formatValue\(backend\.operationalHealth\.dataQuality\.count\)\}<\/strong> publicaciones con evidencia por revisar<\/p>/)
})

test("final UX hardening keeps operational language human and empty states compact", () => {
  assert.match(dashboard, />Estado operativo</)
  assert.doesNotMatch(dashboard, /Semánticas específicas, sin falsos ceros/)
  assert.match(dashboard, /data-compact-empty-state="true"/)
  assert.match(dashboard, /Tendencia no disponible todavía/)
  assert.match(dashboard, /Listing Quality Report todavía no conectado/)
  assert.match(dashboard, /presentSellerOsCapabilitySummary/)
})

test("technical evidence is preserved behind collapsed-by-default disclosure", () => {
  assert.ok((dashboard.match(/data-default-collapsed="true"/g) ?? []).length >= 4)
  assert.match(client,
    /<details id="advanced-diagnostics" data-default-collapsed="true"/)
  assert.match(dashboard,
    /<details id="inventory-status" data-default-collapsed="true"/)
  assert.doesNotMatch(dashboard, /<details[^>]*\sopen(?:=|\s|>)/)
  assert.doesNotMatch(client, /<details[^>]*\sopen(?:=|\s|>)/)
  assert.match(dashboard, /FALSE_ZERO_REPRESENTATION_GUARD|deterministicGuards/)
})

test("legacy technical diagnostics remain secondary to the canonical dashboard", () => {
  assert.match(client, /CommercialMonitorCanonicalDashboard/)
  assert.match(client, /<details id="advanced-diagnostics"/)
  assert.match(client, /Diagnóstico técnico avanzado/)
  assert.doesNotMatch(client, /Estado comercial verificable, sin ejecutar cambios/)
  assert.match(client, /SellerOsMobileNav active="monitor" hideOnDesktop/)
})

test("live Trading rows remain visible when Quality Report is unavailable", () => {
  assert.match(dashboard,
    /const liveRows = selectedLiveItemIds\.flatMap/)
  assert.match(dashboard, /qualityUnavailable \? \(/)
  assert.match(dashboard, /Listing Quality Report todavía no conectado/)
  assert.match(dashboard, /ImageOff/)
  assert.match(dashboard, /key=\{listing\.identity\.itemId\}/)
  assert.match(dashboard, /decision\.experimentRunning/)
  assert.match(dashboard, /decision\.frozenVariables/)
})

test("recent sales are bounded, official, sanitized, and separate from Analytics", () => {
  for (const expression of [
    "backend.recentSales",
    "backend.orderSourceHealth",
    "Ventas recientes",
    "Órdenes oficiales de eBay",
    "no se usa para atribuirla",
    "Mensaje al comprador",
    "Aviso interno por WhatsApp",
    "Stock del proveedor",
    "Cantidad no comprobada",
    "Aceptado por Meta",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /recentSales\.entries\.slice\(0, 5\)/)
  assert.match(dashboard, /recentSales\.status === "AVAILABLE"/)
  assert.doesNotMatch(dashboard, /buyerEmail|buyerUsername|shippingAddress/)
})

test("canonical line-grained sale alerts are visible without using legacy identity", () => {
  for (const expression of [
    "backend.saleAlerts",
    "Alertas de venta",
    "SELLER_OS_RECENT_SALES_FEED_V1",
    "alert.alertId",
    "alert.eventId",
    "alert.lineItemId",
    "alert.quantity",
    "NEWLY_DETECTED_AFTER_I04_ACTIVATION",
    "Venta histórica recuperada",
    "alert.workflowStep.state",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /saleAlerts\.alerts\.slice\(0, 5\)/)
  assert.match(dashboard, /key=\{alert\.alertId\}/)
  assert.doesNotMatch(dashboard,
    /alert\.(?:buyerName|buyerEmail|buyerUsername|phone|shippingAddress|payment)/)
})

test("monitor coverage makes visible Top N distinct from monitored scope", () => {
  for (const expression of [
    "backend.monitorCoverage",
    "publicaciones activas monitoreadas",
    "de mayor prioridad",
    "Visible ≠ alcance monitoreado",
    "no aparecer en esta selección no significa quedar sin monitoreo",
    "Ver todas las publicaciones",
  ]) {
    assert.match(dashboard, new RegExp(expression))
  }
  assert.match(dashboard, /monitorCoverage\.visiblePriorityItemIds/)
  assert.match(dashboard, /monitorCoverage\.currentLiveScopeCount/)
  assert.match(dashboard, /showAllLiveListings/)
  assert.match(dashboard, /aria-expanded=\{showAllLiveListings\}/)
  assert.match(dashboard, /Volver a las prioridades/)
  assert.match(dashboard, /canonicalRowsByItemId/)
  assert.match(dashboard, /listingsByKey\.get\(decision\.listingKey\)/)
  assert.doesNotMatch(dashboard, /new Map\(monitor\.listings\.map\(\(listing\) =>\s*\[listing\.identity\.itemId/)
  assert.doesNotMatch(dashboard, /\/admin\/ebay\/listing-workspace\?source=monitor/)
  assert.doesNotMatch(dashboard, /backend\.decisions\.flatMap[\s\S]*\.slice\(0, 8\)/)
})

test("order polling copy distinguishes configuration from proven scheduler activation", () => {
  assert.match(dashboard, /Sondeo configurado cada/)
  assert.match(dashboard, /activación del scheduler no comprobada aquí/)
  assert.match(dashboard, /La lectura persistida está disponible/)
  assert.doesNotMatch(dashboard, /El feed está activo/)
})
