import { readFileSync } from "node:fs";

import {
  buildAmazonRestrictionGateQueue,
  summarizeAmazonRestrictionGateQueue,
} from "../lib/marketplace/amazon-restriction-category-brand-gtin-gate.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/amazon-restriction-category-brand-gtin-gate-v1.json");
const queue =
  buildAmazonRestrictionGateQueue(fixture);
const summary =
  summarizeAmazonRestrictionGateQueue(queue);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
