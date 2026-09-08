import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createProductCaseReadBudgetV1, type ProductCaseReadBudgetV1 } from "./product-case-read-budget-v1"

export const KEYWORD_DECISION_VERSION = "PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1"
export const KEYWORD_READ_VERSION = "PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1"
export type KeywordBindingV1 = Readonly<{
  ACCOUNT_KEY: string; PRODUCT_ID: string; VARIANT_ID: string
  CANDIDATE_KEY: string; OPPORTUNITY_ID: string; PLAN_ID?: string
}>
type RecordValue = Record<string, unknown>
export function keywordRecord(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : {}
}
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`
// Transport integrity only; the authenticated SQL reader validates source freshness.
export function keywordWireDigestV1(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, x]) => [k, ordered(x)])) : v
  return hash(JSON.stringify(ordered(value)))
}
export function unavailableKeywordReadV1(blocker: string) {
  return { READ_CONTRACT_VERSION: KEYWORD_READ_VERSION, STATUS: "UNAVAILABLE",
    BLOCKERS: [blocker], DECISION: null, KEYWORD_RECOMPUTATIONS: 0, DATABASE_WRITES: 0 }
}
export function decodeKeywordReadV1(value: unknown) {
  const raw = keywordRecord(value)
  if (typeof raw.DECISION_SERIALIZED !== "string") return raw
  const validation = keywordRecord(raw.VALIDATION)
  if (Buffer.byteLength(raw.DECISION_SERIALIZED) > 1_500_000 ||
      hash(raw.DECISION_SERIALIZED) !== validation.DECISION_DIGEST) {
    return unavailableKeywordReadV1("KEYWORD_DECISION_TRANSPORT_DIGEST_INVALID")
  }
  try {
    const decision: unknown = JSON.parse(raw.DECISION_SERIALIZED)
    const { DECISION_SERIALIZED: serialized, ...rest } = raw
    void serialized
    return { ...rest, DECISION: decision, VALIDATION: { ...validation,
      TRANSPORT_DIGEST: keywordWireDigestV1({ BINDING: raw.BINDING, DECISION: decision }) } }
  } catch { return unavailableKeywordReadV1("KEYWORD_DECISION_MALFORMED") }
}
export async function readKeywordDecisionHandoffV1(input: {
  supabase: SupabaseClient; binding: KeywordBindingV1; budget?: ProductCaseReadBudgetV1
}) {
  const b = input.binding
  if (![b.ACCOUNT_KEY, b.PRODUCT_ID, b.VARIANT_ID, b.CANDIDATE_KEY, b.OPPORTUNITY_ID]
    .every(x => typeof x === "string" && x.length > 0 && x.length <= 240)) {
    return unavailableKeywordReadV1("KEYWORD_BINDING_REQUIRED")
  }
  const budget = input.budget ?? createProductCaseReadBudgetV1()
  try {
    const result = await budget.read({ dependency: "KEYWORD_INTELLIGENCE",
      authority: "marketplace_product_research_query_plans.keyword_intelligence_decision",
      query: () => input.supabase.rpc("read_product_research_keyword_handoff_v1", {
        p_account_key: b.ACCOUNT_KEY, p_product_id: b.PRODUCT_ID, p_variant_id: b.VARIANT_ID,
        p_candidate_key: b.CANDIDATE_KEY, p_opportunity_id: b.OPPORTUNITY_ID,
        p_plan_id: b.PLAN_ID ?? null,
      }) })
    return result.error ? unavailableKeywordReadV1("KEYWORD_AUTHORITY_READ_UNAVAILABLE")
      : decodeKeywordReadV1(result.data)
  } catch {
    return unavailableKeywordReadV1("KEYWORD_AUTHORITY_READ_UNAVAILABLE")
  } finally { if (!input.budget) budget.close() }
}

// Lossless Listing Package acceptance receipt. Never derives a keyword or title.
export function consumeListingPackageKeywordHandoffV1(value: unknown, expected: KeywordBindingV1) {
  const read = keywordRecord(value), d = keywordRecord(read.DECISION)
  const binding = keywordRecord(read.BINDING), validation = keywordRecord(read.VALIDATION)
  const blockers: string[] = []
  if (read.READ_CONTRACT_VERSION !== KEYWORD_READ_VERSION) blockers.push("KEYWORD_READ_VERSION_UNSUPPORTED")
  if (d.DECISION_VERSION !== KEYWORD_DECISION_VERSION) blockers.push("KEYWORD_DECISION_VERSION_UNSUPPORTED")
  if (!binding.PLAN_ID || !Object.entries(expected).every(([k, v]) =>
    typeof v === "string" && v.length > 0 && binding[k] === v)) blockers.push("KEYWORD_BINDING_MISMATCH")
  if (validation.CURRENT_INPUTS_MATCH !== true) blockers.push("KEYWORD_DECISION_STALE_OR_UNVALIDATED")
  if (validation.TRANSPORT_DIGEST !== keywordWireDigestV1({ BINDING: read.BINDING, DECISION: read.DECISION })) {
    blockers.push("KEYWORD_DECISION_TRANSPORT_DIGEST_INVALID")
  }
  const authorityFingerprint = d.INPUT_AUTHORITY_FINGERPRINT
  if (typeof authorityFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(authorityFingerprint) ||
    d.INPUT_FINGERPRINT !== hash(`[${JSON.stringify(KEYWORD_DECISION_VERSION)}, ${JSON.stringify(authorityFingerprint)}]`)) {
    blockers.push("KEYWORD_DECISION_FINGERPRINT_INVALID")
  }
  const classes = ["PRIMARY_KEYWORD", "CORE_QUALIFIERS", "SEMANTIC_EXPANSIONS", "SECONDARY_KEYWORDS", "REJECTED_TERMS"]
  const terms = Array.isArray(d.TERMS) ? d.TERMS.map(keywordRecord) : []
  if (!Array.isArray(d.TERMS) || terms.some(t => typeof t.TERM !== "string" || !classes.includes(String(t.CLASSIFICATION)))) {
    blockers.push("KEYWORD_DECISION_SCHEMA_INVALID")
  }
  const originalBlockers = Array.isArray(read.BLOCKERS) ? read.BLOCKERS.map(String) : ["KEYWORD_READ_BLOCKERS_MISSING"]
  blockers.push(...originalBlockers)
  if (read.STATUS !== "READY" || d.KEYWORD_DECISION_READY !== true ||
    !Array.isArray(d.BLOCKERS) || d.BLOCKERS.length > 0 || d.PRIMARY_KEYWORD === "UNPROVEN") {
    blockers.push("KEYWORD_DECISION_UNPROVEN")
  }
  const primary = terms.filter(t => t.CLASSIFICATION === "PRIMARY_KEYWORD")
  if (d.KEYWORD_DECISION_READY === true && (primary.length !== 1 || primary[0].TERM !== d.PRIMARY_KEYWORD)) {
    blockers.push("KEYWORD_PRIMARY_CONTRACT_INVALID")
  }
  return Object.freeze({ HANDOFF_CONTRACT_VERSION: "LISTING_PACKAGE_KEYWORD_HANDOFF_V1",
    STATUS: blockers.length === 0 ? "ACCEPTED" : "BLOCKED",
    DECISION_VERSION: d.DECISION_VERSION ?? null, INPUT_FINGERPRINT: d.INPUT_FINGERPRINT ?? null,
    BINDING: read.BINDING ?? null, BLOCKERS: [...new Set(blockers)],
    CLASSIFICATIONS: Object.fromEntries(classes.map(c => [c, terms.filter(t => t.CLASSIFICATION === c).map(t => t.TERM)])),
    DECISION_PATH: "KEYWORD_INTELLIGENCE.DECISION", LEGACY_FALLBACK_USED: false,
    KEYWORD_RECOMPUTATIONS: 0, TITLES_GENERATED: 0, PACKAGE_WRITES: 0 })
}
