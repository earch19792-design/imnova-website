import { readFileSync } from "node:fs";

import {
  summarizeAmazonLunaFbaPrepPackingCosts,
} from "../lib/marketplace/amazon-luna-fba-prep-packing-costs.ts";

const fixture =
  JSON.parse(readFileSync("tools/fixtures/amazon-luna-fba-prep-packing-costs-v1.json", "utf8"));

console.log(JSON.stringify(summarizeAmazonLunaFbaPrepPackingCosts(fixture), null, 2));
