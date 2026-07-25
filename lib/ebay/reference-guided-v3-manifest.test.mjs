import assert from "node:assert/strict"
import test from "node:test"

import {
  buildReferenceGuidedV3CompositionManifest,
  sha256ExactUtf8,
  verifyExactReferenceGuidedPrompt,
} from "./reference-guided-v3-manifest.ts"

const dossierHash = `sha256:${"9".repeat(64)}`
const fact = (key, value, unit = null, scope = "PRODUCT_UNIT") => ({
  key, value, unit, scope, verificationStatus: "VERIFIED",
})
const authoritativeFactsPackage = {
  ready: true,
  factPackageHash: dossierHash,
  facts: [
    fact("exactProductName", "Exact colander"),
    fact("brand", "Calypso Basics"),
    fact("color", "White"),
    fact("condition", "New"),
    fact("material", "Powder coated enamel on steel"),
    fact("mpn", "08300"),
    fact("type", "Colander"),
    fact("netContent", "1.5", "quart"),
    fact("unitGrossWeight", 454, "g"),
    fact("unitCount", 1, "count"),
    fact("offerPackCount", 1, "count", "OFFER_PACK"),
    fact("unitsPerPack", 1, "count", "OFFER_PACK"),
    fact("totalUnitCount", 1, "count", "OFFER_PACK"),
  ],
}

function manifest() {
  return buildReferenceGuidedV3CompositionManifest({
    revisionId: "3a4a233e-d4bc-4a65-825f-c4882bceb9d1",
    strategyVersion: "VISUAL_STRATEGY_V3",
    revisionContract: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
    productDossierHash: dossierHash,
    marketVisualBriefHash: "8".repeat(64),
    sourcePackManifestHash: "7".repeat(64),
    mainSourceHash: "6".repeat(64),
    sideSourceHash: "5".repeat(64),
    authoritativeFactsPackage,
  })
}

test("every persisted prompt hash covers the exact final UTF-8 bytes", () => {
  const prepared = manifest()
  assert.equal(prepared.manifest.jobs.length, 6)
  for (const job of prepared.manifest.jobs) {
    assert.equal(job.promptHash, sha256ExactUtf8(job.exactPromptText))
    assert.equal(verifyExactReferenceGuidedPrompt(
      job.exactPromptText, job.promptHash,
    ), true)
    assert.equal(verifyExactReferenceGuidedPrompt(
      `${job.exactPromptText} `, job.promptHash,
    ), false)
  }
  assert.equal(
    prepared.compositionManifestHash,
    sha256ExactUtf8(prepared.compositionManifestText),
  )
})

test("six objectives are distinct, feasible and separate scene context from facts", () => {
  const jobs = manifest().manifest.jobs
  assert.equal(new Set(jobs.map((job) => job.commercialObjective)).size, 6)
  assert.ok(jobs.every((job) => job.allowedProductFacts.length > 0))
  assert.ok(jobs.every((job) => job.allowedGeneratedContext.length > 0))
  assert.ok(jobs.every((job) => job.prohibitedClaims.some((claim) =>
    /not present|Do not invent/i.test(claim))))
  const action = jobs.find((job) =>
    job.commercialObjective === "PRIMARY_BENEFIT_IN_ACTION")
  const human = jobs.find((job) =>
    job.commercialObjective === "REAL_HUMAN_USE")
  assert.match(action.exactPromptText, /Hands, water, and generic food may show/)
  assert.match(human.exactPromptText, /Human hands may hold or use/)
  assert.match(action.exactPromptText, /not included and do not prove performance/)
  assert.match(human.exactPromptText, /not offer contents or performance evidence/)
})

test("manifest rejects a dossier whose exact persisted hash does not match", () => {
  assert.throws(() => buildReferenceGuidedV3CompositionManifest({
    ...manifest().manifest,
    authoritativeFactsPackage: {
      ...authoritativeFactsPackage,
      factPackageHash: `sha256:${"0".repeat(64)}`,
    },
  }), /PRODUCT_DOSSIER_MISMATCH/)
})
