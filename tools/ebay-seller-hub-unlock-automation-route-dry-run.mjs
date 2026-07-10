import { readFileSync } from "node:fs";

import {
  buildEbaySellerHubUnlockAutomationRouteFromFixture,
  summarizeEbaySellerHubUnlockAutomationRoute,
} from "../lib/ebay/ebay-seller-hub-unlock-automation-route.ts";

const fixture =
  JSON.parse(
    readFileSync(
      "tools/fixtures/ebay-seller-hub-unlock-automation-route-v1.json",
      "utf8",
    ),
  );

const report =
  buildEbaySellerHubUnlockAutomationRouteFromFixture(fixture);

console.log(JSON.stringify(summarizeEbaySellerHubUnlockAutomationRoute(report), null, 2));
