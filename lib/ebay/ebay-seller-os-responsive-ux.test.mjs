import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { SELLER_OS_NAVIGATION } from "../seller-os/navigation.ts"

const read = (path) => readFileSync(path, "utf8")

test("Seller OS conserva una navegación canónica tipada de exactamente cinco áreas", () => {
  assert.deepEqual(
    SELLER_OS_NAVIGATION.map((item) => item.id),
    ["home", "ebay-opportunities", "listings", "operations", "health-settings"],
  )
  assert.equal(new Set(SELLER_OS_NAVIGATION.map((item) => item.href)).size, 5)
  assert.ok(SELLER_OS_NAVIGATION.every((item, index) => item.order === index + 1))

  const navigation = read("lib/seller-os/navigation.ts")
  const home = read("app/admin/page.tsx")
  const mobile = read("app/admin/ebay/components/seller-os-mobile-nav.tsx")
  assert.equal((navigation.match(/export const SELLER_OS_NAVIGATION/g) ?? []).length, 1)
  assert.match(home, /SELLER_OS_NAVIGATION\.map/)
  assert.match(mobile, /SELLER_OS_NAVIGATION\.map/)
})

test("la navegación móvil tiene destinos táctiles, foco visible y estado accesible", () => {
  const mobile = read("app/admin/ebay/components/seller-os-mobile-nav.tsx")
  const home = read("app/admin/page.tsx")
  assert.match(mobile, /min-h-16/)
  assert.match(mobile, /aria-current=/)
  assert.match(mobile, /focus-visible:outline/)
  assert.match(mobile, /hideOnDesktop/)
  assert.match(home, /<SellerOsMobileNav active="home" hideOnDesktop/)
})

test("Inicio y Lanzamiento de hoy priorizan sistema, una tarea humana y continuación", () => {
  const home = read("app/admin/page.tsx")
  const today = read("app/admin/today-launch-panel.tsx")
  assert.match(home, /Tu siguiente decisión, sin ruido/)
  assert.match(home, /Ver resumen de las demás áreas/)
  assert.match(today, /1 · Sistema trabajando/)
  assert.match(today, /2 · Tu decisión/)
  assert.match(today, /Tarea para Ernesto/)
  assert.match(today, /3 · Qué continuará/)
  assert.match(today, /primaryTask/)
  assert.match(today, /Ver métricas y progreso automático/)
  assert.match(today, /ANALIZAR SIGUIENTES 5 CANDIDATOS/)
  assert.match(today, /REANUDAR 5 CANDIDATOS PREPARADOS/)
  assert.match(today, /min-h-14 w-full/)
  assert.match(today, /aria-describedby=/)
  assert.match(today, /aria-live="polite"/)
  assert.match(today, /Ciclo de revisión/)
  assert.match(today, /máximo de 5/)
})

test("los gates humanos marcan obligatorios en rojo con helper y controles de 44px", () => {
  const today = read("app/admin/today-launch-panel.tsx")
  assert.match(today, /aria-required="true"/)
  assert.match(today, /aria-invalid=\{priceMissing\}/)
  assert.match(today, /Obligatorio: confirma el costo actual mostrado por Luna/)
  assert.match(today, /Obligatorio: confirma si Luna muestra el producto disponible/)
  assert.match(today, /Precio pendiente de mercado/)
  assert.match(today, /disabled=\{!marketRecommendationReady\}/)
  assert.match(today, /El piso propio es provisional y no puede aprobarse como precio de mercado/)
  assert.match(today, /Obligatorio: confirma la fuente real de fulfillment/)
  assert.match(today, /min-h-11/)
  assert.match(today, /min-h-12/)
})

test("Commercial Monitor deja una acción principal y guarda diagnóstico técnico bajo detalles", () => {
  const monitor = read("app/admin/ebay/mobile-review/commercial-monitor-panel.tsx")
  assert.match(monitor, /bg-cyan-200/)
  assert.match(monitor, /Ejecutando dry run/)
  assert.match(monitor, /bg-emerald-200\/\[0\.08\]/)
  assert.match(monitor, /data-technical-details="dry-run"/)
  assert.match(monitor, /data-technical-details="persistent-run"/)
  assert.match(monitor, /data-technical-details="seller-hub-comparison"/)
  assert.match(monitor, /data-technical-details="analytics-source-health"/)
  assert.match(monitor, /Listings que necesitan atención/)
  assert.match(monitor, /detectadas/)
  assert.doesNotMatch(monitor, /<details open/)
})

test("el hub Seller OS escala de teléfono a escritorio sin cambiar la operación", () => {
  const hub = read("app/admin/ebay-seller-os/page.tsx")
  assert.match(hub, /max-w-7xl/)
  assert.match(hub, /sm:grid-cols-4/)
  assert.match(hub, /lg:grid-cols-2/)
  assert.match(hub, /xl:grid-cols-3/)
  assert.match(hub, /<SellerOsMobileNav active="operations"/)
})
