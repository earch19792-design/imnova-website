import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, extname, join, resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "..")
const read = (path) => readFileSync(join(root, path), "utf8")
const exists = (path) => existsSync(join(root, path))

function countNamed(rootPath, filename) {
  if (!exists(rootPath)) return 0
  return readdirSync(join(root, rootPath), { withFileTypes: true }).reduce((count, entry) => {
    const relative = join(rootPath, entry.name)
    return count + (entry.isDirectory() ? countNamed(relative, filename) : entry.name === filename ? 1 : 0)
  }, 0)
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null
  const base = specifier.startsWith("@/") ? join(root, specifier.slice(2)) : resolve(dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function dependencyGraph(entries) {
  const visited = new Set()
  const pending = entries.map((entry) => join(root, entry)).filter(existsSync)
  while (pending.length) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(/(?:from\s+|import\s*\()?["']([^"']+)["']/g)) {
      const resolved = resolveImport(file, match[1])
      if (resolved && !visited.has(resolved)) pending.push(resolved)
    }
  }
  return [...visited].map((file) => file.slice(root.length + 1))
}

const sellerEntries = [
  "app/page.tsx", "app/layout.tsx", "app/admin/page.tsx", "app/admin/login/page.tsx",
  ...readdirSync(join(root, "app/admin/ebay"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const page = `app/admin/ebay/${entry.name}/page.tsx`
    return exists(page) ? [page] : []
  }),
  ...readdirSync(join(root, "app/api/admin/ebay"), { withFileTypes: true }).flatMap(() => []),
]

test("SELLER_STAGING_HAS_ZERO_LEGACY_PRODUCT_DOMAIN_CALLS", () => {
  const graph = dependencyGraph(sellerEntries)
  const forbiddenDependencies = ["lib/products-service.ts", "components/imnova-popup.tsx", "components/innovations-section.tsx", "components/global-section.tsx"]
  for (const forbidden of forbiddenDependencies) assert.equal(graph.includes(forbidden), false, `${forbidden} reached active Seller runtime`)
  for (const route of ["app/api/community", "app/api/store", "app/api/innova-lab"]) assert.equal(countNamed(route, "route.ts"), 0, `${route} remains compiled`)
})

test("public home is Seller OS, static, and admin-login-only", () => {
  const source = read("app/page.tsx")
  assert.match(source, /SELLER OS/)
  assert.match(source, /Iniciar sesión como administrador/)
  assert.match(source, /No afiliada ni respaldada oficialmente por eBay/)
  assert.doesNotMatch(source, /fetch\(|supabase|signUp|registro público|InnovaPopup|community|vote|wellness|nutrición/i)
  assert.equal([...source.matchAll(/href="([^"]+)"/g)].every((match) => match[1] === "/admin/login"), true)
})

test("admin login has no public signup and creates protected server session", () => {
  const login = read("app/admin/login/page.tsx")
  const session = read("app/api/admin/session/route.ts")
  const cookieContract = read("lib/admin-session-cookie-contract.ts")
  assert.doesNotMatch(login, /signUp|registrarse|crear cuenta/i)
  assert.match(login, /SELLER OS/)
  assert.match(cookieContract, /httpOnly:\s*true/)
  assert.match(cookieContract, /sameSite:\s*"strict"/)
  assert.match(session, /cross_site_request_rejected/)
  assert.match(session, /authenticationMode !== "seller_os_user"/)
  assert.match(session,
    /validation\.accessRole === SELLER_OS_ACCESS_ROLES\.owner/)
})

test("unauthorized admin pages redirect server-side with a safe internal return path", () => {
  const middleware = read("middleware.ts")
  const returnPath = read("lib/admin-auth-return.ts")
  assert.match(middleware, /isVerifiedSellerOsToken/)
  assert.match(middleware,
    /verification === "REMOTE_OPERATOR" && pathname !== "\/admin"/)
  assert.match(middleware, /seller_os_admin_session/)
  assert.match(middleware, /new URL\("\/admin\/login"/)
  assert.match(returnPath, /!candidate\.startsWith\("\/admin"\)/)
  assert.match(returnPath, /candidate\.startsWith\("\/\/"\)/)
})

test("canonical navigation has intent-based areas and one source", () => {
  const navigation = read("lib/seller-os/navigation.ts")
  const mobile = read("app/admin/ebay/components/seller-os-mobile-nav.tsx")
  const ids = [...navigation.matchAll(/id: "(monitor|quick-pick|listings|opportunities|experiments|inventory|orders|decisions|learning|system-status)"/g)].map((match) => match[1])
  assert.deepEqual(ids, ["monitor", "quick-pick", "opportunities", "listings", "experiments", "inventory",
    "orders", "decisions", "learning", "system-status"])
  assert.match(mobile, /SELLER_OS_MOBILE_NAVIGATION\.map/)
  assert.match(navigation, /objective:/)
  assert.doesNotMatch(mobile, /const destinations|Comunidad|Idea Lab|Productos IMNOVA|Product Development/)
})

test("public legacy routes are retired and legal pages are Seller OS only", () => {
  for (const path of ["app/store/page.tsx", "app/store/[slug]/page.tsx", "app/miembro/page.tsx", "app/about/page.tsx", "app/contact/page.tsx", "app/privacy-policy/page.tsx"]) assert.equal(exists(path), false, `${path} should not compile`)
  assert.match(read("middleware.ts"), /RETIRED_PUBLIC_PREFIXES/)
  assert.match(read("middleware.ts"), /status:\s*410/)
  for (const path of ["app/privacy/page.tsx", "app/terms/page.tsx"]) {
    const legal = read(path)
    assert.match(legal, /Seller OS/i)
    assert.doesNotMatch(legal, /VIP|bienestar|nutrición funcional/i)
  }
})

test("public and admin surfaces do not load the old popup, analytics, or brand", () => {
  const runtimeSurface = ["app/page.tsx", "app/layout.tsx", "app/admin/page.tsx", "app/admin/login/page.tsx"].map(read).join("\n")
  assert.doesNotMatch(runtimeSurface, /InnovaPopup|ButtonClickNotifier|@vercel\/analytics|IMNOVA LABS|Community|Idea Lab|Product Development/)
})

test("canonical links exist and navigation remains mobile accessible", () => {
  const navigation = read("lib/seller-os/navigation.ts")
  const hrefs = [...navigation.matchAll(/href: "([^"]+)"/g)].map((match) => match[1].split(/[?#]/)[0])
  for (const href of hrefs) {
    const route = href === "/admin" ? "app/admin/page.tsx" : `app${href}/page.tsx`
    assert.equal(exists(route), true, `dead canonical link ${href}`)
  }
  const mobile = read("app/admin/ebay/components/seller-os-mobile-nav.tsx")
  assert.match(mobile, /aria-label=/)
  assert.match(mobile, /aria-current=/)
  assert.match(mobile, /grid-cols-5/)
})

test("route and bundle surface regress downward", () => {
  assert.equal(exists("app/admin/ebay/monitor/page.tsx"), true, "canonical read-only monitor page is missing")
  assert.equal(exists("app/api/admin/ebay/monitor/route.ts"), true, "canonical read-only monitor API is missing")
  const temporarySellerOauthPage = exists(
    "app/admin/ebay/monitor/seller-oauth-reauth/page.tsx",
  )
  const temporarySellerOauthApi = exists(
    "app/api/admin/ebay/monitor/seller-oauth-reauth/route.ts",
  )
  const commercialOauthBrowserPage = exists(
    "app/admin/ebay/monitor/commercial-orders-oauth-start/page.tsx",
  )
  const commercialOauthBrowserApi = exists(
    "app/api/admin/ebay/commercial-orders-oauth/browser-start/route.ts",
  )
  const lunaProtectedSessionPage = exists(
    "app/admin/ebay/luna-protected-session/page.tsx",
  )
  const lunaProtectedSessionApi = exists(
    "app/api/admin/ebay/luna-protected-session/route.ts",
  )
  const lunaSupplierLinkageReviewPage = exists(
    "app/admin/ebay/luna-supplier-linkage-review/page.tsx",
  )
  const lunaSupplierLinkageReviewApi = exists(
    "app/api/admin/ebay/luna-supplier-linkage-review/route.ts",
  )
  const lunaShippingCapturePage = exists(
    "app/admin/ebay/luna-shipping-capture/page.tsx",
  )
  const lunaShippingCaptureApi = exists(
    "app/api/admin/ebay/luna-shipping-capture/route.ts",
  )
  const lunaQuickPickPage = exists(
    "app/admin/ebay/quick-pick/page.tsx",
  )
  const lunaQuickPickApi = exists(
    "app/api/admin/ebay/luna-quick-pick/route.ts",
  )
  assert.equal(
    temporarySellerOauthPage,
    temporarySellerOauthApi,
    "temporary seller OAuth UI/API must be added and retired together",
  )
  assert.equal(
    commercialOauthBrowserPage,
    commercialOauthBrowserApi,
    "Commercial Orders browser START UI/API must be added and retired together",
  )
  assert.equal(
    lunaProtectedSessionPage,
    lunaProtectedSessionApi,
    "Luna protected-session UI/API must be added and retired together",
  )
  assert.equal(
    lunaSupplierLinkageReviewPage,
    lunaSupplierLinkageReviewApi,
    "Luna supplier-linkage review UI/API must be added and retired together",
  )
  assert.equal(
    lunaShippingCapturePage,
    lunaShippingCaptureApi,
    "Luna shipping capture UI/API must be added and retired together",
  )
  assert.equal(
    lunaQuickPickPage,
    lunaQuickPickApi,
    "Luna Quick Pick UI/API must be added and retired together",
  )
  // The read-only monitor, Market Research, Commercial Operational Readiness,
  // Decisions, Experiments, Learning, Luna Capture, Copilot, and Strategic
  // Review workspaces add nine intentional pages. Their protected surfaces
  // add seven authenticated read-only/dry-run APIs, including the shared
  // Intelligence reader and the private MCP bridge.
  // to the previously isolated Seller OS surface. The explicitly temporary
  // seller reauthorization gate may add one paired page/API while present.
  assert.ok(
    countNamed("app", "page.tsx") <= 23 + Number(temporarySellerOauthPage) +
      Number(commercialOauthBrowserPage) + Number(lunaProtectedSessionPage) +
      Number(lunaSupplierLinkageReviewPage) + Number(lunaShippingCapturePage) +
      Number(lunaQuickPickPage),
    "page route count regressed",
  )
  // 68 legacy-era routes -> 65 isolated routes -> one approval-only Seller OS
  // strategic-advisor route -> one Preview-only active-listing Luna monitor
  // -> one isolated, GET-only eBay account-policy preflight route -> two
  // service-role/admin-only publication OAuth handoff routes -> one isolated
  // reference-guided canary route -> four service-role-only successor position
  // executors (3–6) -> one admin-only, non-consuming extraordinary replacement
  // authorization route -> one Preview-only extraordinary position-4 ordinal-7
  // executor -> one final Preview-only extraordinary position-6 ordinal-8
  // executor -> one authenticated, read-only final-listing-review hydration
  // route -> one authenticated V3 UNPUBLISHED authorization/preflight route
  // -> one authenticated read-only Market Research route -> one authenticated
  // operational-readiness contract/dry-run route with all dispatch disabled
  // -> one authenticated read-only Intelligence route shared by Decisions,
  // Experiments, and Learning -> one Preview-only authenticated cloud read
  // relay for the loopback Secure MCP Tunnel runtime -> one authenticated,
  // quota-zero Daily Dollar Radar cron boundary that remains unregistered
  // until its durable scheduler/timezone policy is approved -> one bounded
  // Remote LIVE operator route over the existing authorities -> one owner-
  // invited, singleton remote-operator enrollment route (no public signup).
  // The old product/community domain remains at zero.
  assert.ok(
    countNamed("app/api", "route.ts") <= 92 + Number(temporarySellerOauthApi) +
      Number(commercialOauthBrowserApi) + Number(lunaProtectedSessionApi) +
      Number(lunaSupplierLinkageReviewApi) + Number(lunaShippingCaptureApi) +
      Number(lunaQuickPickApi),
    "API route count regressed",
  )
  assert.equal(countNamed("app/api/community", "route.ts"), 0)
  assert.equal(countNamed("app/api/store", "route.ts"), 0)
})

test("isolation manifests are valid, rollback is recoverable, and production is excluded", () => {
  for (const path of ["docs/seller-os/legacy-removal-manifest.json", "docs/seller-os/redirects-manifest.json", "docs/seller-os/retained-shared-components.json", "docs/seller-os/domain-isolation-audit.json"]) JSON.parse(read(path))
  assert.match(read("docs/seller-os/removal-rollback-plan.md"), /revert that commit/)
  assert.match(read("docs/seller-os/removal-rollback-plan.md"), /Production is outside/)
})
