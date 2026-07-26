import assert from "node:assert/strict"
import test from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const { resolveSellerOsRoute } = await jiti.import("./route-resolution.ts")

test("resuelve las cinco áreas desde las rutas existentes", () => {
  assert.equal(resolveSellerOsRoute({ pathname: "/admin" }).area, "home")
  assert.equal(resolveSellerOsRoute({ pathname: "/admin/ebay/opportunity-queue" }).area, "opportunities")
  assert.equal(resolveSellerOsRoute({ pathname: "/admin/ebay/listing-workspace" }).area, "products")
  assert.equal(resolveSellerOsRoute({ pathname: "/admin/ebay-seller-os", hash: "#operacion" }).area, "operations")
  assert.equal(resolveSellerOsRoute({ pathname: "/admin/ebay/seller-performance" }).area, "monitoring")
})

test("preserva la intención de los deep links comerciales", () => {
  const decision = resolveSellerOsRoute({
    pathname: "/admin/ebay/mobile-review",
    search: "?section=commercial-monitor&improvement=decision-27",
  })
  assert.equal(decision.area, "monitoring")
  assert.equal(decision.utility, "decisions")

  const competitor = resolveSellerOsRoute({
    pathname: "/admin/ebay/mobile-review",
    hash: "#competitor-watch-heading",
  })
  assert.equal(competitor.area, "opportunities")
  assert.equal(competitor.pageLabel, "Observación de competidores")
})

test("configuración deja Operación como área y activa la utilidad correcta", () => {
  const resolved = resolveSellerOsRoute({
    pathname: "/admin/ebay-seller-os",
    hash: "#salud",
  })
  assert.equal(resolved.area, "operations")
  assert.equal(resolved.utility, "settings")
  assert.equal(resolved.pageLabel, "Configuración")
})
