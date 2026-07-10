import { readFileSync } from "node:fs";

import {
  buildEbayDeveloperSellerLinkReadinessFromFixture,
  summarizeEbayDeveloperSellerLinkReadiness,
} from "../lib/ebay/ebay-developer-seller-link-readiness.ts";

const fixture =
  JSON.parse(
    readFileSync(
      "tools/fixtures/ebay-developer-seller-link-readiness-v1.json",
      "utf8",
    ),
  );

const report =
  buildEbayDeveloperSellerLinkReadinessFromFixture(fixture);

console.log(JSON.stringify(summarizeEbayDeveloperSellerLinkReadiness(report), null, 2));
