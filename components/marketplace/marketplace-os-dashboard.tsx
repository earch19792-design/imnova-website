import {
  Boxes,
  GitBranch,
  Lock,
  PauseCircle,
  RadioTower,
  ShieldCheck,
} from "lucide-react"

import {
  AmazonDecisionCenter,
} from "@/components/marketplace/amazon-decision-center"
import type {
  buildMarketplaceOsDashboardViewModel,
} from "@/lib/marketplace/marketplace-os-dashboard-view-model"

type DashboardViewModel = ReturnType<typeof buildMarketplaceOsDashboardViewModel>

const pipelineSteps = [
  "149A Product Winner Metrics",
  "149B Seller Account + Category Gate",
  "149C Catalog Matcher",
  "149D Restriction Gate",
  "149E Fees + ROI",
  "149F ASIN Decision Engine",
  "149G Listing Package Builder next",
]

export function MarketplaceOsDashboard({
  viewModel,
}: {
  viewModel: DashboardViewModel
}) {
  return (
    <main className="min-h-screen bg-[#05070d] px-5 py-8 text-white md:px-10">
      <section className="mx-auto grid max-w-7xl gap-7">
        <a
          href="/admin"
          className="w-fit rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/70"
        >
          Volver a Admin
        </a>

        <header className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] p-6 md:p-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/55">
            Local decision layer · no API · no publication
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="text-3xl font-black text-white md:text-5xl">
                IMNOVA Marketplace OS
              </h1>
              <p className="mt-3 text-xl font-black text-cyan-100">
                Amazon Decision Center
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Version
              </p>
              <p className="mt-2 text-sm font-black text-white">
                {viewModel.dashboardVersion}
              </p>
            </div>
          </div>
          <p className="mt-5 max-w-4xl text-sm leading-7 text-white/65">
            Read-only command view for Marketplace Seller OS. It shows Amazon route decisions, blocked products, human review requirements, and roadmap previews without touching Seller Central, Amazon API, eBay Production, WhatsApp, OpenAI, Production, or Staging DB.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-lg border border-amber-300/20 bg-amber-300/[0.045] p-5">
            <div className="flex items-center gap-2 text-amber-100">
              <PauseCircle className="h-4 w-4" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">
                eBay Track
              </h2>
            </div>
            <p className="mt-4 text-lg font-black text-white">
              {viewModel.ebayTrack.status}
            </p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              {viewModel.ebayTrack.reason}. {viewModel.ebayTrack.nextAction}.
            </p>
          </article>

          <article className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.045] p-5">
            <div className="flex items-center gap-2 text-emerald-100">
              <RadioTower className="h-4 w-4" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">
                Amazon Track
              </h2>
            </div>
            <p className="mt-4 text-lg font-black text-white">
              {viewModel.amazonTrack.status}
            </p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              Next: {viewModel.amazonTrack.nextRecommendedLoop}. Optional UI: {viewModel.amazonTrack.optionalUiLoop}.
            </p>
          </article>

          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center gap-2 text-cyan-100">
              <Lock className="h-4 w-4" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">
                Production
              </h2>
            </div>
            <p className="mt-4 text-lg font-black text-white">
              {viewModel.production.status}
            </p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              All marketplace actions remain local, dry-run, and read-only.
            </p>
          </article>
        </section>

        <section className="rounded-lg border border-white/10 bg-black/25 p-5">
          <div className="flex items-center gap-2 text-cyan-100">
            <Boxes className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              Amazon Pipeline
            </h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {pipelineSteps.map(step => (
              <div
                key={step}
                className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
              >
                <p className="text-sm font-black text-white">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </section>

        <AmazonDecisionCenter viewModel={viewModel} />

        <section className="rounded-lg border border-violet-300/20 bg-violet-300/[0.045] p-5">
          <div className="flex items-center gap-2 text-violet-100">
            <GitBranch className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              IMNOVA Self-Improvement / Codex Roadmap
            </h2>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
            <div>
              <p className="text-lg font-black text-white">
                {viewModel.codexSelfImprovement.status}
              </p>
              <p className="mt-3 text-sm leading-7 text-white/65">
                IMNOVA OS will be able to detect internal improvement opportunities, generate work orders/prompts for Codex, and route them through a human approval gate before any implementation work starts.
              </p>
              <p className="mt-3 text-sm leading-7 text-white/65">
                Codex API is not connected in this loop. There are no automatic code changes, no automatic merge, no main branch writes, no Production touch, and no secrets in prompts.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Strategic sequence
              </p>
              <p className="mt-3 text-sm font-black text-white">
                {viewModel.codexSelfImprovement.nextPlannedLoop}
              </p>
              <p className="mt-3 text-sm font-black text-white">
                {viewModel.codexSelfImprovement.futureApiLoop}
              </p>
              <p className="mt-3 text-sm font-black text-cyan-100">
                Then continue Amazon: {viewModel.thenContinueToAmazonListingPackageBuilder}
              </p>
              <button
                className="mt-5 rounded-md border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/35"
                disabled
                type="button"
              >
                Handoff preview only
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center gap-2 text-cyan-100">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              WhatsApp + Automation Roadmap
            </h2>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {viewModel.roadmap.map(item => (
              <article
                key={item.name}
                className="rounded-lg border border-white/10 bg-black/25 p-4"
              >
                <p className="text-sm font-black text-white">
                  {item.name}
                </p>
                <p className="mt-2 text-sm text-cyan-100/70">
                  {item.status}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/50">
                  {item.safety}
                </p>
                <button
                  className="mt-4 rounded-md border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/35"
                  disabled
                  type="button"
                >
                  Preview only
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}
