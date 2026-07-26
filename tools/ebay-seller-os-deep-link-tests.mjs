import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const { resolveSellerOsRoute } = await jiti.import("../lib/seller-os/route-resolution.ts")

test("los enlaces de WhatsApp conservan sección, decisión y anchors", () => {
  const decision = resolveSellerOsRoute({
    pathname: "/admin/ebay/mobile-review",
    search: "section=commercial-monitor&improvement=improvement-80144",
  })
  assert.equal(decision.area, "monitoring")
  assert.equal(decision.utility, "decisions")

  assert.equal(resolveSellerOsRoute({
    pathname: "/admin/ebay/mobile-review",
    hash: "competitor-watch-heading",
  }).area, "opportunities")
  assert.equal(resolveSellerOsRoute({
    pathname: "/admin/ebay/mobile-review",
    hash: "listing-optimization-tasks-heading",
  }).area, "products")
})

test("el manifest conserva aliases y no habilita el dominio legacy Productos", () => {
  const manifest = JSON.parse(readFileSync("docs/seller-os/redirects-manifest.json", "utf8"))
  const products = manifest.routes.find((route) => route.from === "/admin/products/*")
  assert.equal(products?.to, "/admin")
  assert.equal(products?.status, 308)
  assert.ok(manifest.routes.some((route) => route.from === "/admin/marketplace-os"))
})
