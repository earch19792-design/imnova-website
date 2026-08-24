import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8")
const monitor = read("../../app/admin/ebay/monitor/commercial-monitor-canonical-dashboard.tsx")
const readiness = read("../../app/admin/ebay/operational-readiness/page.tsx")
const luna = read("../../app/admin/ebay/luna-capture/page.tsx")
const stock = read("../../app/admin/ebay/stock-guard/page.tsx")
const decisions = read("../../app/admin/ebay/decisions/page.tsx")
const experiments = read("../../app/admin/ebay/experiments/page.tsx")
const learning = read("../../app/admin/ebay/learning/page.tsx")
const intelligenceApi = read("../../app/api/admin/ebay/intelligence/route.ts")
const intelligenceSurface = read("../../app/admin/ebay/intelligence/protected-intelligence-surface.tsx")
const marketPage = read("../../app/admin/ebay/opportunity-queue/research/page.tsx")
const marketRoute = read("../../app/api/admin/ebay/market-research/route.ts")
const navigation = read("../seller-os/navigation.ts")

test("Luna readiness card opens the protected activation workspace", () => {
  assert.match(readiness, /href="\/admin\/ebay\/luna-capture"/)
  assert.match(luna, /Select live listing/i)
  assert.match(luna, /Identify and capture/i)
  assert.match(luna, /Supplier product ID/)
  assert.match(luna, /Exact variant ID/)
  assert.match(luna, /Capture and review evidence/i)
  assert.match(luna, /Approve deterministic Item-ID link/i)
  assert.match(luna, /EXPLICIT_APPROVED_MAPPING/)
  assert.match(luna, /READY_PENDING_REGISTRY_PERSISTENCE/)
  assert.match(luna, /RUN_LUNA_AUTHENTICATED_CAPTURE/)
  assert.match(luna, /Browser automation is not activated/)
  assert.doesNotMatch(luna, /IMNOVA_LUNA_WATCHER_SERVER_RECAPTURE_DUE_V1/)
  const operationalRoute = read("../../app/api/admin/ebay/operational-readiness/route.ts")
  assert.match(operationalRoute, /AUTHENTICATED_WEB_SESSION/)
  assert.match(operationalRoute, /NON_AUTHORITATIVE_FOR_AUTHENTICATED_STOCK/)
  assert.doesNotMatch(operationalRoute, /EVALUATE_LUNA_WATCHER_CAPTURE/)
  assert.match(luna, /registryBusinessDataMutations: 0/)
  assert.doesNotMatch(luna, /TITLE_SIMILARITY_ONLY/)
})

test("Stock Guard exposes scalable portfolio summaries and keeps UNKNOWN distinct from risk", () => {
  for (const label of ["Publicaciones live canónicas", "Vínculo exacto certificado",
    "Necesita vínculo", "Señal in stock", "Stock desconocido", "Mismatch de identidad",
    "Live monitoreados", "StockGuard inscritos", "Accionable", "Exacto comprobado",
    "Riesgo de stock", "Desconocido"]) assert.match(stock, new RegExp(label))
  assert.match(stock, /supplierLinkage = CERTIFIED/)
  assert.match(stock, /No se deriva de stock desconocido/)
  assert.match(stock, /No equivale a vínculo exacto/)
  assert.match(stock, /Excluye STOCK_UNKNOWN/)
  assert.match(read("./commercial-monitor-readonly-service.ts"),
    /readLunaWatcherHumanApprovalContractV1/)
  assert.match(read("./commercial-monitor-readonly-service.ts"),
    /LUNA_HUMAN_APPROVED_LINK_REQUIRED/)
  assert.doesNotMatch(stock, /riskClass\s*=\s*["']STOCK_UNKNOWN["']/)
})

test("Decisions, Experiments, and Learning navigation targets usable protected surfaces", () => {
  assert.match(navigation, /label: "Decisiones"[\s\S]*?href: "\/admin\/ebay\/decisions"/)
  assert.match(navigation, /label: "Experimentos"[\s\S]*?href: "\/admin\/ebay\/experiments"/)
  assert.match(navigation, /label: "Aprendizaje"[\s\S]*?href: "\/admin\/ebay\/learning"/)
  assert.match(decisions, /mode="DECISIONS"/)
  assert.match(experiments, /mode="EXPERIMENTS"/)
  assert.match(learning, /mode="LEARNING"/)
  assert.match(intelligenceApi, /validateAdminApiRequest\(req\)/)
  assert.match(intelligenceSurface, /Prioridades de hoy/)
  assert.match(intelligenceSurface, /DO_NOT_TOUCH/)
  assert.match(intelligenceSurface, /Procedencia del resultado/)
  assert.match(intelligenceApi, /marketplaceWrites: 0/)
  assert.doesNotMatch(intelligenceApi, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/)
})

test("Market Opportunity primary UX is automatic and advanced paths remain available", () => {
  assert.match(marketPage, /"Analyze Opportunity"/)
  assert.match(marketPage, /Advanced Research/)
  for (const seed of ["SEED_ITEM_ID", "SEED_QUERY", "SEED_PRODUCT_TITLE",
    "SEED_PRODUCT_FAMILY"]) assert.match(marketPage, new RegExp(seed))
  assert.match(marketPage, /Commercial Recommendation V2 · Canonical result/)
  assert.match(marketPage, /Legacy diagnostics \/ provenance/)
  assert.match(marketPage, /cannot override Canonical Opportunity Result V2/)
  assert.match(marketPage, /Comparable Fingerprint V2/)
  assert.match(marketPage, /Keyword Intelligence V2/)
  assert.match(marketPage, /Price Opportunity V2/)
  assert.match(marketPage, /Marketplace competition total/)
  assert.match(marketPage, /Use as Reference \/ Sell One Like This/)
  assert.match(marketPage, /referenceRiskCodes/)
})

test("multi-seed API remains bounded, source-excluding, and read-only", () => {
  assert.match(marketRoute, /getEbayListingIdentityByLegacyItemId/)
  assert.match(marketRoute, /CANONICAL_FAMILY_EXPANSION/)
  assert.match(marketRoute, /Math\.min\(2, request\.queryBudget\)/)
  assert.match(marketRoute, /row\.itemId !== request\.seedValue/)
  assert.match(marketRoute, /BOUNDED_MULTI_SEED_CONSENSUS/)
  assert.match(marketRoute, /marketplaceWrites: 0/)
  assert.match(marketRoute, /registryBusinessDataMutations: 0/)
  assert.match(marketRoute, /productCaseMutations: 0/)
  assert.doesNotMatch(marketRoute, /createOffer|publishOffer|reviseInventoryStatus|sendWhatsApp/)
})
