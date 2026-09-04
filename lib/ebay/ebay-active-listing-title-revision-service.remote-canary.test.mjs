import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

let implementation = readFileSync(
  "lib/ebay/ebay-active-listing-title-revision-service.ts", "utf8")
implementation = implementation
  .replace(/import type \{ SupabaseClient \} from "@supabase\/supabase-js"\n\n/, "")
  .replace(/import \{\n  buildEbayInventoryManagedTitleReplacementV1,[\s\S]*?\} from "\.\/ebay-draft-only-gateway"\n/,
    `const buildEbayInventoryManagedTitleReplacementV1 = () => ({
  payload: {}, nonAuthorizedFieldsPreserved: true,
})
const prepareEbayActiveListingTitleExecutorV1 = async (input) =>
  globalThis.__titleManagementPrepare(input)
const executeEbayInventoryManagedTitleMutationV1 = async (input) =>
  globalThis.__titleInventoryExecute(input)
`)
  .replace(/import \{\n  getEbayTradingReadOnlyAccessToken,[\s\S]*?\} from "\.\/ebay-manual-listing-trading-readonly"\n/,
    `const getEbayTradingReadOnlyAccessToken = async () => "test-token"
const tradingXmlContainer = (xml, tag) =>
  xml.match(new RegExp("<" + tag + "(?: [^>]*)?>([\\\\s\\\\S]*?)</" + tag + ">", "i"))?.[1] ?? ""
const tradingXmlTagValue = (xml, tag) =>
  xml.match(new RegExp("<" + tag + "(?: [^>]*)?>([\\\\s\\\\S]*?)</" + tag + ">", "i"))?.[1] ?? ""
`)
  .replace(/import \{ parseAuthoritativeFactsInputPackage \} from "\.\/ebay-product-facts-readiness"\n/,
    "const parseAuthoritativeFactsInputPackage = () => null\n")
  .replace(/import \{\n  ebayProductionAccountFingerprint,[\s\S]*?\} from "\.\/ebay-seller-account-scope"\n/,
    `const ebayProductionAccountFingerprint = () => "remote-canary-fingerprint"
const getEbayProductionIdentityBindingConfiguration = () => ({
  bound: true, consistent: true,
  expectedAccountFingerprint: "remote-canary-fingerprint",
  expectedUserId: "seller-os-test-user",
})
`)
  .replace(/import \{\n  buildVerifiedEbayTitle,[\s\S]*?\} from "\.\/ebay-verified-title-strategy"\n/,
    `const buildVerifiedEbayTitle = () => ""
const EBAY_VERIFIED_TITLE_STRATEGY_VERSION = "TEST"
`)
const compiled = ts.transpileModule(implementation, { compilerOptions: {
  module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
} }).outputText
const { ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION,
  applyPreparedVerifiedActiveListingTitle } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)

const itemId = "366634810965"
const actorId = "95fe998d-d772-4dee-90fb-f58807503663"
const executionId = "11111111-1111-4111-8111-111111111111"
const accountKey = "EBAY_US:remote-canary-fingerprint"
const sku = "IMNOVA3A394C94108B4CA0B3735E589DC4A652"
const currentTitle =
  "Window Privacy Film One Way 23.6 in x 9.84 ft Tint for Home"
const proposedTitle = `${currentTitle} Black`

function ledgerRow(overrides = {}) {
  return {
    id: executionId, actor_user_id: actorId,
    marketplace_account_key: accountKey,
    account_fingerprint: "remote-canary-fingerprint",
    execution_authority: "REMOTE_OPERATOR_SAFE_TITLE_CANARY",
    ebay_item_id: itemId, ebay_sku: sku,
    authorized_current_title: currentTitle,
    target_title: proposedTitle, phase: "preview_ready",
    ebay_write_attempt_count: 0, ebay_write_dispatched: false,
    claim_token: null, lease_expires_at: null,
    ...overrides,
  }
}

function memorySupabase(row) {
  return {
    from(table) {
      assert.equal(table, "ebay_active_listing_title_revision_executions")
      let patch = null
      const checks = []
      const query = {
        select() { return query },
        update(value) { patch = value; return query },
        eq(key, value) {
          checks.push(() => row[key] === value)
          return query
        },
        in(key, values) {
          checks.push(() => values.includes(row[key]))
          return query
        },
        is(key, value) {
          checks.push(() => row[key] === value)
          return query
        },
        async single() { return finish(true) },
        async maybeSingle() { return finish(false) },
      }
      function finish(required) {
        const matches = checks.every((check) => check())
        if (!matches) return required
          ? { data: null, error: { message: "ROW_NOT_FOUND" } }
          : { data: null, error: null }
        if (patch) Object.assign(row, patch)
        return { data: { ...row }, error: null }
      }
      return query
    },
  }
}

function acceptedXml(callName, title) {
  if (callName === "GetUser") {
    return "<GetUserResponse><Ack>Success</Ack><User>" +
      "<UserID>seller-os-test-user</UserID></User></GetUserResponse>"
  }
  if (callName === "GetItem") {
    return "<GetItemResponse><Ack>Success</Ack><Item>" +
      `<ItemID>${itemId}</ItemID><Title>${title}</Title>` +
      "<Seller><UserID>seller-os-test-user</UserID></Seller>" +
      "<SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus>" +
      `<SKU>${sku}</SKU><ListingType>FixedPriceItem</ListingType>` +
      "</Item></GetItemResponse>"
  }
  return "<ReviseFixedPriceItemResponse><Ack>Success</Ack>" +
    `<ItemID>${itemId}</ItemID></ReviseFixedPriceItemResponse>`
}

function ebayFetch(titles) {
  const calls = []
  let itemRead = 0
  const fetchImpl = async (_url, init) => {
    const callName = init.headers["X-EBAY-API-CALL-NAME"]
    calls.push(callName)
    const title = callName === "GetItem" ? titles[itemRead++] : ""
    return new Response(acceptedXml(callName, title), { status: 200 })
  }
  return { calls, fetchImpl }
}

function applyInput(row, fetchImpl) {
  return { supabase: memorySupabase(row), accountKey, actorId, executionId,
    ebayItemId: itemId,
    confirmation: ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION,
    expectedCurrentTitle: currentTitle, fetchImpl }
}

function setTradingManaged() {
  globalThis.__titleManagementPrepare = async () => ({
    managementModel: "TRADING_MANAGED",
    managementEvidenceSource:
      "EBAY_INVENTORY_AUTHORITATIVE_ABSENCE_PLUS_EMPTY_OFFER_COLLECTION",
    inventoryHttpStatus: 404,
    offersHttpStatus: 200,
    exactPublishedOfferCount: 0,
    inventoryItemPresent: false,
    inventoryItemAuthoritativelyAbsent: true,
    offersReadComplete: true,
    groupedInventoryItem: false,
    inventoryEvidenceDigest: null,
    inventoryItemPayload: null,
  })
  globalThis.__titleInventoryExecute = async () => {
    throw new Error("INVENTORY_EXECUTOR_NOT_EXPECTED")
  }
}

test("changed LIVE title durably invalidates approval before any marketplace write", async () => {
  setTradingManaged()
  const row = ledgerRow()
  const ebay = ebayFetch([`${currentTitle} changed elsewhere`])
  await assert.rejects(
    applyPreparedVerifiedActiveListingTitle(applyInput(row, ebay.fetchImpl)),
    /REMOTE_OPERATOR_CANARY_AUTHORIZATION_INVALIDATED/,
  )
  assert.equal(row.phase, "terminal_failure")
  assert.equal(row.last_error_code,
    "REMOTE_OPERATOR_CANARY_AUTHORIZATION_INVALIDATED")
  assert.equal(row.ebay_write_attempt_count, 0)
  assert.equal(row.ebay_write_dispatched, false)
  assert.deepEqual(ebay.calls, ["GetUser", "GetItem"])
  assert.equal(ebay.calls.includes("ReviseFixedPriceItem"), false)
})

test("matching precondition performs one write and confirms exact official readback", async () => {
  setTradingManaged()
  const row = ledgerRow()
  const ebay = ebayFetch([currentTitle, proposedTitle])
  const result = await applyPreparedVerifiedActiveListingTitle(
    applyInput(row, ebay.fetchImpl),
  )
  assert.equal(result.phase, "applied_verified")
  assert.equal(result.titleVerified, true)
  assert.equal(result.currentValuePreconditionMatch, true)
  assert.equal(result.ebayWriteAttemptCount, 1)
  assert.equal(row.phase, "applied_verified")
  assert.deepEqual(ebay.calls,
    ["GetUser", "GetItem", "ReviseFixedPriceItem", "GetUser", "GetItem"])
  assert.equal(ebay.calls.filter((call) =>
    call === "ReviseFixedPriceItem").length, 1)
})

test("a double tap during the lease returns in progress without a second write", async () => {
  setTradingManaged()
  const row = ledgerRow({ phase: "write_in_flight",
    ebay_write_attempt_count: 1, ebay_write_dispatched: true,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString() })
  const ebay = ebayFetch([])
  const result = await applyPreparedVerifiedActiveListingTitle(
    applyInput(row, ebay.fetchImpl),
  )
  assert.equal(result.messageCode,
    "EBAY_ACTIVE_TITLE_REVISION_WRITE_IN_PROGRESS")
  assert.equal(result.ebayWriteAttemptCount, 1)
  assert.deepEqual(ebay.calls, [])
})

test("Inventory-managed listing uses one Inventory write and never Trading revise", async () => {
  const row = ledgerRow()
  const ebay = ebayFetch([currentTitle, proposedTitle])
  let inventoryWrites = 0
  globalThis.__titleManagementPrepare = async () => ({
    managementModel: "INVENTORY_API_MANAGED",
    managementEvidenceSource:
      "EBAY_INVENTORY_GET_ITEM_PLUS_EXACT_PUBLISHED_OFFER",
    inventoryHttpStatus: 200,
    offersHttpStatus: 200,
    exactPublishedOfferCount: 1,
    inventoryItemPresent: true,
    inventoryItemAuthoritativelyAbsent: false,
    offersReadComplete: true,
    groupedInventoryItem: false,
    inventoryEvidenceDigest: "sha256:" + "a".repeat(64),
    inventoryItemPayload: { sku, condition: "NEW",
      product: { title: currentTitle, imageUrls: ["https://img.test/1.jpg"] } },
  })
  globalThis.__titleInventoryExecute = async (input) => {
    inventoryWrites += 1
    assert.equal(input.currentTitle, currentTitle)
    assert.equal(input.targetTitle, proposedTitle)
    return { ok: true, status: 204, body: {}, outcomeKnown: true,
      retryable: false, operation: "CREATE_OR_REPLACE_INVENTORY_ITEM",
      errorId: "", nonAuthorizedFieldsPreserved: true }
  }
  const result = await applyPreparedVerifiedActiveListingTitle(
    applyInput(row, ebay.fetchImpl),
  )
  assert.equal(result.phase, "applied_verified")
  assert.equal(result.listingManagementModel, "INVENTORY_API_MANAGED")
  assert.equal(result.executorOperation, "CREATE_OR_REPLACE_INVENTORY_ITEM")
  assert.equal(inventoryWrites, 1)
  assert.equal(ebay.calls.includes("ReviseFixedPriceItem"), false)
  assert.deepEqual(ebay.calls, ["GetUser", "GetItem", "GetUser", "GetItem"])
})

test("unproven management model fails closed before claiming a marketplace write", async () => {
  const row = ledgerRow()
  const ebay = ebayFetch([currentTitle])
  globalThis.__titleManagementPrepare = async () => ({
    managementModel: "MANAGEMENT_MODEL_UNPROVEN",
    managementEvidenceSource: "EBAY_INVENTORY_MANAGEMENT_RELATIONSHIP_UNPROVEN",
    inventoryHttpStatus: 503,
    offersHttpStatus: 503,
    exactPublishedOfferCount: 0,
    inventoryItemPresent: false,
    inventoryItemAuthoritativelyAbsent: false,
    offersReadComplete: false,
    groupedInventoryItem: false,
    inventoryEvidenceDigest: null,
    inventoryItemPayload: null,
  })
  globalThis.__titleInventoryExecute = async () => {
    throw new Error("WRITE_MUST_NOT_RUN")
  }
  const result = await applyPreparedVerifiedActiveListingTitle(
    applyInput(row, ebay.fetchImpl),
  )
  assert.equal(result.phase, "terminal_failure")
  assert.equal(result.listingManagementModel, "MANAGEMENT_MODEL_UNPROVEN")
  assert.equal(result.ebayWriteAttemptCount, 0)
  assert.equal(result.ebayWriteDispatched, false)
  assert.equal(row.last_error_code,
    "EBAY_ACTIVE_TITLE_REVISION_MANAGEMENT_MODEL_UNPROVEN")
  assert.deepEqual(ebay.calls, ["GetUser", "GetItem"])
})
