import { readFileSync } from "node:fs";
import { buildEbayB2RunControlledWriteDraftOnlyRunReport, summarizeEbayB2RunControlledWriteDraftOnlyRun } from "../lib/ebay/ebay-b2-run-controlled-write-draft-only-run.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-b2-run-controlled-write-draft-only-run-v1.json", "utf8"));
const args = process.argv.slice(2);
const approved = args.includes("--simulate-run-approved");
const simulation = approved ? {
  runRequested: true,
  runApprovalPhrase: fixture.exactRunApprovalPhrase,
  environment: "SANDBOX",
  accessTokenProvidedAtRuntime: !args.includes("--simulate-missing-token"),
  marketplaceId: "EBAY_US",
  writeRunId: "SANITIZED-DRY-RUN-001",
  authorizedImageOrBypass: true,
  interactiveConfirmation: fixture.exactInteractiveConfirmation,
  categoryIdConfirmed: true,
  fulfillmentPolicyConfirmed: true,
  returnPolicyConfirmed: true,
  paymentPolicyConfirmed: true,
  finalStockConfirmed: true,
  finalPriceConfirmed: true,
  finalImageApprovedOrUnpublishedOnlyBypassConfirmed: true,
} : { forbiddenPublishRequested: args.includes("--simulate-forbidden-publish-request") };

const report = buildEbayB2RunControlledWriteDraftOnlyRunReport(fixture, simulation);
console.log(JSON.stringify(summarizeEbayB2RunControlledWriteDraftOnlyRun(report), null, 2));
