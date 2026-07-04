export const FIRST_REAL_LUNA_PORTEX_SCAN_PLAN_VERSION =
  "FIRST_REAL_LUNA_PORTEX_SCAN_PLAN_V1"

export const FIRST_REAL_LUNA_PORTEX_SCAN_TYPES = {
  PRE_BASELINE_DEMO:
    "PRE_BASELINE_DEMO",
  FIRST_REAL_LUNA_PORTEX_SCAN:
    "FIRST_REAL_LUNA_PORTEX_SCAN",
} as const

type FirstScanPlanRecord = {
  scanType?: string | null
  baselineStatus?: string | null
  source?: string | null
  mode?: string | null
  isDemo?: boolean | null
  demo?: boolean | null
  testData?: boolean | null
  lunaPortexCatalog?: boolean | null
  approvedForFirstScan?: boolean | null
}

const approvalChecklist = [
  "confirm Production remains Core-only and off-limits",
  "confirm Production eBay Pro target tables remain exactRows zero",
  "confirm Staging is the eBay Pro controlled environment",
  "confirm staging dry-run gate passes before any write path",
  "confirm demo and pre-baseline records are excluded",
  "confirm scan mode is FIRST_REAL_LUNA_PORTEX_SCAN",
  "confirm WhatsApp seller alerts remain dry-run",
  "confirm VM/Lab remains not connected in this loop",
  "require operator approval before the first real scan",
] as const

const scanLimits = [
  "no Production writes",
  "no Staging writes in this loop",
  "no marketplace API calls",
  "no authorization flows",
  "no real listing drafts",
  "no publication actions",
  "no scraper execution",
  "no image generation or uploads",
  "no VM/Lab connection",
] as const

export function shouldTreatAsPreBaselineDemo(
  record: FirstScanPlanRecord = {},
) {
  return (
    record.scanType === FIRST_REAL_LUNA_PORTEX_SCAN_TYPES.PRE_BASELINE_DEMO ||
    record.baselineStatus === FIRST_REAL_LUNA_PORTEX_SCAN_TYPES.PRE_BASELINE_DEMO ||
    record.isDemo === true ||
    record.demo === true ||
    record.testData === true ||
    record.mode === "demo" ||
    record.source === "demo"
  )
}

export function shouldTreatAsFirstRealScan(
  record: FirstScanPlanRecord = {},
) {
  return (
    record.scanType === FIRST_REAL_LUNA_PORTEX_SCAN_TYPES.FIRST_REAL_LUNA_PORTEX_SCAN &&
    record.lunaPortexCatalog === true &&
    record.approvedForFirstScan === true &&
    shouldTreatAsPreBaselineDemo(record) === false
  )
}

export function getFirstScanStagingDryRunGate() {
  return {
    gateName:
      "STAGING_DRY_RUN_GATE",
    required:
      true,
    passedInThisLoop:
      false,
    productionOffLimits:
      true,
    stagingWritesAllowedInThisLoop:
      false,
    externalCallsAllowed:
      false,
    approvalRequiredBeforeScan:
      true,
    checks:
      [
        "scan plan reviewed",
        "demo data excluded",
        "dry-run mode confirmed",
        "write paths disabled",
        "external calls disabled",
        "operator approval pending",
      ],
  }
}

export function getFirstScanApprovalChecklist() {
  return [...approvalChecklist]
}

export function getFirstRealLunaPortexScanPlan() {
  return {
    planVersion:
      FIRST_REAL_LUNA_PORTEX_SCAN_PLAN_VERSION,
    status:
      "FIRST_REAL_SCAN_PLAN_READY_NOT_EXECUTED",
    mode:
      "STAGING_DRY_RUN_GATE_NO_SCAN_EXECUTION",
    production:
      {
        productionCoreOnly:
          true,
        productionEbayProDataCleaned:
          true,
        productionOffLimits:
          true,
      },
    staging:
      {
        stagingReservedForEbayPro:
          true,
        controlledFirstScanEnvironment:
          true,
        dryRunGateRequired:
          true,
      },
    localVmLab:
      {
        localVmConnectedInThisLoop:
          false,
        futureHeavyProcessing:
          true,
      },
    scan:
      {
        firstRealLunaPortexScanPlanned:
          true,
        firstRealLunaPortexScanExecuted:
          false,
        scanType:
          FIRST_REAL_LUNA_PORTEX_SCAN_TYPES.FIRST_REAL_LUNA_PORTEX_SCAN,
        preBaselineDemoDataExcluded:
          true,
        approvalRequiredBeforeScan:
          true,
      },
    whatsapp:
      {
        whatsappDryRunDefault:
          true,
        realSendAllowedInThisLoop:
          false,
      },
    gate:
      getFirstScanStagingDryRunGate(),
    scanLimits:
      [...scanLimits],
    approvalChecklist:
      getFirstScanApprovalChecklist(),
    safetyFlags:
      {
        noProductionWrites:
          true,
        noStagingWritesInThisLoop:
          true,
        noExternalCalls:
          true,
        noSecretsCommitted:
          true,
        noDbConnections:
          true,
        noSqlMigration:
          true,
        noVmConnection:
          true,
        noMarketplaceApi:
          true,
        noMarketplaceAuth:
          true,
        noOpenAi:
          true,
        noMessagingDelivery:
          true,
      },
  }
}
