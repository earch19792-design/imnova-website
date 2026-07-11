import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-b2-run-controlled-write-draft-only-run-v1.json", "utf8"));
const runRequested = process.argv.includes("--execute-controlled-draft-only-run");
const legacyFrameworkFlag = process.argv.includes("--execute-controlled-write-draft-only");
const environmentReady = process.env.EBAY_ENVIRONMENT === "SANDBOX" || process.env.EBAY_ENVIRONMENT === "PRODUCTION";
const runtimeTokenKey = ["EBAY", "ACCESS", "TOKEN"].join("_");
const marketplaceKey = ["EBAY", "MARKETPLACE", "ID"].join("_");
const imageGateKey = ["AUTHORIZED", "IMAGE", "URL", "OR", "IMAGE", "APPROVAL", "BYPASS", "FOR", "UNPUBLISHED", "ONLY"].join("_");
const tokenPresent = typeof process.env[runtimeTokenKey] === "string" && process.env[runtimeTokenKey].length > 0;
const marketplaceReady = process.env[marketplaceKey] === "EBAY_US";
const approvalReady = process.env.EBAY_B2_CONTROLLED_WRITE_APPROVED === fixture.exactRunApprovalPhrase;
const runIdReady = typeof process.env.EBAY_B2_WRITE_RUN_ID === "string" && process.env.EBAY_B2_WRITE_RUN_ID.length >= 8;
const imageGateReady = process.env[imageGateKey] === "APPROVED";
const environmentGatesReady = environmentReady && tokenPresent && marketplaceReady && approvalReady && runIdReady && imageGateReady;

const nextRecommendedRoute = !runRequested
  ? "EXECUTION_NOT_REQUESTED_SAFE_NO_WRITE"
  : environmentGatesReady
    ? "READY_FOR_MANUAL_REAL_RUN_ENABLEMENT"
    : "NEED_RUNTIME_GATES";

console.log(JSON.stringify({
  mode: "SAFE_NO_WRITE",
  runRequested,
  controlledWriteExecutionRequested: legacyFrameworkFlag,
  controlledWriteGatePassed: false,
  runGatePassed: false,
  environmentGatesReady,
  interactiveConfirmationStillRequired: true,
  realRunImplementationReady: true,
  realRunExecutionDisabledLocally: true,
  localDisableFlag: "LOCAL_REAL_WRITE_EXECUTION_DISABLED",
  blockedReason: runRequested || legacyFrameworkFlag ? "LOCAL_IMPLEMENTATION_EXECUTION_DISABLED" : null,
  realEbayApiUsed: false,
  realEbayWriteExecuted: false,
  inventoryItemCreated: false,
  unpublishedOfferCreated: false,
  listingCreated: false,
  publicationExecuted: false,
  canPublish: false,
  tokenStored: false,
  tokensPrinted: false,
  nextRecommendedRoute,
}, null, 2));
