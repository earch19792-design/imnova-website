import assert from "node:assert/strict"
import test from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const {
  buildSellerOsOperationReadModel,
  loadingSellerOsOperationReadModel,
} = await jiti.import("./operation-read-model.ts")

const CONSULTED_AT = "2026-07-26T18:05:00.000Z"

test("loading no inventa lote ni conteos", () => {
  const model = loadingSellerOsOperationReadModel()
  assert.equal(model.availability, "LOADING")
  assert.equal(model.batch, null)
  assert.equal(model.openQuarantineCount.value, null)
})

test("respuesta vacía confirma cero cuarentenas, pero no inventa un lote", () => {
  const model = buildSellerOsOperationReadModel({
    success: true,
    resilientFactory: {
      migrationReady: true,
      error: null,
      runs: [],
      quarantine: [],
      circuits: [],
    },
  }, CONSULTED_AT)
  assert.equal(model.availability, "AVAILABLE")
  assert.equal(model.batch, null)
  assert.equal(model.openQuarantineCount.value, 0)
  assert.equal(model.openQuarantineCount.availability, "AVAILABLE")
})

test("el resumen conserva conteos reales y no inventa producto, fase ni heartbeat", () => {
  const model = buildSellerOsOperationReadModel({
    success: true,
    resilientFactory: {
      migrationReady: true,
      error: null,
      runs: [{
        run_id: "run-1",
        operation_date: "2026-07-26",
        status: "ACTIVE",
        products_selected: 5,
        products_completed: 2,
        products_on_hold: 1,
        products_quarantined: 0,
        factory_last_success_at: null,
      }],
      quarantine: [],
      circuits: [],
    },
  }, CONSULTED_AT)
  assert.equal(model.batch?.completedCount.value, 2)
  assert.equal(model.batch?.selectedCount.value, 5)
  assert.equal(model.batch?.visualState, "QUEUED")
  assert.equal(model.batch?.activeExecutionConfirmed, false)
  assert.equal(model.batch?.currentProduct.value, null)
  assert.equal(model.batch?.currentPhase.value, null)
  assert.equal(model.batch?.lastHeartbeatAt.value, null)
})

test("cero confirmado se distingue de un campo ausente", () => {
  const model = buildSellerOsOperationReadModel({
    success: true,
    resilientFactory: {
      migrationReady: true,
      error: null,
      runs: [{
        run_id: "run-2",
        operation_date: "2026-07-26",
        status: "COMPLETED",
        products_selected: 5,
        products_completed: 0,
        products_on_hold: 0,
      }],
      quarantine: [],
      circuits: [],
    },
  }, CONSULTED_AT)
  assert.equal(model.batch?.completedCount.value, 0)
  assert.equal(model.batch?.completedCount.availability, "AVAILABLE")
  assert.equal(model.batch?.quarantineCount.value, null)
  assert.equal(model.batch?.quarantineCount.availability, "UNAVAILABLE")
})

test("una fuente incompleta queda parcial y conserva los datos disponibles", () => {
  const model = buildSellerOsOperationReadModel({
    success: true,
    resilientFactory: {
      migrationReady: false,
      error: "LISTING_FACTORY_MIGRATION_NOT_READY",
      runs: [],
    },
  }, CONSULTED_AT)
  assert.equal(model.availability, "PARTIAL")
  assert.equal(model.openQuarantineCount.value, null)
  assert.equal(model.openCircuitCount.value, null)
})
