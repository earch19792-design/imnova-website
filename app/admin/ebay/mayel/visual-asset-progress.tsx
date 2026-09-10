import type { visualAssetStatusV1 } from "@/lib/seller-os/mayel-visual-asset-status-v1"

export function MayelVisualAssetProgress({ status }: { status: ReturnType<typeof visualAssetStatusV1> }) {
  return <div data-visual-asset-status={status.status}>
    <div role="status" className={`mb-4 rounded-xl border p-3 text-sm font-semibold ${status.className}`}>
      {status.status === "MEJORA_GENERADA" ? <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" className="inline-block align-text-bottom" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></svg> :
        status.status === "PENDING_EBAY_SYNC" ? <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" className="inline-block align-text-bottom" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4"/></svg> : status.icon} {status.label}<p className="mt-1 font-normal">{status.action}</p>
    </div>
    <ol aria-label="Progreso de esta imagen" className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 text-sm">
      {status.steps.map(step => <li key={step.key} className="min-h-11 rounded-lg border p-2">{step.complete ? "✓" : "○"} {step.label}</li>)}
    </ol>
  </div>
}
