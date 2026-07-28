import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"
import {
  compareHumanConclusion,
  evaluateStrategyLabCase,
  type MarketDistribution,
} from "@/lib/ebay/strategy-lab-engine"
import {
  STRATEGY_LAB_GOLDEN_CASES,
} from "@/lib/ebay/strategy-lab-fixtures"

const evaluatedCases = STRATEGY_LAB_GOLDEN_CASES.map((fixture) => {
  const evaluation = evaluateStrategyLabCase(fixture.input)
  return {
    fixture,
    evaluation,
    comparison: compareHumanConclusion(
      evaluation,
      fixture.expectedHumanConclusion,
    ),
  }
})

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "MISSING"
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function money(value: number | null) {
  return value === null ? "MISSING" : `$${value.toFixed(2)}`
}

function tone(value: string) {
  if (value === "MATCH" || value === "VIABLE" ||
    value.startsWith("GO_")) {
    return "border-emerald-200/30 bg-emerald-200/[0.08] text-emerald-50"
  }
  if (value.startsWith("HOLD_") || value === "BLOCKED") {
    return "border-amber-200/30 bg-amber-200/[0.08] text-amber-50"
  }
  return "border-cyan-200/25 bg-cyan-200/[0.06] text-cyan-50"
}

function Distribution({
  label,
  value,
}: {
  label: string
  value: MarketDistribution
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <h5 className="text-xs font-black uppercase tracking-wider text-white/50">
        {label}
      </h5>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-white/40">Items</dt><dd className="mt-1 font-black">{value.uniqueItemCount}</dd></div>
        <div><dt className="text-white/40">P25</dt><dd className="mt-1 font-black">{money(value.p25)}</dd></div>
        <div><dt className="text-white/40">Median</dt><dd className="mt-1 font-black">{money(value.median)}</dd></div>
        <div><dt className="text-white/40">P75</dt><dd className="mt-1 font-black">{money(value.p75)}</dd></div>
        <div><dt className="text-white/40">Shipping missing</dt><dd className="mt-1 font-black">{value.missingBuyerShippingCount}</dd></div>
        <div><dt className="text-white/40">Price samples</dt><dd className="mt-1 font-black">{value.priceSampleSize}</dd></div>
      </dl>
    </div>
  )
}

function CaseReport({
  item,
}: {
  item: typeof evaluatedCases[number]
}) {
  const { fixture, evaluation, comparison } = item
  return (
    <article
      id={fixture.input.caseId}
      className="scroll-mt-24 rounded-[32px] border border-white/10 bg-white/[0.035] p-4 sm:p-6"
    >
      <header className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/55">
            {fixture.fixtureStatus} · {fixture.fixtureVersion}
          </p>
          <h2 className="mt-2 text-2xl font-black sm:text-3xl">
            {fixture.input.productLabel}
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Case ID <code>{fixture.input.caseId}</code> · evaluated_at{" "}
            <code>{fixture.input.evaluatedAt}</code>
          </p>
        </div>
        <span className={`rounded-full border px-4 py-2 text-xs font-black ${tone(comparison.agreement)}`}>
          SHADOW {comparison.agreement}
        </span>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-wider text-cyan-100/50">Preferred scenario</p>
          <p className="mt-2 break-words font-black">{evaluation.recommendation.preferredScenario ?? "MISSING"}</p>
        </div>
        <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-wider text-cyan-100/50">Commercial direction</p>
          <p className="mt-2 break-words font-black">{evaluation.recommendation.commercialDirection ?? "MISSING"}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${tone(evaluation.recommendation.releaseGate)}`}>
          <p className="text-xs font-black uppercase tracking-wider opacity-55">OS conclusion / gate</p>
          <p className="mt-2 break-words font-black">{evaluation.recommendation.releaseGate}</p>
        </div>
        <div className="rounded-2xl border border-violet-200/20 bg-violet-200/[0.05] p-4">
          <p className="text-xs font-black uppercase tracking-wider text-violet-100/50">Next action</p>
          <p className="mt-2 break-words font-black">{evaluation.recommendation.nextAction}</p>
        </div>
      </section>

      <details className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <summary className="min-h-11 cursor-pointer font-black">
          Inputs completos y política económica
        </summary>
        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-[11px] leading-5 text-white/65">
          {JSON.stringify(fixture.input, null, 2)}
        </pre>
      </details>

      <section className="mt-5" aria-labelledby={`${fixture.input.caseId}-evidence`}>
        <h3 id={`${fixture.input.caseId}-evidence`} className="text-xl font-black">
          Evidence classification
        </h3>
        <p className="mt-1 text-sm text-white/50">
          Raw y normalized permanecen juntos; un conflicto no elige ganador.
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-[900px] w-full text-left text-xs">
            <thead className="bg-white/[0.06] text-white/50">
              <tr><th className="p-3">Field</th><th className="p-3">Raw</th><th className="p-3">Normalized</th><th className="p-3">Class</th><th className="p-3">Source</th><th className="p-3">Observed</th><th className="p-3">Review</th></tr>
            </thead>
            <tbody>
              {evaluation.evidence.map((entry) => (
                <tr key={entry.id} className="border-t border-white/10 align-top">
                  <td className="p-3 font-black">{entry.label}<span className="mt-1 block font-normal text-white/35">{entry.field}</span></td>
                  <td className="p-3">{display(entry.rawValue)}</td>
                  <td className="p-3">{display(entry.normalizedValue)}</td>
                  <td className="p-3"><code>{entry.classification}</code>{entry.classificationReasons.map((reason) => <span key={reason} className="mt-1 block text-amber-100/70">{reason}</span>)}</td>
                  <td className="max-w-56 break-all p-3 text-white/55">{entry.sourceReference}</td>
                  <td className="p-3 text-white/55">{entry.observedAt}</td>
                  <td className="p-3">{entry.humanReviewed ? "HUMAN" : "NOT_REVIEWED"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5" aria-labelledby={`${fixture.input.caseId}-comparables`}>
        <h3 id={`${fixture.input.caseId}-comparables`} className="text-xl font-black">
          Comparable validation and deduplication
        </h3>
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.035] p-3">
            <h4 className="font-black">Accepted · {evaluation.acceptedComparables.length}</h4>
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="min-w-[680px] w-full text-left text-xs">
                <thead className="text-white/45"><tr><th className="p-2">Item ID</th><th className="p-2">Cohort / class</th><th className="p-2">Scenario</th><th className="p-2">Pack</th><th className="p-2">Buyer total</th></tr></thead>
                <tbody>{evaluation.acceptedComparables.map((entry) => <tr key={`${entry.canonicalItemId}-${entry.sourceReference}`} className="border-t border-white/10"><td className="p-2"><code>{entry.canonicalItemId}</code></td><td className="p-2">{entry.cohort}<span className="block text-white/40">{entry.evidenceClass}</span></td><td className="p-2">{entry.offerScenario}</td><td className="p-2">{entry.packQuantity}</td><td className="p-2">{money(entry.buyerTotalPrice)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="min-w-0 rounded-2xl border border-rose-200/15 bg-rose-200/[0.035] p-3">
            <h4 className="font-black">Rejected / duplicate · {evaluation.rejectedComparables.length}</h4>
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="min-w-[620px] w-full text-left text-xs">
                <thead className="text-white/45"><tr><th className="p-2">Item ID</th><th className="p-2">Scenario</th><th className="p-2">Reasons</th></tr></thead>
                <tbody>{evaluation.rejectedComparables.map((entry, index) => <tr key={`${entry.canonicalItemId}-${index}`} className="border-t border-white/10"><td className="p-2"><code>{entry.canonicalItemId || "MISSING"}</code></td><td className="p-2">{entry.offerScenario}</td><td className="p-2 text-rose-100/75">{entry.rejectionReasons.join(", ")}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5" aria-labelledby={`${fixture.input.caseId}-models`}>
        <h3 id={`${fixture.input.caseId}-models`} className="text-xl font-black">
          Market model and scenario economics
        </h3>
        <div className="mt-3 grid gap-4">
          {evaluation.scenarioAssessments.map((assessment) => (
            <article key={assessment.scenario.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-black uppercase tracking-wider text-white/40">{assessment.scenario.id}</p><h4 className="mt-1 text-lg font-black">{assessment.scenario.offerScenario} · pack {assessment.scenario.packQuantity}</h4></div>
                <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1.5 text-xs font-black ${tone(assessment.candidateStrategy)}`}>{assessment.candidateStrategy}</span><span className={`rounded-full border px-3 py-1.5 text-xs font-black ${tone(assessment.releaseGate)}`}>{assessment.releaseGate}</span></div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <Distribution label="SOLD_EXACT" value={assessment.marketModel.soldExact} />
                <Distribution label="ACTIVE_EXACT" value={assessment.marketModel.activeExact} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 p-3 text-xs sm:grid-cols-4 xl:grid-cols-8">
                <div><dt className="text-white/40">Similar</dt><dd className="mt-1 font-black">{assessment.marketModel.similarNotExactCount}</dd></div>
                <div><dt className="text-white/40">Estimated</dt><dd className="mt-1 font-black">{assessment.marketModel.estimatedOnlyCount}</dd></div>
                <div><dt className="text-white/40">Buyer total</dt><dd className="mt-1 font-black">{money(assessment.economics.buyerTotalPrice)}</dd></div>
                <div><dt className="text-white/40">Shipping cost</dt><dd className="mt-1 font-black">{money(assessment.economics.outboundShippingCost)}</dd></div>
                <div><dt className="text-white/40">Profit floor</dt><dd className="mt-1 font-black">{money(assessment.economics.profitFloor)}</dd></div>
                <div><dt className="text-white/40">Market ceiling</dt><dd className="mt-1 font-black">{money(assessment.economics.marketCeiling)}<span className="block font-normal text-white/35">{assessment.economics.marketCeilingBasis ?? "MISSING"}</span></dd></div>
                <div><dt className="text-white/40">Profit</dt><dd className="mt-1 font-black">{money(assessment.economics.estimatedProfit)}</dd></div>
                <div><dt className="text-white/40">Margin / ROI</dt><dd className="mt-1 font-black">{assessment.economics.netMarginPercent === null ? "MISSING" : `${assessment.economics.netMarginPercent}%`} / {assessment.economics.roiPercent === null ? "MISSING" : `${assessment.economics.roiPercent}%`}</dd></div>
              </dl>
              {assessment.blockers.length > 0 && <ul className="mt-3 grid gap-2 text-xs text-amber-50 sm:grid-cols-2">{assessment.blockers.map((blocker) => <li key={blocker} className="rounded-xl border border-amber-200/15 bg-amber-200/[0.04] p-2"><code>{blocker}</code></li>)}</ul>}
            </article>
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2" aria-labelledby={`${fixture.input.caseId}-shadow`}>
        <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.04] p-4">
          <h3 id={`${fixture.input.caseId}-shadow`} className="text-lg font-black">OS vs human · Shadow Mode</h3>
          <div className="mt-3 hidden grid-cols-[9rem_1fr_1fr_auto] gap-2 px-3 text-[10px] font-black uppercase tracking-wider text-white/40 sm:grid">
            <span>Field</span>
            <span>OS conclusion</span>
            <span>Expected human conclusion</span>
            <span>Status</span>
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            {comparison.checks.map((check) => (
              <div key={check.field} className="grid gap-2 rounded-xl border border-white/10 p-3 sm:grid-cols-[9rem_1fr_1fr_auto]">
                <dt className="font-black">{check.field}</dt>
                <dd className="break-words text-cyan-50"><span className="mr-1 text-[10px] font-black uppercase text-white/35 sm:hidden">OS:</span>{display(check.osValue)}</dd>
                <dd className="break-words text-violet-100"><span className="mr-1 text-[10px] font-black uppercase text-white/35 sm:hidden">Human:</span>{display(check.humanValue)}</dd>
                <dd className={check.status === "MATCH" ? "text-emerald-200" : "text-rose-200"}>{check.status}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm font-black">
            Differences: {comparison.differences.length === 0
              ? "none"
              : display(comparison.differences)}
          </p>
        </div>
        <div className="rounded-2xl border border-violet-200/20 bg-violet-200/[0.04] p-4">
          <h3 className="text-lg font-black">Creative brief · text only</h3>
          <p className="mt-1 text-xs text-white/45">No asset generation · canProduceAssets = false</p>
          <dl className="mt-3 grid gap-3 text-sm">
            <div><dt className="text-white/40">Status / source strategy</dt><dd className="mt-1 font-black">{evaluation.creativeBrief.status} · {evaluation.creativeBrief.sourceStrategy ?? "MISSING"}</dd></div>
            <div><dt className="text-white/40">Positioning</dt><dd className="mt-1 font-black">{evaluation.creativeBrief.positioning}</dd></div>
            <div><dt className="text-white/40">Hero composition</dt><dd className="mt-1 leading-6">{evaluation.creativeBrief.heroComposition}</dd></div>
            <div><dt className="text-white/40">Visible units / variants</dt><dd className="mt-1">{evaluation.creativeBrief.visualUnitCount} · {evaluation.creativeBrief.visibleVariants.join(", ")}</dd></div>
            <div><dt className="text-white/40">Approved proof</dt><dd className="mt-1">{evaluation.creativeBrief.approvedProof.length ? evaluation.creativeBrief.approvedProof.map((proof) => `${proof.label}: ${display(proof.normalizedValue)} [${proof.evidenceClass}]`).join(" · ") : "NONE"}</dd></div>
            <div><dt className="text-white/40">Omitted proof</dt><dd className="mt-1">{evaluation.creativeBrief.omittedProof.length ? evaluation.creativeBrief.omittedProof.map((proof) => `${proof.field}:${proof.reason}`).join(" · ") : "NONE"}</dd></div>
            <div><dt className="text-white/40">Forbidden terms</dt><dd className="mt-1">{evaluation.creativeBrief.prohibitedTerms.length ? evaluation.creativeBrief.prohibitedTerms.join(", ") : "NONE"}</dd></div>
          </dl>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-amber-200/20 bg-amber-200/[0.05] p-4">
        <h3 className="font-black">Blockers and next action</h3>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{evaluation.recommendation.blockers.map((blocker) => <li key={blocker} className="rounded-xl bg-black/25 p-3"><code>{blocker}</code></li>)}</ul>
        <p className="mt-3 text-sm">Una sola acción: <strong>{evaluation.recommendation.nextAction}</strong></p>
      </section>
    </article>
  )
}

export default function StrategyLabPage() {
  const safety = evaluatedCases.reduce(
    (total, item) => ({
      supabaseWrites: total.supabaseWrites + item.evaluation.safety.supabaseWrites,
      ebayWrites: total.ebayWrites + item.evaluation.safety.ebayWrites,
      openAiCalls: total.openAiCalls + item.evaluation.safety.openAiCalls,
      whatsappCalls: total.whatsappCalls + item.evaluation.safety.whatsappCalls,
      generatedImages: total.generatedImages + item.evaluation.safety.generatedImages,
      listingChanges: total.listingChanges + item.evaluation.safety.listingChanges,
    }),
    {
      supabaseWrites: 0,
      ebayWrites: 0,
      openAiCalls: 0,
      whatsappCalls: 0,
      generatedImages: 0,
      listingChanges: 0,
    },
  )

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-28 pt-6 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[32px] border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.10] via-violet-200/[0.04] to-black p-5 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a href="/admin/ebay-seller-os" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm font-black">← Seller OS</a>
            <span className="rounded-full border border-amber-200/30 bg-amber-200/[0.06] px-3 py-2 text-xs font-black text-amber-50">PURE · DETERMINISTIC · READ-ONLY</span>
          </div>
          <p className="mt-7 text-xs font-black uppercase tracking-[0.26em] text-cyan-100/55">Single Product Lab · Strategy Lab V1</p>
          <h1 className="mt-2 max-w-4xl text-3xl font-black leading-tight sm:text-5xl">Tres casos dorados; ninguna acción externa</h1>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-white/65">Fixtures sanitizados y versionados prueban clasificación de evidencia, cohorts, economía por escenario, recomendación, brief textual y comparación humana. No son un snapshot vigente del mercado.</p>
          <nav aria-label="Golden cases" className="mt-5 flex flex-wrap gap-2">
            {evaluatedCases.map(({ fixture }) => <a key={fixture.input.caseId} href={`#${fixture.input.caseId}`} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black">{fixture.input.productLabel}</a>)}
          </nav>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(safety).map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.04] p-3">
              <p className="break-words text-[10px] font-black uppercase tracking-wider text-emerald-100/45">{label}</p>
              <p className="mt-1 text-2xl font-black text-emerald-100">{value}</p>
            </div>
          ))}
        </section>

        <div className="mt-5 grid gap-5">
          {evaluatedCases.map((item) => (
            <CaseReport key={item.fixture.input.caseId} item={item} />
          ))}
        </div>
      </div>
      <SellerOsMobileNav active="operations" />
    </main>
  )
}
