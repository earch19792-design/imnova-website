"use client"

import { ArrowLeft, BarChart3, FlaskConical, Search, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

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
    } catch (caught) {
      setResearch(null)
      setError(caught instanceof Error ? caught.message : "MARKET_RESEARCH_READ_FAILED")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#07111d] text-slate-100">
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

        {research ? (
          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.08] to-[#0b1826] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Commercial Recommendation V1</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">{research.intelligenceV2.commercialRecommendation.productFamily ?? "Product family unproven"}</h2>
                  <p className="mt-1 text-xs text-slate-400">Canonical family confidence {research.intelligenceV2.commercialRecommendation.canonicalFamilyConfidence}% · {research.intelligenceV2.consensus.CONSENSUS_REASON}</p>
                </div>
                <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(research.intelligenceV2.commercialRecommendation.finalDecision)}`}>
                  {research.intelligenceV2.commercialRecommendation.finalDecision}
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Primary keyword", research.intelligenceV2.commercialRecommendation.primaryKeyword ?? "UNPROVEN"],
                  ["Keyword opportunity", research.intelligenceV2.commercialRecommendation.keywordOpportunity],
                  ["Active attractiveness", `${research.intelligenceV2.commercialRecommendation.activeMarketAttractiveness}${research.intelligenceV2.activeMarketAttractiveness.score === null ? "" : ` · ${research.intelligenceV2.activeMarketAttractiveness.score}/100`}`],
                  ["Demand validation", research.intelligenceV2.commercialRecommendation.demandValidation],
                  ["Search volume", "UNPROVEN"],
                  ["Strict comparables", String(research.intelligenceV2.competition.STRICT_COMPARABLE_COUNT)],
                  ["Family comparables", String(research.intelligenceV2.competition.FAMILY_COMPARABLE_COUNT)],
                  ["Observed active market", String(research.intelligenceV2.competition.OBSERVED_ACTIVE_RESULTS)],
                  ["Search result coverage", research.intelligenceV2.competition.SEARCH_RESULT_COVERAGE],
                  ["Marketplace competition total", "UNPROVEN"],
                  ["Median strict price", research.intelligenceV2.priceOpportunity.priceBand?.median === null || !research.intelligenceV2.priceOpportunity.priceBand ? "UNPROVEN" : `${research.intelligenceV2.priceOpportunity.priceBand.currency ?? ""} ${research.intelligenceV2.priceOpportunity.priceBand.median.toFixed(2)}`],
                  ["Recommended entry price", research.intelligenceV2.priceOpportunity.recommendedEntryPrice === null ? research.intelligenceV2.priceOpportunity.recommendationReason : `${research.intelligenceV2.priceOpportunity.priceBand?.currency ?? ""} ${research.intelligenceV2.priceOpportunity.recommendedEntryPrice.toFixed(2)}`],
                  ["Supplier match", research.intelligenceV2.commercialRecommendation.supplierMatch],
                  ["Stock", research.intelligenceV2.commercialRecommendation.stock],
                  ["Economics", research.intelligenceV2.commercialRecommendation.economics],
                ].map(([label, value]) => <article key={label} className="rounded-xl border border-white/[0.07] bg-[#07111d]/70 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1.5 break-words text-sm font-medium text-slate-100">{value}</p></article>)}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <article className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-4">
                  <p className="text-xs font-semibold text-amber-100">Next best action</p>
                  <p className="mt-2 text-sm text-white">{research.intelligenceV2.commercialRecommendation.nextBestAction}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">Evidence queue: {research.intelligenceV2.nextBestEvidence.ordered.length ? research.intelligenceV2.nextBestEvidence.ordered.join(" · ") : "No missing evidence blocker"}</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-[#07111d]/70 p-4">
                  <p className="text-xs font-semibold text-slate-200">Use as Reference / Sell One Like This</p>
                  <p className="mt-2 text-sm text-white">{research.intelligenceV2.referenceStrategy.selected?.referenceDecision ?? "NO SAFE REFERENCE"}</p>
                  <p className="mt-1 text-xs text-slate-400">Item {research.intelligenceV2.referenceStrategy.selected?.itemId ?? "UNPROVEN"} · quality {research.intelligenceV2.referenceStrategy.selected?.referenceQualityScore ?? "—"}/100</p>
                  <p className="mt-2 text-[10px] text-amber-200">Structure only. Brand, model, identifiers, images, descriptions, claims, pack quantity, and compatibility never transfer without Product Truth.</p>
                </article>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Comparable Fingerprint V2</h2><span className="text-[10px] text-slate-500">strict pricing is isolated</span></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Strict</span><strong className="mt-1 block text-lg text-white">{research.intelligenceV2.competition.STRICT_COMPARABLE_COUNT}</strong></p>
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Pack excluded</span><strong className="mt-1 block text-lg text-white">{research.intelligenceV2.priceOpportunity.packMismatchExcluded}</strong></p>
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Form factor excluded</span><strong className="mt-1 block text-lg text-white">{research.intelligenceV2.priceOpportunity.formFactorExcluded}</strong></p>
                  <p className="rounded-lg bg-white/[0.035] p-3 text-xs"><span className="block text-slate-500">Near duplicates excluded</span><strong className="mt-1 block text-lg text-white">{research.intelligenceV2.competition.NEAR_DUPLICATE_RESULTS_EXCLUDED}</strong></p>
                </div>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{research.intelligenceV2.comparables.slice(0, 12).map((row) => <div key={row.evidenceId} className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] p-2.5"><div className="min-w-0"><p className="truncate text-xs text-slate-200">{row.title ?? "Protected listing"}</p><p className="mt-1 text-[10px] text-slate-500">{row.reasonCodes.join(" · ")}</p></div><span className="shrink-0 text-[10px] font-medium text-cyan-200">{row.classification}</span></div>)}</div>
              </article>
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <h2 className="text-sm font-semibold">Keyword Intelligence V2</h2>
                <p className="mt-1 text-xs text-slate-500">Relevance and opportunity are separate; repetition is not quality.</p>
                <div className="mt-3 space-y-2">{research.intelligenceV2.keywordIntelligence.keywords.slice(0, 10).map((row) => <div key={`${row.role}:${row.phrase}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-white/[0.035] p-2.5"><div><p className="text-xs text-slate-100">{row.phrase}</p><p className="mt-1 text-[10px] text-slate-500">{row.role} · support {row.independentComparableSupport}</p></div><p className="text-right text-[10px] text-slate-400">relevance {row.relevanceScore}<br />opportunity {row.opportunityScore}</p></div>)}</div>
                <div className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-400"><p>Primary: <span className="text-cyan-100">{research.intelligenceV2.keywordIntelligence.spine.PRIMARY_KEYWORD ?? "UNPROVEN"}</span></p><p className="mt-1">Secondary: {research.intelligenceV2.keywordIntelligence.spine.SECONDARY_KEYWORDS.join(" · ") || "—"}</p><p className="mt-1 text-rose-200">Rejected: {research.intelligenceV2.keywordIntelligence.spine.REJECTED_TERMS.slice(0, 5).join(" · ") || "—"}</p></div>
              </article>
            </section>

            <section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Price Opportunity V2</h2><p className="mt-1 text-xs text-slate-500">Strict single-unit active asks only; missing costs are never zero-filled.</p></div><span className="text-[10px] font-medium text-cyan-200">{research.intelligenceV2.priceOpportunity.recommendationReason}</span></div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 xl:grid-cols-2">
                  {[
                    ["Observed results", research.intelligenceV2.priceOpportunity.observedResults],
                    ["Strict comparables", research.intelligenceV2.priceOpportunity.strictComparables],
                    ["P25", research.intelligenceV2.priceOpportunity.priceBand?.p25 ?? "UNPROVEN"],
                    ["Median", research.intelligenceV2.priceOpportunity.priceBand?.median ?? "UNPROVEN"],
                    ["P75", research.intelligenceV2.priceOpportunity.priceBand?.p75 ?? "UNPROVEN"],
                    ["Range", research.intelligenceV2.priceOpportunity.priceBand ? `${research.intelligenceV2.priceOpportunity.priceBand.range.minimum} – ${research.intelligenceV2.priceOpportunity.priceBand.range.maximum}` : "UNPROVEN"],
                    ["Recommended", research.intelligenceV2.priceOpportunity.recommendedEntryPrice ?? "WITHHELD"],
                    ["Economics", research.intelligenceV2.priceOpportunity.economics.status],
                  ].map(([label, value]) => <div key={label} className="rounded-lg bg-white/[0.035] p-2.5"><dt className="text-[10px] text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-100">{String(value)}</dd></div>)}
                </dl>
              </article>
              <article className="rounded-2xl border border-white/10 bg-[#0b1826] p-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Reference Strategy / Sell One Like This</h2><p className="mt-1 text-xs text-slate-500">Ranked read-only structure candidates; adjacent, pack, form-factor, variant, and category conflicts cannot become a reference.</p></div><span className="text-[10px] text-amber-200">NO CONTENT COPY</span></div>
                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{research.intelligenceV2.referenceStrategy.candidates.slice(0, 20).map((candidate) => <article key={candidate.evidenceId} className="grid gap-2 rounded-lg border border-white/[0.07] p-3 sm:grid-cols-[1fr_auto]"><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-100">{candidate.title ?? `Item ${candidate.itemId ?? "UNPROVEN"}`}</p><p className="mt-1 text-[10px] text-slate-500">Item {candidate.itemId ?? "UNPROVEN"} · Category {candidate.categoryId ?? "UNPROVEN"}</p><p className="mt-1 text-[10px] text-amber-100">{candidate.referenceRiskCodes.join(" · ") || "No structural risk code"}</p></div><div className="text-right"><p className="text-xs font-semibold text-cyan-200">{candidate.referenceDecision}</p><p className="mt-1 text-[10px] text-slate-500">quality {candidate.referenceQualityScore}/100</p></div></article>)}{research.intelligenceV2.referenceStrategy.candidates.length === 0 && <p className="text-xs text-slate-500">No safe candidate can be ranked from current evidence.</p>}</div>
                {research.intelligenceV2.referenceStrategy.selected?.handoff && <div className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.05] p-3 text-[10px] leading-5 text-slate-300"><p className="font-semibold text-emerald-200">Read-only handoff readiness</p><p>Safe structure candidates: {research.intelligenceV2.referenceStrategy.selected.handoff.safeStructureCandidates.join(" · ")}</p><p>Requires Product Truth: {research.intelligenceV2.referenceStrategy.selected.handoff.requiresProductTruth.join(" · ")}</p><p>Rejected identity/content: {[...research.intelligenceV2.referenceStrategy.selected.handoff.rejectedCompetitorIdentity, ...research.intelligenceV2.referenceStrategy.selected.handoff.rejectedCopyrightContent].join(" · ")}</p></div>}
              </article>
            </section>

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

            <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Opportunity Case V1</h2><p className="mt-1 text-xs text-slate-500">Auditable dossier. Product Case creation remains disabled.</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">Next: {research.opportunityCase.nextStep}</span></div><div className="mt-4 grid gap-3 text-xs text-slate-400 md:grid-cols-3"><p>Normalization: {research.provenance.normalizationVersion}</p><p>Comparables: {research.provenance.comparableEngineVersion}</p><p>Scoring: {research.provenance.scoringVersion}</p></div>{research.provenance.evidenceLimitations.length ? <p className="mt-3 text-xs text-amber-200">Limitations: {research.provenance.evidenceLimitations.join(" · ")}</p> : null}</section>
          </div>
        ) : null}
      </div>
    </main>
  )
}
