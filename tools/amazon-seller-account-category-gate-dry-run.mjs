import { readFileSync } from "node:fs";

import {
  buildAmazonSellerAccountCategoryGateQueue,
  summarizeAmazonSellerAccountCategoryGate,
} from "../lib/marketplace/amazon-seller-account-category-gate.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/amazon-seller-account-category-gate-v1.json");
const queue =
  buildAmazonSellerAccountCategoryGateQueue(fixture.sellerAccounts, fixture.products);
const summary =
  summarizeAmazonSellerAccountCategoryGate(queue);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
