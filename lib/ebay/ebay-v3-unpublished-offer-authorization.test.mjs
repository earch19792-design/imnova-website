import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  packageWithV3PublicationAssets,
  validateV3PublicationAssets,
  V3_UNPUBLISHED_CONFIRMATION,
  v3AuthorizationHash,
  withV3FinalSetAuthorization,
} from "./ebay-v3-unpublished-offer-authorization.ts"

const roles = [
  "PRIMARY_MAIN",
  "SECONDARY_MATERIAL_DETAIL",
  "SECONDARY_PACKAGE_CONTENTS",
  "SECONDARY_SCALE_CAPACITY",
  "SECONDARY_USE_CONTEXT",
  "SECONDARY_ASPIRATIONAL_LIFESTYLE",
  "SECONDARY_HUMAN_CONTEXT",
]

const assets = roles.map((assetRole, position) => {
  const sha256 = String(position + 1).repeat(64)
  return {
    position,
    assetRole,
    sha256,
    sourceStoragePath: `private/${position}/${sha256}.png`,
    publicationStoragePath: `publication/${position}/${sha256}.png`,
    url: `https://example.invalid/publication/${position}/${sha256}.png`,
    mime: "image/png",
    width: 1600,
    height: 1600,
    bytes: 123,
  }
})

test("seven permanent image bindings are ordered with PRIMARY_MAIN first", () => {
  assert.equal(validateV3PublicationAssets(assets).length, 7)
  assert.equal(packageWithV3PublicationAssets({
    package_data: { imageUrls: ["https://legacy.invalid/v2.jpg"] },
  }, assets).package_data.imageUrls[0], assets[0].url)
  assert.throws(
    () => validateV3PublicationAssets([assets[1], assets[0], ...assets.slice(2)]),
    /EBAY_V3_PUBLICATION_TRANSPORT_INVALID/,
  )
  assert.throws(
    () => validateV3PublicationAssets(assets.map((asset, index) =>
      index === 6 ? { ...asset, url: `${asset.url}?token=expired` } : asset)),
    /EBAY_V3_PUBLICATION_TRANSPORT_INVALID/,
  )
})

test("payload binding is immutable and explicit authorization is unpublished-only", () => {
  const binding = {
    finalPreviewHash: "a".repeat(64),
    imageTransportHash: "b".repeat(64),
    selectedAssets: assets,
  }
  const payload = withV3FinalSetAuthorization({
    safety: {
      unpublishedOnly: true,
      publishOfferPresent: false,
      permittedOperations: ["createOrReplaceInventoryItem", "createOffer"],
    },
    compliance: {},
  }, binding)
  const hash = v3AuthorizationHash(payload)
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.notEqual(v3AuthorizationHash({
    ...payload,
    safety: { ...payload.safety, publishOfferPresent: true },
  }), hash)
  assert.equal(
    V3_UNPUBLISHED_CONFIRMATION,
    "AUTORIZAR INVENTORY ITEM Y OFFER UNPUBLISHED",
  )
})

test("route compensates copied objects and exposes one exact CTA", () => {
  const route = readFileSync(
    "app/api/admin/ebay/unpublished-offer-authorization/route.ts",
    "utf8",
  )
  const page = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  const execution = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts",
    "utf8",
  )
  const gateway = readFileSync(
    "lib/ebay/ebay-draft-only-gateway.ts",
    "utf8",
  )
  assert.match(route, /createdPaths/)
  assert.match(route, /\.remove\(createdPaths\)/)
  assert.match(route, /upsert: false/)
  assert.match(route, /confirmNoAutomaticRetry/)
  assert.match(route, /EBAY_V3_AUTHORIZATION_SUPERSEDED/)
  assert.match(route, /SCREEN_AND_PAYLOAD_AUTHORITY_RECONCILIATION/)
  assert.match(route, /screenConsistency/)
  assert.match(route, /exact_preview_hash/)
  assert.match(page, /Autorizar Inventory Item \+ Offer UNPUBLISHED/)
  assert.match(page, /Mostrar payload exacto completo/)
  assert.match(page, /authorizationScreenMatches/)
  assert.match(page, /fromPackage\(authoritativePackage\)/)
  assert.match(page, /maskedSellerAccountId/)
  assert.match(gateway, /maskedSellerAccountId/)
  assert.match(execution, /EBAY_V3_PUBLICATION_TRANSPORT_NOT_CURRENT/)
  assert.doesNotMatch(
    route,
    /publishEbayOfferOnce|publishOffer\(/,
  )
})
