import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  deriveProductResearchReformulationDecisionV1,
  extractProductResearchEntityV1,
  PRODUCT_RESEARCH_MAX_REFORMULATION_ATTEMPTS,
  PRODUCT_RESEARCH_QUERY_INTELLIGENCE_V1,
  type ProductResearchReformulationEvidenceEntityV1,
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
} from "./ebay-product-research-query-intelligence-v1.ts"
import {
  productResearchPlannedQueryHash,
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
} from "./ebay-product-research-query-plan.ts"

export const PRODUCT_RESEARCH_ADAPTIVE_REFORMULATION_V1 =
  "PRODUCT_RESEARCH_ADAPTIVE_REFORMULATION_V1_2026_09_07" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`
}

export async function ensureProductResearchAdaptiveReformulationV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  planId: string
  productName: string
  brand?: string | null
  sourceField?: string
  sourceAuthority?: string
  parentTaskId?: string | null
  observedAt?: string
}>) {
  const planRead = await input.supabase.from(
    "marketplace_product_research_query_plans")
    .select("id,status,intelligence_contract_version,reformulation_attempt_count,max_reformulation_attempts,terminal_research_conclusion")
    .eq("id", input.planId).eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("source_context", "QUICK_PICK_RESEARCH_REQUIRED")
    .limit(1).maybeSingle()
  if (planRead.error || !planRead.data) {
    throw new Error("PRODUCT_RESEARCH_REFORMULATION_PLAN_READ_FAILED")
  }
  const strategyVersion = text(planRead.data.intelligence_contract_version, 160)
    || PRODUCT_RESEARCH_QUERY_INTELLIGENCE_V1
  const taskRead = await input.supabase.from(
    "marketplace_product_research_query_tasks")
    .select("id,ordinal,search_query,query_hash,query_intent,evidence_basis,strategy_version,status,quality_status,quality_metrics,commercial_evidence_entities,category_id,candidate_count,candidate_variant_hashes,reformulation_parent_task_id,reformulation_decision_id,reformulation_ordinal")
    .eq("plan_id", input.planId).eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").eq("strategy_version", strategyVersion)
    .order("ordinal", { ascending: true })
  if (taskRead.error) {
    throw new Error("PRODUCT_RESEARCH_REFORMULATION_TASK_READ_FAILED")
  }
  const tasks = rows(taskRead.data)
  const pending = tasks.find((task) => task.status === "PENDING")
  if (pending) return Object.freeze({ status: "PENDING_TASK_EXISTS" as const,
    planId: input.planId, taskId: text(pending.id, 40),
    decisionId: text(pending.reformulation_decision_id, 40) || null,
    query: text(pending.search_query, 100), taskCreated: false,
    terminalConclusion: null, marketplaceWrites: 0 as const })

  const requestedParentId = text(input.parentTaskId, 40)
  const parent = requestedParentId
    ? tasks.find((task) => task.id === requestedParentId) ?? null
    : [...tasks].reverse().find((task) =>
      task.quality_status === "LOW_PRECISION_REFORMULATION_REQUIRED") ?? null
  if (!parent || parent.quality_status !==
      "LOW_PRECISION_REFORMULATION_REQUIRED") {
    return Object.freeze({ status: "NO_REFORMULATION_REQUIRED" as const,
      planId: input.planId, taskId: null, decisionId: null, query: null,
      taskCreated: false, terminalConclusion:
        text(planRead.data.terminal_research_conclusion, 100) || null,
      marketplaceWrites: 0 as const })
  }
  const existingChild = tasks.find((task) =>
    task.reformulation_parent_task_id === parent.id)
  if (existingChild) {
    return Object.freeze({ status: "REFORMULATION_REUSED" as const,
      planId: input.planId, taskId: text(existingChild.id, 40),
      decisionId: text(existingChild.reformulation_decision_id, 40) || null,
      query: text(existingChild.search_query, 100), taskCreated: false,
      terminalConclusion: null, marketplaceWrites: 0 as const })
  }

  const entity = extractProductResearchEntityV1({
    productName: input.productName,
    brand: input.brand,
    sourceField: input.sourceField ?? "product_title",
    sourceAuthority: input.sourceAuthority ?? "LUNA_PRODUCT_TRUTH",
  })
  const commercialEvidence = rows(parent.commercial_evidence_entities) as
    ProductResearchReformulationEvidenceEntityV1[]
  const decision = deriveProductResearchReformulationDecisionV1({
    entity,
    parentTaskId: text(parent.id, 40),
    parentQuery: text(parent.search_query, 100),
    qualityStatus: text(parent.quality_status, 80),
    qualityMetrics: record(parent.quality_metrics),
    commercialEvidence,
    priorQueries: tasks.map((task) => text(task.search_query, 100)),
    reformulationAttemptCount: Number(
      planRead.data.reformulation_attempt_count ?? 0),
    maxReformulationAttempts: Number(
      planRead.data.max_reformulation_attempts ??
        PRODUCT_RESEARCH_MAX_REFORMULATION_ATTEMPTS),
  })
  if (!decision) {
    return Object.freeze({ status: "NO_REFORMULATION_REQUIRED" as const,
      planId: input.planId, taskId: null, decisionId: null, query: null,
      taskCreated: false, terminalConclusion: null,
      marketplaceWrites: 0 as const })
  }
  const observedAt = input.observedAt ?? new Date().toISOString()
  const decisionId = randomUUID()
  const queryHash = decision.query
    ? productResearchPlannedQueryHash(decision.query) : null
  const write = await input.supabase.rpc(
    "persist_product_research_adaptive_decision_v1", {
      p_marketplace_account_key: input.accountKey,
      p_plan_id: input.planId,
      p_parent_task_id: parent.id,
      p_decision_id: decisionId,
      p_decision: {
        contractVersion: PRODUCT_RESEARCH_ADAPTIVE_REFORMULATION_V1,
        outcome: decision.outcome,
        whyPreviousQueryFailed: decision.whyPreviousQueryFailed,
        addedSignals: decision.addedSignals,
        removedSignals: decision.removedSignals,
        evidenceBasis: decision.evidenceBasis,
        parentTaskId: decision.parentTaskId,
        reformulationOrdinal: decision.reformulationOrdinal,
        queryIntent: decision.intent,
        reformulationQuery: decision.query,
        terminalConclusion: decision.terminalConclusion,
        observedAt,
        marketplaceWrites: 0,
      },
      p_reformulation_ordinal: decision.reformulationOrdinal,
      p_query_intent: decision.intent,
      p_search_query: decision.query,
      p_query_hash: queryHash,
      p_cluster_key_hash: decision.query && decision.intent
        ? sha256(`adaptive:${input.planId}:${decision.intent}:${decision.query}`)
        : null,
      p_category_id: parent.category_id ?? null,
      p_candidate_count: Number(parent.candidate_count ?? 1),
      p_candidate_variant_hashes: Array.isArray(parent.candidate_variant_hashes)
        ? parent.candidate_variant_hashes : [],
      p_evidence_basis: decision.evidenceBasis,
      p_strategy_version: strategyVersion,
      p_terminal_conclusion: decision.terminalConclusion,
      p_observed_at: observedAt,
    })
  if (write.error || !write.data) {
    throw new Error("PRODUCT_RESEARCH_REFORMULATION_PERSIST_FAILED")
  }
  const persisted = record(write.data)
  return Object.freeze({ status: text(persisted.state, 80) ||
      (decision.query ? "REFORMULATION_TASK_CREATED" : "TERMINAL_UNPROVEN"),
    planId: input.planId,
    taskId: text(persisted.taskId, 40) || null,
    decisionId: text(persisted.decisionId, 40) || decisionId,
    query: text(persisted.searchQuery, 100) || decision.query,
    intent: text(persisted.queryIntent, 80) || decision.intent,
    taskCreated: persisted.taskCreated === true,
    reformulationOrdinal: decision.reformulationOrdinal,
    terminalConclusion: text(persisted.terminalConclusion, 100) ||
      decision.terminalConclusion,
    marketplaceWrites: 0 as const })
}
