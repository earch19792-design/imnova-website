import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildSmartStockingLearningProfileV1,
  SMART_STOCKING_ENTRY_SCORE_MAXIMA,
  updateSmartStockingDecisionSnapshotV1,
  validateSmartStockingLearningProfileV1,
} from "./ebay-smart-stocking-learning-profile-v1.ts"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260827042817_seller_os_smart_stocking_learning_profile_v1.sql",
  import.meta.url,
), "utf8")
const service = readFileSync(new URL(
  "./ebay-winner-evidence-v2-service.ts",
  import.meta.url,
), "utf8")

function parkedDecision(overrides = {}) {
  return {
    launchPotentialScore: 32,
    launchTier: "PARK",
    evidenceProfile: [
      "EXACT_MODEL_SOLD_SIGNAL",
      "DISPLAYED_PRICE_ONLY_REALIZED_PRICE_UNPROVEN",
    ],
    finalEconomics: {
      status: "FAIL",
      salePriceUsd: 13.49,
      ebayFeesUsd: 2.46,
      lunaProductCostUsd: 4,
      lunaShippingUsd: 6.99,
      landedCostUsd: 10.99,
      contributionProfitUsd: -1.18,
      contributionMarginPercent: -8.73,
      roiPercent: -29.45,
      thresholdResult: "FAIL",
    },
    rescueUsed: true,
    rescueType: "DEFENSIBLE_PRICE_AND_ZERO_SHIPPING_BOUND",
    whyPublishedOrParked: "Market-supported price is below the configured economic floor.",
    parkReason: "BRAND_PROVENANCE_AND_ECONOMICS",
    reopenCondition: "Resolve supplier provenance and prove lower shipping or a higher sold-supported price.",
    ...overrides,
  }
}

function ramProfile(overrides = {}) {
  return buildSmartStockingLearningProfileV1({
    scoreBreakdown: {
      marketDemandScore: 15,
      economicsPotentialScore: 22,
      merchandisingScore: 15,
      lunaAdvantageScore: 14,
      operationalSimplicityScore: 5,
      portfolioDiversificationScore: 5,
      evidenceQualityScore: 3,
    },
    riskPenalty: 6,
    whyPrioritized: ["Exact model signal plus low supplier cost and light weight."],
    knownUncertainties: ["Supplier GTIN conflicts with the manufacturer UPC."],
    entrySnapshotOrigin: "RECORDED_BEFORE_COMMERCIALIZATION",
    decisionSnapshot: parkedDecision(),
    ...overrides,
  })
}

test("entry score uses the permanent 100-point commercial weights and a separate risk penalty", () => {
  assert.deepEqual(SMART_STOCKING_ENTRY_SCORE_MAXIMA, {
    marketDemandScore: 25,
    economicsPotentialScore: 25,
    merchandisingScore: 20,
    lunaAdvantageScore: 15,
    operationalSimplicityScore: 5,
    portfolioDiversificationScore: 5,
    evidenceQualityScore: 5,
  })
  const profile = ramProfile()
  assert.equal(profile.entrySnapshot.entryPotentialScore, 73)
  assert.equal(profile.entrySnapshot.entryPotentialTier, "HIGH_COMMERCIAL_POTENTIAL")
  assert.equal(profile.entrySnapshot.riskPenalty, 6)
})

test("entry snapshot is deterministic and decision updates preserve its immutable hash", () => {
  const first = ramProfile()
  const replay = ramProfile()
  assert.deepEqual(replay, first)
  const updated = updateSmartStockingDecisionSnapshotV1(first, parkedDecision({
    launchPotentialScore: 38,
    reopenCondition: "Manufacturer-chain evidence plus shipping at or below the proven economic bound.",
  }))
  assert.deepEqual(updated.entrySnapshot, first.entrySnapshot)
  assert.equal(updated.entrySnapshotHash, first.entrySnapshotHash)
  assert.notEqual(updated.decisionSnapshotHash, first.decisionSnapshotHash)
})

test("tampered entry or decision snapshots fail deterministic readback validation", () => {
  const profile = ramProfile()
  const changedEntry = structuredClone(profile)
  changedEntry.entrySnapshot.marketDemandScore += 1
  assert.throws(
    () => validateSmartStockingLearningProfileV1(changedEntry),
    /SMART_STOCKING_PROFILE_INTEGRITY_MISMATCH/,
  )
  const changedDecision = structuredClone(profile)
  changedDecision.decisionSnapshot.parkReason = "DIFFERENT_REASON"
  assert.throws(
    () => validateSmartStockingLearningProfileV1(changedDecision),
    /SMART_STOCKING_PROFILE_INTEGRITY_MISMATCH/,
  )
})

test("backfilled cases declare that entry evidence was reconstructed, not historically recorded", () => {
  const profile = ramProfile({
    entrySnapshotOrigin: "BACKFILLED_FROM_EXISTING_PRELAUNCH_EVIDENCE",
  })
  assert.equal(
    profile.entrySnapshot.entrySnapshotOrigin,
    "BACKFILLED_FROM_EXISTING_PRELAUNCH_EVIDENCE",
  )
})

test("launch tiers cannot bypass final economics and parked cases retain reopen context", () => {
  assert.throws(() => ramProfile({
    decisionSnapshot: parkedDecision({
      launchTier: "CONTROLLED_MERCHANDISING_BET",
    }),
  }), /SMART_STOCKING_LAUNCH_ECONOMICS_PASS_REQUIRED/)
  assert.throws(() => ramProfile({
    decisionSnapshot: parkedDecision({ reopenCondition: null }),
  }), /SMART_STOCKING_PARK_CONTEXT_REQUIRED/)
})

test("migration is additive, reuses the decision-package table and enforces entry immutability", () => {
  assert.match(migration, /alter table public\.marketplace_listing_decision_packages/i)
  assert.match(migration, /add column if not exists smart_stocking_learning_profile jsonb/i)
  assert.match(migration, /SELLER_OS_SMART_STOCKING_ENTRY_SNAPSHOT_IMMUTABLE/)
  assert.match(migration, /create unique index if not exists[\s\S]+learning_profile_identity_uidx/i)
  assert.doesNotMatch(migration, /create table/i)
  assert.doesNotMatch(migration, /drop table|truncate table|disable row level security/i)
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table/i)
})

test("canonical decision-package service owns profile persistence and exact readback", () => {
  assert.match(service, /persistSmartStockingLearningProfileV1/)
  assert.match(service, /readSmartStockingLearningProfileV1/)
  assert.match(service, /smart_stocking_learning_profile/)
  assert.match(service, /SMART_STOCKING_PROFILE_DURABLE_READBACK_MISMATCH/)
  assert.match(service, /ebayWrites: 0/)
})
