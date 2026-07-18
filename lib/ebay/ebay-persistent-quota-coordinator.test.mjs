import assert from "node:assert/strict"
import test from "node:test"

import { evaluateEbayQuotaLaneState } from "./ebay-quota-lane-domain.ts"

const now = new Date("2026-07-18T04:00:00.000Z")
const base = {
  available_budget: 0,
  reserved_budget: 300,
  owner_lane: "P1_EXACT_VERIFICATION",
}

test("active 429 pauses only the affected lane until its explicit reset", () => {
  const result = evaluateEbayQuotaLaneState({
    ...base,
    status: "PAUSED_429",
    reset_at: "2026-07-18T05:00:00.000Z",
  }, now)
  assert.equal(result.available, false)
  assert.equal(result.status, "PAUSED_429")
  assert.equal(result.resumeAt, "2026-07-18T05:00:00.000Z")
  assert.equal(result.ownerLane, "P1_EXACT_VERIFICATION")
})

test("the authorized reset permits one controlled probe", () => {
  const result = evaluateEbayQuotaLaneState({
    ...base,
    status: "PAUSED_429",
    reset_at: "2026-07-18T03:59:59.000Z",
  }, now)
  assert.equal(result.available, true)
  assert.equal(result.status, "RESET_REACHED")
  assert.equal(result.resumeAt, null)
  assert.equal(result.resetReached, true)
})

test("unknown quota can be probed but a known exhausted budget cannot", () => {
  assert.equal(evaluateEbayQuotaLaneState({
    ...base,
    status: "UNKNOWN",
    reset_at: null,
  }, now).available, true)
  assert.equal(evaluateEbayQuotaLaneState({
    ...base,
    status: "EXHAUSTED",
    reset_at: null,
  }, now).available, false)
})
