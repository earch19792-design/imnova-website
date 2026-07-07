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
const productCandidateTable =
  "ebay_product_candidates";
const childTables = [
  "ebay_candidate_scores",
  "ebay_candidate_validations",
  "ebay_profit_scenarios",
];
const realSchemaRequiredColumns = {
  ebay_product_candidates:
    [
      "id",
      "candidate_key",
      "supplier_variant_id",
      "title",
      "source_payload",
      "normalized_payload",
      "state",
      "needs_data",
      "blocked_reason",
    ],
  ebay_candidate_scores:
    [
      "candidate_id",
      "score_version",
      "winner_score",
      "score_payload",
      "calculated_at",
      "idempotency_key",
    ],
  ebay_candidate_validations:
    [
      "candidate_id",
      "validation_version",
      "validation_status",
      "required_fields",
      "missing_fields",
      "critical_reasons",
      "validated_at",
      "idempotency_key",
    ],
  ebay_profit_scenarios:
    [
      "candidate_id",
      "scenario_version",
      "estimated_sale_price",
      "luna_cost",
      "fulfillment_cost",
      "packaging_cost",
      "estimated_shipping_cost",
      "estimated_ebay_fee",
      "estimated_payment_fee",
      "estimated_advertising_cost",
      "return_reserve",
      "total_estimated_cost",
      "net_profit",
      "net_margin_percent",
      "roi_percent",
      "passes_minimums",
      "assumptions",
      "calculated_at",
      "idempotency_key",
    ],
};
const productCandidateInsertColumns = [
  "candidate_key",
  "supplier_variant_id",
  "title",
  "source_payload",
  "normalized_payload",
  "state",
  "needs_data",
  "blocked_reason",
];
const requiredProductCandidateInsertFields = [
  "candidate_key",
  "supplier_variant_id",
  "title",
  "source_payload",
  "normalized_payload",
  "state",
  "needs_data",
];
const allowedCandidateStates = [
  "DETECTED",
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

async function getAvailableColumnsByTable(client) {
  const availableColumnsByTable =
    {};
  const warnings =
    [];

  for (const tableName of allowedTables) {
    const requiredColumns =
      realSchemaRequiredColumns[tableName];
    const { data, error } =
      await client
        .from(tableName)
        .select(requiredColumns.join(","), {
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
      new Set(requiredColumns);
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

function metadataForPayload(payload) {
  return {
    sourceDataClass,
    sourceRunId:
      executionRunId,
    executionRunId,
    listableInEbay:
      false,
    publishable:
      false,
    stagingOnly:
      true,
    approvalRequired:
      true,
    dryRun:
      payload.dryRun === true,
  };
}

function titleForProductPayload(payload) {
  return (
    payload.title ??
    payload.sourceTitle ??
    payload.sourceId ??
    payload.dedupeKey ??
    "Luna Portex staging candidate"
  );
}

function stateForProductPayload(payload) {
  void payload;
  return "DETECTED";
}

function reviewStatusForProductPayload(payload) {
  return payload.reviewRequired === true
    ? "REVIEW_PENDING"
    : "READY_FOR_REVIEW";
}

function normalizeCandidateStateForRealSchema(state) {
  if (allowedCandidateStates.includes(state)) {
    return {
      state,
      normalized:
        false,
      error:
        null,
    };
  }

  if (state === "REVIEW_PENDING") {
    return {
      state:
        "DETECTED",
      normalized:
        true,
      error:
        null,
    };
  }

  return {
    state:
      null,
    normalized:
      false,
    error:
      `invalid candidate state for real schema: ${state}`,
  };
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validateProductCandidateInsertRow(row) {
  const errors = [];

  for (const field of requiredProductCandidateInsertFields) {
    if (!Object.hasOwn(row, field)) {
      errors.push(`missing required candidate insert field: ${field}`);
      continue;
    }

    const value =
      row[field];

    if (
      ["candidate_key", "supplier_variant_id", "title", "state"].includes(field) &&
      (typeof value !== "string" || value.trim().length === 0)
    ) {
      errors.push(`missing required candidate insert field: ${field}`);
    }

    if (
      ["source_payload", "normalized_payload"].includes(field) &&
      !isPlainObject(value)
    ) {
      errors.push(`missing required candidate insert field: ${field}`);
    }

    if (field === "needs_data" && !Array.isArray(value)) {
      errors.push(`missing required candidate insert field: ${field}`);
    }
  }

  const stateValidation =
    normalizeCandidateStateForRealSchema(row.state);

  if (stateValidation.error !== null) {
    errors.push(stateValidation.error);
  }

  if (
    Object.hasOwn(row, "idempotency_key") ||
    Object.hasOwn(row, "candidate_id")
  ) {
    errors.push("product candidate row contains forbidden candidate base column");
  }

  const unexpectedColumns =
    Object.keys(row).filter(column => !productCandidateInsertColumns.includes(column));

  if (unexpectedColumns.length > 0) {
    errors.push(`product candidate row contains unknown columns: ${unexpectedColumns.join(", ")}`);
  }

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

function sanitizeSupabaseError(table, operation, error, attemptedColumns = []) {
  return {
    table,
    operation,
    code:
      typeof error?.code === "string" ? error.code : null,
    message:
      typeof error?.message === "string" ? error.message : "Supabase operation failed",
    details:
      typeof error?.details === "string" ? error.details : null,
    hint:
      typeof error?.hint === "string" ? error.hint : null,
    attemptedColumns:
      [...attemptedColumns],
  };
}

function buildRealSchemaRowsByTable(writePlan) {
  const productOperations =
    writePlan.operations.filter(operation => operation.tableName === productCandidateTable);
  const scoreOperations =
    writePlan.operations.filter(operation => operation.tableName === "ebay_candidate_scores");
  const validationOperations =
    writePlan.operations.filter(operation => operation.tableName === "ebay_candidate_validations");
  const profitOperations =
    writePlan.operations.filter(operation => operation.tableName === "ebay_profit_scenarios");
  const productRows =
    productOperations.map(operation => {
      const payload =
        operation.payload;
      const metadata =
        metadataForPayload(payload);
      const reviewStatus =
        reviewStatusForProductPayload(payload);

      return {
        candidate_key:
          payload.dedupeKey,
        supplier_variant_id:
          payload.sourceId ?? payload.dedupeKey,
        title:
          titleForProductPayload(payload),
        source_payload:
          {
            originalPayload:
              payload,
            metadata,
          },
        normalized_payload:
          {
            candidateKey:
              payload.dedupeKey,
            sourceId:
              payload.sourceId,
            sourceScanType:
              payload.sourceScanType,
            sellReady:
              payload.sellReady === true,
            reviewRequired:
              payload.reviewRequired === true,
            reviewStatus,
            metadata,
          },
        state:
          stateForProductPayload(payload),
        needs_data:
          [],
        blocked_reason:
          payload.reviewRequired === true ? "review_required" : null,
      };
    });
  const rowsByTable =
    {};

  rowsByTable[productCandidateTable] =
    productRows;
  rowsByTable.ebay_candidate_scores =
    scoreOperations.map(operation => {
      const payload =
        operation.payload;
      const metadata =
        metadataForPayload(payload);

      return {
        candidate_key:
          payload.dedupeKey,
        candidate_id:
          null,
        score_version:
          executionRunId,
        winner_score:
          payload.score ?? null,
        data_quality_score:
          payload.score ?? null,
        explanation:
          payload.reviewRequired === true ? "requires review" : "first scan readiness",
        score_payload:
          {
            originalPayload:
              payload,
            metadata,
          },
        calculated_at:
          new Date().toISOString(),
        idempotency_key:
          `${payload.dedupeKey}:score`,
      };
    });
  rowsByTable.ebay_candidate_validations =
    validationOperations.map(operation => {
      const payload =
        operation.payload;
      const metadata =
        metadataForPayload(payload);

      return {
        candidate_key:
          payload.dedupeKey,
        candidate_id:
          null,
        validation_version:
          executionRunId,
        validation_status:
          payload.validationStatus,
        required_fields:
          ["candidate_key", "supplier_variant_id", "title"],
        missing_fields:
          [],
        critical_reasons:
          payload.warnings ?? [],
        validated_at:
          new Date().toISOString(),
        idempotency_key:
          `${payload.dedupeKey}:validation`,
        metadata,
      };
    });
  rowsByTable.ebay_profit_scenarios =
    profitOperations.map(operation => {
      const payload =
        operation.payload;
      const metadata =
        metadataForPayload(payload);

  return {
        candidate_key:
          payload.dedupeKey,
        candidate_id:
          null,
        scenario_version:
          executionRunId,
        estimated_sale_price:
          null,
        luna_cost:
          null,
        fulfillment_cost:
          null,
        packaging_cost:
          null,
        estimated_shipping_cost:
          null,
        estimated_ebay_fee:
          null,
        estimated_payment_fee:
          null,
        estimated_advertising_cost:
          null,
        return_reserve:
          null,
        total_estimated_cost:
          null,
        net_profit:
          null,
        net_margin_percent:
          null,
        roi_percent:
          null,
        passes_minimums:
          payload.profitScenarioReady === true,
        assumptions:
          {
            originalPayload:
              payload,
            metadata,
          },
        calculated_at:
          new Date().toISOString(),
        idempotency_key:
          `${payload.dedupeKey}:profit`,
      };
    });

  return {
    rowsByTable,
    warnings:
      [],
  };
}

async function selectRowsByColumn(client, tableName, columnName, value) {
  return client
    .from(tableName)
    .select("*")
    .eq(columnName, value);
}

async function writeProductCandidateRows(client, productRows) {
  let rowsBefore =
    0;
  let rowsAfter =
    0;
  const candidateIdsByKey =
    {};
  const conflicts =
    [];
  const duplicates =
    [];
  const errors =
    [];
  let written =
    0;

  for (const row of productRows) {
    const existing =
      await selectRowsByColumn(client, productCandidateTable, "candidate_key", row.candidate_key);

    if (existing.error) {
      errors.push(
        sanitizeSupabaseError(
          productCandidateTable,
          "select by candidate_key",
          existing.error,
          ["candidate_key"],
        ),
      );
      continue;
    }

    const existingRows =
      Array.isArray(existing.data) ? existing.data : [];
    rowsBefore +=
      existingRows.length;

    if (existingRows.length > 1) {
      duplicates.push(`${productCandidateTable}:${row.candidate_key}`);
      conflicts.push(`${productCandidateTable}:${row.candidate_key}: duplicated candidate_key`);
      continue;
    }

    const localValidation =
      validateProductCandidateInsertRow(row);

    if (!localValidation.valid) {
      errors.push(...localValidation.errors);
      continue;
    }

    if (existingRows.length === 1) {
      const updateResult =
        await client
          .from(productCandidateTable)
          .update(row)
          .eq("candidate_key", row.candidate_key)
          .select("id,candidate_key");

      if (updateResult.error) {
        errors.push(
          sanitizeSupabaseError(
            productCandidateTable,
            "update by candidate_key",
            updateResult.error,
            Object.keys(row),
          ),
        );
        continue;
      }

      const updatedRows =
        Array.isArray(updateResult.data) ? updateResult.data : [];

      if (updatedRows.length !== 1) {
        conflicts.push(`${productCandidateTable}:${row.candidate_key}: update did not return exactly one row`);
        continue;
      }

      candidateIdsByKey[row.candidate_key] =
        updatedRows[0].id;
      written +=
        1;
      continue;
    }

    const insertResult =
      await client
        .from(productCandidateTable)
        .insert(row)
        .select("id,candidate_key");

    if (insertResult.error) {
      errors.push(
        sanitizeSupabaseError(
          productCandidateTable,
          "insert",
          insertResult.error,
          Object.keys(row),
        ),
      );
      continue;
    }

    const insertedRows =
      Array.isArray(insertResult.data) ? insertResult.data : [];

    if (insertedRows.length !== 1) {
      conflicts.push(`${productCandidateTable}:${row.candidate_key}: insert did not return exactly one row`);
      continue;
    }

    candidateIdsByKey[row.candidate_key] =
      insertedRows[0].id;
    written +=
      1;
  }

  rowsAfter +=
    written;

  return {
    candidateIdsByKey,
    rowsBefore,
    rowsAfter,
    written,
    conflicts,
    duplicates,
    errors,
  };
}

function resolveChildCandidateIds(rowsByTable, candidateIdsByKey) {
  const resolvedRowsByTable =
    {};
  const errors =
    [];

  for (const tableName of childTables) {
    resolvedRowsByTable[tableName] =
      (rowsByTable[tableName] ?? []).map(row => {
        const candidateId =
          candidateIdsByKey[row.candidate_key];

        if (!candidateId) {
          errors.push(`${tableName}:${row.candidate_key}: candidate_id not resolved`);
        }

        const resolvedRow =
          { ...row };

        delete resolvedRow.candidate_key;
        delete resolvedRow.metadata;
        resolvedRow.candidate_id =
          candidateId ?? null;

        return resolvedRow;
      });
  }

  return {
    rowsByTable:
      resolvedRowsByTable,
    errors,
  };
}

async function selectRowsByIdempotencyKey(client, tableName, idempotencyKey) {
  return client
    .from(tableName)
    .select("*")
    .eq("idempotency_key", idempotencyKey);
}

async function writeChildRows(client, childRowsByTable) {
  const writtenByTable =
    {};
  const errors =
    [];
  const conflicts =
    [];
  const duplicates =
    [];

  for (const tableName of childTables) {
    const rows =
      childRowsByTable[tableName] ?? [];

    writtenByTable[tableName] =
      0;

    for (const row of rows) {
      const existing =
        await selectRowsByIdempotencyKey(client, tableName, row.idempotency_key);

      if (existing.error) {
        errors.push(
          sanitizeSupabaseError(
            tableName,
            "select by idempotency_key",
            existing.error,
            ["idempotency_key"],
          ),
        );
        continue;
      }

      const existingRows =
        Array.isArray(existing.data) ? existing.data : [];

      if (existingRows.length > 1) {
        duplicates.push(`${tableName}:${row.idempotency_key}`);
        conflicts.push(`${tableName}:${row.idempotency_key}: duplicated idempotency_key`);
        continue;
      }

      if (existingRows.length === 1) {
        const updateResult =
          await client
            .from(tableName)
            .update(row)
            .eq("idempotency_key", row.idempotency_key)
            .select("idempotency_key");

        if (updateResult.error) {
          errors.push(
            sanitizeSupabaseError(
              tableName,
              "update by idempotency_key",
              updateResult.error,
              Object.keys(row),
            ),
          );
          continue;
        }

        writtenByTable[tableName] +=
          1;
        continue;
      }

      const insertResult =
        await client
          .from(tableName)
          .insert(row)
          .select("idempotency_key");

      if (insertResult.error) {
        errors.push(
          sanitizeSupabaseError(
            tableName,
            "insert",
            insertResult.error,
            Object.keys(row),
          ),
        );
        continue;
      }

      writtenByTable[tableName] +=
        1;
    }
  }

  return {
    writtenByTable,
    conflicts,
    duplicates,
    errors,
  };
}

async function verifyPostWrite(client, writePlan, candidateIdsByKey) {
  const rowsAfterByTable =
    {};
  const duplicates =
    [];
  const errors =
    [];

  const productRows =
    await client
      .from(productCandidateTable)
      .select("id,candidate_key")
      .in("candidate_key", writePlan.dedupeKeys);

  if (productRows.error) {
    errors.push(
      sanitizeSupabaseError(
        productCandidateTable,
        "post-write verification select by candidate_key",
        productRows.error,
        ["id", "candidate_key"],
      ),
    );
    rowsAfterByTable[productCandidateTable] =
      0;
  } else {
    const rows =
      Array.isArray(productRows.data) ? productRows.data : [];
    const keys =
      rows.map(row => row.candidate_key);

    for (const key of keys) {
      if (keys.filter(candidateKey => candidateKey === key).length > 1) {
        duplicates.push(`${productCandidateTable}:${key}`);
      }
    }

    rowsAfterByTable[productCandidateTable] =
      rows.length;
  }

  for (const tableName of childTables) {
    const idempotencyKeys =
      writePlan.dedupeKeys.map(dedupeKey => {
        if (tableName === "ebay_candidate_scores") {
          return `${dedupeKey}:score`;
        }

        if (tableName === "ebay_candidate_validations") {
          return `${dedupeKey}:validation`;
        }

        return `${dedupeKey}:profit`;
      });
    const { data, error } =
      await client
        .from(tableName)
        .select("candidate_id,idempotency_key")
        .in("idempotency_key", idempotencyKeys);

    if (error) {
      errors.push(
        sanitizeSupabaseError(
          tableName,
          "post-write verification select by idempotency_key",
          error,
          ["candidate_id", "idempotency_key"],
        ),
      );
      rowsAfterByTable[tableName] =
        0;
      continue;
    }

    const rows =
      Array.isArray(data) ? data : [];
    const keys =
      rows.map(row => row.idempotency_key);

    for (const key of keys) {
      if (keys.filter(candidateKey => candidateKey === key).length > 1) {
        duplicates.push(`${tableName}:${key}`);
      }
    }

    for (const row of rows) {
      if (!Object.values(candidateIdsByKey).includes(row.candidate_id)) {
        errors.push(`${tableName}:${row.idempotency_key}: candidate_id mismatch`);
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
    buildRealSchemaRowsByTable(
      pipeline.writePlan,
      preflight.availableColumnsByTable,
    );
  executeSummary.warnings.push(...preparedRows.warnings);

  const productWrite =
    await writeProductCandidateRows(
      client,
      preparedRows.rowsByTable[productCandidateTable] ?? [],
    );
  executeSummary.duplicatesDetected =
    productWrite.duplicates;
  executeSummary.conflictsDetected =
    productWrite.conflicts;
  executeSummary.errors.push(...productWrite.errors);
  executeSummary.rowsBeforeByTable =
    {
      [productCandidateTable]:
        productWrite.rowsBefore,
    };

  if (
    productWrite.errors.length > 0 ||
    productWrite.duplicates.length > 0 ||
    productWrite.conflicts.length > 0
  ) {
    executeSummary.errors.push("candidate base write failed; child writes skipped");
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const resolvedChildRows =
    resolveChildCandidateIds(
      preparedRows.rowsByTable,
      productWrite.candidateIdsByKey,
    );

  if (resolvedChildRows.errors.length > 0) {
    executeSummary.errors.push(...resolvedChildRows.errors);
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const childWrite =
    await writeChildRows(
      client,
      resolvedChildRows.rowsByTable,
    );
  executeSummary.errors.push(...childWrite.errors);
  executeSummary.duplicatesDetected.push(...childWrite.duplicates);
  executeSummary.conflictsDetected.push(...childWrite.conflicts);
  executeSummary.operationsWrittenOrUpserted =
    productWrite.written +
    Object.values(childWrite.writtenByTable).reduce((sum, count) => sum + count, 0);
  executeSummary.candidatesWrittenOrUpserted =
    productWrite.written;
  executeSummary.rowsBeforeByTable =
    {
      ...executeSummary.rowsBeforeByTable,
      ...Object.fromEntries(childTables.map(tableName => [tableName, 0])),
    };

  if (
    childWrite.errors.length > 0 ||
    childWrite.duplicates.length > 0 ||
    childWrite.conflicts.length > 0
  ) {
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const verification =
    await verifyPostWrite(
      client,
      pipeline.writePlan,
      productWrite.candidateIdsByKey,
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
