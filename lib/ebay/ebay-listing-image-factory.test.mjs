import assert from "node:assert/strict"
import test from "node:test"

import sharp from "sharp"

import {
  composeAuthorizedEbayListingImageSet,
  EBAY_LISTING_IMAGE_SLOTS,
  getListingImageFactoryConfiguration,
  validateListingImageFactoryInput,
} from "./ebay-listing-image-factory.ts"

function input() {
  return {
    identityFingerprint: `sha256:${"a".repeat(64)}`,
    facts: {
      manufacturerBrand: "Lysol",
      normalizedProductName: "Lysol disinfecting wipes lemon",
      packCount: 3,
      unitCount: 15,
      size: "15 count",
      color: "yellow",
      scent: "lemon",
      variant: "disinfecting wipes",
      condition: "new",
    },
    briefs: EBAY_LISTING_IMAGE_SLOTS.map((slot) => ({
      slot,
      objective: `Verified objective for ${slot}`,
      overlayText: null,
      preserveOriginalPackage: true,
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
    })),
  }
}

async function authorizedFixture() {
  return sharp({
    create: { width: 900, height: 900, channels: 3, background: "#ffffff" },
  }).composite([{
    input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600">' +
      '<rect x="20" y="20" width="460" height="560" rx="30" fill="#f6d146"/>' +
      '<text x="250" y="270" text-anchor="middle" font-size="72" font-family="Arial">SOURCE</text>' +
      '<text x="250" y="360" text-anchor="middle" font-size="42" font-family="Arial">3 × 15</text>' +
      '</svg>',
    ),
    left: 200,
    top: 150,
  }]).jpeg().toBuffer()
}

test("composes exactly six JPEG assets from one authorized source", async () => {
  const source = await authorizedFixture()
  const assets = await composeAuthorizedEbayListingImageSet(source, input())
  assert.deepEqual(assets.map((asset) => asset.slot), EBAY_LISTING_IMAGE_SLOTS)
  assert.equal(new Set(assets.map((asset) => asset.outputSha256)).size, 6)
  assert.equal(new Set(assets.map((asset) => asset.sourceSha256)).size, 1)
  for (const asset of assets) {
    const metadata = await sharp(asset.output).metadata()
    assert.equal(metadata.format, "jpeg")
    assert.equal(metadata.width, 1600)
    assert.equal(metadata.height, 1600)
    assert.equal(asset.transformation.competitorImageUsed, false)
    assert.equal(asset.transformation.originalPackagePixelsPreserved, true)
    assert.equal(asset.qa.humanApprovalRequired, true)
  }
})

test("main image has pure-white corners and no promotional overlay", async () => {
  const assets = await composeAuthorizedEbayListingImageSet(
    await authorizedFixture(),
    input(),
  )
  const main = assets[0]
  const pixel = await sharp(main.output).extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw().toBuffer()
  assert.deepEqual([...pixel.slice(0, 3)], [255, 255, 255])
  assert.equal(main.slot, "MAIN_WHITE_BACKGROUND")
  assert.equal(main.qa.mainBackground, "PURE_WHITE")
})

test("rejects duplicated or missing image slots", () => {
  const value = input()
  value.briefs[5] = { ...value.briefs[5], slot: "PACK_AND_COUNT" }
  assert.throws(
    () => validateListingImageFactoryInput(value),
    /EBAY_IMAGE_SET_SLOTS_DUPLICATED/,
  )
})

test("rejects unapproved source policy and package-redraw briefs", () => {
  const unsafe = input()
  unsafe.briefs[0] = {
    ...unsafe.briefs[0],
    preserveOriginalPackage: false,
    sourcePolicy: "COMPETITOR_IMAGE",
  }
  assert.throws(() => validateListingImageFactoryInput(unsafe))
})

test("sanitized configuration never returns an OpenAI key", () => {
  const configuration = getListingImageFactoryConfiguration({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    OPENAI_API_KEY: "secret-that-must-not-be-returned",
    OPENAI_IMAGE_FACTORY_ENABLED: "false",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  })
  assert.equal(configuration.deterministicComposition, "READY")
  assert.equal(configuration.aiGeneration, "DISABLED")
  assert.equal(configuration.openAiKey, "PRESENT")
  assert.equal(JSON.stringify(configuration).includes("secret-that"), false)
  assert.equal(configuration.ebayWrites, 0)
})
