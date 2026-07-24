import assert from "node:assert/strict"
import test from "node:test"

import sharp from "sharp"

import {
  EBAY_IMAGE_TRANSFORMATION_VERSION,
  optimizeAuthorizedEbayMainImage,
  prepareAuthorizedEbaySecondaryForeground,
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
  const source = await whiteEnamelwareFixture()
  const result = await optimizeAuthorizedEbayMainImage(source)
  const secondaryForeground =
    await prepareAuthorizedEbaySecondaryForeground(source)
  assert.equal(EBAY_IMAGE_TRANSFORMATION_VERSION,
    "EBAY_MAIN_IMAGE_SAFE_WHITE_V2")
  assert.equal(result.transformation.backgroundMethod,
    "AUTHORIZED_SOURCE_FRAMED_CONTAIN")
  assert.equal(result.transformation.sourcePixelsTreatment,
    "PRESERVED_FULL_FRAME")
  assert.equal(result.qa.fullAuthorizedFramePreserved, true)
  assert.equal(result.qa.automaticStatus, "PASSED")
  assert.ok(result.qa.outputEdgeWhiteRatio >= 0.9)
  assert.ok(result.qa.productCoverageRatio >= 0.70)
  assert.ok(result.qa.productCoverageRatio <= 0.85)
  assert.equal(result.qa.productCoverageVerified, true)
  assert.ok(result.qa.sourceCenterLightNeutralRatio >= 0.60)
  assert.ok(result.qa.sourceCenterChromaticRatio <= 0.08)
  assert.ok(result.qa.manualChecksRequired.includes(
    "SOURCE_BACKGROUND_PRESERVED_NOT_REMOVED",
  ))
  assert.equal("secondaryForeground" in result, false)
  assert.ok(secondaryForeground)
  assert.equal(secondaryForeground.method,
    "EDGE_CONNECTED_LIGHT_NEUTRAL_V1")
  assert.equal(secondaryForeground.qa.transparentBorderRatio, 1)
  assert.equal(secondaryForeground.qa.protectedPixelRetentionRatio, 1)
  assert.equal(secondaryForeground.qa.opaqueCornerRatio, 0)
  const foreground = await sharp(secondaryForeground.output)
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cornerAlpha = foreground.data[3]
  const centerOffset = (
    Math.floor(foreground.info.height / 2) * foreground.info.width +
    Math.floor(foreground.info.width / 2)
  ) * foreground.info.channels
  assert.equal(cornerAlpha, 0)
  assert.equal(foreground.data[centerOffset + 3], 255)
  assert.ok(foreground.data[centerOffset] >= 235,
    "the enclosed white enamel body must stay opaque and white")
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
  const secondaryForeground =
    await prepareAuthorizedEbaySecondaryForeground(source)
  assert.equal(result.transformation.backgroundMethod,
    "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION")
  assert.equal(result.qa.fullAuthorizedFramePreserved, false)
  assert.ok(result.qa.sourceCenterLightNeutralRatio < 0.60)
  assert.ok(result.qa.sourceCenterChromaticRatio > 0.08)
  assert.ok(secondaryForeground)
  assert.equal(secondaryForeground.qa.transparentBorderRatio, 1)
})

test("fails closed when a photographic edge cannot be separated safely", async () => {
  const source = await sharp({
    create: { width: 900, height: 900, channels: 3, background: "#345678" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500">' +
      '<rect width="400" height="500" fill="#f6d146"/></svg>',
    ),
    left: 250,
    top: 200,
  }]).jpeg().toBuffer()
  assert.equal(await prepareAuthorizedEbaySecondaryForeground(source), null)
})

test("guarded padding recovers an isolated product that touches a white source edge", async () => {
  const source = await sharp({
    create: { width: 580, height: 580, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="580" height="580">' +
      '<path d="M0 95h275l195 195-195 195H0z" ' +
      'fill="#c9c9c9" stroke="#555555" stroke-width="9"/>' +
      '<circle cx="250" cy="290" r="62" fill="#dfb52f" stroke="#555555" stroke-width="7"/>' +
      '</svg>',
    ),
  }]).jpeg({ quality: 95 }).toBuffer()
  const foreground = await prepareAuthorizedEbaySecondaryForeground(source)
  assert.ok(foreground)
  assert.equal(foreground.method, "EDGE_CONNECTED_LIGHT_NEUTRAL_V1")
  assert.ok(foreground.qa.backgroundRemovalRatio >= .45)
  assert.equal(foreground.qa.transparentBorderRatio, 1)
  assert.equal(foreground.qa.protectedPixelRetentionRatio, 1)
  assert.equal(foreground.qa.opaqueCornerRatio, 0)
})

test("allows a narrow legitimate product handle to touch the source border", async () => {
  const source = await sharp({
    create: { width: 580, height: 580, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="580" height="580">' +
      '<ellipse cx="290" cy="290" rx="180" ry="145" fill="#f4f4f4" stroke="#555" stroke-width="5"/>' +
      '<path d="M110 260H0M470 260h110" stroke="#505050" stroke-width="7"/>' +
      '</svg>',
    ),
  }]).jpeg({ quality: 95 }).toBuffer()
  const foreground = await prepareAuthorizedEbaySecondaryForeground(source)
  assert.ok(foreground)
  assert.ok(foreground.qa.transparentBorderRatio >= .99)
  assert.ok(foreground.qa.transparentBorderRatio < .995)
  assert.equal(foreground.qa.opaqueCornerRatio, 0)
})

test("preserves an authorized native-alpha white product without color keying", async () => {
  const source = await sharp({
    create: {
      width: 700,
      height: 700,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500">' +
      '<circle cx="250" cy="250" r="210" fill="#ffffff" stroke="#777" stroke-width="8"/>' +
      '</svg>',
    ),
    left: 100,
    top: 100,
  }]).png().toBuffer()
  const foreground = await prepareAuthorizedEbaySecondaryForeground(source)
  assert.ok(foreground)
  assert.equal(foreground.method, "NATIVE_ALPHA")
  assert.equal(foreground.qa.protectedPixelRetentionRatio, 1)
  assert.equal(foreground.qa.transparentBorderRatio, 1)
  assert.equal(foreground.qa.opaqueCornerRatio, 0)
})

test("fails closed when native alpha hides an opaque white source rectangle", async () => {
  const source = await sharp({
    create: {
      width: 700,
      height: 700,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">' +
      '<rect width="600" height="600" fill="#ffffff"/>' +
      '<circle cx="300" cy="300" r="145" fill="#c84a42"/>' +
      '</svg>',
    ),
    left: 50,
    top: 50,
  }]).png().toBuffer()
  assert.equal(await prepareAuthorizedEbaySecondaryForeground(source), null)
})

test("fails closed instead of erasing a broad white product edge contact", async () => {
  const source = await sharp({
    create: { width: 600, height: 600, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">' +
      '<rect x="0" y="240" width="330" height="120" fill="#ffffff"/>' +
      '<path d="M0 240H330M0 360H330M330 240V360" ' +
      'stroke="#555555" stroke-width="8"/>' +
      '<circle cx="230" cy="300" r="24" fill="#777777"/>' +
      '</svg>',
    ),
  }]).png().toBuffer()
  assert.equal(await prepareAuthorizedEbaySecondaryForeground(source), null)
})

test("edge-connected matte protects near-white 249 enamel pixels", async () => {
  const source = await sharp({
    create: { width: 600, height: 600, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="440">' +
      '<rect x="18" y="18" width="404" height="404" rx="80" ' +
      'fill="#f9f9f9" stroke="#666666" stroke-width="8"/></svg>',
    ),
    left: 80,
    top: 80,
  }]).png().toBuffer()
  const foreground = await prepareAuthorizedEbaySecondaryForeground(source)
  assert.ok(foreground)
  assert.equal(foreground.method, "EDGE_CONNECTED_LIGHT_NEUTRAL_V1")
  const decoded = await sharp(foreground.output).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  const center = (
    Math.floor(decoded.info.height / 2) * decoded.info.width +
    Math.floor(decoded.info.width / 2)
  ) * decoded.info.channels
  assert.ok(decoded.data[center] >= 248 && decoded.data[center] <= 250)
  assert.equal(decoded.data[center + 3], 255)
  assert.equal(foreground.qa.protectedPixelRetentionRatio, 1)
})
