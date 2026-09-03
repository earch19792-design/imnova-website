import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

const fullPage = await import("./ebay-luna-full-page-required-facts-v1.ts")
const ownerPolicy = await import(
  "./ebay-owner-supplier-merchandise-policy-v1.ts")

const ACCOUNT = "account-test"
const POLICY_ID = "11111111-1111-4111-8111-111111111111"
const AUTHORIZATION_DIGEST = `sha256:${"c".repeat(64)}`

function durableBrandPolicy() {
  return ownerPolicy.validateLunaUnbrandedAfterFullPageReviewPolicyRowV1({
    id: POLICY_ID,
    marketplace_account_key: ACCOUNT,
    marketplace: "EBAY_US",
    supplier_code: "LUNA_PORTEX",
    policy_code: "LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW",
    policy_version: "LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_V1",
    decision: "CERTIFIED",
    policy_payload: {
      statement: ownerPolicy.LUNA_UNBRANDED_AFTER_FULL_PAGE_REVIEW_STATEMENT,
      conditionLabel: null,
      brandValue: "Unbranded",
      exactSupplierLineageRequired: true,
      productIdentityExactRequired: true,
      fullLunaPageEvidenceRequired: true,
      explicitLunaBrandPreserved: true,
      imageEvidenceReviewRequired: true,
      factInvented: false,
    },
    evidence_digest:
      ownerPolicy.lunaUnbrandedAfterFullPageReviewPolicyDigestV1(),
    authorization_reference_digest: AUTHORIZATION_DIGEST,
    certified_at: "2026-09-03T12:00:00.000Z",
    revoked_at: null,
  }, ACCOUNT)
}

function exactFixture(overrides = {}) {
  const imageUrls = overrides.image_urls ?? []
  const opportunity = {
    id: "queue-1",
    supplier_product_id: "100",
    supplier_variant_id: "200",
    supplier_sku: "SKU-1",
    assessment: {},
    ...overrides.opportunity,
  }
  const catalogRow = {
    supplier_product_id: opportunity.supplier_product_id,
    supplier_variant_id: opportunity.supplier_variant_id,
    sku: opportunity.supplier_sku,
    title: "Exact Luna product",
    variant_title: "Default",
    body_html: "",
    product_metadata: {},
    metadata: {},
    featured_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    ...overrides,
  }
  delete catalogRow.opportunity
  return { opportunity, catalogRow }
}

function withPolicyAndImageReview(fixture, brandEvidenceStatus =
  "NO_EXPLICIT_BRAND", explicitBrand = null) {
  const policy = durableBrandPolicy()
  const imageUrls = [...new Set([
    fixture.catalogRow.featured_image_url,
    ...fixture.catalogRow.image_urls,
  ].filter(Boolean))]
  const review = fullPage.buildLunaFullPageImageReviewV1({
    lunaProductId: fixture.opportunity.supplier_product_id,
    lunaVariantId: fixture.opportunity.supplier_variant_id,
    supplierSku: fixture.opportunity.supplier_sku,
    imageUrls,
    brandEvidenceStatus,
    explicitBrand,
    reviewedAt: "2026-09-03T12:05:00.000Z",
  })
  const application = ownerPolicy.buildOwnerLunaUnbrandedPolicyApplicationV1({
    policy,
    lunaProductId: fixture.opportunity.supplier_product_id,
    lunaVariantId: fixture.opportunity.supplier_variant_id,
    supplierSku: fixture.opportunity.supplier_sku,
    exactSupplierLineageCertified: true,
    productIdentityExact: true,
    appliedAt: "2026-09-03T12:06:00.000Z",
  })
  return { ...fixture, opportunity: { ...fixture.opportunity, assessment: {
    ...fixture.opportunity.assessment,
    lunaFullPageImageReviewV1: review,
    ownerLunaUnbrandedPolicyApplicationV1: application,
  } } }
}

function resolve(fixture, specificName, contract = {}) {
  const evidence = fullPage.buildLunaExactProductEvidenceSetV1(fixture)
  return { evidence, resolution: fullPage.resolveLunaFullPageRequiredFactV1({
    opportunity: fixture.opportunity,
    evidence,
    specificName,
    freeTextAllowed: contract.freeTextAllowed ?? true,
    allowedValues: contract.allowedValues ?? [],
    allowedValuesComplete: contract.allowedValuesComplete ?? true,
  }) }
}

test("full exact Luna narrative preserves an explicit brand", () => {
  const fixture = exactFixture({ body_html:
    "<p>All Takeya products are BPA free. Takeya combines function and style.</p>" })
  const { resolution } = resolve(fixture, "Brand")
  assert.equal(resolution.value, "Takeya")
  assert.equal(resolution.source, "EXPLICIT_LUNA_EVIDENCE")
  assert.equal(resolution.factInvented, false)
})

test("owner Luna policy supplies Unbranded only after the complete exact image set was reviewed", () => {
  const fixture = exactFixture({
    body_html: "<p>Generic exact product with no manufacturer claim.</p>",
    image_urls: ["https://images.example/1.png",
      "https://images.example/2.png", "https://images.example/3.png",
      "https://images.example/4.png", "https://images.example/5.png"],
  })
  assert.equal(resolve(fixture, "Brand").resolution, null)
  const certified = withPolicyAndImageReview(fixture)
  const { evidence, resolution } = resolve(certified, "Brand")
  assert.equal(evidence.exactImageCount, 5)
  assert.equal(evidence.allExactProductImagesReviewed, true)
  assert.equal(resolution.value, "Unbranded")
  assert.equal(resolution.source, "OWNER_LUNA_UNBRANDED_POLICY")
  assert.equal(resolution.factInvented, false)
})

test("full-page evidence retains every exact image and durable Product Truth", () => {
  const imageUrls = Array.from({ length: 24 }, (_, index) =>
    `https://images.example/${index + 1}.png`)
  const longTail = "exact-tail-marker"
  const fixture = exactFixture({
    body_html: `<p>${"evidence ".repeat(1_100)}${longTail}</p>`,
    image_urls: imageUrls,
    opportunity: { assessment: { productTruth: {
      evidenceDigest: `sha256:${"d".repeat(64)}`,
      title: "Durable exact product",
      provenProductValues: { Color: "Black" },
      knownUnknownAspectNames: ["Material"],
    } } },
  })
  const evidence = fullPage.buildLunaExactProductEvidenceSetV1(fixture)
  assert.equal(evidence.exactImageUrls.length, 24)
  assert.equal(evidence.description.endsWith(longTail), true)
  assert.equal(
    evidence.existingDurableProductTruth.upstreamProvenProductValues.Color,
    "Black")
  assert.equal(evidence.existingDurableProductTruth.title,
    "Durable exact product")
})

test("explicit structured Luna brand always wins over Unbranded policy", () => {
  const fixture = withPolicyAndImageReview(exactFixture({
    title: "Marvel Spider-Man Backpack",
    product_metadata: { Brand: "Marvel" },
    image_urls: ["https://images.example/marvel.png"],
  }))
  const { resolution } = resolve(fixture, "Brand")
  assert.equal(resolution.value, "Marvel")
  assert.equal(resolution.source, "EXPLICIT_LUNA_EVIDENCE")
})

test("LED package conflict is isolated and does not block entailed Type", () => {
  const fixture = exactFixture({ body_html: `<p>Multicolor LED TV Backlight Strip.
    USB-powered RGB LED backlight strip. 16 Colors. USB Powered (5V DC).
    Fits 22–32in TVs. Includes 3 pre-cut LED strips: 2 × 55.1in and
    2 × 30.7in.</p>` })
  const { evidence, resolution } = resolve(fixture, "Type")
  assert.equal(evidence.sourceConflicts[0].declaredQuantity, 3)
  assert.equal(evidence.sourceConflicts[0].enumeratedQuantity, 4)
  assert.deepEqual(evidence.sourceConflicts[0].affectedFacts,
    ["Package Quantity", "Number in Pack"])
  assert.equal(resolution.value, "LED TV Backlight Strip")
  assert.equal(resolution.source, "LUNA_CONTEXTUAL_DERIVATION")
})

test("free-text Size is derived without inventing dimensions", () => {
  const fixture = exactFixture({ body_html: `<p>Adjustable side sleeper wedge
    pillow designed for newborns up to 6 months. Adjustable width.</p>` })
  const { resolution } = resolve(fixture, "Size")
  assert.equal(resolution.value, "Adjustable - Newborn up to 6 Months")
  assert.doesNotMatch(resolution.value, /(?:inch|\bin\b)/iu)
  assert.equal(resolution.source, "LUNA_CONTEXTUAL_DERIVATION")
})

test("Department maps to an official unisex value while visual-only Material remains residual", () => {
  const fixture = exactFixture({ title: "Spider character 15 inch backpack",
    body_html: `<p>15 inch backpack set with detachable insulated lunchbox and
      adjustable shoulder straps for daily school use.</p>` })
  const department = resolve(fixture, "Department", {
    freeTextAllowed: false,
    allowedValues: ["Boys", "Girls", "Unisex Kids"],
  }).resolution
  assert.equal(department.value, "Unisex Kids")
  assert.equal(department.source, "EBAY_SEMANTIC_MAPPING")
  assert.equal(resolve(fixture, "Material").resolution, null)
})

test("the systemic resolver contains no current-batch SKU patches", async () => {
  const source = await readFile(new URL(
    "./ebay-luna-full-page-required-facts-v1.ts", import.meta.url), "utf8")
  assert.doesNotMatch(source,
    /FL-2FT-LED-LIGHT-STRIPS|FL-BABYWEDGE-PILLOW|ITEM5387/)
})
