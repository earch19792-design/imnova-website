const contractVersion =
  "LOCAL_VM_LAB_CONNECTION_CONTRACT_V1";

const expectedVariables = [
  "LOCAL_VM_LAB_ENABLED=false",
  "LOCAL_VM_LAB_HOST=not_set",
  "LOCAL_VM_LAB_PORT=not_set",
  "LOCAL_VM_LAB_DB_NAME=not_set",
  "LOCAL_VM_LAB_DB_USER=not_set",
  "LOCAL_VM_LAB_DB_SSLMODE=require",
  "LOCAL_VM_LAB_DRY_RUN=true",
  "EBAY_PRO_RUNTIME=staging",
  "LUNA_PORTEX_SCAN_MODE=FIRST_REAL_LUNA_PORTEX_SCAN",
];

const readinessChecklist = [
  "Production remains Core-only and clean",
  "Staging remains the eBay Pro control environment",
  "VM/Lab is documented but not connected",
  "Dry-run mode is the default",
  "No host, password, token, or database locator is present",
  "No network call is attempted",
  "No database client is created",
  "No worker or scan is executed",
];

const dryRunResult = {
  contractVersion,
  status:
    "LOCAL_VM_LAB_CONNECTION_DRY_RUN_READY",
  mode:
    "SIMULATED_NO_NETWORK_NO_DB",
  localVmConnectedInThisLoop:
    false,
  networkCallsUsed:
    false,
  databaseConnectionsUsed:
    false,
  databaseWritesUsed:
    false,
  productionTouched:
    false,
  stagingDbTouched:
    false,
  expectedVariables,
  readinessChecklist,
};

console.log(JSON.stringify(dryRunResult, null, 2));
