import { readFileSync } from "node:fs";
import { buildEbayRuntimeReadonlyCheckReport } from "../lib/ebay/ebay-runtime-readonly-check-run.ts";
const fixture=JSON.parse(readFileSync("tools/fixtures/ebay-runtime-readonly-check-v1.json","utf8"));
console.log(JSON.stringify(buildEbayRuntimeReadonlyCheckReport(fixture),null,2));
