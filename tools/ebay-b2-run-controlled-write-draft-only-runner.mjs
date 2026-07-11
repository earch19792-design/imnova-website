import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-b2-run-controlled-write-draft-only-v1.json", "utf8"));
const executeFlagPresent = process.argv.includes("--execute-controlled-write-draft-only");
const permittedEnvironment = process.env.EBAY_ENVIRONMENT === "PRODUCTION" || process.env.EBAY_ENVIRONMENT === "SANDBOX";
const approvalPresent = process.env.EBAY_B2_CONTROLLED_WRITE_APPROVED === fixture.exactEnvApproval.EBAY_B2_CONTROLLED_WRITE_APPROVED;
const runIdPresent = typeof process.env.EBAY_B2_WRITE_RUN_ID === "string" && process.env.EBAY_B2_WRITE_RUN_ID.length > 0;

const output = {
  mode: "SAFE_NO_WRITE",
  controlledWriteExecutionRequested: executeFlagPresent,
  controlledWriteGatePassed: false,
  environmentGateObserved: executeFlagPresent && permittedEnvironment && approvalPresent && runIdPresent,
  blockedReason: executeFlagPresent ? "LOCAL_IMPLEMENTATION_EXECUTION_DISABLED" : null,
  realEbayApiUsedInImplementation: false,
  realEbayWriteExecuted: false,
  draftCreatedInImplementation: false,
  inventoryItemCreatedInImplementation: false,
  unpublishedOfferCreatedInImplementation: false,
  listingCreated: false,
  publicationExecuted: false,
  canPublish: false,
  nextRecommendedRoute: "EXECUTION_NOT_REQUESTED_SAFE_NO_WRITE",
};

console.log(JSON.stringify(output, null, 2));
