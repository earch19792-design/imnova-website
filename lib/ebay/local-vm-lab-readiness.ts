export const LOCAL_VM_LAB_FIRST_SCAN_READINESS_VERSION =
  "LOCAL_VM_LAB_FIRST_SCAN_READINESS_V1"

const firstRealLunaPortexScanChecklist = [
  "confirm Production remains IMNOVA Core-only",
  "confirm Production eBay Pro target tables remain exactRows zero",
  "confirm Staging is the controlled eBay Pro execution environment",
  "confirm Local VM/Lab is reserved for heavy scan processing",
  "keep WhatsApp Seller Alerts in dry-run mode",
  "keep marketplace API access, authorization flows, listing drafts, and publication disabled",
  "prepare a fresh Luna Portex first-scan baseline in Staging/Lab",
  "do not move demo/pre-baseline data into the first real scan result",
] as const

const stagingDataBoundary = [
  "eBay Pro summaries",
  "first real Luna Portex scan control state",
  "candidate review state",
  "seller action status",
  "safe product facts shared from Core",
  "dry-run WhatsApp seller alert previews",
] as const

const localVmDataBoundary = [
  "heavy scan batches",
  "raw benchmark samples",
  "large Market Radar snapshots",
  "price intelligence working data",
  "worker logs for lab runs",
  "future image workflow experiments",
] as const

const productionNeverReceives = [
  "eBay Pro scan batches",
  "Market Radar heavy snapshots",
  "benchmark raw data",
  "scanner outputs",
  "lab worker logs",
  "external marketplace authorization tokens",
  "real listing drafts",
  "publication actions",
] as const

export function getLocalVmLabReadiness() {
  return {
    readinessVersion:
      LOCAL_VM_LAB_FIRST_SCAN_READINESS_VERSION,
    status:
      "LOCAL_VM_LAB_FIRST_SCAN_READINESS_DOCUMENTED",
    mode:
      "STATIC_READINESS_NO_CONNECTIONS",
    production:
      {
        productionCoreOnly:
          true,
        productionEbayProDataCleaned:
          true,
        productionTargetTablesExactRowsZero:
          true,
        productionOffLimitsForFirstScan:
          true,
      },
    staging:
      {
        stagingReservedForEbayPro:
          true,
        firstRealLunaPortexScanControlPlane:
          true,
        heavyProcessingAllowed:
          false,
      },
    localVmLab:
      {
        localVmConnectedInThisLoop:
          false,
        localVmPlannedForHeavyProcessing:
          true,
        labDbConnectionPlannedForFutureLoop:
          true,
        heavyWorkerExecutionAllowedInThisLoop:
          false,
      },
    firstScan:
      {
        firstRealLunaPortexScanReadyForPlanning:
          true,
        firstScanExecutedInThisLoop:
          false,
        baselineType:
          "FIRST_REAL_LUNA_PORTEX_SCAN",
        preBaselineDemoDataMustStayIgnored:
          true,
      },
    whatsapp:
      {
        whatsappDryRunDefault:
          true,
        realSendAllowedInThisLoop:
          false,
        coreWhatsappProductionAllowed:
          true,
        ebayProWhatsappProductionAllowed:
          false,
      },
    safetyFlags:
      {
        noProductionWrites:
          true,
        noDbConnectionsInThisLoop:
          true,
        noSecretsCommitted:
          true,
        noVmConnection:
          true,
        noSupabaseWrite:
          true,
        noSqlMigration:
          true,
        noEbayApi:
          true,
        noMarketplaceAuthFlow:
          true,
        noOpenAi:
          true,
        noImageGeneration:
          true,
        noUploads:
          true,
        noScraper:
          true,
        noDownloads:
          true,
      },
    checklist:
      getFirstRealLunaPortexScanReadinessChecklist(),
    dataBoundaries:
      getLocalVmLabDataBoundaries(),
  }
}

export function getFirstRealLunaPortexScanReadinessChecklist() {
  return [...firstRealLunaPortexScanChecklist]
}

export function getLocalVmLabDataBoundaries() {
  return {
    staging:
      [...stagingDataBoundary],
    localVmLab:
      [...localVmDataBoundary],
    productionNeverReceives:
      [...productionNeverReceives],
  }
}

export function getLocalVmLabFutureConnectionRunbook() {
  return {
    status:
      "DOCUMENTED_NOT_CONNECTED",
    connectionCreatedInThisLoop:
      false,
    requiredBeforeConnection:
      [
        "dedicated lab database",
        "read/write credentials scoped to lab only",
        "no shared Production credentials",
        "network allowlist approved by operator",
        "backup and reset procedure for lab data",
        "dry-run worker command reviewed before execution",
      ],
    forbiddenInThisLoop:
      [
        "ping VM",
        "SSH to VM",
        "connect to lab database",
        "run scanner",
        "write Supabase data",
        "call marketplace API",
      ],
  }
}
