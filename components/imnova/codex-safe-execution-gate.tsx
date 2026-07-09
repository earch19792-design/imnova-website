import type {
  buildCodexSafeExecutionGateQueue,
  summarizeCodexSafeExecutionGateQueue,
} from "@/lib/imnova/imnova-codex-api-safe-execution-gate"

type GateQueue =
  ReturnType<typeof buildCodexSafeExecutionGateQueue>

type GateSummary =
  ReturnType<typeof summarizeCodexSafeExecutionGateQueue>

function statusTone(decision: string) {
  if (decision === "APPROVED_FOR_LOCAL_DRY_RUN_PREVIEW") {
    return "border-emerald-300/25 bg-emerald-300/[0.06] text-emerald-100"
  }

  if (decision.includes("SECRET") || decision.includes("HIGH_RISK")) {
    return "border-red-300/25 bg-red-300/[0.06] text-red-100"
  }

  return "border-amber-300/25 bg-amber-300/[0.06] text-amber-100"
}

export function CodexSafeExecutionGate({
  queue,
  summary,
}: {
  queue: GateQueue
  summary: GateSummary
}) {
  return (
    <section className="grid gap-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Codex API", "disabled in this loop"],
          ["External network", "disabled"],
          ["Automatic code changes", "disabled"],
          ["Human approval", "required"],
        ].map(([label, value]) => (
          <article
            className="rounded-lg border border-white/10 bg-white/[0.035] p-5"
            key={label}
          >
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
              {label}
            </p>
            <p className="mt-3 text-lg font-black text-white">
              {value}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/60">
          Gate summary
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ["Plans", summary.executionPlansBuilt],
            ["Preview approved", summary.approvedForDryRunPreview],
            ["Missing approval", summary.blockedMissingHumanApproval],
            ["Secret blocked", summary.blockedSecretDetected],
            ["High risk", summary.blockedHighRisk],
            ["Redactions", summary.redactionCount],
          ].map(([label, value]) => (
            <div
              className="rounded-lg border border-white/10 bg-black/25 p-4"
              key={label}
            >
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                {label}
              </p>
              <p className="mt-2 text-xl font-black text-white">
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4">
        {queue.map(item => {
          const plan =
            item.executionPlan

          return (
            <article
              className="rounded-lg border border-white/10 bg-white/[0.035] p-5"
              key={plan.workOrderKey}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                    {plan.improvementKey}
                  </p>
                  <h2 className="mt-2 text-xl font-black text-white">
                    {plan.objective}
                  </h2>
                  <p className="mt-2 break-words text-sm font-semibold text-cyan-100/70">
                    {plan.proposedBranch}
                  </p>
                </div>

                <div className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] ${statusTone(item.executionDecision)}`}>
                  {item.executionDecision}
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {[
                  ["Risk", plan.riskLevel],
                  ["Human approval", plan.humanApprovalPresent ? "present" : "missing"],
                  ["Can call API", plan.canCallCodexApi ? "yes" : "no"],
                  ["Can create PR", plan.canCreatePr ? "yes" : "no"],
                ].map(([label, value]) => (
                  <div
                    className="rounded-lg border border-white/10 bg-black/25 p-3"
                    key={label}
                  >
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-white/40">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-black text-white">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/25 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                    Blocked reasons
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {plan.blockedReasons.length > 0
                      ? plan.blockedReasons.map(reason => (
                        <span
                          className="rounded-md border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs font-bold text-red-100"
                          key={reason}
                        >
                          {reason}
                        </span>
                      ))
                      : (
                        <span className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2 text-xs font-bold text-emerald-100">
                          Safe for local dry-run preview only
                        </span>
                      )}
                  </div>
                  <p className="mt-4 text-sm font-semibold text-white/65">
                    Next action: {plan.nextRecommendedAction}
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/25 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                    Sanitized prompt preview
                  </p>
                  <pre className="mt-3 max-h-[240px] overflow-auto rounded-md border border-white/10 bg-black/35 p-3 text-xs leading-5 text-white/65">
                    {plan.sanitizedPromptPreview}
                  </pre>
                </div>
              </div>
            </article>
          )
        })}
      </section>

      <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.055] p-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/65">
          Safety notices
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            "No real Codex API call is executed.",
            "No branch, PR or merge is created automatically.",
            "This page is a safety gate, not an execution runner.",
          ].map(notice => (
            <div
              className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm font-bold text-white/70"
              key={notice}
            >
              {notice}
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
