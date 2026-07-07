import { readFileSync } from "node:fs";

import {
  buildBenchmarkDataModel,
  summarizeBenchmarkDataModel,
} from "../lib/ebay/luna-portex-benchmark-data-model.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const soldPriceSignals =
  readJsonFixture("./fixtures/luna-portex-sold-price-intelligence-sample-v1.json");
const candidateRows =
  soldPriceSignals.map(signal => signal.candidateSnapshot);
const benchmarkModel =
  buildBenchmarkDataModel(candidateRows, soldPriceSignals);
const summary =
  summarizeBenchmarkDataModel(benchmarkModel);

console.log(
  JSON.stringify(
    {
      summary,
    },
    null,
    2,
  ),
);
