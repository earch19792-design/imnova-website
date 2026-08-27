import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  automaticLunaImageQaResultV1,
  evaluateLunaImageAutomaticHappyPathV1,
  LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1,
  resolveInheritedLunaSupplierImageRightsV1,
} from "./luna-supplier-image-rights-authority-v1.ts"
import { assertAutomaticLunaImageDurableReadbackV1 } from
  "./luna-supplier-image-durable-readback-v1.ts"

const identity = {
  supplierProductId: "9220835475680",
  supplierVariantId: "48809646653664",
  supplierSku: "ITEM3525",
}
const official = "https://cdn.shopify.com/s/files/1/0000/products/cake.jpg"

function rights(overrides = {}) {
  return resolveInheritedLunaSupplierImageRightsV1({
    packageCandidateKey: "smart-stocking:cake",
    opportunityCandidateKey: "smart-stocking:cake",
    opportunityIdentity: identity,
    catalogIdentity: identity,
    catalogSourceKey: "lunaportex",
    officialImageUrls: [official],
    sourceUrl: official,
    ...overrides,
  })
}

function happyPath(overrides = {}) {
  return evaluateLunaImageAutomaticHappyPathV1({
    sourceSha256: "a".repeat(64),
    outputSha256: "b".repeat(64),
    transformationVersion: "EBAY_MAIN_IMAGE_SAFE_WHITE_V2",
    transformation: {
      generativeAiUsed: false,
      backgroundMethod: "AUTHORIZED_SOURCE_FRAMED_CONTAIN",
      sourcePixelsTreatment: "PRESERVED_FULL_FRAME",
    },
    qa: {
      automaticStatus: "PASSED",
      productCoverageVerified: true,
      outputUnderTwelveMegabytes: true,
      outputWidth: 1600,
      outputHeight: 1600,
      outputEdgeWhiteRatio: .99,
      exactSourceHashRecorded: true,
      generativeChangesMade: false,
      fullAuthorizedFramePreserved: true,
      sourceCenterChromaticRatio: .01,
      sourceVisualProfile: { productToneRisk: "LIGHT_NEUTRAL_AMBIGUITY" },
    },
    ...overrides,
  })
}

test("another exact Luna product inherits the supplier-level authority", () => {
  const result = resolveInheritedLunaSupplierImageRightsV1({
    packageCandidateKey: "luna-portex:123:456",
    opportunityCandidateKey: "luna-portex:123:456",
    opportunityIdentity: {
      supplierProductId: "123", supplierVariantId: "456", supplierSku: "ITEM2",
    },
    catalogIdentity: {
      supplierProductId: "123", supplierVariantId: "456", supplierSku: "ITEM2",
    },
    catalogSourceKey: "lunaportex",
    officialImageUrls: ["https://lunaportex.com/cdn/shop/files/item2.jpg"],
    sourceUrl: "https://lunaportex.com/cdn/shop/files/item2.jpg",
  })
  assert.equal(result.imageRights, "PASS_INHERITED")
  assert.equal(result.authority.inheritedAutomatically, true)
  assert.equal(result.authority.perProductReconfirmationRequired, false)
})

test("a competitor or non-Luna image never inherits rights", () => {
  assert.throws(() => rights({
    officialImageUrls: ["https://example.com/competitor.jpg"],
    sourceUrl: "https://example.com/competitor.jpg",
  }), /LUNA_SUPPLIER_IMAGE_SOURCE_NOT_OFFICIAL/)
})

test("an ambiguous Shopify image not bound to the exact product fails closed", () => {
  assert.throws(() => rights({
    sourceUrl: "https://cdn.shopify.com/s/files/1/9999/other.jpg",
  }), /LUNA_SUPPLIER_IMAGE_EXACT_PRODUCT_SOURCE_MISMATCH/)
})

test("an exact-product identity mismatch never inherits rights", () => {
  assert.throws(() => rights({
    catalogIdentity: { ...identity, supplierVariantId: "DIFFERENT" },
  }), /LUNA_SUPPLIER_IMAGE_PRODUCT_IDENTITY_MISMATCH/)
})

test("operator-attested authority is never mislabeled as documented license", () => {
  const result = rights()
  assert.equal(result.authority.authorityType,
    "OPERATOR_ATTESTED_SUPPLIER_IMAGE_AUTHORIZATION")
  assert.equal(result.authority.authorityProvenance, "OPERATOR_ATTESTED")
  assert.equal(result.authority.operatorAttested, true)
  assert.equal(result.authority.documentedLicense, false)
  assert.equal(LUNA_SUPPLIER_IMAGE_RIGHTS_AUTHORITY_V1.documentedLicense, false)
})

test("deterministic preserved-frame output passes without visual approval", () => {
  const automatic = happyPath()
  assert.equal(automatic.passed, true)
  assert.equal(automatic.imageReadiness, "IMAGE_READY_AUTO_PASS")
  assert.equal(automatic.humanImageActionRequired, false)
  const qa = automaticLunaImageQaResultV1({
    qa: { automaticStatus: "PASSED", humanApprovalRequired: true },
    rights: rights(),
    automatic,
  })
  assert.equal(qa.humanApprovalRequired, false)
  assert.equal(qa.approvalMode, "AUTOMATIC_DETERMINISTIC")
  assert.equal(qa.rightsAuthority.documentedLicense, false)
})

test("bounded background normalization passes only with standard product-tone evidence", () => {
  const common = {
    transformation: {
      generativeAiUsed: false,
      backgroundMethod: "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION",
      sourcePixelsTreatment: "NEAR_NEUTRAL_WHITEN_ONLY",
    },
    qa: {
      automaticStatus: "PASSED",
      productCoverageVerified: true,
      outputUnderTwelveMegabytes: true,
      outputWidth: 1600,
      outputHeight: 1600,
      outputEdgeWhiteRatio: .99,
      exactSourceHashRecorded: true,
      generativeChangesMade: false,
      fullAuthorizedFramePreserved: false,
      sourceCenterChromaticRatio: .2,
      sourceVisualProfile: { productToneRisk: "STANDARD" },
    },
  }
  assert.equal(happyPath(common).passed, true)
  assert.equal(happyPath({
    ...common,
    qa: { ...common.qa,
      sourceVisualProfile: { productToneRisk: "LIGHT_NEUTRAL_AMBIGUITY" } },
  }).passed, false)
})

test("one bad image is excluded and zero compliant images remains blocking", () => {
  const excluded = happyPath({
    qa: {
      automaticStatus: "PARTIAL",
      productCoverageVerified: true,
      outputUnderTwelveMegabytes: true,
      outputWidth: 1600,
      outputHeight: 1600,
      outputEdgeWhiteRatio: .99,
      exactSourceHashRecorded: true,
      generativeChangesMade: false,
      fullAuthorizedFramePreserved: true,
      sourceVisualProfile: { productToneRisk: "STANDARD" },
    },
  })
  assert.equal(excluded.passed, false)
  assert.ok(excluded.blockers.includes("OUTPUT_QUALITY_NOT_PASSED"))
})

test("the existing image asset, package and guarded RPC authorities are reused", () => {
  const runtime = readFileSync(
    "lib/ebay/luna-supplier-image-auto-runtime-v1.ts",
    "utf8",
  )
  const route = readFileSync("app/api/admin/ebay/images/route.ts", "utf8")
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx",
    "utf8",
  )
  assert.match(runtime, /from\("ebay_listing_image_assets"\)/)
  assert.match(runtime, /from\("ebay_listing_packages"\)/)
  assert.match(runtime, /"ebay_create_pending_listing_image"/)
  assert.match(runtime, /"ebay_review_listing_image_and_attach"/)
  assert.match(runtime, /"ebay_save_listing_package_guarded"/)
  assert.match(runtime, /if \(accepted\.length < 1\)/)
  assert.match(runtime, /excludedImageCount: excluded\.length/)
  assert.match(route, /action === "ensure_luna_supplier_images"/)
  assert.match(workspace, /action: "ensure_luna_supplier_images"/)
  assert.match(workspace, /finalHumanPublicationAuthorizationRequired|autorización humana final de publicación/)
  assert.doesNotMatch(runtime, /create table|alter table|marketplace.*write/i)
})

test("computed eligibility alone cannot claim durable image readiness", () => {
  assert.throws(() => assertAutomaticLunaImageDurableReadbackV1({
    packageData: {
      imageUrls: [],
      imageAssetManifest: [],
      supplierImageReadiness: {
        version: "LUNA_SUPPLIER_IMAGE_AUTO_READY_V1",
        imageReady: true,
        validCompliantImageCount: 4,
      },
    },
    acceptedAssets: [],
  }), /LUNA_IMAGE_DURABLE_RUNTIME_READBACK_MISMATCH/)
})

test("exact approved asset, manifest, URL and readiness readback passes", () => {
  const id = "10000000-0000-4000-8000-000000000001"
  const url = "https://example.com/approved.jpg"
  const sha = "a".repeat(64)
  const result = assertAutomaticLunaImageDurableReadbackV1({
    packageData: {
      imageUrls: [url],
      imageAssetManifest: [{ assetId: id, url, sha256: sha }],
      supplierImageReadiness: {
        version: "LUNA_SUPPLIER_IMAGE_AUTO_READY_V1",
        authorityVersion: "OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1",
        imageRights: "PASS_INHERITED",
        imageOptimization: "AUTO_PASS",
        imageReady: true,
        humanImageActionRequired: false,
        validCompliantImageCount: 1,
      },
    },
    acceptedAssets: [{
      id,
      status: "approved",
      public_url: url,
      published_storage_path: "actor/candidate/image.jpg",
      output_sha256: sha,
      qa_result: {
        approvalMode: "AUTOMATIC_DETERMINISTIC",
        imageReadiness: "IMAGE_READY_AUTO_PASS",
      },
    }],
  })
  assert.equal(result.validCompliantImageCount, 1)
  assert.equal(result.durableImageAssetReadback, "PASS")
})

test("database approval keeps Same-Day strict and admits only the exact Luna contract", () => {
  const migration = readFileSync(
    "supabase/migrations/20260827220029_allow_deterministic_luna_supplier_image_auto_approval_v1.sql",
    "utf8",
  )
  assert.match(migration, /block_non_passed_image_approval_v1/)
  assert.match(migration, /APPROVED|approved/)
  assert.match(migration, /AUTOMATIC_DETERMINISTIC/)
  assert.match(migration, /IMAGE_READY_AUTO_PASS/)
  assert.match(migration, /OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1/)
  assert.match(migration, /sourceHashPreserved' = 'true'/)
  assert.match(migration, /materialProductEquivalencePassed' = 'true'/)
  assert.match(migration, /SAME_DAY_IMAGE_SOURCE_VISUAL_POLICY_NOT_PASSED/)
  assert.match(migration, /SELLER_OS_EBAY_VISUAL_QA_V2/)
  assert.doesNotMatch(migration, /create table|drop table|truncate/i)
})
