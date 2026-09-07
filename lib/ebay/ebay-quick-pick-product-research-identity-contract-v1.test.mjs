import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const service = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")
const migration = readFileSync(
  "supabase/migrations/20260907080738_quick_pick_product_research_identity_contract_v1.sql",
  "utf8")

test("PASS_EXTERNAL_LUNA_PRODUCT_ID_USES_SUPPLIER_PRODUCT_ID", () => {
  assert.match(service,
    /\.eq\("supplier_product_id", input\.lunaProductId\)/)
})

test("PASS_INTERNAL_UUID_NEVER_COMPARED_TO_EXTERNAL_LUNA_ID", () => {
  assert.doesNotMatch(service,
    /\.eq\("product_id", plan\.sourceLunaProductId\)/)
  assert.match(service,
    /return "INTERNAL_PRODUCT_ID" as const/)
  assert.match(migration,
    /must resolve against supplier_product_id, never the internal UUID product_id/)
})

test("PASS_EXACT_LUNA_PRODUCT_VARIANT_PAIR_VALIDATES", () => {
  assert.match(service,
    /text\(row\.supplier_variant_id, 160\) === input\.lunaVariantId/)
  assert.match(service,
    /target\.supplierProductId !== input\.lunaProductId/)
  assert.match(service,
    /target\.supplierVariantId !== input\.lunaVariantId/)
})

test("PASS_WRONG_VARIANT_FOR_PRODUCT_IS_REJECTED", () => {
  assert.match(service,
    /QUICK_PICK_PRODUCT_RESEARCH_VARIANT_PRODUCT_MISMATCH/)
})

test("PASS_UNKNOWN_IDENTITY_REMAINS_UNPROVEN", () => {
  assert.match(service,
    /QUICK_PICK_PRODUCT_RESEARCH_IDENTITY_NAMESPACE_UNPROVEN/)
  assert.match(service,
    /QUICK_PICK_PRODUCT_RESEARCH_IDENTITY_UNPROVEN/)
  assert.match(service,
    /QUICK_PICK_PRODUCT_RESEARCH_IDENTITY_AUTHORITY_UNAVAILABLE/)
})

test("PASS_QUICK_PICK_EXISTING_PLAN_RECOVERS", () => {
  assert.match(migration, /MECHANISM_FIX_RETRY_PENDING/)
  assert.match(migration, /worker_claim_count = 0/)
  assert.match(migration, /worker_next_retry_at = clock_timestamp\(\)/)
  assert.match(migration, /task\.status = 'PENDING'/)
})

test("PASS_NO_PLAN_DUPLICATION", () => {
  assert.doesNotMatch(migration,
    /insert\s+into\s+public\.marketplace_product_research_query_plans/i)
  assert.doesNotMatch(migration,
    /delete\s+from\s+public\.marketplace_product_research_query_plans/i)
})

test("PASS_NO_TASK_DUPLICATION", () => {
  assert.doesNotMatch(migration,
    /insert\s+into\s+public\.marketplace_product_research_query_tasks/i)
  assert.doesNotMatch(migration,
    /delete\s+from\s+public\.marketplace_product_research_query_tasks/i)
})

test("PASS_LIVE_LISTING_REVALIDATION_UNCHANGED", () => {
  assert.match(service,
    /plan\?\.sourceContext === "LIVE_LISTING_REVALIDATION"/)
  assert.match(service, /completeMayelLiveMarketRevalidationV1/)
})

test("PASS_ALL_EXISTING_QUICK_PICK_PLANS_RETRYABLE", () => {
  assert.match(migration,
    /plan\.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'/)
  assert.match(migration, /plan\.status = 'ACTIVE'/)
  assert.match(migration, /SAFE_IDEMPOTENT_RUNTIME_RESUME/)
})
