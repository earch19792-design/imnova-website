import { readFileSync } from "node:fs";

import {
  runLunaPortexStagingScanDryRun,
} from "../lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
import {
  buildLunaPortexStagingWritePlan,
  summarizeStagingWritePlan,
} from "../lib/ebay/luna-portex-staging-write-gate.ts";

const fixturePath =
  new URL("./fixtures/luna-portex-staging-scan-sample-catalog-v1.json", import.meta.url);

const fixture =
  JSON.parse(readFileSync(fixturePath, "utf8"));

const dryRunResult =
  runLunaPortexStagingScanDryRun({
    catalog:
      fixture.items,
    maxProductsPerDryRun:
      20,
  });

const writePlan =
  buildLunaPortexStagingWritePlan(
    dryRunResult,
    {
      maxCandidatesPerWritePlan:
        20,
    },
  );

console.log(
  JSON.stringify(
    {
      summary:
        summarizeStagingWritePlan(writePlan),
      plannedWrites:
        writePlan.plannedWrites,
      blockedCandidates:
        writePlan.blockedCandidates,
    },
    null,
    2,
  ),
);
