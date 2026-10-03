import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../../", import.meta.url)
const [ui, route, migration, guardFix, traceFix] = await Promise.all([
  readFile(new URL("app/admin/ebay/listings/page.tsx", root), "utf8"),
  readFile(new URL("app/api/admin/ebay/listings/identity-resolution/route.ts", root), "utf8"),
  readFile(new URL("supabase/migrations/20260924182036_manual_listing_identity_resolution_v1.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260924215530_manual_identity_current_official_guard_v1.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260924221400_manual_identity_receipt_shape_trace_v1.sql", root), "utf8"),
])

test("manual listing identity resolution is bounded, explicit, durable, and stockguard-linked", () => {
  assert.match(ui, /RESOLVE IDENTITY/)
  assert.match(ui, /CONFIRM EXACT LUNA LINK/)
  assert.match(ui, /KEEP UNLINKED \/ NO SOURCE YET/)
  assert.match(ui, /REJECT CANDIDATE/)
  assert.match(ui, /REVIEW CONFLICT/)
  assert.match(ui, /alt=\{`eBay listing \$\{itemId\}`\}/)
  assert.match(ui, /officialEbayImage\(manualResults\.item\.imageUrl\) && <img/)
  assert.match(ui, /provenLunaImage\(candidate\.imageUrl\) && <img/)
  assert.match(route, /officialThumbnail\(target\.data\.ebay_image_url\)/)
  assert.match(route, /featured_image_url/)
  assert.match(ui, /productId: manualCandidate\.productId[\s\S]*variantId: manualCandidate\.variantId[\s\S]*sku: manualCandidate\.sku/)
  assert.match(route, /\.limit\(20\)/)
  assert.match(route, /confirmation !== "CONFIRM EXACT LUNA LINK"/)
  assert.match(route, /ensureStockguardAuthorityFromDecisionP0/)
  assert.match(route, /readProductionStockGuardV1/)
  assert.match(migration, /customLabelUsedAsIdentity',false/)
  assert.match(migration, /CURRENT_LUNA_IDENTITY_NOT_UNIQUE/)
  assert.match(migration, /CURRENT_LUNA_PREFLIGHT_REQUIRED/)
  assert.match(migration, /durableReadbackMatch',true/)
  assert.doesNotMatch(route, /ebayQuantityWrites\s*:\s*[1-9]|publication\s*:\s*[1-9]/)
})

test("manual confirmation reports exact durable outcome and accepts only OWNER-selected semantic gaps", () => {
  assert.match(route, /receiptId: receipt\.decisionId/)
  assert.match(route, /throw new Error\(rpcBlocker\(receiptCall\.error\)\)/)
  assert.match(ui, /manualDecisionFeedback && <div role=/)
  assert.match(ui, /sweepAge > 10 \* 60_000/)
  assert.match(ui, /action: "reconcile_current_live"/)
  assert.match(ui, /MANUAL_IDENTITY_OFFICIAL_SWEEP_REQUIRED/)
  assert.match(ui, /Link receipt ID: \{manualDecisionFeedback\.receiptId/)
  assert.match(ui, /StockGuard: \{manualDecisionFeedback\.stockguardStatus\}/)
  assert.match(ui, /status: "ERROR", message/)
  assert.match(ui, /Request trace ID: \{manualDecisionFeedback\.requestTraceId/)
  assert.match(ui, /HTTP status: \{manualDecisionFeedback\.httpStatus/)
  assert.match(ui, /Failed stage: \{manualDecisionFeedback\.failedStage/)
  assert.match(ui, /crypto\.randomUUID\(\)/)
  assert.match(ui, /"X-Request-Trace-Id": requestTraceId/)
  assert.match(route, /confirm_seller_os_listing_manual_identity_traced_v1/)
  assert.match(route, /requestTraceId, linkReceiptId/)
  assert.match(route, /CANONICAL_READBACK_FAILED/)
  assert.match(traceFix, /'quantityBasis','STRUCTURED_EVIDENCE'/)
  assert.match(traceFix, /'CANONICAL_SERVER_READ_IDENTITY_ONLY'/)
  assert.match(traceFix, /seller_os_listing_manual_identity_request_traces_v1/)
  assert.match(traceFix, /link_receipt_id text not null unique/)
  assert.match(guardFix, /OWNER_CONFIRMED_EXACT/)
  assert.match(guardFix, /p_actor_type = 'OWNER'/)
  assert.match(guardFix, /OWNER_SELECTED_CURRENT_LUNA_IDENTITY/)
  assert.match(guardFix, /SEMANTIC_IDENTITY_INCOMPLETE/)
  assert.match(guardFix, /v_active\.last_ebay_sync_at < v_now - interval '36 hours'/)
  assert.doesNotMatch(guardFix, /update public\.ebay_active_listings/)
})
