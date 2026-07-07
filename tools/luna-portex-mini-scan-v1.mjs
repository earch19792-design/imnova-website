import { existsSync, readFileSync } from "node:fs";

import {
  buildLunaPortexAutomaticScanFoundation,
  buildLunaPortexMiniScanCandidateRows,
  buildLunaPortexMiniScanRun,
  summarizeLunaPortexMiniScan,
  validateLunaPortexMiniScanCandidateRow,
} from "../lib/ebay/luna-portex-mini-scan-foundation.ts";

const executeFlag =
  "--execute-approved-staging-mini-scan";
const inputFileFlag =
  "--input-file";
const approvalValue =
  "APPROVE_LOOP_142_FIRST_REAL_MINI_SCAN";
const productCandidateTable =
  "ebay_product_candidates";
const requiredProductCandidateColumns = [
  "id",
  "candidate_key",
  "supplier_variant_id",
  "title",
  "source_payload",
  "normalized_payload",
  "state",
  "needs_data",
  "blocked_reason",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isExecuteMode() {
  return process.argv.includes(executeFlag);
}

function getInputFileFromArgs() {
  const flagIndex =
    process.argv.indexOf(inputFileFlag);

  if (flagIndex >= 0 && typeof process.argv[flagIndex + 1] === "string") {
    return process.argv[flagIndex + 1];
  }

  return null;
}

function loadInputItems() {
  const inputPath =
    getInputFileFromArgs();

  if (inputPath !== null) {
    return {
      inputPath,
      inputItems:
        readJson(inputPath),
      inputSource:
        "local-input-file",
      realInputProvided:
        true,
    };
  }

  const fixturePath =
    new URL("./fixtures/luna-portex-mini-scan-sanitized-input-v1.json", import.meta.url);

  return {
    inputPath:
      fixturePath.pathname,
    inputItems:
      readJson(fixturePath),
    inputSource:
      "sanitized-fixture",
    realInputProvided:
      false,
  };
}

function buildDryRunPipeline() {
  const input =
    loadInputItems();
  const scanRun =
    buildLunaPortexMiniScanRun(
      Array.isArray(input.inputItems) ? input.inputItems : [],
      {
        inputSource:
          input.inputSource,
        maxProducts:
          10,
      },
    );
  const candidateRows =
    buildLunaPortexMiniScanCandidateRows(scanRun);
  const automaticScanFoundation =
    buildLunaPortexAutomaticScanFoundation(scanRun);

  return {
    ...input,
    scanRun:
      {
        ...scanRun,
        candidateRows,
        automaticScanFoundation,
      },
    candidateRows,
    automaticScanFoundation,
  };
}

function readExecuteConfig() {
  const env =
    process.env;
  const missingRequiredEnvVars = [];

  if (env.EBAY_PRO_TARGET_ENV !== "staging") {
    missingRequiredEnvVars.push("EBAY_PRO_TARGET_ENV=staging");
  }

  if (env.LUNA_PORTEX_MINI_SCAN_APPROVED !== approvalValue) {
    missingRequiredEnvVars.push("LUNA_PORTEX_MINI_SCAN_APPROVED");
  }

  if (!env.LUNA_PORTEX_MINI_SCAN_INPUT) {
    missingRequiredEnvVars.push("LUNA_PORTEX_MINI_SCAN_INPUT");
  }

  if (!env.SUPABASE_STAGING_URL) {
    missingRequiredEnvVars.push("SUPABASE_STAGING_URL");
  }

  if (!env.SUPABASE_STAGING_SERVICE_ROLE_KEY) {
    missingRequiredEnvVars.push("SUPABASE_STAGING_SERVICE_ROLE_KEY");
  }

  if (!env.EBAY_PRO_STAGING_PROJECT_REF) {
    missingRequiredEnvVars.push("EBAY_PRO_STAGING_PROJECT_REF");
  }

  return {
    targetEnv:
      env.EBAY_PRO_TARGET_ENV,
    approval:
      env.LUNA_PORTEX_MINI_SCAN_APPROVED,
    inputPath:
      env.LUNA_PORTEX_MINI_SCAN_INPUT,
    supabaseStagingUrl:
      env.SUPABASE_STAGING_URL,
    supabaseStagingServiceRoleKey:
      env.SUPABASE_STAGING_SERVICE_ROLE_KEY,
    stagingProjectRef:
      env.EBAY_PRO_STAGING_PROJECT_REF,
    missingRequiredEnvVars,
  };
}

function isProductionMarkedUrl(url) {
  return typeof url !== "string" ||
    url.toLowerCase().includes("production") ||
    url.toLowerCase().includes("prod");
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

async function preflightProductCandidateSchema(client) {
  const { error } =
    await client
      .from(productCandidateTable)
      .select(requiredProductCandidateColumns.join(","), {
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
      errors:
        [
          sanitizeSupabaseError(
            productCandidateTable,
            "preflight select",
            error,
            requiredProductCandidateColumns,
          ),
        ],
    };
  }

  return {
    compatible:
      true,
    errors:
      [],
  };
}

async function writeCandidateRows(client, candidateRows) {
  const rowsBeforeByKey =
    {};
  const rowsAfterByKey =
    {};
  const duplicatesDetected =
    [];
  const conflictsDetected =
    [];
  const errors =
    [];
  let candidatesWrittenOrUpdated =
    0;

  for (const row of candidateRows) {
    const validation =
      validateLunaPortexMiniScanCandidateRow(row);

    if (!validation.valid) {
      errors.push(...validation.errors);
      continue;
    }

    const existing =
      await client
        .from(productCandidateTable)
        .select("id,candidate_key")
        .eq("candidate_key", row.candidate_key);

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
    rowsBeforeByKey[row.candidate_key] =
      existingRows.length;

    if (existingRows.length > 1) {
      duplicatesDetected.push(`${productCandidateTable}:${row.candidate_key}`);
      conflictsDetected.push(`${productCandidateTable}:${row.candidate_key}: duplicated candidate_key`);
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

      candidatesWrittenOrUpdated +=
        1;
      rowsAfterByKey[row.candidate_key] =
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

    candidatesWrittenOrUpdated +=
      1;
    rowsAfterByKey[row.candidate_key] =
      1;
  }

  return {
    candidatesWrittenOrUpdated,
    rowsBeforeByKey,
    rowsAfterByKey,
    duplicatesDetected,
    conflictsDetected,
    errors,
  };
}

async function verifyPostWrite(client, candidateRows) {
  const candidateKeys =
    candidateRows.map(row => row.candidate_key);
  const { data, error } =
    await client
      .from(productCandidateTable)
      .select("id,candidate_key")
      .in("candidate_key", candidateKeys);

  if (error) {
    return {
      rowsAfter:
        0,
      duplicatesDetected:
        [],
      conflictsDetected:
        [],
      postWriteVerificationPassed:
        false,
      errors:
        [
          sanitizeSupabaseError(
            productCandidateTable,
            "post-write verification select",
            error,
            ["id", "candidate_key"],
          ),
        ],
    };
  }

  const rows =
    Array.isArray(data) ? data : [];
  const duplicatesDetected =
    [];
  const conflictsDetected =
    [];

  for (const key of candidateKeys) {
    const count =
      rows.filter(row => row.candidate_key === key).length;

    if (count > 1) {
      duplicatesDetected.push(`${productCandidateTable}:${key}`);
    }

    if (count === 0) {
      conflictsDetected.push(`${productCandidateTable}:${key}: missing after write`);
    }
  }

  return {
    rowsAfter:
      rows.length,
    duplicatesDetected,
    conflictsDetected,
    postWriteVerificationPassed:
      rows.length === candidateRows.length &&
      duplicatesDetected.length === 0 &&
      conflictsDetected.length === 0,
    errors:
      [],
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
    realMiniScanExecuted:
      false,
    candidatesWrittenOrUpdated:
      0,
    rowsBefore:
      {},
    rowsAfter:
      {},
    duplicatesDetected:
      [],
    conflictsDetected:
      [],
    postWriteVerificationPassed:
      false,
    missingRequiredEnvVars:
      config.missingRequiredEnvVars,
    errors:
      [],
    semaphore:
      "YELLOW",
  };

  if (config.missingRequiredEnvVars.length > 0) {
    executeSummary.errors.push("execute mode missing required Staging env vars or approval flags");
    return executeSummary;
  }

  if (!existsSync(config.inputPath)) {
    executeSummary.errors.push("LUNA_PORTEX_MINI_SCAN_INPUT file missing");
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
    await preflightProductCandidateSchema(client);

  if (!preflight.compatible) {
    executeSummary.errors.push(...preflight.errors);
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const writeResult =
    await writeCandidateRows(
      client,
      pipeline.candidateRows,
    );

  executeSummary.candidatesWrittenOrUpdated =
    writeResult.candidatesWrittenOrUpdated;
  executeSummary.rowsBefore =
    writeResult.rowsBeforeByKey;
  executeSummary.duplicatesDetected.push(...writeResult.duplicatesDetected);
  executeSummary.conflictsDetected.push(...writeResult.conflictsDetected);
  executeSummary.errors.push(...writeResult.errors);

  if (
    writeResult.errors.length > 0 ||
    writeResult.duplicatesDetected.length > 0 ||
    writeResult.conflictsDetected.length > 0
  ) {
    executeSummary.semaphore =
      "RED";
    return executeSummary;
  }

  const verification =
    await verifyPostWrite(
      client,
      pipeline.candidateRows,
    );

  executeSummary.rowsAfter =
    verification.rowsAfter;
  executeSummary.duplicatesDetected.push(...verification.duplicatesDetected);
  executeSummary.conflictsDetected.push(...verification.conflictsDetected);
  executeSummary.errors.push(...verification.errors);
  executeSummary.postWriteVerificationPassed =
    verification.postWriteVerificationPassed;
  executeSummary.realMiniScanExecuted =
    verification.postWriteVerificationPassed;
  executeSummary.stagingWriteExecuted =
    verification.postWriteVerificationPassed;
  executeSummary.semaphore =
    verification.postWriteVerificationPassed ? "GREEN" : "RED";

  return executeSummary;
}

const pipeline =
  buildDryRunPipeline();
const summary =
  summarizeLunaPortexMiniScan(pipeline.scanRun);

if (!isExecuteMode()) {
  console.log(
    JSON.stringify(
      {
        summary:
          {
            mode:
              getInputFileFromArgs() === null ? "dry-run" : "real-input-dry-run",
            ...summary,
          },
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
          {
            mode:
              "execute",
            ...summary,
          },
        executeSummary,
      },
      null,
      2,
    ),
  );
}
