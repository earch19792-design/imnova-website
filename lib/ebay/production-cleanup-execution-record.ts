export const PRODUCTION_EBAY_PRO_CLEANUP_EXECUTION_RECORD_VERSION =
  "PRODUCTION_EBAY_PRO_CLEANUP_EXECUTION_RECORD_V1"

const backupRecord = {
  manualBackupCreated:
    true,
  backupFileName:
    "imnova-production-ebay-pro-before-cleanup.dump",
  backupSize:
    "60 MB",
  backupStoredOutsideRepo:
    true,
  backupCommittedToRepo:
    false,
  backupContainsSecretsInRepo:
    false,
  connectionStringCommitted:
    false,
  secretsCommitted:
    false,
} as const

const targetTables = [
  {
    tableName:
      "market_radar_snapshots",
    beforeEstimatedRows:
      139283,
    beforeTotalSize:
      "283 MB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "56 kB",
  },
  {
    tableName:
      "market_radar_products",
    beforeEstimatedRows:
      1409,
    beforeTotalSize:
      "6088 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "48 kB",
  },
  {
    tableName:
      "market_radar_events",
    beforeEstimatedRows:
      1597,
    beforeTotalSize:
      "1656 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "64 kB",
  },
  {
    tableName:
      "market_radar_scores",
    beforeEstimatedRows:
      1409,
    beforeTotalSize:
      "960 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "24 kB",
  },
  {
    tableName:
      "market_radar_sources",
    beforeEstimatedRows:
      1,
    beforeTotalSize:
      "96 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "32 kB",
  },
  {
    tableName:
      "ebay_product_candidates",
    beforeEstimatedRows:
      6,
    beforeTotalSize:
      "200 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "48 kB",
  },
  {
    tableName:
      "ebay_price_intelligence_snapshots",
    beforeEstimatedRows:
      1,
    beforeTotalSize:
      "112 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "56 kB",
  },
  {
    tableName:
      "ebay_pipeline_audit_log",
    beforeEstimatedRows:
      11,
    beforeTotalSize:
      "96 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "32 kB",
  },
  {
    tableName:
      "ebay_profit_scenarios",
    beforeEstimatedRows:
      6,
    beforeTotalSize:
      "80 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "24 kB",
  },
  {
    tableName:
      "ebay_candidate_scores",
    beforeEstimatedRows:
      6,
    beforeTotalSize:
      "64 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "32 kB",
  },
  {
    tableName:
      "ebay_active_listings",
    beforeEstimatedRows:
      0,
    beforeTotalSize:
      "48 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "48 kB",
  },
  {
    tableName:
      "ebay_candidate_decisions",
    beforeEstimatedRows:
      1,
    beforeTotalSize:
      "48 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "24 kB",
  },
  {
    tableName:
      "ebay_candidate_validations",
    beforeEstimatedRows:
      6,
    beforeTotalSize:
      "48 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "24 kB",
  },
  {
    tableName:
      "ebay_compliance_checks",
    beforeEstimatedRows:
      6,
    beforeTotalSize:
      "48 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "24 kB",
  },
  {
    tableName:
      "ebay_listing_drafts",
    beforeEstimatedRows:
      1,
    beforeTotalSize:
      "48 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "24 kB",
  },
  {
    tableName:
      "ebay_active_listing_risk_events",
    beforeEstimatedRows:
      0,
    beforeTotalSize:
      "24 kB",
    afterEstimatedRows:
      0,
    afterTotalSize:
      "24 kB",
  },
] as const

export function getProductionCleanupBeforeAfterSummary() {
  return {
    verificationType:
      "metadata_inventory_estimated_rows",
    exactCountVerificationDocumented:
      false,
    before:
      {
        mainHeavyTable:
          {
            tableName:
              "market_radar_snapshots",
            estimatedRows:
              139283,
            totalSize:
              "283 MB",
          },
      },
    after:
      {
        allTargetTablesEstimatedRowsZero:
          true,
        mainHeavyTableAfter:
          {
            tableName:
              "market_radar_snapshots",
            estimatedRows:
              0,
            totalSize:
              "56 kB",
          },
      },
  }
}

export function getCleanedProductionTargetTables() {
  return targetTables.map((table) => ({ ...table }))
}

export function getCleanupBackupRecord() {
  return { ...backupRecord }
}

export function getPostCleanupSafetyStatus() {
  return {
    postExecutionRecordOnly:
      true,
    liveDbQueriedInThisLoop:
      false,
    supabaseWriteUsedInThisLoop:
      false,
    sqlExecutedInThisLoop:
      false,
    cleanupExecutedBeforeThisLoopManually:
      true,
    physicalDbCleanupApplied:
      true,
    backupConfirmed:
      true,
    backupCommittedToRepo:
      false,
    dumpFileCommitted:
      false,
    connectionStringCommitted:
      false,
    secretsCommitted:
      false,
    stagingTouched:
      false,
    schemaDropped:
      false,
    viewsDropped:
      false,
    dropTableUsed:
      false,
    dropViewUsed:
      false,
    cascadeUsed:
      false,
    vmConnected:
      false,
    ebayApiUsed:
      false,
    oauthUsed:
      false,
    openAiUsed:
      false,
    imageGenerationUsed:
      false,
    whatsappRealSendUsed:
      false,
  }
}

export function getProductionEbayProCleanupExecutionRecord() {
  const beforeAfter =
    getProductionCleanupBeforeAfterSummary()

  return {
    executionRecordVersion:
      PRODUCTION_EBAY_PRO_CLEANUP_EXECUTION_RECORD_VERSION,
    caseId:
      "PRODUCTION-EBAY-PRO-CLEANUP-EXECUTION-001",
    status:
      "PRODUCTION_EBAY_PRO_DATA_CLEANUP_EXECUTED_AND_RECORDED",
    mode:
      "POST_EXECUTION_RECORD_STATIC_ONLY",
    backup:
      getCleanupBackupRecord(),
    cleanup:
      {
        productionCleanupExecutedManually:
          true,
        cleanupExecutionApplied:
          true,
        physicalDbCleanupApplied:
          true,
        stagingMustNotBeCleaned:
          true,
        stagingTouched:
          false,
        schemaDropped:
          false,
        viewsDropped:
          false,
        tablesTruncatedNotDropped:
          true,
        executionRecordCreatedAfterCleanup:
          true,
      },
    beforeCleanup:
      beforeAfter.before,
    afterCleanup:
      beforeAfter.after,
    targetTables:
      getCleanedProductionTargetTables(),
    notTouched:
      {
        imnovaCoreTables:
          true,
        products:
          true,
        subscribers:
          true,
        communityTables:
          true,
        notificationLogs:
          true,
        whatsappCore:
          true,
        staging:
          true,
        vm:
          true,
      },
    safetyFlags:
      getPostCleanupSafetyStatus(),
  }
}
