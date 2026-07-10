import { readFileSync } from "node:fs";

import {
  buildEbaySellerAccountReadinessFromFixture,
  summarizeEbaySellerAccountReadiness,
} from "../lib/ebay/ebay-seller-account-readiness.ts";

const fixture =
  JSON.parse(
    readFileSync(
      "tools/fixtures/ebay-seller-account-readiness-v1.json",
      "utf8",
    ),
  );

const report =
  buildEbaySellerAccountReadinessFromFixture(fixture);

console.log(JSON.stringify(summarizeEbaySellerAccountReadiness(report), null, 2));
