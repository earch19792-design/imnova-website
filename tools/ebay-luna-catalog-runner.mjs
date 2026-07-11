import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  buildLocalCatalogFileGate,
  buildRealLunaCatalogIngestReport,
  detectCatalogFileType,
  parseLocalLunaCatalogCsv,
  parseLocalLunaCatalogJson,
  parseLocalLunaCatalogXlsxIfAvailable,
  sanitizeLunaCatalogRowsForReport,
  summarizeEbayLunaCatalogRunner,
} from "../lib/ebay/ebay-luna-catalog-runner.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-luna-catalog-runner-v1.json", "utf8"));
const args = process.argv.slice(2);
const execute = args.includes("--execute-local-catalog-ingest");
const pathIndex = args.indexOf("--catalog-file");
const catalogPath = pathIndex >= 0 ? args[pathIndex + 1] : undefined;

function safeDefault(blockedReason) {
  return {
    mode: "safe-default",
    blockedReason: blockedReason ?? null,
    realCatalogFileUsed: false,
    catalogReadExecuted: false,
    canProceedToB2Run: false,
    canPublish: false,
    nextRecommendedRoute: "NEED_REAL_LUNA_CATALOG_FILE",
    filesystemWriteExecuted: false,
    realCatalogCommitted: false,
    ebayApiUsed: false,
    oauthUsed: false,
    draftCreated: false,
    listingCreated: false,
    offerCreated: false,
    publicationExecuted: false,
    instructions: [
      "Pass --catalog-file with a local CSV, JSON, or XLSX path and --execute-local-catalog-ingest.",
      "Set LUNA_CATALOG_RUN_APPROVED locally without printing its value.",
      "Enter LOCAL_LUNA_CATALOG_INGEST_APPROVED exactly when prompted.",
      "The real catalog remains local, read-only, untracked, and is never printed in full.",
    ],
  };
}

async function loadRows(filePath, fileType) {
  if (fileType === "CSV") return { rows: parseLocalLunaCatalogCsv(readFileSync(filePath, "utf8")), error: null };
  if (fileType === "JSON") return { rows: parseLocalLunaCatalogJson(readFileSync(filePath, "utf8")), error: null };
  if (fileType === "XLSX") {
    const bytes = readFileSync(filePath);
    return parseLocalLunaCatalogXlsxIfAvailable(bytes, async () => import("xlsx"));
  }
  return { rows: [], error: "UNSUPPORTED_CATALOG_FILE_TYPE" };
}

async function main() {
  if (!execute) return safeDefault();
  const approved = process.env.LUNA_CATALOG_RUN_APPROVED === "YES_I_APPROVE_LOCAL_LUNA_CATALOG_INGEST";
  const preGate = buildLocalCatalogFileGate(fixture, { filePath: catalogPath, approved, cliConfirmed: false });
  if (!preGate.filePathProvided) return safeDefault("CATALOG_FILE_PATH_REQUIRED");
  if (!preGate.fileTypeSupported) return safeDefault("UNSUPPORTED_CATALOG_FILE_TYPE");
  if (!approved) return safeDefault("MISSING_OR_INVALID_LOCAL_CATALOG_APPROVAL");

  const terminal = createInterface({ input, output });
  const confirmation = await terminal.question("Type LOCAL_LUNA_CATALOG_INGEST_APPROVED to continue: ");
  terminal.close();
  const gate = buildLocalCatalogFileGate(fixture, { filePath: catalogPath, approved, cliConfirmed: confirmation.trim() === "LOCAL_LUNA_CATALOG_INGEST_APPROVED" });
  if (!gate.gateReady) return safeDefault("EXACT_CLI_CONFIRMATION_REQUIRED");

  try {
    const loaded = await loadRows(catalogPath, detectCatalogFileType(catalogPath));
    if (loaded.error) return { ...safeDefault(loaded.error), catalogFileType: gate.catalogFileType };
    const report = buildRealLunaCatalogIngestReport(fixture, loaded.rows, {
      realCatalogFileUsed: true,
      humanApprovalConfirmed: false,
      catalogFileType: gate.catalogFileType,
    });
    return {
      ...summarizeEbayLunaCatalogRunner(report, "local-real-catalog-read-only"),
      ...sanitizeLunaCatalogRowsForReport(loaded.rows),
      realCatalogFileUsed: true,
      catalogReadExecuted: true,
      catalogPathPrinted: false,
      rawCatalogPrinted: false,
    };
  } catch (error) {
    return { ...safeDefault("LOCAL_CATALOG_READ_OR_PARSE_FAILED"), errorClass: error instanceof Error ? error.name : "Error" };
  }
}

console.log(JSON.stringify(await main(), null, 2));
