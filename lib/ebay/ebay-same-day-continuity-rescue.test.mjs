import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  evaluateSameDayContinuityRescue,
  SAME_DAY_CONTINUITY_RESCUE_VERSION,
} from "./ebay-same-day-continuity-rescue.ts"

function snapshot(overrides = {}) {
  return {
    run: {
      id: "run-1",
      status: "ACTIVE",
      target_new_listings: 2,
      verified_new_listings: 0,
      source_inventory: {},
      ...overrides.run,
    },
    candidates: overrides.candidates ?? [{
      id: "candidate-1",
      ordinal: 1,
      machine_state: "CALCULATING_ECONOMICS",
    }],
    tasks: overrides.tasks ?? [],
    jobs: overrides.jobs ?? [],
  }
}

test("el auxilio no inventa un lanzamiento cuando no existe uno activo", () => {
  const result = evaluateSameDayContinuityRescue(null)
  assert.equal(result.mode, "NO_ACTIVE_RUN")
  assert.equal(result.canRunAutomaticRescue, false)
  assert.equal(result.safety.skipsStates, false)
  assert.equal(result.safety.callsEbayDirectly, false)
})

test("un estado automático puede reanudar exactamente el mismo motor", () => {
  const result = evaluateSameDayContinuityRescue(snapshot())
  assert.equal(result.version, SAME_DAY_CONTINUITY_RESCUE_VERSION)
  assert.equal(result.mode, "SAFE_AUTOMATIC_RESUME")
  assert.equal(result.canRunAutomaticRescue, true)
  assert.equal(result.machineState, "CALCULATING_ECONOMICS")
  assert.equal(result.safety.usesExistingStateMachine, true)
  assert.equal(result.safety.preservesCheckpoints, true)
})

test("un estado WAITING sin tarea durable se trata como huérfano reparable", () => {
  const result = evaluateSameDayContinuityRescue(snapshot({
    candidates: [{
      id: "candidate-1",
      ordinal: 1,
      machine_state: "WAITING_IMAGE_APPROVAL",
    }],
  }))
  assert.equal(result.mode, "SAFE_AUTOMATIC_RESUME")
  assert.equal(result.canRunAutomaticRescue, true)
})

test("una tarea humana abierta detiene el auxilio", () => {
  const result = evaluateSameDayContinuityRescue(snapshot({
    candidates: [{
      id: "candidate-1",
      ordinal: 1,
      machine_state: "WAITING_IMAGE_APPROVAL",
    }],
    tasks: [{
      candidate_id: "candidate-1",
      status: "OPEN",
      gate_type: "IMAGE_APPROVAL_REQUIRED",
      title: "Revisar las siete imágenes",
    }],
  }))
  assert.equal(result.mode, "WAITING_HUMAN_GATE")
  assert.equal(result.canRunAutomaticRescue, false)
  assert.equal(result.openHumanGate, "IMAGE_APPROVAL_REQUIRED")
  assert.equal(result.nextAction, "Revisar las siete imágenes")
  assert.equal(result.safety.grantsHumanApproval, false)
})

test("la publicación final siempre conserva la autorización humana", () => {
  const result = evaluateSameDayContinuityRescue(snapshot({
    candidates: [{
      id: "candidate-1",
      ordinal: 1,
      machine_state: "READY_FOR_MANUAL_PUBLICATION",
    }],
    tasks: [{
      candidate_id: "candidate-1",
      status: "OPEN",
      gate_type: "MANUAL_PUBLICATION_REQUIRED",
    }],
  }))
  assert.equal(result.mode, "FINAL_AUTHORIZATION_REQUIRED")
  assert.equal(result.canRunAutomaticRescue, false)
  assert.equal(result.safety.finalHumanAuthorizationRequired, true)
})

test("una publicación ya enviada se reconcilia y nunca se duplica", () => {
  for (const machineState of [
    "WAITING_ITEM_ID",
    "VERIFYING_PUBLISHED_LISTING",
    "REGISTERING_COMMERCIAL_MONITOR",
  ]) {
    const result = evaluateSameDayContinuityRescue(snapshot({
      candidates: [{ id: "candidate-1", ordinal: 1, machine_state: machineState }],
    }))
    assert.equal(result.mode, "PUBLICATION_RECONCILIATION_REQUIRED")
    assert.equal(result.canRunAutomaticRescue, false)
    assert.match(result.nextAction, /sin publicar otra vez/)
  }
})

test("el auxilio no fuerza productos cuando el conjunto quedó agotado", () => {
  const result = evaluateSameDayContinuityRescue(snapshot({
    run: {
      status: "BLOCKED",
      source_inventory: { nextCandidateSetExhausted: true },
    },
    candidates: [{
      id: "candidate-1",
      ordinal: 1,
      machine_state: "BLOCKED",
    }],
  }))
  assert.equal(result.mode, "MANUAL_CORRECTION_REQUIRED")
  assert.equal(result.canRunAutomaticRescue, false)
  assert.equal(result.reasonCode, "SAME_DAY_CONTINUITY_CANDIDATE_SET_EXHAUSTED")
})

test("un objetivo ya verificado es terminal", () => {
  const result = evaluateSameDayContinuityRescue(snapshot({
    run: {
      status: "COMPLETED",
      verified_new_listings: 2,
    },
    candidates: [{
      id: "candidate-1",
      ordinal: 1,
      machine_state: "VERIFIED_ACTIVE",
    }],
  }))
  assert.equal(result.mode, "TERMINAL")
  assert.equal(result.canRunAutomaticRescue, false)
})

test("la integración es acotada, auditable y no implementa publicación", () => {
  const service = readFileSync(
    new URL("./ebay-same-day-pilot-service.ts", import.meta.url),
    "utf8",
  )
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/same-day-pilot/route.ts", import.meta.url),
    "utf8",
  )
  const panel = readFileSync(
    new URL("../../app/admin/today-launch-panel.tsx", import.meta.url),
    "utf8",
  )
  const rescueService = service.slice(
    service.indexOf("export async function runSameDayPilotContinuityRescue"),
  )

  assert.match(rescueService, /processSameDayPilotJobChain/)
  assert.match(rescueService, /SAME_DAY_CONTINUITY_RESCUE_EXECUTED/)
  assert.match(rescueService, /humanApprovalGranted: false/)
  assert.match(rescueService, /directEbayWrite: false/)
  assert.doesNotMatch(rescueService, /publishOffer|createOrReplaceInventoryItem/)
  assert.match(route, /body\.action === "continuity_rescue"/)
  assert.match(route, /body\.confirmed !== true/)
  assert.match(panel, /Auxilio operativo sin Codex/)
  assert.match(panel, /ACTIVAR AUXILIO SEGURO/)
})
