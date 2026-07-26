import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildEffectIdempotencyKey,
  classifyFactoryError,
  errorFingerprint,
  FACTORY_MAIN_STATES,
  mapLegacyMachineState,
  sha256Hex,
  type FactoryFault,
  type FactoryPolicy,
  type FactoryState,
  SAFE_FACTORY_POLICY,
  sanitizedErrorMessage,
} from "./ebay-resilient-listing-factory-domain"

export type FactoryClaim = {
  runId: string
  candidateId: string
  marketplaceAccountKey: string
  marketplace: string
  productId: string
  sku: string
  generation: number
  dossierVersion: number
  dossierHash: string
  payloadHash: string | null
  state: FactoryState
  checkpoint: Record<string, unknown>
  leaseToken: string
}

export type FactoryPhaseResult = {
  checkpoint: Record<string, unknown>
  dossierVersion: number
  dossierHash: string
  payloadHash?: string | null
  preparedEffect?: {
    action: "PUT_INVENTORY_ITEM" | "CREATE_OFFER" | "PUBLISH_OFFER" |
      "VERIFY_POST_PUBLISH"
    safePayloadSummary: Record<string, unknown>
  }
}

export interface ListingFactoryRepository {
  claimNext(runId: string, worker: string): Promise<FactoryClaim | null>
  heartbeat(claim: FactoryClaim, worker: string): Promise<void>
  release(claim: FactoryClaim, worker: string): Promise<void>
  transition(input: {
    claim: FactoryClaim
    expectedState: FactoryState
    nextState: FactoryState
    reasonCode: string
    checkpoint: Record<string, unknown>
    dossierVersion: number
    dossierHash: string
    payloadHash?: string | null
    idempotencyKey: string
    worker: string
  }): Promise<void>
  quarantine(input: {
    claim: FactoryClaim
    worker: string
    fault: FactoryFault
    fingerprint: string
    sanitizedMessage: string
    checkpointState: FactoryState
    checkpoint: Record<string, unknown>
  }): Promise<void>
  openCircuit(input: {
    claim: FactoryClaim
    dependency: string
    fault: FactoryFault
    sanitizedMessage: string
  }): Promise<void>
  prepareEffect(input: {
    claim: FactoryClaim
    action: FactoryPhaseResult["preparedEffect"] extends infer T
      ? T extends { action: infer A } ? A : never
      : never
    safePayloadSummary: Record<string, unknown>
    idempotencyKey: string
    externalWriteAuthorized: false
  }): Promise<void>
  recomputeRun(runId: string): Promise<void>
}

export type FactoryPhaseHandler = (
  claim: FactoryClaim,
  state: FactoryState,
) => Promise<FactoryPhaseResult>

export class ResilientListingFactoryController {
  private readonly repository: ListingFactoryRepository
  private readonly phaseHandler: FactoryPhaseHandler
  private readonly policy: FactoryPolicy

  constructor(
    repository: ListingFactoryRepository,
    phaseHandler: FactoryPhaseHandler,
    policy: FactoryPolicy = SAFE_FACTORY_POLICY,
  ) {
    this.repository = repository
    this.phaseHandler = phaseHandler
    this.policy = policy
  }

  async runCycle(runId: string, worker: string): Promise<{
    claimed: number
    completed: number
    quarantined: number
    globallyPaused: number
    externalWrites: 0
  }> {
    const claims: FactoryClaim[] = []
    for (let slot = 0; slot < this.policy.maxConcurrentProducts; slot += 1) {
      const claim = await this.repository.claimNext(runId, worker)
      if (!claim) break
      claims.push(claim)
    }

    const results = await Promise.allSettled(
      claims.map((claim) => this.processClaim(claim, worker)),
    )
    await this.repository.recomputeRun(runId)

    return {
      claimed: claims.length,
      completed: results.filter((result) =>
        result.status === "fulfilled" && result.value === "COMPLETED").length,
      quarantined: results.filter((result) =>
        result.status === "fulfilled" && result.value === "QUARANTINED").length,
      globallyPaused: results.filter((result) =>
        result.status === "fulfilled" && result.value === "GLOBAL_PAUSE").length,
      externalWrites: 0,
    }
  }

  private async processClaim(
    initialClaim: FactoryClaim,
    worker: string,
  ): Promise<"COMPLETED" | "QUARANTINED" | "GLOBAL_PAUSE" | "HELD"> {
    let claim = { ...initialClaim }
    const currentIndex = FACTORY_MAIN_STATES.indexOf(
      claim.state as (typeof FACTORY_MAIN_STATES)[number],
    )
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0
    const dryRunTarget = FACTORY_MAIN_STATES.indexOf("DRAFT_READY")

    try {
      for (let index = startIndex; index <= dryRunTarget; index += 1) {
        const nextState = FACTORY_MAIN_STATES[index]
        if (!nextState) break
        await this.repository.heartbeat(claim, worker)
        const result = await this.phaseHandler(claim, nextState)
        if (result.preparedEffect) {
          const effectKey = buildEffectIdempotencyKey({
            marketplaceAccountKey: claim.marketplaceAccountKey,
            marketplace: claim.marketplace,
            productId: claim.productId,
            sku: claim.sku,
            generation: claim.generation,
            action: result.preparedEffect.action,
            dossierVersion: result.dossierVersion,
            payloadHash: result.payloadHash ?? claim.payloadHash ?? claim.dossierHash,
          })
          await this.repository.prepareEffect({
            claim,
            action: result.preparedEffect.action,
            safePayloadSummary: result.preparedEffect.safePayloadSummary,
            idempotencyKey: effectKey,
            externalWriteAuthorized: false,
          })
        }
        const transitionKey = buildEffectIdempotencyKey({
          marketplaceAccountKey: claim.marketplaceAccountKey,
          marketplace: claim.marketplace,
          productId: claim.productId,
          sku: claim.sku,
          generation: claim.generation,
          action: `TRANSITION_${claim.state}_${nextState}`,
          dossierVersion: result.dossierVersion,
          payloadHash: result.payloadHash ?? claim.payloadHash ?? result.dossierHash,
        })
        await this.repository.transition({
          claim,
          expectedState: claim.state,
          nextState,
          reasonCode: "FACTORY_PHASE_COMPLETED",
          checkpoint: result.checkpoint,
          dossierVersion: result.dossierVersion,
          dossierHash: result.dossierHash,
          payloadHash: result.payloadHash,
          idempotencyKey: transitionKey,
          worker,
        })
        claim = {
          ...claim,
          state: nextState,
          checkpoint: result.checkpoint,
          dossierVersion: result.dossierVersion,
          dossierHash: result.dossierHash,
          payloadHash: result.payloadHash ?? claim.payloadHash,
        }
      }
      return "COMPLETED"
    } catch (error) {
      const fault: FactoryFault = error && typeof error === "object" &&
        "factoryFault" in error
        ? (error as { factoryFault: FactoryFault }).factoryFault
        : {
          code: error instanceof Error ? error.message : "UNKNOWN_FACTORY_ERROR",
          dependency: "UNKNOWN",
          unexpected: true,
        }
      const disposition = classifyFactoryError(fault)
      const safeMessage = sanitizedErrorMessage(error)
      if (disposition.globalDependency) {
        await this.repository.openCircuit({
          claim,
          dependency: fault.dependency ?? "UNKNOWN",
          fault,
          sanitizedMessage: safeMessage,
        })
        return "GLOBAL_PAUSE"
      }
      if (disposition.nextState === "QUARANTINED_UNKNOWN_ERROR") {
        await this.repository.quarantine({
          claim,
          worker,
          fault,
          fingerprint: errorFingerprint(fault),
          sanitizedMessage: safeMessage,
          checkpointState: claim.state,
          checkpoint: claim.checkpoint,
        })
        return "QUARANTINED"
      }
      await this.repository.transition({
        claim,
        expectedState: claim.state,
        nextState: disposition.nextState,
        reasonCode: fault.code,
        checkpoint: claim.checkpoint,
        dossierVersion: claim.dossierVersion,
        dossierHash: claim.dossierHash,
        idempotencyKey: buildEffectIdempotencyKey({
          marketplaceAccountKey: claim.marketplaceAccountKey,
          marketplace: claim.marketplace,
          productId: claim.productId,
          sku: claim.sku,
          generation: claim.generation,
          action: `FAULT_${disposition.nextState}`,
          dossierVersion: claim.dossierVersion,
          payloadHash: claim.payloadHash ?? claim.dossierHash,
        }),
        worker,
      })
      return "HELD"
    } finally {
      await this.repository.release(claim, worker)
    }
  }
}

type ResilientBridgeResult = {
  enabled: boolean
  active: boolean
  status: string
  error?: string
}

function resilientFactoryEnabled(): boolean {
  return process.env.EBAY_RESILIENT_LISTING_FACTORY_ENABLED === "true"
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function bridgeErrorCode(error: unknown): string {
  const value = record(error)
  const code = text(value.code)
  if (["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code)) {
    return "LISTING_FACTORY_MIGRATION_NOT_READY"
  }
  return "LISTING_FACTORY_LEGACY_BRIDGE_FAILED"
}

export function isResilientListingFactoryEnabled(): boolean {
  return resilientFactoryEnabled()
}

export type ResilientLegacyCandidateLease = {
  runId: string
  candidateId: string
  workerId: string
  leaseToken: string
  state: FactoryState
}

export async function claimResilientCandidateForLegacyJob(input: {
  supabase: SupabaseClient
  runId: string
  candidateId: string
  workerId: string
  now: Date
}): Promise<ResilientBridgeResult & {
  lease?: ResilientLegacyCandidateLease
}> {
  if (!resilientFactoryEnabled()) {
    return { enabled: false, active: false, status: "FEATURE_DISABLED" }
  }
  const { data, error } = await input.supabase.rpc(
    "claim_ebay_listing_factory_candidate_by_id_v1",
    {
      p_run_id: input.runId,
      p_candidate_id: input.candidateId,
      p_worker: input.workerId,
      p_now: input.now.toISOString(),
      p_lease_seconds: 360,
    },
  )
  if (error) {
    return {
      enabled: true,
      active: false,
      status: "FACTORY_CLAIM_FAILED",
      error: bridgeErrorCode(error),
    }
  }
  const row = record(Array.isArray(data) ? data[0] : data)
  const leaseToken = text(row.lease_token)
  if (!leaseToken) {
    return {
      enabled: true,
      active: false,
      status: "FACTORY_CLAIM_UNAVAILABLE",
    }
  }
  return {
    enabled: true,
    active: true,
    status: "FACTORY_CLAIMED",
    lease: {
      runId: input.runId,
      candidateId: input.candidateId,
      workerId: input.workerId,
      leaseToken,
      state: text(row.factory_state) as FactoryState,
    },
  }
}

export async function releaseResilientCandidateForLegacyJob(input: {
  supabase: SupabaseClient
  lease: ResilientLegacyCandidateLease
  now?: Date
}): Promise<ResilientBridgeResult> {
  const { data, error } = await input.supabase.rpc(
    "release_ebay_listing_factory_candidate_v1",
    {
      p_candidate_id: input.lease.candidateId,
      p_worker: input.lease.workerId,
      p_lease_token: input.lease.leaseToken,
      p_now: (input.now ?? new Date()).toISOString(),
    },
  )
  if (error) {
    return {
      enabled: true,
      active: false,
      status: "FACTORY_RELEASE_FAILED",
      error: bridgeErrorCode(error),
    }
  }
  return {
    enabled: true,
    active: data === true,
    status: data === true ? "FACTORY_RELEASED" : "FACTORY_LEASE_ALREADY_CONSUMED",
  }
}

export async function quarantineResilientBootstrapFailure(input: {
  supabase: SupabaseClient
  runId: string
  candidateId: string
  workerId: string
  error: unknown
  now: Date
}): Promise<ResilientBridgeResult> {
  const claimed = await claimResilientCandidateForLegacyJob({
    supabase: input.supabase,
    runId: input.runId,
    candidateId: input.candidateId,
    workerId: input.workerId,
    now: input.now,
  })
  if (!claimed.active || !claimed.lease) return claimed
  const code = input.error instanceof Error &&
    /^[A-Z0-9_:-]+$/.test(input.error.message)
    ? input.error.message
    : "LISTING_FACTORY_BOOTSTRAP_UNKNOWN_ERROR"
  const fault: FactoryFault = {
    code,
    dependency: "SUPABASE",
    unexpected: true,
  }
  const fingerprint = errorFingerprint(fault)
  const idempotencyKey = buildEffectIdempotencyKey({
    marketplaceAccountKey: `legacy-run:${input.runId}`,
    marketplace: "EBAY_US",
    productId: input.candidateId,
    sku: input.candidateId,
    generation: 1,
    action: "BOOTSTRAP_QUARANTINE",
    dossierVersion: 0,
    payloadHash: fingerprint,
  })
  try {
    const { error } = await input.supabase.rpc(
      "quarantine_ebay_listing_factory_candidate_v1",
      {
        p_candidate_id: input.candidateId,
        p_worker: claimed.lease.workerId,
        p_lease_token: claimed.lease.leaseToken,
        p_error_code: code,
        p_error_category: "UNKNOWN_PRODUCT",
        p_error_fingerprint: fingerprint,
        p_sanitized_message: sanitizedErrorMessage(input.error),
        p_dependency: "SUPABASE",
        p_checkpoint_state: claimed.lease.state,
        p_checkpoint: {},
        p_impact: "El bootstrap de un producto fallo; los otros slots continúan.",
        p_suggested_action: "Revisar el fingerprint y reanudar desde el checkpoint.",
        p_resume_requirements: [
          "Verificar evidencia vigente",
          "Confirmar que no existe un efecto externo confirmado",
        ],
        p_replay_safe: true,
        p_correlation_id: randomUUID(),
        p_idempotency_key: idempotencyKey,
      },
    )
    if (error) {
      return {
        enabled: true,
        active: false,
        status: "BOOTSTRAP_QUARANTINE_FAILED",
        error: bridgeErrorCode(error),
      }
    }
    return {
      enabled: true,
      active: true,
      status: "QUARANTINED_UNKNOWN_ERROR",
    }
  } finally {
    await releaseResilientCandidateForLegacyJob({
      supabase: input.supabase,
      lease: claimed.lease,
      now: input.now,
    })
  }
}

export async function registerResilientBatch5Run(input: {
  supabase: SupabaseClient
  runId: string
  candidateCount: number
  actorId: string
}): Promise<ResilientBridgeResult & { activeCandidateIds?: string[] }> {
  if (!resilientFactoryEnabled()) {
    return { enabled: false, active: false, status: "FEATURE_DISABLED" }
  }
  const { error } = await input.supabase.rpc(
    "initialize_ebay_listing_factory_run_v1",
    {
      p_run_id: input.runId,
      p_actor: input.actorId,
      p_correlation_id: randomUUID(),
    },
  )
  if (error) {
    return {
      enabled: true,
      active: false,
      status: "BRIDGE_UNAVAILABLE",
      error: bridgeErrorCode(error),
    }
  }
  const { data: activeRows, error: activeError } = await input.supabase
    .from("ebay_same_day_pilot_candidates")
    .select("id")
    .eq("run_id", input.runId)
    .eq("active_slot", true)
  if (activeError) {
    return {
      enabled: true,
      active: false,
      status: "ACTIVE_SLOT_READ_FAILED",
      error: bridgeErrorCode(activeError),
    }
  }
  return {
    enabled: true,
    active: true,
    status: "BATCH5_REGISTERED",
    activeCandidateIds: (activeRows ?? [])
      .map((row) => text(record(row).id))
      .filter(Boolean),
  }
}

async function loadFactoryCandidate(
  supabase: SupabaseClient,
  candidateId: string,
) {
  const { data, error } = await supabase
    .from("ebay_same_day_pilot_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle()
  return { candidate: data ? record(data) : null, error }
}

function hasRecordContent(value: unknown): boolean {
  return Object.keys(record(value)).length > 0
}

function validObservedAt(value: unknown, fallback: Date): string {
  const parsed = new Date(text(value))
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : fallback.toISOString()
}

async function appendLegacyDossierSnapshot(input: {
  supabase: SupabaseClient
  candidate: Record<string, unknown>
  checkpoint: Record<string, unknown>
  targetState: FactoryState
  actorId: string
}): Promise<{
  active: boolean
  version: number
  dossierHash: string
  frozenPayloadHash: string | null
  error?: string
}> {
  const capturedAt = new Date()
  const observedAt = validObservedAt(
    input.candidate.supplier_observed_at ??
      input.candidate.updated_at,
    capturedAt,
  )
  const identity = {
    productId: text(input.candidate.id),
    marketRadarProductId: input.candidate.opportunity_id ?? null,
    queueItemId: input.candidate.queue_item_id ?? null,
    reservedSku: input.candidate.reserved_sku ?? null,
    supplierSku: input.candidate.supplier_sku ?? null,
    productTitle: input.candidate.product_title ?? null,
    variant: input.candidate.variant_title ?? null,
    brand: input.candidate.brand ?? null,
    mpn: input.candidate.mpn ?? null,
    packCount: input.candidate.native_pack_count ?? null,
    exactMatch: input.candidate.exact_identity_confirmed === true,
    confidence: input.candidate.identity_confidence ?? null,
    method: input.candidate.identity_verification_method ?? "UNKNOWN",
    missing: [
      !input.candidate.supplier_sku ? "supplierSku" : null,
      !input.candidate.product_title ? "productTitle" : null,
      input.candidate.exact_identity_confirmed !== true
        ? "exactIdentityConfirmation"
        : null,
    ].filter(Boolean),
  }
  const supplier = {
    source: input.candidate.supplier_observed_at
      ? "LUNA_AUTHORIZED_SNAPSHOT"
      : "UNKNOWN",
    costUsd: input.candidate.supplier_price ?? null,
    stock: input.candidate.supplier_quantity ?? null,
    available: input.candidate.supplier_available ?? null,
    observedAt,
    productFacts: record(input.candidate.product_facts_summary),
    compliance: record(input.candidate.compliance_summary),
    missing: [
      input.candidate.supplier_price == null ? "cost" : null,
      input.candidate.supplier_quantity == null ? "stock" : null,
      input.candidate.supplier_available == null ? "availability" : null,
    ].filter(Boolean),
  }
  const ebayMarket = {
    source: input.candidate.product_research_capture_batch_id
      ? "EBAY_PRODUCT_RESEARCH_AUTHORIZED_CAPTURE"
      : "UNAVAILABLE",
    captureBatchId: input.candidate.product_research_capture_batch_id ?? null,
    evidenceClass: input.candidate.commercial_evidence_mode ??
      "INSUFFICIENT_EVIDENCE",
    activeExactCount: input.candidate.active_exact_count ?? null,
    soldExactCount: input.candidate.sold_exact_count ?? null,
    summary: record(input.candidate.product_research_summary),
    completeness: input.candidate.product_research_capture_batch_id
      ? "COMPLETE"
      : "INCOMPLETE",
  }
  const economics = {
    source: "EBAY_UNIT_ECONOMICS_CANONICAL",
    snapshot: record(
      input.candidate.economics_snapshot ??
        input.candidate.economics_summary,
    ),
    policy: {
      source: "EBAY_LISTING_FACTORY_VERSIONED_POLICY",
      calculationSource: "EBAY_UNIT_ECONOMICS_CANONICAL",
      valuesCopiedIntoService: false,
    },
    completeness: hasRecordContent(
      input.candidate.economics_snapshot ??
        input.candidate.economics_summary,
    ) ? "COMPLETE" : "INCOMPLETE",
  }
  const listingPackage = {
    category: record(input.candidate.taxonomy_summary),
    package: record(input.candidate.manual_handoff_package),
    localPreparation: record(input.candidate.local_preparation_package),
    machineState: input.candidate.machine_state ?? null,
    targetFactoryState: input.targetState,
  }
  const visualPackage = {
    strategy: "VISUAL_STRATEGY_V3",
    package: record(input.candidate.image_package_summary),
    exactSevenRequired: true,
    competitorContentCopied: false,
  }
  const traceability = {
    checkpoint: input.checkpoint,
    fields: [
      {
        field: "identity",
        source: "SAME_DAY_CANDIDATE",
        observedAt,
        evidenceRef: text(input.candidate.id),
      },
      {
        field: "supplier",
        source: supplier.source,
        observedAt,
        evidenceRef: text(input.candidate.supplier_sku) || "UNKNOWN",
      },
      {
        field: "ebayMarket",
        source: ebayMarket.source,
        observedAt,
        evidenceRef: text(input.candidate.product_research_capture_batch_id) ||
          "UNAVAILABLE",
      },
      {
        field: "economics",
        source: economics.source,
        observedAt,
        evidenceRef: text(input.candidate.id),
      },
      {
        field: "visual",
        source: "VISUAL_STRATEGY_V3",
        observedAt,
        evidenceRef: text(record(input.candidate.image_package_summary).controlId) ||
          "INCOMPLETE",
      },
    ],
  }
  const completenessChecks = [
    identity.exactMatch && identity.missing.length === 0,
    supplier.missing.length === 0,
    ebayMarket.completeness === "COMPLETE",
    economics.completeness === "COMPLETE",
    hasRecordContent(input.candidate.manual_handoff_package),
    hasRecordContent(input.candidate.image_package_summary),
  ]
  const completenessScore = Number((
    completenessChecks.filter(Boolean).length / completenessChecks.length * 100
  ).toFixed(2))
  const packageHash = text(
    record(input.candidate.manual_handoff_package).packageHash,
  )
  const frozenPayloadHash = /^[0-9a-f]{64}$/.test(packageHash)
    ? packageHash
    : null
  const dossierPayload = {
    schemaVersion: "EBAY_LISTING_FACTORY_DOSSIER_V1",
    identity,
    supplier,
    ebayMarket,
    economics,
    listingPackage,
    visualPackage,
    traceability,
    completenessScore,
  }
  const dossierHash = sha256Hex(dossierPayload)
  const expiresAt = new Date(
    new Date(observedAt).getTime() + 6 * 60 * 60 * 1000,
  ).toISOString()
  const { data, error } = await input.supabase.rpc(
    "append_ebay_listing_factory_dossier_v1",
    {
      p_candidate_id: text(input.candidate.id),
      p_dossier_hash: dossierHash,
      p_identity: identity,
      p_supplier_and_compliance: supplier,
      p_ebay_market: ebayMarket,
      p_economics: economics,
      p_listing_package: listingPackage,
      p_visual_package: visualPackage,
      p_traceability: traceability,
      p_completeness_score: completenessScore,
      p_frozen_payload_hash: frozenPayloadHash,
      p_evidence_observed_at: observedAt,
      p_evidence_expires_at: expiresAt,
      p_actor: input.actorId,
    },
  )
  if (error) {
    return {
      active: false,
      version: 0,
      dossierHash,
      frozenPayloadHash,
      error: bridgeErrorCode(error),
    }
  }
  const result = record(data)
  return {
    active: true,
    version: Number(result.version ?? 0),
    dossierHash: text(result.dossierHash) || dossierHash,
    frozenPayloadHash,
  }
}

async function syncCandidateToFactoryState(input: {
  supabase: SupabaseClient
  runId: string
  candidateId: string
  targetState: FactoryState
  checkpoint: Record<string, unknown>
  actorId: string
  reasonCode: string
  lease?: ResilientLegacyCandidateLease
}): Promise<ResilientBridgeResult> {
  if (!resilientFactoryEnabled()) {
    return { enabled: false, active: false, status: "FEATURE_DISABLED" }
  }
  const loaded = await loadFactoryCandidate(input.supabase, input.candidateId)
  if (loaded.error || !loaded.candidate) {
    return {
      enabled: true,
      active: false,
      status: "BRIDGE_UNAVAILABLE",
      error: bridgeErrorCode(loaded.error),
    }
  }
  let currentState = text(loaded.candidate.factory_state) as FactoryState
  if (!currentState) {
    return { enabled: true, active: false, status: "FACTORY_NOT_INITIALIZED" }
  }
  const dossier = await appendLegacyDossierSnapshot({
    supabase: input.supabase,
    candidate: loaded.candidate,
    checkpoint: input.checkpoint,
    targetState: input.targetState,
    actorId: input.actorId,
  })
  if (!dossier.active) {
    return {
      enabled: true,
      active: false,
      status: "DOSSIER_APPEND_FAILED",
      error: dossier.error,
    }
  }
  if (currentState === input.targetState) {
    return {
      enabled: true,
      active: true,
      status: "STATE_AND_DOSSIER_ALREADY_SYNCHRONIZED",
    }
  }
  const currentIndex = FACTORY_MAIN_STATES.indexOf(
    currentState as (typeof FACTORY_MAIN_STATES)[number],
  )
  const targetIndex = FACTORY_MAIN_STATES.indexOf(
    input.targetState as (typeof FACTORY_MAIN_STATES)[number],
  )
  if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < currentIndex) {
    return { enabled: true, active: true, status: "MONOTONIC_STATE_PRESERVED" }
  }
  const states = currentIndex >= 0 && targetIndex > currentIndex
    ? FACTORY_MAIN_STATES.slice(currentIndex + 1, targetIndex + 1)
    : [input.targetState]
  const correlationId = randomUUID()
  const dossierVersion = dossier.version
  const dossierHash = dossier.dossierHash

  for (const nextState of states) {
    const idempotencyKey = buildEffectIdempotencyKey({
      marketplaceAccountKey: `legacy-run:${input.runId}`,
      marketplace: "EBAY_US",
      productId: input.candidateId,
      sku: input.candidateId,
      generation: 1,
      action: `LEGACY_SYNC_${currentState}_${nextState}_${input.reasonCode}`,
      dossierVersion,
      payloadHash: dossierHash,
    })
    const { error } = await input.supabase.rpc(
      "transition_ebay_listing_factory_candidate_v1",
      {
        p_candidate_id: input.candidateId,
        p_expected_state: currentState,
        p_next_state: nextState,
        p_cause_code: input.reasonCode,
        p_dossier_version: dossierVersion,
        p_dossier_hash: dossierHash,
        p_checkpoint: input.checkpoint,
        p_actor_kind: "SYSTEM",
        p_actor_id: input.actorId,
        p_correlation_id: correlationId,
        p_idempotency_key: idempotencyKey,
        p_worker: input.lease?.workerId ?? null,
        p_lease_token: input.lease?.leaseToken ?? null,
        p_payload_hash: dossier.frozenPayloadHash,
      },
    )
    if (error) {
      return {
        enabled: true,
        active: false,
        status: "STATE_SYNC_FAILED",
        error: bridgeErrorCode(error),
      }
    }
    currentState = nextState
  }
  return { enabled: true, active: true, status: "STATE_SYNCHRONIZED" }
}

export async function syncResilientCandidateAfterLegacyJob(input: {
  supabase: SupabaseClient
  runId: string
  candidateId: string
  checkpoint: Record<string, unknown>
  actorId: string
  lease?: ResilientLegacyCandidateLease
}): Promise<ResilientBridgeResult> {
  if (!resilientFactoryEnabled()) {
    return { enabled: false, active: false, status: "FEATURE_DISABLED" }
  }
  const loaded = await loadFactoryCandidate(input.supabase, input.candidateId)
  if (loaded.error || !loaded.candidate) {
    return {
      enabled: true,
      active: false,
      status: "BRIDGE_UNAVAILABLE",
      error: bridgeErrorCode(loaded.error),
    }
  }
  return syncCandidateToFactoryState({
    ...input,
    targetState: mapLegacyMachineState(text(loaded.candidate.machine_state)),
    reasonCode: "LEGACY_SAME_DAY_CHECKPOINT_RECONCILED",
  })
}

export async function recomputeResilientRunProjection(input: {
  supabase: SupabaseClient
  runId: string
}): Promise<ResilientBridgeResult> {
  if (!resilientFactoryEnabled()) {
    return { enabled: false, active: false, status: "FEATURE_DISABLED" }
  }
  const { error } = await input.supabase.rpc(
    "recompute_ebay_listing_factory_run_v1",
    { p_run_id: input.runId },
  )
  if (error) {
    return {
      enabled: true,
      active: false,
      status: "PROJECTION_SYNC_FAILED",
      error: bridgeErrorCode(error),
    }
  }
  return { enabled: true, active: true, status: "PROJECTION_SYNCHRONIZED" }
}

export async function handleResilientLegacyJobFailure(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  candidateId: string
  jobId: string
  errorCode: string
  dependency: string
  checkpoint: Record<string, unknown>
  actorId: string
  lease?: ResilientLegacyCandidateLease
}): Promise<{
  enabled: boolean
  handled: boolean
  globalDependency: boolean
  continueBatch: boolean
  status: string
}> {
  if (!resilientFactoryEnabled()) {
    return {
      enabled: false, handled: false, globalDependency: false,
      continueBatch: false, status: "FEATURE_DISABLED",
    }
  }
  const normalizedDependency = /EBAY/i.test(input.dependency) ? "EBAY"
    : /LUNA/i.test(input.dependency) ? "LUNA"
      : /OPENAI/i.test(input.dependency) ? "OPENAI"
        : "UNKNOWN"
  const fault: FactoryFault = {
    code: input.errorCode,
    dependency: normalizedDependency,
    unexpected: true,
  }
  const disposition = classifyFactoryError(fault)
  const fingerprint = errorFingerprint(fault)
  const safeMessage = sanitizedErrorMessage(input.errorCode)

  if (disposition.category === "UNKNOWN_PRODUCT") {
    const { error } = await input.supabase.rpc(
      "quarantine_ebay_listing_factory_legacy_dead_letter_v1",
      {
        p_job_id: input.jobId,
        p_error_fingerprint: fingerprint,
        p_error_category: disposition.category,
        p_dependency: normalizedDependency,
        p_sanitized_message: safeMessage,
        p_correlation_id: randomUUID(),
        p_idempotency_key: buildEffectIdempotencyKey({
          marketplaceAccountKey: `legacy-run:${input.runId}`,
          marketplace: "EBAY_US",
          productId: input.candidateId,
          sku: input.candidateId,
          generation: 1,
          action: `LEGACY_QUARANTINE_${input.jobId}`,
          dossierVersion: 0,
          payloadHash: fingerprint,
        }),
      },
    )
    return {
      enabled: true,
      handled: !error,
      globalDependency: false,
      continueBatch: !error,
      status: error ? bridgeErrorCode(error) : "QUARANTINED_UNKNOWN_ERROR",
    }
  }

  if (disposition.globalDependency) {
    await input.supabase.rpc("open_ebay_listing_factory_circuit_v1", {
      p_marketplace_account_key: input.accountKey,
      p_marketplace: "EBAY_US",
      p_dependency: normalizedDependency,
      p_error_code: input.errorCode,
      p_sanitized_error: safeMessage,
      p_retry_after: null,
    })
    const synchronized = await syncCandidateToFactoryState({
      supabase: input.supabase,
      runId: input.runId,
      candidateId: input.candidateId,
      targetState: "WAITING_EXTERNAL_DEPENDENCY",
      checkpoint: input.checkpoint,
      actorId: input.actorId,
      reasonCode: input.errorCode,
      lease: input.lease,
    })
    return {
      enabled: true,
      handled: synchronized.active,
      globalDependency: true,
      continueBatch: false,
      status: "PAUSED_BY_GLOBAL_DEPENDENCY",
    }
  }

  if (["MISSING_EVIDENCE", "BUSINESS_RULE", "COMPLIANCE_OR_IDENTITY"]
    .includes(disposition.category)) {
    const synchronized = await syncCandidateToFactoryState({
      supabase: input.supabase,
      runId: input.runId,
      candidateId: input.candidateId,
      targetState: disposition.nextState,
      checkpoint: input.checkpoint,
      actorId: input.actorId,
      reasonCode: input.errorCode,
      lease: input.lease,
    })
    return {
      enabled: true,
      handled: synchronized.active,
      globalDependency: false,
      continueBatch: synchronized.active,
      status: synchronized.active ? disposition.nextState : synchronized.status,
    }
  }

  return {
    enabled: true,
    handled: false,
    globalDependency: false,
    continueBatch: true,
    status: disposition.category,
  }
}
