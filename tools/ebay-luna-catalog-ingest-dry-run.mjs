import { readFileSync } from "node:fs";
import { buildEbayLunaCatalogIngestReport, summarizeEbayLunaCatalogIngest } from "../lib/ebay/ebay-luna-catalog-ingest.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-luna-catalog-ingest-v1.json", "utf8"));
const catalog = JSON.parse(readFileSync("tools/fixtures/luna-portex-catalog-sample-v1.json", "utf8"));
console.log(JSON.stringify(summarizeEbayLunaCatalogIngest(buildEbayLunaCatalogIngestReport(fixture, catalog)), null, 2));
