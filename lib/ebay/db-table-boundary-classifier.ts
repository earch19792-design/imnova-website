export const DB_TABLE_BOUNDARY_CLASSIFIER_VERSION =
  "PRODUCTION_DB_EBAY_TABLE_AUDIT_CLEANUP_PLAN_V1"

export const DB_TABLE_BOUNDARY_CATEGORIES = {
  IMNOVA_CORE_PRODUCTION: "IMNOVA_CORE_PRODUCTION",
  EBAY_PRO_STAGING: "EBAY_PRO_STAGING",
  LOCAL_VM_LAB_HEAVY: "LOCAL_VM_LAB_HEAVY",
  SHARED_MINIMUM: "SHARED_MINIMUM",
  UNKNOWN_MANUAL_REVIEW: "UNKNOWN_MANUAL_REVIEW",
} as const

const productionCoreTables = [
  "products",
  "product_states",
  "public_products",
  "public_distribution_locations",
  "distribution_locations",
  "product_images",
  "strategic_niches",
  "strategic_subniches",
  "product_subniches",
  "subscribers",
  "communication_preferences",
  "community_interest_areas",
  "subscriber_area_interests",
  "subscriber_interests",
  "community_levels",
  "community_referral_codes",
  "community_referrals",
  "community_points_ledger",
  "community_member_status",
  "community_vip_rewards",
  "community_reward_redemptions",
  "community_idea_votes",
  "idea_lab_items",
  "transparency_wall_items",
  "notification_logs",
]

const ebayProStagingTables = [
  "market_radar_sources",
  "market_radar_products",
  "market_radar_snapshots",
  "market_radar_events",
  "market_radar_scores",
  "market_radar_latest_snapshots",
  "market_radar_latest_products",
  "ebay_product_candidates",
  "ebay_candidate_validations",
  "ebay_profit_scenarios",
  "ebay_compliance_checks",
  "ebay_candidate_scores",
  "ebay_candidate_decisions",
  "ebay_listing_drafts",
  "ebay_pipeline_audit_log",
  "ebay_price_intelligence_snapshots",
  "ebay_active_listing_risk_events",
]

const localVmLabHeavyTables = [
  "benchmark_raw_snapshots",
  "benchmark_raw_batches",
  "scanner_raw_outputs",
  "price_intelligence_raw_batches",
  "worker_run_logs",
  "heavy_fixture_imports",
  "image_experiment_outputs",
  "historical_radar_raw_snapshots",
]

const sharedMinimumFields = [
  "product_id",
  "slug",
  "confirmed_product_facts",
  "product_status_summary",
  "stock_summary",
  "safe_cost_summary",
]

const unknownManualReviewTables = [
  "trend_radar_signals",
  "social_signals",
  "community_surveys",
  "survey_responses",
  "notification_logs_when_mixed_with_ebay_alerts",
]

const cleanupSafetyChecklist = [
  "confirm production gate merged",
  "inventory production tables read-only",
  "export backup candidate tables",
  "verify no production runtime depends on candidate tables",
  "classify unknown tables manually",
  "prepare rollback script",
  "require user approval before removal or archival",
  "apply only after production maintenance window if needed",
]

function normalizeTableName(tableName: string) {
  return tableName.trim().replace(/^public\./, "")
}

export function getProductionCoreTables() {
  return [...productionCoreTables]
}

export function getEbayProStagingTables() {
  return [...ebayProStagingTables]
}

export function getLocalVmLabHeavyTables() {
  return [...localVmLabHeavyTables]
}

export function getSharedMinimumFields() {
  return [...sharedMinimumFields]
}

export function getCleanupSafetyChecklist() {
  return [...cleanupSafetyChecklist]
}

export function classifyDbTableName(tableName: string) {
  const normalizedTableName =
    normalizeTableName(tableName)

  if (productionCoreTables.includes(normalizedTableName)) {
    return DB_TABLE_BOUNDARY_CATEGORIES.IMNOVA_CORE_PRODUCTION
  }

  if (ebayProStagingTables.includes(normalizedTableName)) {
    return DB_TABLE_BOUNDARY_CATEGORIES.EBAY_PRO_STAGING
  }

  if (localVmLabHeavyTables.includes(normalizedTableName)) {
    return DB_TABLE_BOUNDARY_CATEGORIES.LOCAL_VM_LAB_HEAVY
  }

  if (sharedMinimumFields.includes(normalizedTableName)) {
    return DB_TABLE_BOUNDARY_CATEGORIES.SHARED_MINIMUM
  }

  return DB_TABLE_BOUNDARY_CATEGORIES.UNKNOWN_MANUAL_REVIEW
}

export function getDbTableBoundaryClassification() {
  return {
    version:
      DB_TABLE_BOUNDARY_CLASSIFIER_VERSION,
    categories:
      DB_TABLE_BOUNDARY_CATEGORIES,
    imnovaCoreProduction:
      getProductionCoreTables(),
    ebayProStaging:
      getEbayProStagingTables(),
    localVmLabHeavy:
      getLocalVmLabHeavyTables(),
    sharedMinimum:
      getSharedMinimumFields(),
    unknownManualReview:
      [...unknownManualReviewTables],
    cleanupSafetyChecklist:
      getCleanupSafetyChecklist(),
    safety:
      {
        staticAuditOnly:
          true,
        physicalDbCleanupApplied:
          false,
        liveDbQueried:
          false,
        sqlExecutionUsed:
          false,
      },
  }
}
