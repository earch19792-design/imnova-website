import { readFileSync } from "node:fs";
import { buildMobileWhatsappApprovalCenterReport, summarizeMobileWhatsappApprovalCenter } from "../lib/ebay/ebay-mobile-whatsapp-approval-center.ts";

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-whatsapp-approval-center-v1.json", "utf8"));
const args = process.argv.slice(2);
const commandIndex = args.indexOf("--simulate-command");
const sequenceIndex = args.indexOf("--simulate-command-sequence");
const commands = sequenceIndex >= 0 ? String(args[sequenceIndex + 1] ?? "").split(",").map((command) => command.trim()).filter(Boolean)
  : commandIndex >= 0 ? [args[commandIndex + 1]].filter(Boolean) : [];
const report = buildMobileWhatsappApprovalCenterReport(fixture, commands);
console.log(JSON.stringify(summarizeMobileWhatsappApprovalCenter(report), null, 2));
