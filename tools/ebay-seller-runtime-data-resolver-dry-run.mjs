import { readFileSync } from "node:fs";
import { buildEbaySellerRuntimeDataResolverReport, summarizeEbaySellerRuntimeDataResolver } from "../lib/ebay/ebay-seller-runtime-data-resolver.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-seller-runtime-data-resolver-v1.json", "utf8"));
const args = process.argv.slice(2);
const full = args.includes("--simulate-runtime-data-resolved") || args.includes("--simulate-missing-policy") || args.includes("--simulate-missing-image");
const simulation = full ? {
  categoryIdResolved: true,
  fulfillmentPolicyResolved: !args.includes("--simulate-missing-policy"),
  returnPolicyResolved: true,
  paymentPolicyResolved: true,
  finalStockResolved: true,
  finalPriceResolved: true,
  finalImageResolved: !args.includes("--simulate-missing-image"),
  targetEnvironmentResolved: true,
  targetEnvironment: "SANDBOX",
  tokenPresenceChecked: true,
  tokenPresentBooleanOnly: true,
} : args.includes("--simulate-runtime-token-present") ? {
  tokenPresenceChecked: true,
  tokenPresentBooleanOnly: true,
} : {};

const report = buildEbaySellerRuntimeDataResolverReport(fixture, simulation);
console.log(JSON.stringify(summarizeEbaySellerRuntimeDataResolver(report), null, 2));
