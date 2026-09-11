import type { visualAssetStatusV1 } from "@/lib/seller-os/mayel-visual-asset-status-v1"

export function MayelVisualAssetProgress({ status }: { status: ReturnType<typeof visualAssetStatusV1> }) {
  return <div data-visual-asset-status={status.status} data-mayel-workflow-state={status.mayelWorkflowState}
    data-listing-operational-health={status.listingOperationalHealth} data-owner-action-state={status.ownerActionState}>
    <div role="status" className={`mb-4 rounded-xl border p-3 text-sm font-semibold ${status.className}`}>
      {status.icon} {status.label}<p className="mt-1 font-normal">{status.action}</p>
    </div>
    <ol aria-label="Progreso de esta imagen" className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 text-sm">
      {status.steps.map(step => <li key={step.key} className={`min-h-11 rounded-lg border p-2 ${step.complete ? step.key === "ebay" ? "border-green-300 bg-green-50 text-green-900" : step.key === "qa" ? "border-violet-300 bg-violet-50 text-violet-900" : "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-600"}`}>{step.complete ? "✓" : "○"} {step.label}</li>)}
    </ol>
  </div>
}
