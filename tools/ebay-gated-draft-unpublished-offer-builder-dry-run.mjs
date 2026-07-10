import { readFileSync } from "node:fs";

import {
  buildEbayGatedDraftUnpublishedOfferBuilderReport,
  summarizeEbayGatedDraftUnpublishedOfferBuilder,
} from "../lib/ebay/ebay-gated-draft-unpublished-offer-builder.ts";

const fixture = JSON.parse(
  readFileSync(
    "tools/fixtures/ebay-gated-draft-unpublished-offer-builder-v1.json",
    "utf8",
  ),
);

const report = buildEbayGatedDraftUnpublishedOfferBuilderReport(fixture);

console.log(JSON.stringify(summarizeEbayGatedDraftUnpublishedOfferBuilder(report), null, 2));
