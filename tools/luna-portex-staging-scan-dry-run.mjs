import { readFileSync } from "node:fs";

import {
  runLunaPortexStagingScanDryRun,
  summarizeDryRunResult,
} from "../lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";

const fixturePath =
  new URL("./fixtures/luna-portex-staging-scan-sample-catalog-v1.json", import.meta.url);

const fixture =
  JSON.parse(readFileSync(fixturePath, "utf8"));

const result =
  runLunaPortexStagingScanDryRun({
    catalog:
      fixture.items,
    maxProductsPerDryRun:
      20,
  });

console.log(
  JSON.stringify(
    {
      summary:
        summarizeDryRunResult(result),
      candidatePreviews:
        result.candidatePreviews,
    },
    null,
    2,
  ),
);
