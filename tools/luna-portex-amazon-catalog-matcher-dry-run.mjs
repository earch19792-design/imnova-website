import { readFileSync } from "node:fs";

import {
  buildLunaPortexAmazonCatalogMatchQueue,
  summarizeLunaPortexAmazonCatalogMatcherQueue,
} from "../lib/marketplace/luna-portex-amazon-catalog-matcher.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/luna-portex-amazon-catalog-matcher-v1.json");
const queue =
  buildLunaPortexAmazonCatalogMatchQueue(fixture);
const summary =
  summarizeLunaPortexAmazonCatalogMatcherQueue(queue);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
