import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

const contract = await import("./ebay-mayel-full-visual-delegation-v1.ts")

test("full delegation scope includes all visual authority and excludes commercial authority", () => {
  assert.equal(contract.mayelFullVisualScopeContractValidV1(), true)
  assert.ok(contract.MAYEL_FULL_VISUAL_ALLOWED_ACTIONS.includes("MAIN_IMAGE"))
  assert.ok(contract.MAYEL_FULL_VISUAL_ALLOWED_ACTIONS.includes(
    "LIVE_LISTING_VISUAL_OPTIMIZATION"))
  assert.ok(contract.MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS.includes("PRICE"))
  assert.ok(contract.MAYEL_FULL_VISUAL_FORBIDDEN_ACTIONS.includes(
    "PUBLISH_NEW_LISTING"))
})

test("delegation enablement uses only global authority predicates", () => {
  const result = contract.buildMayelFullVisualDelegationPredicatesV1({
    ownerAuthenticated: true,
    workspaceReady: true,
    accountIdentityProven: true,
    delegationScopeValid: true,
    authorityStorageReady: true,
    revocationReady: true,
  })
  assert.equal(result.buttonEnabled, true)
  assert.equal(result.firstBlockingPredicate, null)
  assert.deepEqual(result.predicates.map((entry) => entry.code), [
    "OWNER_AUTHENTICATED", "MAYEL_WORKSPACE_READY",
    "ACCOUNT_IDENTITY_PROVEN", "DELEGATION_SCOPE_VALID",
    "AUTHORITY_STORAGE_READY", "REVOCATION_READY",
  ])
})

test("first global blocker is stable and human-readable", () => {
  const result = contract.buildMayelFullVisualDelegationPredicatesV1({
    ownerAuthenticated: true,
    workspaceReady: true,
    accountIdentityProven: false,
    delegationScopeValid: true,
    authorityStorageReady: true,
    revocationReady: true,
  })
  assert.equal(result.buttonEnabled, false)
  assert.equal(result.firstBlockingPredicate, "ACCOUNT_IDENTITY_PROVEN")
  assert.match(result.disableReason, /cuenta eBay vinculada/i)
})

test("durable authority material binds owner, account, exact scope and stable digest", () => {
  const input = { authorityId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    accountKey: `owner:${"a".repeat(64)}`,
    ownerConfirmedAt: "2026-09-05T12:00:00.000Z" }
  const material = contract.mayelFullVisualDelegationMaterialV1(input)
  assert.equal(material.mainImageAuthority, true)
  assert.equal(material.ownerPerImageApproval, false)
  assert.equal(material.ownerPerListingVisualApproval, false)
  assert.equal(contract.mayelFullVisualDelegationDigestV1(material),
    contract.mayelFullVisualDelegationDigestV1({ ...material }))
})

test("API, UI and migration preserve owner-only durable delegation with zero marketplace writes", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/mayel-visual-workstation/route.ts",
    import.meta.url), "utf8")
  const ui = readFileSync(new URL(
    "../../app/admin/mayel-visual-workstation.tsx", import.meta.url), "utf8")
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260906020152_mayel_full_visual_delegation_authority_v1.sql",
    import.meta.url), "utf8")
  const server = readFileSync(new URL(
    "./ebay-mayel-full-visual-delegation-server-v1.ts",
    import.meta.url), "utf8")
  const accountGateway = readFileSync(new URL(
    "./ebay-account-policy-readonly-gateway.ts", import.meta.url), "utf8")
  const phaseBServer = readFileSync(new URL(
    "./ebay-mayel-visual-phase-b-server-v1.ts", import.meta.url), "utf8")
  assert.match(route, /AUTHORIZE_FULL_VISUAL_DELEGATION/)
  assert.match(route, /REVOKE_FULL_VISUAL_DELEGATION/)
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(ui, /AUTORIZAR MAYEL · CONTROL VISUAL/)
  assert.match(ui, /Revocar delegación/)
  assert.match(ui, /Cuenta eBay/)
  assert.match(ui, /Workspace Mayel/)
  assert.match(ui, /Persistencia de autoridad/)
  assert.match(ui, /No hay evidencia suficiente para/)
  assert.doesNotMatch(ui, /Imagen principal protegida:/)
  assert.doesNotMatch(ui, /aprobación del owner pendiente/)
  assert.match(route, /MAYEL_FULL_VISUAL_DELEGATION_READ_MODEL_V1/)
  assert.match(server, /readCanonicalEbayAccountIdentityAuthorityV1/)
  assert.doesNotMatch(server, /preflightEbayDraftOnlyMobile/)
  assert.doesNotMatch(phaseBServer, /account: "Cuenta eBay vinculada"/)
  assert.match(accountGateway,
    /export async function readCanonicalEbayAccountIdentityAuthorityV1/)
  assert.match(migration, /main_image_authority = true/)
  assert.match(migration, /owner_per_image_approval = false/)
  assert.match(migration, /owner_per_listing_visual_approval = false/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /from public, anon, authenticated/)
  assert.match(migration, /LEDGER_APPEND_ONLY/)
})
