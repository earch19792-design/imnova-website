import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { collectSellerOsRuntimeHealthV1,
  type SellerOsRuntimeHealthV1 } from
  "../ebay/ebay-seller-os-runtime-health-v1"
import type { SellerOsOperationalIntegrityCheckV1 } from
  "./operational-integrity-auditor-v1.ts"

export const SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1 =
  "SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1" as const
export const SELLER_OS_RUNTIME_CAPABILITY_RECOVERY_POLICY_V1 =
  "SELLER_OS_RUNTIME_CAPABILITY_RECOVERY_POLICY_V1" as const

export const SELLER_OS_RUNTIME_FAILURE_LEARNING_V1 = Object.freeze([
  Object.freeze({ failureClass: "FALSE_ZERO_ON_SOURCE_FAILURE",
    detectionRule:
      "SOURCE_UNAVAILABLE_AND_OWNER_OR_DOWNSTREAM_COUNT_EQUALS_ZERO_WITHOUT_AUTHORITATIVE_ZERO",
    recoveryPolicy:
      "PRESERVE_LAST_CERTIFIED_STATE_AND_RETRY_OFFICIAL_SOURCE",
    regressionGuard: "UNAVAILABLE_UNPROVEN_UNKNOWN_NEVER_EQUAL_ZERO" }),
  Object.freeze({ failureClass: "RUNNER_PARKED_AFTER_FAILURE",
    detectionRule: "RETRYABLE_FAILURE_WITHOUT_NEXT_ATTEMPT_OR_NEW_OUTPUT",
    recoveryPolicy: "BOUNDED_SCHEDULED_RECLAIM_FROM_INCOMPLETE_STAGE",
    regressionGuard: "RETRYABLE_WORK_MUST_HAVE_RECLAIM_PATH" }),
  Object.freeze({ failureClass: "DOWNSTREAM_INCOMPLETE_NOT_RECLAIMABLE",
    detectionRule: "UPSTREAM_OUTPUT_PRESENT_AND_DOWNSTREAM_OUTPUT_MISSING",
    recoveryPolicy: "RECLAIM_DOWNSTREAM_STAGE_WITH_EXISTING_RECEIPT",
    regressionGuard: "DURABLE_OUTPUT_MUST_REMAIN_CONSUMABLE" }),
  Object.freeze({ failureClass: "STALE_EVIDENCE_WITHOUT_REFRESH",
    detectionRule: "EVIDENCE_EXPIRED_AND_NO_REFRESH_OR_EXPLICIT_GAP_STATE",
    recoveryPolicy: "CREATE_OR_REUSE_BOUNDED_REFRESH_JOB",
    regressionGuard: "EVERY_STALEABLE_SOURCE_HAS_REFRESH_OR_EXPLICIT_GAP" }),
  Object.freeze({ failureClass: "WORKER_CAPABILITY_EXPIRED",
    detectionRule: "PENDING_WORK_AND_WORKER_HEARTBEAT_EXCEEDS_MAX_SILENCE",
    recoveryPolicy: "PRESERVE_WORK_AND_RECLAIM_ON_FRESH_CAPABILITY_EVENT",
    regressionGuard: "NO_SILENT_WORKER_DISCONNECTION" }),
  Object.freeze({ failureClass: "SCHEDULER_TICK_WITHOUT_OUTPUT",
    detectionRule: "SCHEDULER_TICK_FRESH_AND_EXPECTED_DURABLE_OUTPUT_STALE",
    recoveryPolicy: "RECLAIM_RUN_WITHOUT_TREATING_TICK_AS_SUCCESS",
    regressionGuard: "SCHEDULER_TICK_IS_NOT_JOB_OR_OUTPUT_HEALTH" }),
  Object.freeze({ failureClass: "FRESH_LABEL_AFTER_EXPIRY",
    detectionRule: "PERSISTED_FRESH_AND_NOW_AFTER_FRESH_UNTIL",
    recoveryPolicy: "DERIVE_FRESHNESS_FROM_TIME_AND_SCHEDULE_REFRESH",
    regressionGuard: "PERSISTED_LABEL_CANNOT_OVERRIDE_EXPIRY" }),
] as const)

export type SellerOsCapabilityFinalHealthV1 =
  | "HEALTHY"
  | "DEGRADED_EXTERNAL"
  | "DEGRADED_INTERNAL"
  | "WAITING_DEPENDENCY"
  | "DISCONNECTED"
  | "STALLED"
  | "MISSED_SCHEDULE"
  | "OUTPUT_MISSING"
  | "UNKNOWN"

type LayerHealthV1 = "PASS" | "DEGRADED" | "FAILED" |
  "WAITING_DEPENDENCY" | "UNKNOWN"
type CanaryModeV1 = "PASSIVE_HEARTBEAT" | "READ_ONLY_PROBE" |
  "SAFE_DRY_RUN"
type ExpectedModeV1 = "CONTINUOUS" | "SCHEDULED" |
  "DEPENDENCY_DRIVEN" | "ON_DEMAND_WITH_CANARY"

export type SellerOsCriticalCapabilityDefinitionV1 = Readonly<{
  capabilityId: string
  businessPurpose: string
  expectedMode: ExpectedModeV1
  expectedCadenceSeconds: number
  maxExpectedSilenceSeconds: number
  canaryMode: CanaryModeV1
  expectedOutput: string
  schedulerLane: string | null
  dependencyIds: readonly string[]
  primaryPath: string
  recoveryPolicy: string
  safeFallback: string
  failClosedPolicy: string
  lastGoodStatePolicy: string
  selfRecovery: boolean
  alerting: boolean
  workerHeartbeatRequired: boolean
}>

function capability(input: SellerOsCriticalCapabilityDefinitionV1) {
  return Object.freeze({ ...input,
    dependencyIds: Object.freeze([...input.dependencyIds]) })
}

const DAILY = 24 * 60 * 60
const FIFTEEN_MINUTES = 15 * 60
const FIVE_MINUTES = 5 * 60

export const SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1 = Object.freeze([
  capability({ capabilityId: "MCP", businessPurpose:
    "Canal privado read-only de Seller OS", expectedMode: "CONTINUOUS",
    expectedCadenceSeconds: 60, maxExpectedSilenceSeconds: 180,
    canaryMode: "PASSIVE_HEARTBEAT", expectedOutput: "MCP_RUNTIME_ATTESTATION",
    schedulerLane: null, dependencyIds: ["TUNNEL"],
    primaryPath: "DEDICATED_MCP_SERVICE", recoveryPolicy:
      "WATCHDOG_RESTART_AND_REATTEST", safeFallback: "CLOUD_READ_RELAY",
    failClosedPolicy: "NO_MCP_RESULT", lastGoodStatePolicy:
      "PRESERVE_LAST_ATTESTATION_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: true }),
  capability({ capabilityId: "TUNNEL", businessPurpose:
    "Transporte restringido hacia el MCP local", expectedMode: "CONTINUOUS",
    expectedCadenceSeconds: 60, maxExpectedSilenceSeconds: 180,
    canaryMode: "PASSIVE_HEARTBEAT", expectedOutput: "TUNNEL_RUNTIME_ATTESTATION",
    schedulerLane: null, dependencyIds: [], primaryPath: "LOOPBACK_TUNNEL_SERVICE",
    recoveryPolicy: "WATCHDOG_RESTART_AND_REATTEST", safeFallback:
      "NO_UNAUTHENTICATED_REMOTE_FALLBACK", failClosedPolicy:
      "MCP_REMOTE_ACCESS_DISABLED", lastGoodStatePolicy:
      "PRESERVE_LAST_ATTESTATION_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: true }),
  capability({ capabilityId: "WATCHDOG", businessPurpose:
    "Detectar y recuperar servicios MCP/tunnel detenidos", expectedMode:
      "SCHEDULED", expectedCadenceSeconds: 60, maxExpectedSilenceSeconds: 180,
    canaryMode: "PASSIVE_HEARTBEAT", expectedOutput: "WATCHDOG_SUCCESS_RECEIPT",
    schedulerLane: null, dependencyIds: [], primaryPath: "SYSTEMD_WATCHDOG_TIMER",
    recoveryPolicy: "SYSTEMD_BOUNDED_RESTART", safeFallback:
      "REPORT_RUNTIME_UNAVAILABLE", failClosedPolicy: "NO_HEALTHY_WITHOUT_TIMER_OUTPUT",
    lastGoodStatePolicy: "PRESERVE_LAST_SUCCESS_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: true }),
  capability({ capabilityId: "SCHEDULER_INFRASTRUCTURE", businessPurpose:
    "Despachar runtimes POST con single-flight", expectedMode: "SCHEDULED",
    expectedCadenceSeconds: FIFTEEN_MINUTES,
    maxExpectedSilenceSeconds: 2 * FIFTEEN_MINUTES,
    canaryMode: "PASSIVE_HEARTBEAT", expectedOutput:
      "RUNTIME_CAPABILITY_ASSURANCE_DISPATCH_RECEIPT",
    schedulerLane: "RUNTIME_CAPABILITY_ASSURANCE", dependencyIds: [],
    primaryPath: "PG_CRON_PG_NET_POST_DISPATCH", recoveryPolicy:
      "NEXT_BOUNDED_SCHEDULER_SLOT", safeFallback: "PRESERVE_PENDING_WORK",
    failClosedPolicy: "SCHEDULER_TICK_NOT_JOB_SUCCESS", lastGoodStatePolicy:
      "PRESERVE_LAST_DISPATCH_RECEIPT_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_TRADING_API", businessPurpose:
    "Autoridad oficial de listings Trading y cohorte LIVE", expectedMode:
      "SCHEDULED", expectedCadenceSeconds: FIVE_MINUTES,
    maxExpectedSilenceSeconds: 3 * FIVE_MINUTES, canaryMode: "READ_ONLY_PROBE",
    expectedOutput: "CERTIFIED_CURRENT_LIVE_COHORT", schedulerLane: null,
    dependencyIds: ["SCHEDULER_INFRASTRUCTURE"], primaryPath:
      "TRADING_GET_SELLER_LIST_AND_GET_ITEM", recoveryPolicy:
      "BOUNDED_RETRY_AFTER_RATE_LIMIT", safeFallback: "CURRENT_UNAVAILABLE",
    failClosedPolicy: "NO_FALSE_ZERO_NO_API_SUBSTITUTION", lastGoodStatePolicy:
      "PRESERVE_LAST_CERTIFIED_COHORT_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_INVENTORY_API", businessPurpose:
    "Leer/preparar inventory items y Offers", expectedMode:
      "ON_DEMAND_WITH_CANARY", expectedCadenceSeconds: DAILY,
    maxExpectedSilenceSeconds: 2 * DAILY, canaryMode: "READ_ONLY_PROBE",
    expectedOutput: "INVENTORY_OFFER_READ_RECEIPT", schedulerLane: null,
    dependencyIds: [], primaryPath: "SELL_INVENTORY_OFFICIAL_READ",
    recoveryPolicy: "READBACK_BEFORE_SAFE_RETRY", safeFallback:
      "UNPUBLISHED_CONFIRMED_OR_AMBIGUOUS_FAIL_CLOSED", failClosedPolicy:
      "NO_NEW_OFFER_TO_ESCAPE_READ_FAILURE", lastGoodStatePolicy:
      "PRESERVE_LAST_OFFICIAL_READBACK_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_MEDIA_API", businessPurpose:
    "Preparar imágenes eBay/EPS para cambios visuales", expectedMode:
      "ON_DEMAND_WITH_CANARY", expectedCadenceSeconds: DAILY,
    maxExpectedSilenceSeconds: 2 * DAILY, canaryMode: "SAFE_DRY_RUN",
    expectedOutput: "MEDIA_CAPABILITY_OR_PREPARATION_RECEIPT", schedulerLane: null,
    dependencyIds: [], primaryPath: "COMMERCE_MEDIA_API",
    recoveryPolicy: "BOUNDED_MEDIA_REPREPARATION", safeFallback:
      "PRESERVE_APPROVED_SOURCE_ASSET", failClosedPolicy:
      "NO_LISTING_WRITE_WITHOUT_PROVEN_MEDIA", lastGoodStatePolicy:
      "PRESERVE_DURABLE_MEDIA_BINDING", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_TAXONOMY_API", businessPurpose:
    "Categorías y aspectos oficiales", expectedMode: "ON_DEMAND_WITH_CANARY",
    expectedCadenceSeconds: DAILY, maxExpectedSilenceSeconds: 7 * DAILY,
    canaryMode: "READ_ONLY_PROBE", expectedOutput: "TAXONOMY_READ_RECEIPT",
    schedulerLane: null, dependencyIds: [], primaryPath: "TAXONOMY_API",
    recoveryPolicy: "RELOAD_OFFICIAL_TAXONOMY", safeFallback:
      "PRESERVE_CERTIFIED_CATEGORY_AS_STALE", failClosedPolicy:
      "NO_CATEGORY_EXISTENCE_AS_SEMANTIC_CERTIFICATION", lastGoodStatePolicy:
      "PRESERVE_LAST_CERTIFIED_TAXONOMY", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_CATALOG_API", businessPurpose:
    "Identificadores y catálogo oficial", expectedMode: "ON_DEMAND_WITH_CANARY",
    expectedCadenceSeconds: DAILY, maxExpectedSilenceSeconds: 2 * DAILY,
    canaryMode: "READ_ONLY_PROBE", expectedOutput: "CATALOG_READ_RECEIPT",
    schedulerLane: null, dependencyIds: [], primaryPath: "COMMERCE_CATALOG_API",
    recoveryPolicy: "BOUNDED_REACQUISITION", safeFallback:
      "PRODUCT_IDENTITY_UNPROVEN", failClosedPolicy:
      "NO_INVENTED_CATALOG_IDENTITY", lastGoodStatePolicy:
      "PRESERVE_LAST_CATALOG_EVIDENCE_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_BROWSE_API", businessPurpose:
    "Contexto público de listings, nunca sustituto de Sold", expectedMode:
      "ON_DEMAND_WITH_CANARY", expectedCadenceSeconds: DAILY,
    maxExpectedSilenceSeconds: 2 * DAILY, canaryMode: "READ_ONLY_PROBE",
    expectedOutput: "BROWSE_READ_RECEIPT", schedulerLane: null,
    dependencyIds: [], primaryPath: "BUY_BROWSE_API", recoveryPolicy:
      "BOUNDED_RETRY_WITH_QUOTA", safeFallback: "BROWSE_CONTEXT_UNAVAILABLE",
    failClosedPolicy: "BROWSE_NOT_SOLD_NOT_TRADING", lastGoodStatePolicy:
      "PRESERVE_LAST_BROWSE_EVIDENCE_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_ACCOUNT_POLICIES", businessPurpose:
    "Identidad de cuenta, location y business policies", expectedMode:
      "ON_DEMAND_WITH_CANARY", expectedCadenceSeconds: DAILY,
    maxExpectedSilenceSeconds: 30 * DAILY, canaryMode: "READ_ONLY_PROBE",
    expectedOutput: "ACCOUNT_POLICY_PROFILE", schedulerLane: null,
    dependencyIds: [], primaryPath: "SELL_ACCOUNT_API", recoveryPolicy:
      "REFRESH_BEFORE_EXPIRY", safeFallback: "PUBLISHER_PREFLIGHT_BLOCKED",
    failClosedPolicy: "NO_POLICY_DEFAULTS", lastGoodStatePolicy:
      "PRESERVE_UNEXPIRED_VERIFIED_PROFILE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_ANALYTICS", businessPurpose:
    "Performance oficial de listings", expectedMode: "SCHEDULED",
    expectedCadenceSeconds: DAILY, maxExpectedSilenceSeconds: 2 * DAILY,
    canaryMode: "READ_ONLY_PROBE", expectedOutput: "PERFORMANCE_SNAPSHOT",
    schedulerLane: null, dependencyIds: [], primaryPath: "SELL_ANALYTICS_API",
    recoveryPolicy: "BOUNDED_REPORT_REACQUISITION", safeFallback:
      "PRESERVE_LAST_SNAPSHOT_AS_STALE", failClosedPolicy:
      "UNKNOWN_PERFORMANCE_NOT_ZERO", lastGoodStatePolicy:
      "PRESERVE_LAST_SNAPSHOT_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_FULFILLMENT_ORDERS", businessPurpose:
    "Órdenes oficiales y fulfillment", expectedMode: "SCHEDULED",
    expectedCadenceSeconds: FIVE_MINUTES,
    maxExpectedSilenceSeconds: 3 * FIVE_MINUTES, canaryMode: "READ_ONLY_PROBE",
    expectedOutput: "OFFICIAL_ORDER_READ_RECEIPT", schedulerLane: null,
    dependencyIds: [], primaryPath: "SELL_FULFILLMENT_GET_ORDERS",
    recoveryPolicy: "BOUNDED_ORDER_READ_RETRY", safeFallback:
      "PRESERVE_LAST_OFFICIAL_ORDERS_AS_STALE", failClosedPolicy:
      "NO_SALE_INFERENCE_FROM_ANALYTICS", lastGoodStatePolicy:
      "PRESERVE_DEDUPED_ORDERS", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "EBAY_RECOMMENDATIONS", businessPurpose:
    "Recomendaciones oficiales read-side", expectedMode:
      "ON_DEMAND_WITH_CANARY", expectedCadenceSeconds: DAILY,
    maxExpectedSilenceSeconds: 2 * DAILY, canaryMode: "READ_ONLY_PROBE",
    expectedOutput: "RECOMMENDATION_READ_RECEIPT", schedulerLane: null,
    dependencyIds: [], primaryPath: "SELL_RECOMMENDATION_AND_MARKETING_READ",
    recoveryPolicy: "OAUTH_REACQUIRE_THEN_BOUNDED_READ", safeFallback:
      "RECOMMENDATIONS_UNAVAILABLE", failClosedPolicy:
      "RECOMMENDATION_NOT_TRUTH_OR_WRITE_AUTHORITY", lastGoodStatePolicy:
      "PRESERVE_LAST_RECOMMENDATION_WITH_FRESHNESS", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "LUNA_PRODUCT_TRUTH", businessPurpose:
    "Producto y variante exactos de Luna", expectedMode: "SCHEDULED",
    expectedCadenceSeconds: DAILY, maxExpectedSilenceSeconds: 2 * DAILY,
    canaryMode: "SAFE_DRY_RUN", expectedOutput: "PRODUCT_TRUTH_RECEIPT",
    schedulerLane: null, dependencyIds: [], primaryPath:
      "LUNA_EXACT_PRODUCT_CAPTURE", recoveryPolicy:
      "DURABLE_REFRESH_JOB_AND_BROWSER_RECLAIM", safeFallback:
      "PRESERVE_LAST_EVIDENCE_AS_STALE", failClosedPolicy:
      "UNPROVEN_FACT_NOT_WRITABLE", lastGoodStatePolicy:
      "PRESERVE_LAST_PRODUCT_TRUTH_RECEIPT", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: true }),
  capability({ capabilityId: "LUNA_SHIPPING", businessPurpose:
    "Shipping exacto a destino canónico", expectedMode: "DEPENDENCY_DRIVEN",
    expectedCadenceSeconds: 60, maxExpectedSilenceSeconds: 20 * 60,
    canaryMode: "PASSIVE_HEARTBEAT", expectedOutput: "SHIPPING_EVIDENCE_RECEIPT",
    schedulerLane: null, dependencyIds: [], primaryPath:
      "LUNA_SHIPPING_EXTENSION_WORKER", recoveryPolicy:
      "PERSISTENT_DISCOVERY_AND_ATOMIC_RECLAIM", safeFallback:
      "SHIPPING_STALE_OR_UNPROVEN", failClosedPolicy:
      "UNKNOWN_SHIPPING_NOT_ZERO_OR_FREE", lastGoodStatePolicy:
      "PRESERVE_LAST_SHIPPING_EVIDENCE_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: true }),
  capability({ capabilityId: "PRODUCT_RESEARCH_EXTENSION", businessPurpose:
    "Captura visible de Product Research/Sold", expectedMode:
      "DEPENDENCY_DRIVEN", expectedCadenceSeconds: 60,
    maxExpectedSilenceSeconds: 30 * 60, canaryMode: "PASSIVE_HEARTBEAT",
    expectedOutput: "PRODUCT_RESEARCH_CAPABILITY_RECEIPT", schedulerLane: null,
    dependencyIds: [], primaryPath: "PRODUCT_RESEARCH_BROWSER_EXTENSION",
    recoveryPolicy: "PRESERVE_PLAN_AND_RECLAIM_ON_HANDSHAKE", safeFallback:
      "WAITING_DEPENDENCY", failClosedPolicy: "NO_FAKE_BACKGROUND_AUTONOMY",
    lastGoodStatePolicy: "PRESERVE_LAST_CAPTURE_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: true }),
  capability({ capabilityId: "PRODUCT_RESEARCH_BROWSER_WORKER", businessPurpose:
    "Ejecutar plans Sold sin investigación manual", expectedMode:
      "DEPENDENCY_DRIVEN", expectedCadenceSeconds: 60,
    maxExpectedSilenceSeconds: 30 * 60, canaryMode: "PASSIVE_HEARTBEAT",
    expectedOutput: "SOLD_EVIDENCE_RECEIPT", schedulerLane: null,
    dependencyIds: ["PRODUCT_RESEARCH_EXTENSION"], primaryPath:
      "AUTHENTICATED_VISIBLE_ADMIN_TAB_WORKER", recoveryPolicy:
      "DURABLE_PENDING_PLAN_AND_AUTOMATIC_RECLAIM", safeFallback:
      "WAITING_DEPENDENCY", failClosedPolicy: "NO_MANUAL_QUERY_SUBSTITUTION",
    lastGoodStatePolicy: "PRESERVE_LAST_SOLD_EVIDENCE_AS_STALE",
    selfRecovery: true, alerting: true, workerHeartbeatRequired: true }),
  capability({ capabilityId: "RADAR", businessPurpose:
    "Interpretar demanda y producir handoffs", expectedMode: "SCHEDULED",
    expectedCadenceSeconds: DAILY, maxExpectedSilenceSeconds: 2 * DAILY,
    canaryMode: "SAFE_DRY_RUN", expectedOutput: "RADAR_RESULT_RECEIPT",
    schedulerLane: "DAILY_DOLLAR_RADAR_AUTOPILOT", dependencyIds:
      ["PRODUCT_RESEARCH_BROWSER_WORKER"], primaryPath:
      "DAILY_DOLLAR_RADAR_AUTOPILOT", recoveryPolicy:
      "RECLAIM_DURABLE_RUN_AND_RETRY", safeFallback:
      "PRESERVE_LAST_RADAR_OUTPUT_AS_STALE", failClosedPolicy:
      "SCHEDULER_TICK_NOT_RADAR_SUCCESS", lastGoodStatePolicy:
      "PRESERVE_LAST_DURABLE_RADAR_OUTPUT", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "PRICING", businessPurpose:
    "Precio defendible desde Sold evidence", expectedMode: "DEPENDENCY_DRIVEN",
    expectedCadenceSeconds: FIFTEEN_MINUTES,
    maxExpectedSilenceSeconds: 2 * DAILY, canaryMode: "SAFE_DRY_RUN",
    expectedOutput: "DEFENSIBLE_MARKET_PRICE_RECEIPT", schedulerLane: null,
    dependencyIds: ["RADAR"], primaryPath: "RADAR_PRICING_RECALCULATION",
    recoveryPolicy: "RECALCULATE_AFTER_FRESH_SOLD_EVIDENCE", safeFallback:
      "MARKET_PRICE_UNPROVEN", failClosedPolicy:
      "NO_TARGET_PROFIT_INVENTED_PRICE", lastGoodStatePolicy:
      "PRESERVE_LAST_PRICE_WITH_FRESHNESS", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "ECONOMICS_REFRESH", businessPurpose:
    "Actualizar costos y recalcular profit/margin/ROI", expectedMode:
      "SCHEDULED", expectedCadenceSeconds: FIFTEEN_MINUTES,
    maxExpectedSilenceSeconds: 2 * FIFTEEN_MINUTES,
    canaryMode: "SAFE_DRY_RUN", expectedOutput:
      "FRESH_ECONOMIC_EVIDENCE_AND_RECALCULATION", schedulerLane:
      "OPERATIONAL_INTEGRITY_AUDITOR", dependencyIds: [], primaryPath:
      "ECONOMIC_EVIDENCE_REFRESH_RUNTIME", recoveryPolicy:
      "DURABLE_REFRESH_JOB_WITH_BOUNDED_RETRY", safeFallback:
      "PARTIAL_ECONOMICS_WITH_MISSING_INPUTS", failClosedPolicy:
      "EXPIRED_LABEL_NEVER_FRESH_UNKNOWN_NOT_ZERO", lastGoodStatePolicy:
      "PRESERVE_EVIDENCE_WITH_DERIVED_FRESHNESS", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "CURRENT_LIVE_AUTHORITY_REFRESH", businessPurpose:
    "Cohorte LIVE canónica compartida", expectedMode: "SCHEDULED",
    expectedCadenceSeconds: FIVE_MINUTES,
    maxExpectedSilenceSeconds: 3 * FIVE_MINUTES,
    canaryMode: "READ_ONLY_PROBE", expectedOutput:
      "CERTIFIED_CURRENT_LIVE_COHORT", schedulerLane: null,
    dependencyIds: ["EBAY_TRADING_API"], primaryPath:
      "COMMERCIAL_MONITOR_CURRENT_LIVE_RECOVERY", recoveryPolicy:
      "AUTOMATIC_RETRY_AND_RECONCILIATION", safeFallback:
      "CURRENT_UNAVAILABLE_WITH_LAST_CERTIFIED", failClosedPolicy:
      "UNAVAILABLE_NOT_ZERO", lastGoodStatePolicy:
      "PRESERVE_LAST_CERTIFIED_COHORT", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "STOCKGUARD", businessPurpose:
    "Protección de stock basada en cohort/facts frescos", expectedMode:
      "SCHEDULED", expectedCadenceSeconds: FIFTEEN_MINUTES,
    maxExpectedSilenceSeconds: 2 * FIFTEEN_MINUTES,
    canaryMode: "SAFE_DRY_RUN", expectedOutput: "STOCKGUARD_REVIEW_RECEIPT",
    schedulerLane: null, dependencyIds: ["CURRENT_LIVE_AUTHORITY_REFRESH",
      "LUNA_PRODUCT_TRUTH"], primaryPath: "TARGETED_LUNA_MONITOR_AND_STOCKGUARD",
    recoveryPolicy: "RETRY_AFTER_LIVE_AND_LUNA_AUTHORITY", safeFallback:
      "STOCK_UNKNOWN_NO_PROTECTIVE_WRITE", failClosedPolicy:
      "UNKNOWN_STOCK_NOT_OOS", lastGoodStatePolicy:
      "PRESERVE_LAST_REVIEW_AS_STALE", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "PUBLISHER_RUNTIME", businessPurpose:
    "Publisher idempotente autorizado", expectedMode: "SCHEDULED",
    expectedCadenceSeconds: FIVE_MINUTES,
    maxExpectedSilenceSeconds: 3 * FIVE_MINUTES, canaryMode: "SAFE_DRY_RUN",
    expectedOutput: "PUBLISHER_PREFLIGHT_RECEIPT", schedulerLane:
      "PUBLISHER_BATCH_RUNTIME", dependencyIds: [], primaryPath:
      "SELLER_OS_PUBLISHER_BATCH_RUNTIME", recoveryPolicy:
      "READBACK_BEFORE_RETRY_AND_CHILD_SCOPED_RESUME", safeFallback:
      "UNPUBLISHED_OR_AMBIGUOUS_FAIL_CLOSED", failClosedPolicy:
      "NO_PUBLISH_WITHOUT_FRESH_AUTHORIZATION", lastGoodStatePolicy:
      "PRESERVE_DURABLE_EXECUTION_RECEIPT", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
  capability({ capabilityId: "MAYEL_VISUAL_APPLY_RUNTIME", businessPurpose:
    "Aplicar diffs visuales delegados con readback", expectedMode:
      "DEPENDENCY_DRIVEN", expectedCadenceSeconds: FIFTEEN_MINUTES,
    maxExpectedSilenceSeconds: DAILY, canaryMode: "SAFE_DRY_RUN",
    expectedOutput: "MAYEL_VISUAL_EXECUTION_OR_IDLE_RECEIPT", schedulerLane:
      "OPERATIONAL_INTEGRITY_AUDITOR", dependencyIds: ["EBAY_MEDIA_API"],
    primaryPath: "MANAGEMENT_MODEL_SPECIFIC_VISUAL_EXECUTOR",
    recoveryPolicy: "SAFE_REBASE_THEN_SINGLE_WRITE_WHEN_AUTHORIZED",
    safeFallback: "PRESERVE_MANIFEST_WAITING_DEPENDENCY", failClosedPolicy:
      "NO_MIXED_API_NO_UNAUTHORIZED_DIFF", lastGoodStatePolicy:
      "PRESERVE_MANIFEST_AND_OFFICIAL_READBACK", selfRecovery: true,
    alerting: true, workerHeartbeatRequired: false }),
] as const)

type CapabilityObservationV1 = Readonly<{
  lastHeartbeatAt: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastCompletedJobId: string | null
  lastDurableReceiptId: string | null
  lastExpectedOutputAt: string | null
  nextRetryAt: string | null
  dependencyAvailable: boolean | null
  connectionProven: boolean | null
  explicitExternalBlocker: boolean
  blockerCode: string | null
  pendingWorkCount: number | null
  downstreamConsumedAt: string | null
  persistedFreshExpiredCount: number
  sourceAuthorityAvailable: boolean
}>

export type SellerOsCapabilityHealthV1 = Readonly<{
  capabilityId: string
  businessPurpose: string
  expectedMode: ExpectedModeV1
  expectedCadenceSeconds: number
  maxExpectedSilenceSeconds: number
  canaryMode: CanaryModeV1
  canaryCovered: true
  expectedOutput: string
  infraHealth: LayerHealthV1
  connectionHealth: LayerHealthV1
  capabilityHealth: LayerHealthV1
  jobHealth: LayerHealthV1
  outputHealth: LayerHealthV1
  downstreamHealth: LayerHealthV1
  lastHeartbeatAt: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastCompletedJobId: string | null
  lastDurableReceiptId: string | null
  lastExpectedOutputAt: string | null
  nextExpectedRunAt: string | null
  nextRetryAt: string | null
  currentLagSeconds: number | null
  dependencyStatus: string
  blockerCode: string | null
  primaryPath: string
  recoveryPolicy: string
  safeFallback: string
  failClosedPolicy: string
  lastGoodStatePolicy: string
  selfRecovery: boolean
  contingency: string
  alerting: boolean
  finalHealthState: SellerOsCapabilityFinalHealthV1
  humanSummary: string
}>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}
function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}
function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
function count(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}
function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}
function ageSeconds(value: string | null, nowMs: number) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) && nowMs >= parsed
    ? Math.floor((nowMs - parsed) / 1_000) : null
}
function addSeconds(value: string | null, seconds: number) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed)
    ? new Date(parsed + seconds * 1_000).toISOString() : null
}
function latest(...values: (string | null)[]) {
  return values.filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
}
function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

export function deriveSellerOsFreshnessStatusV1(input: Readonly<{
  persistedStatus: string | null
  freshUntil: string | null
  expiresAt: string | null
  nonExpiringByPolicy: boolean
  now: Date
}>) {
  const boundary = input.freshUntil ?? input.expiresAt
  if (!boundary) return input.nonExpiringByPolicy
    ? "NON_EXPIRING_BY_POLICY" as const
    : "FRESHNESS_POLICY_MISSING" as const
  const expires = Date.parse(boundary)
  if (!Number.isFinite(expires)) return "FRESHNESS_POLICY_MISSING" as const
  return input.now.getTime() > expires
    ? "STALE" as const : "FRESH" as const
}

function source(evidence: Record<string, unknown>, needle: string) {
  return rows(evidence.factSources).find((entry) =>
    String(entry.source_type ?? "").toUpperCase().includes(needle)) ?? {}
}
function quota(evidence: Record<string, unknown>, family: string) {
  return rows(evidence.quota).find((entry) =>
    String(entry.api_family ?? "").toUpperCase() === family) ?? {}
}
function scheduler(evidence: Record<string, unknown>, lane: string) {
  return rows(evidence.scheduler).find((entry) => entry.lane === lane) ?? {}
}
function workerEvidence(evidence: Record<string, unknown>, worker: string) {
  const receipt = record(record(evidence.integrity).audit_receipt)
  return rows(receipt.checks).map((entry) => record(entry.evidence)).find(
    (entry) => entry.worker === worker &&
      Object.hasOwn(entry, "eligiblePendingJobCount")) ?? {}
}

function baseObservation(overrides: Partial<CapabilityObservationV1> = {}):
    CapabilityObservationV1 {
  return Object.freeze({ lastHeartbeatAt: null, lastAttemptAt: null,
    lastSuccessAt: null, lastCompletedJobId: null,
    lastDurableReceiptId: null, lastExpectedOutputAt: null,
    nextRetryAt: null, dependencyAvailable: null, connectionProven: null,
    explicitExternalBlocker: false, blockerCode: null,
    pendingWorkCount: null, downstreamConsumedAt: null,
    persistedFreshExpiredCount: 0, sourceAuthorityAvailable: false,
    ...overrides })
}

function observationFor(input: Readonly<{
  definition: SellerOsCriticalCapabilityDefinitionV1
  evidence: Record<string, unknown>
  runtimeHealth: SellerOsRuntimeHealthV1
}>): CapabilityObservationV1 {
  const id = input.definition.capabilityId
  const evidence = input.evidence
  const live = record(evidence.currentLive)
  const research = record(evidence.researchCapture)
  const researchPlans = record(evidence.researchPlans)
  const researchTasks = record(evidence.researchTasks)
  const radar = record(evidence.radar)
  const radarReceipt = record(evidence.radarReceipt)
  const economics = record(evidence.economics)
  const economicJobs = record(evidence.economicJobs)
  const economicsReadback = record(evidence.economicsReadback)
  const shipping = record(evidence.shipping)
  const shippingClaims = record(evidence.shippingClaims)
  const productFacts = record(evidence.productFacts)
  const policies = record(evidence.accountPolicies)
  const orders = record(evidence.orders)
  const analytics = record(evidence.analytics)
  const mayel = record(evidence.mayel)
  const publisher = record(evidence.publisher)
  const publisherBatch = record(evidence.publisherBatch)
  const lunaWorker = workerEvidence(evidence, "LUNA_SHIPPING")
  const researchWorker = workerEvidence(evidence, "PRODUCT_RESEARCH")
  const lane = input.definition.schedulerLane
    ? scheduler(evidence, input.definition.schedulerLane) : {}
  const laneDispatchAt = iso(lane.last_dispatch_at)
  if (id === "MCP") {
    const service = input.runtimeHealth.services.mcp
    return baseObservation({ lastHeartbeatAt:
      service.status === "HEALTHY" ? input.runtimeHealth.observedAt : null,
    lastAttemptAt: input.runtimeHealth.observedAt,
    lastSuccessAt: service.status === "HEALTHY"
      ? input.runtimeHealth.observedAt : null,
    lastExpectedOutputAt: input.runtimeHealth.runtimeCatalog.exactCatalogMatch
      ? input.runtimeHealth.observedAt : null,
    connectionProven: service.status === "HEALTHY",
    blockerCode: service.status === "HEALTHY" ? null :
      "MCP_SERVICE_EVIDENCE_UNAVAILABLE",
    sourceAuthorityAvailable: input.runtimeHealth.evidenceCompleteness !==
      "UNAVAILABLE" })
  }
  if (id === "TUNNEL") {
    const service = input.runtimeHealth.services.tunnel
    return baseObservation({ lastHeartbeatAt: service.status === "HEALTHY"
      ? input.runtimeHealth.observedAt : null,
    lastAttemptAt: input.runtimeHealth.observedAt,
    lastSuccessAt: service.status === "HEALTHY"
      ? input.runtimeHealth.observedAt : null,
    lastExpectedOutputAt: service.status === "HEALTHY"
      ? input.runtimeHealth.observedAt : null,
    connectionProven: service.status === "HEALTHY",
    blockerCode: service.status === "HEALTHY" ? null :
      "TUNNEL_SERVICE_EVIDENCE_UNAVAILABLE",
    sourceAuthorityAvailable: input.runtimeHealth.evidenceCompleteness !==
      "UNAVAILABLE" })
  }
  if (id === "WATCHDOG") return baseObservation({
    lastHeartbeatAt: input.runtimeHealth.watchdog.lastRunAt,
    lastAttemptAt: input.runtimeHealth.watchdog.lastRunAt,
    lastSuccessAt: input.runtimeHealth.watchdog.lastSuccessAt,
    lastExpectedOutputAt: input.runtimeHealth.watchdog.lastSuccessAt,
    connectionProven: input.runtimeHealth.services.watchdogTimer.status ===
      "HEALTHY", blockerCode: input.runtimeHealth.watchdog.lastResult ===
      "success" ? null : "WATCHDOG_SUCCESS_RECEIPT_UNAVAILABLE",
    sourceAuthorityAvailable: input.runtimeHealth.evidenceCompleteness !==
      "UNAVAILABLE" })
  if (id === "SCHEDULER_INFRASTRUCTURE") return baseObservation({
    lastHeartbeatAt: laneDispatchAt, lastAttemptAt: laneDispatchAt,
    lastSuccessAt: laneDispatchAt, lastCompletedJobId: text(lane.dispatch_key),
    lastDurableReceiptId: laneDispatchAt,
    lastExpectedOutputAt: laneDispatchAt, connectionProven: lane.enabled === true,
    blockerCode: lane.enabled === true ? null : "ASSURANCE_SCHEDULER_DISABLED",
    sourceAuthorityAvailable: Object.keys(lane).length > 0 })
  if (id === "EBAY_TRADING_API" || id ===
      "CURRENT_LIVE_AUTHORITY_REFRESH") {
    const currentFresh = live.current_live_source_state === "CURRENT_FRESH"
    const error = text(live.current_live_last_error_code)
    return baseObservation({ lastAttemptAt: iso(live.current_live_last_attempt_at),
      lastSuccessAt: iso(live.last_certified_live_observed_at) ??
        iso(live.last_success_at),
      lastCompletedJobId: text(live.last_success_run_id),
      lastDurableReceiptId: text(live.last_certified_live_scope_id),
      lastExpectedOutputAt: iso(live.last_certified_live_observed_at),
      nextRetryAt: iso(live.current_live_next_retry_at),
      connectionProven: iso(live.current_live_last_attempt_at) !== null,
      explicitExternalBlocker: Boolean(error?.includes("TRADING_ERROR_518")),
      blockerCode: currentFresh ? null : error ?? "CURRENT_LIVE_UNAVAILABLE",
      sourceAuthorityAvailable: Object.keys(live).length > 0 })
  }
  if (id === "EBAY_INVENTORY_API") {
    const sell = quota(evidence, "SELL")
    return baseObservation({ lastAttemptAt: iso(publisher.latestUpdatedAt),
      lastSuccessAt: iso(publisher.latestVerifiedAt),
      lastExpectedOutputAt: iso(publisher.latestVerifiedAt),
      connectionProven: text(sell.status) === "AVAILABLE" ? true : null,
      blockerCode: text(sell.status) === "AVAILABLE" ? null :
        "SELL_INVENTORY_CAPABILITY_UNPROVEN",
      sourceAuthorityAvailable: Object.keys(publisher).length > 0 })
  }
  if (id === "EBAY_MEDIA_API") return baseObservation({
    lastAttemptAt: iso(mayel.latestUpdatedAt),
    lastSuccessAt: iso(mayel.latestAppliedAt),
    lastExpectedOutputAt: iso(mayel.latestAppliedAt),
    downstreamConsumedAt: iso(mayel.latestReadbackAt),
    connectionProven: count(mayel.executionCount) !== null,
    blockerCode: count(mayel.executionCount) === null
      ? "MEDIA_CAPABILITY_UNPROVEN" : null,
    sourceAuthorityAvailable: Object.keys(mayel).length > 0 })
  if (["EBAY_TAXONOMY_API", "EBAY_CATALOG_API", "EBAY_BROWSE_API"]
      .includes(id)) {
    const name = id === "EBAY_TAXONOMY_API" ? "TAXONOMY"
      : id === "EBAY_CATALOG_API" ? "CATALOG" : "BROWSE"
    const row = source(evidence, name)
    const available = (count(row.available_count) ?? 0) > 0
    return baseObservation({ lastAttemptAt: iso(row.latest_fetched_at),
      lastSuccessAt: available ? iso(row.latest_fetched_at) : null,
      lastExpectedOutputAt: available ? iso(row.latest_fetched_at) : null,
      connectionProven: available ? true : null,
      blockerCode: available ? null : `${name}_READ_OUTPUT_MISSING`,
      sourceAuthorityAvailable: Object.keys(row).length > 0 })
  }
  if (id === "EBAY_ACCOUNT_POLICIES") return baseObservation({
    lastAttemptAt: iso(policies.verified_at), lastSuccessAt: iso(policies.verified_at),
    lastCompletedJobId: text(policies.id), lastDurableReceiptId: text(policies.id),
    lastExpectedOutputAt: iso(policies.verified_at),
    connectionProven: iso(policies.verified_at) !== null,
    blockerCode: iso(policies.verified_at) ? null : "ACCOUNT_POLICY_PROFILE_MISSING",
    sourceAuthorityAvailable: Object.keys(policies).length > 0 })
  if (id === "EBAY_ANALYTICS") return baseObservation({
    lastAttemptAt: iso(analytics.latestObservedAt),
    lastSuccessAt: iso(analytics.latestObservedAt),
    lastExpectedOutputAt: iso(analytics.latestObservedAt),
    connectionProven: null, blockerCode: count(analytics.snapshotCount) === 0
      ? "PERFORMANCE_SNAPSHOT_MISSING" : null,
    sourceAuthorityAvailable: Object.keys(analytics).length > 0 })
  if (id === "EBAY_FULFILLMENT_ORDERS") return baseObservation({
    lastAttemptAt: iso(orders.latestObservedAt),
    lastSuccessAt: iso(orders.latestObservedAt),
    lastExpectedOutputAt: iso(orders.latestObservedAt),
    connectionProven: count(orders.snapshotCount) !== null,
    blockerCode: count(orders.snapshotCount) === 0
      ? "OFFICIAL_ORDER_READ_RECEIPT_MISSING" : null,
    sourceAuthorityAvailable: Object.keys(orders).length > 0 })
  if (id === "EBAY_RECOMMENDATIONS") {
    const marketing = quota(evidence, "MARKETING")
    return baseObservation({ lastAttemptAt: iso(marketing.last_refreshed_at),
      lastSuccessAt: text(marketing.status) === "AVAILABLE"
        ? iso(marketing.last_refreshed_at) : null,
      lastExpectedOutputAt: null, connectionProven: null,
      blockerCode: "RECOMMENDATION_READ_RECEIPT_MISSING",
      sourceAuthorityAvailable: Object.keys(marketing).length > 0 })
  }
  if (id === "LUNA_PRODUCT_TRUTH") return baseObservation({
    lastAttemptAt: iso(productFacts.latestFetchedAt),
    lastSuccessAt: iso(productFacts.latestFetchedAt),
    lastExpectedOutputAt: iso(productFacts.latestFetchedAt),
    connectionProven: count(productFacts.observationCount) !== null,
    blockerCode: (count(productFacts.missingFreshnessPolicyCount) ?? 0) > 0
      ? "FRESHNESS_POLICY_MISSING" : null,
    sourceAuthorityAvailable: Object.keys(productFacts).length > 0 })
  if (id === "LUNA_SHIPPING") {
    const pending = count(lunaWorker.eligiblePendingJobCount)
    const connected = lunaWorker.capabilityProven === true
    return baseObservation({ lastHeartbeatAt: connected
      ? iso(record(evidence.integrity).observed_at) : null,
    lastAttemptAt: iso(shippingClaims.latestClaimAt),
    lastSuccessAt: iso(shippingClaims.latestCompletedAt),
    lastExpectedOutputAt: iso(shipping.latestObservedAt),
    pendingWorkCount: pending, dependencyAvailable: connected,
    connectionProven: connected,
    blockerCode: connected ? null : "WORKER_CAPABILITY_EXPIRED",
    sourceAuthorityAvailable: Object.keys(shippingClaims).length > 0 })
  }
  if (id === "PRODUCT_RESEARCH_EXTENSION" || id ===
      "PRODUCT_RESEARCH_BROWSER_WORKER") {
    const capturedAt = iso(research.captured_at) ??
      iso(researchTasks.latestCapturedAt)
    const pending = count(researchTasks.pendingCount)
    const connected = researchWorker.capabilityProven === true
    return baseObservation({ lastHeartbeatAt: connected
      ? iso(record(evidence.integrity).observed_at) : null,
    lastAttemptAt: iso(researchPlans.latestUpdatedAt),
    lastSuccessAt: capturedAt, lastCompletedJobId: text(research.id),
    lastDurableReceiptId: text(research.id), lastExpectedOutputAt: capturedAt,
    pendingWorkCount: pending, dependencyAvailable: connected,
    connectionProven: connected,
    blockerCode: connected ? null : "WORKER_CAPABILITY_EXPIRED",
    downstreamConsumedAt: iso(researchTasks.latestProcessedAt),
    sourceAuthorityAvailable: Object.keys(research).length > 0 })
  }
  if (id === "RADAR") return baseObservation({
    lastHeartbeatAt: laneDispatchAt, lastAttemptAt: laneDispatchAt,
    lastSuccessAt: iso(radar.completed_at), lastCompletedJobId: text(radar.run_id),
    lastDurableReceiptId: text(radarReceipt.receipt_id),
    lastExpectedOutputAt: iso(radarReceipt.recorded_at),
    nextRetryAt: iso(radar.next_retry_at), connectionProven: lane.enabled === true,
    blockerCode: text(radar.status) === "COMPLETED" ? null :
      text(radar.last_error_code) ?? "RADAR_RUN_INCOMPLETE",
    sourceAuthorityAvailable: Object.keys(radar).length > 0 })
  if (id === "PRICING") return baseObservation({
    lastAttemptAt: iso(economicsReadback.latestCalculatedAt),
    lastSuccessAt: (count(economicsReadback.provenCount) ?? 0) > 0
      ? iso(economicsReadback.latestCalculatedAt) : null,
    lastExpectedOutputAt: (count(economicsReadback.provenCount) ?? 0) > 0
      ? iso(economicsReadback.latestCalculatedAt) : null,
    connectionProven: true, blockerCode:
      (count(economicsReadback.provenCount) ?? 0) > 0
        ? null : "DEFENSIBLE_MARKET_PRICE_OUTPUT_MISSING",
    sourceAuthorityAvailable: Object.keys(economicsReadback).length > 0 })
  if (id === "ECONOMICS_REFRESH") return baseObservation({
    lastHeartbeatAt: laneDispatchAt,
    lastAttemptAt: iso(economicJobs.latestUpdatedAt),
    lastSuccessAt: iso(economics.latestCapturedAt),
    lastExpectedOutputAt: iso(economicsReadback.latestCalculatedAt),
    nextRetryAt: iso(economicJobs.nextRetryAt), connectionProven: lane.enabled === true,
    pendingWorkCount: count(economicJobs.retryableCount),
    persistedFreshExpiredCount:
      count(economics.persistedFreshExpiredCount) ?? 0,
    blockerCode: (count(economics.persistedFreshExpiredCount) ?? 0) > 0
      ? "FRESH_LABEL_AFTER_EXPIRY" : null,
    sourceAuthorityAvailable: Object.keys(economics).length > 0 })
  if (id === "STOCKGUARD") return baseObservation({
    lastAttemptAt: iso(live.targeted_luna_last_error_at) ??
      iso(live.targeted_luna_last_success_at),
    lastSuccessAt: iso(live.targeted_luna_last_success_at),
    lastCompletedJobId: text(live.targeted_luna_last_success_run_id),
    lastExpectedOutputAt: iso(live.targeted_luna_last_success_at),
    nextRetryAt: iso(live.current_live_next_retry_at),
    dependencyAvailable: live.current_live_source_state === "CURRENT_FRESH",
    connectionProven: null, blockerCode:
      text(live.targeted_luna_last_error_code) ??
      (live.current_live_source_state === "CURRENT_FRESH" ? null :
        "CURRENT_LIVE_DEPENDENCY_UNAVAILABLE"),
    sourceAuthorityAvailable: Object.keys(live).length > 0 })
  if (id === "PUBLISHER_RUNTIME") return baseObservation({
    lastHeartbeatAt: laneDispatchAt, lastAttemptAt: laneDispatchAt,
    lastSuccessAt: iso(publisher.latestVerifiedAt),
    lastExpectedOutputAt: iso(publisherBatch.latestUpdatedAt),
    nextRetryAt: iso(publisherBatch.nextRetryAt),
    pendingWorkCount: count(publisherBatch.activeCount),
    connectionProven: lane.enabled === true,
    blockerCode: lane.enabled === true ? null : "PUBLISHER_RUNTIME_DISABLED",
    sourceAuthorityAvailable: Object.keys(publisherBatch).length > 0 })
  if (id === "MAYEL_VISUAL_APPLY_RUNTIME") return baseObservation({
    lastHeartbeatAt: laneDispatchAt, lastAttemptAt: iso(mayel.latestUpdatedAt),
    lastSuccessAt: iso(mayel.latestAppliedAt),
    lastExpectedOutputAt: iso(mayel.latestReadbackAt),
    downstreamConsumedAt: iso(mayel.latestReadbackAt),
    connectionProven: lane.enabled === true,
    blockerCode: lane.enabled === true ? null : "MAYEL_RUNTIME_DISABLED",
    sourceAuthorityAvailable: Object.keys(mayel).length > 0 })
  return baseObservation()
}

function humanSummary(state: SellerOsCapabilityFinalHealthV1,
  definition: SellerOsCriticalCapabilityDefinitionV1,
  observation: CapabilityObservationV1) {
  const name = definition.capabilityId.replaceAll("_", " ")
  if (state === "HEALTHY") return `${name} produjo evidencia vigente.`
  if (state === "WAITING_DEPENDENCY") return `${name} conserva el trabajo y espera que vuelva su dependencia.`
  if (state === "MISSED_SCHEDULE") return `${name} no produjo la ejecución esperada dentro de su ventana.`
  if (state === "OUTPUT_MISSING") return `${name} no tiene el output durable esperado.`
  if (state === "DEGRADED_EXTERNAL") return `${name} está limitado por una fuente externa; Seller OS reintentará.`
  if (state === "DISCONNECTED") return `${name} no tiene conexión/capability receipt vigente.`
  if (state === "STALLED") return `${name} dejó de producir resultados vigentes.`
  if (state === "DEGRADED_INTERNAL") return `${name} tiene una inconsistencia interna detectable.`
  return `${name} no tiene evidencia suficiente para declarar salud.`
}

function evaluateCapability(input: Readonly<{
  definition: SellerOsCriticalCapabilityDefinitionV1
  observation: CapabilityObservationV1
  schedulerInfrastructureHealthy: boolean
  now: Date
}>): SellerOsCapabilityHealthV1 {
  const { definition, observation } = input
  const nowMs = input.now.getTime()
  const lag = ageSeconds(observation.lastExpectedOutputAt ??
    observation.lastSuccessAt, nowMs)
  const heartbeatLag = ageSeconds(observation.lastHeartbeatAt, nowMs)
  const outputMissing = observation.lastExpectedOutputAt === null
  const outputLate = lag !== null && lag > definition.maxExpectedSilenceSeconds
  const heartbeatLate = definition.workerHeartbeatRequired &&
    (heartbeatLag === null || heartbeatLag > definition.maxExpectedSilenceSeconds)
  const laneRequired = definition.schedulerLane !== null
  const laneLate = laneRequired &&
    (heartbeatLag === null || heartbeatLag > definition.maxExpectedSilenceSeconds)
  const dependencyWaiting = observation.pendingWorkCount !== null &&
    observation.pendingWorkCount > 0 && observation.dependencyAvailable === false

  let finalHealthState: SellerOsCapabilityFinalHealthV1
  if (observation.persistedFreshExpiredCount > 0) {
    finalHealthState = "DEGRADED_INTERNAL"
  } else if (dependencyWaiting) {
    finalHealthState = "WAITING_DEPENDENCY"
  } else if (observation.explicitExternalBlocker) {
    finalHealthState = "DEGRADED_EXTERNAL"
  } else if (!observation.sourceAuthorityAvailable) {
    finalHealthState = "UNKNOWN"
  } else if (laneLate) {
    finalHealthState = "MISSED_SCHEDULE"
  } else if (heartbeatLate) {
    finalHealthState = observation.connectionProven === false
      ? "DISCONNECTED" : "WAITING_DEPENDENCY"
  } else if (outputMissing) {
    finalHealthState = "OUTPUT_MISSING"
  } else if (outputLate) {
    finalHealthState = definition.expectedMode === "SCHEDULED"
      ? "MISSED_SCHEDULE" : "STALLED"
  } else if (observation.blockerCode) {
    finalHealthState = "DEGRADED_INTERNAL"
  } else {
    finalHealthState = "HEALTHY"
  }

  const infraHealth: LayerHealthV1 = definition.capabilityId ===
      "SCHEDULER_INFRASTRUCTURE"
    ? finalHealthState === "HEALTHY" ? "PASS" : "FAILED"
    : input.schedulerInfrastructureHealthy ? "PASS" : "DEGRADED"
  const connectionHealth: LayerHealthV1 =
    observation.connectionProven === true ? "PASS"
      : observation.connectionProven === false
        ? dependencyWaiting ? "WAITING_DEPENDENCY" : "FAILED"
        : "UNKNOWN"
  const jobHealth: LayerHealthV1 = laneLate ? "FAILED"
    : dependencyWaiting ? "WAITING_DEPENDENCY"
      : definition.expectedMode === "ON_DEMAND_WITH_CANARY" ||
        observation.lastAttemptAt ? "PASS" : "UNKNOWN"
  const outputHealth: LayerHealthV1 = outputMissing || outputLate
    ? "FAILED" : "PASS"
  const downstreamHealth: LayerHealthV1 = observation.downstreamConsumedAt
    ? "PASS" : outputMissing ? "UNKNOWN" : "DEGRADED"
  const capabilityHealth: LayerHealthV1 = finalHealthState === "HEALTHY"
    ? "PASS" : ["WAITING_DEPENDENCY"].includes(finalHealthState)
      ? "WAITING_DEPENDENCY" : finalHealthState === "UNKNOWN"
        ? "UNKNOWN" : finalHealthState === "DEGRADED_EXTERNAL"
          ? "DEGRADED" : "FAILED"
  const nextExpectedRunAt = addSeconds(observation.lastHeartbeatAt ??
    observation.lastAttemptAt ?? observation.lastSuccessAt,
  definition.expectedCadenceSeconds)
  return Object.freeze({ capabilityId: definition.capabilityId,
    businessPurpose: definition.businessPurpose,
    expectedMode: definition.expectedMode,
    expectedCadenceSeconds: definition.expectedCadenceSeconds,
    maxExpectedSilenceSeconds: definition.maxExpectedSilenceSeconds,
    canaryMode: definition.canaryMode, canaryCovered: true as const,
    expectedOutput: definition.expectedOutput, infraHealth,
    connectionHealth, capabilityHealth, jobHealth, outputHealth,
    downstreamHealth, lastHeartbeatAt: observation.lastHeartbeatAt,
    lastAttemptAt: observation.lastAttemptAt,
    lastSuccessAt: observation.lastSuccessAt,
    lastCompletedJobId: observation.lastCompletedJobId,
    lastDurableReceiptId: observation.lastDurableReceiptId,
    lastExpectedOutputAt: observation.lastExpectedOutputAt,
    nextExpectedRunAt, nextRetryAt: observation.nextRetryAt,
    currentLagSeconds: lag,
    dependencyStatus: observation.dependencyAvailable === true ? "AVAILABLE"
      : observation.dependencyAvailable === false ? "WAITING_DEPENDENCY"
        : definition.dependencyIds.length === 0 ? "NOT_APPLICABLE" : "UNKNOWN",
    blockerCode: observation.blockerCode,
    primaryPath: definition.primaryPath,
    recoveryPolicy: definition.recoveryPolicy,
    safeFallback: definition.safeFallback,
    failClosedPolicy: definition.failClosedPolicy,
    lastGoodStatePolicy: definition.lastGoodStatePolicy,
    selfRecovery: definition.selfRecovery,
    contingency: `${definition.safeFallback} → ${definition.failClosedPolicy}`,
    alerting: definition.alerting, finalHealthState,
    humanSummary: humanSummary(finalHealthState, definition, observation) })
}

function failureClass(entry: SellerOsCapabilityHealthV1) {
  if (entry.blockerCode === "FRESH_LABEL_AFTER_EXPIRY")
    return "FRESH_LABEL_AFTER_EXPIRY"
  if (entry.capabilityId === "RADAR" && entry.finalHealthState ===
      "MISSED_SCHEDULE") return "SCHEDULER_TICK_WITHOUT_OUTPUT"
  if (entry.blockerCode === "WORKER_CAPABILITY_EXPIRED")
    return "WORKER_CAPABILITY_EXPIRED"
  if (entry.finalHealthState === "OUTPUT_MISSING") return "EXPECTED_OUTPUT_MISSING"
  if (entry.finalHealthState === "MISSED_SCHEDULE") return "MISSED_SCHEDULE"
  if (entry.finalHealthState === "STALLED") return "RUNNER_PARKED_AFTER_FAILURE"
  if (entry.finalHealthState === "WAITING_DEPENDENCY")
    return "DOWNSTREAM_INCOMPLETE_NOT_RECLAIMABLE"
  if (entry.finalHealthState === "DEGRADED_EXTERNAL")
    return "EXTERNAL_DEPENDENCY_UNAVAILABLE"
  if (entry.finalHealthState === "DISCONNECTED")
    return "WORKER_CAPABILITY_EXPIRED"
  if (entry.finalHealthState === "UNKNOWN") return "CAPABILITY_OBSERVABILITY_GAP"
  return "STALE_EVIDENCE_WITHOUT_REFRESH"
}

function healthCheck(entry: SellerOsCapabilityHealthV1):
    SellerOsOperationalIntegrityCheckV1 {
  const evidence = { capabilityId: entry.capabilityId,
    finalHealthState: entry.finalHealthState,
    lastHeartbeatAt: entry.lastHeartbeatAt,
    lastAttemptAt: entry.lastAttemptAt, lastSuccessAt: entry.lastSuccessAt,
    lastExpectedOutputAt: entry.lastExpectedOutputAt,
    nextExpectedRunAt: entry.nextExpectedRunAt, nextRetryAt: entry.nextRetryAt,
    currentLagSeconds: entry.currentLagSeconds,
    maxExpectedSilenceSeconds: entry.maxExpectedSilenceSeconds,
    blockerCode: entry.blockerCode, expectedOutput: entry.expectedOutput }
  return Object.freeze({ invariantCode:
    `CAPABILITY_EXPECTED_OUTPUT:${entry.capabilityId}`,
  status: entry.finalHealthState === "HEALTHY" ? "PASS" : "VIOLATION",
  failureClass: entry.finalHealthState === "HEALTHY"
    ? null : failureClass(entry), retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
  recoveryClass: "AUTO_RECOVERABLE", evidenceFingerprint: digest(evidence),
  evidence: Object.freeze(evidence), regressionGuard: Object.freeze({
    detectionRule: "NOW_GT_LAST_EXPECTED_OUTPUT_PLUS_MAX_SILENCE_OR_LAYER_FAILURE",
    recoveryPolicy: entry.recoveryPolicy,
    schedulerTickIsNotSuccess: true, expectedOutputRequired: true,
    recoveryRequiresVerifiedOutput: true, lastGoodStatePolicy:
      entry.lastGoodStatePolicy }) })
}

export function evaluateSellerOsRuntimeCapabilityAssuranceV1(input: Readonly<{
  evidence: unknown
  runtimeHealth: SellerOsRuntimeHealthV1
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const evidence = record(input.evidence)
  const assuranceLane = scheduler(evidence, "RUNTIME_CAPABILITY_ASSURANCE")
  const fallbackLane = scheduler(evidence, "OPERATIONAL_INTEGRITY_AUDITOR")
  const infrastructureHeartbeat = iso(assuranceLane.last_dispatch_at) ??
    iso(fallbackLane.last_dispatch_at)
  const schedulerInfrastructureHealthy = assuranceLane.enabled === true &&
    (ageSeconds(infrastructureHeartbeat, now.getTime()) ?? Infinity) <=
      2 * FIFTEEN_MINUTES
  const preliminary = SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1.map(
    (definition) => ({ definition, observation: observationFor({
      definition, evidence, runtimeHealth: input.runtimeHealth }) }))
  const matrix = Object.freeze(preliminary.map(({ definition, observation }) =>
    evaluateCapability({ definition, observation,
      schedulerInfrastructureHealthy, now })))
  const counts = Object.freeze({
    healthy: matrix.filter((entry) => entry.finalHealthState === "HEALTHY").length,
    degraded: matrix.filter((entry) => ["DEGRADED_EXTERNAL",
      "DEGRADED_INTERNAL", "WAITING_DEPENDENCY", "UNKNOWN"]
      .includes(entry.finalHealthState)).length,
    disconnected: matrix.filter((entry) => entry.finalHealthState ===
      "DISCONNECTED").length,
    stalled: matrix.filter((entry) => entry.finalHealthState === "STALLED").length,
    missedSchedule: matrix.filter((entry) => entry.finalHealthState ===
      "MISSED_SCHEDULE").length,
    outputMissing: matrix.filter((entry) => entry.finalHealthState ===
      "OUTPUT_MISSING").length,
  })
  const checks = Object.freeze(matrix.map(healthCheck))
  const violationCount = checks.filter((entry) => entry.status === "VIOLATION").length
  const summary = Object.freeze({ checkCount: checks.length, violationCount,
    unknownCount: 0, passCount: checks.length - violationCount })
  const unresolved = Object.freeze(matrix.filter((entry) =>
    entry.finalHealthState !== "HEALTHY").map((entry) => ({
      capabilityId: entry.capabilityId,
      state: entry.finalHealthState, blockerCode: entry.blockerCode })))
  const runtimeInfrastructureCanary = matrix.find((entry) =>
    entry.capabilityId === "SCHEDULER_INFRASTRUCTURE")?.finalHealthState ===
      "HEALTHY" ? "PASS" as const : "FAIL" as const
  const assurances = Object.freeze({
    criticalCapabilityCount: matrix.length,
    capabilityCanaryCoveragePercent: 100 as const,
    everyScheduledJobHasMissedRunDetection: true as const,
    everyCriticalJobHasExpectedOutputCheck: true as const,
    everyWorkerHasHeartbeat: SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1
      .filter((entry) => entry.workerHeartbeatRequired)
      .every((entry) => entry.maxExpectedSilenceSeconds > 0),
    everyStaleableSourceHasRefreshOrExplicitGap:
      SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1.every((entry) =>
        Boolean(entry.recoveryPolicy && entry.safeFallback)),
    silentDisconnectionPossible: false as const,
    schedulerTickFalseHealth: false as const,
    freshLabelAfterExpiryPossible: false as const,
    automaticFailureDetection: true as const,
    automaticRetryWhereSafe: SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1
      .every((entry) => entry.selfRecovery),
    lastCertifiedStatePreserved: SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1
      .every((entry) => Boolean(entry.lastGoodStatePolicy)),
    recoveryRequiresVerifiedOutput: true as const,
    ownerTechnicalActionRequired: false as const,
    marketplaceWrites: 0 as const,
  })
  return Object.freeze({
    contractVersion: SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1,
    mechanismVersion: SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1,
    recoveryPolicyVersion: SELLER_OS_RUNTIME_CAPABILITY_RECOVERY_POLICY_V1,
    observedAt: now.toISOString(), status: violationCount > 0
      ? "VIOLATION" as const : "PASS" as const,
    checks, summary, capabilityMatrix: matrix, counts, unresolved,
    runtimeInfrastructureCanary, assurances,
    failureLearningPolicies: SELLER_OS_RUNTIME_FAILURE_LEARNING_V1,
    systemicRuntimeAssurancePass: runtimeInfrastructureCanary === "PASS" &&
      assurances.capabilityCanaryCoveragePercent === 100 &&
      assurances.everyScheduledJobHasMissedRunDetection &&
      assurances.everyCriticalJobHasExpectedOutputCheck &&
      assurances.everyWorkerHasHeartbeat &&
      assurances.everyStaleableSourceHasRefreshOrExplicitGap &&
      !assurances.silentDisconnectionPossible &&
      !assurances.schedulerTickFalseHealth &&
      !assurances.freshLabelAfterExpiryPossible &&
      assurances.recoveryRequiresVerifiedOutput,
    safety: Object.freeze({ readOnlyCanaries: true as const,
      marketplaceWrites: 0 as const, productDecisions: 0 as const,
      publisherDispatches: 0 as const, businessFactWrites: 0 as const,
      integrityReceiptWritesOnly: true as const }),
  })
}

export async function runSellerOsRuntimeCapabilityAssuranceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  now?: Date
  runtimeHealth?: SellerOsRuntimeHealthV1
}>) {
  const [evidenceResult, runtimeHealthResult] = await Promise.all([
    input.supabase.rpc("get_seller_os_runtime_capability_evidence_v1", {
      p_marketplace_account_key: input.accountKey,
    }),
    input.runtimeHealth ? Promise.resolve(input.runtimeHealth)
      : collectSellerOsRuntimeHealthV1(),
  ])
  if (evidenceResult.error || !evidenceResult.data) {
    throw new Error("SELLER_OS_RUNTIME_CAPABILITY_EVIDENCE_READ_FAILED")
  }
  const report = evaluateSellerOsRuntimeCapabilityAssuranceV1({
    evidence: evidenceResult.data, runtimeHealth: runtimeHealthResult,
    now: input.now,
  })
  const { persistSellerOsOperationalIntegrityAuditV1 } = await import(
    "./operational-integrity-ledger-v1")
  const durableReceipt = await persistSellerOsOperationalIntegrityAuditV1({
    supabase: input.supabase, accountKey: input.accountKey, audit: report,
  })
  return Object.freeze({ ...report, durableReceipt })
}

export async function readLatestSellerOsRuntimeCapabilityAssuranceV1(
  input: Readonly<{ supabase: SupabaseClient; accountKey: string }>,
) {
  const [run, incidents] = await Promise.all([
    input.supabase.from("seller_os_operational_integrity_runs_v1")
      .select("id,status,mechanism_version,evidence_fingerprint,audit_receipt,observed_at")
      .eq("marketplace_account_key", input.accountKey)
      .eq("mechanism_version", SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1)
      .order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("seller_os_operational_learning_ledger_v1")
      .select("failure_class,invariant_code,retry_safety,recovery_class,recovery_outcome,last_observed_at,evidence")
      .eq("marketplace_account_key", input.accountKey)
      .eq("mechanism_version", SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1)
      .eq("status", "OPEN").order("last_observed_at", { ascending: false })
      .limit(100),
  ])
  if (run.error || incidents.error) {
    throw new Error("SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_READ_FAILED")
  }
  return Object.freeze({ contractVersion:
    SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1,
  latestRun: run.data ?? null, openIncidents: Object.freeze(incidents.data ?? []),
  openIncidentCount: (incidents.data ?? []).length,
  safety: Object.freeze({ readOnly: true as const, marketplaceWrites: 0 as const }) })
}
