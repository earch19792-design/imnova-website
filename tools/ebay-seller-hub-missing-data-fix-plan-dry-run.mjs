import { readFileSync } from "node:fs";

import {
  buildEbaySellerHubMissingDataFixPlanFromFixture,
  summarizeEbaySellerHubMissingDataFixPlan,
} from "../lib/ebay/ebay-seller-hub-missing-data-fix-plan.ts";

const fixture =
  JSON.parse(
    readFileSync(
      "tools/fixtures/ebay-seller-hub-missing-data-fix-plan-v1.json",
      "utf8",
    ),
  );

const report =
  buildEbaySellerHubMissingDataFixPlanFromFixture(fixture);

console.log(JSON.stringify(summarizeEbaySellerHubMissingDataFixPlan(report), null, 2));
