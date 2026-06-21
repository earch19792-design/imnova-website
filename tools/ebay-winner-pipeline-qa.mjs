import assert from "node:assert/strict"
import {
  processRadarCandidateWithPersistence,
  recordCandidateDecision,
} from "../lib/ebay-winner-pipeline/service.mjs"

function createQuery(tableStore, tableName) {
  const query = {
    payload: null,
    conflictColumn: null,
    filters: [],
    updatePayload: null,
    upsert(payload, options = {}) {
      this.payload = payload
      this.conflictColumn = options.onConflict || "id"
      return this
    },
    update(payload) {
      this.updatePayload = payload
      return this
    },
    eq(column, value) {
      this.filters.push({ column, value })
      return this
    },
    select() {
      return this
    },
    single() {
      const rows = tableStore[tableName]

      if (this.updatePayload) {
        const row = rows.find(candidate =>
          this.filters.every(filter =>
            candidate[filter.column] === filter.value
          )
        )

        if (!row) {
          return Promise.resolve({
            data: null,
            error: {
              message: `${tableName}_row_not_found`,
            },
          })
        }

        Object.assign(row, this.updatePayload)

        return Promise.resolve({
          data: row,
          error: null,
        })
      }

      const conflictColumn =
        this.conflictColumn

      let row = rows.find(existing =>
        existing[conflictColumn] === this.payload[conflictColumn]
      )

      if (row) {
        Object.assign(row, this.payload)
      } else {
        row = {
          id: `${tableName}-${rows.length + 1}`,
          ...this.payload,
        }
        rows.push(row)
      }

      return Promise.resolve({
        data: row,
        error: null,
      })
    },
  }

  return query
}

function createMemorySupabase() {
  const tableStore = {
    ebay_product_candidates: [],
    ebay_candidate_validations: [],
    ebay_profit_scenarios: [],
    ebay_compliance_checks: [],
    ebay_candidate_scores: [],
    ebay_candidate_decisions: [],
    ebay_listing_drafts: [],
    ebay_pipeline_audit_log: [],
  }

  return {
    tableStore,
    from(tableName) {
      if (!tableStore[tableName]) {
        tableStore[tableName] = []
      }

      return createQuery(
        tableStore,
        tableName
      )
    },
  }
}

const radarCandidates = [
  {
    source_key: "lunaportex",
    source_name: "Luna Portex",
    source_id: "00000000-0000-0000-0000-000000000001",
    product_id: "00000000-0000-0000-0000-000000000101",
    snapshot_id: "00000000-0000-0000-0000-000000000201",
    supplier_product_id: "lp-qa-001",
    supplier_variant_id: "lp-qa-001-v1",
    sku: "LP-QA-VALID-001",
    title: "Adjustable Kitchen Organizer",
    product_url: "https://lunaportex.com/products/adjustable-kitchen-organizer",
    vendor: "Generic",
    product_type: "Kitchen Storage",
    price: 10,
    estimated_sale_price: 35,
    inventory_quantity: 18,
    available: true,
    image_urls: ["https://cdn.example.com/kitchen-organizer.jpg"],
    images_authorized: true,
    suggested_category_id: "20625",
    weight: 1.1,
    opportunity_score: 82,
    out_of_stock_count_7d: 0,
  },
  {
    source_key: "lunaportex",
    source_name: "Luna Portex",
    source_id: "00000000-0000-0000-0000-000000000001",
    product_id: "00000000-0000-0000-0000-000000000102",
    snapshot_id: "00000000-0000-0000-0000-000000000202",
    supplier_product_id: "lp-qa-002",
    supplier_variant_id: "lp-qa-002-v1",
    sku: "LP-QA-NOSTOCK-002",
    title: "Desk Cable Tray",
    product_url: "https://lunaportex.com/products/desk-cable-tray",
    vendor: "Generic",
    product_type: "Office Organization",
    price: 8,
    estimated_sale_price: 29,
    inventory_quantity: 0,
    available: false,
    image_urls: ["https://cdn.example.com/cable-tray.jpg"],
    images_authorized: true,
    suggested_category_id: "175672",
    weight: 0.8,
    opportunity_score: 75,
    out_of_stock_count_7d: 2,
  },
  {
    source_key: "lunaportex",
    source_name: "Luna Portex",
    source_id: "00000000-0000-0000-0000-000000000001",
    product_id: "00000000-0000-0000-0000-000000000103",
    snapshot_id: "00000000-0000-0000-0000-000000000203",
    supplier_product_id: "lp-qa-003",
    supplier_variant_id: "lp-qa-003-v1",
    sku: "LP-QA-MISSING-SHIPPING-003",
    title: "Foldable Closet Divider",
    product_url: "https://lunaportex.com/products/foldable-closet-divider",
    vendor: "Generic",
    product_type: "Home Storage",
    price: 9,
    estimated_sale_price: 34,
    inventory_quantity: 15,
    available: true,
    image_urls: ["https://cdn.example.com/closet-divider.jpg"],
    images_authorized: true,
    suggested_category_id: "43502",
    opportunity_score: 68,
    out_of_stock_count_7d: 0,
  },
  {
    source_key: "lunaportex",
    source_name: "Luna Portex",
    source_id: "00000000-0000-0000-0000-000000000001",
    product_id: "00000000-0000-0000-0000-000000000104",
    snapshot_id: "00000000-0000-0000-0000-000000000204",
    supplier_product_id: "lp-qa-004",
    supplier_variant_id: "lp-qa-004-v1",
    sku: "LP-QA-LOW-MARGIN-004",
    title: "Reusable Travel Bottles",
    product_url: "https://lunaportex.com/products/reusable-travel-bottles",
    vendor: "Generic",
    product_type: "Travel Accessories",
    price: 18,
    estimated_sale_price: 24,
    inventory_quantity: 25,
    available: true,
    image_urls: ["https://cdn.example.com/travel-bottles.jpg"],
    images_authorized: true,
    suggested_category_id: "16080",
    weight: 0.5,
    opportunity_score: 70,
    out_of_stock_count_7d: 0,
  },
  {
    source_key: "lunaportex",
    source_name: "Luna Portex",
    source_id: "00000000-0000-0000-0000-000000000001",
    product_id: "00000000-0000-0000-0000-000000000105",
    snapshot_id: "00000000-0000-0000-0000-000000000205",
    supplier_product_id: "lp-qa-005",
    supplier_variant_id: "lp-qa-005-v1",
    sku: "LP-QA-RISKY-BRAND-005",
    title: "Wireless Charging Stand",
    product_url: "https://lunaportex.com/products/wireless-charging-stand",
    vendor: "Apple",
    product_type: "Phone Accessories",
    price: 11,
    estimated_sale_price: 39,
    inventory_quantity: 14,
    available: true,
    image_urls: ["https://cdn.example.com/charging-stand.jpg"],
    images_authorized: true,
    suggested_category_id: "123417",
    weight: 0.7,
    opportunity_score: 86,
    out_of_stock_count_7d: 0,
  },
]

const supabase = createMemorySupabase()
const processed = []

for (const radarProduct of radarCandidates) {
  const result = await processRadarCandidateWithPersistence({
    supabase,
    radarProduct,
  })

  processed.push({
    sku: result.candidate.supplier_sku,
    state: result.candidate.state,
    profit: result.profitScenario.net_profit,
    margin: result.profitScenario.net_margin_percent,
    roi: result.profitScenario.roi_percent,
    score: result.score.winner_score,
    missingFields: result.validation.missingFields,
    risks: result.compliance.findings.map(finding => finding.code),
    whatsappDryRun: result.whatsappDryRunPayload.dryRun,
    enableRealSend: result.whatsappDryRunPayload.enableRealSend,
    candidateId: result.persisted.candidate.id,
    candidateKey: result.candidate.candidate_key,
  })
}

const first = processed[0]

const decisionActions = [
  "create_draft",
  "reject",
  "review_data",
  "postpone",
]

const decisionResults = []

for (const action of decisionActions) {
  const result = await recordCandidateDecision({
    supabase,
    candidateId: first.candidateId,
    candidateKey: first.candidateKey,
    action,
    messageId: `wamid.qa.${action}`,
    decidedBy: "qa-dry-run",
  })

  const duplicate = await recordCandidateDecision({
    supabase,
    candidateId: first.candidateId,
    candidateKey: first.candidateKey,
    action,
    messageId: `wamid.qa.${action}`,
    decidedBy: "qa-dry-run",
  })

  decisionResults.push({
    action,
    state: result.candidate.state,
    decisionId: result.decision.id,
    duplicateDecisionId: duplicate.decision.id,
    idempotent: result.decision.id === duplicate.decision.id,
    localDraftCreated: Boolean(result.listingDraft),
    ebayDraftId: result.listingDraft?.ebay_draft_id || null,
  })
}

assert.equal(processed.length, 5)
assert.equal(supabase.tableStore.ebay_product_candidates.length, 5)
assert.equal(supabase.tableStore.ebay_candidate_validations.length, 5)
assert.equal(supabase.tableStore.ebay_profit_scenarios.length, 5)
assert.equal(supabase.tableStore.ebay_compliance_checks.length, 5)
assert.equal(supabase.tableStore.ebay_candidate_scores.length, 5)
assert.ok(processed.every(candidate => candidate.whatsappDryRun === true))
assert.ok(processed.every(candidate => candidate.enableRealSend === false))
assert.ok(decisionResults.every(decision => decision.idempotent))
assert.equal(
  decisionResults.find(decision => decision.action === "create_draft").ebayDraftId,
  null
)
assert.equal(
  supabase.tableStore.ebay_product_candidates.some(candidate => candidate.state === "PUBLISHED"),
  false
)

console.log(JSON.stringify({
  processed,
  tableCounts: Object.fromEntries(
    Object.entries(supabase.tableStore).map(([table, rows]) => [
      table,
      rows.length,
    ])
  ),
  decisionResults,
  publishedReachable: false,
}, null, 2))
