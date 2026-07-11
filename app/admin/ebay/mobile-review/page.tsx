"use client"

import { useMemo, useRef, useState } from "react"

import fixtureJson from "@/tools/fixtures/ebay-mobile-review-page-mvp-v1.json"
import {
  applyMobileReviewAction,
  buildInitialMobileReviewState,
  buildMobileReviewCopyPasteSummary,
  buildMobileReviewDecision,
  type MobileReviewFixture,
} from "@/lib/ebay/ebay-mobile-review-page-mvp"

const fixture = fixtureJson as MobileReviewFixture

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-cyan-200/15 bg-cyan-200/[0.07] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-cyan-100/75">
      {children}
    </span>
  )
}

export default function EbayMobileReviewPage() {
  const [state, setState] = useState(() =>
    buildInitialMobileReviewState(fixture)
  )
  const [stockQuantity, setStockQuantity] = useState("20")
  const [lastActionMessage, setLastActionMessage] = useState(
    "Todavía no realizaste ninguna acción."
  )
  const confirmationRef = useRef<HTMLElement>(null)
  const decision = useMemo(() => buildMobileReviewDecision(state), [state])
  const summary = useMemo(
    () => buildMobileReviewCopyPasteSummary(state),
    [state]
  )

  const act = (action: Parameters<typeof applyMobileReviewAction>[1]) => {
    setState((current) => applyMobileReviewAction(current, action))
    const messages: Record<string, string> = {
      MARK_UNAVAILABLE:
        "Producto marcado como removido. B2-RUN quedó bloqueado y se recomienda refrescar el scan.",
      SELECT_CANDIDATE:
        "Candidato seleccionado. Continúa con mismo producto, stock e imagen.",
      CONFIRM_SAME_PRODUCT: "Mismo producto confirmado localmente.",
      CONFIRM_STOCK_QTY: `Stock local confirmado: ${stockQuantity} unidades.`,
      CONFIRM_IMAGE_OK: "Revisión visual confirmada localmente.",
      REQUEST_LUNA_SCAN_REFRESH: "Solicitud de refresco preparada localmente.",
      HOLD_FOR_REVIEW: "Decisión puesta en espera para revisión.",
      APPROVE_B2_RUN_PREFLIGHT:
        "Aprobación evaluada. Revisa la ruta resultante en el resumen.",
    }
    setLastActionMessage(messages[action.type] ?? "Acción local registrada.")
    if (action.type === "SELECT_CANDIDATE") {
      window.setTimeout(
        () => confirmationRef.current?.scrollIntoView({ behavior: "smooth" }),
        50
      )
    }
  }

  return (
    <main className="min-h-screen bg-[#05070d] px-4 py-6 text-white sm:px-6">
      <section className="mx-auto flex max-w-xl flex-col gap-5">
        <a
          href="/admin/ebay-seller-os"
          className="w-fit rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65"
        >
          ← eBay Seller OS
        </a>

        <header className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.06] p-5">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-100/55">
            Revisión privada · solo local
          </p>
          <h1 className="mt-3 text-3xl font-black leading-tight">
            Top 5 móvil
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/60">
            Confirma producto, disponibilidad, stock e imagen. Esta pantalla no
            guarda en bases de datos, no llama eBay y nunca publica.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill>{state.mobileReviewState}</StatusPill>
            <StatusPill>canPublish: false</StatusPill>
          </div>
        </header>

        <aside className="rounded-3xl border border-rose-300/20 bg-rose-300/[0.06] p-5">
          <p className="text-xs font-black uppercase tracking-widest text-rose-100/65">
            Fuente actual: fixture modelado · no es data viva
          </p>
          <p className="mt-3 text-sm leading-6 text-white/65">
            Este Top 5 viene del fixture del Approval Center. No se actualiza con
            el último scan, la base de datos ni eBay. Score, precio y categoría
            son señales modeladas hasta conectar una fuente read-only real.
          </p>
        </aside>

        <div
          aria-live="polite"
          className="sticky top-2 z-20 rounded-2xl border border-emerald-300/25 bg-[#102019]/95 p-4 text-sm font-bold leading-5 text-emerald-50 shadow-xl backdrop-blur"
        >
          Última acción: {lastActionMessage}
        </div>

        <article className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] p-5">
          <p className="text-xs font-black uppercase tracking-widest text-amber-100/60">
            Candidato anterior removido
          </p>
          <h2 className="mt-2 text-lg font-black">
            {fixture.previousCandidate.productName}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill>REMOVED_FROM_LUNA_SCAN</StatusPill>
            <StatusPill>STOCK_HOLD</StatusPill>
          </div>
          <p className="mt-3 text-sm text-white/55">
            No puede avanzar hasta obtener una observación fresca del scan.
          </p>
          <button
            type="button"
            onClick={() => act({ type: "REQUEST_LUNA_SCAN_REFRESH" })}
            className="mt-4 min-h-12 w-full rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-black"
          >
            REQUEST_LUNA_SCAN_REFRESH
          </button>
        </article>

        <div className="space-y-4">
          {state.candidates.map((candidate) => {
            const selected = state.selectedCandidateRank === candidate.candidateRank
            const unavailable =
              candidate.availabilityStatus === "REMOVED_FROM_LUNA_SCAN"
            return (
              <article
                key={candidate.candidateId}
                className={`rounded-3xl border p-5 ${
                  selected
                    ? "border-emerald-300/40 bg-emerald-300/[0.08]"
                    : "border-white/10 bg-white/[0.035]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-white/40">
                      Rank #{candidate.candidateRank}
                      {candidate.candidateRank === 1 ? " · Recomendado" : ""}
                    </p>
                    <p className="mt-2 text-xs font-bold text-cyan-100/65">
                      Estado: {candidate.availabilityStatus}
                    </p>
                    <h2 className="mt-2 text-xl font-black leading-6">
                      {candidate.productName}
                    </h2>
                  </div>
                  <span className="rounded-2xl bg-white/10 px-3 py-2 text-lg font-black">
                    {candidate.opportunityScore.toFixed(2)}
                    <span className="mt-1 block text-[9px] font-bold uppercase text-white/35">
                      score modelado
                    </span>
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-black/25 p-3">
                    <dt className="text-white/40">Precio sugerido</dt>
                    <dd className="mt-1 font-black">
                      {candidate.suggestedPrice.currency} {candidate.suggestedPrice.value.toFixed(2)}
                    </dd>
                    <dd className="mt-1 text-[10px] text-white/35">Fixture · no precio runtime</dd>
                  </div>
                  <div className="rounded-2xl bg-black/25 p-3">
                    <dt className="text-white/40">Categoría</dt>
                    <dd className="mt-1 font-black">{candidate.suggestedCategory}</dd>
                    <dd className="mt-1 text-[10px] text-white/35">Fixture · no Category ID</dd>
                  </div>
                </dl>

                <p className="mt-4 text-sm leading-6 text-white/55">
                  {candidate.listingBlueprintSummary}
                </p>
                <p className="mt-3 text-xs leading-5 text-white/40">
                  Riesgos: {candidate.riskFlags.length ? candidate.riskFlags.join(", ") : "ninguno modelado"}
                  <br />
                  Faltantes: {candidate.missingFields.join(", ") || "ninguno"}
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={unavailable}
                    onClick={() =>
                      act({ type: "SELECT_CANDIDATE", rank: candidate.candidateRank })
                    }
                    className="min-h-12 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Seleccionar candidato
                    <span className="block text-[10px]">SELECT_CANDIDATE</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      act({ type: "MARK_UNAVAILABLE", rank: candidate.candidateRank })
                    }
                    className="min-h-12 rounded-2xl border border-rose-300/30 px-4 py-3 text-sm font-black text-rose-100"
                  >
                    Marcar no disponible
                    <span className="block text-[10px]">MARK_UNAVAILABLE</span>
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        <section
          ref={confirmationRef}
          className="scroll-mt-20 rounded-3xl border border-white/10 bg-white/[0.035] p-5"
        >
          <h2 className="text-xl font-black">Confirmaciones del seleccionado</h2>
          <p className="mt-2 text-sm text-white/50">
            {decision.selectedCandidateName ?? "Selecciona primero un candidato del Top 5."}
          </p>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              disabled={!state.selectedCandidateRank}
              onClick={() => act({ type: "CONFIRM_SAME_PRODUCT" })}
              className="min-h-12 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-30"
            >
              CONFIRM_SAME_PRODUCT {state.sameProductConfirmed ? "✓" : ""}
            </button>
            <div className="flex gap-2">
              <input
                aria-label="Cantidad de stock confirmada"
                inputMode="numeric"
                value={stockQuantity}
                onChange={(event) => setStockQuantity(event.target.value)}
                className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-black/30 px-4 text-lg font-black outline-none"
              />
              <button
                type="button"
                disabled={!state.selectedCandidateRank}
                onClick={() =>
                  act({ type: "CONFIRM_STOCK_QTY", quantity: Number(stockQuantity) })
                }
                className="min-h-12 rounded-2xl bg-cyan-200 px-4 py-3 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-30"
              >
                CONFIRM_STOCK_QTY
              </button>
            </div>
            <button
              type="button"
              disabled={!state.selectedCandidateRank}
              onClick={() => act({ type: "CONFIRM_IMAGE_OK" })}
              className="min-h-12 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-30"
            >
              CONFIRM_IMAGE_OK {state.imageConfirmed ? "✓" : ""}
            </button>
            <button
              type="button"
              disabled={!state.selectedCandidateRank}
              onClick={() => act({ type: "APPROVE_B2_RUN_PREFLIGHT" })}
              className="min-h-14 w-full rounded-2xl bg-emerald-300 px-4 py-4 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-30"
            >
              APPROVE_B2_RUN_PREFLIGHT
            </button>
            <button
              type="button"
              onClick={() => act({ type: "HOLD_FOR_REVIEW" })}
              className="min-h-12 w-full rounded-2xl border border-amber-200/25 px-4 py-3 text-sm font-black text-amber-100"
            >
              HOLD_FOR_REVIEW
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-violet-300/15 bg-violet-300/[0.05] p-5">
          <p className="text-xs font-black uppercase tracking-widest text-violet-100/55">
            Decisión operativa copiable
          </p>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-black/40 p-4 text-xs leading-5 text-white/70">
            {summary}
          </pre>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(summary)}
            className="mt-3 min-h-12 w-full rounded-2xl border border-violet-200/25 px-4 py-3 text-sm font-black"
          >
            Copiar resumen
          </button>
        </section>

        <footer className="pb-8 text-center text-xs leading-5 text-white/35">
          Estado local y temporal. Sin WhatsApp real, Supabase, eBay API, write
          ni publicación. canPublish siempre es false.
        </footer>
      </section>
    </main>
  )
}
