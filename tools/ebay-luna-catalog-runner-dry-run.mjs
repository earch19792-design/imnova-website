import { readFileSync } from "node:fs";
import { buildRealLunaCatalogIngestReport, summarizeEbayLunaCatalogRunner } from "../lib/ebay/ebay-luna-catalog-runner.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-luna-catalog-runner-v1.json", "utf8"));
const sample = JSON.parse(readFileSync("tools/fixtures/luna-portex-catalog-sample-v1.json", "utf8"));
const report = buildRealLunaCatalogIngestReport(fixture, sample, { realCatalogFileUsed: false, catalogFileType: "JSON" });
console.log(JSON.stringify(summarizeEbayLunaCatalogRunner(report, "dry-run"), null, 2));
