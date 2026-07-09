import { readFileSync } from "node:fs";

import {
  buildAmazonFeesProfitGuardQueue,
  summarizeAmazonFeesProfitGuardQueue,
} from "../lib/marketplace/amazon-fees-profit-guard-roi.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/amazon-fees-profit-guard-roi-v1.json");
const queue =
  buildAmazonFeesProfitGuardQueue(fixture);
const summary =
  summarizeAmazonFeesProfitGuardQueue(queue);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
