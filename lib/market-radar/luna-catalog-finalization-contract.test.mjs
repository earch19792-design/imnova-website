import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const service = readFileSync(
  new URL("../market-radar-lunaportex.ts", import.meta.url),
  "utf8",
)
const route = readFileSync(
  new URL(
    "../../app/api/cron/market-radar-luna-sync/route.ts",
    import.meta.url,
  ),
  "utf8",
)

test("only a complete catalog advances last_success_at", () => {
  assert.match(
    service,
    /scanStatus === "COMPLETE"[\s\S]*last_success_at:\s*finishedAt/,
  )
  assert.doesNotMatch(
    service,
    /\.update\(\{\s*last_success_at:\s*finishedAt,\s*last_error:\s*null,\s*\}\)/,
  )
})

test("terminal PARTIAL blocks all downstream work without reopening the run", () => {
  assert.match(
    route,
    /const catalogComplete =\s*sync\.scanStatus === "COMPLETE" &&\s*!continuationRequired/,
  )
  assert.match(route, /const taskReconciliation =\s*!catalogComplete \|\| readOnlyMode/)
  assert.match(
    route,
    /!catalogComplete[\s\S]*"SKIPPED_CATALOG_NOT_COMPLETE"[\s\S]*"SKIPPED_READ_ONLY"/,
  )
  assert.match(route, /const protection =\s*!catalogComplete \|\| readOnlyMode/)
  assert.match(
    route,
    /!readOnlyMode &&\s*catalogComplete &&\s*process\.env\.LUNA_MARKET_RADAR_NOTIFICATION_DISPATCH_ENABLED/,
  )
  assert.match(route, /"LUNA_CATALOG_PARTIAL_TERMINAL"/)
  assert.match(
    route,
    /status:\s*continuationRequired\s*\?\s*202\s*:\s*200/,
  )
})
