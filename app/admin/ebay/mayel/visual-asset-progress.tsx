import type { visualAssetStatusV1 } from "@/lib/seller-os/mayel-visual-asset-status-v1"

export function MayelVisualAssetProgress({ status }: { status: ReturnType<typeof visualAssetStatusV1> }) {
  return <div data-visual-asset-status={status.status}>
    <div role="status" className={`mb-4 rounded-xl border p-3 text-sm font-semibold ${status.className}`}>
      {status.icon} {status.label}<p className="mt-1 font-normal">{status.action}</p>
    </div>
    <ol aria-label="Progreso de esta imagen" className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {status.steps.map(step => <li key={step.key} className="min-h-11 rounded-lg border p-2">{step.complete ? "✓" : "○"} {step.label}</li>)}
    </ol>
  </div>
}
