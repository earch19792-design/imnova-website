const safetyBadges = [
  "Read-only",
  "Dry-run",
  "No eBay API",
  "No real draft",
  "Not published",
  "Human review required",
]

const safetyFlags = [
  ["advisoryOnly", "true"],
  ["localOnly", "true"],
  ["externalCallsMade", "false"],
  ["ebayApiUsed", "false"],
  ["realDraftCreated", "false"],
  ["publishedToEbay", "false"],
  ["listingMutated", "false"],
  ["requiresHumanReview", "true"],
]

const simulatedExamples = [
  {
    caseId: "LISTING-GEN-001",
    listingState: "LISTING_DRAFT_READY",
    qaState: "QA_PASSED_FOR_HUMAN_REVIEW",
    recommendedDecision: "PROCEED_TO_HUMAN_REVIEW",
    tone: "border-emerald-300/20 bg-emerald-300/[0.05]",
  },
  {
    caseId: "LISTING-GEN-004",
    listingState: "LISTING_BLOCKED",
    qaState: "QA_BLOCKED",
    recommendedDecision: "BLOCK_DO_NOT_ADVANCE",
    tone: "border-red-300/20 bg-red-300/[0.05]",
  },
  {
    caseId: "LISTING-GEN-006",
    listingState: "LISTING_REVIEW_REQUIRED",
    qaState: "QA_REVIEW_REQUIRED",
    recommendedDecision: "REVIEW_ECONOMICS",
    tone: "border-amber-300/20 bg-amber-300/[0.05]",
  },
]

const disabledActions = [
  "No publish",
  "No real draft",
  "No eBay sync",
  "No listing mutation",
  "No OAuth",
  "No Supabase write",
]

export default function EbayListingProposalsPage() {
  return (
    <main className="min-h-screen bg-[#05070d] px-6 py-8 text-white md:px-10 lg:px-14">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <a
          href="/admin"
          className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/70 transition hover:border-cyan-300/30 hover:text-cyan-100"
        >
          Back to Admin
        </a>

        <section className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-100/60">
                Read-only dry-run visibility
              </p>
              <h1 className="mt-4 text-4xl font-black tracking-[-0.03em] text-white md:text-5xl">
                eBay Listing Proposals
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">
                This screen is advisory-only. No eBay action is performed.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {safetyBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-white/70"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Data status
            </h2>
            <div className="mt-5 grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-white/40">
                  Data source
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  not connected yet
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-white/40">
                  Future source
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  safe reviewReport export / read-only data contract
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Safety flags
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {safetyFlags.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <span className="text-xs text-white/45">
                    {label}
                  </span>
                  <span className="text-sm font-black text-cyan-100">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/50">
                Simulated examples
              </p>
              <h2 className="mt-2 text-2xl font-black text-white">
                Placeholder review states
              </h2>
            </div>
            <p className="text-sm text-white/45">
              Static fixture examples only. No real product data.
            </p>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            {simulatedExamples.map((example) => (
              <article
                key={example.caseId}
                className={`rounded-3xl border p-5 ${example.tone}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">
                  {example.caseId}
                </p>
                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-xs text-white/40">
                      listingState
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {example.listingState}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">
                      qaState
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {example.qaState}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">
                      recommendedDecision
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {example.recommendedDecision}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-red-300/15 bg-red-300/[0.04] p-6">
          <h2 className="text-lg font-black text-white">
            Actions disabled in V1
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {disabledActions.map((action) => (
              <div
                key={action}
                className="rounded-2xl border border-red-200/10 bg-black/20 px-4 py-3 text-sm font-semibold text-red-50/80"
              >
                {action}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
