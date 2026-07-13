import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ts from "typescript"

const root = new URL("../", import.meta.url)

async function source(path) {
  return readFile(new URL(path, root), "utf8")
}

async function importTypeScript(path) {
  const typescript = await source(path)
  const javascript = ts.transpileModule(typescript, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`)
}

test("policy executes strict winner and active-listing thresholds without null coercion", async () => {
  const policy = await importTypeScript("lib/ebay/ebay-seller-whatsapp-alert-policy.ts")
  const winner = policy.classifySellerWhatsAppAlert("winner_ready", {
    potentialScore: 75,
    confidenceScore: 70,
    currentStock: 4,
    estimatedMarginPct: 20,
    estimatedNetProfit: 5,
    hasExactEvidence: true,
  })
  assert.equal(winner.eligible, true)
  assert.equal(policy.classifySellerWhatsAppAlert("winner_ready", {
    potentialScore: null,
    confidenceScore: 70,
    currentStock: 4,
    estimatedMarginPct: 20,
    estimatedNetProfit: 5,
    hasExactEvidence: true,
  }).eligible, false)
  assert.equal(policy.classifySellerWhatsAppAlert("out_of_stock", {
    hasActiveListing: false,
    currentStock: 0,
  }).eligible, false)
  assert.equal(policy.classifySellerWhatsAppAlert("out_of_stock", {
    hasActiveListing: true,
    currentStock: 0,
  }).eligible, true)
  assert.equal(policy.classifySellerWhatsAppAlert("low_stock", {
    hasActiveListing: true,
    currentStock: 3,
  }).eligible, true)
  assert.equal(policy.classifySellerWhatsAppAlert("price_up", {
    hasActiveListing: true,
    costChangePct: 4.99,
  }).eligible, false)
  assert.equal(policy.classifySellerWhatsAppAlert("price_up", {
    hasActiveListing: true,
    costChangePct: 5,
  }).eligible, true)
  assert.equal(policy.classifySellerWhatsAppAlert("approval_expiration", {
    hoursUntilExpiration: null,
  }).eligible, false)
})

test("professional policy alerts only on material, actionable seller events", async () => {
  const policy = await source("lib/ebay/ebay-seller-whatsapp-alert-policy.ts")
  for (const alertType of [
    "winner_ready",
    "luna_restock",
    "luna_cost_drop",
    "out_of_stock",
    "low_stock",
    "price_up",
    "margin_risk",
    "draft_failure",
    "approval_expiration",
  ]) {
    assert.match(policy, new RegExp(`"${alertType}"`))
  }
  assert.match(policy, /potential < 75/)
  assert.match(policy, /confidence < 70/)
  assert.match(policy, /stock < 4/)
  assert.match(policy, /margin < 20/)
  assert.match(policy, /profit < 5/)
  assert.match(policy, /!exactEvidence/)
  assert.match(policy, /priority: "critical"/)
  assert.match(policy, /deliveryClass: "digest"/)
  assert.match(policy, /nextSellerWhatsAppDigestAt/)
})

test("gateway requires seller-specific recipient and approved Meta templates", async () => {
  const gateway = await source("lib/ebay/ebay-seller-whatsapp-gateway.ts")
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_ENABLED/)
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_RECIPIENT/)
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_TEMPLATE_NAME/)
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME/)
  assert.match(gateway, /status: !ready \? "NOT_READY" : !enabled \? "DISABLED" : "READY"/)
  assert.match(gateway, /type: "template"/)
  assert.match(gateway, /WHATSAPP_ACCESS_TOKEN/)
  assert.match(gateway, /WHATSAPP_PHONE_NUMBER_ID/)
  assert.doesNotMatch(gateway, /fallbackRecipientPhones/)
  assert.doesNotMatch(gateway, /50558199840/)
  assert.doesNotMatch(gateway, /console\.(log|error)/)
})

test("outbox delivery is idempotent, leased, cooled down, and audited", async () => {
  const migration = await source(
    "supabase/migrations/20260713051000_add_ebay_seller_whatsapp_alert_delivery.sql",
  )
  assert.match(migration, /create table if not exists public\.ebay_seller_whatsapp_alert_state/)
  assert.match(migration, /create or replace function public\.enqueue_ebay_seller_whatsapp_alert/)
  assert.match(migration, /for update;/i)
  assert.match(migration, /suppressed_count = state\.suppressed_count \+ 1/)
  assert.match(migration, /create or replace function public\.resolve_ebay_seller_whatsapp_alert/)
  assert.match(migration, /alert\.status in \('pending', 'failed'\)/)
  assert.match(migration, /last_error_code = 'CONDITION_RESOLVED'/)
  assert.match(migration, /next_allowed_at = v_now/)
  assert.match(migration, /active = true/)
  assert.match(migration, /create or replace function public\.claim_ebay_seller_whatsapp_alerts/)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /ebay_seller_alert_delivery_attempts/)
  assert.match(migration, /'dead_letter'/)
  assert.match(migration, /revoke all on function public\.enqueue_ebay_seller_whatsapp_alert/)
  assert.doesNotMatch(migration, /WHATSAPP_ACCESS_TOKEN|EBAY_SELLER_WHATSAPP_RECIPIENT/)
})

test("delivery defaults to preview and never exposes recipient or secrets", async () => {
  const alerts = await source("lib/ebay/ebay-seller-whatsapp-alerts.ts")
  const route = await source("app/api/admin/ebay/seller-whatsapp-alerts/route.ts")
  assert.match(alerts, /options\.dryRun !== false \|\| !configuration\.realDeliveryPermitted/)
  assert.match(alerts, /channel", "whatsapp"/)
  assert.match(alerts, /renderDigest/)
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /SELLER_WHATSAPP_INVALID_JSON/)
  assert.match(route, /body\.dryRun !== false/)
  assert.match(route, /approvedTemplatesOnly: true/)
  assert.match(route, /secretsReturned: false/)
  assert.doesNotMatch(route, /WHATSAPP_ACCESS_TOKEN|EBAY_SELLER_WHATSAPP_RECIPIENT/)
})

test("scan, protection and cron wire producers and delivery behind the feature flag", async () => {
  const scan = await source("lib/ebay/ebay-first-luna-scan-service.ts")
  const automation = await source("lib/ebay/ebay-seller-command-center-automation.ts")
  const cron = await source("app/api/cron/market-radar-luna-sync/route.ts")
  assert.match(scan, /alertType: "winner_ready"/)
  assert.match(scan, /alertType: "luna_restock"/)
  assert.match(scan, /alertType: "luna_cost_drop"/)
  assert.match(scan, /realDeliveryPermitted/)
  assert.match(automation, /entityType: "ebay_active_listing"/)
  assert.match(automation, /resolveProtectionWhatsAppAlert/)
  assert.match(cron, /realDeliveryPermitted/)
  assert.match(cron, /dryRun: false/)
})
