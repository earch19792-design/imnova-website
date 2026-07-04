export const LOCAL_VM_LAB_CONNECTION_CONTRACT_VERSION =
  "LOCAL_VM_LAB_CONNECTION_CONTRACT_V1"

const futureEnvironmentVariables = [
  {
    name:
      "LOCAL_VM_LAB_ENABLED",
    defaultValue:
      "false",
    purpose:
      "feature switch for future lab connectivity",
  },
  {
    name:
      "LOCAL_VM_LAB_HOST",
    defaultValue:
      "not_set",
    purpose:
      "future lab host placeholder; never commit a real host",
  },
  {
    name:
      "LOCAL_VM_LAB_PORT",
    defaultValue:
      "not_set",
    purpose:
      "future lab database port placeholder",
  },
  {
    name:
      "LOCAL_VM_LAB_DB_NAME",
    defaultValue:
      "not_set",
    purpose:
      "future lab-only database name placeholder",
  },
  {
    name:
      "LOCAL_VM_LAB_DB_USER",
    defaultValue:
      "not_set",
    purpose:
      "future lab-only database user placeholder",
  },
  {
    name:
      "LOCAL_VM_LAB_DB_SSLMODE",
    defaultValue:
      "require",
    purpose:
      "future lab database TLS policy placeholder",
  },
  {
    name:
      "LOCAL_VM_LAB_DRY_RUN",
    defaultValue:
      "true",
    purpose:
      "default future VM/Lab commands to dry-run mode",
  },
  {
    name:
      "EBAY_PRO_RUNTIME",
    defaultValue:
      "staging",
    purpose:
      "keep eBay Pro in staging/lab-only runtime",
  },
  {
    name:
      "LUNA_PORTEX_SCAN_MODE",
    defaultValue:
      "FIRST_REAL_LUNA_PORTEX_SCAN",
    purpose:
      "mark the next Luna Portex scan as the first real scan",
  },
] as const

const vmAllowedWorkloads = [
  "heavy scan batches",
  "lab-only worker runs",
  "raw scan simulations",
  "benchmark experiments",
  "large fixture processing",
  "price intelligence working data",
  "Luna Portex scan simulations",
] as const

const productionNeverTouches = [
  "VM/Lab database connections",
  "heavy eBay Pro scan batches",
  "raw benchmark data",
  "worker scratch output",
  "lab-only fixtures",
  "marketplace authorization flows",
  "real listing drafts",
  "publication actions",
] as const

const firstWorkerChecklist = [
  "confirm Production remains Core-only and clean",
  "confirm eBay Pro runtime remains staging/lab-only",
  "confirm VM/Lab dry-run mode is enabled by default",
  "confirm no real host or database locator is committed",
  "confirm dedicated lab database exists before any future connection",
  "confirm first worker command runs in dry-run mode first",
  "confirm Luna Portex first scan baseline is still pending",
  "confirm WhatsApp Seller Alerts remain dry-run",
] as const

export function getLocalVmLabConnectionContract() {
  return {
    contractVersion:
      LOCAL_VM_LAB_CONNECTION_CONTRACT_VERSION,
    status:
      "LOCAL_VM_LAB_CONNECTION_CONTRACT_READY",
    mode:
      "STATIC_CONTRACT_AND_DRY_RUN_ONLY",
    production:
      {
        productionCoreOnly:
          true,
        productionEbayProDataCleaned:
          true,
        productionOffLimitsForVm:
          true,
      },
    staging:
      {
        stagingReservedForEbayPro:
          true,
        controlledEnvironment:
          true,
      },
    localVmLab:
      {
        localVmConnectedInThisLoop:
          false,
        localVmDryRunHarnessCreated:
          true,
        localVmNetworkCallsUsed:
          false,
        localVmDbWritesUsed:
          false,
        plannedForHeavyProcessing:
          true,
      },
    firstScan:
      {
        firstRealLunaPortexScanStillPending:
          true,
        firstScanExecutionAllowedInThisLoop:
          false,
      },
    whatsapp:
      {
        whatsappDryRunDefault:
          true,
        realSendAllowedInThisLoop:
          false,
      },
    safety:
      {
        secretsCommitted:
          false,
        envFilesCreated:
          false,
        productionWrites:
          false,
        dbConnections:
          false,
        sqlCreated:
          false,
      },
    futureEnvironmentVariables:
      getLocalVmLabFutureEnvironmentVariables(),
    vmAllowedWorkloads:
      getLocalVmLabAllowedWorkloads(),
    productionNeverTouches:
      getLocalVmLabProductionNeverTouches(),
    firstWorkerChecklist:
      getLocalVmLabFirstWorkerChecklist(),
  }
}

export function getLocalVmLabFutureEnvironmentVariables() {
  return futureEnvironmentVariables.map((variable) => ({ ...variable }))
}

export function getLocalVmLabAllowedWorkloads() {
  return [...vmAllowedWorkloads]
}

export function getLocalVmLabProductionNeverTouches() {
  return [...productionNeverTouches]
}

export function getLocalVmLabFirstWorkerChecklist() {
  return [...firstWorkerChecklist]
}

export function getLocalVmLabDryRunStatus() {
  return {
    dryRun:
      true,
    networkCalls:
      false,
    databaseConnections:
      false,
    databaseWrites:
      false,
    productionTouches:
      false,
    stagingDbTouches:
      false,
    vmConnected:
      false,
  }
}
