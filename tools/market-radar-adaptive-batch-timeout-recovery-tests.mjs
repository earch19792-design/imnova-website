import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import ts from "typescript"

const source = readFileSync("lib/market-radar-lunaportex.ts", "utf8")
const panel = readFileSync("components/admin/market-radar-panel.tsx", "utf8")
const types = readFileSync("lib/market-radar-types.ts", "utf8")

async function loadAdaptiveExecutor() {
  const testSource = `${source}\nexport { executeAdaptiveBatches }\n`
  const transpiled = ts.transpileModule(testSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  const outputPath = path.join(os.tmpdir(), `market-radar-adaptive-batch-${process.pid}-${Date.now()}.mjs`)
  writeFileSync(outputPath, transpiled)
  return import(`file://${outputPath}`)
}

test("adaptive executor splits a timed-out batch and completes all rows", async () => {
  const { executeAdaptiveBatches } = await loadAdaptiveExecutor()
  const telemetry = { adaptiveRetryCount: 0, failedBatchCount: 0, smallestSuccessfulBatchSize: null }
  const processed = []
  await executeAdaptiveBatches({
    rows: Array.from({ length: 20 }, (_, index) => index + 1),
    batchSize: 20,
    stage: "SNAPSHOT_INSERT",
    telemetry,
    execute: async batch => {
      if (batch.length > 5) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })
      processed.push(...batch)
    },
  })
  assert.deepEqual(processed.sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1))
  assert.equal(telemetry.adaptiveRetryCount, 3)
  assert.equal(telemetry.failedBatchCount, 0)
  assert.equal(telemetry.smallestSuccessfulBatchSize, 5)
})

test("minimum timed-out batch fails with stage attribution", async () => {
  const { executeAdaptiveBatches } = await loadAdaptiveExecutor()
  const telemetry = { adaptiveRetryCount: 0, failedBatchCount: 0, smallestSuccessfulBatchSize: null }
  await assert.rejects(
    executeAdaptiveBatches({
      rows: [1, 2, 3, 4, 5],
      batchSize: 5,
      stage: "SCORE_UPSERT",
      telemetry,
      execute: async () => { throw Object.assign(new Error("statement timeout"), { code: "57014" }) },
    }),
    /SCORE_UPSERT_TIMEOUT/
  )
  assert.equal(telemetry.failedBatchCount, 1)
})

test("non-timeout errors keep their write stage", async () => {
  const { executeAdaptiveBatches } = await loadAdaptiveExecutor()
  const telemetry = { adaptiveRetryCount: 0, failedBatchCount: 0, smallestSuccessfulBatchSize: null }
  await assert.rejects(
    executeAdaptiveBatches({ rows: [1], batchSize: 25, stage: "PRODUCT_UPSERT", telemetry, execute: async () => { throw new Error("constraint failed") } }),
    /PRODUCT_UPSERT_FAILED: constraint failed/
  )
})

test("sync uses bounded adaptive batches for every critical write stage", () => {
  for (const expected of [/PRODUCT_WRITE_BATCH_SIZE = 25/, /SNAPSHOT_WRITE_BATCH_SIZE = 50/, /EVENT_WRITE_BATCH_SIZE = 50/, /SCORE_WRITE_BATCH_SIZE = 50/, /PRODUCT_UPSERT/, /SNAPSHOT_INSERT/, /EVENT_UPSERT/, /SCORE_UPSERT/]) assert.match(source, expected)
})

test("sync and UI expose explicit coverage metrics", () => {
  for (const expected of [/catalogProductsFetched/, /uniqueProductsFetched/, /productsUpserted/, /productsWithSnapshots/, /failedBatchCount/, /adaptiveRetryCount/, /scanCompletenessPercent/, /scanStatus/]) {
    assert.match(source, expected)
    assert.match(types, expected)
    assert.match(panel, expected)
  }
})

test("adaptive recovery adds no marketplace, secret or external publication capability", () => {
  const combined = `${source}\n${panel}`
  for (const forbidden of [/publishOffer\s*\(/, /createOffer\s*\(/, /OPENAI_API_KEY/, /AMAZON_SELLER/, /console\.log\([^)]*token/i]) assert.doesNotMatch(combined, forbidden)
})
