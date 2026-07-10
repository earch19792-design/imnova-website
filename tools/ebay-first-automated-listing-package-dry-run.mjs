import { readFileSync } from "node:fs";

import {
  buildEbayFirstAutomatedListingPackageReport,
  summarizeEbayFirstAutomatedListingPackage,
} from "../lib/ebay/ebay-first-automated-listing-package.ts";

const fixture = JSON.parse(
  readFileSync(
    "tools/fixtures/ebay-first-automated-listing-package-v1.json",
    "utf8",
  ),
);

const report = buildEbayFirstAutomatedListingPackageReport(fixture);

console.log(JSON.stringify(summarizeEbayFirstAutomatedListingPackage(report), null, 2));
