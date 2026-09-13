import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const registrationPage = readFileSync(
  "app/admin/ebay/listings/register/page.tsx",
  "utf8",
)
const sellerOsPage = readFileSync(
  "app/admin/ebay-seller-os/page.tsx",
  "utf8",
)
const mobileReviewPage = readFileSync(
  "app/admin/ebay/mobile-review/page.tsx",
  "utf8",
)
const directedImportRoute = readFileSync(
  "app/api/admin/ebay/luna-product-import/route.ts",
  "utf8",
)
const registrationRoute = readFileSync(
  "app/api/admin/ebay/listings/register/route.ts",
  "utf8",
)
const registrationService = readFileSync(
  "lib/ebay/ebay-manual-listing-service.ts",
  "utf8",
)
const environmentBoundaries = readFileSync(
  "lib/ebay/environment-boundaries.ts",
  "utf8",
)

test("manual listing screen loads products inline instead of creating a navigation loop", () => {
  assert.match(registrationPage, /\/api\/admin\/ebay\/luna-opportunity-queue\?fullQueue=1/)
  assert.match(registrationPage, /payload\.dashboard\?\.queue \?\? \[\]/)
  assert.doesNotMatch(
    registrationPage,
    /href="\/admin\/ebay\/mobile-review\?section=in-progress"/,
  )
  assert.match(registrationPage, /Asistente para vincular tu listing activo/)
  assert.match(registrationPage, /Te guiamos sin salir de este flujo/)
})

test("helper explains the three mobile steps and supports product or SKU search", () => {
  assert.match(registrationPage, /Elegir producto/)
  assert.match(registrationPage, /Confirmar paquete y SKU/)
  assert.match(registrationPage, /Pegar Item ID/)
  assert.match(registrationPage, /Ejemplo: ITEM5126, SKU o nombre/)
  assert.match(registrationPage, /product\.supplier_sku/)
  assert.match(registrationPage, /product\.candidate_key/)
})

test("helper routes eligible products directly to Workspace and explains blockers", () => {
  assert.match(registrationPage, /\/admin\/ebay\/listing-workspace/)
  assert.match(registrationPage, /opportunity=\$\{encodeURIComponent\(product\.id\)\}/)
  assert.match(registrationPage, /candidate=\$\{encodeURIComponent\(product\.candidate_key\)\}/)
  assert.match(registrationPage, /Continuar con este producto →/)
  assert.match(registrationPage, /Completar datos de este producto →/)
  assert.match(registrationPage, /listing_workspace_resolvable_gates/)
  assert.match(registrationPage, /listing_workspace_blockers/)
})

test("manual registration remains gated until trusted product context exists", () => {
  assert.match(registrationPage, /const hasProductContext = Boolean/)
  assert.match(registrationPage, /hasProductContext \? <form/)
  assert.match(registrationPage, /Item ID localizado/)
  assert.match(registrationPage, /safeDefaults: \{\}/)
  assert.doesNotMatch(registrationPage, /publishOffer|createOffer|GetItemRequest/)
})

test("deep-linked resolver visibly identifies the exact active listing", () => {
  assert.match(registrationPage, /Listing que vas a vincular/)
  assert.match(registrationPage, /targetListing\.itemId/)
  assert.match(registrationPage, /targetListing\.title/)
  assert.match(registrationPage, /Custom label actual/)
  assert.match(registrationRoute, /searchParams\.get\("ebayItemId"\)/)
  assert.match(registrationRoute, /getManualEbayListingResolutionContext/)
  assert.match(registrationService, /\.from\("ebay_active_listings"\)/)
})

test("human resolution can reuse a certified Luna identity without title inference", () => {
  assert.match(registrationPage, /Identidad encontrada para confirmar/)
  assert.match(registrationPage, /Buscar otra identidad Luna/)
  assert.match(registrationPage, /El OS no decide por el título ni por la foto/)
  assert.match(registrationPage, /resolve_existing_certified_identity/)
  assert.match(registrationPage, /VINCULAR_IDENTIDAD_LUNA_CERTIFICADA/)
  assert.match(registrationRoute, /humanExactIdentityConfirmationRequired: true/)
  assert.match(registrationRoute, /titleInferenceUsed: false/)
  assert.match(registrationService, /resolve_manual_existing_certified_identity_v1/)
})

test("resolver surfaces one exact shared-image candidate and keeps alternatives collapsed", () => {
  assert.match(registrationService, /primaryImageUrl/)
  assert.match(registrationService, /exactPrimaryImageMatch/)
  assert.match(registrationPage, /matches\.length === 1 \? matches\[0\] : null/)
  assert.match(registrationPage, /misma imagen oficial/)
  assert.match(registrationPage, /Confirmar y vincular a/)
  assert.match(registrationPage, /if \(!search && !showAllCertified\) return \[\]/)
})

test("helper can ingest an official Luna URL as separate 3, 6 and 12 pack candidates", () => {
  assert.match(registrationPage, /\/api\/admin\/ebay\/luna-product-import/)
  assert.match(registrationPage, /Crear opciones comerciales 3, 6 y 12/)
  assert.match(registrationPage, /packSizes: \[3, 6, 12\]/)
  assert.match(registrationPage, /IMPORTAR_PACKS_LUNA_3_6_12/)
  assert.match(registrationPage, /no usa el UPC de una unidad como UPC del pack/)
  assert.match(registrationPage, /no publica en eBay/)
})

test("directed Luna import is Admin-only, production-bound and cannot resurrect completed rows", () => {
  assert.match(directedImportRoute, /validateAdminApiRequest\(req\)/)
  assert.match(directedImportRoute, /LUNA_DIRECTED_IMPORT_HUMAN_ADMIN_REQUIRED/)
  assert.match(directedImportRoute, /\["listed", "archived"\]/)
  assert.match(directedImportRoute, /ebayWriteUsed: false/)
  assert.match(directedImportRoute, /canPublish: false/)
  assert.match(environmentBoundaries, /"\/api\/admin\/ebay\/luna-product-import"/)
  assert.doesNotMatch(directedImportRoute, /GetItem|createOffer|publishOffer|WhatsApp/)
})

test("Seller OS and Command Center call the flow an assistant", () => {
  assert.match(sellerOsPage, /title: "Vincular publicación activa"/)
  assert.match(sellerOsPage, /Abrir asistente guiado →/)
  assert.match(mobileReviewPage, /Abrir asistente para vincular listing/)
})
