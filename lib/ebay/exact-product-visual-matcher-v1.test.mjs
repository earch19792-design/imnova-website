import assert from "node:assert/strict"
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

const matcher = await import("./exact-product-visual-matcher-v1.ts")

function fingerprint(overrides = {}) {
  return matcher.buildExactProductFingerprintV1({
    supplierProductId: "100", supplierVariantId: "200",
    supplierSku: "SKU-1", categoryId: "29946",
    imageUrls: ["https://cdn.shopify.com/s/files/luna.jpg"],
    title: "Wireless clip-on microphone for iPhone and camera",
    model: null, dimensions: ["2 x 1 in"], colorOrVariant: ["Black"],
    distinctiveFeatures: ["dual receiver"], ...overrides,
  })
}

function candidate(overrides = {}) {
  return { candidateReference: `sha256:${"c".repeat(64)}`,
    sourceClass: "ACTIVE_LISTING", itemId: "123456789012",
    sellerReference: `sha256:${"d".repeat(64)}`,
    title: "Wireless Lavalier Clip Microphone Dual Receiver",
    imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
    categoryId: "29946", model: null, brand: null,
    dimensions: ["2 x 1 in"], colorOrVariant: ["Black"], material: [],
    includedAccessories: [], distinctiveFeatures: ["dual receiver"],
    aspects: [], gtin: null, mpn: null, soldVolume: 10,
    salesVelocity: 4, observedAt: "2026-08-30T00:00:00.000Z",
    ...overrides }
}

function evaluation(fp, item, overrides = {}) {
  return { fingerprintDigest: fp.evidenceDigest,
    candidateReference: item.candidateReference, visualMatch: "HIGH",
    modelMatch: "UNPROVEN", dimensionsMatch: "MATCH",
    variantMatch: "MATCH", distinctiveFeatureMatch: "MATCH",
    accessoryMatch: "UNPROVEN", brandCompatibility: "COMPATIBLE",
    lunaVisibleBrandText: null, candidateVisibleBrandText: null,
    conflictReasons: [], ...overrides }
}

test("visual similarity plus corroboration can prove physical identity, but visual alone cannot", () => {
  const fp = fingerprint()
  const item = candidate()
  const supported = matcher.resolveExactProductVisualMatchesV1({
    fingerprint: fp, candidates: [item],
    aiEvaluations: [evaluation(fp, item)],
  })[0]
  assert.equal(supported.classification, "STRONG_EXACT_MATCH")
  const visualOnly = matcher.resolveExactProductVisualMatchesV1({
    fingerprint: fingerprint({ categoryId: null, dimensions: [],
      colorOrVariant: [], distinctiveFeatures: [], title: "Object" }),
    candidates: [candidate({ categoryId: null, dimensions: [],
      colorOrVariant: [], distinctiveFeatures: [], title: "Different thing" })],
  })[0]
  assert.equal(visualOnly.classification, "FAMILY_ONLY")
})

test("a material model/dimension/variant conflict rejects a high visual match", () => {
  const fp = fingerprint({ model: "MODEL-A" })
  const item = candidate({ model: "MODEL-B" })
  const result = matcher.resolveExactProductVisualMatchesV1({
    fingerprint: fp, candidates: [item], aiEvaluations: [evaluation(fp, item, {
      modelMatch: "CONFLICT", conflictReasons: ["MODEL_CONFLICT"],
    })],
  })[0]
  assert.equal(result.classification, "REJECTED")
  assert.ok(result.conflictCount > 0)
})

test("cheap filters bound vision after rejecting explicit conflicts", () => {
  const fp = fingerprint({ model: "MODEL-A" })
  const values = [candidate({ candidateReference: "good", model: "MODEL-A" }),
    candidate({ candidateReference: "bad", model: "MODEL-B" }),
    candidate({ candidateReference: "other", model: "MODEL-A" })]
  const result = matcher.buildBoundedExactProductVisualShortlistV1({
    fingerprint: fp, candidates: values, maximumShortlist: 1,
  })
  assert.equal(result.visualShortlist.length, 1)
  assert.equal(result.cheapRejected.some((entry) =>
    entry.candidateReference === "bad"), true)
})

test("the OpenAI adapter is preprod-only, store:false, one-shot and never returns the key", async () => {
  const environment = { OPENAI_API_KEY: "test-secret-never-output",
    VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production",
    VERCEL_PROJECT_ID: "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222",
    VERCEL_PROJECT_PRODUCTION_URL: "imnova-seller-os-preprod.vercel.app",
    EBAY_PRO_RUNTIME: "staging",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co/" }
  let request
  const fp = fingerprint()
  const item = candidate()
  const resolver = matcher.createOpenAiExactProductVisualMatcherV1({
    enabled: true, modelId: "test-model", environment,
    fetchImpl: async (_url, init) => {
      request = init
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        matches: [evaluation(fp, item)],
      }), usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 })
    },
  })
  assert.ok(resolver)
  const result = await resolver([{ fingerprint: fp, candidates: [item] }],
    `sha256:${"e".repeat(64)}`)
  const body = JSON.parse(request.body)
  assert.equal(body.store, false)
  assert.equal(result.store, false)
  assert.equal(JSON.stringify(result).includes(environment.OPENAI_API_KEY), false)
  assert.equal(request.headers.Authorization,
    `Bearer ${environment.OPENAI_API_KEY}`)
  assert.equal(matcher.createOpenAiExactProductVisualMatcherV1({
    enabled: true, environment: { ...environment,
      VERCEL_PROJECT_ID: "production-project" },
  }), null)
})

test("the matcher advertises all shared consumers instead of a Radar fork", () => {
  assert.deepEqual([...matcher.EXACT_PRODUCT_VISUAL_MATCHER_CONSUMERS],
    ["QUICK_PICK", "RESEARCH", "NIGHT_RADAR", "LIVE_OPTIMIZATION"])
})
