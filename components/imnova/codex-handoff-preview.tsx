import type {
  buildCodexHandoffQueue,
} from "@/lib/imnova/imnova-self-improvement-codex-handoff"

type HandoffQueue =
  ReturnType<typeof buildCodexHandoffQueue>

export function CodexHandoffPreview({
  queue,
}: {
  queue: HandoffQueue
}) {
  const firstPackage =
    queue[0]

  return (
    <section className="rounded-lg border border-violet-300/20 bg-violet-300/[0.045] p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-100/60">
            Codex Handoff Builder
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">
            Prompt seguro para copiar manualmente
          </h2>
        </div>
        <p className="rounded-md border border-violet-300/20 bg-black/25 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-violet-100">
          Manual copy only
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-3">
          {[
            "Codex API: not connected",
            "OpenAI API: not used",
            "Automatic code changes: disabled",
            "Branch automation: disabled",
            "PR automation: disabled",
            "Merge automation: disabled",
            "Human approval: required",
          ].map(item => (
            <div
              key={item}
              className="rounded-lg border border-white/10 bg-black/25 p-3 text-sm font-semibold text-white/70"
            >
              {item}
            </div>
          ))}
        </div>

        <article className="rounded-lg border border-white/10 bg-black/30 p-4">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Work order preview
          </p>
          <p className="mt-3 text-sm font-black text-white">
            {firstPackage?.workOrder.objective || "No work order built"}
          </p>
          <p className="mt-2 break-words text-xs text-cyan-100/70">
            {firstPackage?.workOrder.branchName || "No branch suggested"}
          </p>
          <pre className="mt-4 max-h-[360px] overflow-auto rounded-lg border border-white/10 bg-black/45 p-4 text-xs leading-5 text-white/65">
            {firstPackage?.handoffPrompt || "No prompt available"}
          </pre>
        </article>
      </div>
    </section>
  )
}
