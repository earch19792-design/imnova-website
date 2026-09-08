import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  COMMAND_CENTER_BACKGROUND_FANOUT_CONTRACT_V1,
  readCommandCenterBackgroundSingleFlightV1,
  resetCommandCenterBackgroundSingleFlightV1,
} from "./command-center-background-single-flight-v1.ts"

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

test("duplicate Command Center requests share one in-flight DB fan-out", async () => {
  resetCommandCenterBackgroundSingleFlightV1()
  const pending = deferred()
  let loads = 0
  const load = async () => {
    loads += 1
    await pending.promise
    return { queue: ["one"] }
  }
  const first = readCommandCenterBackgroundSingleFlightV1({
    scopeKey: "owner:account", load,
  })
  const second = readCommandCenterBackgroundSingleFlightV1({
    scopeKey: "owner:account", load,
  })
  pending.resolve()
  const [a, b] = await Promise.all([first, second])
  assert.equal(loads, 1)
  assert.equal(a.source, "DATABASE_READ")
  assert.equal(b.source, "SINGLE_FLIGHT_JOIN")
  assert.deepEqual(a.value, b.value)
  assert.equal(COMMAND_CENTER_BACKGROUND_FANOUT_CONTRACT_V1,
    "COMMAND_CENTER_BACKGROUND_FANOUT_OPTIMIZATION_V1")
})

test("single-flight is scope-bound, has no stale cache and evicts failures", async () => {
  resetCommandCenterBackgroundSingleFlightV1()
  let loads = 0
  const load = async () => ({ ordinal: ++loads })
  const [ownerA, ownerB] = await Promise.all([
    readCommandCenterBackgroundSingleFlightV1({ scopeKey: "a:account", load }),
    readCommandCenterBackgroundSingleFlightV1({ scopeKey: "b:account", load }),
  ])
  assert.equal(loads, 2)
  assert.notEqual(ownerA.value.ordinal, ownerB.value.ordinal)
  const next = await readCommandCenterBackgroundSingleFlightV1({
    scopeKey: "a:account", load,
  })
  assert.equal(next.source, "DATABASE_READ")
  assert.equal(loads, 3)

  let attempts = 0
  await assert.rejects(readCommandCenterBackgroundSingleFlightV1({
    scopeKey: "failure:account",
    load: async () => { attempts += 1; throw new Error("EXPECTED") },
  }), /EXPECTED/)
  await assert.rejects(readCommandCenterBackgroundSingleFlightV1({
    scopeKey: "failure:account",
    load: async () => { attempts += 1; throw new Error("EXPECTED") },
  }), /EXPECTED/)
  assert.equal(attempts, 2)
})

test("hot query shapes are bounded projections without Command Center exact count", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/command-center/route.ts", import.meta.url),
  "utf8")
  const queue = await readFile(new URL(
    "./ebay-first-luna-scan-service.ts", import.meta.url), "utf8")
  const singleFlight = await readFile(new URL(
    "./command-center-background-single-flight-v1.ts", import.meta.url),
  "utf8")
  const baseRead = route.slice(route.indexOf("const baseState ="),
    route.indexOf("const { dashboard, sessions, packages, alertOutbox }"))

  assert.match(route, /readCommandCenterBackgroundSingleFlightV1/)
  assert.match(route, /readShape: "COMMAND_CENTER_SUMMARY_V1"/)
  assert.match(route,
    /from\("ebay_listing_packages"\)[\s\S]{0,120}\.select\("id,account_key,opportunity_id,candidate_key,status,readiness,source_observed_at,created_by,updated_at"\)/)
  assert.doesNotMatch(baseRead,
    /from\("ebay_listing_packages"\)[\s\S]{0,100}\.select\("\*"\)/)
  assert.match(route,
    /from\("ebay_listing_packages"\)[\s\S]{0,350}\.limit\(50\)/)

  const summaryProjection = queue.match(
    /const COMMAND_CENTER_QUEUE_PROJECTION = "([^"]+)"/,
  )?.[1]?.split(",") ?? []
  assert.equal(summaryProjection.length, 27)
  assert.equal(summaryProjection.includes("assessment"), true)
  assert.equal(summaryProjection.includes("supply_score"), false)
  assert.equal(summaryProjection.includes("sellers_with_movement"), false)
  assert.equal(summaryProjection.includes("best_selling_match_score"), false)
  assert.match(queue,
    /select\(COMMAND_CENTER_QUEUE_PROJECTION\)[\s\S]{0,160}\.limit\(COMMAND_CENTER_QUEUE_LIMIT\)/)
  assert.match(queue, /const COMMAND_CENTER_QUEUE_LIMIT = 100/)
  assert.match(queue, /exactCountRequested: !commandCenterSummary/)
  assert.doesNotMatch(singleFlight, /setInterval|setTimeout|freshness|expiresAt/)
})

test("the two Smart Stocking intakes use one bounded Command Center request", async () => {
  const card = await readFile(new URL(
    "../../app/admin/ebay/opportunity-queue/research/smart-stocking-listing-intake-card.tsx",
    import.meta.url), "utf8")
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/command-center/route.ts", import.meta.url),
  "utf8")
  const loadEffect = card.slice(card.indexOf("useEffect(() =>"),
    card.indexOf("async function completePackage"))

  assert.match(loadEffect, /for \(const candidate of CANDIDATES\)/)
  assert.match(loadEffect, /params\.append\("smartStockingCandidate"/)
  assert.equal((loadEffect.match(/await fetch\(/g) ?? []).length, 1)
  assert.doesNotMatch(loadEffect, /Promise\.all\(CANDIDATES\.map/)
  assert.match(route, /getAll\("smartStockingCandidate"\)/)
  assert.match(route, /smartStockingCandidates\.length > 2/)
  assert.match(route, /smartStockingListingIntakes,/)
})

test("full detailed queue remains separate and preserves its existing contract", async () => {
  const queue = await readFile(new URL(
    "./ebay-first-luna-scan-service.ts", import.meta.url), "utf8")
  const fullProjection = queue.match(
    /const FULL_QUEUE_PROJECTION = "([^"]+)"/,
  )?.[1]?.split(",") ?? []
  assert.equal(fullProjection.length, 30)
  assert.match(queue,
    /select\(FULL_QUEUE_PROJECTION, \{ count: "exact" \}\)/)
  assert.match(queue, /const QUEUE_LIMIT = 250/)
  assert.match(queue, /listDetailSeparated: commandCenterSummary/)
})

test("operational efficiency gate adds no poller, index or write authority", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/command-center/route.ts", import.meta.url),
  "utf8")
  const helper = await readFile(new URL(
    "./command-center-background-single-flight-v1.ts", import.meta.url),
  "utf8")
  assert.doesNotMatch(helper, /setInterval|setTimeout|BroadcastChannel/)
  assert.doesNotMatch(helper,
    /\.from\(|\.rpc\(|\.insert\(|\.update\(|\.upsert\(/i)
  const baseRead = route.slice(route.indexOf("const baseState ="),
    route.indexOf("const { dashboard, sessions, packages, alertOutbox }"))
  assert.doesNotMatch(baseRead, /count: "exact"/)
})
