import assert from "node:assert/strict"
import test from "node:test"

import sharp from "sharp"

import {
  disposeAuthorizedCatalogSourcePack,
  originalShopifyCatalogImageUrl,
  resolveLunaCatalogOriginalSourcePack,
} from "./luna-catalog-original-source-resolver.ts"

const calypsoUrl = "https://lunaportex.com/products/calypso-basics-by-reston-lloyd-powder-coated-enameled-colander-1-5-quart-white?variant=48809646489824"
const canonicalCalypso = "https://lunaportex.com/products/calypso-basics-by-reston-lloyd-powder-coated-enameled-colander-1-5-quart-white"
const productId = "9220835311840"
const variantId = "48809646489824"

async function image(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg({ quality: 95 })
    .toBuffer()
}

test("canonicalizes the Luna product and removes only Shopify thumbnail transforms", () => {
  assert.equal(
    originalShopifyCatalogImageUrl(
      "https://cdn.shopify.com/s/files/1/0001/colander_580x580@2x.jpg?v=17&width=580&crop=center",
    ),
    "https://cdn.shopify.com/s/files/1/0001/colander.jpg?v=17",
  )
  assert.equal(
    originalShopifyCatalogImageUrl(
      "https://lunaportex.com/cdn/shop/files/calypso_1_1024x1024.png?height=580&v=9",
    ),
    "https://lunaportex.com/cdn/shop/files/calypso_1.png?v=9",
  )
  assert.equal(originalShopifyCatalogImageUrl(
    "https://lunaportex.com.attacker.test/cdn/shop/files/a.jpg",
  ), null)
  assert.equal(originalShopifyCatalogImageUrl("http://cdn.shopify.com/a.jpg"), null)
})

test("Calypso regression discovers every original and never selects the rendered 580px thumbnail", async () => {
  const primary = await image(1800, 1800, "#f5f5f5")
  const alternate = await image(1600, 1200, "#e8e8e8")
  const detail = await image(1400, 1400, "#d8d8d8")
  const json = {
    id: Number(productId),
    handle: "calypso-basics-by-reston-lloyd-powder-coated-enameled-colander-1-5-quart-white",
    title: "Calypso Basics by Reston Lloyd Powder Coated Enameled Colander, 1.5 Quart, White",
    featured_image: "//cdn.shopify.com/s/files/1/0001/calypso-main_580x.png?v=11",
    images: [
      "https://cdn.shopify.com/s/files/1/0001/calypso-main_580x.png?v=11&width=580",
      { src: "https://lunaportex.com/cdn/shop/files/calypso-side_900x.jpg?v=12", alt: "alternate side angle" },
    ],
    media: [{ preview_image: {
      src: "https://cdn.shopify.com/s/files/1/0001/calypso-detail_1024x1024.jpg?v=13",
    }, alt: "material detail" }],
    variants: [{ id: Number(variantId), featured_image: {
      src: "https://cdn.shopify.com/s/files/1/0001/calypso-main_580x.png?v=11",
    } }],
  }
  const requested = []
  const fetchImpl = async (url, options) => {
    requested.push(String(url))
    assert.equal(options.redirect, "manual")
    if (String(url).endsWith(".js")) {
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (String(url) === canonicalCalypso) {
      return new Response(
        '<img srcset="https://cdn.shopify.com/s/files/1/0001/calypso-main_580x.png?v=11 580w, https://cdn.shopify.com/s/files/1/0001/calypso-main_1200x.png?v=11 1200w">' +
        '<a data-zoom-image="https://cdn.shopify.com/s/files/1/0001/calypso-detail_master.jpg?v=13"></a>',
        { status: 200, headers: { "content-type": "text/html" } },
      )
    }
    const bytes = String(url).includes("calypso-main") ? primary
      : String(url).includes("calypso-side") ? alternate
        : String(url).includes("calypso-detail") ? detail : null
    return bytes
      ? new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } })
      : new Response("missing", { status: 404 })
  }
  const pack = await resolveLunaCatalogOriginalSourcePack({
    productUrl: calypsoUrl,
    expectedProductId: productId,
    expectedVariantId: variantId,
    productIdentityHash: `sha256:${"1".repeat(64)}`,
    authorizationEvidenceHash: "2".repeat(64),
    marketVisualSignalsUsable: true,
    fetchImpl,
  })
  assert.equal(pack.productUrl, canonicalCalypso)
  assert.equal(pack.sourceAssetCount, 3)
  assert.equal(pack.largestNativeWidth, 1800)
  assert.equal(pack.precheck.ALL_CATALOG_MEDIA_INSPECTED, true)
  assert.equal(pack.precheck.SIX_SECONDARY_JOBS_FEASIBLE, true)
  assert.ok(pack.availableViewTypes.includes("ALTERNATE_AUTHORIZED_ANGLE"))
  assert.ok(pack.availableViewTypes.includes("DETAIL"))
  assert.ok(pack.sourceAssets.every((asset) =>
    Math.max(asset.nativeWidth, asset.nativeHeight) >= 1200))
  assert.ok(pack.sourceAssets.every((asset) =>
    !/_580x|_900x|_1024x|_master/i.test(new URL(asset.sourceUrl).pathname)))
  assert.ok(requested.some((url) => url.endsWith("calypso-main.png?v=11")))
  disposeAuthorizedCatalogSourcePack(pack)
  assert.ok(pack.sourceAssets.every((asset) => asset.buffer.every((byte) => byte === 0)))
  primary.fill(0)
  alternate.fill(0)
  detail.fill(0)
})

test("fails closed before image generation for identity mismatch or weak market evidence", async () => {
  const neverFetch = async () => { throw new Error("network must not run") }
  await assert.rejects(resolveLunaCatalogOriginalSourcePack({
    productUrl: calypsoUrl,
    expectedProductId: productId,
    expectedVariantId: variantId,
    productIdentityHash: `sha256:${"3".repeat(64)}`,
    authorizationEvidenceHash: "4".repeat(64),
    marketVisualSignalsUsable: false,
    fetchImpl: neverFetch,
  }), /MARKET_VISUAL_SIGNALS_INSUFFICIENT/)

  const payload = {
    id: 999,
    handle: "calypso-basics-by-reston-lloyd-powder-coated-enameled-colander-1-5-quart-white",
    images: ["https://cdn.shopify.com/s/files/1/0001/calypso.jpg"],
    variants: [{ id: Number(variantId) }],
  }
  await assert.rejects(resolveLunaCatalogOriginalSourcePack({
    productUrl: calypsoUrl,
    expectedProductId: productId,
    expectedVariantId: variantId,
    productIdentityHash: `sha256:${"5".repeat(64)}`,
    authorizationEvidenceHash: "6".repeat(64),
    marketVisualSignalsUsable: true,
    fetchImpl: async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  }), /LUNA_CATALOG_PRODUCT_IDENTITY_MISMATCH/)
})

test("uses the exact catalog snapshot when Shopify JSON is temporarily rate-limited", async () => {
  const original = await image(1600, 1600, "#eeeeee")
  const sourceUrl = "https://cdn.shopify.com/s/files/1/0001/calypso-main_580x.jpg?v=21&width=580"
  const pack = await resolveLunaCatalogOriginalSourcePack({
    productUrl: calypsoUrl,
    expectedProductId: productId,
    expectedVariantId: variantId,
    productIdentityHash: `sha256:${"7".repeat(64)}`,
    authorizationEvidenceHash: "8".repeat(64),
    marketVisualSignalsUsable: true,
    knownCatalogImageUrls: [sourceUrl],
    fetchImpl: async (url) => {
      if (String(url).endsWith(".js") || String(url) === canonicalCalypso) {
        return new Response("rate limited", { status: 429 })
      }
      assert.equal(String(url),
        "https://cdn.shopify.com/s/files/1/0001/calypso-main.jpg?v=21")
      return new Response(original, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })
    },
  })
  assert.equal(pack.sourceAssetCount, 1)
  assert.equal(pack.sourceAssets[0].qualityTier, "NATIVE_HIGH_RES")
  disposeAuthorizedCatalogSourcePack(pack)
  original.fill(0)
})

test("controlled enhancement is bounded to 2x and preserves native evidence separately", async () => {
  const source = await image(600, 600, "#e5e5e5")
  const payload = {
    id: Number(productId),
    handle: "calypso-basics-by-reston-lloyd-powder-coated-enameled-colander-1-5-quart-white",
    images: ["https://cdn.shopify.com/s/files/1/0001/calypso-600.jpg?v=31"],
    variants: [{ id: Number(variantId) }],
  }
  const pack = await resolveLunaCatalogOriginalSourcePack({
    productUrl: calypsoUrl,
    expectedProductId: productId,
    expectedVariantId: variantId,
    productIdentityHash: `sha256:${"9".repeat(64)}`,
    authorizationEvidenceHash: "a".repeat(64),
    marketVisualSignalsUsable: true,
    fetchImpl: async (url) => String(url).endsWith(".js")
      ? new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
      : String(url) === canonicalCalypso
        ? new Response("rate limited", { status: 429 })
        : new Response(source, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
  })
  const [asset] = pack.sourceAssets
  assert.equal(asset.qualityTier, "CONTROLLED_ENHANCEMENT")
  assert.equal(asset.enhancedDerivative, true)
  assert.equal(asset.nativeWidth, 600)
  assert.equal(asset.effectiveWidth, 1200)
  assert.notEqual(asset.sourceSha256, asset.enhancedSha256)
  disposeAuthorizedCatalogSourcePack(pack)
  source.fill(0)
})
