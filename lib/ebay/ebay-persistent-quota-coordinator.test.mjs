import assert from "node:assert/strict"
import test from "node:test"

import {
  evaluateEbayQuotaLaneState,
  evaluateEbayQuotaRetryState,
  projectEffectiveEbayQuotaLane,
} from "./ebay-quota-lane-domain.ts"

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

test("an expired durable pause is projected as reset reached, never as an active UI pause", () => {
  const result = projectEffectiveEbayQuotaLane({
    ...base,
    status: "PAUSED_429",
    reset_at: "2026-07-18T03:59:59.000Z",
  }, now)
  assert.equal(result.status, "RESET_REACHED")
  assert.equal(result.reset_at, null)
})

test("effective projection preserves a normal daily quota reset", () => {
  const result = projectEffectiveEbayQuotaLane({
    ...base,
    available_budget: 50,
    status: "AVAILABLE",
    reset_at: "2026-07-19T00:00:00.000Z",
  }, now)
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.reset_at, "2026-07-19T00:00:00.000Z")
})

test("a durable quota retry stops displaying as paused when its resume instant expires", () => {
  const expired = evaluateEbayQuotaRetryState({
    status: "WAITING_RETRY",
    last_error_code: "EBAY_QUOTA_PAUSED_429",
    rate_limit_resume_at: "2026-07-18T03:59:59.000Z",
    available_at: "2026-07-18T03:59:59.000Z",
  }, now)
  assert.equal(expired.active, false)
  assert.equal(expired.resetReached, true)
  assert.equal(expired.resumeAt, null)

  const active = evaluateEbayQuotaRetryState({
    status: "WAITING_RETRY",
    last_error_code: "EBAY_QUOTA_PAUSED_429",
    rate_limit_resume_at: "2026-07-18T05:00:00.000Z",
    available_at: "2026-07-18T05:00:00.000Z",
  }, now)
  assert.equal(active.active, true)
  assert.equal(active.resumeAt, "2026-07-18T05:00:00.000Z")
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
