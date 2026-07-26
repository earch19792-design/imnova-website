import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function source(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function executableSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");
}

function moduleUrl(sourceText) {
  const javascript = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}

let acquisitionFilterModulePromise;

async function loadAcquisitionFilterModule() {
  if (!acquisitionFilterModulePromise) {
    const approvalService = source(
      "lib/ebay/ebay-listing-ai-approval-queue-service.ts",
    );
    const start = approvalService.indexOf("function acquisitionIdentityKeys");
    const end = approvalService.indexOf(
      "async function loadPriorIntelligenceScope",
      start,
    );
    assert.ok(start >= 0, "acquisitionIdentityKeys must remain available");
    assert.ok(end > start, "acquisition filter boundary must remain available");
    const isolatedModule = `
      type JsonRecord = Record<string, unknown>
      type Top20TargetCandidate = {
        productId: string
        supplierProductId: string
        supplierVariantId: string
        supplierSku: string
        priorityScore: number
      }
      function record(value: unknown): JsonRecord {
        return value && typeof value === "object" && !Array.isArray(value)
          ? value as JsonRecord
          : {}
      }
      function text(value: unknown): string {
        return typeof value === "string" ? value.trim() : ""
      }
      ${approvalService.slice(start, end)}
    `;
    acquisitionFilterModulePromise = import(moduleUrl(isolatedModule));
  }
  return acquisitionFilterModulePromise;
}

function catalogCandidate(index) {
  return {
    productId: `product-${index}`,
    supplierProductId: `supplier-product-${index}`,
    supplierVariantId: `variant-${index}`,
    supplierSku: `SKU-${index}`,
    priorityScore: 1000 - index,
  };
}

function queueRow(index) {
  return {
    id: `opportunity-${index}`,
    candidate_key: `candidate-${String(index).padStart(3, "0")}`,
    market_radar_product_id: `product-${index}`,
    supplier_variant_id: `variant-${index}`,
    supplier_sku: `SKU-${index}`,
    queue_status: "ready",
  };
}

test("a valid candidate behind seventy published opportunities remains selectable", async () => {
  const { filterApprovalQueueCatalogByAcquisitionEligibility } =
    await loadAcquisitionFilterModule();
  const catalog = Array.from({ length: 71 }, (_, index) =>
    catalogCandidate(index + 1));
  const queuedRows = Array.from({ length: 71 }, (_, index) =>
    queueRow(index + 1));
  const eligibleRows = [queueRow(71)];

  const filtered = filterApprovalQueueCatalogByAcquisitionEligibility({
    catalog,
    queuedRows,
    eligibleRows,
  });

  assert.deepEqual(filtered.map((candidate) => candidate.productId), [
    "product-71",
  ]);
  assert.equal(filtered.slice(0, 5)[0]?.supplierSku, "SKU-71");
});

test("the same opportunity remains eligible for a different account scope", async () => {
  const { filterApprovalQueueCatalogByAcquisitionEligibility } =
    await loadAcquisitionFilterModule();
  const catalog = [catalogCandidate(1)];
  const queuedRows = [queueRow(1)];

  const accountA = filterApprovalQueueCatalogByAcquisitionEligibility({
    catalog,
    queuedRows,
    eligibleRows: [],
  });
  const accountB = filterApprovalQueueCatalogByAcquisitionEligibility({
    catalog,
    queuedRows,
    eligibleRows: [queueRow(1)],
  });

  assert.equal(accountA.length, 0);
  assert.equal(accountB.length, 1);
});

test("Same-Day, Selector V2 and Approval Queue use the scoped RPC", () => {
  const sameDay = source("lib/ebay/ebay-same-day-pilot-service.ts");
  const selector = source(
    "lib/ebay/ebay-luna-selector-v2-shadow-service.ts",
  );
  const approval = source(
    "lib/ebay/ebay-listing-ai-approval-queue-service.ts",
  );

  for (const implementation of [sameDay, selector, approval]) {
    assert.match(
      implementation,
      /rpc\(\s*"read_eligible_ebay_luna_opportunities_v2"/,
    );
    assert.match(implementation, /p_account_key:/);
    assert.match(implementation, /p_marketplace:/);
  }
  assert.match(sameDay, /p_limit:\s*70/);
  assert.match(sameDay, /p_offset:\s*0/);
  assert.match(selector, /p_offset:\s*offset/);
  assert.match(approval, /p_offset:\s*offset/);

  const filterAt = approval.indexOf(
    "filterApprovalQueueCatalogByAcquisitionEligibility({",
  );
  const topFiveAt = approval.indexOf(".slice(0, 5)", filterAt);
  assert.ok(filterAt >= 0);
  assert.ok(topFiveAt > filterAt);
});

test("the persisted contract never matches published products by title or fuzzy text", () => {
  const migration = source(
    "supabase/migrations/20260726135000_create_ebay_luna_opportunity_acquisition_dispositions.sql",
  );
  const executableMigration = executableSql(migration);

  assert.match(migration, /match_method in \('PRODUCT_VARIANT', 'SUPPLIER_SKU'\)/);
  assert.match(migration, /identity\.identity_status <> 'ENDED'/);
  assert.doesNotMatch(
    executableMigration,
    /\b(?:ilike|similarity|levenshtein)\b/i,
  );
  assert.doesNotMatch(migration, /opportunity\.(?:product_)?title\s*=/i);
});
