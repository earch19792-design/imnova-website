import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_VERSION,
  type SellerOsOperationalIntegrityCheckV1,
} from "./operational-integrity-auditor-v1"

type OperationalAuditV1 = Readonly<{
  contractVersion: string
  mechanismVersion: string
  recoveryPolicyVersion: string
  observedAt: string
  status: "PASS" | "VIOLATION" | "UNKNOWN"
  checks: readonly SellerOsOperationalIntegrityCheckV1[]
  summary: Readonly<{ checkCount: number; violationCount: number;
    unknownCount: number; passCount: number }>
  safety: Readonly<Record<string, unknown>>
}>

function rows(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : []
}

function overallFingerprint(audit: OperationalAuditV1) {
  const evidence = [...audit.checks].sort((left, right) =>
    left.invariantCode.localeCompare(right.invariantCode)).map((entry) => ({
      invariantCode: entry.invariantCode,
      status: entry.status,
      evidenceFingerprint: entry.evidenceFingerprint,
    }))
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(evidence)).digest("hex")}`
}

function initialOutcome(check: SellerOsOperationalIntegrityCheckV1) {
  if (check.recoveryClass === "ENGINEERING_REQUIRED") {
    return "ENGINEERING_REQUIRED"
  }
  if (check.recoveryClass === "OWNER_COMMERCIAL") return "OWNER_REQUIRED"
  return "OBSERVED"
}

export async function persistSellerOsOperationalIntegrityAuditV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  audit: OperationalAuditV1
}>) {
  const fingerprint = overallFingerprint(input.audit)
  const runWrite = await input.supabase.from(
    "seller_os_operational_integrity_runs_v1").upsert({
      marketplace_account_key: input.accountKey,
      mechanism_version: input.audit.mechanismVersion,
      evidence_fingerprint: fingerprint,
      status: input.audit.status,
      check_count: input.audit.summary.checkCount,
      violation_count: input.audit.summary.violationCount,
      unknown_count: input.audit.summary.unknownCount,
      audit_receipt: input.audit,
      observed_at: input.audit.observedAt,
    }, { onConflict:
      "marketplace_account_key,mechanism_version,evidence_fingerprint",
    }).select("id").single()
  if (runWrite.error) {
    throw new Error("SELLER_OS_OPERATIONAL_INTEGRITY_RUN_PERSIST_FAILED")
  }

  const violations = input.audit.checks.filter((entry) =>
    entry.status === "VIOLATION")
  for (const entry of violations) {
    const insert = await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").upsert({
        marketplace_account_key: input.accountKey,
        failure_class: entry.failureClass,
        invariant_code: entry.invariantCode,
        mechanism_version: input.audit.mechanismVersion,
        evidence_fingerprint: entry.evidenceFingerprint,
        recovery_policy_version: input.audit.recoveryPolicyVersion,
        retry_safety: entry.retrySafety,
        recovery_class: entry.recoveryClass,
        recovery_outcome: initialOutcome(entry),
        regression_guard: entry.regressionGuard,
        evidence: entry.evidence,
        status: "OPEN",
        first_observed_at: input.audit.observedAt,
        last_observed_at: input.audit.observedAt,
        resolved_at: null,
      }, { onConflict:
        "marketplace_account_key,invariant_code,evidence_fingerprint,mechanism_version",
        ignoreDuplicates: true,
      }).select("id").maybeSingle()
    if (insert.error) {
      throw new Error("SELLER_OS_OPERATIONAL_LEARNING_INSERT_FAILED")
    }
    const touch = await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").update({
        failure_class: entry.failureClass,
        recovery_policy_version: input.audit.recoveryPolicyVersion,
        retry_safety: entry.retrySafety,
        recovery_class: entry.recoveryClass,
        regression_guard: entry.regressionGuard,
        evidence: entry.evidence,
        status: "OPEN",
        last_observed_at: input.audit.observedAt,
        resolved_at: null,
        updated_at: input.audit.observedAt,
      }).eq("marketplace_account_key", input.accountKey)
      .eq("invariant_code", entry.invariantCode)
      .eq("evidence_fingerprint", entry.evidenceFingerprint)
      .eq("mechanism_version", input.audit.mechanismVersion)
    if (touch.error) {
      throw new Error("SELLER_OS_OPERATIONAL_LEARNING_TOUCH_FAILED")
    }
    const superseded = await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").update({
        status: "RESOLVED",
        recovery_outcome: "STILL_VIOLATED",
        resolved_at: input.audit.observedAt,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: input.audit.observedAt,
      }).eq("marketplace_account_key", input.accountKey)
      .eq("invariant_code", entry.invariantCode)
      .eq("mechanism_version", input.audit.mechanismVersion)
      .eq("status", "OPEN")
      .neq("evidence_fingerprint", entry.evidenceFingerprint)
    if (superseded.error) {
      throw new Error("SELLER_OS_OPERATIONAL_LEARNING_SUPERSEDE_FAILED")
    }
  }

  const passedCodes = input.audit.checks.filter((entry) =>
    entry.status === "PASS").map((entry) => entry.invariantCode)
  if (passedCodes.length > 0) {
    const resolved = await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").update({
        status: "RESOLVED",
        recovery_outcome: "RECOVERED",
        resolved_at: input.audit.observedAt,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: input.audit.observedAt,
      }).eq("marketplace_account_key", input.accountKey)
      .eq("mechanism_version", input.audit.mechanismVersion)
      .eq("status", "OPEN").in("invariant_code", passedCodes)
    if (resolved.error) {
      throw new Error("SELLER_OS_OPERATIONAL_LEARNING_RESOLVE_FAILED")
    }
  }

  return Object.freeze({ runId: String(runWrite.data.id), fingerprint,
    violationReceiptCount: violations.length })
}

export async function recoverSellerOsOperationalIntegrityV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  audit: OperationalAuditV1
  reRead: () => Promise<OperationalAuditV1>
}>) {
  const workerId = `seller-os-integrity:${randomUUID()}`
  const recoverable = input.audit.checks.filter((entry) =>
    entry.status === "VIOLATION" &&
    entry.recoveryClass === "AUTO_RECOVERABLE")
  const claims: { check: SellerOsOperationalIntegrityCheckV1;
    ledgerId: string }[] = []
  for (const entry of recoverable) {
    const claimed = await input.supabase.rpc(
      "claim_seller_os_operational_integrity_v1", {
        p_marketplace_account_key: input.accountKey,
        p_invariant_code: entry.invariantCode,
        p_evidence_fingerprint: entry.evidenceFingerprint,
        p_mechanism_version: input.audit.mechanismVersion,
        p_worker_id: workerId,
        p_lease_seconds: 120,
      })
    if (claimed.error) {
      throw new Error("SELLER_OS_OPERATIONAL_INTEGRITY_CLAIM_FAILED")
    }
    const row = rows(claimed.data)[0]
    if (row?.claimed === true && typeof row.ledger_id === "string") {
      claims.push({ check: entry, ledgerId: row.ledger_id })
    }
  }
  if (claims.length === 0) return Object.freeze({
    claimedCount: 0, recoveredCount: 0, stillViolatedCount: 0,
    readOnlyReconciliationCount: 0, marketplaceWrites: 0 as const,
  })

  const readback = await input.reRead()
  let recoveredCount = 0
  for (const claim of claims) {
    const current = readback.checks.find((entry) =>
      entry.invariantCode === claim.check.invariantCode)
    const resolved = current?.status === "PASS"
    const finish = await input.supabase.rpc(
      "finish_seller_os_operational_integrity_v1", {
        p_ledger_id: claim.ledgerId,
        p_worker_id: workerId,
        p_invariant_resolved: resolved,
      })
    if (finish.error || finish.data !== true) {
      throw new Error("SELLER_OS_OPERATIONAL_INTEGRITY_FINISH_FAILED")
    }
    if (resolved) recoveredCount += 1
  }
  await persistSellerOsOperationalIntegrityAuditV1({
    supabase: input.supabase, accountKey: input.accountKey, audit: readback,
  })
  return Object.freeze({ claimedCount: claims.length, recoveredCount,
    stillViolatedCount: claims.length - recoveredCount,
    readOnlyReconciliationCount: 1 as const,
    marketplaceWrites: 0 as const })
}

export async function readLatestSellerOsOperationalIntegrityV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const [run, open] = await Promise.all([
    input.supabase.from("seller_os_operational_integrity_runs_v1")
      .select("id,status,mechanism_version,evidence_fingerprint,audit_receipt,observed_at")
      .eq("marketplace_account_key", input.accountKey)
      .eq("mechanism_version", SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_VERSION)
      .order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("seller_os_operational_learning_ledger_v1")
      .select("failure_class,invariant_code,retry_safety,recovery_class,recovery_outcome,last_observed_at")
      .eq("marketplace_account_key", input.accountKey)
      .eq("mechanism_version", SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_VERSION)
      .eq("status", "OPEN")
      .order("last_observed_at", { ascending: false }).limit(100),
  ])
  if (run.error || open.error) {
    throw new Error("SELLER_OS_OPERATIONAL_INTEGRITY_READ_FAILED")
  }
  return Object.freeze({
    contractVersion: SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_VERSION,
    latestRun: run.data ?? null,
    openViolations: Object.freeze(open.data ?? []),
    openViolationCount: (open.data ?? []).length,
    safety: Object.freeze({ readOnly: true as const, marketplaceWrites: 0 }),
  })
}
