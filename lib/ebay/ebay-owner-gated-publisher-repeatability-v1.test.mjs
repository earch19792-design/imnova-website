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

const { ebayReadbackMismatchPathsV1 } = await import(
  "./ebay-draft-only-gateway.ts"
)

const route = readFileSync(new URL(
  "../../app/api/admin/ebay/draft-only/route.ts",
  import.meta.url,
), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx",
  import.meta.url,
), "utf8")

test("readback matrix treats only material listing values as constraints", () => {
  const fixtures = [
    {
      name: "FREE_TEXT_SPECIFICS",
      expected: { product: { aspects: { Type: ["LED TV Backlight Strip"] } } },
      actual: { product: { aspects: { Type: ["LED TV Backlight Strip"] } } },
      mismatches: [],
    },
    {
      name: "SELECTION_ONLY_SPECIFICS",
      expected: { product: { aspects: { Department: ["Unisex Kids"] } } },
      actual: { product: { aspects: { Department: ["Unisex Kids"] } } },
      mismatches: [],
    },
    {
      name: "OPTIONAL_SPECIFICS_EMPTY",
      expected: { product: { aspects: {} } },
      actual: { product: {} },
      mismatches: [],
    },
    {
      name: "MULTIPLE_IMAGES",
      expected: { product: { imageUrls: ["one.jpg", "two.jpg"] } },
      actual: { product: { imageUrls: ["one.jpg", "two.jpg"] } },
      mismatches: [],
    },
    {
      name: "DIFFERENT_CATEGORIES",
      expected: { categoryId: "20641" },
      actual: { categoryId: "3087" },
      mismatches: ["$.categoryId"],
    },
    {
      name: "DIFFERENT_ACCOUNT_POLICY_COMBINATIONS_ALLOWED",
      expected: { listingPolicies: { paymentPolicyId: "PAY-A" } },
      actual: { listingPolicies: { paymentPolicyId: "PAY-B" } },
      mismatches: ["$.listingPolicies.paymentPolicyId"],
    },
  ]
  for (const fixture of fixtures) {
    assert.deepEqual(
      ebayReadbackMismatchPathsV1(fixture.actual, fixture.expected),
      fixture.mismatches,
      fixture.name,
    )
  }
})

test("existing unpublished Offer reload and repeated validation are stable", () => {
  const expected = {
    sku: "IMNOVA-PACKAGE",
    status: "UNPUBLISHED",
    listingPolicies: { fulfillmentPolicyId: "FUL-A" },
  }
  const actual = { ...expected, offerId: "255290419011" }
  const first = ebayReadbackMismatchPathsV1(actual, expected)
  const second = ebayReadbackMismatchPathsV1(actual, expected)
  assert.deepEqual(first, [])
  assert.deepEqual(second, first)
})

test("GET and page refresh cannot create or continue marketplace writes", () => {
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, postStart)
  assert.match(get, /readExactUnpublishedPublicationState/)
  assert.doesNotMatch(get,
    /createOrReplaceEbayDraftInventoryItem|createEbayUnpublishedOffer|publishEbayOfferOnce/)
  assert.doesNotMatch(workspace, /authenticatedPublicationRecoveryRun/)
  assert.doesNotMatch(workspace,
    /const recovery = draftState\.authenticatedPublicationRecovery/)
  assert.match(workspace,
    /Recargar o volver a esta pantalla nunca continúa una escritura/)
})

test("network failures remain classified and never trigger hidden retry", () => {
  assert.match(route, /const status = readback\.retryable \? 503 : 409/)
  assert.match(route, /upstreamStatus: readback\.upstreamStatus/)
  assert.match(route, /errorClass: readback\.errorClass/)
  assert.match(route, /safeNextAction: readback\.safeNextAction/)
  assert.match(route, /publishOfferCalled: false/)
  assert.doesNotMatch(workspace, /setInterval\([\s\S]{0,300}prepare_publish/)
})

test("owner actions stop after UNPUBLISHED and preview boundaries", () => {
  const start = workspace.indexOf(
    "async function publishSmartStockingWithSingleAuthorization()",
  )
  const end = workspace.indexOf("async function approveDraft()", start)
  const action = workspace.slice(start, end)
  assert.match(action, /unpublishedDraftCreatedThisClick/)
  assert.match(action, /refreshed\.unpublishedReadback\?\.safe !== true/)
  assert.match(action, /if \(previewPreparedThisClick\)/)
  assert.match(action, /action: "publish"/)
  assert.ok(action.indexOf("if (unpublishedDraftCreatedThisClick)") <
    action.indexOf('action: "prepare_publish"'))
  assert.ok(action.indexOf("if (previewPreparedThisClick)") <
    action.indexOf('action: "publish"'))
})

