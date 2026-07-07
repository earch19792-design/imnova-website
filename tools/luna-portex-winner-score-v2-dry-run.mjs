import { readFileSync } from "node:fs";

import {
  buildBenchmarkDataModel,
} from "../lib/ebay/luna-portex-benchmark-data-model.ts";
import {
  buildWinnerScoreV2Model,
  summarizeWinnerScoreV2Model,
} from "../lib/ebay/luna-portex-winner-score-v2.ts";

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
const winnerScoreModel =
  buildWinnerScoreV2Model(benchmarkModel.models);
const summary =
  summarizeWinnerScoreV2Model(winnerScoreModel);

console.log(
  JSON.stringify(
    {
      summary,
    },
    null,
    2,
  ),
);
