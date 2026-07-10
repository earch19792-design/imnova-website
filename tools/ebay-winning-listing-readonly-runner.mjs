import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  buildEbayReadonlyMarketResolverReport,
  summarizeEbayWinningListingReadonlyRunner,
} from "../lib/ebay/ebay-winning-listing-readonly-runner.ts";

const EXECUTE_FLAG = "--execute-readonly-market-resolver";
const EXACT_APPROVAL = "READ_ONLY_MARKET_RESOLVER_APPROVED";
const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token";
const READONLY_SEARCH_ENDPOINT = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const READONLY_SCOPE = "https://api.ebay.com/oauth/api_scope";

const fixture = JSON.parse(
  readFileSync("tools/fixtures/ebay-winning-listing-readonly-runner-v1.json", "utf8"),
);

function safeDefaultOutput(extra = {}) {
  return {
    mode: "safe-default",
    realEbayMarketReadExecuted: false,
    ebayReadOnlyApiUsed: false,
    ebayWriteApiUsed: false,
    tokenExchangeExecuted: false,
    tokensStored: false,
    tokensPrinted: false,
    draftCreated: false,
    listingCreated: false,
    offerCreated: false,
    publicationExecuted: false,
    instructions: [
      `Pass ${EXECUTE_FLAG} only for an explicitly approved read-only market resolver run.`,
      "Set the required local environment variables without printing their values.",
      `Enter the exact terminal confirmation ${EXACT_APPROVAL}.`,
      "Only official eBay Browse search GET requests are allowlisted; all marketplace writes remain blocked.",
    ],
    ...extra,
  };
}

function validateEnvironment() {
  const required = {
    EBAY_OAUTH_ENV: "PRODUCTION",
    EBAY_CLIENT_ID: "SET",
    EBAY_CLIENT_SECRET: "SET",
    EBAY_REDIRECT_URI: "SET",
    EBAY_MARKETPLACE_ID: "EBAY_US",
    EBAY_B2A_RUN_APPROVED: "YES_I_APPROVE_EBAY_READ_ONLY_MARKET_RESOLVER",
  };
  const missing = [];
  for (const [name, expected] of Object.entries(required)) {
    const value = process.env[name];
    const valid = expected === "SET" ? typeof value === "string" && value.length > 0 : value === expected;
    if (!valid) missing.push(name);
  }
  return missing;
}

function assertReadOnlySearchRequest(url, method) {
  const parsed = new URL(url);
  const allowed =
    method === "GET" &&
    parsed.origin === "https://api.ebay.com" &&
    parsed.pathname === "/buy/browse/v1/item_summary/search";
  if (!allowed) throw new Error("BLOCKED_NON_ALLOWLISTED_EBAY_ENDPOINT");
}

async function requestApplicationToken() {
  const credentials = btoa(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  );
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: READONLY_SCOPE }),
  });
  if (!response.ok) throw new Error(`OAUTH_TOKEN_REQUEST_FAILED_${response.status}`);
  const body = await response.json();
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new Error("OAUTH_TOKEN_RESPONSE_MISSING_ACCESS_TOKEN");
  return accessToken;
}

async function searchOfficialBrowseApi(query, accessToken) {
  const url = new URL(READONLY_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE},conditions:{NEW}");
  url.searchParams.set("fieldgroups", "MATCHING_ITEMS,CATEGORY_REFINEMENTS,ASPECT_REFINEMENTS");
  assertReadOnlySearchRequest(url.toString(), "GET");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DUS%2Czip%3D33487",
    },
  });
  if (!response.ok) throw new Error(`EBAY_BROWSE_SEARCH_FAILED_${response.status}`);
  const body = await response.json();
  return Array.isArray(body.itemSummaries) ? body.itemSummaries : [];
}

async function executeReadonlyResolver() {
  const missing = validateEnvironment();
  if (missing.length) {
    console.log(JSON.stringify(safeDefaultOutput({ blockedReason: "MISSING_OR_INVALID_APPROVAL_ENVIRONMENT", missingVariableNames: missing }), null, 2));
    return;
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  const confirmation = await terminal.question(`Type ${EXACT_APPROVAL} to continue: `);
  terminal.close();
  if (confirmation !== EXACT_APPROVAL) {
    console.log(JSON.stringify(safeDefaultOutput({ blockedReason: "EXACT_CLI_CONFIRMATION_NOT_PROVIDED" }), null, 2));
    return;
  }

  let accessToken = "";
  try {
    accessToken = await requestApplicationToken();
    const batches = [];
    for (const query of fixture.queryPlan) {
      batches.push(await searchOfficialBrowseApi(query, accessToken));
    }
    const byId = new Map();
    for (const item of batches.flat()) {
      if (item && typeof item.itemId === "string") byId.set(item.itemId, item);
    }
    const comparables = [...byId.values()].slice(0, 40);
    const report = buildEbayReadonlyMarketResolverReport(fixture, {
      source: "OFFICIAL_EBAY_BROWSE_API_READ_ONLY",
      realEbayWinningDataResolved: false,
      realEbayComparableDataResolved: comparables.length >= 2,
      soldDataResolved: false,
      soldDataUnavailableReason: "unavailable_or_scope_missing",
      comparables,
      realLunaMatchConfirmed: false,
      lunaPackQuantityConfirmed: false,
      lunaUnitCost: 0,
      estimatedPackShippingCost: 0,
      humanApprovalConfirmed: false,
      accountRiskKnown: false,
    });
    console.log(JSON.stringify({
      ...summarizeEbayWinningListingReadonlyRunner(report, "gated-readonly-executed"),
      realEbayMarketReadExecuted: true,
      tokensStored: false,
      tokensPrinted: false,
    }, null, 2));
  } catch (error) {
    const safeCode = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "READONLY_MARKET_RESOLVER_FAILED";
    console.log(JSON.stringify(safeDefaultOutput({ blockedReason: safeCode }), null, 2));
  } finally {
    accessToken = "";
  }
}

if (!process.argv.includes(EXECUTE_FLAG)) {
  console.log(JSON.stringify(safeDefaultOutput(), null, 2));
} else {
  await executeReadonlyResolver();
}
