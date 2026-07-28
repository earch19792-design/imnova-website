import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  canonicalizeEbayItemId,
  classifyEvidence,
  classifyEvidenceSet,
  compareHumanConclusion,
  deduplicateComparables,
  EVIDENCE_CLASSES,
  evaluateStrategyLabCase,
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

function withBackedScenarioCosts(caseInput, {
  scenarioIndex = 0,
  packagingCost = 0,
  shippingCost = 6.99,
  packagingSourceKind = "SUPPLIER_CATALOG",
  shippingSourceKind = "SUPPLIER_CATALOG",
} = {}) {
  const input = structuredClone(caseInput)
  const scenario = input.scenarios[scenarioIndex]
  const packagingEvidenceId = `test-packaging-${scenario.id}`
  const shippingEvidenceId = `test-shipping-${scenario.id}`
  input.evidence.push(
    {
      id: packagingEvidenceId,
      field: "packaging_cost",
      label: "Test-backed packaging cost",
      rawValue: packagingCost,
      normalizedValue: packagingCost,
      scope: "PRODUCT",
      sourceKind: packagingSourceKind,
      sourceReference: `test://economics/${scenario.id}/packaging`,
      observedAt: input.evaluatedAt,
      requiredFor: ["ECONOMICS"],
      economicCost: {
        component: "PACKAGING_COST",
        currency: "USD",
        basis: "PER_ORDER",
      },
      humanReviewed: packagingSourceKind === "PRODUCT_INSPECTION",
    },
    {
      id: shippingEvidenceId,
      field: "outbound_shipping_cost",
      label: "Test-backed outbound shipping cost",
      rawValue: shippingCost,
      normalizedValue: shippingCost,
      scope: "PRODUCT",
      sourceKind: shippingSourceKind,
      sourceReference: `test://economics/${scenario.id}/shipping`,
      observedAt: input.evaluatedAt,
      requiredFor: ["ECONOMICS"],
      economicCost: {
        component: "OUTBOUND_SHIPPING_COST",
        currency: "USD",
        basis: "PER_ORDER",
      },
      humanReviewed: shippingSourceKind === "PRODUCT_INSPECTION",
    },
  )
  scenario.packagingCost = packagingCost
  scenario.packagingCostEvidenceId = packagingEvidenceId
  scenario.outboundShippingCost = shippingCost
  scenario.outboundShippingCostEvidenceId = shippingEvidenceId
  return input
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

test("costos MISSING permanecen null y cero requiere evidencia explícita", () => {
  const evaluation = evaluateStrategyLabCase(bottleFixture.input)
  const mixed = evaluation.scenarioAssessments.find((entry) =>
    entry.scenario.id === "bottle-mixed-two-pack"
  )
  assert.equal(mixed.economics.outboundShippingCost, null)
  assert.equal(mixed.economics.estimatedProfit, null)
  assert.equal(mixed.economics.profitFloor, null)
  assert.equal(mixed.economics.status, "MISSING_INPUT")

  const zeroWithoutEvidence = structuredClone(bottleFixture.input)
  zeroWithoutEvidence.scenarios[1].outboundShippingCost = 0
  zeroWithoutEvidence.scenarios[1].outboundShippingCostEvidenceId = null
  const unsupported = evaluateStrategyLabCase(zeroWithoutEvidence)
    .scenarioAssessments[1].economics
  assert.equal(unsupported.outboundShippingCost, null)
  assert.ok(unsupported.blockers.includes(
    "OUTBOUND_SHIPPING_COST_EVIDENCE_MISSING",
  ))

  const explicitZero = withBackedScenarioCosts(
    bottleFixture.input,
    {
      scenarioIndex: 1,
      packagingCost: 0,
      shippingCost: 0,
    },
  )
  const economics = evaluateStrategyLabCase(explicitZero)
    .scenarioAssessments[1].economics
  assert.equal(economics.packagingCost, 0)
  assert.equal(economics.outboundShippingCost, 0)
  assert.equal(typeof economics.estimatedProfit, "number")
  assert.equal(typeof economics.profitFloor, "number")
})

test("ROI y minimumRoiPrice usan inversión total respaldada", () => {
  const bottle = evaluateStrategyLabCase(bottleFixture.input)
  const bottleSingle = bottle.scenarioAssessments.find((entry) =>
    entry.scenario.offerScenario === "SINGLE"
  )
  assert.equal(bottleSingle.economics.profitFloor, null)
  assert.equal(bottleSingle.economics.marketCeiling, 19.37)
  assert.equal(bottleSingle.releaseGate, "HOLD_EVIDENCE_INCOMPLETE")

  const backedPosi = withBackedScenarioCosts(posiFixture.input)
  backedPosi.compatibility = { required: false, requirements: [] }
  const posi = evaluateStrategyLabCase(backedPosi)
  const posiTwoPack = posi.scenarioAssessments[0]
  assert.equal(posiTwoPack.economics.profitFloor, 33.92)
  assert.equal(posiTwoPack.economics.marketCeiling, 36.37)
  assert.equal(posiTwoPack.economics.estimatedProfit, 7.60)
  assert.equal(posiTwoPack.economics.netMarginPercent, 21.71)
  assert.equal(posiTwoPack.economics.investedCost, 18.49)
  assert.equal(posiTwoPack.economics.roiPercent, 41.10)
  assert.equal(
    posiTwoPack.economics.profitFloorComponents.minimumRoiPrice,
    32.29,
  )
  assert.deepEqual(posiTwoPack.economics.costEvidenceIds, [
    "posi-unit-cost",
    "test-packaging-posi-two-pack",
    "test-shipping-posi-two-pack",
  ])
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

test("cada costo exige rol, moneda, base y variante económica concordantes", () => {
  const productRoleMismatch = structuredClone(posiFixture.input)
  productRoleMismatch.compatibility = { required: false, requirements: [] }
  productRoleMismatch.evidence.find((entry) =>
    entry.id === "posi-unit-cost"
  ).economicCost.component = "PACKAGING_COST"
  const productEconomics = evaluateStrategyLabCase(productRoleMismatch)
    .scenarioAssessments[0].economics
  assert.equal(productEconomics.productCost, null)
  assert.ok(productEconomics.blockers.includes(
    "COST_EVIDENCE_ROLE_MISMATCH:STANDARD",
  ))

  const packagingRoleMismatch = withBackedScenarioCosts(posiFixture.input)
  packagingRoleMismatch.compatibility = {
    required: false,
    requirements: [],
  }
  packagingRoleMismatch.evidence.find((entry) =>
    entry.id === "test-packaging-posi-two-pack"
  ).economicCost = {
    component: "OUTBOUND_SHIPPING_COST",
    currency: "USD",
    basis: "PER_ORDER",
  }
  const packagingEconomics = evaluateStrategyLabCase(packagingRoleMismatch)
    .scenarioAssessments[0].economics
  assert.equal(packagingEconomics.packagingCost, null)
  assert.ok(packagingEconomics.blockers.includes(
    "PACKAGING_COST_EVIDENCE_ROLE_MISMATCH",
  ))

  const wrongVariant = structuredClone(posiFixture.input)
  wrongVariant.compatibility = { required: false, requirements: [] }
  wrongVariant.evidence.find((entry) =>
    entry.id === "posi-unit-cost"
  ).economicCost.variantKeys = ["OTHER_VARIANT"]
  assert.ok(evaluateStrategyLabCase(wrongVariant)
    .scenarioAssessments[0].economics.blockers.includes(
      "COST_EVIDENCE_ROLE_MISMATCH:STANDARD",
    ))

  const wrongCurrency = withBackedScenarioCosts(posiFixture.input)
  wrongCurrency.compatibility = { required: false, requirements: [] }
  wrongCurrency.evidence.find((entry) =>
    entry.id === "test-shipping-posi-two-pack"
  ).economicCost.currency = "EUR"
  assert.ok(evaluateStrategyLabCase(wrongCurrency)
    .scenarioAssessments[0].economics.blockers.includes(
      "OUTBOUND_SHIPPING_COST_EVIDENCE_ROLE_MISMATCH",
    ))
})

test("packaging y shipping fallan cerrados sin evidencia o con valor discordante", () => {
  const packagingWithoutEvidence = structuredClone(posiFixture.input)
  packagingWithoutEvidence.compatibility = {
    required: false,
    requirements: [],
  }
  packagingWithoutEvidence.scenarios[0].packagingCost = 0
  packagingWithoutEvidence.scenarios[0].packagingCostEvidenceId = null
  const unsupportedPackaging = evaluateStrategyLabCase(
    packagingWithoutEvidence,
  ).scenarioAssessments[0].economics
  assert.equal(unsupportedPackaging.packagingCost, null)
  assert.ok(unsupportedPackaging.blockers.includes(
    "PACKAGING_COST_EVIDENCE_MISSING",
  ))

  const shippingWithoutEvidence = structuredClone(posiFixture.input)
  shippingWithoutEvidence.compatibility = {
    required: false,
    requirements: [],
  }
  shippingWithoutEvidence.scenarios[0].outboundShippingCost = 6.99
  shippingWithoutEvidence.scenarios[0].outboundShippingCostEvidenceId = null
  const unsupportedShipping = evaluateStrategyLabCase(
    shippingWithoutEvidence,
  ).scenarioAssessments[0].economics
  assert.equal(unsupportedShipping.outboundShippingCost, null)
  assert.ok(unsupportedShipping.blockers.includes(
    "OUTBOUND_SHIPPING_COST_EVIDENCE_MISSING",
  ))

  const conflictingInput = withBackedScenarioCosts(posiFixture.input)
  conflictingInput.compatibility = { required: false, requirements: [] }
  conflictingInput.evidence.find((entry) =>
    entry.id === "test-shipping-posi-two-pack"
  ).normalizedValue = 7.49
  const conflicted = evaluateStrategyLabCase(conflictingInput)
    .scenarioAssessments[0].economics
  assert.equal(conflicted.outboundShippingCost, null)
  assert.equal(conflicted.investedCost, null)
  assert.ok(conflicted.blockers.includes(
    "OUTBOUND_SHIPPING_COST_EVIDENCE_CONFLICTED",
  ))
  assert.equal(conflicted.status, "MISSING_INPUT")
  assert.equal(
    evaluateStrategyLabCase(posiFixture.input)
      .scenarioAssessments[0].economics.packagingCost,
    null,
  )
})

test("ROI queda null cuando la inversión total no es positiva", () => {
  const input = withBackedScenarioCosts(posiFixture.input, {
    packagingCost: 0,
    shippingCost: 0,
  })
  input.compatibility = { required: false, requirements: [] }
  const costEvidence = input.evidence.find((entry) =>
    entry.id === "posi-unit-cost"
  )
  costEvidence.rawValue = 0
  costEvidence.normalizedValue = 0
  input.scenarios[0].costLines[0].unitCost = 0
  const economics = evaluateStrategyLabCase(input)
    .scenarioAssessments[0].economics
  assert.equal(economics.investedCost, 0)
  assert.equal(economics.roiPercent, null)
  assert.equal(economics.profitFloorComponents.minimumRoiPrice, null)
})

test("clases no autorizadas no pueden respaldar costos", () => {
  const input = withBackedScenarioCosts(posiFixture.input, {
    packagingSourceKind: "HUMAN_REVIEW",
  })
  input.compatibility = { required: false, requirements: [] }
  const economics = evaluateStrategyLabCase(input)
    .scenarioAssessments[0].economics
  assert.equal(economics.packagingCost, null)
  assert.ok(economics.blockers.includes(
    "PACKAGING_COST_EVIDENCE_CLASS_NOT_ACCEPTED:HUMAN_HYPOTHESIS",
  ))
  assert.equal(economics.status, "MISSING_INPUT")
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

test("hard gates respetan acceptedEvidenceClasses y propósito", () => {
  const supplierFitment = structuredClone(posiFixture.input)
  for (const field of ["fitment", "dimensions"]) {
    const entry = supplierFitment.evidence.find((candidate) =>
      candidate.field === field
    )
    entry.rawValue = `Supplier ${field}`
    entry.normalizedValue = `SUPPLIER_${field.toUpperCase()}`
    entry.sourceKind = field === "fitment"
      ? "SUPPLIER_CATALOG"
      : "PRODUCT_INSPECTION"
    entry.humanReviewed = field === "dimensions"
  }
  const supplierResult = evaluateStrategyLabCase(supplierFitment)
  assert.equal(supplierResult.recommendation.releaseGate,
    "HOLD_COMPATIBILITY")
  assert.ok(supplierResult.recommendation.blockers.includes(
    "EVIDENCE_CLASS_NOT_ACCEPTED:fitment:SUPPLIER_STATED",
  ))

  const hypothesisFitment = structuredClone(supplierFitment)
  const fitmentHypothesis = hypothesisFitment.evidence.find((entry) =>
    entry.field === "fitment"
  )
  fitmentHypothesis.sourceKind = "HUMAN_REVIEW"
  fitmentHypothesis.scope = "PRODUCT"
  fitmentHypothesis.humanReviewed = true
  const hypothesisResult = evaluateStrategyLabCase(hypothesisFitment)
  assert.equal(hypothesisResult.recommendation.releaseGate,
    "HOLD_COMPATIBILITY")
  assert.ok(hypothesisResult.recommendation.blockers.includes(
    "EVIDENCE_CLASS_NOT_ACCEPTED:fitment:HUMAN_HYPOTHESIS",
  ))

  const verifiedFitment = structuredClone(supplierFitment)
  const fitmentVerified = verifiedFitment.evidence.find((entry) =>
    entry.field === "fitment"
  )
  fitmentVerified.sourceKind = "PRODUCT_INSPECTION"
  fitmentVerified.humanReviewed = true
  const verifiedResult = evaluateStrategyLabCase(verifiedFitment)
  assert.notEqual(verifiedResult.recommendation.releaseGate,
    "HOLD_COMPATIBILITY")
  assert.equal(
    verifiedResult.scenarioAssessments[0].economics.productCost,
    11.5,
  )
  assert.ok(verifiedResult.scenarioAssessments[0].economics
    .costEvidenceIds.includes("posi-unit-cost"))
})

test("una política de clases vacía falla cerrada con blocker explícito", () => {
  const input = structuredClone(nozzleFixture.input)
  input.identityRequirements[0].acceptedEvidenceClasses = []
  const evaluation = evaluateStrategyLabCase(input)
  assert.equal(evaluation.recommendation.releaseGate, "HOLD_IDENTITY")
  assert.ok(evaluation.recommendation.blockers.includes(
    "EVIDENCE_POLICY_MISSING:model",
  ))

  const missingRequirements = structuredClone(nozzleFixture.input)
  missingRequirements.identityRequirements = []
  const missingPolicy = evaluateStrategyLabCase(missingRequirements)
  assert.equal(missingPolicy.recommendation.releaseGate, "HOLD_IDENTITY")
  assert.ok(missingPolicy.recommendation.blockers.includes(
    "IDENTITY_REQUIREMENTS_MISSING",
  ))
})

test("NO_GO es alcanzable cuando todos los escenarios completos fallan economía", () => {
  const input = withBackedScenarioCosts({
    ...bottleFixture.input,
    scenarios: [bottleFixture.input.scenarios[0]],
  })
  const evaluation = evaluateStrategyLabCase(input)
  assert.equal(evaluation.scenarioAssessments[0].releaseGate,
    "HOLD_ECONOMICS")
  assert.equal(evaluation.recommendation.releaseGate, "NO_GO")
  assert.equal(evaluation.recommendation.commercialDirection, null)
  assert.equal(evaluation.recommendation.nextAction, "HUMAN_CONFIRM_NO_GO")
})

test("Shadow Mode conserva la conclusión humana y expone diferencias nuevas", () => {
  const expectedDifferences = {
    "motivational-bottle": [
      "preferredScenario",
      "commercialDirection",
      "blockers",
      "nextAction",
      "positioning",
    ],
    "posi-temp-cartridge": ["blockers"],
    "pressure-washer-nozzle-80144": [
      "preferredScenario",
      "commercialDirection",
      "blockers",
      "nextAction",
      "positioning",
    ],
  }
  for (const fixture of STRATEGY_LAB_GOLDEN_CASES) {
    const frozenHuman = structuredClone(fixture.expectedHumanConclusion)
    const evaluation = evaluateStrategyLabCase(fixture.input)
    const comparison = compareHumanConclusion(
      evaluation,
      fixture.expectedHumanConclusion,
    )
    assert.equal(comparison.agreement, "PARTIAL", fixture.input.caseId)
    assert.deepEqual(
      comparison.differences.map((difference) => difference.field),
      expectedDifferences[fixture.input.caseId],
      fixture.input.caseId,
    )
    assert.deepEqual(
      fixture.expectedHumanConclusion,
      frozenHuman,
      fixture.input.caseId,
    )
  }
})

test("los casos conservan escenarios hipotéticos visibles aunque no reciban bonus", () => {
  const bottle = evaluateStrategyLabCase(bottleFixture.input)
  assert.equal(bottle.recommendation.commercialDirection, "TEST_SINGLE")
  assert.equal(bottle.recommendation.releaseGate,
    "HOLD_EVIDENCE_INCOMPLETE")
  const bottleMixed = bottle.scenarioAssessments.find((entry) =>
    entry.scenario.offerScenario === "MIXED_VARIANT_BUNDLE"
  )
  assert.equal(bottleMixed.candidateStrategy, "EVALUATE_TWO_PACK")
  assert.equal(bottleMixed.releaseGate, "HOLD_EVIDENCE_INCOMPLETE")

  const posi = evaluateStrategyLabCase(posiFixture.input)
  assert.equal(posi.recommendation.commercialDirection,
    "EVALUATE_TWO_PACK")
  assert.equal(posi.recommendation.releaseGate, "HOLD_COMPATIBILITY")

  const nozzle = evaluateStrategyLabCase(nozzleFixture.input)
  assert.equal(nozzle.recommendation.commercialDirection, "TEST_SINGLE")
  assert.equal(nozzle.recommendation.releaseGate,
    "HOLD_EVIDENCE_INCOMPLETE")
  const nozzleThreePack = nozzle.scenarioAssessments.find((entry) =>
    entry.scenario.offerScenario === "THREE_PACK"
  )
  assert.equal(nozzleThreePack.candidateStrategy, "EVALUATE_THREE_PACK")
  assert.equal(nozzleThreePack.releaseGate, "HOLD_EVIDENCE_INCOMPLETE")
  assert.ok(nozzleThreePack.selectionReasons.includes(
    "HUMAN_HYPOTHESIS_PENALTY:-10",
  ))
  assert.equal(nozzle.evidence.find((entry) =>
    entry.field === "three_pack_hypothesis"
  ).classification, "HUMAN_HYPOTHESIS")
})

test("HUMAN_HYPOTHESIS nunca aumenta selectionScore", () => {
  const input = structuredClone(bottleFixture.input)
  const verified = {
    ...structuredClone(input.scenarios[0]),
    id: "equivalent-verified",
    hypothesisEvidenceClass: "PRODUCT_VERIFIED",
  }
  const hypothetical = {
    ...structuredClone(input.scenarios[0]),
    id: "equivalent-hypothetical",
    hypothesisEvidenceClass: "HUMAN_HYPOTHESIS",
  }
  input.scenarios = [hypothetical, verified]
  const evaluation = evaluateStrategyLabCase(input)
  const verifiedAssessment = evaluation.scenarioAssessments.find((entry) =>
    entry.scenario.id === verified.id
  )
  const hypothesisAssessment = evaluation.scenarioAssessments.find((entry) =>
    entry.scenario.id === hypothetical.id
  )
  assert.ok(verifiedAssessment.selectionScore >
    hypothesisAssessment.selectionScore)
  assert.equal(
    hypothesisAssessment.selectionScore -
      verifiedAssessment.selectionScore,
    -10,
  )
  assert.equal(evaluation.recommendation.preferredScenarioId, verified.id)
  assert.ok(hypothesisAssessment.selectionReasons.includes(
    "HUMAN_HYPOTHESIS_PENALTY:-10",
  ))

  const neutralInput = structuredClone(input)
  neutralInput.scenarios = [structuredClone(input.scenarios[1])]
  neutralInput.scenarios[0].hypothesisEvidenceClass = null
  const neutralScore = evaluateStrategyLabCase(neutralInput)
    .scenarioAssessments[0].selectionScore
  neutralInput.scenarios[0].hypothesisEvidenceClass = "HUMAN_HYPOTHESIS"
  const hypothesisScore = evaluateStrategyLabCase(neutralInput)
    .scenarioAssessments[0].selectionScore
  assert.ok(hypothesisScore <= neutralScore)
})

test("confidence multidimensional cubre LOW, MEDIUM, HIGH y NOT_APPLICABLE", () => {
  const bottle = evaluateStrategyLabCase(bottleFixture.input)
  const posi = evaluateStrategyLabCase(posiFixture.input)
  const nozzle = evaluateStrategyLabCase(nozzleFixture.input)
  assert.deepEqual(
    {
      identity: bottle.confidence.identity,
      compatibility: bottle.confidence.compatibility,
      market: bottle.confidence.market,
      economics: bottle.confidence.economics,
      strategy: bottle.confidence.strategy,
    },
    {
      identity: "MEDIUM",
      compatibility: "NOT_APPLICABLE",
      market: "MEDIUM",
      economics: "LOW",
      strategy: "LOW",
    },
  )
  assert.equal(posi.confidence.compatibility, "LOW")
  assert.equal(nozzle.confidence.market, "LOW")

  const verifiedCompatibility = structuredClone(posiFixture.input)
  for (const field of ["fitment", "dimensions"]) {
    const entry = verifiedCompatibility.evidence.find((candidate) =>
      candidate.field === field
    )
    entry.rawValue = `Verified ${field}`
    entry.normalizedValue = `VERIFIED_${field.toUpperCase()}`
    entry.sourceKind = "PRODUCT_INSPECTION"
    entry.humanReviewed = true
  }
  assert.equal(
    evaluateStrategyLabCase(verifiedCompatibility)
      .confidence.compatibility,
    "HIGH",
  )

  const lowIdentity = structuredClone(nozzleFixture.input)
  const model = lowIdentity.evidence.find((entry) =>
    entry.field === "model"
  )
  model.rawValue = null
  model.normalizedValue = null
  assert.equal(evaluateStrategyLabCase(lowIdentity).confidence.identity, "LOW")

  const highIdentity = structuredClone(nozzleFixture.input)
  const lunaSku = highIdentity.evidence.find((entry) =>
    entry.field === "luna_sku"
  )
  lunaSku.sourceKind = "PRODUCT_INSPECTION"
  lunaSku.humanReviewed = true
  assert.equal(
    evaluateStrategyLabCase(highIdentity).confidence.identity,
    "HIGH",
  )

  const highMarket = structuredClone(bottleFixture.input)
  highMarket.comparables.push(comparable({
    itemId: "199000000001",
    title: "Additional exact bottle single",
    variantComposition: ["BLACK"],
    itemPrice: 19.49,
  }))
  assert.equal(evaluateStrategyLabCase(highMarket).confidence.market, "HIGH")
})

test("economics y strategy confidence dependen de evidencia, no del outcome", () => {
  const mediumEconomics = withBackedScenarioCosts(posiFixture.input)
  assert.equal(
    evaluateStrategyLabCase(mediumEconomics).confidence.economics,
    "MEDIUM",
  )

  const highEconomics = withBackedScenarioCosts(
    {
      ...bottleFixture.input,
      scenarios: [bottleFixture.input.scenarios[0]],
    },
    {
      packagingSourceKind: "PRODUCT_INSPECTION",
      shippingSourceKind: "PRODUCT_INSPECTION",
    },
  )
  for (const field of [
    "variant_black",
    "variant_blue_purple",
    "supplier_unit_cost",
  ]) {
    const entry = highEconomics.evidence.find((candidate) =>
      candidate.field === field
    )
    entry.sourceKind = "PRODUCT_INSPECTION"
    entry.humanReviewed = true
  }
  highEconomics.comparables.push(comparable({
    itemId: "199000000002",
    title: "Fifth exact bottle single",
    variantComposition: ["BLACK"],
    itemPrice: 19.49,
  }))
  const high = evaluateStrategyLabCase(highEconomics)
  assert.equal(high.confidence.identity, "HIGH")
  assert.equal(high.confidence.market, "HIGH")
  assert.equal(high.confidence.economics, "HIGH")
  assert.equal(high.confidence.strategy, "HIGH")
  assert.equal(high.scenarioAssessments[0].economics.status,
    "HOLD_ECONOMICS")

  const mediumStrategy = withBackedScenarioCosts(
    {
      ...bottleFixture.input,
      scenarios: [bottleFixture.input.scenarios[0]],
    },
  )
  mediumStrategy.comparables.push(comparable({
    itemId: "199000000003",
    title: "Fifth exact bottle single",
    variantComposition: ["BLACK"],
    itemPrice: 19.49,
  }))
  const medium = evaluateStrategyLabCase(mediumStrategy)
  assert.equal(medium.confidence.identity, "MEDIUM")
  assert.equal(medium.confidence.market, "HIGH")
  assert.equal(medium.confidence.economics, "MEDIUM")
  assert.equal(medium.confidence.strategy, "MEDIUM")
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
  const mixedOnlyInput = {
    ...bottleFixture.input,
    scenarios: [bottleFixture.input.scenarios[1]],
  }
  const bottleMixed = evaluateStrategyLabCase(mixedOnlyInput)
  assert.equal(bottleMixed.creativeBrief.positioning,
    "TWO BOTTLES, TWO ROUTINES")
  assert.equal(bottleMixed.creativeBrief.visualUnitCount, 2)
  assert.equal(bottleMixed.creativeBrief.omittedProof.find((entry) =>
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
    bottleMixed.creativeBrief.positioning,
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

test("fixtures declaran explícitamente que no son mercado live ni listings propios", () => {
  for (const fixture of STRATEGY_LAB_GOLDEN_CASES) {
    assert.equal(
      fixture.fixtureStatus,
      "SANITIZED_DETERMINISTIC_GOLDEN_FIXTURE",
    )
    assert.deepEqual(fixture.fixtureEvidenceStatus, [
      "NOT_LIVE_MARKET_EVIDENCE",
      "NOT_LINKED_TO_OWN_EBAY_LISTING",
    ])
  }
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
    assert.doesNotMatch(source, /\bnew Date\s*\(/)
    assert.doesNotMatch(source, /\bMath\.random\s*\(/)
    assert.doesNotMatch(source, /\brandomUUID\s*\(/)
    assert.doesNotMatch(source, /\bXMLHttpRequest\b|\bWebSocket\b/)
  }
  assert.doesNotMatch(engine, /80144|Posi-Temp|Botella|ITEM5126|ITEM3411/)
  assert.doesNotMatch(
    engine,
    /HUMAN_HYPOTHESIS[\s\S]{0,80}\?\s*\+?20/,
  )
  assert.match(engine, /HUMAN_HYPOTHESIS_PENALTY/)
  assert.match(page, /Confidence multidimensional/)
  assert.match(page, /Confidence explica la solidez de la evidencia/)
})
