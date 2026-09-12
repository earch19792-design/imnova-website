import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const {
  CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1,
  continueCurrentFactoryKeywordV2_1,
  projectCurrentFactoryKeywordIdentityV2_1,
} = await import("./current-keyword-continuation-v2-1.ts")

const packageId = "695a862f-2385-4b6c-b996-5e4aac2ca36c"
const opportunityId = "5acad932-7595-4659-9822-b8084ff5a107"
const planId = "a810aada-37ad-4931-aef9-d6c80566e8f9"
const candidateKey = `sha256:${"a".repeat(64)}`
const accountKey = "EBAY_US_ACCOUNT"
const version = "PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1"
const migration = readFileSync(
  "supabase/migrations/20260912113852_current_factory_keyword_v2_1_continuation.sql",
  "utf8",
)
const closeoutMigration = readFileSync(
  "supabase/migrations/20260912122500_current_keyword_cumulative_completion_v1.sql",
  "utf8",
)
const headRecoveryMigration = readFileSync(
  "supabase/migrations/20260912133500_current_keyword_head_concept_recovery_v1.sql",
  "utf8",
)
const singlePassMigration = readFileSync(
  "supabase/migrations/20260912142500_current_keyword_single_pass_persistence_v1.sql",
  "utf8",
)
const triggerCoalescingMigration = readFileSync(
  "supabase/migrations/20260912145500_current_keyword_closeout_trigger_coalescing_v1.sql",
  "utf8",
)
const decisionCompactionMigration = readFileSync(
  "supabase/migrations/20260912151500_current_keyword_decision_compaction_v1.sql",
  "utf8",
)

const digest = (value) => `sha256:${createHash("sha256")
  .update(value).digest("hex")}`

function fixture(overrides = {}) {
  const opportunity = {
    id: opportunityId,
    candidate_key: candidateKey,
    supplier_product_id: "9220850483424",
    supplier_variant_id: "53002129932512",
    supplier_sku: "FL-NH4784642",
    product_title: "Luxury Heart Shape Alloy Artificial Rhinestones Bracelet",
    opportunity_score: 50,
    assessment: { productTruth: { fieldTruthV1: { fields: [{
      FIELD: "BRAND", VALUE: "Imnova", SEMANTIC_CLASS: "FACT",
      EVIDENCE_STATUS: "PROVEN", CONTRADICTION: false,
    }] } } },
    ...overrides,
  }
  const listingPackage = {
    id: packageId, account_key: accountKey, opportunity_id: opportunity.id,
    candidate_key: opportunity.candidate_key,
    package_data: { currentPublicationFactoryV1: {
      version: "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1",
      packageId, generation: "current-generation", accountKey,
      productId: opportunity.supplier_product_id,
      variantId: opportunity.supplier_variant_id,
      supplierSku: opportunity.supplier_sku,
      authorityPolicy: "CURRENT_ONLY", reuseLegacyPreparation: false,
    } },
  }
  return { listingPackage, opportunity }
}

function readyRead() {
  const authority = `sha256:${"b".repeat(64)}`
  const decision = {
    DECISION_VERSION: version,
    INPUT_AUTHORITY_FINGERPRINT: authority,
    INPUT_FINGERPRINT: digest(`[${JSON.stringify(version)}, ${JSON.stringify(authority)}]`),
    KEYWORD_DECISION_READY: true,
    KEYWORD_INTELLIGENCE: "READY",
    PRIMARY_KEYWORD: "rhinestone bracelet",
    TERMS: [{ TERM: "rhinestone bracelet", CLASSIFICATION: "PRIMARY_KEYWORD" }],
    BLOCKERS: [],
  }
  const serialized = JSON.stringify(decision)
  return {
    READ_CONTRACT_VERSION: "PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1",
    STATUS: "READY", BLOCKERS: [],
    BINDING: { ACCOUNT_KEY: accountKey, PACKAGE_ID: packageId,
      PRODUCT_ID: "9220850483424", VARIANT_ID: "53002129932512",
      CANDIDATE_KEY: candidateKey, OPPORTUNITY_ID: opportunityId,
      PLAN_ID: planId },
    VALIDATION: { CURRENT_INPUTS_MATCH: true,
      DECISION_DIGEST: digest(serialized) },
    DECISION_SERIALIZED: serialized,
  }
}

function mockSupabase({ created = false, revalidated = false,
  handoff = readyRead() } = {}) {
  const calls = []
  return { calls, client: {
    from(name) {
      assert.equal(name, "ebay_luna_opportunity_queue")
      const chain = { select: () => chain, eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: fixture().opportunity, error: null }) }
      return chain
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === "continue_current_factory_keyword_v2_1") return {
        data: { contractVersion: CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1,
          listingPackageId: packageId, planId, planCreated: created,
          researchRevalidated: revalidated, marketplaceWrites: 0,
          publicationWrites: 0, adsWrites: 0 }, error: null,
      }
      if (name === "repair_current_factory_keyword_revalidation_v1" ||
          name === "reconcile_current_factory_keyword_cumulative_completion_v1" ||
          name === "ensure_current_keyword_head_concept_recovery_v1") {
        return { data: { marketplaceWrites: 0, publicationWrites: 0,
          adsWrites: 0 }, error: null }
      }
      assert.equal(name, "read_current_factory_keyword_handoff_v2_1")
      return { data: handoff, error: null }
    },
  } }
}

test("stale same-link automatically enters bounded research revalidation", async () => {
  const { client, calls } = mockSupabase({ revalidated: true,
    handoff: { STATUS: "BLOCKED", BLOCKERS: [
      "KEYWORD_DECISION_STALE_RESEARCH_STATE" ] } })
  const result = await continueCurrentFactoryKeywordV2_1({ supabase: client,
    accountKey, listingPackage: fixture().listingPackage })
  assert.equal(result.researchRevalidated, true)
  assert.equal(result.status, "RESEARCH_PENDING")
  assert.equal(calls[0].name, "continue_current_factory_keyword_v2_1")
  assert.match(migration, /current_keyword_revalidation_key is distinct from/)
  assert.match(migration, /status='PENDING',capture_batch_id=null/)
  assert.match(closeoutMigration, /worker_claim_count=0/)
  assert.match(closeoutMigration,
    /strategy_version is distinct from\s+v_plan\.intelligence_contract_version/)
})

test("greenfield missing plan is created by the normal CURRENT producer", async () => {
  const greenfield = fixture({ id: "6bbc486a-31c4-4f59-86ad-f350215718a4",
    candidate_key: "luna-portex:9220860051680:53002139205856",
    supplier_product_id: "9220860051680",
    supplier_variant_id: "53002139205856", supplier_sku: "FL-NHPF3369737" })
  const projected = projectCurrentFactoryKeywordIdentityV2_1(greenfield)
  assert.equal(projected.exact, true)
  assert.match(migration, /source_candidate_key ~ '\^luna-portex:/)
  assert.match(migration, /insert into public\.marketplace_product_research_query_plans/)
})

test("an existing CURRENT plan and accepted decision are reused", async () => {
  const { client } = mockSupabase()
  const result = await continueCurrentFactoryKeywordV2_1({ supabase: client,
    accountKey, listingPackage: fixture().listingPackage })
  assert.equal(result.planId, planId)
  assert.equal(result.planCreated, false)
  assert.equal(result.keywordCurrentReady, true)
  assert.equal(result.acceptance.STATUS, "ACCEPTED")
})

test("replay stays on one package-bound plan without equivalent work", async () => {
  const { client, calls } = mockSupabase()
  const first = await continueCurrentFactoryKeywordV2_1({ supabase: client,
    accountKey, listingPackage: fixture().listingPackage })
  const second = await continueCurrentFactoryKeywordV2_1({ supabase: client,
    accountKey, listingPackage: fixture().listingPackage })
  assert.equal(first.planId, second.planId)
  assert.equal(calls.filter((call) => call.name ===
    "continue_current_factory_keyword_v2_1").length, 2)
  assert.match(migration, /marketplace_product_research_current_package_uidx/)
})

test("material Product Truth change forces a new semantic generation", () => {
  assert.match(migration,
    /CURRENT_FACTORY_KEYWORD_REVALIDATION_V1:'\|\|p_listing_package_id::text\|\|':'\|\|\s*v_truth_fingerprint/)
  assert.match(migration, /current_keyword_revalidation_history=\s*p\.current_keyword_revalidation_history/)
  assert.match(migration, /priorDecisionFingerprint/)
})

test("non-material Product Truth refresh preserves the semantic generation", () => {
  const semantics = migration.slice(migration.indexOf(
    "current_keyword_product_truth_semantics_v1"), migration.indexOf(
    "current_keyword_product_truth_fingerprint_v1"))
  assert.match(semantics, /'FIELD',f->'FIELD','VALUE',f->'VALUE'/)
  assert.doesNotMatch(semantics, /CAPTURED_AT|OBSERVED_AT|SOURCE_RECEIPT/)
})

test("legacy keyword authority cannot satisfy a CURRENT package", () => {
  assert.match(migration, /join public\.ebay_current_listing_packages_v1 k/)
  assert.match(migration, /p\.current_listing_package_id=p_listing_package_id/)
  assert.match(migration, /CURRENT_KEYWORD_PACKAGE_BINDING_NOT_FOUND/)
  assert.doesNotMatch(readFileSync(
    "lib/seller-os/current-keyword-continuation-v2-1.ts", "utf8"),
  /legacyKeywordAuthorityCount:\s*[1-9]|manualBindingCount:\s*[1-9]/)
})

test("cumulative compatible evidence can close a low-precision final query", () => {
  assert.match(closeoutMigration,
    /derive_current_plan_keyword_candidate_v2_1/)
  assert.match(closeoutMigration,
    /v_cumulative_decision->>'KEYWORD_DECISION_READY'='true'/)
  assert.match(closeoutMigration, /terminal_research_conclusion='EVIDENCE_SUFFICIENT'/)
  assert.match(closeoutMigration, /marketplaceWrites',0,'publicationWrites',0,'adsWrites',0/)
})

test("descriptor-heavy exhaustion queues one Product Truth head query", () => {
  assert.match(headRecoveryMigration,
    /V2_1_PRODUCT_TRUTH_HEAD_CONCEPT_RECOVERY/)
  assert.match(headRecoveryMigration,
    /term->>'CONCEPT_TYPE'='HEAD_CONCEPT'/)
  assert.match(headRecoveryMigration,
    /term#>>'\{PRODUCT_TRUTH_SUPPORT,SUPPORTED\}'='true'/)
  assert.match(headRecoveryMigration, /on function public\.ensure_current_keyword_head_concept_recovery_v1/)
  assert.match(headRecoveryMigration,
    /marketplaceWrites',0,'publicationWrites',0,'adsWrites',0/)
})

test("CURRENT cumulative closeout persists one derived decision without a second derivation", () => {
  const reconcile = singlePassMigration.slice(
    singlePassMigration.indexOf("reconcile_current_factory_keyword_cumulative_completion_v1"),
    singlePassMigration.indexOf("create or replace function public.complete_quick_pick_product_research_claim_v1"),
  )
  assert.equal((reconcile.match(/derive_current_plan_keyword_candidate_v2_1/g) ?? []).length, 1)
  assert.match(reconcile, /keyword_intelligence_decision=case/)
  assert.doesNotMatch(reconcile, /perform public\.refresh_product_research_keyword_intelligence_v1/)
  assert.match(singlePassMigration,
    /when v_cumulative_decision->>'KEYWORD_DECISION_READY'='true'[\s\S]*then v_cumulative_decision/)
})

test("CURRENT closeout coalesces the equivalent plan refresh trigger", () => {
  assert.match(triggerCoalescingMigration,
    /seller_os_product_research_coalesce_v1/)
  assert.match(triggerCoalescingMigration,
    /resolved_plan_id=excluded\.resolved_plan_id/)
  assert.match(triggerCoalescingMigration, /set keyword_dirty=false/)
  assert.doesNotMatch(triggerCoalescingMigration,
    /perform public\.refresh_product_research_keyword_intelligence_v1/)
})

test("durable CURRENT decision compacts only redundant rejected-term evidence", () => {
  assert.match(decisionCompactionMigration,
    /term-'SOURCE_RECEIPTS'-'ITEM_COVERAGE'-'MARKET_SUPPORT'/)
  assert.match(decisionCompactionMigration,
    /when term->'WHY_REJECTED' is null[\s\S]*then term/)
  assert.match(decisionCompactionMigration,
    /compact_current_keyword_decision_v1\([\s\S]*derive_product_research_keyword_intelligence_v2_1/)
  assert.doesNotMatch(decisionCompactionMigration,
    /-'CANONICAL_ITEMS'|-'PRODUCT_TRUTH_SUPPORT'|-'INPUT_FINGERPRINT'/)
})
