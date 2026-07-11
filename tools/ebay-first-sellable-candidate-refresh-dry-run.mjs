import { readFileSync } from "node:fs"

import {
  buildFirstSellableCandidateRefresh,
  summarizeFirstSellableCandidateRefresh,
} from "../lib/ebay/ebay-first-sellable-candidate-refresh.ts"

const fixture = JSON.parse(
  readFileSync(
    "tools/fixtures/ebay-first-sellable-candidate-refresh-v1.json",
    "utf8"
  )
)
const report = buildFirstSellableCandidateRefresh(fixture)

console.log(JSON.stringify(summarizeFirstSellableCandidateRefresh(report), null, 2))
