import { readFileSync } from "node:fs";
import { buildEbayLunaScanMatchConfirmationReport, summarizeEbayLunaScanMatchConfirmation } from "../lib/ebay/ebay-luna-scan-match-confirmation.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-luna-scan-match-confirmation-v1.json", "utf8"));
const args = process.argv.slice(2);
const index = args.indexOf("--simulate-human-confirmation");
const simulatedConfirmation = index >= 0 ? args[index + 1] : undefined;
const report = buildEbayLunaScanMatchConfirmationReport(fixture, simulatedConfirmation);
console.log(JSON.stringify(summarizeEbayLunaScanMatchConfirmation(report), null, 2));
