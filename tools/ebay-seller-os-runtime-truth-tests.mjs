import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("la experiencia no afirma estados operativos estáticos retirados", () => {
  const hub = read("app/admin/ebay-seller-os/page.tsx")
  const mobileReview = read("app/admin/ebay/mobile-review/page.tsx")
  const today = read("app/admin/today-launch-panel.tsx")

  assert.doesNotMatch(hub, /OpenAI: apagado/)
  assert.doesNotMatch(hub, /Producción: sin cambios/)
  assert.doesNotMatch(mobileReview, /18:00 Guatemala/)
  assert.doesNotMatch(today, /Piloto 3\/3/)
  assert.doesNotMatch(today, /Escrituras eBay: 0/)
})

test("el estado trabajando no se simula con timers del navegador", () => {
  const workspace = read("app/admin/ebay/listing-workspace/page.tsx")
  const status = read("lib/seller-os/status-presentation.ts")

  assert.doesNotMatch(workspace, /setTimeout\([^)]*setPublicationPhase/)
  assert.match(workspace, /publicationPhase === "publish_in_flight"/)
  assert.match(status, /heartbeatAt/)
  assert.match(status, /leaseExpiresAt/)
  assert.match(status, /prefersReducedMotion/)
})

test("la actividad ausente se muestra como no disponible y no como cero", () => {
  const dock = read("app/admin/components/seller-os/global-activity-dock.tsx")
  const readModel = read("lib/seller-os/operation-read-model.ts")
  assert.match(dock, /No disponible en esta fuente agregada/)
  assert.match(dock, /Actividad viva:<\/strong> No confirmada/)
  assert.match(readModel, /unavailableMetric/)
  assert.doesNotMatch(readModel, /currentProduct: availableMetric/)
})
