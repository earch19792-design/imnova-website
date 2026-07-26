import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("Product Research preserves seller identity only as a non-reversible fingerprint", () => {
  const capture = readRepositoryFile("lib/ebay/ebay-product-research-browser-capture.ts");

  assert.match(capture, /sellerReferenceFingerprint/);
  assert.match(capture, /createHash\("sha256"\)/);
  assert.match(capture, /seller_reference_fingerprint/);
  assert.doesNotMatch(capture, /seller_reference:\s*normalizedSellerReference/);
});

test("query planning retains overflow groups in a durable deferred queue", () => {
  const queryPlan = readRepositoryFile("lib/ebay/ebay-product-research-query-plan.ts");

  assert.match(queryPlan, /queries:\s*planned\.slice\(0,\s*15\)/);
  assert.match(queryPlan, /deferredQueries:\s*planned\.slice\(15\)/);
  assert.match(queryPlan, /create_product_research_query_plan_v3/);
  assert.match(queryPlan, /marketplace_product_research_deferred_query_groups_v2/);
});

test("canonical recomputation keeps units, sellers, and comparables independent", () => {
  const migration = readRepositoryFile(
    "supabase/migrations/20260726134000_recompute_product_research_selector_v2.sql",
  );

  assert.match(
    migration,
    /row\.source_listing_reference_hash,\s*case[\s\S]*row\.seller_reference_fingerprint/,
  );
  assert.match(
    migration,
    /coalesce\s*\(\s*sum\(\s*confirmed_sold_quantity\s*\),\s*0\s*\)::integer\s+as\s+sold_exact_units/is,
  );
  assert.match(
    migration,
    /count\s*\(\s*distinct\s+seller_reference_fingerprint\s*\)\s*filter\s*\([^)]*seller_reference_fingerprint\s+is\s+not\s+null[^)]*\)::integer\s+as\s+sold_exact_seller_count/is,
  );
  assert.match(
    migration,
    /count\s*\(\s*distinct\s+source_listing_reference_hash\s*\)::integer\s+as\s+sold_exact_comparable_count/is,
  );
  assert.match(migration, /on conflict\s*\(\s*evaluation_key\s*\)\s*do nothing/i);
  assert.match(migration, /DEFERRED/);
  assert.match(migration, /next_eligible_at/);
  assert.match(
    migration,
    /selected\.value\s*->>\s*'query_hash'\s*=\s*backlog\.query_hash/,
  );
  assert.match(
    migration,
    /selected\.value\s*->\s*'candidate_variant_hashes'\s*=\s*to_jsonb\(backlog\.candidate_variant_hashes\)/,
  );
});

test("selector V2 shadow is isolated from the existing opportunity scan", () => {
  const cron = readRepositoryFile("app/api/cron/ebay-luna-opportunity-scan/route.ts");

  assert.match(cron, /runEbayLunaSelectorV2Shadow/);
  assert.match(cron, /\.catch\(\(\)\s*=>/);
  assert.match(cron, /SELECTOR_V2_SHADOW_FAILED_SCAN_CONTINUES/);
});

test("rollback preserves audit history and no Product Research path writes to eBay", () => {
  const rollback = readRepositoryFile(
    "supabase/rollback/20260726134000_recompute_product_research_selector_v2.down.sql",
  );
  const capture = readRepositoryFile("lib/ebay/ebay-product-research-browser-capture.ts");
  const reconciliation = readRepositoryFile(
    "lib/ebay/ebay-product-research-identity-reconciliation.ts",
  );

  assert.doesNotMatch(rollback, /\b(?:delete|truncate|drop\s+table)\b/i);
  assert.doesNotMatch(`${capture}\n${reconciliation}`, /\b(?:publishOffer|updateOffer|withdrawOffer)\s*\(/);
});
