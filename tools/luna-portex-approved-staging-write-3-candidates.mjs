import { readFileSync } from "node:fs";

import {
  runLunaPortexStagingScanDryRun,
} from "../lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
import {
  buildLunaPortexStagingWritePlan,
} from "../lib/ebay/luna-portex-staging-write-gate.ts";
import {
  buildLunaPortexStagingWritePayloads,
} from "../lib/ebay/luna-portex-staging-write-adapter.ts";
import {
  buildLunaPortexStagingExecutionPlan,
  simulateStagingWriteExecution,
} from "../lib/ebay/luna-portex-staging-write-execution-harness.ts";
import {
  validatePayloadBundleAgainstStagingSchema,
} from "../lib/ebay/luna-portex-staging-schema-compatibility.ts";
import {
  buildApprovedStagingWritePlan,
  buildPostWriteVerificationPlan,
  summarizeApprovedStagingWritePlan,
} from "../lib/ebay/luna-portex-approved-staging-write-plan.ts";

const executeFlag =
  "--execute-approved-staging-write";
const approvalValue =
  "APPROVE_LOOP_141_STAGING_WRITE_3_CANDIDATES";
const executionRunId =
  "loop141-approved-staging-write-v1";
const sourceDataClass =
  "LOOP_141_CONTROLLED_STAGING_CANDIDATE_WRITE";
const allowedTables = [
  "ebay_product_candidates",
  "ebay_candidate_scores",
  "ebay_candidate_validations",
  "ebay_profit_scenarios",
];
const optionalMetadataColumns = [
  "sourceDataClass",
  "sourceRunId",
  "executionRunId",
  "listableInEbay",
  "publishable",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function buildPipeline() {
  const catalogPath =
    new URL("./fixtures/luna-portex-staging-scan-sample-catalog-v1.json", import.meta.url);
  const schemaSnapshotPath =
    new URL("./fixtures/luna-portex-staging-schema-snapshot-example-v1.json", import.meta.url);
  const catalogFixture =
    readJson(catalogPath);
  const schemaSnapshot =
    readJson(schemaSnapshotPath);
  const scanResult =
    runLunaPortexStagingScanDryRun({
      catalog:
        catalogFixture.items,
      maxProductsPerDryRun:
        20,
    });
  const gatePlan =
    buildLunaPortexStagingWritePlan(
      scanResult,
      {
        maxCandidatesPerWritePlan:
          20,
      },
    );
  const payloadBundle =
    buildLunaPortexStagingWritePayloads(
      gatePlan,
      {
        maxPayloadCandidates:
          20,
      },
    );
  const executionPlan =
    buildLunaPortexStagingExecutionPlan(
      payloadBundle,
      {
        maxExecutionCandidates:
          20,
      },
    );

  simulateStagingWriteExecution(
    executionPlan,
    {
      approvalGranted:
        false,
    },
  );

  const schemaCompatibilityReport =
    validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
      {
        readOnlySqlPrepared:
          true,
      },
    );
  const writePlan =
    buildApprovedStagingWritePlan(
      payloadBundle,
      {
        schemaCompatibilityReport,
        maxCandidates:
          3,
        maxOperations:
          12,
      },
    );
  const verificationPlan =
    buildPostWriteVerificationPlan(writePlan);

  return {
    scanResult,
    gatePlan,
    payloadBundle,
    executionPlan,
    schemaCompatibilityReport,
    writePlan,
    verificationPlan,
  };
}

function isExecuteMode() {
  return process.argv.includes(executeFlag);
}

function readExecuteConfig() {
  const env =
    process.env;
  const missingRequiredStagingEnvVars = [];

  if (env.EBAY_PRO_TARGET_ENV !== "staging") {
    missingRequiredStagingEnvVars.push("EBAY_PRO_TARGET_ENV=staging");
  }

  if (env.EBAY_PRO_STAGING_WRITE_APPROVED !== approvalValue) {
    missingRequiredStagingEnvVars.push("EBAY_PRO_STAGING_WRITE_APPROVED");
  }

  if (!env.SUPABASE_STAGING_URL) {
    missingRequiredStagingEnvVars.push("SUPABASE_STAGING_URL");
  }

  if (!env.SUPABASE_STAGING_SERVICE_ROLE_KEY) {
    missingRequiredStagingEnvVars.push("SUPABASE_STAGING_SERVICE_ROLE_KEY");
  }

  if (!env.EBAY_PRO_STAGING_PROJECT_REF) {
    missingRequiredStagingEnvVars.push("EBAY_PRO_STAGING_PROJECT_REF");
  }

  return {
    targetEnv:
      env.EBAY_PRO_TARGET_ENV,
    approval:
      env.EBAY_PRO_STAGING_WRITE_APPROVED,
    supabaseStagingUrl:
      env.SUPABASE_STAGING_URL,
    supabaseStagingServiceRoleKey:
      env.SUPABASE_STAGING_SERVICE_ROLE_KEY,
    stagingProjectRef:
      env.EBAY_PRO_STAGING_PROJECT_REF,
    missingRequiredStagingEnvVars,
  };
}

function isProductionMarkedUrl(url) {
  if (typeof url !== "string") {
    return true;
  }

  const lowerUrl =
    url.toLowerCase();

  return (
    lowerUrl.includes("production") ||
    lowerUrl.includes("prod")
  );
}

function isSafeStagingUrl(url, expectedProjectRef) {
  if (
    typeof url !== "string" ||
    typeof expectedProjectRef !== "string" ||
    expectedProjectRef.trim().length === 0
  ) {
    return {
      safe:
        false,
      reason:
        "missing explicit Staging project ref confirmation",
    };
  }

  if (isProductionMarkedUrl(url)) {
    return {
      safe:
        false,
      reason:
        "Supabase URL is marked as Production",
    };
  }

  if (!url.includes(expectedProjectRef.trim())) {
    return {
      safe:
        false,
      reason:
        "Supabase URL does not contain expected Staging project ref",
    };
  }

  return {
    safe:
      true,
    reason:
      "Supabase URL matched expected Staging project ref",
  };
}

function summarizeDryRun(writePlan) {
  const planSummary =
    summarizeApprovedStagingWritePlan(writePlan);

  return {
    mode:
      "dry-run",
    candidatesPlanned:
      planSummary.candidatesPlanned,
    operationsPlanned:
      planSummary.operationsPlanned,
    tablesPlanned:
      planSummary.tablesPlanned,
    tableNames:
      planSummary.tableNames,
    dedupeKeys:
      planSummary.dedupeKeys,
    writeExecuted:
      false,
    stagingWriteExecuted:
      false,
    approvalRequired:
      true,
    errors:
      planSummary.errors,
    warnings:
      planSummary.warnings,
  };
}

function prepareRowsForRealWrite(writePlan, availableColumnsByTable) {
  const warnings = [];

  return {
    rowsByTable:
      Object.fromEntries(
        allowedTables.map(tableName => {
          const availableColumns =
            availableColumnsByTable[tableName];
          const rows =
            writePlan.operations
              .filter(operation => operation.tableName === tableName)
              .map(operation => {
                const row =
                  {};

                for (const [key, value] of Object.entries(operation.payload)) {
                  if (
                    availableColumns === null ||
                    availableColumns.has(key) ||
                    !optionalMetadataColumns.includes(key)
                  ) {
                    row[key] =
                      value;
                    continue;
                  }

                  warnings.push(`${tableName}.${key}: optional column not available in real schema`);
                }

                return row;
              });

          return [tableName, rows];
        }),
      ),
    warnings:
      [...new Set(warnings)],
  };
}

async function getAvailableColumnsByTable(client) {
  const availableColumnsByTable =
    {};
  const warnings =
    [];

  for (const tableName of allowedTables) {
    const { data, error } =
      await client
        .from(tableName)
        .select("tableName,sourceId,sourceScanType,dedupeKey,stagingOnly,dryRun,approvalRequired,writeExecuted", {
          count:
            "exact",
          head:
            false,
        })
        .limit(0);

    if (error) {
      return {
        compatible:
          false,
        availableColumnsByTable:
          {},
        warnings,
        errors:
          [`${tableName}: real schema preflight failed`],
      };
    }

    void data;
    availableColumnsByTable[tableName] =
      null;
  }

  return {
    compatible:
      true,
    availableColumnsByTable,
    warnings,
    errors:
      [],
  };
}

function serializeForConflict(row) {
  const clone =
    { ...row };

  delete clone.sourceRunId;
  delete clone.executionRunId;

  return JSON.stringify(clone, Object.keys(clone).sort());
}

async function readExistingRows(client, writePlan) {
  const rowsByTable =
    {};
  const errors =
    [];

  for (const tableName of allowedTables) {
    const { data, error } =
      await client
        .from(tableName)
        .select("dedupeKey,sourceDataClass,sourceRunId,executionRunId,tableName,sourceId,sourceScanType,dryRun,stagingOnly,approvalRequired,writeExecuted")
        .in("dedupeKey", writePlan.dedupeKeys);

    if (error) {
      errors.push(`${tableName}: existing row pre-read failed`);
      rowsByTable[tableName] =
        [];
      continue;
    }

    rowsByTable[tableName] =
      Array.isArray(data) ? data : [];
  }

  return {
    rowsByTable,
    errors,
  };
}

function detectConflicts(existingRowsByTable, plannedRowsByTable) {
  const conflicts =
    [];
  const duplicates =
    [];

  for (const tableName of allowedTables) {
    const existingRows =
      existingRowsByTable[tableName] ?? [];
    const seen =
      new Set();

    for (const existingRow of existingRows) {
      const dedupeKey =
        existingRow.dedupeKey;

      if (seen.has(dedupeKey)) {
        duplicates.push(`${tableName}:${dedupeKey}`);
      }

      seen.add(dedupeKey);

      if (
        existingRow.sourceDataClass &&
        existingRow.sourceDataClass !== sourceDataClass
      ) {
        conflicts.push(`${tableName}:${dedupeKey}: sourceDataClass mismatch`);
        continue;
      }

      const plannedRow =
        (plannedRowsByTable[tableName] ?? []).find(row => row.dedupeKey === dedupeKey);

      if (
        plannedRow &&
        existingRow.sourceDataClass === sourceDataClass &&
        serializeForConflict(existingRow) !== serializeForConflict(plannedRow)
      ) {
        conflicts.push(`${tableName}:${dedupeKey}: payload differs`);
      }
    }
  }

  return {
    conflicts,
    duplicates,
  };
}

async function upsertRows(client, rowsByTable) {
  const writtenByTable =
    {};
  const errors =
    [];

  for (const tableName of allowedTables) {
    const rows =
      rowsByTable[tableName] ?? [];
    const { data, error } =
      await client
        .from(tableName)
        .upsert(rows, {
          onConflict:
            "dedupeKey",
        })
        .select("dedupeKey");

    if (error) {
      errors.push(`${tableName}: upsert failed`);
      writtenByTable[tableName] =
        0;
      continue;
    }

    writtenByTable[tableName] =
      Array.isArray(data) ? data.length : rows.length;
  }

  return {
    writtenByTable,
    errors,
  };
}

async function verifyPostWrite(client, writePlan) {
  const rowsAfterByTable =
    {};
  const duplicates =
    [];
  const errors =
    [];

  for (const tableName of allowedTables) {
    const { data, error } =
      await client
        .from(tableName)
        .select("dedupeKey,sourceRunId,executionRunId")
        .in("dedupeKey", writePlan.dedupeKeys);

    if (error) {
      errors.push(`${tableName}: post-write verification failed`);
      rowsAfterByTable[tableName] =
        0;
      continue;
    }

    const rows =
      Array.isArray(data) ? data : [];
    const keys =
      rows.map(row => row.dedupeKey);

    for (const key of keys) {
      if (keys.filter(candidateKey => candidateKey === key).length > 1) {
        duplicates.push(`${tableName}:${key}`);
      }
    }

    rowsAfterByTable[tableName] =
      rows.length;
  }

  return {
    rowsAfterByTable,
    duplicates,
    errors,
    passed:
      errors.length === 0 &&
      duplicates.length === 0 &&
      Object.values(rowsAfterByTable).every(count => count === writePlan.dedupeKeys.length),
  };
}

async function runExecuteMode(pipeline) {
  const config =
    readExecuteConfig();
  const executeSummary = {
    mode:
      "execute",
    stagingWriteExecuted:
      false,
    preflightRealSchemaCompatible:
      false,
    candidatesWrittenOrUpserted:
      0,
    operationsWrittenOrUpserted:
      0,
    rowsBeforeByTable:
      {},
    rowsAfterByTable:
      {},
    duplicatesDetected:
      [],
    conflictsDetected:
      [],
    postWriteVerificationPassed:
      false,
    missingRequiredStagingEnvVars:
      config.missingRequiredStagingEnvVars,
    warnings:
      [],
    errors:
      [],
    semaphore:
      "YELLOW",
  };

  if (config.missingRequiredStagingEnvVars.length > 0) {
    executeSummary.errors.push("execute mode missing required Staging env vars or approval flags");
    return executeSummary;
  }

  const stagingUrlSafety =
    isSafeStagingUrl(
      config.supabaseStagingUrl,
      config.stagingProjectRef,
    );

  if (!stagingUrlSafety.safe) {
    executeSummary.errors.push(stagingUrlSafety.reason);
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const { createClient } =
    await import("@supabase/supabase-js");
  const client =
    createClient(
      config.supabaseStagingUrl,
      config.supabaseStagingServiceRoleKey,
      {
        auth:
          {
            persistSession:
              false,
            autoRefreshToken:
              false,
          },
      },
    );
  const preflight =
    await getAvailableColumnsByTable(client);

  executeSummary.preflightRealSchemaCompatible =
    preflight.compatible;
  executeSummary.warnings.push(...preflight.warnings);

  if (!preflight.compatible) {
    executeSummary.errors.push(...preflight.errors);
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const preparedRows =
    prepareRowsForRealWrite(
      pipeline.writePlan,
      preflight.availableColumnsByTable,
    );
  executeSummary.warnings.push(...preparedRows.warnings);

  const existing =
    await readExistingRows(client, pipeline.writePlan);
  executeSummary.errors.push(...existing.errors);
  executeSummary.rowsBeforeByTable =
    Object.fromEntries(
      allowedTables.map(tableName => [
        tableName,
        (existing.rowsByTable[tableName] ?? []).length,
      ]),
    );

  const conflictReport =
    detectConflicts(
      existing.rowsByTable,
      preparedRows.rowsByTable,
    );

  executeSummary.duplicatesDetected =
    conflictReport.duplicates;
  executeSummary.conflictsDetected =
    conflictReport.conflicts;

  if (
    existing.errors.length > 0 ||
    conflictReport.duplicates.length > 0 ||
    conflictReport.conflicts.length > 0
  ) {
    executeSummary.errors.push("idempotency pre-read blocked write");
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const upsert =
    await upsertRows(
      client,
      preparedRows.rowsByTable,
    );
  executeSummary.errors.push(...upsert.errors);
  executeSummary.operationsWrittenOrUpserted =
    Object.values(upsert.writtenByTable).reduce((sum, count) => sum + count, 0);
  executeSummary.candidatesWrittenOrUpserted =
    pipeline.writePlan.dedupeKeys.length;

  if (upsert.errors.length > 0) {
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const verification =
    await verifyPostWrite(
      client,
      pipeline.writePlan,
    );
  executeSummary.rowsAfterByTable =
    verification.rowsAfterByTable;
  executeSummary.duplicatesDetected =
    verification.duplicates;
  executeSummary.errors.push(...verification.errors);
  executeSummary.postWriteVerificationPassed =
    verification.passed;
  executeSummary.stagingWriteExecuted =
    verification.passed;
  executeSummary.semaphore =
    verification.passed ? "GREEN" : "RED";

  return executeSummary;
}

const pipeline =
  buildPipeline();
const dryRunSummary =
  summarizeDryRun(pipeline.writePlan);

if (!isExecuteMode()) {
  console.log(
    JSON.stringify(
      {
        summary:
          dryRunSummary,
        verificationPlan:
          pipeline.verificationPlan,
      },
      null,
      2,
    ),
  );
} else {
  const executeSummary =
    await runExecuteMode(pipeline);

  console.log(
    JSON.stringify(
      {
        summary:
          dryRunSummary,
        executeSummary,
        executionRunId,
      },
      null,
      2,
    ),
  );
}
