import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  buildMayelChatGptVisualPromptV1,
  buildMayelProductEvidencePackV1,
  buildMayelOrderedVisualManifestV2,
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
  assert.equal(pack.semantics.creativeWorkAllowed, true)
  assert.equal(pack.semantics.factClaimRestrictedWhenUnproven, true)
})

test("deterministic prompt protects facts without blocking creative slots", () => {
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
  assert.match(first.text, /LIBERTAD CREATIVA Y VERDAD DEL PRODUCTO/)
  assert.match(first.text, /Genera una imagen por vez y espera aprobación/)
  assert.match(first.text, /AUTOCOMPROBACIÓN ANTES DE ENTREGAR CADA IMAGEN/)
  assert.match(first.text, /INSTRUCCIONES DE APROBACIÓN/)
  assert.match(first.text, /INSTRUCCIONES FINALES/)
  assert.match(first.text, /01_DETAIL — DETALLE: LISTA/)
  assert.match(first.text,
    /05_LIFESTYLE — LIFESTYLE \/ CONTEXTO ASPIRACIONAL: LIBRE PARA CREAR · SIN CLAIM FACTUAL/)
  assert.doesNotMatch(first.text,
    /Act as an art director|Work on exactly|Use every original source|Never use a previously generated|^Product:|^Category:|^Type:|^Brand:|^Materials:|^Package contents:|^Pack quantity:|^Allowed benefits:|^Allowed use cases:|PRODUCT LOCK|EVIDENCE GATES|Create only the READY|Prohibited or unproven|Keep the current main image|do not infer|do not redraw/m)
  assert.deepEqual(MAYEL_VISUAL_OUTPUT_ROLES, ["DETAIL", "PACKAGE_CONTENTS",
    "DIMENSIONS", "PRIMARY_BENEFIT", "LIFESTYLE", "HUMAN_USE"])
  assert.equal(first.slots.find((slot) => slot.role === "DIMENSIONS")?.status,
    "READY")
  assert.equal(first.slots.find((slot) => slot.role === "LIFESTYLE")?.status,
    "READY_FACT_RESTRICTED")
  assert.equal(first.slots.find((slot) => slot.role === "LIFESTYLE")
    ?.creativeWorkAllowed, true)
  assert.equal(first.slots.find((slot) => slot.role === "LIFESTYLE")
    ?.factClaimRestricted, true)
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

test("ordered manifest lets Mayel replace hero, remove images and controls order", () => {
  const current = ["https://example.com/hero.jpg",
    "https://example.com/old-secondary.jpg"]
  const assets = [{ assetId: "asset-a", role: "DETAIL",
    outputSha256: "a".repeat(64), publicUrl: "https://example.com/a.jpg" },
  { assetId: "asset-b", role: "LIFESTYLE",
    outputSha256: "b".repeat(64), publicUrl: "https://example.com/b.jpg" }]
  const manifest = buildMayelOrderedVisualManifestV2({ visualTaskId: "task",
    ebayItemId: "366643122092", currentImages: current, assets,
    finalOrder: [{ kind: "MAYEL_ASSET", assetId: "asset-b" },
      { kind: "CURRENT_OFFICIAL", publicUrl: current[0] },
      { kind: "MAYEL_ASSET", assetId: "asset-a" }],
    productTruthDigest: hash("c"), sourceImageSetDigest: hash("d") })
  assert.equal(manifest.mainImageChange, true)
  assert.equal(manifest.selectedHeroAssetId, "asset-b")
  assert.equal(manifest.keepOldHeroAsSecondary, true)
  assert.deepEqual(manifest.removedOfficialImageUrls, [current[1]])
  assert.deepEqual(manifest.proposedOrderedImages.map((entry) =>
    entry.publicUrl), [assets[1].publicUrl, current[0], assets[0].publicUrl])
  assert.equal(manifest.orderControlledByMayel, true)
  assert.equal(manifest.backendSilentReorder, false)
})

test("ordered manifest digest is order-sensitive and rejects duplicates", () => {
  const assets = [{ assetId: "asset-a", role: "DETAIL",
    outputSha256: "a".repeat(64), publicUrl: "https://example.com/a.jpg" },
  { assetId: "asset-b", role: "LIFESTYLE",
    outputSha256: "b".repeat(64), publicUrl: "https://example.com/b.jpg" }]
  const base = { visualTaskId: "task", ebayItemId: "366643122092",
    currentImages: ["https://example.com/hero.jpg"], assets,
    productTruthDigest: hash("c"), sourceImageSetDigest: hash("d") }
  const first = buildMayelOrderedVisualManifestV2({ ...base,
    finalOrder: assets.map((asset) => ({ kind: "MAYEL_ASSET",
      assetId: asset.assetId })) })
  const second = buildMayelOrderedVisualManifestV2({ ...base,
    finalOrder: [...assets].reverse().map((asset) => ({ kind: "MAYEL_ASSET",
      assetId: asset.assetId })) })
  assert.notEqual(first.visualManifestDigest, second.visualManifestDigest)
  assert.throws(() => buildMayelOrderedVisualManifestV2({ ...base,
    finalOrder: [{ kind: "MAYEL_ASSET", assetId: "asset-a" },
      { kind: "MAYEL_ASSET", assetId: "asset-a" }] }),
  /MAYEL_VISUAL_FINAL_ORDER_INVALID/)
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
  const approvalMigration = readFileSync(new URL(
    "../../supabase/migrations/20260904090000_fix_mayel_visual_approval_to_manifest_v1.sql",
    import.meta.url), "utf8")
  for (const source of [route, server]) {
    assert.doesNotMatch(source, /publishOffer|createOffer|updateOffer|ReviseFixedPriceItem|openai\.images|images\.generate/)
  }
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(route, /marketplaceWriteCapabilityFromPhaseA: false/)
  assert.match(ui, /data-commercial-feed-blocks-visual="false"/)
  assert.match(ui, /\["MERCADO", "Mercado"\]/)
  assert.match(ui, /\["RENTABILIDAD", "Rentabilidad"\]/)
  assert.match(ui, /\["RECOMENDACIONES", "Recomendaciones eBay"\]/)
  assert.match(ui, /Revalidar mercado/)
  assert.match(ui, /La autoridad comercial LIVE no está disponible ahora/)
  assert.match(server, /upsert: false/)
  assert.match(server, /listing_package_id: null/)
  assert.match(server, /account_key: input\.accountKey/)
  assert.match(server, /recoverableMayelVisualAsset/)
  assert.match(server, /MAYEL_VISUAL_OUTPUT_ALREADY_RECEIVED/)
  assert.match(server, /reconcileCanonicalPrompt/)
  assert.match(server, /promptReconciliationRequired: !storedMatchesCanonical/)
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
  assert.match(approvalMigration,
    /v_mayel_human boolean := false/)
  assert.match(approvalMigration,
    /new\.approved_by = new\.uploaded_by/)
  assert.match(approvalMigration,
    /humanReview,checks,productIdentityPreserved/)
  assert.match(approvalMigration,
    /task\.product_truth_digest = new\.product_truth_digest/)
  assert.match(approvalMigration,
    /not v_luna_automatic and not v_mayel_human/)
  assert.match(approvalMigration,
    /promote_ebay_mayel_visual_asset_v1/)
  assert.match(approvalMigration,
    /update public\.ebay_listing_image_assets[\s\S]*update public\.ebay_mayel_visual_tasks_v1/)
  assert.match(approvalMigration,
    /listing_package_id is null/)
  assert.match(server,
    /\.rpc\(\s*"promote_ebay_mayel_visual_asset_v1"/)
  assert.match(server, /removeUncommittedPublicUpload/)
  assert.match(server, /MAYEL_VISUAL_APPROVAL_PERSIST_FAILED/)
  assert.match(route,
    /No se pudo finalizar la aprobación y preparar la vista del owner/)
  assert.match(ui, /Abre una conversación nueva en ChatGPT para este producto/)
  assert.match(ui,
    /Carga únicamente las imágenes fuente proporcionadas por Seller OS/)
  assert.match(ui, /Copia y pega este prompt completo/)
  assert.match(ui,
    /Compara cada resultado contra las imágenes originales antes de aprobarlo/)
})

test("opening a LIVE listing focuses its exact visual task and keeps upload independent", () => {
  const ui = readFileSync(new URL(
    "../../app/admin/mayel-visual-workstation.tsx", import.meta.url), "utf8")
  assert.match(ui, /const payload = await visualRequest\([\s\S]*ENSURE_VISUAL_TASK/)
  assert.match(ui, /setSelectedVisualTaskId\(visualTaskId\)/)
  assert.match(ui, /id=\{`mayel-task-\$\{task\.visualTaskId\}`\}/)
  assert.match(ui, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/)
  assert.match(ui, /Checklist creativo del listing/)
  assert.match(ui, /Carga disponible · \{remaining\} de 6 espacios libres/)
  assert.match(ui, /Commercial intelligence is best-effort and never blocks visual work/)
  const loadBody = ui.slice(ui.indexOf("const load = useCallback"),
    ui.indexOf("useEffect(() => {", ui.indexOf("const load = useCallback")))
  assert.doesNotMatch(loadBody,
    /READ_MARKET_REVALIDATION_STATUS|Promise\.allSettled/)
})

test("atomic asset promotion accepts ordered V2 only with visual guards", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260906112007_mayel_visual_manifest_v2_promotion_contract.sql",
    import.meta.url), "utf8")
  for (const guard of ["MAYEL_ORDERED_VISUAL_MANIFEST_V2",
    "orderControlledByMayel", "backendSilentReorder",
    "mayelMainImageAuthority", "ownerPerImageApproval",
    "ownerPerListingVisualApproval", "finalOrderedImageSet",
    "selectedHeroAssetId", "MAYEL_VISUAL_PROMOTION_CONTRACT_INVALID"]) {
    assert.match(migration, new RegExp(guard))
  }
  assert.match(migration, /\["IMAGES_ONLY"\]'/)
  assert.doesNotMatch(migration,
    /ReviseFixedPriceItem|createOffer|publishOffer|updateOffer/)
})
