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
  summarizeStagingSchemaCompatibilityReport,
} from "../lib/ebay/luna-portex-staging-schema-compatibility.ts";

const catalogPath =
  new URL("./fixtures/luna-portex-staging-scan-sample-catalog-v1.json", import.meta.url);
const schemaSnapshotPath =
  new URL("./fixtures/luna-portex-staging-schema-snapshot-example-v1.json", import.meta.url);

const catalogFixture =
  JSON.parse(readFileSync(catalogPath, "utf8"));
const schemaSnapshot =
  JSON.parse(readFileSync(schemaSnapshotPath, "utf8"));

const scanResult =
  runLunaPortexStagingScanDryRun({
    catalog:
      catalogFixture.items,
    maxProductsPerDryRun:
      20,
  });

const writePlan =
  buildLunaPortexStagingWritePlan(
    scanResult,
    {
      maxCandidatesPerWritePlan:
        20,
    },
  );

const payloadBundle =
  buildLunaPortexStagingWritePayloads(
    writePlan,
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

const compatibilityReport =
  validatePayloadBundleAgainstStagingSchema(
    payloadBundle,
    schemaSnapshot,
    {
      readOnlySqlPrepared:
        true,
    },
  );

console.log(
  JSON.stringify(
    {
      summary:
        summarizeStagingSchemaCompatibilityReport(
          compatibilityReport,
        ),
      tableReports:
        compatibilityReport.tableReports,
    },
    null,
    2,
  ),
);
