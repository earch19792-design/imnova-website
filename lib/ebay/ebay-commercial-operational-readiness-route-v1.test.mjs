import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL("../../app/api/admin/ebay/operational-readiness/route.ts",
  import.meta.url), "utf8")
const page = readFileSync(new URL("../../app/admin/ebay/operational-readiness/page.tsx",
  import.meta.url), "utf8")
const monitor = readFileSync(new URL("../../app/admin/ebay/monitor/commercial-monitor-canonical-dashboard.tsx",
  import.meta.url), "utf8")

test("operational readiness route is admin protected and supports dry-run contracts only", () => {
  assert.match(route, /validateAdminApiRequest\(req\)/)
  assert.match(route, /dispatchAllowed: false/)
  assert.match(route, /whatsappSends: 0/)
  assert.match(route, /productCaseMutations: 0/)
  assert.doesNotMatch(route, /sendWhatsApp|reviseInventoryStatus|apply_ebay_registry_repair/)
})

test("UI preserves Product Case pause and never exposes a send control", () => {
  assert.match(page, /Product Case permanece en pausa/)
  assert.match(page, /Vista previa humana de WhatsApp/)
  assert.doesNotMatch(page, />Send WhatsApp<|>Resume Product Case</)
  assert.match(monitor, /Estado del sistema/)
  assert.match(monitor, /systemStatusCounts/)
})

test("dedicated Orders credentials remain separate and no env mutation exists", () => {
  assert.match(route, /EBAY_COMMERCIAL_ORDERS_CLIENT_ID/)
  assert.match(route, /EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET/)
  assert.match(route, /EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN/)
  assert.doesNotMatch(route, /process\.env\.[A-Z0-9_]+\s*=/)
})
