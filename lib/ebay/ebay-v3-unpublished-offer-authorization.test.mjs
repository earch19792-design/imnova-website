import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildV3UnpublishedAuthorizationIdempotencyKey,
  packageWithV3PublicationAssets,
  validateV3PublicationAssets,
  V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION,
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

test("reconciled authorization idempotency key binds package, preview, payload, account, and version", () => {
  const base = {
    listingPackageId: "34608f12-b90c-4241-ac11-3b86d20f0a3e",
    previewHash: "8bc69f0def356e908c4554f35b6777a1d2688523dadaadab88586f349bff8378",
    payloadHash: "35e96430eac76b66983eed6117864a3f65b6d45ec0c11ca303507e9cebd3ca32",
    targetAccountFingerprint: "cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
    actionVersion: V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION,
  }
  const key = buildV3UnpublishedAuthorizationIdempotencyKey(base)
  assert.match(key, /^v3-unpublished:[A-Z0-9_:-]+:[0-9a-f]{32}$/i)
  assert.equal(key, buildV3UnpublishedAuthorizationIdempotencyKey(base))
  assert.notEqual(
    key,
    buildV3UnpublishedAuthorizationIdempotencyKey({
      ...base,
      actionVersion: `${base.actionVersion}_NEXT`,
    }),
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
  assert.match(route, /EBAY_V3_APPROVAL_STATE_READ_FAILED/)
  assert.match(route, /reconcile_ebay_draft_only_approval_conflict/)
  assert.match(route, /buildV3UnpublishedAuthorizationIdempotencyKey/)
  assert.match(route, /V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION/)
  assert.match(route, /SCREEN_AND_PAYLOAD_AUTHORITY_RECONCILIATION/)
  assert.match(route, /screenConsistency/)
  assert.match(route, /exact_preview_hash/)
  assert.match(page, /Autorizar Inventory Item \+ Offer UNPUBLISHED/)
  assert.match(page, /Mostrar payload exacto completo/)
  assert.match(page, /authorizationScreenMatches/)
  assert.match(page, /title: String\(authorization\.title \?\? ""\)/)
  assert.match(page, /maskedSellerAccountId/)
  assert.match(gateway, /maskedSellerAccountId/)
  assert.match(execution, /EBAY_V3_PUBLICATION_TRANSPORT_NOT_CURRENT/)
  assert.doesNotMatch(
    route,
    /publishEbayOfferOnce|publishOffer\(/,
  )
})

test("authorization UI hydrates from the reconciled snapshot and does not auto-execute", () => {
  const page = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  assert.match(page, /Autorización registrada; ejecución pendiente\./)
  assert.match(page, /title: String\(authorization\.title \?\? ""\)/)
  assert.match(page, /aspects: Object\.fromEntries\(/)
  assert.match(page, /execution: null/)
  assert.doesNotMatch(
    page,
    /action: "execute"[\s\S]{0,300}authorizeExactV3UnpublishedOffer/,
  )
  assert.doesNotMatch(
    page,
    /Inventory Item y Offer creados y verificados como UNPUBLISHED/,
  )
})

test("command-center keeps final V3 workspace hydration alive when same-day package is not ready", () => {
  const commandCenter = readFileSync(
    "app/api/admin/ebay/command-center/route.ts",
    "utf8",
  )
  assert.match(commandCenter, /SAME_DAY_PUBLICATION_PACKAGE_NOT_READY/)
  assert.match(commandCenter, /loadFinalListingReviewPublicationGate/)
  assert.match(commandCenter, /sameDayContext = null/)
  assert.match(commandCenter, /save_package/)
})

test("reconciliation migration supersedes incompatible approvals append-only", () => {
  const migration = readFileSync(
    "supabase/migrations/20260723012000_supersede_incompatible_v3_unpublished_authorization.sql",
    "utf8",
  )
  assert.match(migration, /SUPERSEDED_BY_RECONCILIATION/)
  assert.match(migration, /PAYLOAD_RECONCILED_BEFORE_EBAY_WRITE/)
  assert.match(migration, /reconcile_ebay_draft_only_approval_conflict/)
  assert.match(migration, /ebay_draft_only_approval_reconciliation_events/)
  assert.match(migration, /action_version/)
  assert.match(migration, /target_account_fingerprint/)
})
