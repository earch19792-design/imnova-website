import assert from "node:assert/strict"
import test from "node:test"

import sharp from "sharp"

import {
  auditEbaySquareImagePresentation,
  EBAY_SQUARE_PRESENTATION_QA_VERSION,
} from "./ebay-image-square-presentation.ts"

async function productLayer() {
  return sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="1120">' +
    '<rect x="420" y="45" width="280" height="1030" rx="120" fill="#d8c6a2"/>' +
    '<rect x="445" y="300" width="230" height="520" rx="70" fill="#1f2937"/>' +
    '</svg>',
  )).png().toBuffer()
}

test("square presentation accepts a crisp, product-dominant eBay secondary", async () => {
  const layer = await productLayer()
  const output = await sharp({
    create: {
      width: 1600,
      height: 1600,
      channels: 3,
      background: "#eef2f4",
    },
  }).composite([{ input: layer, left: 240, top: 240 }])
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
  const audit = await auditEbaySquareImagePresentation({
    output,
    slot: "PACK_AND_COUNT",
    productCoverageRatio: .7,
    placement: { left: 240, top: 240, width: 1120, height: 1120 },
    sourceEffectiveLongSide: 1600,
    productPixelLongSide: 1120,
    placedProductLongSide: 1120,
    jpegQuality: 94,
    artificialFrameAdded: false,
  })
  assert.equal(audit.version, EBAY_SQUARE_PRESENTATION_QA_VERSION)
  assert.equal(audit.passed, true)
  assert.equal(audit.square1600Passed, true)
  assert.equal(audit.productFillPassed, true)
  assert.equal(audit.artificialInsetFrameFree, true)
  layer.fill(0)
  output.fill(0)
})

test("square presentation rejects the former supplier-photo-inside-a-card layout", async () => {
  const insetPhoto = await sharp({
    create: {
      width: 1120,
      height: 1120,
      channels: 3,
      background: "#d4d7db",
    },
  }).composite([{
    input: await productLayer(),
    left: 0,
    top: 0,
  }]).extend({
    top: 18,
    right: 18,
    bottom: 18,
    left: 18,
    background: "#ffffff",
  }).jpeg({ quality: 94 }).toBuffer()
  const output = await sharp({
    create: {
      width: 1600,
      height: 1600,
      channels: 3,
      background: "#e5e9ed",
    },
  }).composite([{ input: insetPhoto, left: 222, top: 222 }])
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
  const audit = await auditEbaySquareImagePresentation({
    output,
    slot: "KEY_FEATURES",
    productCoverageRatio: .7,
    placement: { left: 222, top: 222, width: 1156, height: 1156 },
    sourceEffectiveLongSide: 1600,
    productPixelLongSide: 1120,
    placedProductLongSide: 1120,
    jpegQuality: 94,
    artificialFrameAdded: true,
  })
  assert.equal(audit.passed, false)
  assert.equal(audit.artificialInsetFrameFree, false)
  assert.ok(audit.failureReasons.includes(
    "EBAY_ARTIFICIAL_INSET_FRAME_DETECTED",
  ))
  insetPhoto.fill(0)
  output.fill(0)
})

test("square presentation rejects small or excessively enlarged product sources", async () => {
  const layer = await productLayer()
  const output = await sharp({
    create: {
      width: 1600,
      height: 1600,
      channels: 3,
      background: "#ffffff",
    },
  }).composite([{ input: layer, left: 240, top: 240 }])
    .jpeg({ quality: 94 }).toBuffer()
  const audit = await auditEbaySquareImagePresentation({
    output,
    slot: "SECONDARY_6",
    productCoverageRatio: .7,
    placement: { left: 240, top: 240, width: 1120, height: 1120 },
    sourceEffectiveLongSide: 1000,
    productPixelLongSide: 800,
    placedProductLongSide: 1120,
    jpegQuality: 94,
    artificialFrameAdded: false,
  })
  assert.equal(audit.passed, false)
  assert.equal(audit.sourceQualityPassed, false)
  assert.ok(audit.failureReasons.includes(
    "EBAY_SOURCE_QUALITY_INSUFFICIENT",
  ))
  layer.fill(0)
  output.fill(0)
})
