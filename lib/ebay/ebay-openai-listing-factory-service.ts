import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createFakeListingFactoryAdapter,
  createOpenAiListingFactoryAdapter,
  getOpenAiListingFactoryConfiguration,
  listingFactoryHash,
  OPENAI_LISTING_FACTORY_DEFAULT_PROMPT_VERSION,
  OPENAI_LISTING_FACTORY_SCHEMA_VERSION,
  validateListingFactoryOutput,
  type ListingFactoryAdapter,
  type ListingFactoryInput,
} from "./ebay-openai-listing-factory"
import { winnerEvidencePreviewConfiguration } from "./ebay-winner-evidence-v2-service"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function normalizedStringArray(value: unknown) {
  return [...new Set(array(value)
    .map(text)
    .filter((entry): entry is string => Boolean(entry)))]
}

export { getOpenAiListingFactoryConfiguration }

type VerifiedListingContext = {
  authorizedKeywords?: unknown
  categoryId?: unknown
  categoryName?: unknown
  requiredAspects?: unknown
  complianceRestrictions?: unknown
  shippingPolicyName?: unknown
  handlingTimeDays?: unknown
  returnPolicyName?: unknown
  returnsAccepted?: unknown
  returnPeriodDays?: unknown
}

function requiredAspects(value: unknown) {
  return array(value).map(record).map((entry) => ({
    name: text(entry.name),
    value: text(entry.value),
  })).filter((entry): entry is { name: string; value: string } => Boolean(entry.name && entry.value))
}

export function buildListingFactoryInput(
  row: { id: string; package_hash: string; verdict: string; package_payload: unknown },
  context: VerifiedListingContext,
): ListingFactoryInput {
  const payload = record(row.package_payload)
  const identity = record(record(payload.productIdentity).identity)
  const economics = record(payload.economics)
  const targetEconomics = record(economics.targetEconomics)
  const comparables = record(payload.comparables)
  const counts = record(comparables.counts)
  const categoryId = text(context.categoryId)
  const categoryName = text(context.categoryName)
  const minimumSafePrice = numberOrNull(economics.minimumSafePrice)
  const targetPrice = numberOrNull(economics.targetPrice)
  const estimatedProfit = numberOrNull(targetEconomics.estimatedProfit)
  const estimatedMargin = numberOrNull(targetEconomics.estimatedNetMarginPercent)
  if (!categoryId || !categoryName) throw new Error("LISTING_FACTORY_CATEGORY_REQUIRED")
  if (!minimumSafePrice || !targetPrice || estimatedProfit === null || estimatedMargin === null) {
    throw new Error("LISTING_FACTORY_ECONOMICS_REQUIRED")
  }
  const verdict = row.verdict === "GO" || row.verdict === "GO_WITH_CHANGES"
    ? row.verdict
    : null
  if (!verdict) throw new Error("LISTING_FACTORY_DECISION_NOT_ELIGIBLE")
  const normalizedName = text(identity.normalizedProductName)
  if (!normalizedName) throw new Error("LISTING_FACTORY_PRODUCT_FACTS_REQUIRED")
  const keywords = normalizedStringArray(context.authorizedKeywords)
  if (!keywords.length) throw new Error("LISTING_FACTORY_AUTHORIZED_KEYWORDS_REQUIRED")
  return {
    decisionPackageId: row.id,
    decisionPackageHash: row.package_hash,
    identityFingerprint: String(record(payload.productIdentity).fingerprint ?? ""),
    verdict,
    productFacts: {
      manufacturerBrand: text(identity.manufacturerBrand),
      gtin: text(identity.gtin),
      mpn: text(identity.mpn),
      model: text(identity.model),
      normalizedProductName: normalizedName,
      packCount: numberOrNull(identity.packCount),
      unitCount: numberOrNull(identity.unitCount),
      size: text(identity.size),
      color: text(identity.color),
      scent: text(identity.scent),
      variant: text(identity.variant),
      condition: text(identity.condition),
    },
    economics: {
      minimumSafePrice,
      targetPrice,
      premiumPrice: numberOrNull(economics.premiumPrice),
      estimatedProfit,
      estimatedRoiPercent: numberOrNull(targetEconomics.estimatedRoiPercent),
      estimatedNetMarginPercent: estimatedMargin,
    },
    evidence: {
      activeExactCount: numberOrNull(counts.activeExact) ?? 0,
      soldOrCompletedExactCount: numberOrNull(counts.soldOrCompletedExact) ?? 0,
      estimatedDemandSignalCount: numberOrNull(counts.estimatedDemandSignals) ?? 0,
      weightedSoldMedian: numberOrNull(economics.weightedSoldMedian),
      activeMarketMedian: numberOrNull(economics.activeMarketMedian),
    },
    authorizedKeywords: keywords,
    category: {
      categoryId,
      categoryName,
      requiredAspects: requiredAspects(context.requiredAspects),
    },
    complianceRestrictions: normalizedStringArray(context.complianceRestrictions),
    shipping: {
      policyName: text(context.shippingPolicyName) ?? "SHIPPING_POLICY_REVIEW_REQUIRED",
      handlingTimeDays: integer(context.handlingTimeDays, 1, 0, 30),
    },
    returns: {
      policyName: text(context.returnPolicyName) ?? "RETURN_POLICY_REVIEW_REQUIRED",
      returnsAccepted: context.returnsAccepted === true,
      returnPeriodDays: context.returnsAccepted === true
        ? integer(context.returnPeriodDays, 30, 1, 365)
        : null,
    },
  }
}

async function loadApprovedDecisionPackage(
  supabase: SupabaseClient,
  accountKey: string,
  packageId: string,
) {
  const { data, error } = await supabase
    .from("marketplace_listing_decision_packages")
    .select("id,package_hash,verdict,status,package_payload")
    .eq("id", packageId)
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .maybeSingle()
  if (error) throw new Error("LISTING_FACTORY_DECISION_READ_FAILED")
  if (!data) throw new Error("LISTING_FACTORY_DECISION_NOT_FOUND")
  if (data.status !== "APPROVED") throw new Error("LISTING_FACTORY_DECISION_APPROVAL_REQUIRED")
  if (!['GO', 'GO_WITH_CHANGES'].includes(data.verdict)) {
    throw new Error("LISTING_FACTORY_DECISION_NOT_ELIGIBLE")
  }
  return data
}

export async function approveWinnerDecisionPackage(input: {
  supabase: SupabaseClient
  accountKey: string
  packageId: string
  packageHash: string
  actorId: string
  confirmed: boolean
}) {
  if (!input.confirmed) throw new Error("WINNER_DECISION_EXPLICIT_CONFIRMATION_REQUIRED")
  const now = new Date().toISOString()
  const { data, error } = await input.supabase
    .from("marketplace_listing_decision_packages")
    .update({ status: "APPROVED", approved_at: now, approved_by: input.actorId, updated_at: now })
    .eq("id", input.packageId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("package_hash", input.packageHash)
    .in("verdict", ["GO", "GO_WITH_CHANGES"])
    .in("status", ["GENERATED", "APPROVED"])
    .select("id,status,package_hash,approved_at")
    .maybeSingle()
  if (error) throw new Error("WINNER_DECISION_APPROVAL_FAILED")
  if (!data) throw new Error("WINNER_DECISION_APPROVAL_STALE")
  return { ...data, humanApproved: true, ebayWrites: 0 }
}

function adapterForMode(
  mode: "fake" | "real",
  injected?: ListingFactoryAdapter,
) {
  if (injected) return injected
  if (mode === "fake") return createFakeListingFactoryAdapter()
  const configuration = getOpenAiListingFactoryConfiguration()
  if (!configuration.realReady) throw new Error("OPENAI_LISTING_CONFIGURATION_MISSING")
  return createOpenAiListingFactoryAdapter()
}

export async function generateListingFactoryPackage(input: {
  supabase: SupabaseClient
  accountKey: string
  packageId: string
  packageHash: string
  context: VerifiedListingContext
  adapterMode: "fake" | "real"
  adapter?: ListingFactoryAdapter
}) {
  const environment = winnerEvidencePreviewConfiguration()
  if (!environment.configured) throw new Error("LISTING_FACTORY_PREVIEW_STAGING_REQUIRED")
  const decision = await loadApprovedDecisionPackage(input.supabase, input.accountKey, input.packageId)
  if (decision.package_hash !== input.packageHash) throw new Error("LISTING_FACTORY_DECISION_HASH_STALE")
  const factoryInput = buildListingFactoryInput(decision, input.context)
  const promptVersion = process.env.OPENAI_LISTING_PROMPT_VERSION?.trim() ||
    OPENAI_LISTING_FACTORY_DEFAULT_PROMPT_VERSION
  const model = input.adapterMode === "real"
    ? process.env.OPENAI_LISTING_MODEL?.trim() || ""
    : "fake-listing-factory-v1"
  const provider = input.adapterMode === "real" ? "OPENAI" : "FAKE"
  const inputHash = listingFactoryHash({ factoryInput, promptVersion })
  const { data: cached, error: cacheError } = await input.supabase
    .from("marketplace_listing_generations")
    .select("id,status,generation_output,output_hash,factual_validation,compliance_validation,usage_summary,generated_at,approved_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("decision_package_id", input.packageId)
    .eq("input_hash", inputHash)
    .eq("prompt_version", promptVersion)
    .eq("model", model)
    .eq("adapter", provider)
    .maybeSingle()
  if (cacheError) throw new Error("LISTING_FACTORY_CACHE_READ_FAILED")
  if (cached && ["GENERATED", "APPROVED"].includes(cached.status)) {
    return {
      generation: cached,
      cache: "HIT" as const,
      adapter: provider,
      promptVersion,
      inputHash,
      safety: { serverSide: true, secretsExposed: false, ebayWrites: 0, canPublish: false },
    }
  }
  const now = new Date().toISOString()
  const { data: generation, error: createError } = await input.supabase
    .from("marketplace_listing_generations")
    .upsert({
      marketplace_account_key: input.accountKey,
      marketplace: "EBAY_US",
      decision_package_id: input.packageId,
      decision_package_hash: input.packageHash,
      identity_fingerprint: factoryInput.identityFingerprint,
      input_hash: inputHash,
      schema_version: OPENAI_LISTING_FACTORY_SCHEMA_VERSION,
      prompt_version: promptVersion,
      model,
      adapter: provider,
      status: "GENERATING",
      updated_at: now,
    }, {
      onConflict: "marketplace_account_key,marketplace,decision_package_id,input_hash,prompt_version,model,adapter",
      ignoreDuplicates: false,
    })
    .select("id")
    .single()
  if (createError) throw new Error("LISTING_FACTORY_GENERATION_CREATE_FAILED")
  const adapter = adapterForMode(input.adapterMode, input.adapter)
  const maxRevisions = integer(process.env.OPENAI_LISTING_MAX_REVISIONS, 1, 0, 2)
  let validationErrors: string[] = []
  for (let revision = 0; revision <= maxRevisions; revision += 1) {
    const attemptNumber = revision + 1
    try {
      const result = await adapter.generate(factoryInput, { promptVersion, revision, validationErrors })
      const validation = validateListingFactoryOutput(factoryInput, result.output)
      const outputHash = validation.output ? listingFactoryHash(validation.output) : null
      const status = validation.valid ? "GENERATED" : "VALIDATION_FAILED"
      await input.supabase.from("marketplace_listing_generation_attempts").insert({
        generation_id: generation.id,
        attempt_number: attemptNumber,
        revision_number: revision,
        status,
        output_hash: outputHash,
        factual_validation: { valid: validation.factualErrors.length === 0, errors: validation.factualErrors },
        compliance_validation: { valid: validation.complianceErrors.length === 0, errors: validation.complianceErrors },
        usage_summary: result.usage,
        response_fingerprint: result.responseFingerprint,
      })
      if (!validation.valid) {
        validationErrors = [...validation.factualErrors, ...validation.complianceErrors]
        if (revision < maxRevisions) continue
      }
      const finishedAt = new Date().toISOString()
      const { data: finished, error: finishError } = await input.supabase
        .from("marketplace_listing_generations")
        .update({
          status,
          generation_output: validation.output,
          output_hash: outputHash,
          factual_validation: { valid: validation.factualErrors.length === 0, errors: validation.factualErrors },
          compliance_validation: { valid: validation.complianceErrors.length === 0, errors: validation.complianceErrors },
          usage_summary: result.usage,
          attempt_count: attemptNumber,
          revision_count: revision,
          response_fingerprint: result.responseFingerprint,
          last_error_code: validation.valid ? null : "LISTING_FACTORY_VALIDATION_FAILED",
          generated_at: validation.valid ? finishedAt : null,
          updated_at: finishedAt,
        })
        .eq("id", generation.id)
        .eq("status", "GENERATING")
        .select("id,status,generation_output,output_hash,factual_validation,compliance_validation,usage_summary,generated_at")
        .single()
      if (finishError) throw new Error("LISTING_FACTORY_GENERATION_FINISH_FAILED")
      if (!validation.valid) throw new Error("LISTING_FACTORY_VALIDATION_FAILED")
      return {
        generation: finished,
        cache: "MISS" as const,
        adapter: result.provider,
        promptVersion,
        inputHash,
        safety: { serverSide: true, secretsExposed: false, ebayWrites: 0, canPublish: false },
      }
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "LISTING_FACTORY_GENERATION_FAILED"
      if (code === "LISTING_FACTORY_VALIDATION_FAILED") throw error
      const failedAt = new Date().toISOString()
      await input.supabase.from("marketplace_listing_generation_attempts").insert({
        generation_id: generation.id,
        attempt_number: attemptNumber,
        revision_number: revision,
        status: "FAILED",
        error_code: code,
      })
      await input.supabase.from("marketplace_listing_generations").update({
        status: "FAILED",
        attempt_count: attemptNumber,
        revision_count: revision,
        last_error_code: code,
        updated_at: failedAt,
      }).eq("id", generation.id)
      throw new Error(code)
    }
  }
  throw new Error("LISTING_FACTORY_GENERATION_FAILED")
}

export async function approveListingGeneration(input: {
  supabase: SupabaseClient
  accountKey: string
  generationId: string
  outputHash: string
  actorId: string
  confirmed: boolean
}) {
  if (!input.confirmed) throw new Error("LISTING_GENERATION_EXPLICIT_CONFIRMATION_REQUIRED")
  const now = new Date().toISOString()
  const { data, error } = await input.supabase
    .from("marketplace_listing_generations")
    .update({ status: "APPROVED", approved_at: now, approved_by: input.actorId, updated_at: now })
    .eq("id", input.generationId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("status", "GENERATED")
    .eq("output_hash", input.outputHash)
    .select("id,status,output_hash,approved_at")
    .maybeSingle()
  if (error) throw new Error("LISTING_GENERATION_APPROVAL_FAILED")
  if (!data) throw new Error("LISTING_GENERATION_APPROVAL_STALE")
  return { ...data, humanApproved: true, ebayWrites: 0 }
}
