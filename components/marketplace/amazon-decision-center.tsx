import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  FileSearch,
  ShieldAlert,
} from "lucide-react"

import type {
  buildMarketplaceOsDashboardViewModel,
} from "@/lib/marketplace/marketplace-os-dashboard-view-model"

type DashboardViewModel = ReturnType<typeof buildMarketplaceOsDashboardViewModel>

function statusClasses(status: string) {
  if (status === "GREEN") {
    return "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100"
  }

  if (status === "YELLOW") {
    return "border-amber-300/25 bg-amber-300/[0.08] text-amber-100"
  }

  return "border-rose-300/25 bg-rose-300/[0.08] text-rose-100"
}

function decisionLabel(value: string) {
  return value.replaceAll("_", " ")
}

export function AmazonDecisionCenter({
  viewModel,
}: {
  viewModel: DashboardViewModel
}) {
  return (
    <section className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
            Products
          </p>
          <p className="mt-3 text-3xl font-black text-white">
            {viewModel.metrics.productsEvaluated}
          </p>
        </div>
        <div className="rounded-lg border border-rose-300/20 bg-rose-300/[0.045] p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-100/55">
            Blocked
          </p>
          <p className="mt-3 text-3xl font-black text-white">
            {viewModel.metrics.productsBlockedFromListingPackage}
          </p>
        </div>
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.045] p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/55">
            Human Review
          </p>
          <p className="mt-3 text-3xl font-black text-white">
            {viewModel.metrics.productsRequiringHumanReview}
          </p>
        </div>
        <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.045] p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            Avg ASIN Score
          </p>
          <p className="mt-3 text-3xl font-black text-white">
            {viewModel.metrics.averageAsinDecisionScore}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/25">
        <div className="grid gap-3 border-b border-white/10 px-5 py-4 md:grid-cols-[1.2fr_0.9fr_0.7fr_0.8fr_0.8fr]">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Product
          </p>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Route
          </p>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Match
          </p>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Profit
          </p>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Gate
          </p>
        </div>

        <div className="divide-y divide-white/10">
          {viewModel.productRows.map((row) => (
            <article
              key={row.supplierSku}
              className="grid gap-4 px-5 py-5 md:grid-cols-[1.2fr_0.9fr_0.7fr_0.8fr_0.8fr]"
            >
              <div>
                <p className="text-sm font-black text-white">
                  {row.productTitle}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {row.brand} · {row.supplierSku}
                </p>
              </div>

              <div>
                <p className="text-sm font-black text-cyan-100">
                  {decisionLabel(row.finalAsinRouteDecision)}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  Next: {decisionLabel(row.nextRecommendedAction)}
                </p>
              </div>

              <div>
                <p className="text-sm font-black text-white">
                  {row.matchConfidenceScore}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {decisionLabel(row.catalogMatchType)}
                </p>
              </div>

              <div>
                <p className="text-sm font-black text-white">
                  ${row.netProfitEstimate.toFixed(2)} · {row.roiPercent.toFixed(2)}%
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {decisionLabel(row.profitGuardDecision)}
                </p>
              </div>

              <div>
                <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-black ${statusClasses(row.semanticStatus)}`}>
                  {row.semanticStatus}
                </span>
                <p className="mt-2 text-xs text-white/50">
                  Listing package: {row.canProceedToAmazonListingPackage ? "ready" : "blocked"}
                </p>
              </div>

              <div className="md:col-span-5">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex items-center gap-2 text-rose-100">
                      <Ban className="h-4 w-4" />
                      <p className="text-xs font-black uppercase tracking-[0.16em]">
                        Blocks
                      </p>
                    </div>
                    <ul className="mt-3 grid gap-2 text-sm leading-6 text-white/65">
                      {row.blockedReasons.map(reason => (
                        <li key={reason}>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex items-center gap-2 text-amber-100">
                      <ShieldAlert className="h-4 w-4" />
                      <p className="text-xs font-black uppercase tracking-[0.16em]">
                        Warnings
                      </p>
                    </div>
                    <ul className="mt-3 grid gap-2 text-sm leading-6 text-white/65">
                      {row.warnings.map(warning => (
                        <li key={warning}>
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center gap-2 text-cyan-100">
            <FileSearch className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              Decision Rules
            </h2>
          </div>
          <p className="mt-4 text-sm leading-7 text-white/65">
            A profitable product does not automatically pass to listing. Existing ASIN evidence still needs Seller Central eligibility, compliance review, and human approval.
          </p>
          <p className="mt-3 text-sm leading-7 text-white/65">
            Codex Self-Improvement and Codex Handoff stay roadmap-only here: the dashboard can explain future work orders, but it cannot execute code changes or connect a Codex API.
          </p>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center gap-2 text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              Seller Central
            </h2>
          </div>
          <p className="mt-4 text-sm leading-7 text-white/65">
            This dashboard is not Seller Central. It is a local decision center and never writes to Amazon, creates ASINs, creates listings, or publishes offers.
          </p>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center gap-2 text-emerald-100">
            <CheckCircle2 className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              Next Actions
            </h2>
          </div>
          <ul className="mt-4 grid gap-2 text-sm leading-6 text-white/65">
            {viewModel.nextActions.map(action => (
              <li key={action}>
                {action}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}
