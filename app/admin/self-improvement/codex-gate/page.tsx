import fixture from "../../../../tools/fixtures/imnova-codex-api-safe-execution-gate-v1.json"

import {
  CodexSafeExecutionGate,
} from "@/components/imnova/codex-safe-execution-gate"
import {
  buildCodexSafeExecutionGateQueue,
  summarizeCodexSafeExecutionGateQueue,
} from "@/lib/imnova/imnova-codex-api-safe-execution-gate"

export default function CodexSafeExecutionGatePage() {
  const queue =
    buildCodexSafeExecutionGateQueue(fixture)
  const summary =
    summarizeCodexSafeExecutionGateQueue(
      queue,
      fixture,
    )

  return (
    <main className="min-h-screen bg-[#05070d] px-5 py-8 text-white md:px-10">
      <section className="mx-auto grid max-w-7xl gap-7">
        <div className="flex flex-wrap gap-3">
          <a
            className="w-fit rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/70"
            href="/admin/self-improvement"
          >
            Volver a Self-Improvement
          </a>
          <a
            className="w-fit rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/70"
            href="/admin"
          >
            Volver a Admin
          </a>
        </div>

        <header className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] p-6 md:p-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">
            Local safety gate - no API - no execution runner
          </p>
          <h1 className="mt-4 text-3xl font-black text-white md:text-5xl">
            Codex Safe Execution Gate
          </h1>
          <p className="mt-3 text-xl font-black text-cyan-100">
            Future Codex API connection design with human approval first
          </p>
          <p className="mt-5 max-w-4xl text-sm leading-7 text-white/65">
            Esta pantalla simula que pasaria con los work orders de IMNOVA antes de cualquier futura ejecucion con Codex. No llama APIs, no crea ramas, no crea PRs, no hace merge, no toca Production y no toca main.
          </p>
        </header>

        <CodexSafeExecutionGate
          queue={queue}
          summary={summary}
        />
      </section>
    </main>
  )
}
