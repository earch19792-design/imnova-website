import { readFileSync } from "node:fs";

import {
  buildEbayWinningListingDataResolverReport,
  summarizeEbayWinningListingDataResolver,
} from "../lib/ebay/ebay-winning-listing-data-resolver.ts";

const fixture = JSON.parse(
  readFileSync("tools/fixtures/ebay-winning-listing-data-resolver-v1.json", "utf8"),
);

const report = buildEbayWinningListingDataResolverReport(fixture);

console.log(JSON.stringify(summarizeEbayWinningListingDataResolver(report), null, 2));
