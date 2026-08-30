import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

import type { CommercialMonitorGetDto } from
  "./commercial-monitor-readonly-contract"
import {
  buildSellerOsCurrentLiveVisualQualityV1,
  type SellerOsVisualFindingV1,
// @ts-expect-error Node's direct TypeScript test runner requires the extension.
} from "./ebay-seller-os-visual-quality-v1.ts"

export const SELLER_OS_VISUAL_VARIANT_VERSION =
  "SELLER_OS_VISUAL_VARIANT_V1_2026_08_29" as const
export const MAX_VARIANTS_PER_REQUEST = 2 as const
export const MAX_ACTIVE_VARIANTS_PER_LISTING = 4 as const
const MAX_PROVIDER_CALLS_PER_DAY_DEFAULT = 5
const MAX_PROJECTED_COST_PER_VARIANT_USD = 0.05
const EBAY_IMAGE_STAGING_BUCKET = "ebay-listing-image-staging"
const OUTPUT_SIZE = 1_600
const PRODUCT_FRAME_SIZE = 1_440
const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations"
const PRODUCT_TRUE_FINDINGS = new Set<SellerOsVisualFindingV1["findingCode"]>([
  "LOW_FRAME_UTILIZATION", "EXCESS_DEAD_SPACE", "OFF_CENTER_PRODUCT",
  "EDGE_CROPPING_RISK", "WHITE_BACKGROUND_NOT_PROVEN",
])

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

function sha256Tagged(value: unknown) {
  return `sha256:${sha256(JSON.stringify(value))}`
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return message.match(/[A-Z][A-Z0-9_:.-]{2,180}/)?.[0]
    ?? "SELLER_OS_VISUAL_VARIANT_FAILED"
}

function boundedNumber(value: unknown, fallback: number, minimum: number,
  maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback
}

async function loadVisualImageBudgetStatus(input: {
  supabase: SupabaseClient
  accountKey: string
  now: Date
  environment?: NodeJS.ProcessEnv
}) {
  const environment = input.environment ?? process.env
  const monthlyBudgetUsd = boundedNumber(
    environment.OPENAI_LISTING_MONTHLY_BUDGET_USD, 10, 0, 10_000)
  const hardStopUsd = boundedNumber(environment.OPENAI_LISTING_HARD_STOP_USD,
    8, 0, monthlyBudgetUsd)
  const start = new Date(Date.UTC(input.now.getUTCFullYear(),
    input.now.getUTCMonth(), 1)).toISOString()
  const { data, error } = await input.supabase.from("ai_listing_budget_usage")
    .select("estimated_cost_usd,status")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .gte("started_at", start).in("status", ["COMPLETED", "FAILED"])
  if (error) throw new Error("VISUAL_VARIANT_MONTHLY_BUDGET_READ_FAILED")
  const spentUsd = Number((data ?? []).reduce((sum, row) =>
    sum + Math.max(0, Number(row.estimated_cost_usd ?? 0)), 0).toFixed(6))
  return { monthlyBudgetUsd, hardStopUsd, spentUsd,
    remainingUsd: Math.max(0, Number((monthlyBudgetUsd - spentUsd).toFixed(6))),
    hardStopReached: spentUsd >= hardStopUsd }
}

function sourceBytesLimit(response: Response, maximum = 12 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  return !Number.isFinite(declared) || declared <= 0 || declared <= maximum
}

async function downloadOfficialSource(url: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, { method: "GET", cache: "no-store",
    headers: { Accept: "image/*" }, signal: AbortSignal.timeout(10_000) })
  const hostname = new URL(response.url || url).hostname
  const contentType = response.headers.get("content-type") ?? ""
  if (!response.ok || !(hostname === "ebayimg.com" ||
      hostname.endsWith(".ebayimg.com")) || !contentType.startsWith("image/") ||
      !sourceBytesLimit(response)) throw new Error("FULL_RESOLUTION_SOURCE_UNAVAILABLE")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) {
    bytes.fill(0)
    throw new Error("FULL_RESOLUTION_SOURCE_UNAVAILABLE")
  }
  return bytes
}

function heroBackgroundPrompt(label: "A" | "B") {
  return [
    "Use case: product-mockup",
    "Asset type: empty background plate for an eBay main-image experiment",
    "Primary request: create an empty seamless neutral-white studio background only.",
    label === "A"
      ? "Lighting: flat, diffuse, even white illumination."
      : "Lighting: very soft centered white illumination with no visible horizon.",
    "The product is inserted locally later and is not sent to you.",
    "Constraints: no product, no object, no prop, no person, no hand, no text, no logo, no symbol, no watermark, no shadow, no colored area.",
  ].join("\n")
}

async function requestEmptyHeroBackground(input: {
  apiKey: string
  model: "gpt-image-2"
  label: "A" | "B"
  fetchImpl: typeof fetch
}) {
  const prompt = heroBackgroundPrompt(input.label)
  const response = await input.fetchImpl(OPENAI_IMAGE_ENDPOINT, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, prompt, n: 1,
      size: "1024x1024", quality: "low", output_format: "png",
      background: "opaque", moderation: "auto" }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!sourceBytesLimit(response, 18 * 1024 * 1024)) {
    throw new Error("SELLER_OS_VISUAL_VARIANT_PROVIDER_RESPONSE_TOO_LARGE")
  }
  const payload = await response.json().catch(() => ({})) as JsonRecord
  if (!response.ok) throw new Error(`SELLER_OS_VISUAL_VARIANT_PROVIDER_HTTP_${response.status}`)
  const data = Array.isArray(payload.data) ? payload.data : []
  const first = record(data[0])
  const encoded = text(first.b64_json, 24 * 1024 * 1024)
  if (data.length !== 1 || !encoded || first.url) {
    throw new Error("SELLER_OS_VISUAL_VARIANT_PROVIDER_OUTPUT_INVALID")
  }
  const output = Buffer.from(encoded, "base64")
  const metadata = await sharp(output).metadata()
  if (!output.length || output.length > 12 * 1024 * 1024 ||
      metadata.width !== 1_024 || metadata.height !== 1_024) {
    output.fill(0)
    throw new Error("SELLER_OS_VISUAL_VARIANT_PROVIDER_OUTPUT_INVALID")
  }
  const usage = record(payload.usage)
  const inputTokens = Number(usage.input_tokens)
  const outputTokens = Number(usage.output_tokens)
  const cost = Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
    ? Number((Math.max(0, inputTokens) * 5 / 1_000_000 +
      Math.max(0, outputTokens) * 30 / 1_000_000).toFixed(6))
    : MAX_PROJECTED_COST_PER_VARIANT_USD
  return { output, prompt, promptHash: sha256Tagged(prompt),
    providerRequestId: text(response.headers.get("x-request-id"), 200) || null,
    usage: { inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
      outputTokens: Number.isFinite(outputTokens) ? outputTokens : null },
    estimatedOrAuthoritativeCostUsd: cost,
    costBasis: Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
      ? "PROVIDER_USAGE_AT_GPT_IMAGE_2_TOKEN_RATES" as const
      : "BOUNDED_PREFLIGHT_ESTIMATE" as const }
}

async function validateEmptyBackground(bytes: Buffer) {
  const { data, info } = await sharp(bytes).resize(128, 128, { fit: "fill" })
    .removeAlpha().toColourspace("srgb").raw()
    .toBuffer({ resolveWithObject: true })
  let neutralWhite = 0
  let materiallyDark = 0
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const channels = [data[offset], data[offset + 1], data[offset + 2]]
    const minimum = Math.min(...channels)
    const spread = Math.max(...channels) - minimum
    if (minimum >= 235 && spread <= 18) neutralWhite += 1
    if (minimum < 210 || spread > 30) materiallyDark += 1
  }
  data.fill(0)
  const count = info.width * info.height
  const whiteness = neutralWhite / count
  const nonNeutral = materiallyDark / count
  return { passed: whiteness >= .94 && nonNeutral <= .01,
    whiteness: Number(whiteness.toFixed(4)),
    nonNeutral: Number(nonNeutral.toFixed(4)) }
}

async function composeProductTrueSafeMargin(input: {
  source: Buffer
  background: Buffer
}) {
  const sourceMetadata = await sharp(input.source).rotate().metadata()
  const protectedLayer = await sharp(input.source).rotate().resize({
    width: PRODUCT_FRAME_SIZE, height: PRODUCT_FRAME_SIZE, fit: "contain",
    withoutEnlargement: false,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  }).png().toBuffer()
  const background = await sharp(input.background).resize(OUTPUT_SIZE, OUTPUT_SIZE,
    { fit: "fill" }).png().toBuffer()
  const output = await sharp(background).composite([{ input: protectedLayer,
    left: (OUTPUT_SIZE - PRODUCT_FRAME_SIZE) / 2,
    top: (OUTPUT_SIZE - PRODUCT_FRAME_SIZE) / 2 }]).png().toBuffer()
  background.fill(0)
  const [protectedRaw, roundtripRaw] = await Promise.all([
    sharp(protectedLayer).raw().toBuffer(),
    sharp(output).extract({ left: 80, top: 80, width: PRODUCT_FRAME_SIZE,
      height: PRODUCT_FRAME_SIZE }).raw().toBuffer(),
  ])
  const productTruthPreserved = protectedRaw.equals(roundtripRaw)
  protectedRaw.fill(0)
  roundtripRaw.fill(0)
  const outputMetadata = await sharp(output).metadata()
  return { output, protectedLayerSha256: sha256(protectedLayer),
    productTruthPreserved,
    sourceWidth: sourceMetadata.width ?? 0,
    sourceHeight: sourceMetadata.height ?? 0,
    outputWidth: outputMetadata.width ?? 0,
    outputHeight: outputMetadata.height ?? 0,
    productFrame: { left: 80, top: 80, width: PRODUCT_FRAME_SIZE,
      height: PRODUCT_FRAME_SIZE },
    transformation: "PRODUCT_TRUE_SOURCE_CONTAINED_ON_AI_EMPTY_BACKGROUND" as const,
    protectedAttributes: ["EXACT_PRODUCT_IDENTITY", "COLOR", "GEOMETRY",
      "COMPONENT_COUNT", "ACCESSORIES", "REAL_LOGOS_AND_TEXT",
      "NO_FAKE_FEATURES"] as const,
    protectedLayer }
}

async function latestExactLinkage(input: {
  supabase: SupabaseClient
  accountKey: string
  ebayItemId: string
}) {
  const { data, error } = await input.supabase
    .from("seller_os_luna_linkage_decisions")
    .select("decision_id,ebay_item_id,decision,luna_product_id,luna_variant_id,luna_sku,components,evidence_digest,actor_user_id,decision_version")
    .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
    .eq("ebay_item_id", input.ebayItemId)
    .order("decision_version", { ascending: false }).limit(1).maybeSingle()
  if (error || !data || data.decision !== "APPROVE_EXACT_LINKAGE" ||
      !text(data.luna_product_id) || !text(data.luna_variant_id) ||
      !text(data.luna_sku) || !text(data.actor_user_id)) {
    throw new Error("EXACT_PRODUCT_TRUTH_LINKAGE_REQUIRED")
  }
  return data
}

async function activeVisualVariantCount(input: {
  supabase: SupabaseClient
  accountKey: string
  ebayItemId: string
}) {
  const { count, error } = await input.supabase.from("ebay_listing_image_assets")
    .select("id", { count: "exact", head: true })
    .eq("account_key", input.accountKey)
    .in("status", ["pending_review", "approved"])
    .contains("transformation", { sellerOsVisualVariant: {
      contractVersion: SELLER_OS_VISUAL_VARIANT_VERSION,
      ebayItemId: input.ebayItemId,
    } })
  if (error) throw new Error("VISUAL_VARIANT_ACTIVE_COUNT_FAILED")
  return count ?? 0
}

async function dailyVisualCallCount(input: {
  supabase: SupabaseClient
  accountKey: string
  now: Date
}) {
  const start = new Date(input.now)
  start.setUTCHours(0, 0, 0, 0)
  const { count, error } = await input.supabase.from("ai_listing_budget_usage")
    .select("id", { count: "exact", head: true })
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .like("sanitized_request_id", "seller-os-visual:%")
    .gte("started_at", start.toISOString())
    .in("status", ["COMPLETED", "FAILED"])
  if (error) throw new Error("VISUAL_VARIANT_DAILY_BUDGET_READ_FAILED")
  return count ?? 0
}

async function persistBudgetUsage(input: {
  supabase: SupabaseClient
  accountKey: string
  model: string
  requestHash: string
  experimentId: string
  cost: number
  status: "COMPLETED" | "FAILED"
  startedAt: string
  completedAt: string
  usage?: { inputTokens: number | null; outputTokens: number | null }
}) {
  const { error } = await input.supabase.from("ai_listing_budget_usage").insert({
    marketplace_account_key: input.accountKey, marketplace: "EBAY_US",
    generation_run_id: null, candidate_id: null, model: input.model,
    idempotency_key_hash: input.requestHash,
    sanitized_request_id: `seller-os-visual:${input.experimentId}`,
    input_tokens: input.usage?.inputTokens ?? null, cached_input_tokens: null,
    output_tokens: input.usage?.outputTokens ?? null,
    estimated_cost_usd: input.cost, status: input.status,
    cache_hit: false, revision_number: 0,
    started_at: input.startedAt, completed_at: input.completedAt,
  })
  if (error && error.code !== "23505") {
    throw new Error("VISUAL_VARIANT_BUDGET_USAGE_PERSIST_FAILED")
  }
}

export async function createSellerOsVisualVariantsV1(input: {
  supabase: SupabaseClient
  monitor: CommercialMonitorGetDto
  accountKey: string
  actorId: string | null
  ebayItemId: string
  findingCode: SellerOsVisualFindingV1["findingCode"]
  variantCount: number
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
  now?: Date
}) {
  const startedAt = (input.now ?? new Date()).toISOString()
  const variantCount = Number(input.variantCount)
  if (!Number.isInteger(variantCount) || variantCount < 1 ||
      variantCount > MAX_VARIANTS_PER_REQUEST) {
    throw new Error("VISUAL_VARIANT_COUNT_OUT_OF_BOUNDS")
  }
  if (!PRODUCT_TRUE_FINDINGS.has(input.findingCode)) {
    throw new Error("VISUAL_VARIANT_MATERIAL_REASON_REQUIRED")
  }
  const model = text(input.model) || "gpt-image-2"
  if (model !== "gpt-image-2" || !text(input.apiKey, 4_096)) {
    throw new Error("VISUAL_VARIANT_PROVIDER_CONFIGURATION_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const visual = await buildSellerOsCurrentLiveVisualQualityV1({
    monitor: input.monitor, fetchImage: fetchImpl })
  const listing = visual.listings.find((row) => row.ebayItemId === input.ebayItemId)
  const finding = listing?.findings.find((row) =>
    row.findingCode === input.findingCode)
  if (!listing || !finding ||
      !listing.sourceResolution.sourceImageFullResolutionCertified ||
      !listing.sourceResolution.fullResolutionFetchAvailable ||
      !listing.heroImageUrl) {
    throw new Error("VISUAL_VARIANT_GENERATION_REASON_UNPROVEN")
  }
  const linkage = await latestExactLinkage({ supabase: input.supabase,
    accountKey: input.accountKey, ebayItemId: input.ebayItemId })
  const createdBy = input.actorId || text(linkage.actor_user_id)
  const activeCount = await activeVisualVariantCount({ supabase: input.supabase,
    accountKey: input.accountKey, ebayItemId: input.ebayItemId })
  if (activeCount + variantCount > MAX_ACTIVE_VARIANTS_PER_LISTING) {
    throw new Error("VISUAL_VARIANT_ACTIVE_LIMIT_REACHED")
  }
  const now = input.now ?? new Date()
  const configuredDailyLimit = Number(process.env.OPENAI_IMAGE_DAILY_CALL_LIMIT)
  const dailyLimit = Number.isInteger(configuredDailyLimit)
    ? Math.min(20, Math.max(1, configuredDailyLimit))
    : MAX_PROVIDER_CALLS_PER_DAY_DEFAULT
  const dailyCount = await dailyVisualCallCount({ supabase: input.supabase,
    accountKey: input.accountKey, now })
  if (dailyCount + variantCount > dailyLimit) {
    throw new Error("VISUAL_VARIANT_DAILY_CALL_LIMIT_REACHED")
  }
  const budget = await loadVisualImageBudgetStatus({ supabase: input.supabase,
    accountKey: input.accountKey, now })
  const projectedCost = variantCount * MAX_PROJECTED_COST_PER_VARIANT_USD
  if (budget.hardStopReached || projectedCost > budget.remainingUsd ||
      budget.spentUsd + projectedCost > budget.hardStopUsd) {
    throw new Error("VISUAL_VARIANT_MONTHLY_BUDGET_BLOCKED")
  }
  const source = await downloadOfficialSource(listing.heroImageUrl, fetchImpl)
  const sourceHash = sha256(source)
  const productTruthFingerprint = sha256Tagged({
    ebayItemId: input.ebayItemId, lunaProductId: linkage.luna_product_id,
    lunaVariantId: linkage.luna_variant_id, lunaSku: linkage.luna_sku,
    components: linkage.components, evidenceDigest: linkage.evidence_digest,
    sourceHash,
  })
  const experimentId = randomUUID()
  const requestHash = sha256Tagged({ contract: SELLER_OS_VISUAL_VARIANT_VERSION,
    accountKey: input.accountKey, ebayItemId: input.ebayItemId,
    findingCode: input.findingCode, sourceHash, productTruthFingerprint,
    variantCount, model })
  const variants: JsonRecord[] = []
  let totalCost = 0
  try {
    for (let index = 0; index < variantCount; index += 1) {
      const label = index === 0 ? "A" as const : "B" as const
      const provider = await requestEmptyHeroBackground({
        apiKey: input.apiKey.trim(), model, label, fetchImpl })
      const backgroundQa = await validateEmptyBackground(provider.output)
      if (!backgroundQa.passed) {
        provider.output.fill(0)
        throw new Error("VISUAL_VARIANT_BACKGROUND_QA_REJECTED")
      }
      const composition = await composeProductTrueSafeMargin({ source,
        background: provider.output })
      provider.output.fill(0)
      if (!composition.productTruthPreserved ||
          composition.outputWidth !== OUTPUT_SIZE ||
          composition.outputHeight !== OUTPUT_SIZE ||
          composition.sourceWidth < 500 || composition.sourceHeight < 500) {
        composition.output.fill(0)
        composition.protectedLayer.fill(0)
        throw new Error("VISUAL_VARIANT_PRODUCT_TRUTH_REJECTED")
      }
      const outputHash = sha256(composition.output)
      const storagePath = `seller-os-visual-variants/${input.ebayItemId}/${experimentId}/variant-${label.toLowerCase()}.png`
      const upload = await input.supabase.storage.from(EBAY_IMAGE_STAGING_BUCKET)
        .upload(storagePath, composition.output, { contentType: "image/png",
          cacheControl: "0", upsert: false })
      if (upload.error) throw new Error("VISUAL_VARIANT_PRIVATE_UPLOAD_FAILED")
      const transformation = { sellerOsVisualVariant: {
        contractVersion: SELLER_OS_VISUAL_VARIANT_VERSION,
        ebayItemId: input.ebayItemId, experimentId, variantLabel: label,
        requestHash, findingCode: finding.findingCode,
        observation: finding.observation, objective: finding.objective,
        hypothesis: finding.hypothesis,
        productTruthFingerprint, protectedLayerSha256:
          composition.protectedLayerSha256,
        productTruthPreserved: true,
        sourceImageFullResolutionCertified: true,
        sourceResolution: listing.sourceResolution,
        promptHash: provider.promptHash,
        providerRequestId: provider.providerRequestId,
        productFrame: composition.productFrame,
        protectedAttributes: composition.protectedAttributes,
        transformation: composition.transformation,
        backgroundQa,
        estimatedOrAuthoritativeCostUsd:
          provider.estimatedOrAuthoritativeCostUsd,
        costBasis: provider.costBasis,
      } }
      const qaResult = { productTruthPreserved: true, variantRejected: false,
        experimentReady: true, backgroundQa,
        protectedLayerRoundtripExact: true }
      const inserted = await input.supabase.from("ebay_listing_image_assets")
        .insert({ account_key: input.accountKey, created_by: createdBy,
          opportunity_id: null, listing_package_id: null,
          candidate_key: `seller-os-current-live:${input.ebayItemId}`,
          asset_role: "main", status: "pending_review",
          source_kind: "authorized_url", source_url: listing.heroImageUrl,
          source_storage_path: null, output_storage_path: storagePath,
          published_storage_path: null, public_url: null,
          source_sha256: sourceHash, output_sha256: outputHash,
          source_width: composition.sourceWidth,
          source_height: composition.sourceHeight,
          output_width: composition.outputWidth,
          output_height: composition.outputHeight,
          output_bytes: composition.output.length, rights_basis: "owned",
          authorization_reference: `CURRENT_LIVE:${input.ebayItemId}`,
          rights_evidence_confirmed: true,
          transformation_version: SELLER_OS_VISUAL_VARIANT_VERSION,
          transformation, qa_result: qaResult, position: index })
        .select("id,output_sha256,created_at").single()
      if (inserted.error || !inserted.data) {
        await input.supabase.storage.from(EBAY_IMAGE_STAGING_BUCKET)
          .remove([storagePath])
        throw new Error("VISUAL_VARIANT_ASSET_PERSIST_FAILED")
      }
      totalCost += provider.estimatedOrAuthoritativeCostUsd
      await persistBudgetUsage({ supabase: input.supabase,
        accountKey: input.accountKey, model, requestHash: sha256Tagged({
          requestHash, variantLabel: label }), experimentId,
        cost: provider.estimatedOrAuthoritativeCostUsd, status: "COMPLETED",
        startedAt, completedAt: new Date().toISOString(), usage: provider.usage })
      variants.push({ assetId: inserted.data.id, variantLabel: label,
        outputSha256: inserted.data.output_sha256,
        status: "EXPERIMENT_READY", productTruthPreserved: true,
        variantRejected: false, sourceImageFullResolutionCertified: true,
        estimatedOrAuthoritativeCostUsd:
          provider.estimatedOrAuthoritativeCostUsd,
        costBasis: provider.costBasis })
      composition.output.fill(0)
      composition.protectedLayer.fill(0)
    }
  } catch (error) {
    await persistBudgetUsage({ supabase: input.supabase,
      accountKey: input.accountKey, model,
      requestHash: sha256Tagged({ requestHash, failed: variants.length }),
      experimentId, cost: 0, status: "FAILED", startedAt,
      completedAt: new Date().toISOString() }).catch(() => undefined)
    throw error
  } finally {
    source.fill(0)
  }
  return { contractVersion: SELLER_OS_VISUAL_VARIANT_VERSION,
    experimentId, listingId: input.ebayItemId,
    generationReasonProven: true, observation: finding.observation,
    objective: finding.objective, hypothesis: finding.hypothesis,
    variantCount: variants.length, variants,
    productTruthPreserved: variants.every((row) =>
      row.productTruthPreserved === true),
    sourceImageFullResolutionCertified: true,
    aiImageRequestCount: variants.length,
    aiImageVariantCount: variants.length,
    estimatedOrAuthoritativeCostUsd: Number(totalCost.toFixed(6)),
    budget: { monthlyBudgetUsd: budget.monthlyBudgetUsd,
      hardStopUsd: budget.hardStopUsd, spentBeforeUsd: budget.spentUsd,
      dailyCallLimit: dailyLimit, dailyCallsBefore: dailyCount,
      maxVariantsPerRequest: MAX_VARIANTS_PER_REQUEST,
      maxActiveVariantsPerListing: MAX_ACTIVE_VARIANTS_PER_LISTING },
    operatorEbayLoginRequired: false, ownerApprovalRequired: false,
    ebayListingEdits: 0, marketplaceWrites: 0, secretExposure: 0 }
}

export async function loadSellerOsVisualVariantsV1(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const { data, error } = await input.supabase.from("ebay_listing_image_assets")
    .select("id,status,output_storage_path,output_sha256,transformation,qa_result,created_at,rejected_at")
    .eq("account_key", input.accountKey)
    .eq("transformation_version", SELLER_OS_VISUAL_VARIANT_VERSION)
    .order("created_at", { ascending: false }).limit(80)
  if (error) throw new Error("VISUAL_VARIANT_READ_FAILED")
  const variants = await Promise.all((data ?? []).map(async (asset) => {
    const transformation = record(record(asset.transformation)
      .sellerOsVisualVariant)
    const preview = asset.status === "pending_review"
      ? await input.supabase.storage.from(EBAY_IMAGE_STAGING_BUCKET)
        .createSignedUrl(asset.output_storage_path, 300)
      : { data: null }
    return { assetId: asset.id, status: asset.status,
      listingId: text(transformation.ebayItemId),
      experimentId: text(transformation.experimentId),
      variantLabel: text(transformation.variantLabel),
      observation: text(transformation.observation),
      objective: text(transformation.objective),
      hypothesis: text(transformation.hypothesis),
      productTruthPreserved: transformation.productTruthPreserved === true,
      sourceImageFullResolutionCertified:
        transformation.sourceImageFullResolutionCertified === true,
      estimatedOrAuthoritativeCostUsd:
        Number(transformation.estimatedOrAuthoritativeCostUsd ?? 0),
      previewUrl: preview.data?.signedUrl ?? null,
      outputSha256: asset.output_sha256, qa: asset.qa_result,
      createdAt: asset.created_at, rejectedAt: asset.rejected_at }
  }))
  return { contractVersion: SELLER_OS_VISUAL_VARIANT_VERSION,
    variants, activeVariantCount: variants.filter((row) =>
      row.status === "pending_review").length,
    maxVariantsPerRequest: MAX_VARIANTS_PER_REQUEST,
    maxActiveVariantsPerListing: MAX_ACTIVE_VARIANTS_PER_LISTING,
    actions: ["COMPARE", "USE_IN_EXPERIMENT", "DISCARD"] as const,
    ebayListingEdits: 0 as const, marketplaceWrites: 0 as const }
}

export async function updateSellerOsVisualVariantV1(input: {
  supabase: SupabaseClient
  accountKey: string
  assetId: string
  action: "USE_IN_EXPERIMENT" | "DISCARD"
}) {
  const { data, error } = await input.supabase.from("ebay_listing_image_assets")
    .select("id,status,transformation,qa_result")
    .eq("id", input.assetId).eq("account_key", input.accountKey)
    .eq("transformation_version", SELLER_OS_VISUAL_VARIANT_VERSION)
    .maybeSingle()
  if (error || !data || data.status !== "pending_review") {
    throw new Error("VISUAL_VARIANT_NOT_ACTIONABLE")
  }
  const transformation = record(record(data.transformation)
    .sellerOsVisualVariant)
  if (input.action === "DISCARD") {
    const updated = await input.supabase.from("ebay_listing_image_assets")
      .update({ status: "rejected", rejected_at: new Date().toISOString() })
      .eq("id", input.assetId).eq("account_key", input.accountKey)
      .eq("status", "pending_review").select("id,status").single()
    if (updated.error || !updated.data) throw new Error("VISUAL_VARIANT_DISCARD_FAILED")
    return { assetId: input.assetId, status: "DISCARDED",
      experimentId: text(transformation.experimentId), ebayListingEdits: 0,
      marketplaceWrites: 0 }
  }
  const qa = { ...record(data.qa_result), experimentReady: true,
    selectedForExperiment: true, selectedAt: new Date().toISOString() }
  const updated = await input.supabase.from("ebay_listing_image_assets")
    .update({ qa_result: qa }).eq("id", input.assetId)
    .eq("account_key", input.accountKey).eq("status", "pending_review")
    .select("id,status").single()
  if (updated.error || !updated.data) {
    throw new Error("VISUAL_VARIANT_EXPERIMENT_SELECTION_FAILED")
  }
  return { assetId: input.assetId, status: "EXPERIMENT_READY",
    experimentId: text(transformation.experimentId), ebayListingEdits: 0,
    marketplaceWrites: 0 }
}

export { safeCode as sellerOsVisualVariantSafeCodeV1 }
