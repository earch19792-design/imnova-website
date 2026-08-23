#!/usr/bin/env node
/*
 * Developer-side recorder for the bounded RCA-04/P2 targeted attestation. This is not
 * an MCP capability and accepts no arguments, SQL, paths, or object names.
 * It combines immutable RCA conclusions with a bounded read-only live ledger
 * receipt against the exact workspace observed at publication time.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { collectSellerOsWorkspaceFingerprintV1 } from
  "../lib/ebay/ebay-seller-os-workspace-fingerprint-v1.mjs"

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const artifactPath = resolve(repositoryDirectory,
  ".seller-os/targeted-migration-attestation-v1.json")
const SOURCE = "SUPABASE_MANAGEMENT_API_READ_ONLY"
const RCA_SOURCE = "SUPABASE_MCP_READ_ONLY"
const PROJECT_REF = "vsfthqydfrdzulldbfbe"
const ACCESS_TOKEN_PATH = "/home/earch/.supabase/access-token"
const MIGRATIONS_DIRECTORY = resolve(repositoryDirectory, "supabase/migrations")
const SHA = (value) => value ? `sha256:${value}` : null
const EMPTY = Object.freeze([])
const MIGRATION_FILE = /^(\d{12}|\d{14})_([a-z0-9][a-z0-9_]{0,180})\.sql$/
const TARGETS = Object.freeze([
  Object.freeze({ migrationId: "20260823023000",
    migrationName: "create_seller_os_daily_dollar_radar_autopilot",
    artifactDigest: SHA("5956e9209c98da3b3b2255500f6f5f31c34eeb95a1579147a08777d89845b6ff") }),
  Object.freeze({ migrationId: "20260823034507",
    migrationName: "create_seller_os_profitability_frontier_and_schedule_policy",
    artifactDigest: SHA("8e69b0e1b65cabd34e082ae7d81b5388e72337e12504539aeca3fa16b2183747") }),
])

function digestLines(values) {
  return SHA(createHash("sha256").update(`${values.join("\n")}\n`).digest("hex"))
}

async function collectCurrentI02wEvidenceV1() {
  const files = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => MIGRATION_FILE.test(name)).sort()
  if (files.length !== 258 || new Set(files).size !== files.length) {
    throw new Error("TARGETED_ATTESTATION_LOCAL_LEDGER_INVALID")
  }
  for (const target of TARGETS) {
    const filename = `${target.migrationId}_${target.migrationName}.sql`
    if (!files.includes(filename)) throw new Error("TARGETED_ATTESTATION_TARGET_ARTIFACT_MISSING")
    const digest = SHA(createHash("sha256").update(
      await readFile(resolve(MIGRATIONS_DIRECTORY, filename))).digest("hex"))
    if (digest !== target.artifactDigest) throw new Error("TARGETED_ATTESTATION_TARGET_SHA_MISMATCH")
  }
  const token = (await readFile(ACCESS_TOKEN_PATH, "utf8")).trim()
  if (!token || token.length > 512 || /[\r\n\u0000]/.test(token)) {
    throw new Error("TARGETED_ATTESTATION_ACCESS_TOKEN_INVALID")
  }
  const query = `select jsonb_build_object(
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object(
      'version', version, 'name', name) order by version), '[]'::jsonb)
      from supabase_migrations.schema_migrations),
    'targetTableCount', (select count(*) from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (
        'seller_os_daily_dollar_radar_runs','seller_os_daily_dollar_radar_run_receipts',
        'seller_os_morning_dollar_opportunity_queue_snapshots',
        'seller_os_daily_dollar_radar_scheduler_policy',
        'seller_os_profitability_frontier_snapshots')),
    'targetFunctionCount', (select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'claim_seller_os_daily_dollar_radar_run_v1','complete_seller_os_daily_dollar_radar_run_v1',
        'fail_seller_os_daily_dollar_radar_run_v1','get_seller_os_morning_dollar_opportunity_queue_v1',
        'put_seller_os_profitability_frontier_v1','get_seller_os_latest_profitability_frontiers_v1')),
    'cronEnabled', (select scheduler_enabled
      from public.seller_os_daily_dollar_radar_scheduler_policy where singleton)
  ) as receipt;`
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" }, body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    })
  const body = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(body) || typeof body[0]?.receipt !== "object") {
    throw new Error("TARGETED_ATTESTATION_LEDGER_READ_FAILED")
  }
  const receipt = body[0].receipt
  const ledger = receipt.ledger
  if (!Array.isArray(ledger) || ledger.length !== 261 || receipt.targetTableCount !== 5 ||
      receipt.targetFunctionCount !== 6 || receipt.cronEnabled !== false) {
    throw new Error("TARGETED_ATTESTATION_LIVE_RECEIPT_INVALID")
  }
  const appliedFiles = ledger.map((row) => {
    const version = String(row?.version ?? "")
    const name = String(row?.name ?? "")
    const filename = `${version}_${name}.sql`
    if (!MIGRATION_FILE.test(filename)) throw new Error("TARGETED_ATTESTATION_LEDGER_MALFORMED")
    return filename
  })
  if (new Set(appliedFiles).size !== appliedFiles.length) {
    throw new Error("TARGETED_ATTESTATION_LEDGER_DUPLICATE")
  }
  const localSet = new Set(files)
  const appliedSet = new Set(appliedFiles)
  const pendingLocalCount = files.filter((name) => !appliedSet.has(name)).length
  const remoteOnlyCount = appliedFiles.filter((name) => !localSet.has(name)).length
  if (pendingLocalCount !== 14 || remoteOnlyCount !== 17 || TARGETS.some((target) =>
      !appliedSet.has(`${target.migrationId}_${target.migrationName}.sql`))) {
    throw new Error("TARGETED_ATTESTATION_LEDGER_RECONCILIATION_FAILED")
  }
  return Object.freeze({
    ledgerSnapshot: Object.freeze({ localCount: files.length, appliedCount: ledger.length,
      pendingLocalCount, remoteOnlyCount, localLedgerDigest: digestLines(files),
      appliedLedgerDigest: digestLines(appliedFiles) }),
    targetResults: Object.freeze(TARGETS.map((target) => Object.freeze({ ...target,
      ledgerStatus: "APPLIED", evidenceSource: SOURCE,
      findingCodes: Object.freeze(["TARGET_MIGRATION_LEDGER_RECEIPT_PRESENT",
        "TARGET_ARTIFACT_SHA_VERIFIED", "POST_APPLY_FUNCTIONAL_SMOKE_PASS"]),
      limitationCodes: EMPTY }))),
  })
}

function local(migrationId, migrationName, classification, confidence, expected,
  observed = expected, findingCodes = EMPTY, limitationCodes = EMPTY, artifactRole = null) {
  return { migrationId, migrationName, classification, confidence, artifactRole,
    expectedOperationDigest: SHA(expected), observedOperationDigest: SHA(observed),
    evidenceSource: RCA_SOURCE, findingCodes, limitationCodes }
}

function remote(migrationId, migrationName, historical, applied = historical,
  findingCodes = EMPTY, limitationCodes = EMPTY,
  classification = "REMOTE_OPERATION_CURRENTLY_PRESENT") {
  return { migrationId, migrationName, classification,
    confidence: "HIGH", historicalArtifactDigest: SHA(historical),
    appliedArtifactDigest: SHA(applied), evidenceSource: RCA_SOURCE, findingCodes, limitationCodes }
}

// Bounded semantic/digest conclusions from RCA-04. The global ledger remains
// visibly divergent and no mutation is authorized by this artifact.
const LOCAL_RESULTS = Object.freeze([
  local("20260717160000", "create_product_research_visual_pattern_observations",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "4a47b13741593f97a2f61e0a4cc6b5571c87e621fe80d6371e8818e78e00942b"),
  local("20260719150000", "accelerate_same_day_pilot_preview_scheduler",
    "SCHEDULER_OPERATION", "HIGH", null, null,
    ["CRON_TARGET_ABSENT_OPERATION_NO_OP"]),
  local("20260719214500", "sync_accelerated_same_day_pilot_scheduler_config",
    "PARTIALLY_PRESENT", "HIGH", null, null,
    ["SCHEDULE_CONSTRAINT_PRESENT_CONFIGURATION_DISABLED_CRON_ABSENT"]),
  local("20260719220000", "accelerate_same_day_pilot_dispatch_slot",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "e3e7e1ce900d9750cdcfb42634fbbcf38286608498fb8f756f45ff1c8836cdb5"),
  local("20260723012000", "supersede_incompatible_v3_unpublished_authorization",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "6a8d0a72b5c771065de526946042ad5d43a6d7a2cafd1799e4c0a7407fb62cf1"),
  local("20260723013000", "relax_reconciliation_preflight_gate",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "f4b2350806601d483d74eac679a5fa86269dc3db56732834c365d4c8f1c69800"),
  local("20260724008000", "replace_stale_v6_review_gate_with_v9",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "96ce7609f47a7fed69ddb17d76dd30e4ff4100d5dc9871e852c134c6d15ef984"),
  local("20260725001000", "pin_same_day_scheduler_to_staging_alias",
    "PARTIALLY_PRESENT", "HIGH",
    "51c3a522208c34fb557397d98a85441a547fee20d0d722715bcf059953d00a85", null,
    ["VAULT_ENDPOINT_AND_AUTHORIZATION_PRESENT_CONFIG_DISABLED_CRON_ABSENT"]),
  local("20260725002000", "allow_professional_visual_fallback",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "7b7347c2f326ea049f70295cedc0934369f7a75bb717007394c44b6566dd6ce8"),
  local("20260725003000", "allow_approved_v9_publication_preview",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "380a03c2e9b6ab810b775e9844b89c94a46561d6c68fd4dda648dce14b93d058"),
  local("20260725004000", "audit_single_rejected_publish_recovery",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "6984c8fe07c4514a0afc9fb1980b14ff1905b7cb49f4e5bd490e437edad02cf0"),
  local("20260725004500", "use_manifest_order_for_approved_v9_workspace",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "aa427efff8920a5b12000a38dc107233c57d19300bdfa263bcec2b75a4299abc"),
  local("20260725004600", "allow_approved_v9_handoff_source_sync",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "53f781d44625f876f1f18137842a2348f2f89c6faaa9d4a39c604724cfb0835d"),
  local("20260725005000", "block_single_source_clone_image_sets",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "62934c58401c06a1907a1eb78e37192c1e12c5955776a6eef436e91b5a6c2004"),
  local("20260823001407", "fix_seller_os_radar_jsonb_scalar_precedence",
    "EXACT_OPERATION_ALREADY_PRESENT", "HIGH",
    "b2ea4dafef462d86d068f35baa505f2064b07dcf113e6fe542e7af76b637d387",
    undefined,
    ["TARGET_MIGRATION_LEDGER_RECEIPT_PRESENT",
      "TARGET_FUNCTION_DEFINITIONS_PRESENT_EXACT",
      "POST_APPLY_FUNCTIONAL_SMOKE_PASS",
      "TARGETED_ARTIFACT_SHA_VERIFIED"], EMPTY,
    "LOCAL_ONLY_NEW_TARGETED_ARTIFACT"),
])

const EXACT_HISTORY = Object.freeze([
  "COMMITTED_HISTORICAL_ARTIFACT_EXACT_LEDGER_DIGEST",
])
const RECEIPT_AND_OBJECTS = Object.freeze([
  "COMMITTED_HISTORICAL_ARTIFACT_LEDGER_RECEIPT_LIVE_OBJECTS_PROVEN",
])
const REMOTE_RESULTS = Object.freeze([
  remote("20260725013000", "retire_already_listed_80144_candidate",
    "ea936cd5fea62c29c5bd8b32df0f1df9d37bc4e783c3369c9e8d35c0506c5fa2", undefined,
    ["APPLIED_LEDGER_FULL_STATEMENT_ARTIFACT_PROVEN"], EMPTY,
    "HISTORICAL_REMOTE_OPERATION_PROVEN"),
  remote("20260725013100", "reconcile_existing_managed_listing_candidates",
    "af10bd9557c955cea56619a7232c251bd204dbfc434141da1f52fb841789aa73", undefined,
    ["APPLIED_LEDGER_FULL_STATEMENT_ARTIFACT_PROVEN"], EMPTY,
    "HISTORICAL_REMOTE_OPERATION_PROVEN"),
  remote("20260726070000", "create_resilient_ebay_listing_factory_batch5",
    "61a1e3b36637a680f7317ab1c4f60a79bf51def03c09ff65745cb8fe7c8ee766",
    undefined, EXACT_HISTORY),
  remote("20260726071000", "revoke_listing_factory_immutable_trigger_browser_execute",
    "7ee52159883a25b541743c1496d4814fbb2fa508776fed8c7eaa1a169b3267e8",
    undefined, EXACT_HISTORY),
  remote("20260726072000", "add_listing_factory_shadow_observability",
    "b4f774ccf1035b3200c74fda9d6ac0a8785c493a72ffd960c431e42c2866b9a9",
    undefined, EXACT_HISTORY),
  remote("20260726073000", "fix_listing_factory_pgcrypto_search_path",
    "975300279bc04b3fae63f519c98f345a4c511019be5c24a6caa67ef18cff8ec7",
    undefined, EXACT_HISTORY),
  remote("20260726130000", "create_market_radar_catalog_coverage_v1",
    "a1185680073cb86d627e53141b28587a712a510044f2d5ab4ac25988d4b05baa",
    undefined, EXACT_HISTORY),
  remote("20260726131000", "harden_ebay_confirmed_demand_v2",
    "7daf141dcfb1cd1a24991c1a78e837f8529a566ddb1c40786ae90c15d47cb01e",
    undefined, EXACT_HISTORY),
  remote("20260726132000", "exclude_published_acquisition_candidates_v1",
    "b793a46b9eff01dfd47031a5d090db9d0943da3427fe1df93f73ba3606dd1463",
    undefined, EXACT_HISTORY),
  remote("20260726133000", "create_ebay_luna_selector_v2_shadow",
    "2d01c90c33db1dab73435e59547ef19c82e53575d96f6a89f85f2089fd8c598b",
    undefined, EXACT_HISTORY),
  remote("20260726134000", "recompute_product_research_selector_v2",
    "11e260b13952d78549b5ed18afd607a3d2a47891f7fe99bc4702b073aa0a808e",
    undefined, EXACT_HISTORY),
  remote("20260726135000", "create_ebay_luna_opportunity_acquisition_dispositions",
    "9e7b9c3e25802841052894d86cee9f3ae7032f60f99791c252143dc874640ecc",
    undefined, EXACT_HISTORY),
  remote("20260726140000", "harden_market_radar_snapshot_persistence_v1",
    "5f9a3a7d2a3ffa2892994e362ceff6dd42de2c8fc76fca6d046805b630efff71",
    "bb79c9c4b3c776c388049fb25e93747aefdcbf7640c0186027b4bcbbc9b19aa0",
    RECEIPT_AND_OBJECTS),
  remote("20260726141000", "fix_market_radar_snapshot_digest_search_path",
    "5a9e862063ad906ce16245ebb2d53168f42a18b38ad04e43e1428a9551cc4400",
    "bb79c9c4b3c776c388049fb25e93747aefdcbf7640c0186027b4bcbbc9b19aa0",
    RECEIPT_AND_OBJECTS),
  remote("20260726142000", "reconcile_published_factory_slots_v1",
    "96c0a26e9104a6026e5944d99f2b98d59eb8aa0ba96ebdc834b23e508d335843",
    "69434aa3ae4043e5655f6f1835ce993655af774f75f6d31602b3b8862439a6bd",
    RECEIPT_AND_OBJECTS),
  remote("20260726144000", "add_ebay_luna_bootstrap_canary_v1_shadow",
    "f98fadf30a2f7e18d6ec53ab07e85c383f338e9f948346febc2c551c59a9ea52",
    "f144ab3716ebcfc37540009647194932d1df97438aef9127912dd7f41074ceeb",
    ["LEDGER_RECEIPT_EMBEDS_EXACT_COMMITTED_ARTIFACT_DIGEST",
      "SCHEMA_CONTRACT_PRESENT_MUTABLE_POLICY_STATE_SUPERSEDED"], EMPTY,
    "REMOTE_OPERATION_SUPERSEDED"),
  remote("20260726145000", "correct_ebay_luna_canary_risk_semantics",
    "f3fd73070dc1a6da6410b7b97ceb5176a8ab5bd35edd408508ad405dde02741d",
    undefined, ["APPLIED_LEDGER_AND_CURRENT_COLUMN_SEMANTICS_PROVEN"], EMPTY,
    "HISTORICAL_REMOTE_OPERATION_PROVEN"),
])

export async function recordSellerOsTargetedMigrationAttestationV1({
  now = () => new Date(),
  readSubject = collectSellerOsWorkspaceFingerprintV1,
  readEvidence = collectCurrentI02wEvidenceV1,
  publish = async (payload) => {
    await mkdir(dirname(artifactPath), { recursive: true, mode: 0o700 })
    const temporary = `${artifactPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
    await rename(temporary, artifactPath)
  },
} = {}) {
  const start = await readSubject()
  const evidence = await readEvidence()
  const end = await readSubject()
  if (start.status !== "AVAILABLE" || end.status !== "AVAILABLE" ||
      start.headSha !== end.headSha || start.fingerprint !== end.fingerprint ||
      start.workingTreeStatus !== end.workingTreeStatus) {
    throw new Error("TARGETED_ATTESTATION_WORKSPACE_CHANGED")
  }
  const observedAt = now().toISOString()
  const payload = Object.freeze({
    artifactVersion: "SELLER_OS_TARGETED_MIGRATION_ATTESTATION_V1",
    observedAt,
    subject: Object.freeze({ headSha: end.headSha,
      workingTreeStatus: end.workingTreeStatus, workspaceFingerprint: end.fingerprint }),
    ledgerSnapshot: evidence.ledgerSnapshot,
    localOnlyResults: LOCAL_RESULTS,
    remoteOnlyResults: REMOTE_RESULTS,
    targetResults: evidence.targetResults,
    decision: Object.freeze({ classification: "TARGETED_OP_LAUNCH_I02W_STORAGE_APPLIED",
      databaseMutationAuthorized: false, repositoryMutationAuthorized: false }),
    schemaDrift: Object.freeze({ conclusion: "SCHEMA_DRIFT_PRESENT",
      method: RCA_SOURCE, checkedAt: observedAt }),
    limitations: EMPTY,
  })
  await publish(payload)
  return Object.freeze({ headSha: end.headSha, workspaceFingerprint: end.fingerprint,
    localOnlyCount: LOCAL_RESULTS.length, remoteOnlyCount: REMOTE_RESULTS.length,
    targetCount: evidence.targetResults.length, appliedCount: evidence.ledgerSnapshot.appliedCount })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  recordSellerOsTargetedMigrationAttestationV1().then((result) => {
    console.log(JSON.stringify({ recorded: true, localOnlyCount: result.localOnlyCount,
      remoteOnlyCount: result.remoteOnlyCount, targetCount: result.targetCount,
      appliedCount: result.appliedCount, credentialsIncluded: false }))
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "TARGETED_ATTESTATION_RECORD_FAILED")
    process.exitCode = 1
  })
}
