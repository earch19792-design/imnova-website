import { visualAssetStatusV1, visualEvidenceV1, type VisualSyncPresentationV1 } from "./mayel-visual-asset-status-v1"

export function proposalSlotLabelV1(position: number, sourcePosition: number | null, action: string) {
  const slot = position === 0 ? "Principal" : `Imagen ${position + 1}`
  return { slot, action: action === "ADD" ? `Agregar como imagen ${position + 1}` : action === "REPLACE" || action === "REPLACE_MAIN"
    ? `Reemplazar ${sourcePosition === 0 ? "la principal" : `imagen ${(sourcePosition ?? position) + 1}`}` : action === "REMOVE" ? "Eliminar de eBay" : action === "REORDER" ? "Mover" : "Conservar original" }
}

export function proposalDeliveryStatusV1(input: VisualSyncPresentationV1) {
  if (input.discarded || input.state === "SUPERSEDED") return { kind: "ARCHIVED", label: "Archivada · No se enviará a eBay", tone: "bg-gray-100 text-gray-700" }
  if (input.rejected) return { kind: "REJECTED", label: "Rechazada · No se enviará a eBay", tone: "bg-slate-100 text-slate-700" }
  const status = visualAssetStatusV1(visualEvidenceV1(input))
  return { kind: status.synced ? "SYNCED" : status.status === "REQUIRES_ATTENTION" ? "ATTENTION" : status.status === "PENDING_EBAY_SYNC" ? "PENDING" : "SAVED",
    label: `${status.icon} ${status.label}`, tone: status.className }
}
