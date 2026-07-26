import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("el layout usa un solo shell en Preview y no envuelve el login", () => {
  const layout = read("app/admin/layout.tsx")
  const shell = read("app/admin/components/seller-os/seller-os-shell.tsx")
  const primary = read("app/admin/components/seller-os/primary-navigation.tsx")
  const compatibility = read("app/admin/ebay/components/seller-os-mobile-nav.tsx")

  assert.match(layout, /VERCEL_ENV === "preview"/)
  assert.match(layout, /SELLER_OS_UX_V2_ENABLED !== "false"/)
  assert.match(shell, /pathname === "\/admin\/login"/)
  assert.equal((shell.match(/<PrimaryNavigation/g) ?? []).length, 1)
  assert.equal((primary.match(/<nav/g) ?? []).length, 1)
  assert.match(compatibility, /return null/)
})

test("el shell ofrece navegación utilitaria, breadcrumbs y actividad durable", () => {
  const shell = read("app/admin/components/seller-os/seller-os-shell.tsx")
  assert.match(shell, /<UtilityNavigation/)
  assert.match(shell, /aria-label="Migas de pan"/)
  assert.match(shell, /<GlobalActivityDock/)
  assert.match(shell, /Saltar al contenido principal/)
})
