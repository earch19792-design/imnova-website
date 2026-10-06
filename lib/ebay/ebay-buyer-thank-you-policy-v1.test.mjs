import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

import { PGlite } from "@electric-sql/pglite"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  createUnauthorizedSellerOsBuyerThankYouPolicyV1,
  readSellerOsBuyerThankYouPolicyV1,
} = await import("./ebay-buyer-thank-you-policy-v1.ts")

const ACCOUNT = "EBAY_US:SELLER_PRIMARY"
const NOW = "2026-10-06T17:00:00.000Z"
const TEMPLATE_SHA =
  "eab110987291c762c8a39f4451f5e7f6a3095f3f21a22f7d174a2ba3589f6a08"

function fakePolicyClient(row, error = null) {
  const filters = []
  const builder = {
    select() { return builder },
    eq(column, value) { filters.push([column, value]); return builder },
    async maybeSingle() {
      if (error) return { data: null, error }
      const matches = row && filters.every(([column, value]) =>
        row[column] === value)
      return { data: matches ? row : null, error: null }
    },
  }
  return { from(table) {
    assert.equal(table, "seller_os_buyer_thank_you_policies_v1")
    return builder
  } }
}

function policyRow(overrides = {}) {
  return {
    marketplace_account_key: ACCOUNT,
    marketplace: "EBAY_US",
    policy_name: "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU",
    policy_version: "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU_V1",
    execution_authority: "OWNER_AUTHORIZED_FIXED_TEMPLATE",
    template_version: "POST_PURCHASE_THANK_YOU_TEMPLATE_V1",
    template_sha256: TEMPLATE_SHA,
    message_grain: "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER",
    owner_authorized_at: "2026-10-06T16:36:34.947Z",
    active: true,
    ...overrides,
  }
}

test("durable policy authorizes only the canonical account and fixed template", async () => {
  const authorized = await readSellerOsBuyerThankYouPolicyV1(
    fakePolicyClient(policyRow()), ACCOUNT, NOW,
  )
  const otherAccount = await readSellerOsBuyerThankYouPolicyV1(
    fakePolicyClient(policyRow()), "EBAY_US:OTHER", NOW,
  )
  const changedTemplate = await readSellerOsBuyerThankYouPolicyV1(
    fakePolicyClient(policyRow({ template_sha256: "0".repeat(64) })),
    ACCOUNT,
    NOW,
  )
  assert.equal(authorized.status, "AUTHORIZED")
  assert.equal(authorized.executionAuthority, "OWNER_AUTHORIZED_FIXED_TEMPLATE")
  assert.equal(authorized.messageGrain, "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER")
  assert.equal(authorized.arbitraryTextAllowed, false)
  assert.equal(authorized.arbitraryRecipientAllowed, false)
  assert.equal(authorized.unrelatedMarketplaceWritesAllowed, false)
  assert.equal(otherAccount.status, "NOT_AUTHORIZED")
  assert.equal(changedTemplate.status, "NOT_AUTHORIZED")
  assert.equal(changedTemplate.executionAuthority, "HUMAN_APPROVAL_REQUIRED")
})

test("missing or unreadable policy remains fail-closed", async () => {
  const missing = await readSellerOsBuyerThankYouPolicyV1(
    fakePolicyClient(null), ACCOUNT, NOW,
  )
  const unreadable = await readSellerOsBuyerThankYouPolicyV1(
    fakePolicyClient(null, { code: "DATABASE_UNAVAILABLE" }), ACCOUNT, NOW,
  )
  const fallback = createUnauthorizedSellerOsBuyerThankYouPolicyV1(
    "OWNER_POLICY_REQUIRED", NOW,
  )
  assert.equal(missing.status, "NOT_AUTHORIZED")
  assert.equal(unreadable.status, "UNAVAILABLE")
  assert.equal(fallback.executionAuthority, "HUMAN_APPROVAL_REQUIRED")
})

test("migration persists owner authority and corrects legacy delivery semantics", async () => {
  const database = new PGlite()
  try {
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.commercial_threshold_configs (
        marketplace_account_key text not null,
        marketplace text not null,
        active boolean not null
      );
      create table public.commercial_alert_events (
        id text primary key,
        marketplace_account_key text not null,
        marketplace text not null,
        event_type text not null,
        marketplace_order_id text,
        evidence jsonb not null
      );
      insert into public.commercial_alert_events values (
        'current-order-workflow', '${ACCOUNT}', 'EBAY_US',
        'EBAY_BUYER_THANK_YOU_DELIVERY', '12-15256-64974',
        '{"workflowState":"RETRYABLE_FAILURE","attemptCount":2,"dispatchStarted":false,"receiptStatus":"ABSENT"}'::jsonb
      );
    `)
    const migration = readFileSync(new URL(
      "../../supabase/migrations/20261006164818_owner_authorized_automatic_buyer_thank_you_p0.sql",
      import.meta.url,
    ), "utf8")
    await database.exec(migration)
    const policy = await database.query(`
      select marketplace_account_key, policy_name, execution_authority,
        template_version, template_sha256, message_grain, active
      from public.seller_os_buyer_thank_you_policies_v1
    `)
    const workflow = await database.query(`
      select event_type, evidence->>'deliveryState' as delivery_state,
        evidence->>'deliveredConfirmed' as delivered_confirmed
      from public.commercial_alert_events
      where marketplace_order_id = '12-15256-64974'
    `)
    assert.deepEqual(policy.rows, [{
      marketplace_account_key: ACCOUNT,
      policy_name: "OWNER_AUTHORIZED_AUTOMATIC_BUYER_THANK_YOU",
      execution_authority: "OWNER_AUTHORIZED_FIXED_TEMPLATE",
      template_version: "POST_PURCHASE_THANK_YOU_TEMPLATE_V1",
      template_sha256: TEMPLATE_SHA,
      message_grain: "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER",
      active: true,
    }])
    assert.deepEqual(workflow.rows, [{
      event_type: "EBAY_BUYER_THANK_YOU_WORKFLOW",
      delivery_state: "PREPARED",
      delivered_confirmed: "false",
    }])
  } finally {
    await database.close()
  }
})
