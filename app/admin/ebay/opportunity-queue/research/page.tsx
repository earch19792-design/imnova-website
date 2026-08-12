"use client"

import { ArrowLeft, BarChart3, FlaskConical, Search, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import type { MarketOpportunityResearchV1 } from "@/lib/ebay/ebay-market-opportunity-research-v1"
import type { OfficialSoldEvidenceExport } from "@/lib/ebay/ebay-official-sold-evidence-import"
import { supabase } from "@/lib/supabase"

const seedTypes = [
  ["SEED_QUERY", "Search term"],
  ["SEED_PRODUCT_TITLE", "Product title"],
  ["SEED_PRODUCT_FAMILY", "Product family"],
  ["SEED_ITEM_ID", "eBay Item ID"],
] as const

const manualSources: Array<[OfficialSoldEvidenceExport, string]> = [
  ["EBAY_PRODUCT_RESEARCH_EXPORT", "eBay Product Research"],
  ["EBAY_MARKETPLACE_INSIGHTS_EXPORT", "Marketplace Insights"],
  ["EBAY_SELLER_HUB_EXPORT", "Seller Hub export"],
]

function metric(value: number | null, suffix = "") {
  return value === null ? "—" : `${value.toLocaleString()}${suffix}`
}

function statusTone(value: string) {
  if (value === "ADVANCE") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
  if (value === "REJECT") return "border-rose-400/30 bg-rose-400/10 text-rose-200"
  return "border-amber-400/30 bg-amber-400/10 text-amber-100"
}

export default function MarketResearchPage() {
  const [seedType, setSeedType] = useState<(typeof seedTypes)[number][0]>("SEED_QUERY")
  const [seedValue, setSeedValue] = useState("")
  const [windowDays, setWindowDays] = useState<30 | 90 | 365>(90)
  const [manualEvidence, setManualEvidence] = useState("")
  const [manualFormat, setManualFormat] = useState<"CSV" | "JSON">("CSV")
  const [manualSource, setManualSource] = useState<OfficialSoldEvidenceExport>(
    "EBAY_PRODUCT_RESEARCH_EXPORT",
  )
  const [research, setResearch] = useState<MarketOpportunityResearchV1 | null>(null)
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
        research?: MarketOpportunityResearchV1
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

        <section className="grid gap-4 rounded-2xl border border-white/10 bg-[#0b1826] p-4 lg:grid-cols-[180px_minmax(260px,1fr)_130px_auto]">
          <label className="text-xs text-slate-400">Seed type
            <select value={seedType} onChange={(event) => setSeedType(event.target.value as typeof seedType)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#07111d] px-3 py-2.5 text-sm text-white">
              {seedTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Product idea, title, family or Item ID
            <input value={seedValue} onChange={(event) => setSeedValue(event.target.value)} maxLength={180} placeholder="Enter a research seed" className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#07111d] px-3 py-2.5 text-sm text-white placeholder:text-slate-600" />
          </label>
          <label className="text-xs text-slate-400">Requested window
            <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as 30 | 90 | 365)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#07111d] px-3 py-2.5 text-sm text-white">
              <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option>
            </select>
          </label>
          <button onClick={runResearch} disabled={loading || seedValue.trim().length < 2} className="mt-auto inline-flex h-[42px] items-center justify-center gap-2 rounded-lg bg-cyan-400 px-5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
            <Search className="h-4 w-4" /> {loading ? "Researching…" : "Run research"}
          </button>
        </section>

        <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-300">Approved manual sold-evidence import (optional)</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-[110px_190px_1fr]">
            <select value={manualFormat} onChange={(event) => setManualFormat(event.target.value as "CSV" | "JSON")} className="rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm"><option>CSV</option><option>JSON</option></select>
            <select value={manualSource} onChange={(event) => setManualSource(event.target.value as OfficialSoldEvidenceExport)} className="rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 text-sm">{manualSources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <textarea value={manualEvidence} onChange={(event) => setManualEvidence(event.target.value)} placeholder="Paste an approved structured export. Buyer/order PII is rejected." rows={4} className="rounded-lg border border-white/10 bg-[#07111d] px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600" />
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
            <section className="grid gap-3 md:grid-cols-4">
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Decision</p><span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(research.decision.outcome)}`}>{research.decision.outcome}</span></article>
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Opportunity score</p><p className="mt-2 text-2xl font-semibold">{metric(research.opportunityScore.value, research.opportunityScore.value === null ? "" : "/100")}</p><p className="mt-1 text-xs text-slate-500">{research.opportunityScore.status}</p></article>
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Active comparables</p><p className="mt-2 text-2xl font-semibold">{research.competition.activeComparableCount}</p><p className="mt-1 text-xs text-slate-500">Observed asking market</p></article>
              <article className="rounded-xl border border-white/10 bg-[#0b1826] p-4"><p className="text-xs text-slate-500">Verified sold evidence</p><p className="mt-2 text-2xl font-semibold">{research.demand.soldListingCount90d ?? "—"}</p><p className="mt-1 text-xs text-slate-500">{research.demand.soldHistoryStatus}</p></article>
            </section>

            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1826]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 className="text-sm font-semibold">Ranked product families</h2><p className="text-xs text-slate-500">Active asking prices never masquerade as sold prices.</p></div><span className="text-xs text-slate-500">{research.productFamilies.length} families</span></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-white/[0.025] text-slate-500"><tr><th className="px-4 py-2.5">Family</th><th>90d demand</th><th>30d momentum</th><th>Sold evidence</th><th>Competition</th><th>Active price</th><th>Confidence</th></tr></thead><tbody>{research.productFamilies.map((family) => <tr key={family.familyId} className="border-t border-white/[0.06]"><td className="px-4 py-3 font-medium text-slate-200">{family.canonicalLabel}</td><td>{research.demand.demand90d}</td><td>{research.demand.momentum30d}</td><td>{family.soldEvidenceCount}</td><td>{family.activeCompetitionCount}</td><td>{family.priceDistribution.activeAskingPrice?.median === undefined || family.priceDistribution.activeAskingPrice === null ? "—" : family.priceDistribution.activeAskingPrice.median.toFixed(2)}</td><td>{family.confidence}%</td></tr>)}</tbody></table></div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
              <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-4"><h2 className="text-sm font-semibold">Top comparable evidence</h2><div className="mt-3 divide-y divide-white/[0.06]">{research.comparables.slice(0, 8).map((row) => <article key={row.evidenceId} className="grid grid-cols-[44px_1fr_auto] gap-3 py-3"><div className="h-11 w-11 overflow-hidden rounded-lg bg-white/[0.06]">{row.imageUrl ? <img src={row.imageUrl} alt="" className="h-full w-full object-cover" /> : null}</div><div className="min-w-0"><p className="truncate text-sm text-slate-200">{row.title ?? "Protected market listing"}</p><p className="mt-1 text-xs text-slate-500">{row.classification} · {row.source}</p>{row.mismatchAttributes.length ? <p className="mt-1 text-xs text-amber-200">Mismatch: {row.mismatchAttributes.join(", ")}</p> : null}</div><div className="text-right text-xs"><p>{row.price === null ? "—" : `${row.currency ?? ""} ${row.price.toFixed(2)}`}</p><p className="mt-1 text-slate-500">{row.confirmedSold ? "VERIFIED SOLD" : "ACTIVE ASK"}</p></div></article>)}</div></section>
              <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-4"><h2 className="text-sm font-semibold">Keyword families</h2><p className="mt-1 text-xs text-slate-500">Evidence phrases, never fabricated search volume.</p><div className="mt-3 space-y-3">{research.keywordFamilies.slice(0, 10).map((keyword) => <article key={keyword.keywordFamilyId} className="rounded-xl bg-white/[0.035] p-3"><div className="flex justify-between gap-3"><p className="text-sm font-medium text-cyan-100">{keyword.canonicalPhrase}</p><span className="text-[10px] text-slate-500">{keyword.familyType}</span></div><p className="mt-1 text-xs text-slate-500">{keyword.comparableListingsObserved} comparables · {keyword.soldListingsObserved ?? "—"} verified sold</p></article>)}</div><div className="mt-4 border-t border-white/10 pt-4"><p className="text-xs text-slate-500">Market-backed keyword spine</p><p className="mt-2 text-sm leading-6 text-slate-200">{research.keywordSpine.terms.length ? research.keywordSpine.terms.join(" · ") : "Insufficient evidence"}</p></div></section>
            </div>

            <section className="rounded-2xl border border-white/10 bg-[#0b1826] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Opportunity Case V1</h2><p className="mt-1 text-xs text-slate-500">Auditable dossier. Product Case creation remains disabled.</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">Next: {research.opportunityCase.nextStep}</span></div><div className="mt-4 grid gap-3 text-xs text-slate-400 md:grid-cols-3"><p>Normalization: {research.provenance.normalizationVersion}</p><p>Comparables: {research.provenance.comparableEngineVersion}</p><p>Scoring: {research.provenance.scoringVersion}</p></div>{research.provenance.evidenceLimitations.length ? <p className="mt-3 text-xs text-amber-200">Limitations: {research.provenance.evidenceLimitations.join(" · ")}</p> : null}</section>
          </div>
        ) : null}
      </div>
    </main>
  )
}
