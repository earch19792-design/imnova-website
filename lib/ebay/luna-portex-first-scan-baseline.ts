export const LUNA_PORTEX_FIRST_SCAN_BASELINE_VERSION =
  "EBAY_PRO_LUNA_PORTEX_FIRST_SCAN_BASELINE_V1"

export const LUNA_PORTEX_SCAN_TYPES = {
  PRE_BASELINE_DEMO: "PRE_BASELINE_DEMO",
  FIRST_REAL_LUNA_PORTEX_SCAN: "FIRST_REAL_LUNA_PORTEX_SCAN",
} as const

type FirstScanRecord = {
  scanType?: string | null
  baselineStatus?: string | null
  source?: string | null
  mode?: string | null
  isDemo?: boolean | null
  demo?: boolean | null
  testData?: boolean | null
}

const firstScanSafetyChecklist = [
  "confirm production isolation gate remains merged",
  "confirm eBay Pro remains staging/lab-only",
  "classify existing demo products as pre-baseline demo",
  "create a fresh baseline for the first real Luna Portex scan",
  "do not mix pre-baseline demo records with the first real scan",
  "keep WhatsApp seller alerts in dry-run mode",
  "require inventory, backup, rollback, and user approval before physical cleanup",
]

const allowedEnvironmentPolicy = {
  production: {
    role:
      "IMNOVA Core only",
    ebayProAllowed:
      false,
    firstScanAllowed:
      false,
  },
  staging: {
    role:
      "eBay Pro first real Luna Portex scan",
    ebayProAllowed:
      true,
    firstScanAllowed:
      true,
  },
  lab: {
    role:
      "Heavy scan simulation and baseline testing",
    ebayProAllowed:
      true,
    firstScanAllowed:
      true,
  },
  localVm: {
    role:
      "Future heavy lab processing with separate test DB",
    ebayProAllowed:
      true,
    firstScanSimulationAllowed:
      true,
    connectedInThisLoop:
      false,
  },
} as const

export function isPreBaselineDemoData(record: FirstScanRecord = {}) {
  return (
    record.scanType === LUNA_PORTEX_SCAN_TYPES.PRE_BASELINE_DEMO ||
    record.baselineStatus === LUNA_PORTEX_SCAN_TYPES.PRE_BASELINE_DEMO ||
    record.isDemo === true ||
    record.demo === true ||
    record.testData === true ||
    record.mode === "demo" ||
    record.source === "demo"
  )
}

export function shouldIgnoreForFirstRealScan(
  record: FirstScanRecord = {},
) {
  if (record.scanType === LUNA_PORTEX_SCAN_TYPES.FIRST_REAL_LUNA_PORTEX_SCAN) {
    return false
  }

  return isPreBaselineDemoData(record)
}

export function getFirstScanSafetyChecklist() {
  return [...firstScanSafetyChecklist]
}

export function getFirstScanAllowedEnvironmentPolicy() {
  return {
    ...allowedEnvironmentPolicy,
    production:
      { ...allowedEnvironmentPolicy.production },
    staging:
      { ...allowedEnvironmentPolicy.staging },
    lab:
      { ...allowedEnvironmentPolicy.lab },
    localVm:
      { ...allowedEnvironmentPolicy.localVm },
  }
}

export function getLunaPortexFirstScanBaseline() {
  return {
    version:
      LUNA_PORTEX_FIRST_SCAN_BASELINE_VERSION,
    status:
      "FIRST_SCAN_BASELINE_READY",
    mode:
      "STAGING_LAB_FIRST_SCAN_BASELINE_NO_DB_CHANGES",
    scanTypes:
      LUNA_PORTEX_SCAN_TYPES,
    production:
      { ...allowedEnvironmentPolicy.production },
    staging:
      { ...allowedEnvironmentPolicy.staging },
    lab:
      { ...allowedEnvironmentPolicy.lab },
    localVm:
      { ...allowedEnvironmentPolicy.localVm },
    dataPolicy:
      {
        currentDemoProductsAreProduction:
          false,
        currentDemoProductsCanBeIgnoredForFirstScan:
          true,
        physicalDeleteApplied:
          false,
        physicalCleanupRequiresApproval:
          true,
      },
    scanPolicy:
      {
        nextLunaPortexScanType:
          LUNA_PORTEX_SCAN_TYPES.FIRST_REAL_LUNA_PORTEX_SCAN,
        previousDemoScanType:
          LUNA_PORTEX_SCAN_TYPES.PRE_BASELINE_DEMO,
        shouldMixDemoWithFirstRealScan:
          false,
        requiresFreshBaseline:
          true,
      },
    whatsappPolicy:
      {
        coreWhatsappProductionAllowed:
          true,
        ebayProWhatsappAllowedInProduction:
          false,
        ebayProWhatsappAllowedInStagingLab:
          true,
        ebayProWhatsappDryRunDefault:
          true,
        realSendInThisLoop:
          false,
      },
    cleanupPolicy:
      {
        noPhysicalCleanupInThisLoop:
          true,
        futureCleanupRequiresInventory:
          true,
        futureCleanupRequiresBackup:
          true,
        futureCleanupRequiresRollback:
          true,
        futureCleanupRequiresUserApproval:
          true,
      },
    safetyChecklist:
      getFirstScanSafetyChecklist(),
    safetyFlags:
      {
        productionCoreProtected:
          true,
        ebayProProductionDisabled:
          true,
        stagingLabOnly:
          true,
        liveSupabaseQueried:
          false,
        supabaseWriteUsed:
          false,
        physicalDbCleanupApplied:
          false,
        sqlMigrationCreated:
          false,
        destructiveSqlCreated:
          false,
        dbPushUsed:
          false,
        dbPullUsed:
          false,
        vmConnected:
          false,
        ebayApiUsed:
          false,
        oauthUsed:
          false,
        tokensUsed:
          false,
        realDraftCreated:
          false,
        publishedToEbay:
          false,
        openAiUsed:
          false,
        imageGenerationUsed:
          false,
        imageUploadUsed:
          false,
        whatsappRealSendUsed:
          false,
      },
  }
}
