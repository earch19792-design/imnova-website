import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { SELLER_OS_ROUTE_AUDIT, SELLER_OS_USER_FACING_ROUTES } = await import(
  "./user-facing-route-inventory.ts")

test("Dashboard is the single entrypoint for every operational route", () => {
  assert.equal(SELLER_OS_ROUTE_AUDIT.totalUserFacingRoutes, 23)
  assert.equal(SELLER_OS_ROUTE_AUDIT.orphanOperationalRouteCountBefore, 7)
  assert.equal(SELLER_OS_ROUTE_AUDIT.orphanOperationalRouteCountAfter, 0)
  assert.equal(SELLER_OS_ROUTE_AUDIT.operatorPrimaryCount, 7)
  assert.equal(SELLER_OS_ROUTE_AUDIT.ownerPrimaryCount, 7)
  assert.equal(SELLER_OS_ROUTE_AUDIT.technicalAdminCount, 6)
  assert.equal(SELLER_OS_ROUTE_AUDIT.legacyCount, 2)
  assert.ok(SELLER_OS_USER_FACING_ROUTES.filter((route) =>
    ["OPERATOR_PRIMARY", "OWNER_PRIMARY"].includes(route.classification))
    .every((route) => route.dashboardReachable))
})

test("Dashboard presents commercial actions first and groups technical tools", async () => {
  const page = await readFile(new URL("../../app/admin/page.tsx", import.meta.url),
    "utf8")
  const operational = await readFile(new URL(
    "../../app/admin/seller-os-home-dashboard-v1.tsx", import.meta.url),
  "utf8")
  const navigation = await readFile(new URL("./navigation.ts", import.meta.url),
    "utf8")
  assert.match(page, /SellerOsHomeDashboardV1/)
  assert.match(page, /¿Qué necesita atención ahora\?/)
  assert.match(operational, /Próxima acción/)
  assert.match(operational, /Publicación/)
  assert.match(operational, /Negocio LIVE/)
  assert.match(operational, /Mayel/)
  assert.match(operational, /Estado operativo compacto/)
  assert.doesNotMatch(page, /TodayLaunchPanel/)
  assert.match(navigation, /label: "Inicio"/)
  assert.match(navigation, /label: "Administración"/)
  assert.match(navigation, /href: "\/admin"/)
})
