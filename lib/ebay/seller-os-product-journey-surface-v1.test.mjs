import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const root = new URL("../../", import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), "utf8")

test("product journey API is authenticated read-only and never executes business work", () => {
  const route = read("app/api/admin/ebay/product-journey/route.ts")
  const reader = read("lib/seller-os/product-journey-read-model-v1.ts")
  assert.match(route, /export async function GET/)
  assert.doesNotMatch(route, /export async function POST|\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /databaseMutations: 0/)
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(reader, /readLunaQuickPickProgressV1/)
  assert.match(reader, /get_seller_os_family_market_radar_v1/)
  assert.match(reader, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.doesNotMatch(reader, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
})

test("owner surface keeps technical evidence secondary and exposes human questions", () => {
  const page = read("app/admin/ebay/product-journey/page.tsx")
  for (const copy of ["¿Qué hizo?", "¿Qué encontró?", "¿Qué falta?",
    "¿Qué sigue?", "Tu intervención", "Ver evidencia técnica",
    "Recorrido comercial", "Actividad durable"]) assert.match(page,
      new RegExp(copy.replace(/[?]/g, "\\?")))
  assert.match(page, /<details/)
  assert.match(page, /America\/Managua/)
  assert.match(page, /No instrumentado históricamente/)
  assert.doesNotMatch(page, /\$0\.00/)
})

test("every Quick Pick product links to its canonical journey", () => {
  const quickPick = read("app/admin/ebay/quick-pick/page.tsx")
  assert.match(quickPick, /product-journey\?candidateId=/)
  assert.match(quickPick, /Ver recorrido completo/)
})

test("the productive admin dashboard exposes the product journey entry", () => {
  const home = read("app/admin/seller-os-home-dashboard-v1.tsx")
  const navigation = read("lib/seller-os/navigation.ts")
  assert.match(home, /data-product-journey-entry/)
  assert.match(home, /Recorrido por producto/)
  assert.match(home, /Ver recorridos de productos/)
  assert.match(home, /\/admin\/ebay\/publish#quick-pick-ready/)
  assert.match(navigation, /PRODUCT_JOURNEY_TRACE/)
})
