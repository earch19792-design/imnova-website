import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildV3UnpublishedAuthorizationIdempotencyKey,
  packageWithV3PublicationAssets,
  resolveV3UnpublishedAuthorizationPreflight,
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

test("read-only preflight distinguishes compatible, incompatible, and expired approvals", () => {
  const nowMs = Date.parse("2026-07-23T07:10:00.000Z")
  const authorizationPreview = {
    listingPackageId: "34608f12-b90c-4241-ac11-3b86d20f0a3e",
    revisionId: "3a4a233e-d4bc-4a65-825f-c4882bceb9d1",
    finalPreviewId: "fbd0e503-2844-4720-bda4-1ba07c26f619",
    status: "READY_FOR_HUMAN_AUTHORIZATION",
    invalidated: false,
    sourcePreviewHash: "d".repeat(64),
    exactPreviewHash: "e".repeat(64),
    payloadHash: "a".repeat(64),
    target: "PRODUCTION",
    accountFingerprint: "f".repeat(64),
    preflightExpiresAt: "2026-07-23T07:15:00.000Z",
    exactPayloadHashValid: true,
    authoritySnapshotHashValid: true,
    screenConsistencyValid: true,
  }
  const approval = {
    id: "7aebac22-6ef2-4f2d-893f-68b2c0acd674",
    listingPackageId: authorizationPreview.listingPackageId,
    status: "approved",
    payloadHash: authorizationPreview.payloadHash,
    target: authorizationPreview.target,
    accountFingerprint: authorizationPreview.accountFingerprint,
    expiresAt: "2026-07-23T07:20:00.000Z",
    consumedAt: null,
    revokedAt: null,
    approvedPayloadHashValid: true,
  }
  const compatible = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview,
    approval,
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: true,
    nowMs,
  })
  assert.equal(
    compatible.result,
    "READY_TO_RESUME_EXISTING_AUTHORIZATION",
  )
  assert.equal(compatible.activeApprovalReusable, true)

  const incompatible = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview,
    approval: { ...approval, payloadHash: "b".repeat(64) },
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: true,
    nowMs,
  })
  assert.equal(
    incompatible.result,
    "READY_FOR_NEW_HUMAN_AUTHORIZATION",
  )
  assert.equal(incompatible.reason, "ACTIVE_APPROVAL_PAYLOAD_MISMATCH")
  assert.equal(incompatible.activeApprovalReusable, false)

  const expired = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview: {
      ...authorizationPreview,
      preflightExpiresAt: "2026-07-23T07:05:00.000Z",
    },
    approval: {
      ...approval,
      expiresAt: "2026-07-23T07:05:00.000Z",
    },
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: true,
    nowMs,
  })
  assert.equal(expired.result, "READY_FOR_NEW_HUMAN_AUTHORIZATION")
  assert.equal(expired.reason, "AUTHORIZATION_PREFLIGHT_EXPIRED")
  assert.equal(expired.activeApprovalReusable, false)

  const corrupt = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview: {
      ...authorizationPreview,
      exactPayloadHashValid: false,
    },
    approval,
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: true,
    nowMs,
  })
  assert.equal(corrupt.result, "ERROR")
  assert.equal(corrupt.reason, "AUTHORIZATION_PREVIEW_INTEGRITY_INVALID")

  const wrongAccount = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview,
    approval,
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: "0".repeat(64),
    runtimeReady: true,
    nowMs,
  })
  assert.equal(wrongAccount.result, "ERROR")
  assert.equal(wrongAccount.reason, "TARGET_ACCOUNT_MISMATCH")

  const consumed = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview,
    approval: { ...approval, consumedAt: "2026-07-23T07:09:00.000Z" },
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: true,
    nowMs,
  })
  assert.equal(consumed.result, "ERROR")
  assert.equal(consumed.reason, "APPROVAL_ALREADY_CONSUMED")

  const approvalOnlyExpired = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview,
    approval: {
      ...approval,
      expiresAt: "2026-07-23T07:05:00.000Z",
    },
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: true,
    nowMs,
  })
  assert.equal(
    approvalOnlyExpired.result,
    "READY_FOR_NEW_HUMAN_AUTHORIZATION",
  )
  assert.equal(approvalOnlyExpired.reason, "ACTIVE_APPROVAL_EXPIRED")

  const invalidated = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview: { ...authorizationPreview, invalidated: true },
    approval,
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: true,
    nowMs,
  })
  assert.equal(invalidated.result, "ERROR")
  assert.equal(
    invalidated.reason,
    "AUTHORIZATION_PREVIEW_INTEGRITY_INVALID",
  )

  const runtimeDisabled = resolveV3UnpublishedAuthorizationPreflight({
    authorizationPreview,
    approval,
    expectedListingPackageId: authorizationPreview.listingPackageId,
    expectedRevisionId: authorizationPreview.revisionId,
    expectedFinalPreviewId: authorizationPreview.finalPreviewId,
    expectedSourcePreviewHash: authorizationPreview.sourcePreviewHash,
    runtimeTarget: authorizationPreview.target,
    runtimeAccountFingerprint: authorizationPreview.accountFingerprint,
    runtimeReady: false,
    nowMs,
  })
  assert.equal(runtimeDisabled.result, "ERROR")
  assert.equal(runtimeDisabled.reason, "EBAY_DRAFT_ONLY_RUNTIME_NOT_READY")
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
  const oneClickStart = page.indexOf(
    "<section data-v3-one-click-publication",
  )
  const oneClickEnd = page.indexOf(
    ": (v3ReviewAccessible || v3ReadyForPrepare)",
    oneClickStart,
  )
  const oneClickPanel = page.slice(oneClickStart, oneClickEnd)
  assert.match(route, /createdPaths/)
  assert.match(route, /\.remove\(createdPaths\)/)
  assert.match(route, /upsert: false/)
  assert.match(route, /confirmNoAutomaticRetry/)
  assert.match(route, /EBAY_V3_AUTHORIZATION_SUPERSEDED/)
  assert.match(route, /EBAY_V3_APPROVAL_STATE_READ_FAILED/)
  assert.match(route, /reconcile_ebay_draft_only_approval_conflict/)
  assert.match(route, /PAYLOAD_CHANGED_AFTER_LUNA_RECONFIRMATION/)
  assert.match(route, /authorizationMode/)
  assert.match(route, /changedFields/)
  assert.match(route, /buildV3UnpublishedAuthorizationIdempotencyKey/)
  assert.match(route, /V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION/)
  assert.match(route, /SCREEN_AND_PAYLOAD_AUTHORITY_RECONCILIATION/)
  assert.match(route, /screenConsistency/)
  assert.match(route, /exact_preview_hash/)
  assert.match(route, /readOnlyPreflight/)
  assert.match(route, /preflightResult/)
  assert.match(route, /approved_payload/)
  assert.match(
    route,
    /ebay_v3_unpublished_offer_authorization_invalidations/,
  )
  assert.ok(oneClickStart >= 0)
  assert.match(oneClickPanel, /PUBLICAR EN EBAY/)
  assert.match(oneClickPanel, /publishV3Automatically/)
  assert.match(oneClickPanel, /PublicationLaunchVisualizer/)
  assert.equal((oneClickPanel.match(/<button/g) ?? []).length, 1)
  assert.doesNotMatch(
    oneClickPanel,
    /Preparar nueva autorización|Autorizar Inventory Item|Reanudar Inventory Item|Preparar preview final/,
  )
  assert.match(page, /SELLER_OS_ONE_CLICK_PUBLICATION_V1/)
  assert.match(page, /confirmExactPayload: true/)
  assert.match(page, /confirmFinalPreview: true/)
  assert.match(page, /title: String\(authorization\.title \?\? ""\)/)
  assert.match(page, /maskedSellerAccountId/)
  assert.match(gateway, /maskedSellerAccountId/)
  assert.match(execution, /EBAY_V3_PUBLICATION_TRANSPORT_NOT_CURRENT/)
  assert.doesNotMatch(
    route,
    /publishEbayOfferOnce|publishOffer\(/,
  )
})

test("one-click journey visibly moves the real product through technological chambers", () => {
  const page = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  const visualizerStart = page.indexOf(
    "function PublicationLaunchVisualizer",
  )
  const visualizerEnd = page.indexOf(
    "function ListingWorkspaceLoading",
    visualizerStart,
  )
  const visualizer = page.slice(visualizerStart, visualizerEnd)
  assert.ok(visualizerStart >= 0)
  assert.match(visualizer, /data-publication-launch-visualizer/)
  assert.match(visualizer, /data-traveling-product/)
  assert.match(visualizer, /productImageUrl/)
  assert.match(visualizer, /<animateMotion/)
  assert.match(visualizer, /publication-circuit-grid/)
  assert.match(visualizer, /PUBLICATION_JOURNEY_STAGES\.map/)
  assert.match(visualizer, /T\+\{elapsed\}/)
  assert.match(page, /signedImages\.find\(\(asset\) => asset\.position === 0\)/)
  for (const phase of [
    "research",
    "identity",
    "visuals",
    "authorization",
    "draft",
    "preview",
    "publishing",
    "verifying",
    "complete",
  ]) {
    assert.match(page, new RegExp(`"${phase}"`))
  }
  assert.doesNotMatch(
    page.slice(
      page.indexOf("<section data-v3-one-click-publication"),
      page.indexOf(
        ": (v3ReviewAccessible || v3ReadyForPrepare)",
        page.indexOf("<section data-v3-one-click-publication"),
      ),
    ),
    /<dl className="grid grid-cols-3/,
  )
})

test("workspace hydration stays read-only until the one-click publication", () => {
  const page = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  const effectStart = page.indexOf(
    'setUnpublishedPreflightState("loading")',
  )
  const effectEnd = page.indexOf(
    "useEffect(() => {\n    if (!authorizationPayloadMatchesApproval)",
    effectStart,
  )
  const effect = page.slice(effectStart, effectEnd)
  assert.match(effect, /method: "GET"/)
  assert.match(effect, /"ready_resume"/)
  assert.match(effect, /"ready_new"/)
  assert.match(effect, /setUnpublishedPreflightState\("error"\)/)
  assert.doesNotMatch(effect, /action: "prepare"/)
  assert.match(page, /data-unpublished-preflight-state/)
  assert.match(page, /unpublishedPreflightRetry/)
  assert.match(page, /canonicalListingReadyUi\(draftState\.readiness\)/)
  assert.match(page, /data-canonical-ui-blockers/)
  assert.doesNotMatch(page, /La aprobación humana anterior venció/)
  assert.doesNotMatch(page, /El botón único volverá a prepararla/)
  assert.match(page, /requestV3UnpublishedAuthorization/)
  assert.match(page, /action: "prepare"/)
  assert.match(page, /action: "authorize"/)
  assert.match(page, /action: "execute"/)
  assert.match(page, /action: "prepare_publish"/)
  assert.match(page, /action: "publish"/)
  assert.doesNotMatch(
    page,
    /publicación y autorización final deshabilitadas|esta autorización realizará escrituras reales/,
  )
  assert.match(page, /setUnpublishedPreflightState\("error"\)/)
  assert.match(page, /supersededListingReadyMessage\(current\)/)
  assert.doesNotMatch(
    page,
    /Aprueba al menos una imagen autorizada\|Optimiza y aprueba/,
  )
})

test("GET preflight is read-only and does not reconcile or prepare", () => {
  const route = readFileSync(
    "app/api/admin/ebay/unpublished-offer-authorization/route.ts",
    "utf8",
  )
  const getStart = route.indexOf("export async function GET")
  const postStart = route.indexOf("export async function POST", getStart)
  const getHandler = route.slice(getStart, postStart)
  const helperStart = route.indexOf("async function readOnlyPreflight")
  const helperEnd = route.indexOf(
    "async function authorizeAndPrepareExecution",
    helperStart,
  )
  const readOnlyHelper = route.slice(helperStart, helperEnd)
  assert.match(getHandler, /readOnlyPreflight/)
  assert.doesNotMatch(
    `${readOnlyHelper}\n${getHandler}`,
    /\.insert\(|\.update\(|\.upsert\(|\.remove\(/,
  )
  assert.doesNotMatch(
    `${readOnlyHelper}\n${getHandler}`,
    /reconcile_ebay_draft_only_approval_conflict/,
  )
  assert.doesNotMatch(
    readOnlyHelper,
    /preflightEbayDraftOnlyMobile|preflightEbayDraftDependencies/,
  )
  assert.match(
    route,
    /activeApproval\.payload_hash === payloadHash\s+&& activeApprovalFresh/,
  )
  const prepareStart = route.indexOf("async function prepare")
  const prepareEnd = route.indexOf("function publicPreview", prepareStart)
  const prepareHandler = route.slice(prepareStart, prepareEnd)
  assert.match(
    prepareHandler,
    /else if \(activeApproval\.payload_hash !== payloadHash\)/,
  )
  assert.match(route, /_RENEW_\$\{/)
  assert.match(
    route,
    /return \{ approval: activeApproval, idempotentReplay: true \}/,
  )
})

test("authorization UI hydrates read-only and executes only from the one-click handler", () => {
  const page = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  assert.match(page, /unpublishedAuthorizationMode/)
  assert.match(page, /title: String\(authorization\.title \?\? ""\)/)
  assert.match(page, /aspects: Object\.fromEntries\(/)
  assert.match(page, /execution: null/)
  assert.match(page, /async function publishV3Automatically\(\)/)
  assert.match(page, /onClick=\{\(\) => void publishV3Automatically\(\)\}/)
  assert.equal((page.match(/publishV3Automatically\(\)/g) ?? []).length, 2)
})

test("V3 authorization refreshes Luna before deciding whether an approval is reusable", () => {
  const route = readFileSync(
    "app/api/admin/ebay/unpublished-offer-authorization/route.ts",
    "utf8",
  )
  const prepareStart = route.indexOf("async function prepare(actor: string)")
  const prepareEnd = route.indexOf("function publicPreview", prepareStart)
  const prepare = route.slice(prepareStart, prepareEnd)
  assert.match(prepare, /loadFreshSameDayPublicationContext\(context\)/)
  assert.match(prepare, /sameDayContext\.authorization/)
  assert.match(prepare, /sameDayContext\.opportunity/)
  assert.match(prepare, /preflightEbayDraftSkuCollision\(reservedSku\)/)
  assert.match(prepare, /skuPreflight\.safe/)
  assert.match(prepare, /preparationVerified: true/)
  assert.match(prepare, /serverPreflightRequiredAtExecution: true/)
  assert.ok(
    prepare.indexOf("loadFreshSameDayPublicationContext(context)")
      < prepare.indexOf("activeApproval.payload_hash === payloadHash"),
  )
  assert.ok(
    prepare.indexOf("preflightEbayDraftSkuCollision(reservedSku)")
      < prepare.indexOf("activeApproval.payload_hash === payloadHash"),
  )
  assert.doesNotMatch(
    prepare,
    /currentPreviewFresh[\s\S]*return \{\s*authorization: currentPreview/,
  )
  assert.match(route, /fetchPublicLunaProductForActiveListingMonitor/)
  assert.match(route, /maxAttempts: 3/)
  assert.match(route, /isRetryablePublicLunaFetchError/)
  assert.match(route, /record_ebay_v3_public_luna_preflight_v1/)
  assert.match(route, /observationHash/)
  assert.match(route, /EBAY_V3_PUBLIC_LUNA_RATE_LIMITED/)
  assert.match(route, /EBAY_V3_PUBLIC_LUNA_TEMPORARILY_UNAVAILABLE/)
  assert.match(route, /responseError\(error, 429, 60\)/)
  assert.match(route, /responseError\(error, 503, 5\)/)
  assert.match(route, /"Retry-After"/)
  assert.match(
    readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8"),
    /sourceAttempt < 2[\s\S]*EBAY_V3_PUBLIC_LUNA_RATE_LIMITED[\s\S]*EBAY_V3_PUBLIC_LUNA_TEMPORARILY_UNAVAILABLE[\s\S]*retryAfterSeconds \* 1_000/,
  )
})

test("same-day publication accepts only an exact locked seven-image V3 transport", () => {
  const loader = readFileSync(
    "lib/ebay/ebay-same-day-authorized-publication.ts",
    "utf8",
  )
  assert.match(loader, /approvedFinalV3ImageTransport/)
  assert.match(loader, /validateV3PublicationAssets\(transport\.assets\)/)
  assert.match(loader, /REFERENCE_GUIDED_SEVEN_ASSET_ROLES\[index\]/)
  assert.match(loader, /expectedTransportHash !== transport\.transport_hash/)
  assert.match(loader, /authoritativeSevenImageSetReady/)
  assert.match(loader, /REFERENCE_GUIDED_V3_FINAL_SET/)
  assert.match(loader, /automatedPublicObservationAvailable/)
  assert.match(loader, /LUNA_PUBLIC_PRODUCT_JSON/)
  assert.match(loader, /confirmedByActorRecorded === false/)
})

test("automated Luna preflight migration is V3-bound and performs zero eBay writes", () => {
  const migration = readFileSync(
    "supabase/migrations/20260723016000_automate_v3_public_luna_preflight.sql",
    "utf8",
  )
  const draftRoute = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts",
    "utf8",
  )
  assert.match(
    migration,
    /record_ebay_v3_public_luna_preflight_v1/,
  )
  assert.match(
    migration,
    /sync_ebay_v3_source_before_authorized_publication/,
  )
  assert.match(migration, /ebay_reference_guided_final_listing_review_previews/)
  assert.match(migration, /ebay_v3_publication_image_transports/)
  assert.match(migration, /image_count = 7/)
  assert.match(migration, /LUNA_PUBLIC_PRODUCT_JSON/)
  assert.match(migration, /'ebayWrites', 0/)
  assert.doesNotMatch(
    migration,
    /createOrReplaceInventoryItem|createOffer|publishOffer|api\.ebay\.com/,
  )
  assert.match(
    draftRoute,
    /sync_ebay_v3_source_before_authorized_publication/,
  )
  assert.match(
    draftRoute,
    /sync_same_day_source_before_authorized_publication/,
  )
})

test("V3 Luna repreflight permits only proven retired pre-write executions", () => {
  const migration = readFileSync(
    "supabase/migrations/20260723019000_allow_proven_prewrite_v3_luna_repreflight.sql",
    "utf8",
  )
  assert.match(
    migration,
    /execution\.phase = 'terminal_failure'/,
  )
  assert.match(
    migration,
    /EBAY_PREFLIGHT_HEADER_CONTRACT_MIGRATED_BEFORE_WRITE/,
  )
  assert.match(
    migration,
    /preflightHeaderContractMigrated/,
  )
  assert.match(
    migration,
    /inventoryErrorIds' = '\["25709"\]'::jsonb/,
  )
  for (const field of [
    "inventory_http_status",
    "inventory_confirmed_at",
    "offer_create_started_at",
    "offer_http_status",
    "offer_id",
    "completed_at",
    "lease_token",
    "lease_expires_at",
  ]) {
    assert.match(migration, new RegExp(`execution\\.${field} is null`))
  }
  assert.match(
    migration,
    /from public\.ebay_authorized_listing_publications publication/,
  )
  assert.match(
    migration,
    /EBAY_V3_PUBLIC_LUNA_PREFLIGHT_EXECUTION_EXISTS/,
  )
  assert.doesNotMatch(
    migration,
    /createOrReplaceInventoryItem|createOffer|publishOffer|api\.ebay\.com/,
  )
})

test("V3 package image authority survives legacy saves and repairs prior drift", () => {
  const migration = readFileSync(
    "supabase/migrations/20260723015000_protect_v3_listing_package_image_authority.sql",
    "utf8",
  )
  assert.match(
    migration,
    /create or replace function public\.enforce_ebay_v3_listing_package_image_authority/,
  )
  assert.match(
    migration,
    /before update on public\.ebay_listing_packages/,
  )
  assert.match(migration, /ebay_v3_publication_image_transports/)
  assert.match(migration, /status = 'READY'/)
  assert.match(migration, /image_count = 7/)
  assert.match(migration, /'\{imageUrls\}'/)
  assert.match(migration, /'\{imageAssetManifest\}'/)
  assert.match(migration, /approvedImageUrls/)
  assert.match(migration, /ebay_v3_listing_package_reconciliations/)
  assert.match(migration, /on conflict do nothing/)
  assert.match(
    migration,
    /update public\.ebay_listing_packages package[\s\S]*set package_data = package\.package_data/,
  )
  assert.doesNotMatch(
    migration,
    /createOrReplaceInventoryItem|createOffer|publishOffer|api\.ebay\.com/,
  )
})

test("command-center keeps final V3 workspace hydration alive when same-day package is not ready", () => {
  const commandCenter = readFileSync(
    "app/api/admin/ebay/command-center/route.ts",
    "utf8",
  )
  assert.match(commandCenter, /SAME_DAY_PUBLICATION_PACKAGE_NOT_READY/)
  assert.match(commandCenter, /loadFinalListingReviewPublicationGate/)
  assert.match(commandCenter, /resolveCommandCenterCommercialFreshness/)
  assert.match(commandCenter, /finalListingReviewReady = freshnessResolution\.finalListingReviewReady/)
  assert.match(commandCenter, /save_package/)
})

test("legacy draft GET stays read-only and hydrates a completed final V3 review", () => {
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts",
    "utf8",
  )
  const getStart = route.indexOf("export async function GET")
  const postStart = route.indexOf("export async function POST", getStart)
  const getHandler = route.slice(getStart, postStart)
  const contextStart = route.indexOf("async function loadPackageContext")
  const contextEnd = route.indexOf(
    "function serverApprovedConfiguration",
    contextStart,
  )
  const contextLoader = route.slice(contextStart, contextEnd)
  assert.match(contextLoader, /allowFinalV3ReadOnlyFallback = false/)
  assert.match(
    contextLoader,
    /isCommandCenterCommercialFreshnessRecheck\(errorCode\(contextError\)\)/,
  )
  assert.match(contextLoader, /loadFinalListingReviewPublicationGate/)
  assert.match(contextLoader, /if \(!finalReviewGate\.allowed\) throw contextError/)
  assert.match(
    getHandler,
    /collisionSelfLineage,\s+true,/,
  )
  assert.doesNotMatch(
    getHandler,
    /\.insert\(|\.update\(|\.upsert\(|\.remove\(/,
  )
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
