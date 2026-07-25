import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

export const PRODUCT_RESEARCH_QUERY_PLAN_VERSION =
  "PRODUCT_RESEARCH_QUERY_PLAN_V1_2026_07_17"

type JsonRecord = Record<string, unknown>

export type ProductResearchQueryCandidate = {
  supplierVariantId: string
  productName: string
  brand?: string | null
  categoryId?: string | null
  priorityScore?: number | null
}

export type ProductResearchPlannedQuery = {
  ordinal: number
  searchQuery: string
  queryHash: string
  clusterKeyHash: string
  categoryId: string | null
  candidateCount: number
  candidateVariantHashes: string[]
}

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "new", "pack", "packs", "lot", "set",
  "count", "ct", "each", "per", "unit", "units", "piece", "pieces", "size",
  "default", "title", "assorted", "various", "of", "a", "an", "in", "on",
])

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function normalizedTokens(value: unknown) {
  return (text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) &&
      !/^\d+(?:oz|ml|g|kg|lb|ct)?$/.test(token))
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`
}

function canonicalQuery(value: unknown) {
  const tokens = (text(value, 240).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").match(/[a-z0-9]+/g) ?? [])
  const meaningful: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    // Luna uses this placeholder when a product has no real variant. It is not
    // part of the commercial identity and eBay may omit it from the search box.
    if (tokens[index] === "default" && tokens[index + 1] === "title") {
      index += 1
      continue
    }
    meaningful.push(tokens[index])
  }
  return meaningful.join(" ")
}

function displayIdentity(value: unknown) {
  return text(value, 100).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

export function productResearchDisplayQuery(value: unknown) {
  const display = text(value, 100).replace(/\bdefault\s+title\b/gi, " ")
    .trim().replace(/\s+/g, " ")
  const tokens = display.split(" ")
  let end = tokens.length
  const unit = (token: string) => /^(?:fl|fluid|oz|ounce|ounces|ml|milliliter|milliliters|l|liter|liters|litre|litres|g|gram|grams|kg|kilogram|kilograms|lb|lbs|pound|pounds|ct|count|counts)$/i
    .test(token.replace(/[^a-z]/gi, ""))
  let unitsRemoved = 0
  while (end > 0 && unit(tokens[end - 1])) {
    end -= 1
    unitsRemoved += 1
  }
  let numbersRemoved = 0
  while (end > 0 && /^\d+(?:[.,]\d+)?$/.test(tokens[end - 1])) {
    end -= 1
    numbersRemoved += 1
  }
  return unitsRemoved > 0 && numbersRemoved > 0 && end >= 3
    ? tokens.slice(0, end).join(" ")
    : display
}

export function productResearchMarketplaceFamilyQuery(value: unknown) {
  if (typeof value !== "string") return ""
  const title = value.normalize("NFKC").replace(/\bdefault\s+title\b/gi, " ")
    .trim().replace(/\s+/g, " ")
  const byManufacturer = title.match(/^(.{2,60}?)\s+by\s+(.+)$/i)
  if (!byManufacturer) return ""

  // Marketplace sellers commonly omit the manufacturer phrase and fabrication
  // adjectives while retaining the line/family plus the product type. Build
  // that bounded alias only when a measurement gives us a reliable boundary;
  // exact size, pack and variant are still decided by row-level reconciliation.
  const measurement = byManufacturer[2].match(
    /\b\d+(?:[.,]\d+)?\s*(?:fl\s*)?(?:qt|quart|quarts|oz|ounce|ounces|ml|milliliter|milliliters|l|liter|liters|litre|litres|g|gram|grams|kg|kilogram|kilograms|lb|lbs|pound|pounds|ct|count|counts)\b/i,
  )
  if (measurement?.index === undefined) return ""
  const family = displayIdentity(byManufacturer[1])
  const beforeMeasurement = displayIdentity(
    byManufacturer[2].slice(0, measurement.index),
  ).split(" ").filter(Boolean)
  const productType = beforeMeasurement.slice(-1).join(" ")
  const query = productResearchDisplayQuery(`${family} ${productType}`)
  return query.split(" ").filter(Boolean).length >= 3 ? query : ""
}

export function productResearchQueriesMatch(left: unknown, right: unknown) {
  const leftCanonical = canonicalQuery(left)
  const rightCanonical = canonicalQuery(right)
  if (!leftCanonical || !rightCanonical) return false
  if (leftCanonical === rightCanonical) return true
  return canonicalQuery(productResearchDisplayQuery(left)) ===
    canonicalQuery(productResearchDisplayQuery(right))
}

function queryHash(value: string) {
  return sha256(canonicalQuery(value))
}

export function productResearchPlannedQueryHash(value: unknown) {
  return queryHash(text(value, 100))
}

export function summarizeProductResearchQueryTaskStatuses(statuses: unknown[]) {
  const normalized = statuses.map((status) => text(status, 24).toUpperCase())
  const capturedCount = normalized.filter((status) =>
    status === "CAPTURED" || status === "PROCESSED").length
  const skippedCount = normalized.filter((status) => status === "SKIPPED").length
  return {
    capturedCount,
    skippedCount,
    settledCount: capturedCount + skippedCount,
  }
}

function explicitBrand(metadata: JsonRecord) {
  return text(metadata.manufacturerBrand ?? metadata.brand, 80) || null
}

function queryForCandidate(candidate: ProductResearchQueryCandidate) {
  const marketplaceFamily = productResearchMarketplaceFamilyQuery(candidate.productName)
  if (marketplaceFamily) return marketplaceFamily
  const brandTokens = normalizedTokens(candidate.brand)
  const nameTokens = normalizedTokens(candidate.productName)
    .filter((token) => !brandTokens.includes(token))
  const selected = [...brandTokens.slice(0, 2), ...nameTokens.slice(0, 4)]
  return [...new Set(selected)].join(" ").slice(0, 100).trim()
}

export function buildProductResearchQueryPlan(
  candidates: ProductResearchQueryCandidate[],
): { inputHash: string; candidateCount: number; queries: ProductResearchPlannedQuery[] } {
  const unique = [...new Map(candidates.filter((candidate) =>
    text(candidate.supplierVariantId) && text(candidate.productName))
    .map((candidate) => [candidate.supplierVariantId, candidate] as const)).values()]
  const groups = new Map<string, {
    query: string
    categoryId: string | null
    candidates: ProductResearchQueryCandidate[]
    score: number
  }>()
  for (const candidate of unique) {
    const query = queryForCandidate(candidate)
    if (query.length < 3) continue
    const categoryId = /^\d+$/.test(text(candidate.categoryId, 30))
      ? text(candidate.categoryId, 30) : null
    const clusterKey = `${categoryId ?? "uncategorized"}:${query}`
    const group = groups.get(clusterKey) ?? { query, categoryId, candidates: [], score: 0 }
    group.candidates.push(candidate)
    group.score = Math.max(group.score, Number(candidate.priorityScore ?? 0))
    groups.set(clusterKey, group)
  }
  const selected = [...groups.entries()].sort(([, left], [, right]) =>
    right.score - left.score || right.candidates.length - left.candidates.length ||
    left.query.localeCompare(right.query)).slice(0, 15)
  const queries = selected.map(([clusterKey, group], index): ProductResearchPlannedQuery => ({
    ordinal: index + 1,
    searchQuery: group.query,
    queryHash: queryHash(group.query),
    clusterKeyHash: sha256(clusterKey),
    categoryId: group.categoryId,
    candidateCount: group.candidates.length,
    candidateVariantHashes: group.candidates.map((candidate) =>
      sha256(text(candidate.supplierVariantId))).sort(),
  }))
  const coveredCandidateCount = new Set(selected.flatMap(([, group]) =>
    group.candidates.map((candidate) => text(candidate.supplierVariantId)))).size
  return {
    inputHash: sha256({ version: PRODUCT_RESEARCH_QUERY_PLAN_VERSION,
      candidates: unique.map((candidate) => ({
        supplierVariantId: text(candidate.supplierVariantId),
        productName: text(candidate.productName),
        brand: text(candidate.brand) || null,
        categoryId: text(candidate.categoryId) || null,
        priorityScore: Number(candidate.priorityScore ?? 0),
      })).sort((left, right) => left.supplierVariantId.localeCompare(right.supplierVariantId)) }),
    candidateCount: coveredCandidateCount,
    queries,
  }
}

async function candidateRows(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
}) {
  const { data: targets, error: targetError } = await input.supabase
    .from("marketplace_listing_approval_queue_scan_targets")
    .select("market_radar_product_id,supplier_variant_id,discovery_score,discovery_snapshot")
    .eq("run_id", input.runId).eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").eq("preselected", true)
    .order("discovery_score", { ascending: false }).limit(100)
  if (targetError) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_TARGETS_READ_FAILED")
  const productIds = [...new Set((targets ?? []).map((target) => text(target.market_radar_product_id))
    .filter(Boolean))]
  const { data: variants, error: variantError } = productIds.length
    ? await input.supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_variant_id,title,metadata")
      .eq("source_key", "lunaportex").in("product_id", productIds)
    : { data: [], error: null }
  if (variantError) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_VARIANTS_READ_FAILED")
  const variantByKey = new Map((variants ?? []).map((variant) => [
    `${variant.product_id}:${variant.supplier_variant_id}`, variant,
  ]))
  return (targets ?? []).flatMap((target): ProductResearchQueryCandidate[] => {
    const variant = variantByKey.get(
      `${target.market_radar_product_id}:${target.supplier_variant_id}`,
    )
    if (!variant) return []
    const metadata = record(variant.metadata)
    const discovery = record(target.discovery_snapshot)
    return [{
      supplierVariantId: text(variant.supplier_variant_id),
      productName: text(variant.title),
      brand: explicitBrand(metadata),
      categoryId: text(discovery.categoryId) || text(metadata.categoryId) || null,
      priorityScore: Number(target.discovery_score ?? 0),
    }]
  })
}

export async function prepareProductResearchQueryPlan(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
}) {
  const candidates = await candidateRows(input)
  const plan = buildProductResearchQueryPlan(candidates)
  if (!plan.queries.length) return null
  const planId = randomUUID()
  const { data, error } = await input.supabase.rpc("create_product_research_query_plan_v1", {
    p_plan_id: planId,
    p_marketplace_account_key: input.accountKey,
    p_run_id: input.runId,
    p_plan_version: PRODUCT_RESEARCH_QUERY_PLAN_VERSION,
    p_input_hash: plan.inputHash,
    p_candidate_count: plan.candidateCount,
    p_queries: plan.queries.map((query) => ({
      ordinal: query.ordinal,
      search_query: query.searchQuery,
      query_hash: query.queryHash,
      cluster_key_hash: query.clusterKeyHash,
      category_id: query.categoryId,
      candidate_count: query.candidateCount,
      candidate_variant_hashes: query.candidateVariantHashes,
    })),
  })
  if (error || !data) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_PERSIST_FAILED")
  return getProductResearchQueryPlanStatus({ ...input, planId: String(data) })
}

export async function getProductResearchQueryPlanStatus(input: {
  supabase: SupabaseClient
  accountKey: string
  runId?: string | null
  planId?: string | null
  preferredSearchQuery?: unknown
}) {
  let query = input.supabase.from("marketplace_product_research_query_plans")
    .select("id,run_id,plan_version,status,query_count,candidate_count,created_at,completed_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
  if (input.planId) query = query.eq("id", input.planId)
  else if (input.runId) query = query.eq("run_id", input.runId)
  const { data: plan, error } = await query.order("created_at", { ascending: false })
    .limit(1).maybeSingle()
  if (error) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_STATUS_READ_FAILED")
  if (!plan) return null
  const { data: tasks, error: taskError } = await input.supabase
    .from("marketplace_product_research_query_tasks")
    .select("id,ordinal,search_query,query_hash,category_id,candidate_count,status,captured_at,processed_at")
    .eq("plan_id", plan.id).eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").order("ordinal", { ascending: true })
  if (taskError) throw new Error("PRODUCT_RESEARCH_QUERY_TASK_STATUS_READ_FAILED")
  const preferredQueryHash = text(input.preferredSearchQuery, 100)
    ? productResearchPlannedQueryHash(input.preferredSearchQuery)
    : null
  // The visible Same-Day human gate is the authority. Recovery can leave a
  // lower-ordinal historical task pending in the same durable plan; it must
  // never replace the exact product currently shown to the operator.
  const pending = preferredQueryHash
    ? (tasks ?? []).find((task) =>
      task.status === "PENDING" && task.query_hash === preferredQueryHash) ?? null
    : (tasks ?? []).find((task) => task.status === "PENDING") ?? null
  const taskCounts = summarizeProductResearchQueryTaskStatuses(
    (tasks ?? []).map((task) => task.status),
  )
  return {
    id: plan.id,
    runId: plan.run_id,
    version: plan.plan_version,
    status: plan.status,
    queryCount: plan.query_count,
    candidateCount: plan.candidate_count,
    capturedCount: taskCounts.capturedCount,
    skippedCount: taskCounts.skippedCount,
    settledCount: taskCounts.settledCount,
    pendingCount: Math.max(0, plan.query_count - taskCounts.settledCount),
    nextQuery: pending ? {
      ordinal: pending.ordinal,
      searchQuery: productResearchDisplayQuery(pending.search_query),
      categoryId: pending.category_id,
      candidateCount: pending.candidate_count,
    } : null,
    tasks: tasks ?? [],
    createdAt: plan.created_at,
    completedAt: plan.completed_at,
    rawCompetitorContentStored: false,
    openAiCalls: 0,
    ebayWrites: 0,
  }
}

async function completeProductResearchQueryPlanWhenSettled(input: {
  supabase: SupabaseClient
  accountKey: string
  planId: string
  now: string
}) {
  const status = await getProductResearchQueryPlanStatus({
    supabase: input.supabase,
    accountKey: input.accountKey,
    planId: input.planId,
  })
  if (!status || status.pendingCount !== 0 || status.status !== "ACTIVE") return status
  const { data, error } = await input.supabase
    .from("marketplace_product_research_query_plans")
    .update({ status: "COMPLETED", completed_at: input.now, updated_at: input.now })
    .eq("id", input.planId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("status", "ACTIVE")
    .select("id")
  if (error || (data ?? []).length !== 1) {
    throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_COMPLETE_FAILED")
  }
  return { ...status, status: "COMPLETED", completedAt: input.now }
}

export async function skipProductResearchQuery(input: {
  supabase: SupabaseClient
  accountKey: string
  planId: string
  searchQuery: unknown
  reasonCode: string
  now?: Date
}) {
  const reasonCode = text(input.reasonCode, 80).toUpperCase()
  if (!/^[A-Z0-9_]+$/.test(reasonCode)) {
    throw new Error("PRODUCT_RESEARCH_QUERY_SKIP_REASON_INVALID")
  }
  const { data: tasks, error: readError } = await input.supabase
    .from("marketplace_product_research_query_tasks")
    .select("id,search_query,status")
    .eq("plan_id", input.planId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .in("status", ["PENDING", "SKIPPED", "CAPTURED", "PROCESSED"])
    .order("ordinal", { ascending: true })
  if (readError) throw new Error("PRODUCT_RESEARCH_QUERY_TASK_STATUS_READ_FAILED")
  const task = (tasks ?? []).find((entry) =>
    productResearchQueriesMatch(input.searchQuery, entry.search_query))
  if (!task) throw new Error("PRODUCT_RESEARCH_QUERY_SKIP_TASK_MISSING")
  if (task.status !== "PENDING") {
    return completeProductResearchQueryPlanWhenSettled({
      supabase: input.supabase,
      accountKey: input.accountKey,
      planId: input.planId,
      now: (input.now ?? new Date()).toISOString(),
    })
  }
  const now = (input.now ?? new Date()).toISOString()
  const { data: updated, error: updateError } = await input.supabase
    .from("marketplace_product_research_query_tasks")
    .update({ status: "SKIPPED", processed_at: now,
      last_error_code: reasonCode, updated_at: now })
    .eq("id", task.id)
    .eq("plan_id", input.planId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("status", "PENDING")
    .select("id")
  if (updateError || (updated ?? []).length !== 1) {
    throw new Error("PRODUCT_RESEARCH_QUERY_TASK_SKIP_FAILED")
  }
  return completeProductResearchQueryPlanWhenSettled({
    supabase: input.supabase,
    accountKey: input.accountKey,
    planId: input.planId,
    now,
  })
}

export async function assertProductResearchCaptureMatchesNextQuery(input: {
  supabase: SupabaseClient
  accountKey: string
  searchQuery: unknown
  planId?: string | null
  requiredSearchQuery?: unknown
}) {
  const requiredQueryHash = text(input.requiredSearchQuery, 100)
    ? productResearchPlannedQueryHash(input.requiredSearchQuery)
    : null
  const processedReplayForPlan = async (plan: { id: string; run_id: string | null }) => {
    const { data: processedTasks, error: processedError } = await input.supabase
      .from("marketplace_product_research_query_tasks")
      .select("id,ordinal,search_query,query_hash,category_id,capture_batch_id,captured_at")
      .eq("plan_id", plan.id).eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").eq("status", "PROCESSED")
      .not("capture_batch_id", "is", null).order("ordinal", { ascending: false })
    if (processedError) throw new Error("PRODUCT_RESEARCH_QUERY_TASK_STATUS_READ_FAILED")
    const replay = requiredQueryHash
      ? (processedTasks ?? []).find((processed) =>
        processed.query_hash === requiredQueryHash)
      : (processedTasks ?? []).find((processed) =>
        productResearchQueriesMatch(input.searchQuery, processed.search_query))
    if (!replay?.capture_batch_id) return null
    return {
      planId: plan.id,
      taskId: replay.id,
      runId: plan.run_id,
      ordinal: replay.ordinal,
      categoryId: replay.category_id ?? null,
      queryHash: replay.query_hash,
      searchQuery: replay.search_query,
      alreadyProcessed: true as const,
      captureBatchId: replay.capture_batch_id,
      capturedAt: replay.captured_at ?? null,
    }
  }
  let plan: { id: string; run_id: string | null } | null = null
  if (input.planId) {
    const { data: scopedPlan, error: scopedPlanError } = await input.supabase
      .from("marketplace_product_research_query_plans").select("id,run_id,status")
      .eq("id", input.planId)
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .limit(1).maybeSingle()
    if (scopedPlanError) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_STATUS_READ_FAILED")
    if (!scopedPlan) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_SCOPE_MISSING")
    if (scopedPlan.status === "COMPLETED") {
      const replay = await processedReplayForPlan(scopedPlan)
      if (replay) return replay
      throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_NO_PENDING_TASK")
    }
    if (scopedPlan.status !== "ACTIVE") {
      throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_SCOPE_NOT_ACTIVE")
    }
    plan = scopedPlan
  } else {
    const { data: activePlan, error: planError } = await input.supabase
      .from("marketplace_product_research_query_plans").select("id,run_id")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .eq("status", "ACTIVE").order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (planError) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_STATUS_READ_FAILED")
    plan = activePlan
  }
  if (!plan) {
    // Once the final query is processed the plan becomes COMPLETED. A stale
    // tab from that just-finished plan must still receive safe navigation
    // recovery instead of falling through to a second commercial import.
    const replayWindowStart = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
    const { data: completedPlan, error: completedError } = await input.supabase
      .from("marketplace_product_research_query_plans").select("id,run_id")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .eq("status", "COMPLETED").gte("completed_at", replayWindowStart)
      .order("completed_at", { ascending: false }).limit(1).maybeSingle()
    if (completedError) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_STATUS_READ_FAILED")
    if (!completedPlan) return null
    return await processedReplayForPlan(completedPlan)
  }
  const { data: pendingTasks, error: taskError } = await input.supabase
    .from("marketplace_product_research_query_tasks")
    .select("id,ordinal,search_query,query_hash,category_id")
    .eq("plan_id", plan.id).eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").eq("status", "PENDING")
    .order("ordinal", { ascending: true })
  if (taskError) throw new Error("PRODUCT_RESEARCH_QUERY_TASK_STATUS_READ_FAILED")
  const task = requiredQueryHash
    ? (pendingTasks ?? []).find((entry) =>
      entry.query_hash === requiredQueryHash) ?? null
    : pendingTasks?.[0] ?? null
  if (!task) {
    const replay = await processedReplayForPlan(plan)
    if (replay) return replay
    throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_NO_PENDING_TASK")
  }
  if (!productResearchQueriesMatch(input.searchQuery, task.search_query)) {
    // A browser tab can remain on the table that was just accepted while the
    // durable plan has already advanced. Treat only an exact canonical match
    // to a PROCESSED task in this same active plan as navigation recovery. It
    // never imports again or advances the pending task; the receiver simply
    // returns the real next query to the extension.
    const replay = await processedReplayForPlan(plan)
    if (replay) return replay
    throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_NEXT_QUERY_REQUIRED")
  }
  return {
    planId: plan.id,
    taskId: task.id,
    runId: plan.run_id,
    ordinal: task.ordinal,
    categoryId: task.category_id ?? null,
    queryHash: task.query_hash,
    searchQuery: task.search_query,
    alreadyProcessed: false as const,
    captureBatchId: null,
    capturedAt: null,
  }
}

export async function markProductResearchQueryCaptured(input: {
  supabase: SupabaseClient
  accountKey: string
  searchQueryHash: string
  captureBatchId: string
  planId?: string | null
  taskId?: string | null
  capturedAt?: Date
  now?: Date
}) {
  const now = (input.now ?? new Date()).toISOString()
  const capturedAt = (input.capturedAt ?? input.now ?? new Date()).toISOString()
  let planId = input.planId ?? null
  if (!planId) {
    const { data: plan, error: planError } = await input.supabase
      .from("marketplace_product_research_query_plans").select("id")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .eq("status", "ACTIVE").order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (planError) throw new Error("PRODUCT_RESEARCH_QUERY_PLAN_STATUS_READ_FAILED")
    if (!plan) return null
    planId = plan.id
  }
  if (!planId) return null
  const settledPlanId = planId
  const patch = { status: "PROCESSED", capture_batch_id: input.captureBatchId,
    captured_at: capturedAt, processed_at: now, last_error_code: null, updated_at: now }
  if (input.taskId) {
    const { data: updated, error: updateError } = await input.supabase
      .from("marketplace_product_research_query_tasks").update(patch)
      .eq("id", input.taskId).eq("plan_id", settledPlanId)
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .eq("query_hash", input.searchQueryHash).eq("status", "PENDING").select("id")
    if (updateError || (updated ?? []).length !== 1) {
      throw new Error("PRODUCT_RESEARCH_QUERY_TASK_UPDATE_FAILED")
    }
  } else {
    const { error: updateError } = await input.supabase
      .from("marketplace_product_research_query_tasks").update(patch)
      .eq("plan_id", settledPlanId).eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").eq("query_hash", input.searchQueryHash)
      .eq("status", "PENDING")
    if (updateError) throw new Error("PRODUCT_RESEARCH_QUERY_TASK_UPDATE_FAILED")
  }
  return completeProductResearchQueryPlanWhenSettled({
    supabase: input.supabase, accountKey: input.accountKey,
    planId: settledPlanId, now,
  })
}
