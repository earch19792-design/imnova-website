import assert from "node:assert/strict"
import test from "node:test"

import {
  deriveSellerOsVisualState,
  getSellerOsStatusPresentation,
  shouldAnimateSellerOsState,
} from "./status-presentation.ts"

const NOW = new Date("2026-07-26T18:00:00.000Z")

test("un estado activo sin ejecución confirmada se presenta en cola", () => {
  assert.equal(deriveSellerOsVisualState({
    durableState: "RUNNING",
    activeExecutionConfirmed: false,
  }), "QUEUED")
})

test("trabajando exige una ejecución durable confirmada", () => {
  assert.equal(deriveSellerOsVisualState({
    durableState: "CLAIMED",
    activeExecutionConfirmed: true,
  }), "WORKING")
})

test("cuarentena, dependencia y decisión humana conservan estados distintos", () => {
  assert.equal(deriveSellerOsVisualState({
    durableState: "QUARANTINED_UNKNOWN_ERROR",
  }), "QUARANTINED")
  assert.equal(deriveSellerOsVisualState({
    durableState: "PAUSED_BY_GLOBAL_DEPENDENCY",
  }), "WAITING_DEPENDENCY")
  assert.equal(deriveSellerOsVisualState({
    durableState: "READY_FOR_OPERATOR",
  }), "WAITING_HUMAN")
})

test("la presentación humana no expone el código técnico", () => {
  const presentation = getSellerOsStatusPresentation("SAFETY_BLOCKED")
  assert.equal(presentation.label, "Bloqueado por seguridad")
  assert.doesNotMatch(presentation.description, /SAFETY_BLOCKED/)
})

test("la animación exige working, heartbeat, lease, visibilidad y movimiento permitido", () => {
  const base = {
    visualState: "WORKING",
    heartbeatAt: "2026-07-26T17:59:30.000Z",
    leaseExpiresAt: "2026-07-26T18:05:00.000Z",
    now: NOW,
    documentVisible: true,
    prefersReducedMotion: false,
  }
  assert.equal(shouldAnimateSellerOsState(base), true)
  assert.equal(shouldAnimateSellerOsState({
    ...base,
    documentVisible: false,
  }), false)
  assert.equal(shouldAnimateSellerOsState({
    ...base,
    prefersReducedMotion: true,
  }), false)
  assert.equal(shouldAnimateSellerOsState({
    ...base,
    heartbeatAt: "2026-07-26T17:00:00.000Z",
  }), false)
  assert.equal(shouldAnimateSellerOsState({
    ...base,
    visualState: "QUEUED",
  }), false)
})
