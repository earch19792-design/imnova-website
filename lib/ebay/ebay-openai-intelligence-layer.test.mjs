import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildEbayOpenAiFixtureOutput,
  buildEbayOpenAiInvocationManifest,
  compareEbayOpenAiShadowAgainstGroundTruth,
  ebayOpenAiIntelligenceHash,
  executeEbayOpenAiShadowUseCase,
  InMemoryEbayOpenAiIntelligenceRepository,
  runEbayOpenAiFiveProductShadowFixture,
  selectEbayOpenAiModel,
} from "./ebay-openai-intelligence-gateway.ts"

const policy = {
  enabled: true,
  killSwitchEngaged: false,
  mode: "SHADOW",
  dailyBudgetMicros: 100_000,
  monthlyBudgetMicros: 100_000,
  perProductBudgetMicros: 20_000,
  perUseCaseDailyBudgetMicros: 100_000,
  perInvocationBudgetMicros: 20_000,
  circuitFailureThreshold: 2,
  allowSingleAdvancedEscalation: true,
}
const router = {
  ECONOMY: "fixture-economy",
  BALANCED: "fixture-balanced",
  ADVANCED: "fixture-advanced",
  IMAGE: "fixture-image",
  EMBEDDING: "fixture-embedding",
}
const evidenceRef = "fixture:evidence:1"
const base = {
  useCaseId: "DOSSIER_DISTILLATION",
  productRef: "fixture-product-1",
  dossierHash: ebayOpenAiIntelligenceHash("dossier-1"),
  payload: {
    productRef: "fixture-product-1",
    dossierHash: ebayOpenAiIntelligenceHash("dossier-1"),
    facts: { packCount: 1 },
    evidence: [{ ref: evidenceRef }],
  },
  availableEvidenceRefs: [evidenceRef],
  estimatedCostMicros: 1_000,
  policy,
  router,
}

function transport(output = buildEbayOpenAiFixtureOutput({
  useCaseId: "DOSSIER_DISTILLATION",
  evidenceRef,
})) {
  return {
    calls: 0,
    async invoke() {
      this.calls += 1
      return {
        requestId: "fixture-request",
        output,
        usage: {
          inputTokens: 100,
          cachedInputTokens: 10,
          cacheWriteTokens: 0,
          outputTokens: 80,
        },
      }
    },
  }
}

test("1. manifest includes only allowlisted paths and no raw content", () => {
  const manifest = buildEbayOpenAiInvocationManifest(base)
  assert.ok(manifest.includedPaths.includes("facts.packCount"))
  assert.equal(manifest.rawPromptPersisted, false)
  assert.equal(manifest.rawResponsePersisted, false)
  assert.doesNotMatch(JSON.stringify(manifest), /fixture-product-1/)
})

test("2. a secret is rejected before transport", async () => {
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    payload: { ...base.payload, facts: { apiKey: "sk-test-secret-value" } },
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: transport(),
  })
  assert.equal(result.status, "BLOCKED")
  assert.equal(result.errorCode, "OPENAI_INTELLIGENCE_FORBIDDEN_FIELD")
})

test("3. PII is rejected before transport", async () => {
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    payload: { ...base.payload, facts: { note: "buyer@example.com" } },
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: transport(),
  })
  assert.equal(result.status, "BLOCKED")
  assert.equal(result.errorCode, "OPENAI_INTELLIGENCE_FORBIDDEN_VALUE")
})

test("4. an invented claim without evidence is rejected", async () => {
  const output = buildEbayOpenAiFixtureOutput({
    useCaseId: "DOSSIER_DISTILLATION", evidenceRef,
  })
  output.result.candidateClaims = [{ text: "Invented claim", evidenceRefs: [] }]
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: transport(output),
  })
  assert.equal(result.errorCode, "OPENAI_INTELLIGENCE_UNSUPPORTED_CLAIM")
})

test("5. an incorrect comparable class cannot advance", async () => {
  const comparableOutput = buildEbayOpenAiFixtureOutput({
    useCaseId: "COMPARABLE_CLASSIFICATION",
    evidenceRef,
    classification: "NOT_A_COMPARABLE_CLASS",
  })
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    useCaseId: "COMPARABLE_CLASSIFICATION",
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: transport(comparableOutput),
  })
  assert.equal(result.status, "DETERMINISTIC_FALLBACK")
  assert.equal(result.effects.stateMutations, 0)
})

test("6. an output outside the strict schema is rejected", async () => {
  const output = {
    ...buildEbayOpenAiFixtureOutput({
      useCaseId: "DOSSIER_DISTILLATION", evidenceRef,
    }),
    unexpected: true,
  }
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: transport(output),
  })
  assert.equal(result.errorCode, "OPENAI_INTELLIGENCE_OUTPUT_SCHEMA_INVALID")
})

test("7. a nonexistent evidence reference is rejected", async () => {
  const output = buildEbayOpenAiFixtureOutput({
    useCaseId: "DOSSIER_DISTILLATION",
    evidenceRef: "missing:evidence",
  })
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: transport(output),
  })
  assert.equal(result.errorCode, "OPENAI_INTELLIGENCE_EVIDENCE_REFERENCE_INVALID")
})

test("8. budget above the configured cap blocks the call", async () => {
  const provider = transport()
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    estimatedCostMicros: 20_001,
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: provider,
  })
  assert.equal(result.errorCode, "OPENAI_INTELLIGENCE_BUDGET_BLOCKED")
  assert.equal(provider.calls, 0)
})

test("9. equal calls are deduplicated", async () => {
  const repository = new InMemoryEbayOpenAiIntelligenceRepository()
  const provider = transport()
  const first = await executeEbayOpenAiShadowUseCase({
    ...base, repository, transport: provider,
  })
  const second = await executeEbayOpenAiShadowUseCase({
    ...base, repository, transport: provider,
  })
  assert.equal(first.status, "SHADOW_COMPLETED")
  assert.equal(second.status, "DEDUPE_HIT")
  assert.equal(provider.calls, 1)
})

test("10-12. one timeout is isolated and the other four continue", async () => {
  const result = await runEbayOpenAiFiveProductShadowFixture({
    timeoutProductIndex: 3,
  })
  assert.equal(result.products, 5)
  assert.equal(result.completed, 4)
  assert.equal(result.isolated, 1)
  assert.equal(result.realOpenAiCalls, 0)
})

test("11. repeated global failure opens the circuit", async () => {
  const result = await runEbayOpenAiFiveProductShadowFixture({
    globalOutageProductIndexes: [1, 2, 3, 4, 5],
  })
  assert.equal(result.fixtureAdapterCalls, 2)
  assert.equal(result.results.slice(2).every((entry) =>
    entry.errorCode === "OPENAI_INTELLIGENCE_CIRCUIT_OPEN"), true)
})

test("13. optional use cases use deterministic fallback", async () => {
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: {
      async invoke() {
        throw new Error("OPENAI_INTELLIGENCE_PROVIDER_TIMEOUT")
      },
    },
  })
  assert.equal(result.status, "DETERMINISTIC_FALLBACK")
})

test("14-17. shadow cannot mutate critical state or perform effects", async () => {
  const result = await executeEbayOpenAiShadowUseCase({
    ...base,
    repository: new InMemoryEbayOpenAiIntelligenceRepository(),
    transport: transport(),
  })
  assert.deepEqual(result.effects, {
    stateMutations: 0,
    ebayWrites: 0,
    priceChanges: 0,
    stockChanges: 0,
    promotionsCreated: 0,
    listingsPublished: 0,
  })
})

test("18. shadow results compare against ground truth", () => {
  const output = buildEbayOpenAiFixtureOutput({
    useCaseId: "DOSSIER_DISTILLATION", evidenceRef,
  })
  assert.deepEqual(compareEbayOpenAiShadowAgainstGroundTruth({
    expectedAction: "OBSERVE",
    result: output,
  }), {
    comparable: true,
    actionMatch: true,
    schemaPass: true,
    evidenceReferencePass: true,
    externalEffects: 0,
  })
})

test("19. an economic model handles simple use cases", () => {
  assert.equal(selectEbayOpenAiModel({
    useCaseId: "DOSSIER_DISTILLATION",
    router,
    ambiguous: false,
    escalationCount: 0,
    allowSingleAdvancedEscalation: true,
  }).tier, "ECONOMY")
})

test("20. an ambiguous case escalates at most once", () => {
  const first = selectEbayOpenAiModel({
    useCaseId: "COMPARABLE_CLASSIFICATION",
    router,
    ambiguous: true,
    escalationCount: 0,
    allowSingleAdvancedEscalation: true,
  })
  const second = selectEbayOpenAiModel({
    useCaseId: "COMPARABLE_CLASSIFICATION",
    router,
    ambiguous: true,
    escalationCount: first.escalationCount,
    allowSingleAdvancedEscalation: true,
  })
  assert.equal(first.tier, "ADVANCED")
  assert.equal(second.tier, "ECONOMY")
})

test("21-22. result connects to dossier and keeps model/prompt/schema history", async () => {
  const repository = new InMemoryEbayOpenAiIntelligenceRepository()
  const result = await executeEbayOpenAiShadowUseCase({
    ...base, repository, transport: transport(),
  })
  const stored = repository.records.get(result.idempotencyKey)
  assert.equal(stored.dossierHash, base.dossierHash)
  assert.equal(stored.model, "fixture-economy")
  assert.match(stored.promptVersion, /DOSSIER_DISTILLATION_PROMPT_V1/)
  assert.equal(stored.schemaVersion, "OPENAI_INTELLIGENCE_OUTPUT_V1")
})

test("23. migration is additive, RLS-safe, idempotent and disabled by default", async () => {
  const sql = await readFile(
    "supabase/migrations/20260726074000_create_ebay_openai_intelligence_shadow_v1.sql",
    "utf8",
  )
  assert.match(sql, /create table if not exists public\.ebay_openai_use_case_configs/)
  assert.match(sql, /create unique index if not exists ebay_openai_invocations_idempotency_uidx/)
  assert.match(sql, /force row level security/i)
  assert.match(sql, /for update/i)
  assert.match(sql, /enabled, mode, kill_switch_engaged/)
  assert.match(sql, /false,'SHADOW',true/)
  assert.match(sql, /daily_budget_micros bigint not null default 0/)
  assert.match(sql, /raw_prompt_persisted boolean not null default false/)
  assert.match(sql, /raw_response_persisted boolean not null default false/)
  assert.match(sql, /revoke all on table public\.ebay_openai_invocations from anon, authenticated/)
  assert.match(sql, /create or replace function public\.reserve_ebay_openai_shadow_invocation_v1/)
})
