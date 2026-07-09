import { readFileSync } from "node:fs";

import {
  buildAmazonAssessmentQueue,
  summarizeAmazonAssessmentQueue,
} from "../lib/marketplace/amazon-product-winner-metrics.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/amazon-product-winner-metrics-v1.json");
const queue =
  buildAmazonAssessmentQueue(fixture.products);
const summary =
  summarizeAmazonAssessmentQueue(queue);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
