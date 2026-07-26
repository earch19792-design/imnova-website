import {
  getSellerOsStatusPresentation,
  type SellerOsVisualState,
} from "@/lib/seller-os/status-presentation"

const toneClasses = {
  neutral: "border-slate-300/25 bg-slate-300/10 text-slate-100",
  info: "border-cyan-200/30 bg-cyan-200/10 text-cyan-50",
  success: "border-emerald-200/30 bg-emerald-200/10 text-emerald-50",
  warning: "border-amber-200/35 bg-amber-200/10 text-amber-50",
  danger: "border-rose-200/35 bg-rose-200/10 text-rose-50",
} as const

export function StatusBadge({
  state,
  className = "",
  showDescription = false,
}: {
  state: SellerOsVisualState
  className?: string
  showDescription?: boolean
}) {
  const presentation = getSellerOsStatusPresentation(state)

  return (
    <span
      className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${toneClasses[presentation.tone]} ${className}`}
      data-seller-os-status={state}
      title={presentation.description}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
      <span>{presentation.label}</span>
      {showDescription && <span className="font-normal opacity-75">- {presentation.description}</span>}
    </span>
  )
}
