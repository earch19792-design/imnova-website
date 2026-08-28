import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"

import { readFileSync } from "node:fs"

const workspaceSource = readFileSync(
  new URL("../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url),
  "utf8",
)

async function loadModule() {
  const source = readFileSync(
    new URL("./ebay-listing-ready-ui-v1.ts", import.meta.url),
    "utf8",
  )
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`)
}

test("ITEM3404 listing-ready UI has one canonical truth", async () => {
  const { canonicalListingReadyUi } = await loadModule()
  const canonicalBlockers = []
  const result = canonicalListingReadyUi({ ready: true, blockers: canonicalBlockers })
  assert.strictEqual(result.uiBlockers, canonicalBlockers,
    "UI_BLOCKERS_DIFFER_FROM_CANONICAL_READINESS")
  assert.deepEqual(result.uiBlockers, [])
  assert.equal(result.blockerSectionHidden, true)
  assert.equal(result.listingReady, true)
  assert.equal(result.preparationPercent, 100)
  const textualRuntime = [
    `Preparación ${result.preparationPercent}% ✅`,
    "Sin bloqueos ✅",
    "LISTING_READY ✅",
    "PRODUCTION · $24.99 · Qty 1",
    "[PUBLICAR EN EBAY]",
  ].join("\n")
  assert.equal(textualRuntime, [
    "Preparación 100% ✅",
    "Sin bloqueos ✅",
    "LISTING_READY ✅",
    "PRODUCTION · $24.99 · Qty 1",
    "[PUBLICAR EN EBAY]",
  ].join("\n"))
})

test("a future canonical blocker is shown once with exact resolution", async () => {
  const { canonicalListingReadyUi } = await loadModule()
  const canonicalBlockers = ["LUNA_SNAPSHOT_STALE"]
  const result = canonicalListingReadyUi({
    ready: false,
    blockers: canonicalBlockers,
  })
  assert.strictEqual(result.uiBlockers, canonicalBlockers,
    "UI_BLOCKERS_DIFFER_FROM_CANONICAL_READINESS")
  assert.equal(result.blockerSectionHidden, false)
  assert.equal(result.listingReady, false)
  assert.deepEqual(result.blockerDetails, [{
    reasonCode: "LUNA_SNAPSHOT_STALE",
    explanation:
      "La disponibilidad o evidencia comercial vigente no permite publicar.",
    resolutionAction:
      "Reconfirma stock y costo del producto Luna exacto desde este Workspace.",
  }])
})

test("Workspace renders only canonical blockers and one listing-ready action", () => {
  const visualPanelIndex = workspaceSource.indexOf("const visualReviewPanel")
  const finalStateSource = workspaceSource.slice(
    workspaceSource.indexOf(": finalReviewCompleted", visualPanelIndex),
    workspaceSource.indexOf(": (v3ReviewAccessible || v3ReadyForPrepare)"),
  )
  assert.match(workspaceSource,
    /canonicalListingReadyUi\(draftState\.readiness\)/)
  assert.match(finalStateSource, /data-listing-ready-single-truth/)
  assert.match(finalStateSource, /Preparación 100% ✅/)
  assert.match(finalStateSource, /Sin bloqueos ✅/)
  assert.match(finalStateSource, /LISTING_READY ✅/)
  assert.match(finalStateSource, /data-canonical-ui-blockers/)
  assert.match(finalStateSource, /blocker\.reasonCode/)
  assert.match(finalStateSource, /blocker\.explanation/)
  assert.match(finalStateSource, /blocker\.resolutionAction/)
  assert.equal((finalStateSource.match(/PUBLICAR EN EBAY/g) ?? []).length, 1)
  for (const staleMessage of [
    "Completa la categoría",
    "Completa la revisión de imágenes",
    "vuelve a Oportunidades",
  ]) assert.doesNotMatch(finalStateSource, new RegExp(staleMessage))
})
