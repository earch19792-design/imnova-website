"use client"

export type SellerJourneyStep = 1 | 2 | 3 | 4

const steps = [
  { id: 1, label: "Elegir" },
  { id: 2, label: "Luna" },
  { id: 3, label: "eBay" },
  { id: 4, label: "Preparar" },
] as const

export function SellerJourneyGuide({ currentStep, title, instruction, actionLabel, onAction, missingCount = 0 }: { currentStep: SellerJourneyStep; title: string; instruction: string; actionLabel: string; onAction: () => void; missingCount?: number }) {
  return (
    <section aria-labelledby="seller-journey-heading" className="rounded-3xl border border-cyan-200/25 bg-[#101722] p-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/65">Ruta recomendada</p>
        {missingCount > 0 && <span className="rounded-full bg-rose-500 px-2.5 py-1 text-xs font-black text-white" role="status">{missingCount} pendiente{missingCount === 1 ? "" : "s"}</span>}
      </div>
      <ol className="mt-3 grid grid-cols-4 gap-1" aria-label={`Paso ${currentStep} de 4`}>
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
      <button type="button" onClick={onAction} className="mt-4 min-h-12 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{actionLabel} →</button>
    </section>
  )
}
