import assert from "node:assert/strict"
import test from "node:test"

import { loadBoundAuthoritativeFactPackage } from "./ebay-authoritative-fact-package.ts"
import { bindCurrentAuthoritativeFactsForManualHandoff } from "./ebay-same-day-manual-handoff.ts"
import {
  AUTHORITATIVE_FACT_SOURCE_POLICY,
  OPENAI_FACTS_INPUT_VERSION,
  productFactsHash,
} from "./ebay-product-facts-readiness.ts"

const now = new Date("2026-07-18T12:00:00.000Z")
const binding = {
  queueRunId: "00000000-0000-4000-8000-000000000010",
  decisionPackageId: "00000000-0000-4000-8000-000000000020",
  decisionPackageHash: `sha256:${"a".repeat(64)}`,
}

function authoritativePackage() {
  const fact = (scope, key, value, sourceTypes = ["LUNA_EXACT_VARIANT"],
    verificationStatus = "VERIFIED", resolutionRule = "FIELD_AUTHORITY_MATRIX") => ({
    scope, key, value, unit: null, verificationStatus, sourceTypes, resolutionRule,
  })
  const facts = [
    fact("PRODUCT_UNIT", "exactProductName", "Example Product"),
    fact("PRODUCT_UNIT", "brand", "Example"), fact("PRODUCT_UNIT", "condition", "New"),
    fact("OFFER_PACK", "offerPackCount", 3), fact("OFFER_PACK", "unitsPerPack", 1),
    fact("OFFER_PACK", "totalUnitCount", 3, ["INTERNAL_DERIVATION"],
      "DERIVED_VERIFIED", "AUTHORIZED_DERIVATION"),
  ].sort((left, right) => `${left.scope}:${left.key}`.localeCompare(`${right.scope}:${right.key}`))
  const hashInput = { version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY, facts }
  return { ready: true, facts, version: OPENAI_FACTS_INPUT_VERSION,
    sourcePolicy: AUTHORITATIVE_FACT_SOURCE_POLICY,
    factPackageHash: productFactsHash(hashInput), openAiCalls: 0, blockedReason: null }
}

function supabaseFixture(overrides = {}) {
  const packageValue = authoritativePackage()
  const rows = {
    marketplace_product_fact_readiness_events: {
      id: "00000000-0000-4000-8000-000000000030",
      fact_run_id: "00000000-0000-4000-8000-000000000040",
      ready: true, decision_package_id: binding.decisionPackageId,
      decision_package_hash: binding.decisionPackageHash,
      authoritative_facts_package: packageValue,
      authoritative_facts_package_hash: packageValue.factPackageHash,
      authoritative_facts_expires_at: "2026-07-19T12:00:00.000Z",
    },
    marketplace_product_fact_runs: {
      id: "00000000-0000-4000-8000-000000000040", queue_run_id: binding.queueRunId,
      status: "COMPLETED", completed_at: "2026-07-18T11:59:00.000Z",
    },
    marketplace_product_fact_run_evidence_links: {
      id: "00000000-0000-4000-8000-000000000050",
    },
    ...overrides,
  }
  const calls = []
  const supabase = { from(table) {
    calls.push(table)
    const query = {
      select() { return query }, eq() { return query }, order() { return query }, limit() { return query },
      async maybeSingle() { return { data: rows[table] ?? null, error: null } },
    }
    return query
  } }
  return { supabase, calls }
}

test("only a current decision-bound, unexpired and evidence-linked fact package loads", async () => {
  const fixture = supabaseFixture()
  const result = await loadBoundAuthoritativeFactPackage({ supabase: fixture.supabase,
    accountKey: "account", itemId: "item", binding, now })
  assert.equal(result?.package.factPackageHash, authoritativePackage().factPackageHash)
  assert.deepEqual(fixture.calls, ["marketplace_product_fact_readiness_events",
    "marketplace_product_fact_runs", "marketplace_product_fact_run_evidence_links"])
})

test("a later false, stale-package, expired, wrong-run or unlinked event cannot authorize", async () => {
  for (const overrides of [
    { marketplace_product_fact_readiness_events: { ...supabaseFixtureRows().event, ready: false } },
    { marketplace_product_fact_readiness_events: {
      ...supabaseFixtureRows().event, decision_package_hash: `sha256:${"b".repeat(64)}` } },
    { marketplace_product_fact_readiness_events: {
      ...supabaseFixtureRows().event, authoritative_facts_expires_at: "2026-07-18T11:00:00.000Z" } },
    { marketplace_product_fact_runs: { ...supabaseFixtureRows().run,
      queue_run_id: "00000000-0000-4000-8000-000000000099" } },
    { marketplace_product_fact_run_evidence_links: null },
  ]) {
    const fixture = supabaseFixture(overrides)
    assert.equal(await loadBoundAuthoritativeFactPackage({ supabase: fixture.supabase,
      accountKey: "account", itemId: "item", binding, now }), null)
  }
})

test("manual handoff rejects an unbound run/hash and replaces stale summary JSON with the current DB package", async () => {
  const fixture = supabaseFixture()
  const current = await loadBoundAuthoritativeFactPackage({ supabase: fixture.supabase,
    accountKey: "account", itemId: "item", binding, now })
  const summary = { factRunId: current.factRunId, currentRunBound: true,
    authoritativeFactsPackage: { staleStatusOnlyPayload: true }, gates: { OPENAI_INPUT_READY: true } }
  const rebound = bindCurrentAuthoritativeFactsForManualHandoff({ factsSummary: summary,
    boundFacts: current })
  assert.equal(rebound.authoritativeFactsPackage.factPackageHash,
    authoritativePackage().factPackageHash)
  assert.equal("staleStatusOnlyPayload" in rebound.authoritativeFactsPackage, false)

  assert.throws(() => bindCurrentAuthoritativeFactsForManualHandoff({
    factsSummary: { ...summary, factRunId: "00000000-0000-4000-8000-000000000099" },
    boundFacts: current,
  }), /SAME_DAY_PILOT_AUTHORITATIVE_FACT_PACKAGE_STALE/)

  const wrongHashBinding = { ...binding, decisionPackageHash: `sha256:${"b".repeat(64)}` }
  const unbound = await loadBoundAuthoritativeFactPackage({ supabase: supabaseFixture().supabase,
    accountKey: "account", itemId: "item", binding: wrongHashBinding, now })
  assert.equal(unbound, null)
  assert.throws(() => bindCurrentAuthoritativeFactsForManualHandoff({
    factsSummary: summary, boundFacts: unbound,
  }), /SAME_DAY_PILOT_AUTHORITATIVE_FACT_PACKAGE_STALE/)
})

function supabaseFixtureRows() {
  const packageValue = authoritativePackage()
  return {
    event: { id: "00000000-0000-4000-8000-000000000030",
      fact_run_id: "00000000-0000-4000-8000-000000000040", ready: true,
      decision_package_id: binding.decisionPackageId, decision_package_hash: binding.decisionPackageHash,
      authoritative_facts_package: packageValue, authoritative_facts_package_hash: packageValue.factPackageHash,
      authoritative_facts_expires_at: "2026-07-19T12:00:00.000Z" },
    run: { id: "00000000-0000-4000-8000-000000000040", queue_run_id: binding.queueRunId,
      status: "COMPLETED", completed_at: "2026-07-18T11:59:00.000Z" },
  }
}
