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
  const navigation = await readFile(new URL("./navigation.ts", import.meta.url),
    "utf8")
  assert.match(page, /Tu operación en un solo lugar/)
  assert.match(page, /QuickPickDashboardSummary/)
  assert.match(page, /Oportunidades para publicar/)
  assert.match(page, /Listings LIVE/)
  assert.match(page, /Experimentos/)
  assert.match(page, /Owner \/ Sistema \/ Herramientas técnicas/)
  assert.match(navigation, /label: "Inicio"/)
  assert.match(navigation, /href: "\/admin"/)
})
