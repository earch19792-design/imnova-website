import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  SELLER_OS_RUNTIME_CATALOG_ATTESTATION_VERSION,
  SELLER_OS_RUNTIME_CATALOG_IDENTITY_V1,
  SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION,
  SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1,
  createUnavailableSellerOsRuntimeHealthV1,
  type SellerOsRuntimeHealthV1,
} from "../ebay/ebay-seller-os-runtime-health-v1"
import type { SellerOsOperationalIntegrityCheckV1 } from
  "./operational-integrity-auditor-v1"
import { persistSellerOsOperationalIntegrityAuditV1 } from
  "./operational-integrity-ledger-v1"

export const SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1 =
  SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION
export const SELLER_OS_RUNTIME_HEALTH_AUTHORITY_MAX_SILENCE_SECONDS_V1 = 180

const SERVICE_STATES = new Set(["HEALTHY", "DEGRADED", "FAILED", "UNAVAILABLE"])
const PORT_STATES = new Set(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null
}

function validIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function validRuntimeHealthV1(value: unknown): value is SellerOsRuntimeHealthV1 {
  const root = record(value)
  const services = record(root.services)
  const mcp = record(services.mcp)
  const tunnel = record(services.tunnel)
  const watchdogTimer = record(services.watchdogTimer)
  const port = record(root.port3000)
  const watchdog = record(root.watchdog)
  const catalog = record(root.runtimeCatalog)
  const safety = record(root.safety)
  return root.contractVersion === SELLER_OS_RUNTIME_HEALTH_CONTRACT_VERSION &&
    validIso(root.observedAt) && SERVICE_STATES.has(String(root.overallStatus)) &&
    mcp.service === SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.mcpService &&
    tunnel.service === SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.tunnelService &&
    watchdogTimer.service ===
      SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.watchdogTimer &&
    SERVICE_STATES.has(String(mcp.status)) &&
    SERVICE_STATES.has(String(tunnel.status)) &&
    SERVICE_STATES.has(String(watchdogTimer.status)) &&
    port.host === SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.host &&
    port.port === SELLER_OS_RUNTIME_HEALTH_INSPECTION_SCOPE_V1.port &&
    PORT_STATES.has(String(port.status)) && validIso(port.observedAt) &&
    (watchdog.lastRunAt === null || validIso(watchdog.lastRunAt)) &&
    (watchdog.lastSuccessAt === null || validIso(watchdog.lastSuccessAt)) &&
    catalog.contractVersion === SELLER_OS_RUNTIME_CATALOG_ATTESTATION_VERSION &&
    catalog.serviceIdentity ===
      SELLER_OS_RUNTIME_CATALOG_IDENTITY_V1.serviceIdentity &&
    catalog.runtimeEntrypointIdentity ===
      SELLER_OS_RUNTIME_CATALOG_IDENTITY_V1.runtimeEntrypointIdentity &&
    catalog.runtimeWorkingDirectoryIdentity ===
      SELLER_OS_RUNTIME_CATALOG_IDENTITY_V1.runtimeWorkingDirectoryIdentity &&
    ["COMPLETE", "PARTIAL", "UNAVAILABLE"].includes(
      String(root.evidenceCompleteness)) &&
    safety.readOnly === true && safety.marketplaceWrites === 0 &&
    safety.inventoryWrites === 0 && safety.productCaseMutations === 0 &&
    safety.lunaLinkMutations === 0 && safety.whatsappSends === 0
}

export function parseSellerOsRuntimeHealthAuthorityV1(value: unknown) {
  if (!validRuntimeHealthV1(value)) return null
  return value
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

type ObservationStateV1 = "PROVEN_HEALTHY" | "PROVEN_FAILED" | "UNOBSERVABLE"

function serviceObservationState(status: string): ObservationStateV1 {
  if (status === "HEALTHY") return "PROVEN_HEALTHY"
  if (status === "FAILED") return "PROVEN_FAILED"
  return "UNOBSERVABLE"
}

function check(input: Readonly<{
  invariantCode: string
  state: ObservationStateV1
  evidence: Readonly<Record<string, unknown>>
}>): SellerOsOperationalIntegrityCheckV1 {
  const failureClass = input.state === "PROVEN_FAILED"
    ? "RUNTIME_SERVICE_DISCONNECTED" : null
  const stableEvidence = Object.fromEntries(Object.entries(input.evidence)
    .filter(([key]) => !["observedAt", "lastSuccessAt"].includes(key)))
  return Object.freeze({ invariantCode: input.invariantCode,
    status: input.state === "PROVEN_HEALTHY" ? "PASS"
      : input.state === "PROVEN_FAILED" ? "VIOLATION" : "UNKNOWN",
    failureClass, retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
    recoveryClass: "AUTO_RECOVERABLE",
    evidenceFingerprint: sha256({ invariantCode: input.invariantCode,
      state: input.state, evidence: stableEvidence }),
    evidence: input.evidence,
    regressionGuard: Object.freeze({
      authority: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
      unobservableNotFailed: true,
      recoveryRequiresVerifiedOutput: true,
    }) })
}

export function buildSellerOsRuntimeHealthAuthorityAuditV1(
  runtimeHealth: SellerOsRuntimeHealthV1,
) {
  const observable = runtimeHealth.evidenceCompleteness !== "UNAVAILABLE"
  const mcpState = observable ? serviceObservationState(
    runtimeHealth.services.mcp.status) : "UNOBSERVABLE"
  const tunnelState = observable ? serviceObservationState(
    runtimeHealth.services.tunnel.status) : "UNOBSERVABLE"
  const watchdogState = observable ? serviceObservationState(
    runtimeHealth.services.watchdogTimer.status) : "UNOBSERVABLE"
  const portState: ObservationStateV1 = !observable ? "UNOBSERVABLE"
    : runtimeHealth.port3000.status ===
      "AVAILABLE" ? "PROVEN_HEALTHY"
    : runtimeHealth.port3000.status === "UNAVAILABLE" ? "PROVEN_FAILED"
      : "UNOBSERVABLE"
  const catalogState: ObservationStateV1 = !observable ? "UNOBSERVABLE" :
    runtimeHealth.runtimeCatalog.exactCatalogMatch === true
      ? "PROVEN_HEALTHY"
      : runtimeHealth.runtimeCatalog.exactCatalogMatch === false
        ? "PROVEN_FAILED" : "UNOBSERVABLE"
  const bindingState: ObservationStateV1 = !observable ? "UNOBSERVABLE" :
    runtimeHealth.runtimeCatalog.workspaceRuntimeBindingStatus === "MATCHED"
      ? "PROVEN_HEALTHY"
      : runtimeHealth.runtimeCatalog.workspaceRuntimeBindingStatus === "MISMATCHED"
        ? "PROVEN_FAILED" : "UNOBSERVABLE"
  const checks = Object.freeze([
    check({ invariantCode: "RUNTIME_HEALTH:MCP", state: mcpState,
      evidence: Object.freeze({ authority: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
        value: runtimeHealth.services.mcp.status,
        observedAt: runtimeHealth.observedAt }) }),
    check({ invariantCode: "RUNTIME_HEALTH:TUNNEL", state: tunnelState,
      evidence: Object.freeze({ authority: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
        value: runtimeHealth.services.tunnel.status,
        observedAt: runtimeHealth.observedAt }) }),
    check({ invariantCode: "RUNTIME_HEALTH:WATCHDOG", state: watchdogState,
      evidence: Object.freeze({ authority: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
        value: runtimeHealth.services.watchdogTimer.status,
        lastSuccessAt: runtimeHealth.watchdog.lastSuccessAt,
        observedAt: runtimeHealth.observedAt }) }),
    check({ invariantCode: "RUNTIME_HEALTH:PORT_3000", state: portState,
      evidence: Object.freeze({ authority: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
        value: runtimeHealth.port3000.status,
        observedAt: runtimeHealth.observedAt }) }),
    check({ invariantCode: "RUNTIME_HEALTH:RUNTIME_CATALOG", state: catalogState,
      evidence: Object.freeze({ authority: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
        value: runtimeHealth.runtimeCatalog.exactCatalogMatch,
        runtimeCatalogCount: runtimeHealth.runtimeCatalog.runtimeCatalogCount,
        expectedCatalogCount: runtimeHealth.runtimeCatalog.expectedCatalogCount,
        observedAt: runtimeHealth.observedAt }) }),
    check({ invariantCode: "RUNTIME_HEALTH:WORKSPACE_BINDING", state: bindingState,
      evidence: Object.freeze({ authority: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
        value: runtimeHealth.runtimeCatalog.workspaceRuntimeBindingStatus,
        observedAt: runtimeHealth.observedAt }) }),
  ])
  const violationCount = checks.filter((entry) =>
    entry.status === "VIOLATION").length
  const unknownCount = checks.filter((entry) => entry.status === "UNKNOWN").length
  return Object.freeze({
    contractVersion: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
    mechanismVersion: SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1,
    recoveryPolicyVersion: "SELLER_OS_RUNTIME_HEALTH_RECOVERY_POLICY_V1",
    observedAt: runtimeHealth.observedAt,
    status: violationCount > 0 ? "VIOLATION" as const
      : unknownCount > 0 ? "UNKNOWN" as const : "PASS" as const,
    checks,
    summary: Object.freeze({ checkCount: checks.length, violationCount,
      unknownCount, passCount: checks.length - violationCount - unknownCount }),
    runtimeHealth,
    safety: Object.freeze({ readOnlyCanary: true as const,
      marketplaceWrites: 0 as const, businessFactWrites: 0 as const,
      integrityReceiptWritesOnly: true as const }),
  })
}

export async function persistSellerOsRuntimeHealthAuthorityV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  runtimeHealth: unknown
  now?: Date
}>) {
  const parsed = parseSellerOsRuntimeHealthAuthorityV1(input.runtimeHealth)
  if (!parsed) throw new Error("SELLER_OS_RUNTIME_HEALTH_AUTHORITY_INVALID")
  const now = input.now ?? new Date()
  const observedAt = Date.parse(parsed.observedAt)
  if (observedAt > now.getTime() + 30_000 ||
      now.getTime() - observedAt > 10 * 60 * 1_000) {
    throw new Error("SELLER_OS_RUNTIME_HEALTH_AUTHORITY_NOT_CURRENT")
  }
  const audit = buildSellerOsRuntimeHealthAuthorityAuditV1(parsed)
  const receipt = await persistSellerOsOperationalIntegrityAuditV1({
    supabase: input.supabase, accountKey: input.accountKey, audit,
  })
  return Object.freeze({ runtimeHealth: parsed, durableReceipt: receipt })
}

export async function readLatestSellerOsRuntimeHealthAuthorityV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const result = await input.supabase.from(
    "seller_os_operational_integrity_runs_v1")
    .select("id,audit_receipt,observed_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("mechanism_version", SELLER_OS_RUNTIME_HEALTH_AUTHORITY_V1)
    .order("observed_at", { ascending: false }).limit(1).maybeSingle()
  if (result.error) {
    throw new Error("SELLER_OS_RUNTIME_HEALTH_AUTHORITY_READ_FAILED")
  }
  const runtimeHealth = parseSellerOsRuntimeHealthAuthorityV1(
    record(result.data?.audit_receipt).runtimeHealth)
  return Object.freeze({ runtimeHealth: runtimeHealth ??
    createUnavailableSellerOsRuntimeHealthV1(), receiptId: result.data?.id ?? null,
  observedAt: stringOrNull(result.data?.observed_at) })
}
