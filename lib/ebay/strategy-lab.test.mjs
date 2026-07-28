import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildMarketModel,
  calculateOfferScenarioEconomics,
  canonicalizeEbayItemId,
  classifyEvidence,
  classifyEvidenceSet,
  compareHumanConclusion,
  deduplicateComparables,
  EVIDENCE_CLASSES,
  evaluateStrategyLabCase,
  generateCreativeBrief,
  MARKET_COHORTS,
  OFFER_SCENARIOS,
  separateMarketCohorts,
  STRATEGY_OUTPUTS,
  validateComparable,
} from "./strategy-lab-engine.ts"
import {
  STRATEGY_LAB_GOLDEN_CASES,
} from "./strategy-lab-fixtures.ts"

const [bottleFixture, posiFixture, nozzleFixture] =
  STRATEGY_LAB_GOLDEN_CASES

function comparable(overrides = {}) {
  return {
    itemId: "999000000001",
    title: "Sanitized exact product",
    sourceKind: "EBAY_SOLD",
    sourceReference: "fixture://ebay/test",
    observedAt: "2026-07-28T12:00:00.000Z",
    identityMatch: "EXACT",
    identityMatchBasis: ["HUMAN_VERIFIED"],
    identityConflicts: [],
    offerScenario: "SINGLE",
    packQuantity: 1,
    variantComposition: ["STANDARD"],
    itemPrice: 19.99,
    buyerShipping: 0,
    currency: "USD",
    saleConfirmed: true,
    confirmedSoldQuantity: 1,
    estimatedSoldQuantity: null,
    ...overrides,
  }
}

test("publica exactamente las taxonomías V1 solicitadas", () => {
  assert.deepEqual(EVIDENCE_CLASSES, [
    "PRODUCT_VERIFIED",
    "SUPPLIER_STATED",
    "EBAY_SOLD_EXACT",
    "EBAY_ACTIVE_EXACT",
    "EBAY_ESTIMATED_SIGNAL",
    "HUMAN_HYPOTHESIS",
    "CONFLICTED",
    "MISSING",
  ])
  assert.deepEqual(MARKET_COHORTS, [
    "SOLD_EXACT",
    "ACTIVE_EXACT",
    "SIMILAR_NOT_EXACT",
    "ESTIMATED_ONLY",
    "REJECTED",
  ])
  assert.deepEqual(OFFER_SCENARIOS, [
    "SINGLE",
    "TWO_PACK",
    "THREE_PACK",
    "MIXED_VARIANT_BUNDLE",
  ])
  assert.ok(STRATEGY_OUTPUTS.includes("HOLD_EVIDENCE_INCOMPLETE"))
  assert.ok(STRATEGY_OUTPUTS.includes("NO_GO"))
})

test("clasifica las fuentes sin elevar señales de mercado a hechos de producto", () => {
  const base = {
    id: "evidence",
    field: "field",
    label: "Field",
    rawValue: "value",
    normalizedValue: "VALUE",
    scope: "MARKET",
    sourceReference: "fixture://source",
    observedAt: "2026-07-28T12:00:00.000Z",
  }
  const cases = [
    ["PRODUCT_INSPECTION", "PRODUCT_VERIFIED"],
    ["SUPPLIER_CATALOG", "SUPPLIER_STATED"],
    ["EBAY_CONFIRMED_SOLD", "EBAY_SOLD_EXACT"],
    ["EBAY_ACTIVE_LISTING", "EBAY_ACTIVE_EXACT"],
    ["EBAY_ESTIMATED_ACTIVITY", "EBAY_ESTIMATED_SIGNAL"],
    ["HUMAN_REVIEW", "HUMAN_HYPOTHESIS"],
  ]
  for (const [sourceKind, expected] of cases) {
    assert.equal(
      classifyEvidence({
        ...base,
        sourceKind,
        humanReviewed: sourceKind === "PRODUCT_INSPECTION",
      }).classification,
      expected,
    )
  }
  const unreviewedInspection = classifyEvidence({
    ...base,
    scope: "PRODUCT",
    sourceKind: "PRODUCT_INSPECTION",
  })
  assert.equal(unreviewedInspection.classification, "HUMAN_HYPOTHESIS")
  assert.equal(unreviewedInspection.usableAsProductFact, false)
  assert.equal(classifyEvidence({
    ...base,
    sourceKind: "PRODUCT_INSPECTION",
    normalizedValue: null,
  }).classification, "MISSING")
  const competitorAsFact = classifyEvidence({
    ...base,
    sourceKind: "EBAY_ACTIVE_LISTING",
    scope: "PRODUCT",
  })
  assert.equal(competitorAsFact.classification, "CONFLICTED")
  assert.equal(competitorAsFact.usableAsProductFact, false)
  assert.ok(competitorAsFact.classificationReasons.includes(
    "COMPETITOR_DATA_CANNOT_BECOME_PRODUCT_FACT",
  ))
})

test("conserva ambos lados del conflicto 1000 mL vs 32 oz", () => {
  const result = evaluateStrategyLabCase(bottleFixture.input)
  const capacities = result.evidence.filter((entry) =>
    entry.field === "capacity"
  )
  assert.equal(capacities.length, 2)
  assert.deepEqual(
    capacities.map((entry) => entry.classification),
    ["CONFLICTED", "CONFLICTED"],
  )
  assert.deepEqual(
    capacities.map((entry) => entry.rawValue),
    ["1000 mL", "32 oz"],
  )
  assert.equal(result.productFacts.some((entry) =>
    entry.field === "capacity"
  ), false)
  assert.ok(result.recommendation.warnings.includes(
    "EVIDENCE_CONFLICT:bottle-capacity-ml",
  ))
})

test("active nunca es sold y estimated nunca es venta verificada", () => {
  const active = validateComparable(comparable({
    sourceKind: "EBAY_ACTIVE",
    saleConfirmed: true,
    confirmedSoldQuantity: 99,
    estimatedSoldQuantity: 99,
  }))
  assert.equal(active.cohort, "ACTIVE_EXACT")
  assert.equal(active.evidenceClass, "EBAY_ACTIVE_EXACT")

  const estimated = validateComparable(comparable({
    sourceKind: "EBAY_ESTIMATED",
    saleConfirmed: false,
    confirmedSoldQuantity: null,
    estimatedSoldQuantity: 250,
  }))
  assert.equal(estimated.cohort, "ESTIMATED_ONLY")
  assert.equal(estimated.evidenceClass, "EBAY_ESTIMATED_SIGNAL")

  const unverifiedSold = validateComparable(comparable({
    saleConfirmed: false,
    confirmedSoldQuantity: null,
    estimatedSoldQuantity: 7,
  }))
  assert.equal(unverifiedSold.cohort, "ESTIMATED_ONLY")
  assert.equal(unverifiedSold.evidenceClass, "EBAY_ESTIMATED_SIGNAL")

  const invalidShipping = validateComparable(comparable({
    buyerShipping: Number.NaN,
  }))
  assert.equal(invalidShipping.cohort, "REJECTED")
  assert.ok(invalidShipping.rejectionReasons.includes(
    "BUYER_SHIPPING_INVALID",
  ))
})

test("similitud textual sola no puede convertirse en comparable exacto", () => {
  const result = validateComparable(comparable({
    identityMatchBasis: ["TEXT_ONLY"],
  }))
  assert.equal(result.accepted, true)
  assert.equal(result.cohort, "SIMILAR_NOT_EXACT")
  assert.equal(result.evidenceClass, "HUMAN_HYPOTHESIS")
  assert.ok(result.validationNotes.includes("TEXT_ONLY_MATCH_DOWNGRADED"))
})

test("deduplica Item ID raw y Browse antes de cualquier estadística", () => {
  assert.equal(
    canonicalizeEbayItemId("v1|123456789012|0"),
    canonicalizeEbayItemId("123456789012"),
  )
  const first = validateComparable(comparable({
    itemId: "123456789012",
  }))
  const duplicate = validateComparable(comparable({
    itemId: "v1|123456789012|0",
    sourceReference: "fixture://ebay/duplicate",
  }))
  const result = deduplicateComparables([first, duplicate])
  assert.equal(result.kept.length, 1)
  assert.equal(result.discarded.length, 1)
  assert.ok(result.discarded[0].rejectionReasons.includes(
    "DUPLICATE_ITEM_ID",
  ))
})

test("un Item ID duplicado con packs contradictorios se rechaza, no se resuelve silenciosamente", () => {
  const single = validateComparable(comparable({
    itemId: "123456789013",
  }))
  const twoPack = validateComparable(comparable({
    itemId: "v1|123456789013|0",
    offerScenario: "TWO_PACK",
    packQuantity: 2,
    variantComposition: ["STANDARD", "STANDARD"],
  }))
  const result = deduplicateComparables([single, twoPack])
  assert.equal(result.kept.length, 0)
  assert.equal(result.discarded.length, 2)
  assert.ok(result.discarded.every((entry) =>
    entry.rejectionReasons.includes("DUPLICATE_ITEM_ID_CONFLICT")
  ))
})

test("cohorts preservan sus clases después del pipeline", () => {
  const inputs = [
    validateComparable(comparable()),
    validateComparable(comparable({
      itemId: "999000000002",
      sourceKind: "EBAY_ACTIVE",
      saleConfirmed: false,
      confirmedSoldQuantity: null,
    })),
    validateComparable(comparable({
      itemId: "999000000003",
      sourceKind: "EBAY_ESTIMATED",
      saleConfirmed: false,
      confirmedSoldQuantity: null,
      estimatedSoldQuantity: 9,
    })),
  ]
  const cohorts = separateMarketCohorts(inputs)
  assert.equal(cohorts.SOLD_EXACT.length, 1)
  assert.equal(cohorts.ACTIVE_EXACT.length, 1)
  assert.equal(cohorts.ESTIMATED_ONLY.length, 1)
})

test("cada pack y composición conserva su propia mediana", () => {
  const bottle = evaluateStrategyLabCase(bottleFixture.input)
  const single = bottle.scenarioAssessments.find((entry) =>
    entry.scenario.id === "bottle-single"
  )
  const mixed = bottle.scenarioAssessments.find((entry) =>
    entry.scenario.id === "bottle-mixed-two-pack"
  )
  assert.equal(single.marketModel.soldExact.median, 18.24)
  assert.equal(single.marketModel.soldExact.p25, 17.12)
  assert.equal(single.marketModel.soldExact.p75, 19.37)
  assert.equal(mixed.marketModel.soldExact.median, 38.49)
  assert.equal(mixed.marketModel.soldExact.p25, 37.24)
  assert.equal(mixed.marketModel.soldExact.p75, 40.24)

  const nozzle = evaluateStrategyLabCase(nozzleFixture.input)
  const nozzleSingle = nozzle.scenarioAssessments.find((entry) =>
    entry.scenario.offerScenario === "SINGLE"
  )
  const nozzleThree = nozzle.scenarioAssessments.find((entry) =>
    entry.scenario.offerScenario === "THREE_PACK"
  )
  assert.equal(nozzleSingle.marketModel.activeExact.median, 22.47)
  assert.equal(nozzleThree.marketModel.activeExact.median, null)
  assert.equal(nozzleThree.marketModel.soldExact.median, null)
})

test("shipping MISSING permanece null; shipping cero explícito sí es dato", () => {
  const evaluation = evaluateStrategyLabCase(bottleFixture.input)
  const mixed = evaluation.scenarioAssessments.find((entry) =>
    entry.scenario.id === "bottle-mixed-two-pack"
  )
  assert.equal(mixed.economics.outboundShippingCost, null)
  assert.equal(mixed.economics.estimatedProfit, null)
  assert.equal(mixed.economics.profitFloor, null)
  assert.equal(mixed.economics.status, "MISSING_INPUT")

  const scenarioWithKnownFreeFulfillment = {
    ...mixed.scenario,
    outboundShippingCost: 0,
  }
  const market = buildMarketModel(
    evaluation.acceptedComparables,
    scenarioWithKnownFreeFulfillment,
  )
  const economics = calculateOfferScenarioEconomics({
    scenario: scenarioWithKnownFreeFulfillment,
    policy: bottleFixture.input.economicsPolicy,
    marketModel: market,
    evidence: evaluation.evidence,
  })
  assert.equal(economics.outboundShippingCost, 0)
  assert.equal(typeof economics.estimatedProfit, "number")
  assert.equal(typeof economics.profitFloor, "number")
})

test("profit floor y market ceiling se calculan por escenario", () => {
  const bottle = evaluateStrategyLabCase(bottleFixture.input)
  const bottleSingle = bottle.scenarioAssessments.find((entry) =>
    entry.scenario.offerScenario === "SINGLE"
  )
  assert.equal(bottleSingle.economics.profitFloor, 28.35)
  assert.equal(bottleSingle.economics.marketCeiling, 19.37)
  assert.equal(bottleSingle.releaseGate, "HOLD_ECONOMICS")

  const posi = evaluateStrategyLabCase(posiFixture.input)
  const posiTwoPack = posi.scenarioAssessments[0]
  assert.equal(posiTwoPack.economics.profitFloor, 33.92)
  assert.equal(posiTwoPack.economics.marketCeiling, 36.37)
  assert.equal(posiTwoPack.economics.estimatedProfit, 7.60)
  assert.equal(posiTwoPack.economics.netMarginPercent, 21.71)
  assert.equal(posiTwoPack.economics.roiPercent, 66.06)

  const nozzle = evaluateStrategyLabCase(nozzleFixture.input)
  const nozzleSingle = nozzle.scenarioAssessments.find((entry) =>
    entry.scenario.offerScenario === "SINGLE"
  )
  assert.equal(nozzleSingle.economics.profitFloor, 29.79)
  assert.equal(nozzleSingle.economics.marketCeiling, 24.48)
  assert.equal(nozzleSingle.economics.estimatedProfit, 0.42)
  assert.equal(nozzleSingle.releaseGate, "HOLD_ECONOMICS")
})

test("shipping ausente bloquea GO incluso con mercado exacto", () => {
  const input = structuredClone(posiFixture.input)
  input.compatibility = { required: false, requirements: [] }
  input.scenarios[0].outboundShippingCost = null
  const evaluation = evaluateStrategyLabCase(input)
  assert.equal(
    evaluation.recommendation.releaseGate,
    "HOLD_EVIDENCE_INCOMPLETE",
  )
  assert.notEqual(evaluation.recommendation.commercialDirection, "GO_SINGLE")
  assert.ok(evaluation.recommendation.blockers.some((blocker) =>
    blocker.includes("SHIPPING_MISSING")
  ))
})

test("cost lines exigen evidencia económica existente y concordante", () => {
  const missingEvidenceInput = structuredClone(posiFixture.input)
  missingEvidenceInput.compatibility = { required: false, requirements: [] }
  missingEvidenceInput.scenarios[0].costLines[0].evidenceId =
    "missing-cost-evidence"
  const missingEvidence = evaluateStrategyLabCase(missingEvidenceInput)
  assert.equal(missingEvidence.scenarioAssessments[0].economics.productCost,
    null)
  assert.equal(missingEvidence.recommendation.releaseGate,
    "HOLD_EVIDENCE_INCOMPLETE")
  assert.ok(missingEvidence.recommendation.blockers.includes(
    "COST_EVIDENCE_MISSING:STANDARD",
  ))

  const conflictingCostInput = structuredClone(posiFixture.input)
  conflictingCostInput.compatibility = { required: false, requirements: [] }
  conflictingCostInput.scenarios[0].costLines[0].unitCost = 0.01
  const conflictingCost = evaluateStrategyLabCase(conflictingCostInput)
  assert.equal(conflictingCost.scenarioAssessments[0].economics.productCost,
    null)
  assert.ok(conflictingCost.recommendation.blockers.includes(
    "COST_EVIDENCE_CONFLICTED:STANDARD",
  ))

  const valid = evaluateStrategyLabCase(posiFixture.input)
  assert.deepEqual(
    valid.scenarioAssessments[0].economics.costEvidenceIds,
    ["posi-unit-cost"],
  )
})

test("números de escenario inválidos fallan cerrados sin propagar NaN", () => {
  const input = structuredClone(posiFixture.input)
  input.compatibility = { required: false, requirements: [] }
  input.scenarios[0].packagingCost = Number.NaN
  const evaluation = evaluateStrategyLabCase(input)
  const economics = evaluation.scenarioAssessments[0].economics
  assert.equal(economics.status, "MISSING_INPUT")
  assert.equal(economics.packagingCost, null)
  assert.equal(economics.estimatedProfit, null)
  assert.doesNotMatch(JSON.stringify(evaluation), /NaN|Infinity/)
})

test("identidad requerida MISSING produce HOLD_IDENTITY", () => {
  const input = structuredClone(posiFixture.input)
  const sku = input.evidence.find((entry) => entry.field === "luna_sku")
  sku.rawValue = null
  sku.normalizedValue = null
  const evaluation = evaluateStrategyLabCase(input)
  assert.equal(evaluation.recommendation.releaseGate, "HOLD_IDENTITY")
  assert.ok(evaluation.recommendation.blockers.includes(
    "IDENTITY_MISSING:luna_sku",
  ))
})

test("NO_GO es alcanzable cuando todos los escenarios completos fallan economía", () => {
  const input = {
    ...bottleFixture.input,
    scenarios: [bottleFixture.input.scenarios[0]],
  }
  const evaluation = evaluateStrategyLabCase(input)
  assert.equal(evaluation.scenarioAssessments[0].releaseGate,
    "HOLD_ECONOMICS")
  assert.equal(evaluation.recommendation.releaseGate, "NO_GO")
  assert.equal(evaluation.recommendation.commercialDirection, null)
  assert.equal(evaluation.recommendation.nextAction, "HUMAN_CONFIRM_NO_GO")
})

test("los tres casos dorados reproducen la conclusión humana sin leerla", () => {
  for (const fixture of STRATEGY_LAB_GOLDEN_CASES) {
    const evaluation = evaluateStrategyLabCase(fixture.input)
    const comparison = compareHumanConclusion(
      evaluation,
      fixture.expectedHumanConclusion,
    )
    assert.equal(comparison.agreement, "MATCH", fixture.input.caseId)
    assert.deepEqual(comparison.differences, [], fixture.input.caseId)
  }
})

test("botella, Posi-Temp y 80144 conservan dirección y gate separados", () => {
  const bottle = evaluateStrategyLabCase(bottleFixture.input)
  assert.equal(bottle.recommendation.commercialDirection,
    "EVALUATE_TWO_PACK")
  assert.equal(bottle.recommendation.releaseGate,
    "HOLD_EVIDENCE_INCOMPLETE")

  const posi = evaluateStrategyLabCase(posiFixture.input)
  assert.equal(posi.recommendation.commercialDirection,
    "EVALUATE_TWO_PACK")
  assert.equal(posi.recommendation.releaseGate, "HOLD_COMPATIBILITY")

  const nozzle = evaluateStrategyLabCase(nozzleFixture.input)
  assert.equal(nozzle.recommendation.commercialDirection,
    "EVALUATE_THREE_PACK")
  assert.equal(nozzle.recommendation.releaseGate,
    "HOLD_EVIDENCE_INCOMPLETE")
  assert.equal(nozzle.evidence.find((entry) =>
    entry.field === "three_pack_hypothesis"
  ).classification, "HUMAN_HYPOTHESIS")
})

test("facts de competidor no contaminan product facts", () => {
  const input = structuredClone(bottleFixture.input)
  input.evidence.push({
    id: "bad-competitor-fact",
    field: "capacity",
    label: "Competitor capacity",
    rawValue: "64 oz",
    normalizedValue: 1892.71,
    scope: "PRODUCT",
    sourceKind: "EBAY_ACTIVE_LISTING",
    sourceReference: "fixture://ebay/competitor",
    observedAt: input.evaluatedAt,
  })
  const evaluation = evaluateStrategyLabCase(input)
  assert.equal(evaluation.productFacts.some((entry) =>
    entry.id === "bad-competitor-fact"
  ), false)
  assert.equal(evaluation.evidence.find((entry) =>
    entry.id === "bad-competitor-fact"
  ).classification, "CONFLICTED")
})

test("creative brief depende del escenario y sólo usa prueba autorizada", () => {
  const bottle = evaluateStrategyLabCase(bottleFixture.input)
  assert.equal(bottle.creativeBrief.positioning,
    "TWO BOTTLES, TWO ROUTINES")
  assert.equal(bottle.creativeBrief.visualUnitCount, 2)
  assert.equal(bottle.creativeBrief.omittedProof.find((entry) =>
    entry.field === "capacity"
  ).reason, "CONFLICTED")

  const singleOnlyInput = {
    ...bottleFixture.input,
    scenarios: [bottleFixture.input.scenarios[0]],
  }
  const singleOnly = evaluateStrategyLabCase(singleOnlyInput)
  assert.equal(singleOnly.creativeBrief.positioning,
    "ONE BOTTLE, ONE ROUTINE")
  assert.notEqual(
    singleOnly.creativeBrief.positioning,
    bottle.creativeBrief.positioning,
  )

  const posi = evaluateStrategyLabCase(posiFixture.input)
  const approvedCopy = posi.creativeBrief.approvedCopy.join(" ")
  assert.doesNotMatch(approvedCopy, /\b(?:OEM|Genuine|Universal)\b/i)
  assert.deepEqual(posi.creativeBrief.prohibitedTerms,
    ["OEM", "Genuine", "Universal"])
  assert.equal(posi.creativeBrief.status, "BLOCKED")
  assert.deepEqual(posi.creativeBrief.approvedCopy, [])
  assert.equal(posi.creativeBrief.canProduceAssets, false)
})

test("la expectativa humana no modifica el output del OS", () => {
  const before = evaluateStrategyLabCase(posiFixture.input)
  const alteredHuman = {
    ...posiFixture.expectedHumanConclusion,
    releaseGate: "GO_SINGLE",
    blockers: [],
  }
  const comparison = compareHumanConclusion(before, alteredHuman)
  const after = evaluateStrategyLabCase(posiFixture.input)
  assert.deepEqual(after, before)
  assert.notEqual(comparison.agreement, "MATCH")
})

test("evaluación es determinística, no muta inputs y no produce NaN", () => {
  const input = structuredClone(nozzleFixture.input)
  const frozenSnapshot = structuredClone(input)
  const first = evaluateStrategyLabCase(input)
  const second = evaluateStrategyLabCase(input)
  assert.deepEqual(input, frozenSnapshot)
  assert.deepEqual(first, second)
  assert.doesNotMatch(JSON.stringify(first), /NaN|Infinity/)
})

test("engine y página permanecen puros y sin adaptadores externos", () => {
  const engine = readFileSync("lib/ebay/strategy-lab-engine.ts", "utf8")
  const fixtures = readFileSync("lib/ebay/strategy-lab-fixtures.ts", "utf8")
  const page = readFileSync(
    "app/admin/ebay/strategy-lab/page.tsx",
    "utf8",
  )
  for (const source of [engine, fixtures, page]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/)
    assert.doesNotMatch(source, /\bcreateClient\s*\(/)
    assert.doesNotMatch(source, /\bprocess\.env\b/)
    assert.doesNotMatch(source, /\.from\s*\(/)
    assert.doesNotMatch(source, /\bDate\.now\s*\(/)
  }
  assert.doesNotMatch(engine, /80144|Posi-Temp|Botella|ITEM5126|ITEM3411/)
})
