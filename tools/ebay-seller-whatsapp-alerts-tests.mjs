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
  const withEmbeddedDependencies = path === "lib/ebay/ebay-seller-whatsapp-gateway.ts"
    ? `${await source("lib/ebay/environment-boundaries.ts")}\n${typescript.replace(
      'import { getEbayProRuntimeBoundary } from "./environment-boundaries"\n',
      "",
    )}`
    : typescript
  const javascript = ts.transpileModule(withEmbeddedDependencies, {
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

test("controlled WhatsApp test uses the real audited pipeline and fails closed", async () => {
  const policy = await importTypeScript("lib/ebay/ebay-seller-whatsapp-alert-policy.ts")
  const route = await source("app/api/admin/ebay/seller-whatsapp-alerts/route.ts")
  const decision = policy.classifySellerWhatsAppAlert("system_test")
  assert.equal(decision.eligible, true)
  assert.equal(decision.deliveryClass, "immediate")
  assert.equal(decision.priority, "low")
  assert.match(route, /SELLER_WHATSAPP_TEST_PREVIEW_ONLY/)
  assert.match(route, /SEND_ONE_SELLER_WHATSAPP_TEST_TO_CONFIGURED_RECIPIENT/)
  assert.match(route, /SELLER_WHATSAPP_TEST_CONFIRMATION_REQUIRED/)
  assert.match(route, /SELLER_WHATSAPP_TEST_QUEUE_NOT_EMPTY/)
  assert.match(route, /SELLER_WHATSAPP_TEST_RATE_LIMITED/)
  assert.match(route, /alertType: "system_test"/)
  assert.match(route, /enqueueSellerWhatsAppAlert/)
  assert.match(route, /deliverSellerWhatsAppAlerts/)
  assert.match(route, /dryRun: false/)
  assert.match(route, /configuredRecipientOnly: true/)
  assert.match(route, /approvedTemplateOnly: true/)
  assert.match(route, /outboxAuditUsed: true/)
  assert.match(route, /ebayWriteUsed: false/)
  assert.doesNotMatch(route, /WHATSAPP_ACCESS_TOKEN|EBAY_SELLER_WHATSAPP_RECIPIENT/)
})

test("gateway requires seller-specific recipient and approved Meta templates", async () => {
  const gateway = await source("lib/ebay/ebay-seller-whatsapp-gateway.ts")
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_ENABLED/)
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_RECIPIENT/)
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_TEMPLATE_NAME/)
  assert.match(gateway, /EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME/)
  assert.match(gateway, /businessAccountIdConfigured/)
  assert.match(gateway, /preflightSellerWhatsAppGateway/)
  assert.match(gateway, /template\.status === "APPROVED"/)
  assert.match(gateway, /bodyParametersValid/)
  assert.match(gateway, /META_GRAPH_VERSION/)
  assert.match(gateway, /type: "template"/)
  assert.match(gateway, /WHATSAPP_ACCESS_TOKEN/)
  assert.match(gateway, /WHATSAPP_PHONE_NUMBER_ID/)
  assert.doesNotMatch(gateway, /fallbackRecipientPhones/)
  assert.doesNotMatch(gateway, /50558199840/)
  assert.doesNotMatch(gateway, /console\.(log|error)/)
})

test("Meta preflight validates phone access, exact language and four BODY parameters without leaking configuration", async () => {
  const gateway = await importTypeScript("lib/ebay/ebay-seller-whatsapp-gateway.ts")
  const previous = {}
  const configured = {
    EBAY_SELLER_WHATSAPP_ENABLED: "true",
    EBAY_SELLER_WHATSAPP_RECIPIENT: "+505 8888 9999",
    WHATSAPP_ACCESS_TOKEN: "meta-secret-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-123",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "waba-123",
    EBAY_SELLER_WHATSAPP_TEMPLATE_NAME: "seller_alert_v1",
    EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME: "seller_digest_v1",
    EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE: "es",
  }
  for (const [key, value] of Object.entries(configured)) {
    previous[key] = process.env[key]
    process.env[key] = value
  }
  let calls = 0
  const fetchImpl = async (input) => {
    calls += 1
    const url = new URL(String(input))
    if (url.pathname.endsWith("/phone-123")) {
      return new Response(JSON.stringify({ id: "phone-123" }), { status: 200 })
    }
    const name = url.searchParams.get("name")
    return new Response(JSON.stringify({
      data: [{
        name,
        status: "APPROVED",
        language: "es",
        components: [{
          type: "BODY",
          text: "{{1}} | {{2}} | {{3}} | {{4}}",
        }],
      }],
    }), { status: 200 })
  }
  try {
    const result = await gateway.preflightSellerWhatsAppGateway({
      fetchImpl,
      force: true,
    })
    assert.equal(result.success, true)
    assert.equal(result.phoneNumberAccessible, true)
    assert.equal(result.templates.immediate.compatible, true)
    assert.equal(result.templates.digest.compatible, true)
    assert.equal(calls, 3)
    const serialized = JSON.stringify(result)
    for (const secret of [
      configured.EBAY_SELLER_WHATSAPP_RECIPIENT,
      configured.WHATSAPP_ACCESS_TOKEN,
      configured.WHATSAPP_PHONE_NUMBER_ID,
      configured.WHATSAPP_BUSINESS_ACCOUNT_ID,
      configured.EBAY_SELLER_WHATSAPP_TEMPLATE_NAME,
      configured.EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME,
    ]) {
      assert.equal(serialized.includes(secret), false)
    }
    const cached = await gateway.preflightSellerWhatsAppGateway({
      fetchImpl: async () => { throw new Error("cache was not used") },
    })
    assert.equal(cached.success, true)
    assert.equal(cached.cached, true)
    assert.equal(gateway.getSellerWhatsAppGatewayConfiguration().status, "READY")
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("Meta preflight blocks unapproved or structurally incompatible templates", async () => {
  const gateway = await importTypeScript("lib/ebay/ebay-seller-whatsapp-gateway.ts")
  const previous = {}
  const configured = {
    EBAY_SELLER_WHATSAPP_ENABLED: "true",
    EBAY_SELLER_WHATSAPP_RECIPIENT: "50588889999",
    WHATSAPP_ACCESS_TOKEN: "another-secret-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-456",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "waba-456",
    EBAY_SELLER_WHATSAPP_TEMPLATE_NAME: "seller_alert_invalid_v1",
    EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME: "seller_digest_invalid_v1",
    EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE: "es",
  }
  for (const [key, value] of Object.entries(configured)) {
    previous[key] = process.env[key]
    process.env[key] = value
  }
  const fetchImpl = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/phone-456")) {
      return new Response(JSON.stringify({ id: "phone-456" }), { status: 200 })
    }
    const name = url.searchParams.get("name")
    const digest = name?.includes("digest")
    return new Response(JSON.stringify({
      data: [{
        name,
        status: digest ? "PENDING" : "APPROVED",
        language: "es",
        components: [{ type: "BODY", text: "{{1}} | {{2}}" }],
      }],
    }), { status: 200 })
  }
  try {
    const result = await gateway.preflightSellerWhatsAppGateway({
      fetchImpl,
      force: true,
    })
    assert.equal(result.success, false)
    assert.equal(result.templates.immediate.bodyParametersValid, false)
    assert.equal(result.templates.digest.approved, false)
    assert.ok(result.errorCodes.includes("SELLER_WHATSAPP_TEMPLATE_BODY_PARAMETERS_INVALID"))
    assert.ok(result.errorCodes.includes("SELLER_WHATSAPP_TEMPLATE_NOT_APPROVED"))
    const configuration = gateway.getSellerWhatsAppGatewayConfiguration()
    assert.equal(configuration.preflightStatus, "FAILED")
    assert.equal(configuration.realDeliveryPermitted, false)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("outbox delivery is idempotent, leased, cooled down, and audited", async () => {
  const migration = await source(
    "supabase/migrations/20260713051000_add_ebay_seller_whatsapp_alert_delivery.sql",
  )
  const accountScopeMigration = await source(
    "supabase/migrations/20260713073000_scope_ebay_seller_whatsapp_claims.sql",
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
  assert.match(accountScopeMigration, /alter column account_key drop default/)
  assert.match(accountScopeMigration, /account_key <> 'default'/)
  assert.match(accountScopeMigration, /payload ->> 'accountKey' = p_account_key/)
  assert.match(accountScopeMigration, /drop function if exists public\.claim_ebay_seller_whatsapp_alerts\(text, integer, integer\)/)
  assert.match(accountScopeMigration, /for update skip locked/i)
  assert.match(accountScopeMigration, /LEGACY_ACCOUNT_SCOPE_QUARANTINED/)
  assert.match(accountScopeMigration, /alert\.status in \('pending', 'failed', 'leased'\)/)
  assert.match(accountScopeMigration, /from quarantined_legacy_alerts[\s\S]*attempt\.status = 'started'/)
  assert.match(accountScopeMigration, /DELIVERY_LEASE_EXPIRED_MAX_ATTEMPTS/)
  assert.match(accountScopeMigration, /attempt\.status = 'started'/)
  assert.match(accountScopeMigration, /limit greatest\(1, least\(coalesce\(p_limit, 1\), 1\)\)/)
  assert.match(accountScopeMigration, /META_DELIVERY_OUTCOME_UNKNOWN_MANUAL_REVIEW/)
  assert.match(accountScopeMigration, /when v_indeterminate[\s\S]*then 'dead_letter'/)
})

test("delivery defaults to preview and never exposes recipient or secrets", async () => {
  const alerts = await source("lib/ebay/ebay-seller-whatsapp-alerts.ts")
  const route = await source("app/api/admin/ebay/seller-whatsapp-alerts/route.ts")
  const commandCenter = await source("app/api/admin/ebay/command-center/route.ts")
  assert.match(alerts, /options\.dryRun !== false \|\| !configuration\.deliveryAttemptAllowed/)
  assert.match(alerts, /preflightSellerWhatsAppGateway/)
  assert.match(alerts, /getEbaySellerAccountScopeConfiguration/)
  assert.match(alerts, /seller-whatsapp-v2/)
  assert.match(alerts, /"alertType" \| "entityType" \| "entityId"/)
  assert.match(alerts, /supplierAvailable: facts\.supplierAvailable === true/)
  assert.doesNotMatch(alerts, /text\(input\.candidateKey, 300\) \|\| "none"/)
  assert.match(alerts, /p_account_key: accountScope\.accountKey/)
  assert.match(alerts, /SELLER_WHATSAPP_ENQUEUE_\$\{safeCode\}/)
  assert.doesNotMatch(alerts, /error\.message/)
  assert.match(alerts, /\.eq\("payload->>accountKey", accountKey\)/)
  assert.match(alerts, /SELLER_WHATSAPP_MAX_CLAIM_PER_INVOCATION = 1/)
  assert.match(alerts, /channel", "whatsapp"/)
  assert.match(alerts, /renderDigest/)
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /SELLER_WHATSAPP_INVALID_JSON/)
  assert.match(route, /body\.dryRun !== false/)
  assert.match(route, /body\.action === "preflight"/)
  assert.match(route, /providerWriteUsed: false/)
  assert.match(route, /templateContentReturned: false/)
  assert.match(route, /approvedTemplatesOnly: true/)
  assert.match(route, /secretsReturned: false/)
  assert.match(
    commandCenter,
    /from\("ebay_seller_alert_outbox"\)[\s\S]*\.eq\("payload->>accountKey", accountKey \?\? "__unconfigured__"\)[\s\S]*\.limit\(50\)/,
  )
  assert.doesNotMatch(route, /WHATSAPP_ACCESS_TOKEN|EBAY_SELLER_WHATSAPP_RECIPIENT/)
})

test("scan, protection and cron wire producers and delivery behind the feature flag", async () => {
  const scan = await source("lib/ebay/ebay-first-luna-scan-service.ts")
  const automation = await source("lib/ebay/ebay-seller-command-center-automation.ts")
  const cron = await source("app/api/cron/market-radar-luna-sync/route.ts")
  assert.match(scan, /alertType: "winner_ready"/)
  assert.match(scan, /alertType: "luna_restock"/)
  assert.match(scan, /alertType: "luna_cost_drop"/)
  assert.match(scan, /deliveryAttemptAllowed/)
  assert.match(automation, /entityType: "ebay_active_listing"/)
  assert.match(automation, /resolveProtectionWhatsAppAlert/)
  assert.match(cron, /deliveryAttemptAllowed/)
  assert.match(cron, /dryRun: false/)
})
