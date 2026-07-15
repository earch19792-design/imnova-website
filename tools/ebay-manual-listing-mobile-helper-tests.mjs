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

test("Seller OS and Command Center call the flow an assistant", () => {
  assert.match(sellerOsPage, /title: "Vincular listing activo"/)
  assert.match(sellerOsPage, /Abrir asistente guiado →/)
  assert.match(mobileReviewPage, /Abrir asistente para vincular listing/)
})
