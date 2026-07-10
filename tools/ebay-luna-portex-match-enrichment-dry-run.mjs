import { readFileSync } from "node:fs";
import {
  buildEbayLunaPortexMatchEnrichmentReport,
  summarizeEbayLunaPortexMatchEnrichment,
} from "../lib/ebay/ebay-luna-portex-match-enrichment.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-luna-portex-match-enrichment-v1.json", "utf8"));
const report = buildEbayLunaPortexMatchEnrichmentReport(fixture);
console.log(JSON.stringify(summarizeEbayLunaPortexMatchEnrichment(report), null, 2));
