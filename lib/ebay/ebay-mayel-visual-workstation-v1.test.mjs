import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  buildMayelChatGptVisualPromptV1,
  buildMayelProductEvidencePackV1,
  buildMayelVisualManifestV1,
  deriveMayelVisualPromptSnapshotV1,
  MAYEL_VISUAL_OUTPUT_ROLES,
  validateMayelHumanQaV1,
} from "./ebay-mayel-visual-workstation-v1.ts"
import { normalizeMayelVisualQuarantineOutputV1 } from
  "./ebay-image-optimization-service.ts"

const hash = (digit) => `sha256:${digit.repeat(64)}`

function evidencePack() {
  return buildMayelProductEvidencePackV1({
    ebayItemId: "366643122092", sku: "FL-CUP-PHONE-MOUNT",
    packageData: {
      title: "Car Windshield Phone Holder",
      categoryName: "Cell Phone Mounts & Holders",
      aspects: { Type: "Phone Holder", Brand: "Unbranded",
        Color: "Black", Material: ["ABS", "PVC"],
        "Items Included": "Phone mount" },
      evidenceSnapshot: { assessment: { candidate: {
        supplierProductId: "9220873322720",
        supplierVariantId: "48809689415904",
      }, productTruth: {
        lunaProductId: "9220873322720",
        lunaVariantId: "48809689415904",
        evidenceDigest: hash("a"),
        authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
        provenProductValues: { Dimensions: "Fits 4.7–7 in phones" },
        knownUnknownAspectNames: ["Battery life"],
      } } },
    },
    sourceImages: [{ referenceId: "asset-1", sha256: "b".repeat(64),
      url: "https://example.com/source.jpg", storagePath: null,
      authority: "APPROVED_CANONICAL_LISTING_ASSET", position: 0 }],
  })
}

test("evidence pack preserves proven facts and explicit unknown semantics", () => {
  const pack = evidencePack()
  assert.equal(pack.productTruthDigest, hash("a"))
  assert.deepEqual(pack.materialsProven, ["ABS", "PVC"])
  assert.deepEqual(pack.dimensionsProven, ["Fits 4.7–7 in phones"])
  assert.ok(pack.prohibitedOrUnprovenClaims.includes("Battery life: UNPROVEN"))
  assert.equal(pack.semantics.generatedImageIsProductTruthAuthority, false)
})

test("deterministic prompt creates one product context and blocks unsupported slots", () => {
  const first = buildMayelChatGptVisualPromptV1(evidencePack())
  const second = buildMayelChatGptVisualPromptV1(evidencePack())
  assert.equal(first.digest, second.digest)
  assert.equal(first.textAiCallCount, 0)
  assert.equal(first.imageApiCallCount, 0)
  assert.ok(first.text.startsWith(
    "Actúa como director de arte especializado en fotografía comercial para e-commerce."))
  assert.match(first.text,
    /Actúa como director de arte especializado en fotografía comercial para e-commerce\./)
  assert.match(first.text, /BLOQUEO DE FIDELIDAD DEL PRODUCTO/)
  assert.match(first.text, /VALIDACIÓN DE EVIDENCIA/)
  assert.match(first.text, /Genera una imagen por vez y espera aprobación/)
  assert.match(first.text, /AUTOCOMPROBACIÓN ANTES DE ENTREGAR CADA IMAGEN/)
  assert.match(first.text, /INSTRUCCIONES DE APROBACIÓN/)
  assert.match(first.text, /INSTRUCCIONES FINALES/)
  assert.match(first.text, /01_DETAIL — DETALLE: LISTO/)
  assert.match(first.text,
    /05_LIFESTYLE — LIFESTYLE \/ CONTEXTO ASPIRACIONAL: BLOQUEADO: FALTA EVIDENCIA/)
  assert.doesNotMatch(first.text,
    /Act as an art director|Work on exactly|Use every original source|Never use a previously generated|^Product:|^Category:|^Type:|^Brand:|^Materials:|^Package contents:|^Pack quantity:|^Allowed benefits:|^Allowed use cases:|PRODUCT LOCK|EVIDENCE GATES|Create only the READY|Prohibited or unproven|Keep the current main image|do not infer|do not redraw/m)
  assert.deepEqual(MAYEL_VISUAL_OUTPUT_ROLES, ["DETAIL", "PACKAGE_CONTENTS",
    "DIMENSIONS", "PRIMARY_BENEFIT", "LIFESTYLE", "HUMAN_USE"])
  assert.equal(first.slots.find((slot) => slot.role === "DIMENSIONS")?.status,
    "READY")
  assert.equal(first.slots.find((slot) => slot.role === "LIFESTYLE")?.status,
    "BLOCKED_MISSING_EVIDENCE")
})

test("durable prompt snapshots reconcile to the single canonical authority", () => {
  const pack = evidencePack()
  const canonical = buildMayelChatGptVisualPromptV1(pack)
  const stale = deriveMayelVisualPromptSnapshotV1({ evidencePack: pack,
    storedContractVersion: canonical.contractVersion,
    storedText: "Work on exactly ONE product.",
    storedDigest: hash("f") })
  assert.equal(stale.storedMatchesCanonical, false)
  assert.ok(stale.prompt.text.startsWith("Actúa como director de arte"))
  const current = deriveMayelVisualPromptSnapshotV1({ evidencePack: pack,
    storedContractVersion: canonical.contractVersion,
    storedText: canonical.text, storedDigest: canonical.digest })
  assert.equal(current.storedMatchesCanonical, true)
})

test("visual manifest is material-only, stable, and preserves current main", () => {
  const input = { visualTaskId: "task", ebayItemId: "366643122092",
    currentImages: ["https://example.com/main.jpg",
      "https://example.com/secondary.jpg"],
    assets: [{ assetId: "asset-detail", role: "DETAIL",
      outputSha256: "c".repeat(64),
      publicUrl: "https://example.com/detail.jpg" }],
    productTruthDigest: hash("a"), sourceImageSetDigest: hash("b") }
  const first = buildMayelVisualManifestV1(input)
  const second = buildMayelVisualManifestV1({ ...input,
    assets: [...input.assets] })
  assert.equal(first.visualManifestDigest, second.visualManifestDigest)
  assert.equal(first.currentMainImagePreserved, true)
  assert.equal(first.proposedOrderedImages[0].publicUrl,
    "https://example.com/main.jpg")
  assert.deepEqual(first.fieldsToChange, ["IMAGES_ONLY"])
})

test("Mayel QA requires every identity guard and dimension truth check", () => {
  const complete = { productIdentityPreserved: true, colorPreserved: true,
    shapePreserved: true, partCountPreserved: true,
    visibleLogosPreserved: true, noInventedAccessories: true,
    noUnsupportedClaims: true, noUnauthorizedText: true,
    roleMatchesOutput: true, dimensionTextMatchesProductTruth: true }
  assert.equal(validateMayelHumanQaV1(complete, "DETAIL"), true)
  assert.equal(validateMayelHumanQaV1({ ...complete,
    dimensionTextMatchesProductTruth: false }, "DETAIL"), true)
  assert.equal(validateMayelHumanQaV1({ ...complete,
    dimensionTextMatchesProductTruth: false }, "DIMENSIONS"), false)
})

test("private quarantine validates actual signature and normalizes safely", async () => {
  const source = await sharp({ create: { width: 900, height: 700,
    channels: 3, background: "#d8d2c7" } }).png().toBuffer()
  const output = await normalizeMayelVisualQuarantineOutputV1({
    source: Buffer.from(source), declaredMimeType: "image/png" })
  assert.equal(output.actualMimeType, "image/png")
  assert.equal(output.outputMetadata.width, 1600)
  assert.equal(output.outputMetadata.height, 1600)
  assert.equal(output.qa.actualFileSignatureVerified, true)
  await assert.rejects(() => normalizeMayelVisualQuarantineOutputV1({
    source: Buffer.from(source), declaredMimeType: "image/jpeg" }),
  /MAYEL_VISUAL_MIME_SIGNATURE_MISMATCH/)
})

test("Phase A route and migration contain no eBay or OpenAI image mutation path", () => {
  const ui = readFileSync(new URL(
    "../../app/admin/mayel-visual-workstation.tsx", import.meta.url), "utf8")
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/mayel-visual-workstation/route.ts",
    import.meta.url), "utf8")
  const server = readFileSync(new URL(
    "./ebay-mayel-visual-workstation-server-v1.ts", import.meta.url), "utf8")
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260904060914_mayel_chatgpt_subscription_visual_workstation_phase_a_v1.sql",
    import.meta.url), "utf8")
  const packageBindingMigration = readFileSync(new URL(
    "../../supabase/migrations/20260904080505_fix_mayel_visual_asset_package_scope_binding_v1.sql",
    import.meta.url), "utf8")
  const dedupeMigration = readFileSync(new URL(
    "../../supabase/migrations/20260904082506_fix_mayel_visual_dedupe_readmodel_divergence_v1.sql",
    import.meta.url), "utf8")
  for (const source of [route, server]) {
    assert.doesNotMatch(source, /publishOffer|createOffer|updateOffer|ReviseFixedPriceItem|openai\.images|images\.generate/)
  }
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(route, /marketplaceWriteCapabilityFromPhaseA: false/)
  assert.match(server, /upsert: false/)
  assert.match(server, /listing_package_id: null/)
  assert.match(server, /account_key: input\.accountKey/)
  assert.match(server, /recoverableMayelVisualAsset/)
  assert.match(server, /MAYEL_VISUAL_OUTPUT_ALREADY_RECEIVED/)
  assert.match(server, /reconcileCanonicalPrompt/)
  assert.match(server, /MAYEL_VISUAL_PROMPT_RECONCILIATION_REQUIRED/)
  assert.match(server, /storedMatchesCanonical/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /revoke all.*anon, authenticated/s)
  assert.match(packageBindingMigration, /listing_package_id is not null/)
  assert.doesNotMatch(packageBindingMigration,
    /listing_package_id is null\s+and source_kind/)
  assert.match(route, /El archivo no es compatible con la Estación visual/)
  assert.match(route, /No se pudo guardar el archivo en cuarentena/)
  assert.match(route,
    /El archivo llegó a cuarentena, pero no pudimos guardar su registro/)
  assert.match(dedupeMigration, /EBAY_IMAGE_MAYEL_TASK_SCOPE_MISMATCH/)
  assert.match(dedupeMigration, /listing_package_id is null/)
  assert.match(dedupeMigration,
    /ebay_listing_image_assets_mayel_hash_uidx/)
  assert.match(dedupeMigration,
    /mayel_visual_task_id is null\s+and status in/)
  assert.match(ui, /Abre una conversación nueva en ChatGPT para este producto/)
  assert.match(ui,
    /Carga únicamente las imágenes fuente proporcionadas por Seller OS/)
  assert.match(ui, /Copia y pega este prompt completo/)
  assert.match(ui,
    /Compara cada resultado contra las imágenes originales antes de aprobarlo/)
})
