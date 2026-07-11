import { readFileSync } from "node:fs";
import { buildEbayB2RunPreflightMobileApprovedReport, summarizeEbayB2RunPreflightMobileApproved } from "../lib/ebay/ebay-b2-run-preflight-mobile-approved.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-b2-run-preflight-mobile-approved-v1.json", "utf8"));
const report = buildEbayB2RunPreflightMobileApprovedReport(fixture);
console.log(JSON.stringify(summarizeEbayB2RunPreflightMobileApproved(report), null, 2));
