import { readFileSync } from "node:fs";
import { buildEbayLunaTop50DemandRankerReport, summarizeEbayLunaTop50DemandRanker } from "../lib/ebay/ebay-luna-top50-ebay-demand-ranker.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-luna-top50-ebay-demand-ranker-v1.json", "utf8"));
const args = process.argv.slice(2);
const selectionIndex = args.indexOf("--simulate-human-selection");
const simulatedSelection = selectionIndex >= 0 ? args[selectionIndex + 1] : undefined;
const report = buildEbayLunaTop50DemandRankerReport(fixture, simulatedSelection);
console.log(JSON.stringify(summarizeEbayLunaTop50DemandRanker(report), null, 2));
