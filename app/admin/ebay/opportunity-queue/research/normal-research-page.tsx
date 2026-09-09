"use client"

import { ArrowLeft, BarChart3, FlaskConical, Search, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Loop2Top20OpportunityPool } from "../../mobile-review/loop2-top20-opportunity-pool"
import { SmartStockingListingIntakeCard } from "./smart-stocking-listing-intake-card"
import { MayelMarketRevalidationRunner } from
  "./mayel-market-revalidation-runner"
import type { MarketOpportunityResearchV1 } from "@/lib/ebay/ebay-market-opportunity-research-v1"
import type { CommercialIntelligenceUpgradeV1, ItemIdCanonicalFamilyBridgeV1 } from
  "@/lib/ebay/ebay-commercial-intelligence-upgrade-v1"
import type { OfficialSoldEvidenceExport } from "@/lib/ebay/ebay-official-sold-evidence-import"
import { supabase } from "@/lib/supabase"

const seedTypes = [
  ["SEED_AUTO", "Automatic reconciliation"],
  ["SEED_QUERY", "Search term"],
  ["SEED_PRODUCT_TITLE", "Product title"],
  ["SEED_PRODUCT_FAMILY", "Product family"],
  ["SEED_ITEM_ID", "eBay Item ID"],
] as const

const CANONICAL_DECISION_SESSION_KEY = "seller_os_canonical_opportunity_v2"

type ResearchWithCommercialV2 = MarketOpportunityResearchV1 & {
  intelligenceV2: CommercialIntelligenceUpgradeV1
  itemIdBridge: ItemIdCanonicalFamilyBridgeV1 | null
  queryExecution: {
    mode: string
    maxQueries: number
    executedQueries: Array<{ query: string; path: string; status: string; returnedEvidence: number }>
    cacheAware: boolean
    deduplicated: boolean
    rateLimitAware: boolean
    sourceListingExcludedFromMarketEvidence: boolean
  }
}

const manualSources: Array<[OfficialSoldEvidenceExport, string]> = [
  ["EBAY_PRODUCT_RESEARCH_EXPORT", "eBay Product Research"],
  ["EBAY_MARKETPLACE_INSIGHTS_EXPORT", "Marketplace Insights"],
  ["EBAY_SELLER_HUB_EXPORT", "Seller Hub export"],
]

function metric(value: number | null, suffix = "") {
  return value === null ? "—" : `${value.toLocaleString()}${suffix}`
}

function statusTone(value: string) {
  if (value.startsWith("ADVANCE")) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
  if (value === "REJECT") return "border-rose-400/30 bg-rose-400/10 text-rose-200"
  return "border-amber-400/30 bg-amber-400/10 text-amber-100"
}

export default function MarketResearchPage() {
  const [seedType, setSeedType] = useState<(typeof seedTypes)[number][0]>("SEED_AUTO")
  const [seedValue, setSeedValue] = useState("")
  const [windowDays, setWindowDays] = useState<30 | 90 | 365>(90)
  const [manualEvidence, setManualEvidence] = useState("")
  const [manualFormat, setManualFormat] = useState<"CSV" | "JSON">("CSV")
  const [manualSource, setManualSource] = useState<OfficialSoldEvidenceExport>(
    "EBAY_PRODUCT_RESEARCH_EXPORT",
  )
  const [research, setResearch] = useState<ResearchWithCommercialV2 | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function runResearch() {
    setLoading(true)
    setError("")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/market-research", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request: {
            marketplace: "EBAY_US",
            seedType,
            seedValue,
            requestedWindowDays: windowDays,
            researchIntent: "OPPORTUNITY_VALIDATION",
            queryBudget: 3,
          },
          manualEvidence: manualEvidence.trim()
            ? { format: manualFormat, sourceExportType: manualSource, content: manualEvidence }
            : undefined,
        }),
      })
      const payload = await response.json() as {
        success?: boolean
        research?: ResearchWithCommercialV2
        error?: string
      }
      if (!response.ok || !payload.success || !payload.research) {
        throw new Error(payload.error ?? "MARKET_RESEARCH_READ_FAILED")
      }
      setResearch(payload.research)
      const canonical = payload.research.intelligenceV2.canonicalResult
      try {
        if (canonical.sourceItemId) {
          sessionStorage.setItem(CANONICAL_DECISION_SESSION_KEY, JSON.stringify({
            storedAt: new Date().toISOString(),
            canonicalResultVersion: canonical.versions.canonicalResultVersion,
            sourceItemId: canonical.sourceItemId,
            decisionIntegration: canonical.decisionIntegration,
            persistence: "PROTECTED_BROWSER_SESSION_ONLY",
          }))
        } else sessionStorage.removeItem(CANONICAL_DECISION_SESSION_KEY)
      } catch { /* Analysis remains usable when browser session storage is unavailable. */ }
    } catch (caught) {
      setResearch(null)
      setError(caught instanceof Error ? caught.message : "MARKET_RESEARCH_READ_FAILED")
    } finally {
      setLoading(false)
    }
  }

  const canonical = research?.intelligenceV2.canonicalResult ?? null

  return (
    <main className="min-h-screen bg-[#07111d] text-slate-100">
      <MayelMarketRevalidationRunner />
      <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <Link href="/admin/ebay/opportunity-queue" className="mb-3 inline-flex items-center gap-2 text-xs text-cyan-300 hover:text-cyan-200">
              <ArrowLeft className="h-3.5 w-3.5" /> Opportunities
            </Link>
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-cyan-400/10 p-2.5 text-cyan-300"><FlaskConical className="h-5 w-5" /></span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Market Opportunity Research</h1>
                <p className="mt-1 text-sm text-slate-400">Evidence-first family, comparable, keyword, price and competition research.</p>
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" /> 100% read-only
          </span>
        </header>

        <SmartStockingListingIntakeCard />

        <Loop2Top20OpportunityPool surface="opportunities">
        <div data-market-opportunity-research className="space-y-3">
        <section className="grid gap-4 rounded-2xl border border-white/10 bg-[#0b1826] p-4 lg:grid-cols-[minmax(260px,1fr)_auto]">
          <label className="text-xs text-slate-400">Product, title, family, search term, or eBay Item ID
            <input value={seedValue} onChange={(event) => setSeedValue(event.target.value)} maxLength={180} placeholder="Enter a research seed" className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#07111d] px-3 py-2.5 text-sm text-white placeholder:text-slate-600" />
          </label>
          <button onClick={runResearch} disabled={loading || seedValue.trim().length < 2} className="mt-auto inline-flex h-[42px] items-center justify-center gap-2 rounded-lg bg-cyan-400 px-5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
            <Search className="h-4 w-4" /> {loading ? "Analyzing…" : "Analyze Opportunity"}
          </button>
        </section>

        <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-300">Advanced Research ▾</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-[220px_150px_1fr]">
            <label className="text-xs text-slate-400">Research seed path
              <select value={seedType} onChange={(event) => setSeedType(event.target.value as typeof seedType)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm text-white">
                {seedTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">Requested window
              <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as 30 | 90 | 365)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm text-white">
                <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option>
              </select>
            </label>
            <p className="self-end pb-2 text-xs leading-5 text-slate-500">Automatic mode derives listing truth, canonical family, attributes, and bounded search paths. Select a path only when an analyst needs an explicit seed contract.</p>
          </div>
          <div className="mt-3 border-t border-white/10 pt-3">
            <p className="mb-2 text-xs font-medium text-slate-400">Approved manual sold-evidence import (optional)</p>
            <div className="grid gap-3 md:grid-cols-[110px_190px_1fr]">
            <select value={manualFormat} onChange={(event) => setManualFormat(event.target.value as "CSV" | "JSON")} className="rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm"><option>CSV</option><option>JSON</option></select>
            <select value={manualSource} onChange={(event) => setManualSource(event.target.value as OfficialSoldEvidenceExport)} className="rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm">{manualSources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <textarea value={manualEvidence} onChange={(event) => setManualEvidence(event.target.value)} placeholder="Paste an approved structured export. Buyer/order PII is rejected." rows={4} className="rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600" />
            </div>
          </div>
        </details>

        {error ? <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div> : null}

        {!research && !error ? (
          <section className="mt-6 grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center">
            <div className="max-w-md px-6"><BarChart3 className="mx-auto h-8 w-8 text-cyan-300" /><h2 className="mt-3 text-xl font-semibold">Start with market evidence</h2><p className="mt-2 text-sm leading-6 text-slate-400">Seller OS keeps active competition separate from verified sold evidence and never creates a Product Case from research alone.</p></div>
          </section>
        ) : null}

        {research && canonical ? (
          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.08] to-[#0b1826] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Commercial Recommendation V2 · Canonical result</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">{canonical.commercialRecommendation.productFamily ?? "Product family unproven"}</h2>
                  <p className="mt-1 text-xs text-slate-400">Canonical family confidence {canonical.commercialRecommendation.canonicalFamilyConfidence}% · {canonical.consensus.CONSENSUS_REASON}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(canonical.commercialRecommendation.finalDecision)}`}>
                  {canonical.commercialRecommendation.finalDecision}
                </span>{canonical.sourceItemId ? <><Link href={`/admin/ebay/decisions?opportunityItemId=${canonical.sourceItemId}`} className="rounded-full border border-cyan-300/20 px-3 py-1.5 text-xs font-semibold text-cyan-200">View synced decision</Link><Link href={`/admin/ebay/copilot?surface=OPPORTUNITY&itemId=${canonical.sourceItemId}`} className="rounded-full border border-violet-300/20 px-3 py-1.5 text-xs font-semibold text-violet-200">Ask Copilot</Link></> : null}</div>
              </div>
              <details className="mt-3 text-[10px] text-slate-500"><summary className="cursor-pointer">Authoritative versions</summary><p className="mt-2 leading-5">{Object.entries(canonical.versions).map(([name, version]) => `${name}: ${version}`).join(" · ")}</p></details>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Primary keyword", canonical.commercialRecommendation.primaryKeyword ?? "UNPROVEN"],
                  ["Keyword opportunity", canonical.commercialRecommendation.keywordOpportunity],
                  ["Active attractiveness", `${canonical.commercialRecommendation.activeMarketAttractiveness}${canonical.activeMarketAttractiveness.score === null ? "" : ` · ${canonical.activeMarketAttractiveness.score}/100`}`],
                  ["Demand validation", canonical.commercialRecommendation.demandValidation],
                  ["Search volume", "UNPROVEN"],
                  ["Strict comparables", String(canonical.competition.STRICT_COMPARABLE_COUNT)],
                  ["Family comparables", String(canonical.competition.FAMILY_COMPARABLE_COUNT)],
                  ["Observed active market", String(canonical.competition.OBSERVED_ACTIVE_RESULTS)],
                  ["Search result coverage", canonical.competition.SEARCH_RESULT_COVERAGE],
                  ["Marketplace competition total", "UNPROVEN"],
                  ["Median strict price", canonical.priceOpportunity.priceBand?.median === null || !canonical.priceOpportunity.priceBand ? "UNPROVEN" : `${canonical.priceOpportunity.priceBand.currency ?? ""} ${canonical.priceOpportunity.priceBand.median.toFixed(2)}`],
                  ["Recommended entry price", canonical.priceOpportunity.recommendedEntryPrice === null ? canonical.priceOpportunity.recommendationReason : `${canonical.priceOpportunity.priceBand?.currency ?? ""} ${canonical.priceOpportunity.recommendedEntryPrice.toFixed(2)}`],
                  ["Supplier match", canonical.commercialRecommendation.supplierMatch],
                  ["Stock", canonical.commercialRecommendation.stock],
                  ["Economics", canonical.commercialRecommendation.economics],
                ].map(([label, value]) => <article key={label} className="rounded-xl border border-white/[0.07] bg-[#07111d]/70 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1.5 break-words text-sm font-medium text-slate-100">{value}</p></article>)}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <article className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-4">
                  <p className="text-xs font-semibold text-amber-100">Next best action</p>
                  <p className="mt-2 text-sm text-white">{canonical.commercialRecommendation.nextBestAction}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">Evidence queue: {canonical.nextBestEvidence.ordered.length ? canonical.nextBestEvidence.ordered.join(" · ") : "No missing evidence blocker"}</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-[#07111d]/70 p-4">
                  <p className="text-xs font-semibold text-slate-200">Use as Reference / Sell One Like This</p>
                  <p className="mt-2 text-sm text-white">{canonical.referenceStrategy.primaryReference?.referenceDecision ?? "NO SAFE REFERENCE"}</p>
                  <p className="mt-1 text-xs text-slate-400">Item {canonical.referenceStrategy.primaryReference?.itemId ?? "UNPROVEN"} · Reference Structure Quality {canonical.referenceStrategy.primaryReference?.referenceStructureQualityScore ?? "—"}/100</p>
                  <p className="mt-2 text-[10px] text-amber-200">Structure only. Brand, model, identifiers, images, descriptions, claims, pack quantity, and compatibility never transfer without Product Truth.</p>
                </article>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Comparable Fingerprint V2</h2><span className="text-[10px] text-slate-500">strict pricing is isolated</span></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Strict</span><strong className="mt-1 block text-lg text-white">{canonical.competition.STRICT_COMPARABLE_COUNT}</strong></p>
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Pack excluded</span><strong className="mt-1 block text-lg text-white">{canonical.priceOpportunity.packMismatchExcluded}</strong></p>
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Form factor excluded</span><strong className="mt-1 block text-lg text-white">{canonical.priceOpportunity.formFactorExcluded}</strong></p>
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Near duplicates excluded</span><strong className="mt-1 block text-lg text-white">{canonical.competition.NEAR_DUPLICATE_RESULTS_EXCLUDED}</strong></p>
                </div>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{canonical.comparables.slice(0, 12).map((row) => <div key={row.evidenceId} className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] p-2.5"><div className="min-w-0"><p className="truncate text-xs text-slate-200">{row.title ?? "Protected listing"}</p><p className="mt-1 text-[10px] text-slate-500">{row.reasonCodes.join(" · ")}</p></div><span className="shrink-0 text-[10px] font-medium text-cyan-200">{row.classification}</span></div>)}</div>
              </article>
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <h2 className="text-sm font-semibold">Keyword Intelligence V2</h2>
                <p className="mt-1 text-xs text-slate-500">Relevance and opportunity are separate; repetition is not quality.</p>
                <div className="mt-3 space-y-2">{canonical.keywordIntelligence.keywords.slice(0, 10).map((row) => <div key={`${row.role}:${row.phrase}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-white/[0.035] p-2.5"><div><p className="text-xs text-slate-100">{row.phrase}</p><p className="mt-1 text-[10px] text-slate-500">{row.role} · support {row.independentComparableSupport}</p></div><p className="text-right text-[10px] text-slate-400">relevance {row.relevanceScore}<br />opportunity {row.opportunityScore}</p></div>)}</div>
                <div className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-400"><p>Primary: <span className="text-cyan-100">{canonical.keywordIntelligence.spine.PRIMARY_KEYWORD ?? "UNPROVEN"}</span></p><p className="mt-1">Secondary: {canonical.keywordIntelligence.spine.SECONDARY_KEYWORDS.join(" · ") || "—"}</p><p className="mt-1">Attributes: {canonical.keywordIntelligence.spine.ATTRIBUTE_TERMS.join(" · ") || "—"}</p><p className="mt-1 text-rose-200">Rejected: {canonical.keywordIntelligence.spine.REJECTED_TERMS.slice(0, 5).join(" · ") || "—"}</p></div>
              </article>
            </section>

            <section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Price Opportunity V2</h2><p className="mt-1 text-xs text-slate-500">Physical comparability and price representativeness remain separate; missing costs are never zero-filled.</p></div><span className="text-[10px] font-medium text-cyan-200">{canonical.priceOpportunity.recommendationReason}</span></div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 xl:grid-cols-2">
                  {[
                    ["Observed results", canonical.priceOpportunity.observedResults],
                    ["Strict comparables", canonical.priceOpportunity.strictComparables],
                    ["P25", canonical.priceOpportunity.priceBand?.p25 ?? "UNPROVEN"],
                    ["Median", canonical.priceOpportunity.priceBand?.median ?? "UNPROVEN"],
                    ["P75", canonical.priceOpportunity.priceBand?.p75 ?? "UNPROVEN"],
                    ["Range", canonical.priceOpportunity.priceBand ? `${canonical.priceOpportunity.priceBand.range.minimum} – ${canonical.priceOpportunity.priceBand.range.maximum}` : "UNPROVEN"],
                    ["Robust core band", canonical.priceOpportunity.ROBUST_CORE_PRICE_BAND ? `${canonical.priceOpportunity.ROBUST_CORE_PRICE_BAND.range.minimum} – ${canonical.priceOpportunity.ROBUST_CORE_PRICE_BAND.range.maximum}` : "UNPROVEN"],
                    ["Possible price outliers", canonical.priceOpportunity.PRICE_OUTLIER_COUNT],
                    ["Recommended", canonical.priceOpportunity.recommendedEntryPrice ?? "WITHHELD"],
                    ["Economics", canonical.priceOpportunity.economics.status],
                  ].map(([label, value]) => <div key={label} className="rounded-lg bg-white/[0.035] p-2.5"><dt className="text-[10px] text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-100">{String(value)}</dd></div>)}
                </dl>
                {canonical.priceOpportunity.PRICE_OUTLIER_LIST.length ? <p className="mt-3 text-[10px] text-amber-200">Possible outliers, still physically strict: {canonical.priceOpportunity.PRICE_OUTLIER_LIST.map((row) => `${row.itemId ?? row.evidenceId} ${row.currency ?? ""} ${row.price}`).join(" · ")}</p> : null}
              </article>
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Reference Strategy / Sell One Like This</h2><p className="mt-1 text-xs text-slate-500">Ranked read-only structure candidates; adjacent, pack, form-factor, variant, and category conflicts cannot become a reference.</p></div><span className="text-[10px] text-amber-200">NO CONTENT COPY</span></div>
                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{canonical.referenceStrategy.candidates.slice(0, 20).map((candidate) => <article key={candidate.evidenceId} className="grid gap-2 rounded-lg border border-white/[0.07] p-3 sm:grid-cols-[1fr_auto]"><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-100">{candidate.title ?? `Item ${candidate.itemId ?? "UNPROVEN"}`}</p><p className="mt-1 text-[10px] text-slate-500">{candidate.referenceRole} · Item {candidate.itemId ?? "UNPROVEN"} · Category {candidate.categoryId ?? "UNPROVEN"}</p><p className="mt-1 text-[10px] text-amber-100">{candidate.referenceRiskCodes.join(" · ") || "No structural risk code"}</p></div><div className="text-right"><p className="text-xs font-semibold text-cyan-200">{candidate.referenceDecision}</p><p className="mt-1 text-[10px] text-slate-500">Reference Structure Quality {candidate.referenceStructureQualityScore}/100</p></div></article>)}{canonical.referenceStrategy.candidates.length === 0 && <p className="text-xs text-slate-500">No safe candidate can be ranked from current evidence.</p>}</div>
                {canonical.referenceStrategy.selected?.handoff && <div className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] p-3 text-[10px] leading-5 text-slate-300"><p className="font-semibold text-emerald-200">Read-only handoff readiness</p><p>Safe structure candidates: {canonical.referenceStrategy.selected.handoff.safeStructureCandidates.join(" · ")}</p><p>Requires Product Truth: {canonical.referenceStrategy.selected.handoff.requiresProductTruth.join(" · ")}</p><p>Rejected identity/content: {[...canonical.referenceStrategy.selected.handoff.rejectedCompetitorIdentity, ...canonical.referenceStrategy.selected.handoff.rejectedCopyrightContent].join(" · ")}</p></div>}
              </article>
            </section>

            <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Canonical Opportunity Case V2</h2><p className="mt-1 text-xs text-slate-400">One authoritative family, comparable set, keyword spine, price view, reference strategy, decision, and next-best action.</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">Next: {canonical.opportunityCase.commercialRecommendation.nextBestAction}</span></div><p className="mt-3 text-xs text-emerald-100">Legacy diagnostics cannot override this result or feed Decisions.</p></section>

            <details className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
              <summary className="cursor-pointer text-sm font-semibold">Legacy diagnostics / provenance</summary>
              <p className="mt-2 text-xs text-amber-200">Historical V1 evidence interpretation only · non-authoritative · hidden by default · cannot override Canonical Opportunity Result V2.</p>
              <div className="mt-4 space-y-5 opacity-80">

            <section className="grid gap-3 md:grid-cols-4">
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Decision</p><span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(research.decision.outcome)}`}>{research.decision.outcome}</span></article>
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Opportunity score</p><p className="mt-2 text-2xl font-semibold">{metric(research.opportunityScore.value, research.opportunityScore.value === null ? "" : "/100")}</p><p className="mt-1 text-xs text-slate-500">{research.opportunityScore.status}</p></article>
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Active market evidence</p><p className="mt-2 text-2xl font-semibold">{research.competition.activeMarketResultCount}</p><p className="mt-1 text-xs text-slate-500">{research.competition.strongComparableCount} strong · {research.competition.familyComparableCount} family · {research.competition.weakComparableCount} weak</p></article>
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Verified sold evidence</p><p className="mt-2 text-2xl font-semibold">{research.demand.soldListingCount90d ?? "—"}</p><p className="mt-1 text-xs text-slate-500">{research.demand.soldHistoryStatus}</p></article>
            </section>

            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 className="text-sm font-semibold">Ranked product families</h2><p className="text-xs text-slate-500">Category and commercial product family remain separate. Active asking prices never masquerade as sold prices.</p></div><span className="text-xs text-slate-500">{research.productFamilies.length} families</span></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-white/[0.025] text-slate-500"><tr><th className="px-4 py-2.5">Product family</th><th>eBay category</th><th>90d demand</th><th>30d momentum</th><th>Sold evidence</th><th>Observed family sample</th><th>Active price</th><th>Confidence</th></tr></thead><tbody>{research.productFamilies.map((family) => <tr key={family.familyId} className="border-t border-white/[0.06]"><td className="px-4 py-3 font-medium text-slate-200">{family.canonicalLabel}</td><td className="text-slate-500">{family.category.canonicalLabel ?? "—"}</td><td>{research.demand.demand90d}</td><td>{research.demand.momentum30d}</td><td>{family.soldEvidenceCount}</td><td>{family.activeCompetitionCount}</td><td>{family.priceDistribution.activeAskingPrice?.median === undefined || family.priceDistribution.activeAskingPrice === null ? "—" : family.priceDistribution.activeAskingPrice.median.toFixed(2)}</td><td>{family.confidence}%</td></tr>)}</tbody></table></div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
              <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-4"><h2 className="text-sm font-semibold">Top comparable evidence</h2><div className="mt-3 divide-y divide-white/[0.06]">{research.comparables.slice(0, 8).map((row) => <article key={row.evidenceId} className="grid grid-cols-[44px_1fr_auto] gap-3 py-3"><div className="h-11 w-11 overflow-hidden rounded-lg bg-white/[0.06]">{row.imageUrl ? <img src={row.imageUrl} alt="" className="h-full w-full object-cover" /> : null}</div><div className="min-w-0"><p className="truncate text-sm text-slate-200">{row.title ?? "Protected market listing"}</p><p className="mt-1 text-xs text-slate-500">{row.classification} · {row.source}</p>{row.mismatchAttributes.length ? <p className="mt-1 text-xs text-amber-200">Mismatch: {row.mismatchAttributes.join(", ")}</p> : null}</div><div className="text-right text-xs"><p>{row.price === null ? "—" : `${row.currency ?? ""} ${row.price.toFixed(2)}`}</p><p className="mt-1 text-slate-500">{row.confirmedSold ? "VERIFIED SOLD" : "ACTIVE ASK"}</p></div></article>)}</div></section>
              <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-4"><h2 className="text-sm font-semibold">Keyword families</h2><p className="mt-1 text-xs text-slate-500">Specific commercial phrases are favored; generic fragments are penalized. No fabricated search volume.</p><div className="mt-3 space-y-3">{research.keywordFamilies.slice(0, 10).map((keyword) => <article key={keyword.keywordFamilyId} className="rounded-xl bg-white/[0.035] p-3"><div className="flex justify-between gap-3"><p className="text-sm font-medium text-cyan-100">{keyword.canonicalPhrase}</p><span className="text-[10px] text-slate-500">{keyword.familyType} · quality {keyword.qualityScore}</span></div><p className="mt-1 text-xs text-slate-500">{keyword.comparableListingsObserved} comparables · {keyword.soldListingsObserved ?? "—"} verified sold</p></article>)}</div><div className="mt-4 border-t border-white/10 pt-4"><p className="text-xs text-slate-500">Market-backed keyword spine · MARKET EVIDENCE ONLY</p><p className="mt-2 text-sm leading-6 text-slate-200">{research.keywordSpine.terms.length ? research.keywordSpine.terms.join(" · ") : "Insufficient evidence"}</p><p className="mt-1 text-[10px] text-amber-200">Physical product truth must validate every phrase before Product Case.</p></div></section>
            </div>

            <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Legacy Opportunity Case V1</h2><p className="mt-1 text-xs text-slate-500">Auditable historical diagnostic only. Product Case creation remains disabled.</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">Legacy next: {research.opportunityCase.nextStep}</span></div><div className="mt-4 grid gap-3 text-xs text-slate-400 md:grid-cols-3"><p>Normalization: {research.provenance.normalizationVersion}</p><p>Comparables: {research.provenance.comparableEngineVersion}</p><p>Scoring: {research.provenance.scoringVersion}</p></div>{research.provenance.evidenceLimitations.length ? <p className="mt-3 text-xs text-amber-200">Limitations: {research.provenance.evidenceLimitations.join(" · ")}</p> : null}</section>
              </div>
            </details>
          </div>
        ) : null}
        </div>
        </Loop2Top20OpportunityPool>
      </div>
    </main>
  )
}
