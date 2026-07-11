import { readFileSync } from "node:fs";
import { buildEbayB2RunWriteApprovalRuntimeChecksReport, summarizeEbayB2RunWriteApprovalRuntimeChecks } from "../lib/ebay/ebay-b2-run-write-approval-runtime-checks.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-b2-run-write-approval-runtime-checks-v1.json", "utf8"));
const args = process.argv.slice(2);
const approvalIndex = args.indexOf("--simulate-final-write-approval");
const stockIndex = args.indexOf("--simulate-stock");
const simulation = {
  runtimeChecksPassed: args.includes("--simulate-runtime-checks-passed"),
  finalWriteApprovalPhrase: approvalIndex >= 0 ? args[approvalIndex + 1] : undefined,
  simulatedStock: stockIndex >= 0 ? Number(args[stockIndex + 1]) : undefined,
};
const report = buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture, simulation);
console.log(JSON.stringify(summarizeEbayB2RunWriteApprovalRuntimeChecks(report), null, 2));
