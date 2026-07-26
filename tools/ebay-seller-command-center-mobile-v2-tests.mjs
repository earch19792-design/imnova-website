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
const primaryNavigation = readFileSync("app/admin/components/seller-os/primary-navigation.tsx", "utf8")
const shellStyles = readFileSync("app/admin/components/seller-os/seller-os-shell.module.css", "utf8")
const journeyGuide = readFileSync("app/admin/ebay/mobile-review/seller-journey-guide.tsx", "utf8")
const registration = readFileSync("app/admin/ebay/listings/register/page.tsx", "utf8")
const registrationApi = readFileSync("app/api/admin/ebay/listings/register/route.ts", "utf8")
const productResearchStepMigration = readFileSync(
  "supabase/migrations/20260717200000_allow_product_research_command_center_step.sql",
  "utf8",
)
const readyPublicationLunaRecheckMigration = readFileSync(
  "supabase/migrations/20260722000000_reconfirm_ready_publication_luna.sql",
  "utf8",
)
const restoreSameDayApprovedPackageMigration = readFileSync(
  "supabase/migrations/20260722001000_restore_same_day_approved_package.sql",
  "utf8",
)
const normalizeEstimateOnlyShippingMigration = readFileSync(
  "supabase/migrations/20260722002000_normalize_estimate_only_shipping.sql",
  "utf8",
)

test("mobile command center centralizes the five Seller OS areas", () => {
  for (const label of ["Inicio", "Oportunidades", "Productos", "Operación", "Monitoreo"]) {
    assert.match(canonicalNavigation, new RegExp(label))
  }
  assert.match(mobileNav, /SELLER_OS_NAVIGATION\.map/)
  assert.match(mobileNav, /return null/)
  assert.match(primaryNavigation, /SELLER_OS_NAVIGATION\.map/)
  assert.match(mobile, /SellerOsMobileNav/)
  assert.match(hub, /SellerOsMobileNav/)
  assert.match(shellStyles, /env\(safe-area-inset-bottom\)/)
  assert.match(primaryNavigation, /aria-current=/)
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
    /Offer no publicado \+ autorización final · \{draftTarget\}/,
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

test("listing workspace recovers an expired Luna publication check without losing approved work", () => {
  assert.match(workspace, /SAME_DAY_PUBLICATION_LUNA_RECHECK_REQUIRED/)
  assert.match(workspace, /sourceRecheckRequired/)
  assert.match(workspace, /reconfirm_publication_luna/)
  assert.match(workspace, /Reconfirmar Luna antes del Offer o publicación/)
  assert.match(workspace, /La revisión visual permanece disponible arriba/)
  assert.match(workspace, /no regenera imágenes ni escribe en eBay/)
  assert.match(workspace, /setWorkspaceRetry/)
  assert.match(api, /reconfirm_ebay_ready_publication_luna_v1/)
  assert.match(api, /sourceRecheckRequired: true/)
  assert.match(api, /status: 409/)
  assert.match(readyPublicationLunaRecheckMigration, /READY_FOR_MANUAL_PUBLICATION/)
  assert.match(readyPublicationLunaRecheckMigration, /abs\(v_previous_price - p_supplier_price\) >= 0\.005/)
  assert.match(readyPublicationLunaRecheckMigration, /ebay_writes, production_changed/)
  assert.match(readyPublicationLunaRecheckMigration, /imagesRegenerated', false/)
  assert.doesNotMatch(readyPublicationLunaRecheckMigration, /publishOffer|createOffer|createOrReplaceInventoryItem/)
})

test("same-day approved package restore is exact-six, human-approved and fail-closed", () => {
  const migration = restoreSameDayApprovedPackageMigration
  assert.match(
    migration,
    /create or replace function public\.restore_ebay_same_day_authorized_listing_package_v1\s*\(/i,
  )
  assert.match(migration, /security definer/i)
  assert.match(migration, /set search_path\s*=\s*public,\s*pg_temp/i)
  assert.match(migration, /for update/i)

  for (const scopeGuard of [
    /package(?:_row)?\.account_key\s*=\s*p_account_key/i,
    /package(?:_row)?\.created_by\s*=\s*p_actor/i,
    /control\.listing_package_id\s*=\s*v_package\.id/i,
    /control\.marketplace_account_key\s*=\s*p_account_key/i,
    /control\.created_by\s*=\s*p_actor/i,
    /asset\.id\s*=\s*any\s*\(v_control\.asset_ids\)/i,
  ]) assert.match(migration, scopeGuard)

  assert.match(migration, /cardinality\s*\(v_control\.asset_ids\)\s*(?:<>|=|is distinct from)\s*6/i)
  assert.match(migration, /control\.status\s*(?:<>|=|is distinct from)\s*'APPROVED'/i)
  assert.match(migration, /control\.human_decision\s*(?:<>|=|is distinct from)\s*'APPROVED'/i)
  assert.match(migration, /control\.reviewed_by\s*(?:<>|=|is distinct from)\s*p_actor/i)
  assert.match(migration, /asset\.status\s*(?:<>|=|is distinct from)\s*'approved'/i)
  assert.match(migration, /asset\.approved_at\s+is\s+(?:not\s+)?null/i)
  assert.match(migration, /asset\.approved_by\s*(?:<>|=|is distinct from)\s*p_actor/i)
  assert.match(
    migration,
    /asset\.qa_result\s*->>\s*'automaticStatus'\s*(?:<>|=|is distinct from)\s*'PARTIAL'/i,
  )
  assert.match(
    migration,
    /asset\.qa_result\s*->>\s*'humanApprovalRequired'\s*(?:<>|=|is distinct from)\s*'true'/i,
  )
  assert.doesNotMatch(
    migration,
    /automaticStatus'\s+in\s*\(\s*'PASSED'\s*,\s*'PARTIAL'\s*\)/i,
  )

  for (const protectedSource of [
    /manual_handoff_package/i,
    /image_package_summary/i,
    /publicUrls/,
    /itemSpecifics/,
    /ebay_same_day_pilot_image_package_runs/i,
    /ebay_listing_image_assets/i,
  ]) assert.match(migration, protectedSource)
  assert.match(
    migration,
    /jsonb_array_length\s*\(\s*(?:coalesce\s*\()?v_image_urls[\s\S]{0,80}(?:<>|=|is distinct from)\s*6/i,
  )
  assert.match(migration, /'imageUrls'\s*,\s*v_image_urls/)
  assert.match(migration, /'imageAssetManifest'\s*,\s*v_image_manifest/)
  assert.match(migration, /'aspects'/i)
  assert.match(migration, /v_handoff\s*->\s*'itemSpecifics'/i)
  assert.match(migration, /'shipping'/i)
  assert.match(migration, /'CONFIRMED'/)
  assert.match(migration, /'ESTIMATE_ONLY_NOT_FOR_LISTING'/)
  assert.match(migration, /operatorConfirmationRequired/)
  assert.match(migration, /verificationStatus/)
  for (const trustedShippingStatus of [
    /VERIFIED/,
    /CORROBORATED/,
    /DERIVED_VERIFIED/,
  ]) assert.match(migration, trustedShippingStatus)

  assert.match(migration, /ebay_account_policy_profiles/i)
  assert.match(migration, /profile_version/i)
  assert.match(migration, /EBAY_ACCOUNT_POLICY_PROFILE_V1_2026_07_20/)
  assert.match(migration, /verification_source/i)
  assert.match(migration, /EBAY_ACCOUNT_API_GET/)
  assert.match(migration, /expires_at\s*(?:<=|>)\s*(?:p_now|clock_timestamp\s*\(\))/i)
  assert.match(migration, /profile\.verified_at\s*(?:<=|>)\s*clock_timestamp\s*\(\)/i)
  assert.match(migration, /profile\.merchant_location_key\s+is\s+not\s+null/i)
  for (const verifiedSelection of [
    /fulfillment_policy_id/i,
    /payment_policy_id/i,
    /return_policy_id/i,
    /merchant_location_key/i,
  ]) assert.match(migration, verifiedSelection)

  for (const priorWriteControl of [
    /ebay_draft_only_approvals/i,
    /ebay_draft_only_execution_ledger/i,
    /ebay_authorized_listing_publications/i,
  ]) assert.match(migration, priorWriteControl)
  assert.match(migration, /control\.ebay_writes\s*(?:<>|=|is distinct from)\s*0/i)
  assert.match(migration, /control\.production_changed/i)
  assert.match(migration, /handoff\.ebay_writes\s*(?:<>|=|is distinct from)\s*0/i)
  assert.match(migration, /handoff\.production_changed/i)
  assert.doesNotMatch(migration, /p_package_patch\s*->\s*'imageUrls'/i)
  assert.doesNotMatch(migration, /p_package_patch\s*->\s*'imageAssetManifest'/i)
  assert.doesNotMatch(
    migration,
    /publishOffer|createOffer|createOrReplaceInventoryItem|createInventoryLocation/,
  )
})

test("approved V3 packages hydrate read-only before any legacy restore", () => {
  const prepareStart = api.indexOf('if (action === "prepare_package")')
  const saveStart = api.indexOf('if (action === "save_package")')
  assert.ok(prepareStart >= 0 && saveStart > prepareStart)
  const prepareApi = api.slice(prepareStart, saveStart)
  const afterPrepareApi = api.slice(saveStart)

  const approvedReadOnlyStart = prepareApi.indexOf(
    'if (existing?.status === "approved")',
  )
  const legacyRestoreStart = prepareApi.indexOf(
    '"restore_ebay_same_day_authorized_listing_package_v1"',
  )
  assert.ok(approvedReadOnlyStart >= 0)
  assert.ok(legacyRestoreStart > approvedReadOnlyStart)
  assert.match(prepareApi, /loadFinalListingReviewPublicationGate/)
  assert.match(prepareApi, /hydrationMode:\s*"APPROVED_V3_READ_ONLY"/)
  assert.match(prepareApi, /databaseWriteUsed:\s*false/)
  assert.match(prepareApi, /productionChanged:\s*false/)
  assert.match(
    prepareApi,
    /COMMAND_CENTER_APPROVED_PACKAGE_FINAL_REVIEW_REQUIRED/,
  )
  assert.match(prepareApi, /restore_ebay_same_day_authorized_listing_package_v1/)
  assert.match(prepareApi, /p_account_key:\s*accountKey/)
  assert.match(prepareApi, /p_actor:\s*reviewer/)
  assert.match(prepareApi, /p_listing_package_id:\s*existing\.id/)
  assert.match(prepareApi, /p_expected_updated_at:\s*existing\.updated_at/)
  assert.match(prepareApi, /sameDay/i)
  assert.doesNotMatch(afterPrepareApi, /restore_ebay_same_day_authorized_listing_package_v1/)
  assert.doesNotMatch(
    prepareApi,
    /publishOffer\s*\(|createOffer\s*\(|createOrReplaceInventoryItem\s*\(/,
  )
})

test("one-click publication exposes why its only control is protected", () => {
  assert.match(workspace, /const publicationButtonBlockReason/)
  assert.match(workspace, /const publicationButtonDisabled/)
  assert.match(workspace, /!referenceGuidedAttemptId \|\| !finalReviewRecord\.previewHash/)
  assert.match(workspace, /data-publication-button-blocker/)
  assert.match(workspace, /Control protegido temporalmente/)
  assert.doesNotMatch(
    workspace,
    /disabled=\{\s*publicationAutomationBusy\s*\|\|\s*draftBusy\s*\|\|\s*!listingPackage/,
  )
})

test("estimate-only shipping omits partial supplier measurements and keeps workspace recovery visible", () => {
  assert.match(workspace, /shipping\.status === "ESTIMATE_ONLY_NOT_FOR_LISTING"/)
  assert.match(workspace, /shipping\.estimatedValuesExcluded === true/)
  assert.match(workspace, /estimatesExcluded \? null : fallback\.weight/)
  assert.match(workspace, /El workspace del producto no terminó de abrir/)
  assert.match(workspace, /Reintentar abrir producto/)
  assert.match(workspace, /setWorkspaceRetry/)

  assert.match(normalizeEstimateOnlyShippingMigration, /ESTIMATE_ONLY_NOT_FOR_LISTING/)
  assert.match(normalizeEstimateOnlyShippingMigration, /estimatedValuesExcluded/)
  assert.match(normalizeEstimateOnlyShippingMigration, /operatorConfirmationRequired/)
  assert.match(
    normalizeEstimateOnlyShippingMigration,
    /v_package_weight_and_size := '\{\}'::jsonb/,
  )
  assert.match(
    normalizeEstimateOnlyShippingMigration,
    /SAME_DAY_WORKSPACE_REFRESH_ALREADY_EXECUTED/,
  )
  assert.doesNotMatch(
    normalizeEstimateOnlyShippingMigration,
    /publishOffer|createOffer|createOrReplaceInventoryItem|createInventoryLocation/,
  )
})

test("seller handoff has actionable economics and a Seller OS publication CTA", () => {
  for (const signal of [
    /Guardar y recalcular rentabilidad/,
    /Precio mínimo estimado/,
    /estimatedNetMarginPercent/,
    /estimatedRoiPercent/,
    /Publicación controlada desde Seller OS/,
    /seller-os-final-publication/,
    /guardará el Item ID/,
    /humanWorkspaceBlocker/,
  ]) assert.match(workspace, signal)
  assert.match(mobile, /comparables activos y señales de mercado/i)
  assert.match(
    mobile,
    /venta confirmada o listing activo con stock Luna exacto en cero/,
  )
  assert.doesNotMatch(mobile, /18:00 Guatemala/)
  assert.doesNotMatch(
    mobile,
    /Inmediatas: oportunidad con evidencia suficiente/,
  )
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
