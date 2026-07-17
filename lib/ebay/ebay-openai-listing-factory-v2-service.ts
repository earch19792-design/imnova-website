import type { SupabaseClient } from "@supabase/supabase-js"

import { buildListingAiEvidenceDistillation } from "./ebay-openai-listing-evidence-distillation"

import {
  assessListingAiDecisionPackage,
  buildListingAiInputHash,
  buildListingAiInputFromDecisionPackage,
  createRealOpenAiListingAdapter,
  evaluateListingAiBudget,
  estimateListingAiCost,
  estimateListingAiPreflightCost,
  finalizeListingAiOutput,
  getListingAiConfiguration,
  getListingAiPromptDefinition,
  LISTING_AI_ENGINE_VERSION,
  LISTING_AI_SCHEMA_VERSION,
  LISTING_AI_VALIDATION_POLICY_VERSION,
  listingAiHash,
  listingAiCacheDisposition,
  listingAiCanonicalOutputSchema,
  listingAiInputSchema,
  validateListingAiModelOutput,
  type ListingAiAdapter,
  type ListingAiCanonicalOutput,
  type ListingAiDecisionRow,
  type ListingAiInput,
} from "./ebay-openai-listing-factory-v2"

type JsonRecord = Record<string, unknown>

const GENERATE_RATE_LIMIT_PER_MINUTE = 5

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
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

function stringArray(value: unknown, maximum = 50) {
  return [...new Set(array(value).map(text).filter((entry): entry is string => Boolean(entry)))]
    .slice(0, maximum)
}

function safeCodes(value: unknown) {
  return stringArray(value, 30).filter((code) => /^[A-Z0-9_:.-]+$/.test(code))
}

export async function loadListingAiBudgetStatus(
  supabase: SupabaseClient,
  accountKey: string,
  now = new Date(),
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = getListingAiConfiguration(environment)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data, error } = await supabase
    .from("ai_listing_budget_usage")
    .select("estimated_cost_usd,status,cache_hit")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .gte("started_at", monthStart)
    .in("status", ["COMPLETED", "FAILED"])
  if (error) throw new Error("LISTING_AI_BUDGET_READ_FAILED")
  const spentUsd = Math.round((data ?? []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.estimated_cost_usd ?? 0)), 0,
  ) * 1_000_000) / 1_000_000
  return {
    monthStart,
    spentUsd,
    remainingUsd: Math.max(0, Math.round((configuration.monthlyBudgetUsd - spentUsd) * 1_000_000) / 1_000_000),
    warningReached: spentUsd >= configuration.warningBudgetUsd,
    hardStopReached: spentUsd >= configuration.hardStopUsd,
    monthlyBudgetUsd: configuration.monthlyBudgetUsd,
    warningBudgetUsd: configuration.warningBudgetUsd,
    hardStopUsd: configuration.hardStopUsd,
    clientBypassAllowed: false,
  }
}

async function ensurePromptVersion(supabase: SupabaseClient, promptVersion: string) {
  const prompt = getListingAiPromptDefinition(promptVersion)
  const { error } = await supabase.from("ai_listing_prompt_versions").insert({
    prompt_version: prompt.promptVersion,
    schema_version: prompt.schemaVersion,
    engine_version: prompt.engineVersion,
    validation_policy_version: prompt.validationPolicyVersion,
    system_prompt_hash: prompt.hashes.system,
    generation_prompt_hash: prompt.hashes.generation,
    revision_prompt_hash: prompt.hashes.revision,
    prompt_templates: {
      system: prompt.systemPrompt,
      generation: prompt.generationPrompt,
      revision: prompt.revisionPrompt,
    },
  })
  if (error && error.code !== "23505") throw new Error("LISTING_AI_PROMPT_VERSION_PERSIST_FAILED")
  return prompt
}

async function enforceRateLimit(
  supabase: SupabaseClient,
  accountKey: string,
  actorId: string,
  now: Date,
) {
  const from = new Date(now.getTime() - 60_000).toISOString()
  const { count, error } = await supabase.from("ai_listing_generation_runs")
    .select("id", { count: "exact", head: true })
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("requested_by", actorId)
    .gte("created_at", from)
  if (error) throw new Error("LISTING_AI_RATE_LIMIT_READ_FAILED")
  if ((count ?? 0) >= GENERATE_RATE_LIMIT_PER_MINUTE) throw new Error("LISTING_AI_RATE_LIMITED")
}

async function readDecisionPackage(
  supabase: SupabaseClient,
  accountKey: string,
  packageId: string,
) {
  const { data, error } = await supabase.from("marketplace_listing_decision_packages")
    .select("id,candidate_id,package_version,package_hash,product_identity_fingerprint,verdict,status,package_payload,approved_at")
    .eq("id", packageId)
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .maybeSingle()
  if (error) throw new Error("LISTING_AI_DECISION_READ_FAILED")
  if (!data) throw new Error("LISTING_AI_DECISION_NOT_FOUND")
  return data as ListingAiDecisionRow
}

async function readRunSummary(supabase: SupabaseClient, accountKey: string, runId: string) {
  const { data, error } = await supabase.from("ai_listing_generation_runs")
    .select("id,candidate_id,decision_package_id,decision_package_hash,identity_fingerprint,input_hash,schema_version,prompt_version,model,review_model,adapter,status,current_version_id,revision_count,max_revisions,cache_hit,budget_warning,projected_cost_usd,total_estimated_cost_usd,last_error_code,started_at,completed_at,created_at,updated_at")
    .eq("id", runId)
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .maybeSingle()
  if (error) throw new Error("LISTING_AI_GENERATION_READ_FAILED")
  if (!data) throw new Error("LISTING_AI_GENERATION_NOT_FOUND")
  return data
}

export async function getListingAiGeneration(
  supabase: SupabaseClient,
  accountKey: string,
  runId: string,
) {
  const run = await readRunSummary(supabase, accountKey, runId)
  const [versions, validations, approvals] = await Promise.all([
    supabase.from("ai_listing_generation_versions")
      .select("id,version_number,revision_number,output_hash,generation_output,model_metadata,prompt_version,prompt_hashes,created_at")
      .eq("generation_run_id", runId).order("version_number", { ascending: true }),
    supabase.from("ai_listing_validation_results")
      .select("id,generation_version_id,revision_number,validation_kind,passed,error_codes,validation_policy_version,created_at")
      .eq("generation_run_id", runId).order("created_at", { ascending: true }),
    supabase.from("ai_listing_approvals")
      .select("id,generation_version_id,action,output_hash,reason_code,created_at")
      .eq("generation_run_id", runId).order("created_at", { ascending: true }),
  ])
  if (versions.error || validations.error || approvals.error) {
    throw new Error("LISTING_AI_GENERATION_DETAILS_READ_FAILED")
  }
  return {
    run,
    versions: versions.data ?? [],
    validations: validations.data ?? [],
    approvals: approvals.data ?? [],
    safety: {
      serverSideOnly: true,
      secretsExposed: false,
      piiExposed: false,
      competitorContentExposed: false,
      canPublish: false,
      ebayWrites: 0,
    },
  }
}

async function cacheResult(
  supabase: SupabaseClient,
  accountKey: string,
  run: { id: string; status: string },
  idempotencyKeyHash: string,
  candidateId: string | null,
  model: string,
  now: Date,
) {
  const disposition = listingAiCacheDisposition(run.status)
  if (disposition === "CACHE_HIT") {
    await supabase.from("ai_listing_generation_runs").update({ cache_hit: true, updated_at: now.toISOString() })
      .eq("id", run.id).eq("marketplace_account_key", accountKey)
    const { error: usageError } = await supabase.from("ai_listing_budget_usage").insert({
      marketplace_account_key: accountKey,
      marketplace: "EBAY_US",
      generation_run_id: run.id,
      candidate_id: candidateId,
      model,
      idempotency_key_hash: listingAiHash({ idempotencyKeyHash, cache: true }),
      sanitized_request_id: null,
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      status: "CACHE_HIT",
      cache_hit: true,
      revision_number: 0,
      started_at: now.toISOString(),
      completed_at: now.toISOString(),
    })
    if (usageError && usageError.code !== "23505") {
      throw new Error("LISTING_AI_BUDGET_USAGE_PERSIST_FAILED")
    }
    return {
      cache: "HIT" as const,
      generation: await getListingAiGeneration(supabase, accountKey, run.id),
      incrementalCostUsd: 0,
      ebayWrites: 0,
      canPublish: false,
    }
  }
  if (disposition === "TERMINAL_NO_RETRY") return {
    cache: "TERMINAL" as const,
    generation: await getListingAiGeneration(supabase, accountKey, run.id),
    incrementalCostUsd: 0,
    ebayWrites: 0,
    canPublish: false,
  }
  return {
    cache: "IN_PROGRESS" as const,
    generation: { run },
    incrementalCostUsd: 0,
    ebayWrites: 0,
    canPublish: false,
  }
}

async function persistBudgetUsage(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  candidateId: string | null
  model: string
  idempotencyKeyHash: string
  requestId: string | null
  usage: { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null }
  status: "COMPLETED" | "FAILED"
  revisionNumber: number
  startedAt: string
  completedAt: string
}) {
  const estimatedCostUsd = estimateListingAiCost(input.usage)
  const { error } = await input.supabase.from("ai_listing_budget_usage").insert({
    marketplace_account_key: input.accountKey,
    marketplace: "EBAY_US",
    generation_run_id: input.runId,
    candidate_id: input.candidateId,
    model: input.model,
    idempotency_key_hash: listingAiHash({ input: input.idempotencyKeyHash, revision: input.revisionNumber }),
    sanitized_request_id: input.requestId,
    input_tokens: input.usage.inputTokens,
    cached_input_tokens: input.usage.cachedInputTokens,
    output_tokens: input.usage.outputTokens,
    estimated_cost_usd: estimatedCostUsd,
    status: input.status,
    cache_hit: false,
    revision_number: input.revisionNumber,
    started_at: input.startedAt,
    completed_at: input.completedAt,
  })
  if (error && error.code !== "23505") throw new Error("LISTING_AI_BUDGET_USAGE_PERSIST_FAILED")
  return estimatedCostUsd
}

async function executeGeneration(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  candidateId: string | null
  factoryInput: ListingAiInput
  inputHash: string
  idempotencyKeyHash: string
  promptVersion: string
  model: string
  adapter: ListingAiAdapter
  startRevision: number
  maxRevisions: number
  initialTotalCostUsd?: number
  initialValidationErrors?: string[]
  environment?: NodeJS.ProcessEnv
  now?: () => Date
}) {
  let validationErrors = input.initialValidationErrors ?? []
  let totalCost = Math.max(0, input.initialTotalCostUsd ?? 0)
  const prompt = getListingAiPromptDefinition(input.promptVersion)
  for (let revision = input.startRevision; revision <= input.maxRevisions; revision += 1) {
    const budget = await loadListingAiBudgetStatus(
      input.supabase, input.accountKey, (input.now ?? (() => new Date()))(), input.environment,
    )
    const projected = estimateListingAiPreflightCost(input.factoryInput, input.promptVersion)
    const budgetDecision = evaluateListingAiBudget({
      spentUsd: budget.spentUsd,
      projectedCostUsd: projected.estimatedCostUsd,
      warningBudgetUsd: budget.warningBudgetUsd,
      hardStopUsd: budget.hardStopUsd,
    })
    if (budgetDecision.hardStopReached) {
      await input.supabase.from("ai_listing_validation_results").insert({
        generation_run_id: input.runId,
        generation_version_id: null,
        revision_number: revision,
        validation_kind: "BUDGET",
        passed: false,
        error_codes: ["OPENAI_LISTING_HARD_STOP_REACHED"],
        validation_policy_version: LISTING_AI_VALIDATION_POLICY_VERSION,
      })
      await input.supabase.from("ai_listing_generation_runs").update({
        status: "BUDGET_BLOCKED",
        last_error_code: "OPENAI_LISTING_HARD_STOP_REACHED",
        budget_warning: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
      throw new Error("OPENAI_LISTING_HARD_STOP_REACHED")
    }
    const startedAt = (input.now ?? (() => new Date()))().toISOString()
    let result
    try {
      result = await input.adapter.generate(input.factoryInput, {
        promptVersion: input.promptVersion,
        revisionNumber: revision,
        validationErrors,
      })
    } catch (error) {
      const completedAt = (input.now ?? (() => new Date()))().toISOString()
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message : "OPENAI_LISTING_GENERATION_FAILED"
      await persistBudgetUsage({
        supabase: input.supabase,
        accountKey: input.accountKey,
        runId: input.runId,
        candidateId: input.candidateId,
        model: input.model,
        idempotencyKeyHash: input.idempotencyKeyHash,
        requestId: null,
        usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null },
        status: "FAILED",
        revisionNumber: revision,
        startedAt,
        completedAt,
      })
      await input.supabase.from("ai_listing_generation_runs").update({
        status: "FAILED", revision_count: revision, last_error_code: code,
        completed_at: completedAt, updated_at: completedAt,
      }).eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
      throw new Error(code)
    }
    const completedAt = (input.now ?? (() => new Date()))().toISOString()
    const cost = await persistBudgetUsage({
      supabase: input.supabase,
      accountKey: input.accountKey,
      runId: input.runId,
      candidateId: input.candidateId,
      model: result.model,
      idempotencyKeyHash: input.idempotencyKeyHash,
      requestId: result.sanitizedRequestId,
      usage: result.usage,
      status: "COMPLETED",
      revisionNumber: revision,
      startedAt,
      completedAt,
    })
    totalCost += cost
    const validation = validateListingAiModelOutput(input.factoryInput, result.output)
    let canonical: ListingAiCanonicalOutput | null = null
    let versionId: string | null = null
    if (validation.output) {
      canonical = finalizeListingAiOutput({
        modelOutput: validation.output,
        provider: result.provider,
        model: result.model,
        revisionNumber: revision,
        usage: result.usage,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash,
      })
      const { data: version, error: versionError } = await input.supabase
        .from("ai_listing_generation_versions").insert({
          generation_run_id: input.runId,
          version_number: revision + 1,
          revision_number: revision,
          output_hash: canonical.outputHash,
          generation_output: canonical,
          model_metadata: canonical.modelMetadata,
          prompt_version: input.promptVersion,
          prompt_hashes: prompt.hashes,
        }).select("id").single()
      if (versionError) throw new Error("LISTING_AI_VERSION_PERSIST_FAILED")
      versionId = version.id
    }
    const validationRows = [
      { kind: "SCHEMA", passed: validation.schemaErrors.length === 0, errors: validation.schemaErrors },
      { kind: "FACTUAL", passed: validation.factualErrors.length === 0, errors: validation.factualErrors },
      { kind: "COMPLIANCE", passed: validation.complianceErrors.length === 0, errors: validation.complianceErrors },
    ].map((entry) => ({
      generation_run_id: input.runId,
      generation_version_id: versionId,
      revision_number: revision,
      validation_kind: entry.kind,
      passed: entry.passed,
      error_codes: entry.errors,
      validation_policy_version: LISTING_AI_VALIDATION_POLICY_VERSION,
    }))
    const { error: validationError } = await input.supabase
      .from("ai_listing_validation_results").insert(validationRows)
    if (validationError) throw new Error("LISTING_AI_VALIDATION_PERSIST_FAILED")
    if (validation.valid && canonical && versionId) {
      const latestBudget = await loadListingAiBudgetStatus(
        input.supabase, input.accountKey, new Date(completedAt), input.environment,
      )
      const { error } = await input.supabase.from("ai_listing_generation_runs").update({
        status: "GENERATED",
        current_version_id: versionId,
        revision_count: revision,
        budget_warning: latestBudget.warningReached,
        total_estimated_cost_usd: totalCost,
        last_error_code: null,
        completed_at: completedAt,
        updated_at: completedAt,
      }).eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
      if (error) throw new Error("LISTING_AI_RUN_FINISH_FAILED")
      return getListingAiGeneration(input.supabase, input.accountKey, input.runId)
    }
    validationErrors = [
      ...validation.schemaErrors, ...validation.factualErrors, ...validation.complianceErrors,
    ]
    if (revision < input.maxRevisions) continue
    const { error } = await input.supabase.from("ai_listing_generation_runs").update({
      status: "HUMAN_REVIEW_REQUIRED",
      current_version_id: versionId,
      revision_count: revision,
      total_estimated_cost_usd: totalCost,
      last_error_code: "LISTING_AI_VALIDATION_FAILED",
      completed_at: completedAt,
      updated_at: completedAt,
    }).eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
    if (error) throw new Error("LISTING_AI_RUN_FINISH_FAILED")
    return getListingAiGeneration(input.supabase, input.accountKey, input.runId)
  }
  throw new Error("LISTING_AI_GENERATION_FAILED")
}

export async function generateListingAi(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  packageId: string
  packageHash: string
  idempotencyKey: string
  adapter?: ListingAiAdapter
  adapterModel?: string
  environment?: NodeJS.ProcessEnv
  now?: Date
}) {
  const environment = input.environment ?? process.env
  const configuration = getListingAiConfiguration(environment)
  if (!configuration.preview || !configuration.staging) {
    throw new Error("LISTING_AI_PREVIEW_STAGING_REQUIRED")
  }
  if (!input.adapter && !configuration.realReady) {
    throw new Error(configuration.status === "DISABLED"
      ? "OPENAI_LISTING_FACTORY_DISABLED"
      : configuration.status === "MISSING_API_KEY"
        ? "OPENAI_LISTING_API_KEY_MISSING"
        : "OPENAI_LISTING_CONFIGURATION_MISSING")
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new Error("LISTING_AI_IDEMPOTENCY_KEY_REQUIRED")
  }
  const now = input.now ?? new Date()
  const decision = await readDecisionPackage(input.supabase, input.accountKey, input.packageId)
  if (decision.package_hash !== input.packageHash) throw new Error("LISTING_AI_PACKAGE_HASH_STALE")
  const factoryInput = buildListingAiInputFromDecisionPackage(decision, now)
  const promptVersion = configuration.promptVersion
  const model = input.adapterModel ?? configuration.model ?? ""
  if (!model) throw new Error("OPENAI_LISTING_MODEL_MISSING")
  const prompt = await ensurePromptVersion(input.supabase, promptVersion)
  const inputHash = buildListingAiInputHash(factoryInput, promptVersion, model)
  const idempotencyKeyHash = listingAiHash({
    accountKey: input.accountKey,
    actorId: input.actorId,
    action: "GENERATE",
    key: input.idempotencyKey,
  })
  const { data: cached, error: cacheError } = await input.supabase
    .from("ai_listing_generation_runs")
    .select("id,status")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("input_hash", inputHash)
    .eq("model", model)
    .eq("prompt_version", promptVersion)
    .maybeSingle()
  if (cacheError) throw new Error("LISTING_AI_CACHE_READ_FAILED")
  if (cached) return cacheResult(
    input.supabase, input.accountKey, cached, idempotencyKeyHash,
    factoryInput.candidateId, model, now,
  )
  await enforceRateLimit(input.supabase, input.accountKey, input.actorId, now)
  const budget = await loadListingAiBudgetStatus(input.supabase, input.accountKey, now, environment)
  const projected = estimateListingAiPreflightCost(factoryInput, promptVersion)
  const budgetDecision = evaluateListingAiBudget({
    spentUsd: budget.spentUsd,
    projectedCostUsd: projected.estimatedCostUsd,
    warningBudgetUsd: budget.warningBudgetUsd,
    hardStopUsd: budget.hardStopUsd,
  })
  if (budgetDecision.hardStopReached) {
    throw new Error("OPENAI_LISTING_HARD_STOP_REACHED")
  }
  const adapter = input.adapter ?? createRealOpenAiListingAdapter(environment)
  const { data: run, error: runError } = await input.supabase
    .from("ai_listing_generation_runs").insert({
      marketplace_account_key: input.accountKey,
      marketplace: "EBAY_US",
      candidate_id: factoryInput.candidateId,
      decision_package_id: input.packageId,
      decision_package_hash: input.packageHash,
      identity_fingerprint: factoryInput.identityFingerprint,
      input_hash: inputHash,
      schema_version: LISTING_AI_SCHEMA_VERSION,
      prompt_version: prompt.promptVersion,
      model,
      review_model: configuration.reviewModel === "CONFIGURED"
        ? environment.OPENAI_LISTING_REVIEW_MODEL?.trim() : null,
      adapter: input.adapter ? "FAKE" : "OPENAI",
      status: "GENERATING",
      requested_by: input.actorId,
      idempotency_key_hash: idempotencyKeyHash,
      max_revisions: configuration.maxRevisions,
      projected_cost_usd: projected.estimatedCostUsd,
      budget_warning: budget.warningReached,
      started_at: now.toISOString(),
      updated_at: now.toISOString(),
    }).select("id").single()
  if (runError) {
    if (runError.code === "23505") {
      const { data: concurrent } = await input.supabase.from("ai_listing_generation_runs")
        .select("id,status").eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").eq("input_hash", inputHash).maybeSingle()
      if (concurrent) return cacheResult(
        input.supabase, input.accountKey, concurrent, idempotencyKeyHash,
        factoryInput.candidateId, model, now,
      )
    }
    throw new Error("LISTING_AI_RUN_CREATE_FAILED")
  }
  const generation = await executeGeneration({
    supabase: input.supabase,
    accountKey: input.accountKey,
    runId: run.id,
    candidateId: factoryInput.candidateId,
    factoryInput,
    inputHash,
    idempotencyKeyHash,
    promptVersion,
    model,
    adapter,
    startRevision: 0,
    maxRevisions: configuration.maxRevisions,
    environment,
  })
  return {
    cache: "MISS" as const,
    generation,
    incrementalCostUsd: generation.run.total_estimated_cost_usd,
    safety: {
      serverSideOnly: true,
      apiKeyExposed: false,
      piiExposed: false,
      competitorContentIncluded: false,
      canPublish: false,
      ebayWrites: 0,
    },
  }
}

async function appendApproval(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  versionId: string | null
  action: "APPROVE" | "REJECT" | "REQUEST_REVISION" | "RESTORE_VERSION"
  outputHash: string | null
  idempotencyKey: string
  reasonCode?: string | null
}) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new Error("LISTING_AI_IDEMPOTENCY_KEY_REQUIRED")
  }
  const idempotencyHash = listingAiHash({
    accountKey: input.accountKey,
    actorId: input.actorId,
    runId: input.runId,
    action: input.action,
    key: input.idempotencyKey,
  })
  const reasonCode = input.reasonCode && /^[A-Z0-9_]+$/.test(input.reasonCode)
    ? input.reasonCode : null
  const { error } = await input.supabase.from("ai_listing_approvals").insert({
    generation_run_id: input.runId,
    generation_version_id: input.versionId,
    action: input.action,
    actor_id: input.actorId,
    output_hash: input.outputHash,
    idempotency_key_hash: idempotencyHash,
    reason_code: reasonCode,
  })
  if (error && error.code !== "23505") throw new Error("LISTING_AI_APPROVAL_EVENT_FAILED")
  return { idempotencyHash, duplicate: error?.code === "23505" }
}

export async function approveListingAiGeneration(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  versionId: string
  outputHash: string
  idempotencyKey: string
  confirmed: boolean
}) {
  if (!input.confirmed) throw new Error("LISTING_AI_EXPLICIT_APPROVAL_REQUIRED")
  const details = await getListingAiGeneration(input.supabase, input.accountKey, input.runId)
  if (details.run.status !== "GENERATED" || details.run.current_version_id !== input.versionId) {
    throw new Error("LISTING_AI_APPROVAL_STATE_INVALID")
  }
  const version = details.versions.find((entry) => entry.id === input.versionId)
  if (!version || version.output_hash !== input.outputHash ||
    !listingAiCanonicalOutputSchema.safeParse(version.generation_output).success) {
    throw new Error("LISTING_AI_APPROVAL_HASH_STALE")
  }
  const event = await appendApproval({ ...input, action: "APPROVE" })
  if (!event.duplicate) {
    const now = new Date().toISOString()
    const { error } = await input.supabase.from("ai_listing_generation_runs").update({
      status: "APPROVED", completed_at: now, updated_at: now,
    }).eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
      .eq("status", "GENERATED").eq("current_version_id", input.versionId)
    if (error) throw new Error("LISTING_AI_APPROVAL_FAILED")
  }
  return {
    generation: await getListingAiGeneration(input.supabase, input.accountKey, input.runId),
    duplicate: event.duplicate,
    canPublish: false,
    ebayWrites: 0,
  }
}

export async function rejectListingAiGeneration(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  versionId: string | null
  outputHash: string | null
  idempotencyKey: string
  reasonCode: string
}) {
  const details = await getListingAiGeneration(input.supabase, input.accountKey, input.runId)
  if (!["GENERATED", "HUMAN_REVIEW_REQUIRED"].includes(details.run.status)) {
    throw new Error("LISTING_AI_REJECTION_STATE_INVALID")
  }
  const event = await appendApproval({ ...input, action: "REJECT" })
  if (!event.duplicate) {
    const now = new Date().toISOString()
    const { error } = await input.supabase.from("ai_listing_generation_runs").update({
      status: "REJECTED", completed_at: now, updated_at: now,
    }).eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
    if (error) throw new Error("LISTING_AI_REJECTION_FAILED")
  }
  return {
    generation: await getListingAiGeneration(input.supabase, input.accountKey, input.runId),
    duplicate: event.duplicate,
    canPublish: false,
    ebayWrites: 0,
  }
}

export async function requestListingAiRevision(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  idempotencyKey: string
  reasonCodes: string[]
  restoreVersionId?: string | null
  adapter?: ListingAiAdapter
  adapterModel?: string
  environment?: NodeJS.ProcessEnv
}) {
  const environment = input.environment ?? process.env
  const details = await getListingAiGeneration(input.supabase, input.accountKey, input.runId)
  if (!["GENERATED", "HUMAN_REVIEW_REQUIRED"].includes(details.run.status)) {
    throw new Error("LISTING_AI_REVISION_STATE_INVALID")
  }
  if (input.restoreVersionId) {
    const version = details.versions.find((entry) => entry.id === input.restoreVersionId)
    if (!version || !listingAiCanonicalOutputSchema.safeParse(version.generation_output).success) {
      throw new Error("LISTING_AI_RESTORE_VERSION_INVALID")
    }
    const event = await appendApproval({
      ...input,
      versionId: version.id,
      action: "RESTORE_VERSION",
      outputHash: version.output_hash,
      reasonCode: safeCodes(input.reasonCodes)[0] ?? "RESTORE_PREVIOUS_VERSION",
    })
    if (!event.duplicate) {
      const now = new Date().toISOString()
      const { error } = await input.supabase.from("ai_listing_generation_runs").update({
        status: "GENERATED", current_version_id: version.id,
        last_error_code: null, updated_at: now,
      }).eq("id", input.runId).eq("marketplace_account_key", input.accountKey)
      if (error) throw new Error("LISTING_AI_RESTORE_FAILED")
    }
    return {
      generation: await getListingAiGeneration(input.supabase, input.accountKey, input.runId),
      duplicate: event.duplicate,
      openAiCalls: 0,
      ebayWrites: 0,
      canPublish: false,
    }
  }
  if (details.run.revision_count >= details.run.max_revisions) {
    throw new Error("LISTING_AI_MAX_REVISIONS_REACHED")
  }
  const currentVersion = details.versions.find((entry) => entry.id === details.run.current_version_id)
  const event = await appendApproval({
    ...input,
    versionId: currentVersion?.id ?? null,
    action: "REQUEST_REVISION",
    outputHash: currentVersion?.output_hash ?? null,
    reasonCode: safeCodes(input.reasonCodes)[0] ?? "HUMAN_REVISION_REQUESTED",
  })
  if (event.duplicate) return {
    generation: details,
    duplicate: true,
    ebayWrites: 0,
    canPublish: false,
  }
  const decision = await readDecisionPackage(
    input.supabase, input.accountKey, details.run.decision_package_id,
  )
  if (decision.package_hash !== details.run.decision_package_hash ||
    decision.product_identity_fingerprint !== details.run.identity_fingerprint) {
    throw new Error("LISTING_AI_REVISION_PACKAGE_STALE")
  }
  const factoryInput = buildListingAiInputFromDecisionPackage(decision)
  const adapter = input.adapter ?? createRealOpenAiListingAdapter(environment)
  return {
    generation: await executeGeneration({
      supabase: input.supabase,
      accountKey: input.accountKey,
      runId: input.runId,
      candidateId: details.run.candidate_id,
      factoryInput,
      inputHash: details.run.input_hash,
      idempotencyKeyHash: event.idempotencyHash,
      promptVersion: details.run.prompt_version,
      model: input.adapterModel ?? details.run.model,
      adapter,
      startRevision: details.run.revision_count + 1,
      maxRevisions: details.run.max_revisions,
      initialTotalCostUsd: numberOrNull(details.run.total_estimated_cost_usd) ?? 0,
      initialValidationErrors: safeCodes(input.reasonCodes),
      environment,
    }),
    duplicate: false,
    ebayWrites: 0,
    canPublish: false,
  }
}

export async function getListingAiStatus(
  supabase: SupabaseClient,
  accountKey: string,
  environment: NodeJS.ProcessEnv = process.env,
  now = new Date(),
) {
  const configuration = getListingAiConfiguration(environment)
  const [packages, runs, budget] = await Promise.all([
    supabase.from("marketplace_listing_decision_packages")
      .select("id,candidate_id,package_version,package_hash,product_identity_fingerprint,verdict,status,package_payload,approved_at,created_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", "EBAY_US")
      .order("created_at", { ascending: false }).limit(10),
    supabase.from("ai_listing_generation_runs")
      .select("id,candidate_id,decision_package_id,decision_package_hash,identity_fingerprint,input_hash,prompt_version,model,status,current_version_id,revision_count,max_revisions,cache_hit,budget_warning,projected_cost_usd,total_estimated_cost_usd,last_error_code,created_at,updated_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", "EBAY_US")
      .order("created_at", { ascending: false }).limit(20),
    loadListingAiBudgetStatus(supabase, accountKey, now, environment),
  ])
  if (packages.error || runs.error) throw new Error("LISTING_AI_STATUS_READ_FAILED")
  const decisions = (packages.data ?? []).map((row) => {
    const typedRow = row as ListingAiDecisionRow
    const assessment = assessListingAiDecisionPackage(typedRow, now)
    const payload = record(row.package_payload)
    const productIdentity = record(payload.productIdentity)
    const identity = record(productIdentity.identity)
    let estimatedCostUsd: number | null = null
    let evidenceDistillation: ListingAiInput["evidenceDistillation"] | null = null
    try {
      evidenceDistillation = buildListingAiEvidenceDistillation(typedRow, now)
    } catch {
      evidenceDistillation = null
    }
    if (assessment.eligible) {
      const factoryInput = buildListingAiInputFromDecisionPackage(typedRow, now)
      if (configuration.model) {
        estimatedCostUsd = estimateListingAiPreflightCost(
          factoryInput, configuration.promptVersion,
        ).estimatedCostUsd
      }
    }
    return {
      id: row.id,
      candidateId: row.candidate_id,
      packageVersion: row.package_version,
      packageHash: row.package_hash,
      identityFingerprint: row.product_identity_fingerprint,
      verdict: row.verdict,
      status: row.status,
      approvedAt: row.approved_at,
      productName: text(identity.normalizedProductName),
      estimatedCostUsd,
      evidenceDistillation,
      assessment,
    }
  })
  return {
    activeLoop: "LOOP_2_OPENAI_LISTING_INTELLIGENCE_OPTIMIZATION_FACTORY",
    loop1Package: decisions.find((entry) => entry.assessment.eligible) ?? decisions[0] ?? null,
    decisions,
    generations: runs.data ?? [],
    configuration,
    budget,
    backgroundMonitor: "INDEPENDENT",
    safety: {
      previewOnly: true,
      stagingOnly: true,
      serverSideOnly: true,
      openAiCalls: 0,
      imageGenerationStarted: false,
      draftsCreated: 0,
      publicationsCreated: 0,
      canPublish: false,
      ebayWrites: 0,
      secretsExposed: false,
      piiExposed: false,
    },
  }
}
