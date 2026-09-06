import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  MAYEL_TRADING_PROTECTED_FIELDS,
  MAYEL_TRADING_VISUAL_EXECUTOR_V1,
  MAYEL_TRADING_VISUAL_WRITE_OPERATION,
  assertMayelTradingProtectedFieldsUnchangedV1,
  buildDelegatedMayelTradingPictureSetV1,
  buildExactMayelTradingPictureSetV1,
  buildMayelTradingVisualDryRunV1,
  buildMayelTradingVisualIdempotencyBindingV1,
  buildReviseFixedPriceItemPicturesOnlyXmlV1,
  prepareMayelAssetWithEbayMediaV1,
  reviseMayelTradingPicturesOnceV1,
} = await import("./ebay-mayel-trading-visual-executor-v1.ts")

const accountKey = `seller:${"a".repeat(64)}`
const itemId = "366643122092"
const manifestId = "d6bf2069-4421-4cd8-ba27-5f7a1a6917b7"
const manifestDigest = `sha256:${"b".repeat(64)}`
const claimToken = "33333333-3333-4333-8333-333333333333"
const idempotencyBindingDigest = `sha256:${"c".repeat(64)}`
const hero = "https://i.ebayimg.com/images/g/current/s-l1600.jpg?set_id=1"
const mayel = "https://project.supabase.co/storage/v1/object/public/ebay-listing-images/mayel-visual/task/asset.jpg"
const mayelEps = "https://i.ebayimg.com/images/g/mayel/s-l1600.jpg"

function base(overrides = {}) {
  const expectedCurrentImageDigest = "sha256:a2157a630ffb70e490c6bc554939ace87833a0279ecafcdea9fcf236c376e8fc"
  return {
    accountKey, itemId, manifestId, manifestDigest,
    managementModel: "TRADING_MANAGED",
    correctEbayApi: "TRADING_API",
    accountIdentityProven: true,
    listingIdentityProven: true,
    listingActive: true,
    manifestValid: true,
    visualOnlyDiff: true,
    unauthorizedFieldDiffs: [],
    currentOfficialImageUrls: [hero],
    expectedCurrentImageDigest,
    proposedSourceImageUrls: [hero, mayel],
    mayelAssetUrl: mayel,
    mayelAssetAuthorized: true,
    approvedMayelStorageUrl: (url) => url === mayel,
    pictureSource: "EPS",
    mediaPreparationAvailable: true,
    mediaPreparationAuthorized: true,
    durableReviseAttemptCount: 0,
    ...overrides,
  }
}

test("Trading-managed fixed-price visual plan routes only to ReviseFixedPriceItem", () => {
  const plan = buildMayelTradingVisualDryRunV1(base())
  assert.equal(plan.executorRoute, MAYEL_TRADING_VISUAL_EXECUTOR_V1)
  assert.equal(plan.tradingVisualWriteOperation,
    MAYEL_TRADING_VISUAL_WRITE_OPERATION)
  assert.equal(plan.allowedDiffDomain, "PICTURE_DETAILS_ONLY")
  assert.equal(plan.pictureSetWriteSemantics, "FULL_ORDERED_REPLACEMENT")
  assert.equal(plan.mainImageSemantics, "PICTURE_URL_POSITION_1")
  assert.equal(plan.currentImageCount, 1)
  assert.equal(plan.proposedImageCount, 2)
  assert.equal(plan.currentHeroPreserved, true)
  assert.equal(plan.safeToExecuteVisualChange, true)
  assert.equal(plan.finalIdempotencyBindingReady, false)
})

test("Inventory-managed listings never route to the Trading executor", () => {
  const plan = buildMayelTradingVisualDryRunV1(base({
    managementModel: "INVENTORY_API_MANAGED", correctEbayApi: "INVENTORY_API",
  }))
  assert.equal(plan.safeToExecuteVisualChange, false)
  assert.equal(plan.blocker, "MAYEL_TRADING_VISUAL_WRONG_MANAGEMENT_ROUTE")
})

test("exact set preserves current hero at position one and appends prepared Mayel EPS asset", () => {
  const set = buildExactMayelTradingPictureSetV1({
    currentOfficialImageUrls: [hero],
    proposedSourceImageUrls: [hero, mayel],
    mayelAssetUrl: mayel,
    preparedMayelEpsUrl: mayelEps,
  })
  assert.deepEqual(set.pictureUrls, [hero, mayelEps])
  assert.equal(set.mainImageUnchanged, true)
  assert.equal(set.mayelAssetPresent, true)
  assert.equal(set.pictureSource, "EPS")
  const binding = buildMayelTradingVisualIdempotencyBindingV1({ accountKey,
    itemId, manifestId, manifestDigest,
    beforeImageDigest: base().expectedCurrentImageDigest,
    proposedImageDigest: set.imageSetDigest })
  assert.match(binding, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(binding, buildMayelTradingVisualIdempotencyBindingV1({
    accountKey, itemId, manifestId, manifestDigest,
    beforeImageDigest: set.imageSetDigest,
    proposedImageDigest: base().expectedCurrentImageDigest,
  }))
})

test("order changes and duplicate URLs fail the exact picture set", () => {
  assert.throws(() => buildExactMayelTradingPictureSetV1({
    currentOfficialImageUrls: [hero],
    proposedSourceImageUrls: [mayel, hero], mayelAssetUrl: mayel,
    preparedMayelEpsUrl: mayelEps,
  }), /MAYEL_TRADING_VISUAL_EXACT_SET_INVALID/)
  assert.throws(() => buildExactMayelTradingPictureSetV1({
    currentOfficialImageUrls: [hero],
    proposedSourceImageUrls: [hero, mayel], mayelAssetUrl: mayel,
    preparedMayelEpsUrl: hero,
  }), /MAYEL_TRADING_VISUAL_EXACT_SET_INVALID/)
})

test("delegated ordered set supports multiple assets and an authorized hero change", () => {
  const second = `${mayel}?asset=2`
  const secondEps = `${mayelEps}?asset=2`
  const set = buildDelegatedMayelTradingPictureSetV1({
    currentOfficialImageUrls: [hero],
    proposedSourceImageUrls: [mayel, second, hero],
    preparedAssets: [
      { sourceUrl: mayel, epsImageUrl: mayelEps },
      { sourceUrl: second, epsImageUrl: secondEps },
    ],
  })
  assert.deepEqual(set.pictureUrls, [mayelEps, secondEps, hero])
  assert.equal(set.mainImageChanged, true)
  assert.equal(set.preparedAssetCount, 2)
})

test("delegated ordered set rejects missing preparation and silent reorder collisions", () => {
  assert.throws(() => buildDelegatedMayelTradingPictureSetV1({
    currentOfficialImageUrls: [hero],
    proposedSourceImageUrls: [mayel],
    preparedAssets: [],
  }), /MAYEL_TRADING_VISUAL_DELEGATED_SET_INVALID/)
  assert.throws(() => buildDelegatedMayelTradingPictureSetV1({
    currentOfficialImageUrls: [hero],
    proposedSourceImageUrls: [mayel, mayel],
    preparedAssets: [{ sourceUrl: mayel, epsImageUrl: mayelEps }],
  }), /MAYEL_TRADING_VISUAL_DELEGATED_SET_INVALID/)
})

test("mixed hosting is rejected while an EPS-safe route is accepted", () => {
  const mixed = buildMayelTradingVisualDryRunV1(base({
    currentOfficialImageUrls: ["https://seller.example/image.jpg"],
    proposedSourceImageUrls: ["https://seller.example/image.jpg", mayel],
    expectedCurrentImageDigest:
      "sha256:9dcbb34eaf8b11324e2d161c5b1d0e19f464bd55aaeaf9153970d832608a5046",
    pictureSource: "Vendor",
  }))
  assert.equal(mixed.safeToExecuteVisualChange, false)
  assert.equal(mixed.blocker, "MAYEL_TRADING_VISUAL_MIXED_HOSTING_BLOCKED")
  const eps = buildMayelTradingVisualDryRunV1(base())
  assert.equal(eps.mayelAssetHostClassBefore, "APPROVED_MAYEL_STORAGE")
  assert.equal(eps.mayelAssetHostClassForWrite, "EBAY_EPS")
  assert.equal(eps.proposedImageSetValid, true)
})

test("fresh official digest mismatch requires safe rebase and never writes", () => {
  const plan = buildMayelTradingVisualDryRunV1(base({
    expectedCurrentImageDigest: `sha256:${"0".repeat(64)}`,
  }))
  assert.equal(plan.safeToExecuteVisualChange, false)
  assert.equal(plan.blocker, "SAFE_REBASE_REQUIRED")
})

test("invalid manifest and unproven identity fail closed", () => {
  assert.equal(buildMayelTradingVisualDryRunV1(base({ manifestValid: false }))
    .blocker, "MAYEL_TRADING_VISUAL_MANIFEST_INVALID")
  assert.equal(buildMayelTradingVisualDryRunV1(base({
    accountIdentityProven: false,
  })).blocker, "MAYEL_TRADING_VISUAL_IDENTITY_UNPROVEN")
  assert.equal(buildMayelTradingVisualDryRunV1(base({
    listingIdentityProven: false,
  })).blocker, "MAYEL_TRADING_VISUAL_IDENTITY_UNPROVEN")
})

test("every protected non-visual field difference blocks", () => {
  for (const field of MAYEL_TRADING_PROTECTED_FIELDS) {
    const plan = buildMayelTradingVisualDryRunV1(base({
      unauthorizedFieldDiffs: [field],
    }))
    assert.equal(plan.safeToExecuteVisualChange, false, field)
    assert.equal(plan.blocker,
      "MAYEL_TRADING_VISUAL_NON_VISUAL_DIFF_BLOCKED", field)
    assert.equal(plan.unauthorizedFieldDiffCount, 1, field)
  }
  assert.throws(() => assertMayelTradingProtectedFieldsUnchangedV1({
    differences: ["PRICE"],
  }), /MAYEL_TRADING_VISUAL_NON_VISUAL_DIFF_BLOCKED/)
  assert.equal(assertMayelTradingProtectedFieldsUnchangedV1({ differences: [] })
    .protectedFieldsUnchanged, true)
})

test("generated Trading request contains only ItemID and PictureDetails", () => {
  const xml = buildReviseFixedPriceItemPicturesOnlyXmlV1({ itemId,
    pictureUrls: [hero, mayelEps] })
  assert.match(xml, /<ReviseFixedPriceItemRequest/)
  assert.match(xml, /<ItemID>366643122092<\/ItemID>/)
  assert.match(xml, /<PictureDetails><PictureSource>EPS<\/PictureSource>/)
  assert.equal((xml.match(/<PictureURL>/g) ?? []).length, 2)
  for (const field of ["Title", "StartPrice", "Quantity", "PrimaryCategory",
    "ConditionID", "SKU", "Description", "ItemSpecifics",
    "SellerProfiles", "ShippingDetails", "ReturnPolicy", "PaymentMethods"]) {
    assert.doesNotMatch(xml, new RegExp(`<${field}[ >]`), field)
  }
})

test("second durable Revise attempt is blocked before network", async () => {
  let calls = 0
  await assert.rejects(() => reviseMayelTradingPicturesOnceV1({
    accessToken: "token", itemId, pictureUrls: [hero, mayelEps],
    durableReviseAttemptCount: 1,
    idempotencyBindingDigest,
    durableSingleWriteClaim: { claimed: true, claimToken,
      idempotencyBindingDigest, reviseCallOrdinal: 1 },
    fetchImpl: async () => { calls += 1; return new Response() },
  }), /MAYEL_TRADING_VISUAL_SECOND_WRITE_BLOCKED/)
  assert.equal(calls, 0)
})

test("Revise dispatch requires the exact durable atomic claim", async () => {
  let calls = 0
  await assert.rejects(() => reviseMayelTradingPicturesOnceV1({
    accessToken: "token", itemId, pictureUrls: [hero, mayelEps],
    durableReviseAttemptCount: 0, idempotencyBindingDigest,
    durableSingleWriteClaim: { claimed: true, claimToken,
      idempotencyBindingDigest: `sha256:${"d".repeat(64)}`,
      reviseCallOrdinal: 1 },
    fetchImpl: async () => { calls += 1; return new Response() },
  }), /MAYEL_TRADING_VISUAL_DURABLE_CLAIM_REQUIRED/)
  assert.equal(calls, 0)
})

test("ambiguous first write is never retried and requires official readback", async () => {
  let calls = 0
  const result = await reviseMayelTradingPicturesOnceV1({
    accessToken: "token", itemId, pictureUrls: [hero, mayelEps],
    durableReviseAttemptCount: 0,
    idempotencyBindingDigest,
    durableSingleWriteClaim: { claimed: true, claimToken,
      idempotencyBindingDigest, reviseCallOrdinal: 1 },
    fetchImpl: async () => {
      calls += 1
      return new Response("", { status: 503 })
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, "AMBIGUOUS")
  assert.equal(result.reviseCallCount, 1)
  assert.equal(result.retryAllowed, false)
  assert.equal(result.readbackRequired, true)
})

test("accepted Revise call remains exactly one and requires official readback", async () => {
  let calls = 0
  const result = await reviseMayelTradingPicturesOnceV1({
    accessToken: "token", itemId, pictureUrls: [hero, mayelEps],
    durableReviseAttemptCount: 0,
    idempotencyBindingDigest,
    durableSingleWriteClaim: { claimed: true, claimToken,
      idempotencyBindingDigest, reviseCallOrdinal: 1 },
    fetchImpl: async (_url, init) => {
      calls += 1
      assert.equal(init.headers["X-EBAY-API-CALL-NAME"],
        "ReviseFixedPriceItem")
      return new Response("<ReviseFixedPriceItemResponse><Ack>Success</Ack></ReviseFixedPriceItemResponse>",
        { status: 200 })
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, "ACCEPTED")
  assert.equal(result.retryAllowed, false)
  assert.equal(result.readbackRequired, true)
})

test("Media API route creates from URL then reads back an EPS URL", async () => {
  const calls = []
  const prepared = await prepareMayelAssetWithEbayMediaV1({
    accessToken: "token", sourceImageUrl: mayel,
    approvedMayelStorageUrl: (url) => url === mayel,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET" })
      if (String(url).endsWith("/create_image_from_url")) {
        return Response.json({ imageUrl: mayelEps }, { status: 201,
          headers: { location:
            "https://apim.ebay.com/commerce/media/v1_beta/image/image_123" } })
      }
      return Response.json({ imageUrl: mayelEps,
        expirationDate: "2026-10-01T00:00:00Z" })
    },
  })
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"])
  assert.match(calls[0].url, /commerce\/media\/v1_beta\/image\/create_image_from_url$/)
  assert.equal(prepared.imageId, "image_123")
  assert.equal(prepared.epsImageUrl, mayelEps)
})

test("Media API accepts an official relative Location resource", async () => {
  const prepared = await prepareMayelAssetWithEbayMediaV1({
    accessToken: "token", sourceImageUrl: mayel,
    approvedMayelStorageUrl: (url) => url === mayel,
    fetchImpl: async (url) => String(url).endsWith("/create_image_from_url")
      ? Response.json({}, { status: 201, headers: { location:
        "/commerce/media/v1_beta/image/image_relative" } })
      : Response.json({ imageUrl: mayelEps,
        expirationDate: "2026-10-01T00:00:00Z" }),
  })
  assert.equal(prepared.imageId, "image_relative")
  assert.equal(prepared.epsImageUrl, mayelEps)
})

test("Media API accepts collection-relative and direct image identities", async () => {
  for (const location of ["image_collection_relative",
    "https://api.ebay.com/commerce/media/v1_beta/image/image_query?trace=1"]) {
    const expected = location.startsWith("https:")
      ? "image_query" : "image_collection_relative"
    const prepared = await prepareMayelAssetWithEbayMediaV1({
      accessToken: "token", sourceImageUrl: mayel,
      approvedMayelStorageUrl: (url) => url === mayel,
      fetchImpl: async (url) => String(url).endsWith("/create_image_from_url")
        ? Response.json({}, { status: 201, headers: { location } })
        : Response.json({ imageUrl: mayelEps }),
    })
    assert.equal(prepared.imageId, expected)
  }
})

test("Media API accepts the documented imageId from a nested 201 body", async () => {
  const prepared = await prepareMayelAssetWithEbayMediaV1({
    accessToken: "token", sourceImageUrl: mayel,
    approvedMayelStorageUrl: (url) => url === mayel,
    fetchImpl: async (url) => String(url).endsWith("/create_image_from_url")
      ? Response.json({ image: { imageId: "nested_image_123" } },
        { status: 201 })
      : Response.json({ imageUrl: mayelEps }),
  })
  assert.equal(prepared.imageId, "nested_image_123")
})

test("Media API recovers the official image identity from a 201 EPS body", async () => {
  const bodyEps =
    "https://i.ebayimg.com/00/s/MTYwMFgxNjAw/z/image_body_123/$_1.JPG?set_id=8800005007"
  const calls = []
  const prepared = await prepareMayelAssetWithEbayMediaV1({
    accessToken: "token", sourceImageUrl: mayel,
    approvedMayelStorageUrl: (url) => url === mayel,
    fetchImpl: async (url) => {
      calls.push(String(url))
      return String(url).endsWith("/create_image_from_url")
        ? Response.json({ imageUrl: bodyEps }, { status: 201 })
        : Response.json({ imageUrl: bodyEps,
          expirationDate: "2026-10-01T00:00:00Z" })
    },
  })
  assert.equal(prepared.imageId, "image_body_123")
  assert.equal(prepared.epsImageUrl, bodyEps)
  assert.match(calls[1], /\/image\/image_body_123$/)
})

test("Media preparation fails closed on non-approved source or non-EPS result", async () => {
  await assert.rejects(() => prepareMayelAssetWithEbayMediaV1({
    accessToken: "token", sourceImageUrl: "https://evil.invalid/image.jpg",
    approvedMayelStorageUrl: () => false,
  }), /MAYEL_TRADING_MEDIA_PREPARATION_INPUT_INVALID/)
  await assert.rejects(() => prepareMayelAssetWithEbayMediaV1({
    accessToken: "token", sourceImageUrl: mayel,
    approvedMayelStorageUrl: () => true,
    fetchImpl: async (url) => String(url).endsWith("create_image_from_url")
      ? Response.json({}, { status: 201, headers: { location:
        "https://apim.ebay.com/commerce/media/v1_beta/image/image_123" } })
      : Response.json({ imageUrl: "https://external.example/image.jpg" }),
  }), /MAYEL_TRADING_MEDIA_EPS_URL_INVALID/)
})

test("existing durable Phase B ledger enforces one atomic Trading claim", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260906082515_mayel_trading_visual_executor_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration,
    /claim_ebay_mayel_trading_visual_write_v1/)
  assert.match(migration, /execution\.marketplace_write_count = 0/)
  assert.match(migration, /execution\.claim_token is null/)
  assert.match(migration, /marketplace_write_count = 1/)
  assert.match(migration, /idempotency_binding_digest/)
  assert.match(migration, /before_image_digest/)
  assert.match(migration, /proposed_image_digest/)
  assert.match(migration,
    /EBAY_TRADING_REVISE_FIXED_PRICE_ITEM_PICTURE_DETAILS_ONLY_V1/)
  assert.match(migration,
    /EBAY_MEDIA_CREATE_IMAGE_FROM_URL_GET_IMAGE_EPS_V1/)
  assert.match(migration, /media_preparation_write_count between 0 and 1/)
  assert.match(migration, /force row level security|security invoker/)
})
