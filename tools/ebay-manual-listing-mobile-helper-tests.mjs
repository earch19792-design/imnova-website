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
const environmentBoundaries = readFileSync(
  "lib/ebay/environment-boundaries.ts",
  "utf8",
)

test("manual listing screen loads products inline instead of creating a navigation loop", () => {
  assert.match(registrationPage, /fetch\("\/api\/admin\/ebay\/command-center"/)
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
  assert.match(registrationPage, /No ingreses todavía el Item ID/)
  assert.match(registrationPage, /safeDefaults: \{\}/)
  assert.doesNotMatch(registrationPage, /publishOffer|createOffer|GetItemRequest/)
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
  assert.match(sellerOsPage, /title: "Vincular listing activo"/)
  assert.match(sellerOsPage, /Abrir asistente guiado →/)
  assert.match(mobileReviewPage, /Abrir asistente para vincular listing/)
})
