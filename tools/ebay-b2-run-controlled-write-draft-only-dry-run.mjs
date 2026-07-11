import { readFileSync } from "node:fs";
import { buildEbayB2RunControlledWriteDraftOnlyReport, summarizeEbayB2RunControlledWriteDraftOnly } from "../lib/ebay/ebay-b2-run-controlled-write-draft-only.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-b2-run-controlled-write-draft-only-v1.json", "utf8"));
const args = process.argv.slice(2);
const approved = args.includes("--simulate-controlled-write-approved");
const simulation = approved ? {
  controlledWriteExecutionRequested: true,
  runtimeChecksAllPassed: true,
  environmentApproval: fixture.exactEnvApproval.EBAY_B2_CONTROLLED_WRITE_APPROVED,
  interactiveConfirmation: fixture.exactInteractiveConfirmation,
  authorizedImageAsset: true,
  policyRuntimeReady: true,
  categoryRuntimeReady: true,
  stockRuntimeReady: true,
  priceRuntimeReady: true,
} : { forbiddenPublishRequested: args.includes("--simulate-forbidden-publish-request") };

const report = buildEbayB2RunControlledWriteDraftOnlyReport(fixture, simulation);
console.log(JSON.stringify(summarizeEbayB2RunControlledWriteDraftOnly(report), null, 2));
