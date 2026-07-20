import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const mobile = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
const loop1Summary = readFileSync("app/admin/ebay/mobile-review/loop1-winner-analysis-summary.tsx", "utf8")
const queue = readFileSync("app/admin/ebay/mobile-review/opportunity-command-center.tsx", "utf8")
const workspace = readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8")
const api = readFileSync("app/api/admin/ebay/command-center/route.ts", "utf8")
const hub = readFileSync("app/admin/ebay-seller-os/page.tsx", "utf8")
const mobileNav = readFileSync("app/admin/ebay/components/seller-os-mobile-nav.tsx", "utf8")
const canonicalNavigation = readFileSync("lib/seller-os/navigation.ts", "utf8")
const journeyGuide = readFileSync("app/admin/ebay/mobile-review/seller-journey-guide.tsx", "utf8")
const registration = readFileSync("app/admin/ebay/listings/register/page.tsx", "utf8")
const registrationApi = readFileSync("app/api/admin/ebay/listings/register/route.ts", "utf8")
const productResearchStepMigration = readFileSync(
  "supabase/migrations/20260717200000_allow_product_research_command_center_step.sql",
  "utf8",
)

test("mobile command center centralizes the five Seller OS areas", () => {
  for (const label of ["Inicio", "Oportunidades eBay", "Listings", "Operación", "Salud y configuración"]) {
    assert.match(canonicalNavigation, new RegExp(label))
  }
  assert.match(mobileNav, /SELLER_OS_NAVIGATION\.map/)
  assert.match(mobile, /SellerOsMobileNav/)
  assert.match(hub, /SellerOsMobileNav/)
  assert.match(mobileNav, /env\(safe-area-inset-bottom\)/)
  assert.match(mobileNav, /aria-current=/)
  assert.match(mobile, /Continuar donde quedé/)
  assert.match(mobile, /save_review/)
  assert.match(mobile, /Guardado server-side/)
  assert.ok(mobile.indexOf("Paso 2 · Luna") < mobile.indexOf("Paso 3 · Verificación del mercado activo en eBay"))
  assert.ok(mobile.indexOf("Paso 3 · Verificación del mercado activo en eBay") < mobile.indexOf("Resultado económico"))
  assert.match(mobile, /SERVER_AUTOSAVE/)
  assert.match(mobile, /Completa Luna antes de analizar eBay/)
  assert.match(mobile, /runWhatsAppPreflight/)
  assert.match(mobile, /Validar Meta/)
  assert.match(mobile, /action: "preflight"/)
})

test("seller journey provides one directional route and inline required-field help", () => {
  assert.match(mobile, /useState<View>\("opportunities"\)/)
  assert.match(mobile, /SellerJourneyGuide/)
  assert.match(journeyGuide, /Asistente Seller OS/)
  assert.match(journeyGuide, /Seller OS hace/)
  assert.match(journeyGuide, /Te toca ahora/)
  assert.match(journeyGuide, /Ver la ruta completa/)
  assert.match(journeyGuide, /Paso \{currentStep\} de 4/)
  assert.match(journeyGuide, /aria-current=\{current \? "step"/)
  assert.match(mobile, /aria-invalid=\{!selectedRadarCandidate\}/)
  assert.match(mobile, /aria-invalid=\{!state\.stockQuantityConfirmed\}/)
  assert.match(mobile, /aria-invalid=\{!lunaPriceConfirmed\}/)
  assert.match(mobile, /text-rose-300/)
  assert.match(mobile, /Ingresa una cantidad mayor que cero/)
  assert.match(mobile, /Ingresa el costo y abre Luna/)
})

test("mobile navigation exposes one hybrid opportunity view, protects work and reports dependency failures", () => {
  assert.doesNotMatch(mobile, /Radar alternativo/)
  assert.doesNotMatch(mobile, /view === "top5"/)
  assert.match(mobile, /radarCandidates=\{report\.allCandidates\}/)
  assert.match(queue, /Cola canónica \+ Radar actualizado/)
  assert.match(queue, /Oportunidades para revisar/)
  assert.match(queue, /Nueva señal · análisis pendiente/)
  assert.match(mobile, /confirmReviewReset/)
  assert.match(mobile, /beforeunload/)
  assert.match(mobile, /serverReviewsLoadState === "ERROR"/)
  assert.match(mobile, /whatsappLoadState === "ERROR"/)
  assert.match(mobile, /whatsappLoadState === "READY" \? whatsappStatus\.health\?\.pending \?\? 0 : "—"/)
  assert.match(mobile, /role="alert"/)
})

test("listing entry points use one safe name and remain gated", () => {
  assert.match(hub, /Draft \/ manual/)
  assert.match(hub, /\/admin\/ebay\/listings\/register/)
  assert.match(mobile, /Registrar listing manual/)
  assert.match(queue, /Registrar listing manual/)
  assert.match(queue, /row\.can_open_listing_workspace \?/)
  assert.match(mobile, /review\.opportunity\.can_open_listing_workspace \?/)
  assert.match(mobile, /Producto en revisión/)
  assert.match(mobile, /Loop1WinnerAnalysisSummary/)
  assert.match(loop1Summary, /Guardar paquete de decisión/)
  assert.match(loop1Summary, /<dt className="text-white\/50">canPublish<\/dt><dd className="font-black">false<\/dd>/)
  assert.match(queue, /row\.can_prepare_listing_package \? "Preparar draft" : "Completar paquete"/)
  assert.doesNotMatch(`${mobile}\n${queue}\n${hub}`, />Workspace</)
  assert.doesNotMatch(`${mobile}\n${hub}`, />4\. Publicar</)
})

test("opportunity UI uses the canonical queue and real listing workspace", () => {
  assert.match(mobile, /<OpportunityCommandCenter guided/)
  assert.match(queue, /guided \? "Actualizar oportunidades"/)
  assert.match(queue, /Elegir este producto/)
  assert.match(queue, /Cola canónica \+ Radar actualizado/)
  assert.match(queue, /seller_priority_score/)
  assert.match(queue, /Potencial/)
  assert.match(queue, /Confianza/)
  assert.match(queue, /Urgencia/)
  assert.match(queue, /candidatos eBay · \{row\.exact_comparable_count\} comparables exactos/)
  assert.match(queue, /\/admin\/ebay\/listing-workspace\?opportunity=/)
  assert.match(queue, /Sincronizar listings activos/)
})

test("review and package state are persisted only through the protected Admin API", () => {
  assert.match(api, /validateAdminApiRequest/)
  assert.match(api, /ebay_command_center_reviews/)
  assert.match(api, /ebay_listing_packages/)
  assert.match(api, /user_id: reviewer/)
  assert.match(api, /COMMAND_CENTER_PACKAGE_GATES_PENDING/)
  assert.match(api, /sourceOpportunity\.hard_gates/)
  assert.match(api, /safety: \{ ebayWriteUsed: false, canPublish: false \}/)
  assert.match(mobile, /\? "product_research"/)
  assert.match(productResearchStepMigration, /'product_research'/)
  assert.doesNotMatch(productResearchStepMigration, /delete from|truncate/i)
})

test("listing workspace is resumable and gates one unpublished environment-aware draft", () => {
  for (const signal of [
    /selectedOpportunity/,
    /prepare_package/,
    /save_package/,
    /package_data/,
    /Item specifics/,
    /Offer API no publicado · \{draftTarget\}/,
    /CREAR DRAFT NO PUBLICADO/,
    /Preparar preview final no publicado/,
    /PUBLICAR LISTING EN EBAY/,
    /Publicar una sola vez en eBay/,
    /Nunca vuelve a llamar publishOffer/,
    /Confirmo derechos sobre todas las imágenes/,
  ]) assert.match(workspace, signal)
  const combined = `${mobile}\n${queue}\n${workspace}\n${api}`
  for (const forbidden of [/publishOffer\s*\(/, /createOffer\s*\(/, /createOrReplaceInventoryItem\s*\(/]) {
    assert.doesNotMatch(combined, forbidden)
  }
})

test("seller handoff has actionable economics, manual publication and valid mobile CTAs", () => {
  for (const signal of [
    /Guardar y recalcular rentabilidad/,
    /Precio mínimo estimado/,
    /estimatedNetMarginPercent/,
    /estimatedRoiPercent/,
    /Copiar SKU reservado/,
    /Abrir Seller Hub/,
    /registrar Item ID/,
    /humanWorkspaceBlocker/,
  ]) assert.match(workspace, signal)
  assert.match(mobile, /comparables activos y señales de mercado/i)
  assert.match(mobile, /oportunidad con evidencia suficiente/)
  assert.doesNotMatch(mobile, /ganador verificado/i)
  assert.match(mobile, /Vincular con la oportunidad canónica/)
  assert.match(mobile, /preferredMarketRadarProductId=/)
  assert.match(queue, /Continuar este mismo producto/)
  assert.doesNotMatch(mobile, /href=\{comparable\.itemWebUrl \?\? undefined\}/)
  assert.doesNotMatch(mobile, />\s*B2-RUN no disponible\s*</)
})

test("manual registration fails closed until the official account scope is configured", () => {
  assert.match(registration, /accountScopeConfigured !== true/)
  assert.match(registration, /Configura la identidad de la cuenta antes de registrar/)
  assert.match(registration, /Pendiente de verificación oficial/)
  assert.match(registrationApi, /configuration\.accountScopeConfigured/)
  assert.match(registrationApi, /registrations: \[\]/)
  assert.match(registrationApi, /MANUAL_LISTING_HUMAN_ADMIN_REQUIRED/)
})
