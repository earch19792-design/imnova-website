import assert from "node:assert/strict"
import test from "node:test"

import sharp from "sharp"

import {
  EBAY_IMAGE_TRANSFORMATION_VERSION,
  optimizeAuthorizedEbayMainImage,
} from "./ebay-image-optimization-service.ts"

async function whiteEnamelwareFixture() {
  return sharp({
    create: { width: 580, height: 580, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="580" height="580">' +
      '<path d="M95 150h390c-14 190-84 270-195 270S109 340 95 150z" fill="#f4f4f4" stroke="#707070" stroke-width="5"/>' +
      '<ellipse cx="290" cy="150" rx="195" ry="42" fill="#fafafa" stroke="#555" stroke-width="5"/>' +
      '<path d="M95 185H25M485 185h70" stroke="#606060" stroke-width="13" stroke-linecap="round"/>' +
      '<path d="M225 420h130l25 70H200z" fill="#f6f6f6" stroke="#707070" stroke-width="5"/>' +
      '<g fill="#9a9a9a"><circle cx="230" cy="300" r="7"/><circle cx="270" cy="315" r="7"/><circle cx="310" cy="315" r="7"/><circle cx="350" cy="300" r="7"/></g>' +
      '</svg>',
    ),
  }]).jpeg({ quality: 95 }).toBuffer()
}

test("preserves a white product on white instead of whitening away its pixels", async () => {
  const result = await optimizeAuthorizedEbayMainImage(
    await whiteEnamelwareFixture(),
  )
  assert.equal(EBAY_IMAGE_TRANSFORMATION_VERSION,
    "EBAY_MAIN_IMAGE_SAFE_WHITE_V2")
  assert.equal(result.transformation.backgroundMethod,
    "AUTHORIZED_SOURCE_FRAMED_CONTAIN")
  assert.equal(result.transformation.sourcePixelsTreatment,
    "PRESERVED_FULL_FRAME")
  assert.equal(result.qa.fullAuthorizedFramePreserved, true)
  assert.equal(result.qa.automaticStatus, "PARTIAL")
  assert.ok(result.qa.sourceCenterLightNeutralRatio >= 0.60)
  assert.ok(result.qa.sourceCenterChromaticRatio <= 0.08)
  assert.ok(result.qa.manualChecksRequired.includes(
    "SOURCE_BACKGROUND_PRESERVED_NOT_REMOVED",
  ))
})

test("keeps deterministic normalization for a clearly colored product", async () => {
  const source = await sharp({
    create: { width: 900, height: 900, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600">' +
      '<rect x="20" y="20" width="460" height="560" rx="30" fill="#f6d146"/>' +
      '</svg>',
    ),
    left: 200,
    top: 150,
  }]).jpeg().toBuffer()
  const result = await optimizeAuthorizedEbayMainImage(source)
  assert.equal(result.transformation.backgroundMethod,
    "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION")
  assert.equal(result.qa.fullAuthorizedFramePreserved, false)
  assert.ok(result.qa.sourceCenterLightNeutralRatio < 0.60)
  assert.ok(result.qa.sourceCenterChromaticRatio > 0.08)
})
