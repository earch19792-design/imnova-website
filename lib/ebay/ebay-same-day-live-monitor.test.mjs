import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  deriveSameDayLiveMonitor,
  explainSameDayRejectedCandidate,
  translateSameDayPilotBlocker,
} from "./ebay-same-day-live-monitor.ts"

const NOW = new Date("2026-07-18T18:00:00.000Z")

test("un job PENDING se presenta EN COLA y nunca simula trabajo", () => {
  const monitor = deriveSameDayLiveMonitor({
    now: NOW,
    run: { status: "ACTIVE", stage: "RECONCILING_IDENTITY" },
    candidates: [{ ordinal: 1, machine_state: "RECONCILING_IDENTITY" }],
    jobs: [{ status: "PENDING", updated_at: "2026-07-18T17:59:50.000Z" }],
  })
  assert.equal(monitor.status, "QUEUED")
  assert.equal(monitor.businessLabel, "EN COLA")
  assert.equal(monitor.shouldAnimate, false)
  assert.match(monitor.activityEvidence, /1 trabajo\(s\) en cola/)
})

test("la animación sólo se habilita con lease y latido durable recientes", () => {
  const monitor = deriveSameDayLiveMonitor({
    now: NOW,
    run: {
      status: "ACTIVE",
      stage: "RECONCILING_IDENTITY",
      last_worker_heartbeat_at: "2026-07-18T17:59:40.000Z",
      worker_lease_expires_at: "2026-07-18T18:04:00.000Z",
    },
    candidates: [{ ordinal: 2, machine_state: "RECONCILING_IDENTITY" }],
    jobs: [{ status: "LEASED", updated_at: "2026-07-18T17:59:35.000Z" }],
  })
  assert.equal(monitor.status, "WORKING")
  assert.equal(monitor.shouldAnimate, true)
  assert.match(monitor.activityEvidence, /Latido confirmado/)
})

test("un lease antiguo no se muestra como actividad viva", () => {
  const monitor = deriveSameDayLiveMonitor({
    now: NOW,
    run: {
      status: "ACTIVE",
      stage: "RUNNING_LOOP_1",
      last_worker_heartbeat_at: "2026-07-18T16:00:00.000Z",
      worker_lease_expires_at: "2026-07-18T16:06:00.000Z",
    },
    candidates: [{ ordinal: 1, machine_state: "RUNNING_LOOP_1" }],
    jobs: [{ status: "LEASED", updated_at: "2026-07-18T16:00:00.000Z" }],
  })
  assert.equal(monitor.status, "QUEUED")
  assert.equal(monitor.shouldAnimate, false)
})

test("una tarea humana domina el estado y sólo anuncia la primera", () => {
  const monitor = deriveSameDayLiveMonitor({
    now: NOW,
    run: { status: "ACTIVE", next_human_action: "Texto anterior" },
    candidates: [{ ordinal: 1, machine_state: "WAITING_LUNA_CONFIRMATION" }],
    tasks: [
      { status: "OPEN", title: "Confirma precio y disponibilidad Luna" },
      { status: "OPEN", title: "Una decisión posterior" },
    ],
  })
  assert.equal(monitor.status, "WAITING_OPERATOR")
  assert.equal(monitor.nextHumanAction, "Confirma precio y disponibilidad Luna")
  assert.match(monitor.activityEvidence, /2 tarea\(s\) humana\(s\)/)
})

test("la pausa 429 se representa sin convertirla en trabajo", () => {
  const monitor = deriveSameDayLiveMonitor({
    now: NOW,
    run: { status: "ACTIVE", stage: "RECONCILING_IDENTITY" },
    candidates: [{ ordinal: 1, machine_state: "RECONCILING_IDENTITY" }],
    jobs: [{ status: "WAITING_RETRY", last_error_code: "EBAY_READONLY_GET_429" }],
    quotaPaused: true,
  })
  assert.equal(monitor.status, "PAUSED_EBAY")
  assert.equal(monitor.shouldAnimate, false)
})

test("timeline, lote y descarte traducido son información de negocio", () => {
  const monitor = deriveSameDayLiveMonitor({
    now: NOW,
    run: { status: "PARTIALLY_READY", stage: "ENRICHING_PRODUCT_FACTS" },
    candidates: [
      { ordinal: 1, machine_state: "REJECTED", blockers: ["OFFICIAL_IDENTITY_RECONCILIATION_NOT_EXACT"] },
      { ordinal: 2, machine_state: "ENRICHING_PRODUCT_FACTS" },
      { ordinal: 3, machine_state: "RUN_CREATED" },
    ],
  })
  assert.equal(monitor.batch.total, 3)
  assert.equal(monitor.batch.blocked, 1)
  assert.equal(monitor.batch.currentOrdinal, 2)
  assert.equal(monitor.timeline.find((step) => step.id === "facts")?.status, "CURRENT")
  assert.match(monitor.blockerSummary ?? "", /identidad, variante o presentación/)
})

test("los blockers desconocidos no exponen el código como experiencia principal", () => {
  assert.equal(
    translateSameDayPilotBlocker("SOME_INTERNAL_RAW_CODE"),
    "El candidato necesita una revisión verificable antes de continuar.",
  )
})

test("un descarte económico explica mercado, piso, utilidad y aspectos obligatorios", () => {
  const explanation = explainSameDayRejectedCandidate({
    id: "candidate-2",
    ordinal: 2,
    product_title: "80144 Pressure Washer Nozzle",
    blockers: ["MISSING_BLOCKING"],
    commercial_decision_summary: {
      verdict: "NO_GO",
      fresh: false,
      economics: {
        activeMarketMedian: 22.47,
        minimumSafePrice: 49.09,
        marketSupportsMinimumSafePrice: false,
      },
      evidence: { confirmedSoldExact: 0 },
    },
    economics_summary: {
      confirmedLunaPrice: 9.2,
      minimumOperatorPrice: 29.79,
      config: {
        estimatedOutboundShipping: 6.99,
        estimatedEbayFeeRate: 0.153,
        fixedOrderFee: 0.4,
        returnsReserveRate: 0.04,
        promotedListingsReserveRate: 0.05,
      },
      feePolicy: { appliedFixedOrderFee: 0.4 },
    },
    product_facts_summary: {
      gates: { SHIPPING_CONFIRMED: false },
      resolvedRequirements: [
        { status: "MISSING_BLOCKING", aspectName: "Type" },
        { status: "MISSING_BLOCKING", aspectName: "Brand" },
      ],
    },
  })
  assert.match(explanation.headline, /\$49\.09.*\$22\.47/)
  assert.match(explanation.details.join(" "), /piso preliminar actual \$29\.79/)
  assert.match(explanation.details.join(" "), /utilidad \$5\.96, margen 20\.01% y ROI 64\.79%/)
  assert.match(explanation.details.join(" "), /Type, Brand/)
  assert.match(explanation.details.join(" "), /decisión comercial anterior está vencida/)
})

test("la excepción de 10% muestra una ventana competitiva sólo con venta exacta", () => {
  const explanation = explainSameDayRejectedCandidate({
    id: "candidate-risk",
    ordinal: 4,
    product_title: "Exact Product",
    blockers: ["MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE"],
    controlled_risk_override_preview: {
      available: true,
      blockers: [],
      minimumRiskPrice: 23.47,
      maximumCompetitivePrice: 27,
      confirmedSoldExactQuantity: 8,
      exactSoldReference: { confidence: "MEDIUM" },
    },
  })
  assert.equal(explanation.controlledRiskOverride.available, true)
  assert.equal(explanation.controlledRiskOverride.minimumRiskPrice, 23.47)
  assert.equal(explanation.controlledRiskOverride.maximumCompetitivePrice, 27)
  assert.equal(explanation.controlledRiskOverride.confirmedSoldExactQuantity, 8)
  assert.equal(explanation.controlledRiskOverride.referenceConfidence, "MEDIUM")
})

test("sin venta exacta explica por qué la excepción permanece cerrada", () => {
  const explanation = explainSameDayRejectedCandidate({
    id: "candidate-no-sold",
    controlled_risk_override_preview: {
      available: false,
      blockers: ["CONFIRMED_SOLD_EXACT_REQUIRED"],
      confirmedSoldExactQuantity: 0,
    },
  })
  assert.equal(explanation.controlledRiskOverride.available, false)
  assert.match(explanation.controlledRiskOverride.blockers.join(" "), /No existen ventas exactas/)
})

test("la UI futurista es veraz, responsive y respeta reduced motion", () => {
  const panel = readFileSync("app/admin/today-launch-panel.tsx", "utf8")
  assert.match(panel, /deriveSameDayLiveMonitor/)
  assert.match(panel, /monitor\.shouldAnimate/)
  assert.match(panel, /motion-safe:animate-ping/)
  assert.match(panel, /motion-reduce:transition-none/)
  assert.match(panel, /Las etapas futuras permanecen en gris/)
  assert.match(panel, /grid-cols-2[\s\S]{0,100}sm:grid-cols-4[\s\S]{0,100}xl:grid-cols-7/)
  assert.match(panel, /aria-current=\{step\.status === "CURRENT" \? "step"/)
  assert.match(panel, /role="progressbar"/)
  assert.match(panel, /Próxima acción del sistema/)
  assert.match(panel, /Próxima acción tuya/)
  assert.match(panel, /Descarte anterior del lote:/)
  assert.match(panel, /Por qué se bloqueó este lote:/)
  assert.match(panel, /Por qué no se publicarán estos productos/)
  assert.match(panel, /NO PUBLICAR AHORA/)
  assert.match(panel, /AUTORIZAR EXCEPCIÓN Y PREPARAR LISTING MANUAL/)
  assert.match(panel, /No activar Promoted Listings/)
  assert.match(panel, /Garantía al cliente de eBay sigue aplicando/)
  assert.match(panel, /No publica en eBay/)
})
