import { readFileSync } from "node:fs";

import {
  buildEbaySellerReadOnlyOauthDataAuditFromFixture,
  summarizeEbaySellerReadOnlyOauthDataAudit,
} from "../lib/ebay/ebay-seller-readonly-oauth-data-audit.ts";

const fixture =
  JSON.parse(
    readFileSync(
      "tools/fixtures/ebay-seller-readonly-oauth-data-audit-v1.json",
      "utf8",
    ),
  );

const report =
  buildEbaySellerReadOnlyOauthDataAuditFromFixture(fixture);

console.log(JSON.stringify(summarizeEbaySellerReadOnlyOauthDataAudit(report), null, 2));
