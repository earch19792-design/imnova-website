import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const mobile = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
const queue = readFileSync("app/admin/ebay/mobile-review/opportunity-command-center.tsx", "utf8")
const workspace = readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8")
const api = readFileSync("app/api/admin/ebay/command-center/route.ts", "utf8")
const hub = readFileSync("app/admin/ebay-seller-os/page.tsx", "utf8")

test("mobile command center centralizes the four seller destinations", () => {
  for (const label of ["Inicio", "Oportunidades", "En curso", "Alertas"]) {
    assert.match(mobile, new RegExp(label))
    assert.match(hub, new RegExp(label))
  }
  assert.match(mobile, /env\(safe-area-inset-bottom\)/)
  assert.match(mobile, /Continuar donde quedé/)
  assert.match(mobile, /save_review/)
  assert.match(mobile, /Guardado server-side/)
  assert.ok(mobile.indexOf("Paso 1 · Bodega ahora") < mobile.indexOf("2. eBay:"))
  assert.ok(mobile.indexOf("2. eBay:") < mobile.indexOf("3. Economía"))
  assert.match(mobile, /SERVER_AUTOSAVE/)
  assert.match(mobile, /Completa Luna antes de analizar eBay/)
  assert.match(mobile, /runWhatsAppPreflight/)
  assert.match(mobile, /Validar Meta/)
  assert.match(mobile, /action: "preflight"/)
})

test("opportunity UI uses the canonical queue and real listing workspace", () => {
  assert.match(queue, /Ranking canónico · una sola fuente/)
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
})

test("listing workspace is resumable and gates one unpublished Sandbox draft", () => {
  for (const signal of [
    /selectedOpportunity/,
    /prepare_package/,
    /save_package/,
    /package_data/,
    /Item specifics/,
    /Offer no publicado · Sandbox/,
    /CREAR DRAFT NO PUBLICADO/,
    /Publicar permanece prohibido/,
    /Imágenes autorizadas/,
  ]) assert.match(workspace, signal)
  const combined = `${mobile}\n${queue}\n${workspace}\n${api}`
  for (const forbidden of [/publishOffer\s*\(/, /createOffer\s*\(/, /createOrReplaceInventoryItem\s*\(/]) {
    assert.doesNotMatch(combined, forbidden)
  }
})
