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
  summarizeStagingExecutionSimulation,
} from "../lib/ebay/luna-portex-staging-write-execution-harness.ts";

const fixturePath =
  new URL("./fixtures/luna-portex-staging-scan-sample-catalog-v1.json", import.meta.url);

const fixture =
  JSON.parse(readFileSync(fixturePath, "utf8"));

const scanResult =
  runLunaPortexStagingScanDryRun({
    catalog:
      fixture.items,
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

const simulation =
  simulateStagingWriteExecution(
    executionPlan,
    {
      approvalGranted:
        false,
    },
  );

console.log(
  JSON.stringify(
    {
      summary:
        summarizeStagingExecutionSimulation(simulation),
      executionPlan:
        {
          status:
            executionPlan.status,
          mode:
            executionPlan.mode,
          operations:
            executionPlan.operations,
        },
    },
    null,
    2,
  ),
);
