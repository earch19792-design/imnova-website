import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("shell y navegación cumplen el contrato accesible fundamental", () => {
  const shell = read("app/admin/components/seller-os/seller-os-shell.tsx")
  const primary = read("app/admin/components/seller-os/primary-navigation.tsx")
  const styles = read("app/admin/components/seller-os/seller-os-shell.module.css")

  assert.match(shell, /Saltar al contenido principal/)
  assert.match(shell, /tabIndex=\{-1\}/)
  assert.match(primary, /aria-current=/)
  assert.match(styles, /min-height: 2\.75rem/)
  assert.match(styles, /min-height: 3\.5rem/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test("el progreso sólo expone ARIA cuando el valor está determinado", () => {
  const dock = read("app/admin/components/seller-os/global-activity-dock.tsx")
  assert.match(dock, /determinedFiveSlotProgress &&/)
  assert.match(dock, /role="progressbar"/)
  assert.match(dock, /aria-valuenow=/)
  assert.match(dock, /aria-valuetext=/)
})
