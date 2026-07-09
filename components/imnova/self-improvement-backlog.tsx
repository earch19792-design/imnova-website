import type {
  buildCodexHandoffQueue,
} from "@/lib/imnova/imnova-self-improvement-codex-handoff"

type HandoffQueue =
  ReturnType<typeof buildCodexHandoffQueue>

export function SelfImprovementBacklog({
  queue,
}: {
  queue: HandoffQueue
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/25 p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            Backlog de automejora
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">
            Mejoras propuestas por IMNOVA OS
          </h2>
        </div>
        <p className="rounded-md border border-amber-300/20 bg-amber-300/[0.08] px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-amber-100">
          Requiere aprobacion humana
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {queue.map(item => (
          <article
            key={item.backlogItem.improvementKey}
            className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-black text-white">
                  {item.backlogItem.title}
                </p>
                <p className="mt-1 text-xs text-white/45">
                  {item.backlogItem.sourceModule}
                </p>
              </div>
              <span className="rounded-md border border-cyan-300/20 bg-cyan-300/[0.08] px-2.5 py-1 text-xs font-black text-cyan-100">
                {item.backlogItem.priorityScore}
              </span>
            </div>

            <p className="mt-4 text-sm leading-6 text-white/65">
              {item.backlogItem.problemStatement}
            </p>
            <p className="mt-3 text-sm leading-6 text-white/55">
              {item.backlogItem.whyItMatters}
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <span className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-white/60">
                Impacto: {item.backlogItem.expectedImpact}
              </span>
              <span className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-white/60">
                Riesgo: {item.backlogItem.implementationRisk}
              </span>
              <span className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-white/60">
                {item.backlogItem.codexHandoffMode}
              </span>
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                Branch sugerida
              </p>
              <p className="mt-2 break-words text-sm font-semibold text-cyan-100">
                {item.backlogItem.suggestedBranchName}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
