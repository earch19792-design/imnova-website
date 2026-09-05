import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
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

const root = new URL("../../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")

test("canonical navigation owns the requested primary and System areas", async () => {
  const navigation = await import("./navigation.ts")
  assert.deepEqual(navigation.SELLER_OS_PRIMARY_NAVIGATION.map((item) =>
    item.label), ["Inicio", "Publicar", "Oportunidades", "Listings LIVE",
    "Ventas", "Postventa", "Mayel"])
  assert.deepEqual(navigation.SELLER_OS_SYSTEM_NAVIGATION.map((item) =>
    item.label), ["StockGuard", "Administración", "Experimentos"])
  assert.equal(navigation.SELLER_OS_NAVIGATION.some((item) =>
    item.label === "Quick Pick"), false)
  assert.equal(navigation.sellerOsNavigationItem("publish").children[0].label,
    "Preparar productos")
})

test("AS-IS inventory predates implementation and contains every required field", () => {
  const inventory = read(
    "docs/seller-os/SELLER_OS_OPERATIONAL_INFORMATION_ARCHITECTURE_V1_AS_IS.md")
  for (const field of ["ROUTE", "CAPABILITY", "AUTHORITATIVE_DATA_SOURCE",
    "MUTATING_OR_READ_ONLY", "RUNTIME_DEPENDENCY", "ROLE",
    "CURRENT_ENTRY_POINTS", "DUPLICATE_ENTRY_POINTS",
    "CAN_BE_HIDDEN_WITHOUT_STOPPING_RUNTIME"]) assert.match(inventory,
    new RegExp(field))
  for (const capability of ["Quick Pick", "Publisher", "Radar",
    "Listing Quality", "Mayel", "Postventa", "StockGuard",
    "Luna Shipping", "Product Research"]) assert.match(inventory,
    new RegExp(capability, "i"))
})

test("Home consumes one shared read-only snapshot and freezes Publisher", () => {
  const home = read("app/admin/seller-os-home-dashboard-v1.tsx")
  assert.match(home, /\/api\/admin\/ebay\/operational-snapshot/)
  assert.match(home, /FAILED_PHYSICAL_ACCEPTANCE/)
  assert.match(home, /data-home-read-only="true"/)
  assert.match(home, /data-get-business-mutations="0"/)
  assert.doesNotMatch(home, /method:\s*"POST"/)
  assert.doesNotMatch(home, /\$0\.00/)
  assert.match(home, /const lunaState = authority\.lunaState/)
  assert.doesNotMatch(home, /liveLunaState|runtime\.lunaWorker/)
})

test("every cron executor is POST-only and GET uses the zero-write guard", () => {
  const cronRoot = new URL("app/api/cron/", root)
  const routes = readdirSync(cronRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `app/api/cron/${entry.name}/route.ts`)
    .filter((route) => existsSync(new URL(route, root)))
  assert.equal(routes.length, 11)
  for (const route of routes) {
    const source = read(route)
    assert.match(source, /export async function POST\(/, route)
    assert.match(source,
      /export function GET\(\)[\s\S]*?sellerOsPostOnlyGetResponseV1\(\)/,
      route)
  }
  const vercel = JSON.parse(read("vercel.json"))
  assert.equal("crons" in vercel, false)
  assert.match(read("ops/seller-os-runtime-recovery/seller-os-runtime-recovery"),
    /--request POST/)
})

test("durable auditor learns mechanisms without product or marketplace authority", () => {
  const migration = read(
    "supabase/migrations/20260905084748_seller_os_operational_integrity_ledger_v1.sql")
  const scheduler = read(
    "supabase/migrations/20260905090044_seller_os_post_only_runtime_dispatch_v1.sql")
  const runtime = read("lib/seller-os/operational-integrity-runtime-v1.ts")
  for (const field of ["failure_class", "invariant_code",
    "mechanism_version", "evidence_fingerprint", "recovery_policy_version",
    "retry_safety", "recovery_outcome", "regression_guard",
    "first_observed_at", "resolved_at"]) assert.match(migration,
    new RegExp(field))
  assert.match(scheduler, /net\.http_post/)
  assert.match(scheduler, /pg_advisory_xact_lock/)
  assert.match(scheduler, /secret references only/i)
  assert.doesNotMatch(scheduler, /net\.http_get\s*\(/)
  assert.match(runtime, /marketplaceWrites:\s*0/)
  assert.match(runtime, /productDecisions:\s*0/)
  assert.match(runtime, /publisherDispatches:\s*0/)
})

test("Mayel rendering cannot acquire delegated work", () => {
  const workstation = read("app/admin/mayel-visual-workstation.tsx")
  const effect = workstation.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[load\]\)/)?.[0] ?? ""
  assert.doesNotMatch(effect, /ENSURE_NEXT_TASK/)
  assert.match(workstation, /data-mayel-explicit-work-acquisition/)
})

test("owner presentation cannot mount or activate Luna job acquisition", () => {
  const provider = read("app/admin/admin-owner-runtime-provider.tsx")
  const control = read(
    "app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx")
  const extension = read(
    "tools/browser-extensions/luna-shipping-capture/background.js")
  assert.doesNotMatch(provider, /<LunaShippingCaptureControlPlane/)
  assert.match(provider, /global owner shell must remain presentation-only/)
  assert.match(control, /params\.get\("bridgeOnly"\) === "1"/)
  assert.match(control,
    /if \(!productionRuntimeAuthorized \|\| hasExactLiveTarget/)
  assert.match(extension, /CONTROL_PAGE\}\?bridgeOnly=1/)
})
