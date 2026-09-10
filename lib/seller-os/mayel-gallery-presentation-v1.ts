export function proposalSlotLabelV1(position: number, sourcePosition: number | null, action: string) {
  const slot = position === 0 ? "Principal" : `Imagen ${position + 1}`
  return { slot, action: action === "ADD" ? `Agregar como imagen ${position + 1}` : action === "REPLACE" || action === "REPLACE_MAIN"
    ? `Reemplazar ${sourcePosition === 0 ? "la principal" : `imagen ${(sourcePosition ?? position) + 1}`}` : action === "REMOVE" ? "Eliminar de eBay" : action === "REORDER" ? "Mover" : "Conservar original" }
}

export function proposalDeliveryStatusV1(input: { discarded?: boolean; rejected?: boolean;
  state?: string; officialReadback?: boolean; serverReceiptPresent?: boolean }) {
  if (input.discarded) return { kind: "ARCHIVED", label: "Archivada · No se enviará a eBay", tone: "bg-gray-100 text-gray-700" }
  if (input.rejected) return { kind: "REJECTED", label: "Rechazada · No se enviará a eBay", tone: "bg-red-50 text-red-800" }
  if (input.state === "SYNCED" && input.officialReadback === true)
    return { kind: "SYNCED", label: "✓✓ Sincronizada con eBay", tone: "bg-green-100 text-green-900" }
  if (["REQUIRES_ATTENTION", "ATTENTION", "SYNCED"].includes(input.state ?? ""))
    return { kind: "ATTENTION", label: "! Requiere atención", tone: "bg-red-50 text-red-800" }
  if (input.serverReceiptPresent && ["APPROVED_FOR_EBAY_SYNC", "PENDING_EBAY_SYNC", "REVALIDATING", "SYNCING", "OFFICIAL_READBACK_REQUIRED", "UNKNOWN_COMMIT"].includes(input.state ?? ""))
    return { kind: "PENDING", label: "⏳ Pendiente de sincronizar con eBay", tone: "bg-orange-100 text-orange-900" }
  return { kind: "SAVED", label: "✓ Guardada en Seller OS · Aún no enviada", tone: "bg-teal-50 text-teal-900" }
}
