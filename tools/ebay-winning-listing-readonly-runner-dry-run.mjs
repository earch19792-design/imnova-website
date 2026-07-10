import { readFileSync } from "node:fs";

import {
  buildEbayReadonlyMarketResolverReport,
  summarizeEbayWinningListingReadonlyRunner,
} from "../lib/ebay/ebay-winning-listing-readonly-runner.ts";

const fixture = JSON.parse(
  readFileSync("tools/fixtures/ebay-winning-listing-readonly-runner-v1.json", "utf8"),
);

const report = buildEbayReadonlyMarketResolverReport(fixture);

console.log(JSON.stringify(summarizeEbayWinningListingReadonlyRunner(report, "dry-run"), null, 2));
