import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import {
  persistAuthorizedCatalogSourcePack,
} from "./luna-catalog-source-pack-persistence.ts"

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sourcePack(nativeBuffer, enhancedBuffer = null) {
  const sourceSha256 = sha256(nativeBuffer)
  const enhancedSha256 = enhancedBuffer ? sha256(enhancedBuffer) : null
  const asset = {
    sourceImageId: `LUNA_CATALOG:${sourceSha256}`,
    sourceAngle: "FRONT",
    productId: "9220835311840",
    variantId: "48809646489824",
    sourceUrl: "https://cdn.shopify.com/product.jpg",
    nativeWidth: 580,
    nativeHeight: 580,
    contentType: "image/jpeg",
    sha256: enhancedSha256 ?? sourceSha256,
    viewClassification: "PRIMARY",
    qualityTier: enhancedBuffer
      ? "CONTROLLED_ENHANCEMENT" : "NATIVE_HIGH_RES",
    selectedForSlots: ["MAIN_WHITE_BACKGROUND"],
    authorizationStatus: "AUTHORIZED_CATALOG",
    enhancedDerivative: Boolean(enhancedBuffer),
    sourceSha256,
    enhancedSha256,
    effectiveWidth: enhancedBuffer ? 1160 : 1600,
    effectiveHeight: enhancedBuffer ? 1160 : 1600,
    excludedSourceSha256s: [],
    nativeBuffer,
    buffer: enhancedBuffer ?? nativeBuffer,
  }
  return {
    productId: asset.productId,
    productIdentityHash: `sha256:${"1".repeat(64)}`,
    productUrl: "https://lunaportex.com/products/test-product",
    sourceAssets: [asset],
    sourceAssetCount: 1,
    largestNativeWidth: asset.nativeWidth,
    largestNativeHeight: asset.nativeHeight,
    galleryCoverage: "SINGLE_VIEW",
    availableViewTypes: ["PRIMARY"],
    authorizationEvidenceHash: "2".repeat(64),
    resolverVersion: "LUNA_CATALOG_ORIGINAL_SOURCE_RESOLVER_V2",
    discoveredCandidateCount: 1,
    inspectedCandidateCount: 1,
    precheck: {
      CATALOG_ORIGINAL_DISCOVERY_COMPLETED: true,
      ALL_CATALOG_MEDIA_INSPECTED: true,
      PRODUCT_IDENTITY_MATCHED: true,
      SOURCE_PACK_READY: true,
      SIX_SECONDARY_JOBS_FEASIBLE: true,
      MARKET_VISUAL_SIGNALS_USABLE: true,
    },
  }
}

function persistenceInput(supabase, pack) {
  return {
    supabase,
    accountKey: "EBAY_US:TEST",
    actorId: "00000000-0000-4000-8000-000000000001",
    listingPackageId: "00000000-0000-4000-8000-000000000002",
    candidateId: "00000000-0000-4000-8000-000000000003",
    marketRadarProductId: "00000000-0000-4000-8000-000000000004",
    supplierVariantId: "48809646489824",
    factPackageHash: `sha256:${"3".repeat(64)}`,
    pack,
  }
}

function database(inserted) {
  return {
    from() {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          return { data: null, error: null }
        },
        async insert(value) {
          inserted.push(value)
          return { error: null }
        },
      }
    },
  }
}

test("reuses byte-identical content-addressed objects on a retry", async () => {
  const native = Buffer.from("authorized native catalog bytes")
  const enhanced = Buffer.from("authorized enhanced catalog bytes")
  const pack = sourcePack(native, enhanced)
  const byHash = new Map([
    [sha256(native), native],
    [sha256(enhanced), enhanced],
  ])
  const inserted = []
  const removed = []
  const uploads = []
  const supabase = {
    ...database(inserted),
    storage: {
      from() {
        return {
          async upload(path) {
            uploads.push(path)
            return {
              data: null,
              error: {
                statusCode: "409",
                message: "The resource already exists",
              },
            }
          },
          async download(path) {
            const hash = path.match(/[0-9a-f]{64}/)?.[0]
            const bytes = byHash.get(hash)
            return bytes
              ? { data: new Blob([bytes]), error: null }
              : { data: null, error: { message: "missing" } }
          },
          async remove(paths) {
            removed.push(...paths)
            return { data: [], error: null }
          },
        }
      },
    },
  }
  const result = await persistAuthorizedCatalogSourcePack(
    persistenceInput(supabase, pack),
  )
  assert.match(result.packId, /^[0-9a-f-]{36}$/i)
  assert.equal(uploads.length, 2)
  assert.equal(inserted.length, 1)
  assert.deepEqual(removed, [])
  native.fill(0)
  enhanced.fill(0)
})

test("fails closed when an existing content-addressed object has different bytes", async () => {
  const native = Buffer.from("authorized native catalog bytes")
  const collision = Buffer.from("different! native catalog bytes")
  assert.equal(native.length, collision.length)
  const pack = sourcePack(native)
  const inserted = []
  const removed = []
  const supabase = {
    ...database(inserted),
    storage: {
      from() {
        return {
          async upload() {
            return {
              data: null,
              error: { status: 409, message: "Duplicate" },
            }
          },
          async download() {
            return { data: new Blob([collision]), error: null }
          },
          async remove(paths) {
            removed.push(...paths)
            return { data: [], error: null }
          },
        }
      },
    },
  }
  await assert.rejects(
    persistAuthorizedCatalogSourcePack(
      persistenceInput(supabase, pack),
    ),
    /LUNA_CATALOG_SOURCE_PACK_STORAGE_HASH_MISMATCH/,
  )
  assert.equal(inserted.length, 0)
  assert.deepEqual(removed, [])
  native.fill(0)
  collision.fill(0)
})
