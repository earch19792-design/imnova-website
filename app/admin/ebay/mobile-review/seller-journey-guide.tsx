"use client"

export type SellerJourneyStep = 1 | 2 | 3 | 4

const steps = [
  { id: 1, label: "Elegir" },
  { id: 2, label: "Luna" },
  { id: 3, label: "eBay" },
  { id: 4, label: "Preparar" },
] as const

export function SellerJourneyGuide({ currentStep, title, instruction, actionLabel, onAction, missingCount = 0, systemTask, userTask, pendingLabel }: { currentStep: SellerJourneyStep; title: string; instruction: string; actionLabel: string; onAction: () => void; missingCount?: number; systemTask: string; userTask: string; pendingLabel: string }) {
  return (
    <section aria-labelledby="seller-journey-heading" className="rounded-3xl border border-cyan-200/35 bg-gradient-to-br from-cyan-200/[0.12] via-[#101722] to-[#101722] p-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">Asistente Seller OS</p><p className="mt-1 text-[11px] font-bold text-white/45">Te muestra sólo la siguiente tarea</p></div>
        {missingCount > 0 && <span className="max-w-[12rem] rounded-full bg-rose-500 px-2.5 py-1 text-center text-xs font-black text-white" role="status">{pendingLabel}</span>}
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-1" aria-label={`Paso ${currentStep} de 4`}>
        {steps.map((step) => {
          const complete = step.id < currentStep
          const current = step.id === currentStep
          return <li key={step.id} aria-current={current ? "step" : undefined} className="min-w-0">
            <div className={`h-1.5 rounded-full ${complete ? "bg-emerald-300" : current ? "bg-cyan-200" : "bg-white/10"}`} />
            <span className={`mt-1.5 block truncate text-[10px] font-black ${current ? "text-white" : complete ? "text-emerald-100" : "text-white/35"}`}>{complete ? "✓ " : `${step.id} `}{step.label}</span>
          </li>
        })}
      </ol>
      <p className="mt-4 text-xs font-bold text-cyan-100/70">Paso {currentStep} de 4</p>
      <h2 id="seller-journey-heading" className="mt-1 text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/65">{instruction}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-3"><p className="text-[10px] font-black uppercase tracking-wider text-emerald-100/60">Seller OS hace</p><p className="mt-1 text-sm font-bold leading-5 text-emerald-50">{systemTask}</p></div>
        <div className="rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.07] p-3"><p className="text-[10px] font-black uppercase tracking-wider text-cyan-100/60">Te toca ahora</p><p className="mt-1 text-sm font-black leading-5 text-white">{userTask}</p></div>
      </div>
      <button type="button" onClick={onAction} className="mt-4 min-h-12 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{actionLabel} →</button>
      <details className="mt-3 border-t border-white/10 pt-3"><summary className="cursor-pointer text-xs font-bold text-white/50">Ver la ruta completa</summary><p className="mt-2 text-xs leading-5 text-white/55">1. Elegir producto · 2. Confirmar Luna · 3. Validar eBay · 4. Revisar y preparar. Los pasos futuros permanecen bloqueados hasta completar el actual.</p></details>
    </section>
  )
}
