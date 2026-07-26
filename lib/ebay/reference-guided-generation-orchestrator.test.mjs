import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL("../../supabase/migrations/20260722008000_reference_guided_generation_orchestrator.sql", import.meta.url), "utf8")
const aclMigration = readFileSync(new URL("../../supabase/migrations/20260722017000_harden_reference_guided_orchestrator_acl.sql", import.meta.url), "utf8")
const exactMigration = readFileSync(new URL("../../supabase/migrations/20260722018000_exact_v3_manifest_and_atomic_provider_budget.sql", import.meta.url), "utf8")
const canaryMigration = readFileSync(new URL("../../supabase/migrations/20260722019000_single_job_reference_guided_canary.sql", import.meta.url), "utf8")
const factory = readFileSync(new URL("./ebay-listing-image-factory.ts", import.meta.url), "utf8")
const openAiTransport = readFileSync(new URL("../openai/openai-server-http-transport.ts", import.meta.url), "utf8")
const orchestrator = readFileSync(new URL("./reference-guided-generation-orchestrator.ts", import.meta.url), "utf8")
const route = readFileSync(new URL("../../app/api/admin/ebay/images/route.ts", import.meta.url), "utf8")

test("V3 persistent orchestrator migration is additive and fail-closed", () => {
  assert.doesNotMatch(migration, /\b(drop|truncate|delete\s+from)\b/i)
  assert.match(migration, /expected_job_count integer not null default 6 check \(expected_job_count = 6\)/)
  assert.match(migration, /unique \(generation_attempt_id, position\)/i)
  assert.match(migration, /limit greatest\(1, least\(p_limit,2\)\)/i)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /set search_path = public/i)
  assert.match(aclMigration, /force row level security/i)
  assert.match(aclMigration, /revoke all on table public\.ebay_reference_guided_generation_attempts from anon, authenticated/i)
  assert.match(aclMigration, /revoke all on table public\.ebay_reference_guided_generation_jobs from anon, authenticated/i)
  assert.match(aclMigration, /revoke all on table public\.ebay_reference_guided_generation_attempts from service_role[\s\S]*grant select, insert, update/i)
  assert.match(migration, /grant execute on function public\.claim_ebay_reference_guided_generation_jobs[\s\S]*to service_role/i)
  assert.match(migration, /ebay_writes integer not null default 0 check \(ebay_writes = 0\)/i)
})

test("known invalid attempt is permanent history and can never claim jobs", () => {
  assert.match(exactMigration, /a17327c6-c26c-49ef-8c64-4ea33d64ab1f/)
  assert.match(exactMigration, /SUPERSEDED_INVALID_MANIFEST/)
  assert.match(exactMigration, /PRODUCT_DOSSIER_HASH_NULL[\s\S]*MARKET_VISUAL_BRIEF_HASH_MISMATCH[\s\S]*PROMPT_HASH_NOT_EXACT_PROMPT/)
  assert.match(exactMigration, /if v_attempt\.status = 'SUPERSEDED_INVALID_MANIFEST'[\s\S]*REFERENCE_GUIDED_MANIFEST_PERMANENTLY_SUPERSEDED/i)
  assert.doesNotMatch(exactMigration, /update public\.ebay_reference_guided_generation_jobs[\s\S]{0,500}a17327c6/i)
})

test("exact manifest and atomic call budget are validated before HTTP", () => {
  assert.match(route, /productDossierHash: revisionRow\.product_dossier_hash/)
  assert.match(route, /marketVisualBriefHash: revisionRow\.market_visual_brief_hash/)
  assert.match(route, /p_composition_manifest_text: preparedManifest\.compositionManifestText/)
  assert.doesNotMatch(route, /createHash\("sha256"\)\.update\(`\$\{manifestHash}:\$\{role}/)
  assert.match(exactMigration, /convert_to\(v_job->>'exactPromptText', 'UTF8'\)/)
  assert.match(exactMigration, /for update[\s\S]*provider_calls < max_provider_calls[\s\S]*max_provider_calls = 6/i)
  assert.match(exactMigration, /status = 'PENDING'[\s\S]*limit v_available[\s\S]*for update skip locked/i)
  assert.match(exactMigration, /2 - v_active/)
  assert.match(exactMigration, /revoke all on function public\.create_ebay_reference_guided_generation_attempt\([\s\S]*service_role/i)
})

test("reference-guided provider request has one reserved HTTP call and no retry loop", () => {
  const request = factory.match(/export async function requestReferenceGuidedProductGeneration[\s\S]*?\n}\n\n\/\*\* Builds the fail-closed V3 provider contract/)?.[0] ?? ""
  assert.match(request, /plan\.jobs\.length !== 1/)
  assert.match(request, /sha256Text\(job\.prompt\) !== job\.promptHash/)
  assert.equal((request.match(/openAiServerFetch\(/g) ?? []).length, 1)
  assert.equal((openAiTransport.match(/input\.fetchImpl \?\? fetch/g) ?? []).length, 1)
  assert.doesNotMatch(request, /for \(let attempt|setTimeout|Retry-After/)
})

test("canary can claim only position 1 and reserve only one provider call", () => {
  assert.match(canaryMigration, /j\.position = 1[\s\S]*MATERIAL_AND_FINISH_DETAIL/)
  assert.match(canaryMigration, /j\.position between 2 and 6[\s\S]*j\.status <> 'PENDING'/)
  assert.match(canaryMigration, /provider_calls = 0[\s\S]*returning provider_calls/i)
  assert.match(canaryMigration, /if v_provider_calls <> 1/)
  assert.match(canaryMigration, /revoke execute on function public\.claim_ebay_reference_guided_generation_jobs[\s\S]*from service_role/i)
  assert.match(canaryMigration, /revoke execute on function public\.reserve_ebay_reference_guided_provider_call[\s\S]*from service_role/i)
  assert.match(orchestrator, /claimCanary\([\s\S]*jobs\.length !== 1[\s\S]*jobs\[0\]\?\.position !== 1/)
  assert.match(orchestrator, /reserveCanaryProviderCall[\s\S]*maximumProviderCalls: 1/)
})

test("controlled provider E2E runbook stays fail-closed", () => {
  const runbook = readFileSync(new URL("../../docs/seller-os/REFERENCE_GUIDED_V3_PROVIDER_E2E_RUNBOOK.md", import.meta.url), "utf8")
  assert.match(runbook, /MAX_PROVIDER_CALLS=6/)
  assert.match(runbook, /MAX_CONCURRENCY=2/)
  assert.match(runbook, /conservar todo trabajo `PASSED`/i)
  assert.match(runbook, /no reintentar automáticamente/i)
  assert.match(runbook, /OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED=false/)
  assert.match(runbook, /eBay writes: 0/i)
  assert.match(runbook, /productionChanged: false/i)
})
