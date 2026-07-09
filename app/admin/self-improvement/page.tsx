import fixture from "../../../tools/fixtures/imnova-self-improvement-codex-handoff-v1.json"

import {
  CodexHandoffPreview,
} from "@/components/imnova/codex-handoff-preview"
import {
  SelfImprovementBacklog,
} from "@/components/imnova/self-improvement-backlog"
import {
  buildCodexHandoffQueue,
  summarizeCodexHandoffQueue,
} from "@/lib/imnova/imnova-self-improvement-codex-handoff"

export default function SelfImprovementPage() {
  const queue =
    buildCodexHandoffQueue(fixture)
  const summary =
    summarizeCodexHandoffQueue(queue)

  return (
    <main className="min-h-screen bg-[#05070d] px-5 py-8 text-white md:px-10">
      <section className="mx-auto grid max-w-7xl gap-7">
        <a
          className="w-fit rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/70"
          href="/admin"
        >
          Volver a Admin
        </a>

        <header className="rounded-lg border border-violet-300/15 bg-violet-300/[0.045] p-6 md:p-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-100/60">
            Manual approval only - local dry-run - no API
          </p>
          <h1 className="mt-4 text-3xl font-black text-white md:text-5xl">
            IMNOVA Self-Improvement
          </h1>
          <p className="mt-3 text-xl font-black text-violet-100">
            Codex Handoff Builder - manual approval only
          </p>
          <p className="mt-5 max-w-4xl text-sm leading-7 text-white/65">
            Convierte oportunidades de mejora en backlog, work orders y prompts seguros para copiar manualmente a Codex. No conecta Codex API, no crea ramas, no crea PRs y no ejecuta cambios automaticos.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Codex API", "not connected"],
            ["OpenAI API", "not used"],
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

        <section className="rounded-lg border border-white/10 bg-black/25 p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/55">
            Dry-run summary
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Backlog", summary.backlogItemsBuilt],
              ["Work orders", summary.codexWorkOrdersBuilt],
              ["Prompts", summary.codexHandoffPromptsBuilt],
              ["Sanitized", summary.promptsSanitized ? "yes" : "no"],
              ["Secrets", summary.secretsDetected ? "detected" : "none"],
              ["Mode", "manual"],
            ].map(([label, value]) => (
              <div
                className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
                key={label}
              >
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
                  {label}
                </p>
                <p className="mt-2 text-lg font-black text-white">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <SelfImprovementBacklog queue={queue} />
        <CodexHandoffPreview queue={queue} />

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
            Roadmap
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              "149CODEX-A actual: backlog + handoff manual",
              "149CODEX-B futuro: Codex API con safe execution gate",
              "149G despues: Amazon Listing Package Builder",
            ].map(item => (
              <div
                className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm font-semibold text-white/70"
                key={item}
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}
