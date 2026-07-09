import { readFileSync } from "node:fs";

import {
  summarizeAmazonReferralFeeSchedule,
} from "../lib/marketplace/amazon-referral-fee-schedule.ts";

function readJsonFixture(relativePath) {
  return JSON.parse(
    readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    ),
  );
}

const fixture =
  readJsonFixture("./fixtures/amazon-referral-fee-schedule-v1.json");
const summary =
  summarizeAmazonReferralFeeSchedule(fixture);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
