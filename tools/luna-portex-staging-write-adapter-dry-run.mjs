import { readFileSync } from "node:fs";

import {
  runLunaPortexStagingScanDryRun,
} from "../lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
import {
  buildLunaPortexStagingWritePlan,
} from "../lib/ebay/luna-portex-staging-write-gate.ts";
import {
  buildLunaPortexStagingWritePayloads,
  summarizeStagingWritePayloads,
} from "../lib/ebay/luna-portex-staging-write-adapter.ts";

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

const payloads =
  buildLunaPortexStagingWritePayloads(
    writePlan,
    {
      maxPayloadCandidates:
        20,
    },
  );

console.log(
  JSON.stringify(
    {
      summary:
        summarizeStagingWritePayloads(payloads),
      payloadsByTable:
        payloads.payloadsByTable,
    },
    null,
    2,
  ),
);
