import { createHash } from "node:crypto"

export const SMART_STOCKING_LEARNING_PROFILE_VERSION =
  "SELLER_OS_SMART_STOCKING_LEARNING_PROFILE_V1"

export const SMART_STOCKING_ENTRY_SCORE_MAXIMA = Object.freeze({
  marketDemandScore: 25,
  economicsPotentialScore: 25,
  merchandisingScore: 20,
  lunaAdvantageScore: 15,
  operationalSimplicityScore: 5,
  portfolioDiversificationScore: 5,
  evidenceQualityScore: 5,
})

export type SmartStockingEntryPotentialTier =
  | "PRIORITY_FAST_TRACK"
  | "HIGH_COMMERCIAL_POTENTIAL"
  | "CONDITIONAL_COMMERCIAL_POTENTIAL"
  | "LOW_CURRENT_POTENTIAL"

export type SmartStockingLaunchTier =
  | "GOLD"
  | "STRONG_MARKET_BET"
  | "CONTROLLED_MERCHANDISING_BET"
  | "EXPLORATORY_COMMERCIAL_BET"
  | "PARK"

export type SmartStockingEntrySnapshotOrigin =
  | "RECORDED_BEFORE_COMMERCIALIZATION"
  | "BACKFILLED_FROM_EXISTING_PRELAUNCH_EVIDENCE"

export type SmartStockingEntryScoreBreakdown = {
  marketDemandScore: number
  economicsPotentialScore: number
  merchandisingScore: number
  lunaAdvantageScore: number
  operationalSimplicityScore: number
  portfolioDiversificationScore: number
  evidenceQualityScore: number
}

export type SmartStockingEntrySnapshot = SmartStockingEntryScoreBreakdown & {
  entryPotentialScore: number
  entryPotentialTier: SmartStockingEntryPotentialTier
  riskPenalty: number
  whyPrioritized: string[]
  knownUncertainties: string[]
  entrySnapshotOrigin: SmartStockingEntrySnapshotOrigin
}

export type SmartStockingFinalEconomics = {
  status: "PASS" | "FAIL" | "NOT_RUN"
  salePriceUsd: number | null
  ebayFeesUsd: number | null
  lunaProductCostUsd: number | null
  lunaShippingUsd: number | null
  landedCostUsd: number | null
  contributionProfitUsd: number | null
  contributionMarginPercent: number | null
  roiPercent: number | null
  thresholdResult: "PASS" | "FAIL" | "UNAVAILABLE"
}

export type SmartStockingDecisionSnapshot = {
  launchPotentialScore: number
  launchTier: SmartStockingLaunchTier
  evidenceProfile: string[]
  finalEconomics: SmartStockingFinalEconomics
  rescueUsed: boolean
  rescueType: string | null
  whyPublishedOrParked: string
  parkReason: string | null
  reopenCondition: string | null
}

export type SmartStockingLearningProfile = {
  profileVersion: typeof SMART_STOCKING_LEARNING_PROFILE_VERSION
  entrySnapshot: SmartStockingEntrySnapshot
  entrySnapshotHash: string
  decisionSnapshot: SmartStockingDecisionSnapshot
  decisionSnapshotHash: string
}

export type BuildSmartStockingLearningProfileInput = {
  scoreBreakdown: SmartStockingEntryScoreBreakdown
  riskPenalty: number
  whyPrioritized: string[]
  knownUncertainties: string[]
  entrySnapshotOrigin: SmartStockingEntrySnapshotOrigin
  decisionSnapshot: SmartStockingDecisionSnapshot
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`
}

function finiteScore(name: string, value: unknown, maximum = 100) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`SMART_STOCKING_${name.toUpperCase()}_INVALID`)
  }
  return Math.round(value * 100) / 100
}

function boundedTextArray(name: string, value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error(`SMART_STOCKING_${name.toUpperCase()}_INVALID`)
  }
  const entries = value.map((entry) => typeof entry === "string"
    ? entry.normalize("NFKC").trim().replace(/\s+/g, " ")
    : "")
  if (entries.some((entry) => !entry || entry.length > 500)) {
    throw new Error(`SMART_STOCKING_${name.toUpperCase()}_INVALID`)
  }
  return entries
}

function entryTier(score: number): SmartStockingEntryPotentialTier {
  if (score >= 75) return "PRIORITY_FAST_TRACK"
  if (score >= 60) return "HIGH_COMMERCIAL_POTENTIAL"
  if (score >= 40) return "CONDITIONAL_COMMERCIAL_POTENTIAL"
  return "LOW_CURRENT_POTENTIAL"
}

function validateDecisionSnapshot(value: SmartStockingDecisionSnapshot) {
  const launchPotentialScore = finiteScore(
    "launch_potential_score",
    value.launchPotentialScore,
  )
  if (![
    "GOLD",
    "STRONG_MARKET_BET",
    "CONTROLLED_MERCHANDISING_BET",
    "EXPLORATORY_COMMERCIAL_BET",
    "PARK",
  ].includes(value.launchTier)) {
    throw new Error("SMART_STOCKING_LAUNCH_TIER_INVALID")
  }
  if (value.finalEconomics.status === "PASS" &&
      value.finalEconomics.thresholdResult !== "PASS") {
    throw new Error("SMART_STOCKING_FINAL_ECONOMICS_INCONSISTENT")
  }
  if (value.launchTier === "PARK" && (!value.parkReason || !value.reopenCondition)) {
    throw new Error("SMART_STOCKING_PARK_CONTEXT_REQUIRED")
  }
  if (value.launchTier !== "PARK" && value.finalEconomics.status !== "PASS") {
    throw new Error("SMART_STOCKING_LAUNCH_ECONOMICS_PASS_REQUIRED")
  }
  return {
    ...value,
    launchPotentialScore,
    evidenceProfile: boundedTextArray("evidence_profile", value.evidenceProfile),
    rescueType: value.rescueType?.trim() || null,
    whyPublishedOrParked: value.whyPublishedOrParked.trim(),
    parkReason: value.parkReason?.trim() || null,
    reopenCondition: value.reopenCondition?.trim() || null,
  }
}

export function buildSmartStockingLearningProfileV1(
  input: BuildSmartStockingLearningProfileInput,
): SmartStockingLearningProfile {
  const scoreBreakdown = Object.fromEntries(
    Object.entries(SMART_STOCKING_ENTRY_SCORE_MAXIMA).map(([name, maximum]) => [
      name,
      finiteScore(name, input.scoreBreakdown[name as keyof SmartStockingEntryScoreBreakdown], maximum),
    ]),
  ) as SmartStockingEntryScoreBreakdown
  const riskPenalty = finiteScore("risk_penalty", input.riskPenalty)
  const grossScore = Object.values(scoreBreakdown).reduce((total, score) => total + score, 0)
  const entryPotentialScore = Math.max(0, Math.round((grossScore - riskPenalty) * 100) / 100)
  const entrySnapshot: SmartStockingEntrySnapshot = {
    ...scoreBreakdown,
    entryPotentialScore,
    entryPotentialTier: entryTier(entryPotentialScore),
    riskPenalty,
    whyPrioritized: boundedTextArray("why_prioritized", input.whyPrioritized),
    knownUncertainties: boundedTextArray("known_uncertainties", input.knownUncertainties),
    entrySnapshotOrigin: input.entrySnapshotOrigin,
  }
  const decisionSnapshot = validateDecisionSnapshot(input.decisionSnapshot)
  return {
    profileVersion: SMART_STOCKING_LEARNING_PROFILE_VERSION,
    entrySnapshot,
    entrySnapshotHash: sha256(entrySnapshot),
    decisionSnapshot,
    decisionSnapshotHash: sha256(decisionSnapshot),
  }
}

export function updateSmartStockingDecisionSnapshotV1(
  existing: SmartStockingLearningProfile,
  decisionSnapshot: SmartStockingDecisionSnapshot,
): SmartStockingLearningProfile {
  validateSmartStockingLearningProfileV1(existing)
  const decision = validateDecisionSnapshot(decisionSnapshot)
  return {
    ...existing,
    decisionSnapshot: decision,
    decisionSnapshotHash: sha256(decision),
  }
}

export function validateSmartStockingLearningProfileV1(
  value: unknown,
): asserts value is SmartStockingLearningProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SMART_STOCKING_PROFILE_INVALID")
  }
  const profile = value as SmartStockingLearningProfile
  if (profile.profileVersion !== SMART_STOCKING_LEARNING_PROFILE_VERSION) {
    throw new Error("SMART_STOCKING_PROFILE_VERSION_INVALID")
  }
  const rebuilt = buildSmartStockingLearningProfileV1({
    scoreBreakdown: profile.entrySnapshot,
    riskPenalty: profile.entrySnapshot.riskPenalty,
    whyPrioritized: profile.entrySnapshot.whyPrioritized,
    knownUncertainties: profile.entrySnapshot.knownUncertainties,
    entrySnapshotOrigin: profile.entrySnapshot.entrySnapshotOrigin,
    decisionSnapshot: profile.decisionSnapshot,
  })
  if (rebuilt.entrySnapshot.entryPotentialScore !== profile.entrySnapshot.entryPotentialScore ||
      rebuilt.entrySnapshot.entryPotentialTier !== profile.entrySnapshot.entryPotentialTier ||
      rebuilt.entrySnapshotHash !== profile.entrySnapshotHash ||
      rebuilt.decisionSnapshotHash !== profile.decisionSnapshotHash) {
    throw new Error("SMART_STOCKING_PROFILE_INTEGRITY_MISMATCH")
  }
}
