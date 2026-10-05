import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const service = readFileSync(
  new URL("./teo-owner-listing-experiment-service-v1.ts", import.meta.url),
  "utf8",
)
const page = readFileSync(
  new URL("../../app/admin/ebay/teo-listings/page.tsx", import.meta.url),
  "utf8",
)

test("TEO dashboard receives durable LIVE authority without marketplace writes", () => {
  assert.match(service, /readCurrentLiveAuthorityV1/)
  assert.match(service, /liveCoverage:\s*currentLiveAuthority/)
  assert.match(service, /readCurrentLiveAuthorityV1\(\{ supabase, accountKey \}\)/)
  assert.doesNotMatch(service,
    /liveCoverage[\s\S]{0,500}(?:ReviseItem|EndItem|publishOffer)/)
})

test("TEO makes failure cause and false-zero semantics visible", () => {
  for (const expression of [
    "Última cobertura LIVE certificada",
    "Timestamp certificado",
    "Clasificación de causa",
    "TEMPORARY_UPSTREAM_FAILURE",
    "EBAY_TRADING_ERROR",
    "no se interpreta como 0 listings",
  ]) {
    assert.match(page, new RegExp(expression))
  }
  assert.match(page, /liveCoverage\?\.currentState === "CURRENT_FRESH"/)
  assert.match(page, /liveTrading\?\.detailCode/)
})
