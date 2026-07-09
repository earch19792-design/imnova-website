import { readFileSync } from "node:fs";

import {
  buildAmazonAsinDecisionQueue,
  summarizeAmazonAsinDecisionQueue,
} from "../lib/marketplace/amazon-existing-asin-vs-new-asin-decision.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/amazon-existing-asin-vs-new-asin-decision-v1.json");
const queue =
  buildAmazonAsinDecisionQueue(fixture);
const summary =
  summarizeAmazonAsinDecisionQueue(queue);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
