export const VISUAL_STATUS_DESIGN_V1 = {
  MEJORA_GENERADA: { icon: "✨", label: "Mejora generada", color: "blue", className: "border-blue-300 bg-blue-50 text-blue-900" },
  QA_APROBADO: { icon: "✓", label: "QA aprobado", color: "violet", className: "border-violet-300 bg-violet-50 text-violet-900" },
  GUARDADA_EN_SELLER_OS: { icon: "✓", label: "Guardada en Seller OS", color: "teal", className: "border-teal-300 bg-teal-50 text-teal-900" },
  OWNER_APPROVAL_REQUIRED: { icon: "◷", label: "Esperando tu aprobación", color: "amber", className: "border-amber-300 bg-amber-50 text-amber-950" },
  PENDING_EBAY_SYNC: { icon: "⏳", label: "Pendiente de sincronizar", color: "orange", className: "border-orange-300 bg-orange-50 text-orange-950" },
  SYNCED_WITH_EBAY: { icon: "✓✓", label: "Sincronizada con eBay", color: "green", className: "border-green-300 bg-green-50 text-green-900" },
  REQUIRES_ATTENTION: { icon: "!", label: "Requiere atención", color: "red", className: "border-red-300 bg-red-50 text-red-900" },
} as const
export type VisualStatusEvidenceV1 = { generated: boolean; qaPassed: boolean; savedToSellerOS: boolean;
  ownerApproved: boolean; serverReceiptPresent: boolean; officialReadback: boolean; state: string }
export function visualAssetStatusV1(e: VisualStatusEvidenceV1) {
  const synced = e.generated && e.qaPassed && e.savedToSellerOS && e.ownerApproved && e.serverReceiptPresent &&
    e.officialReadback === true && e.state === "SYNCED"
  const pending = e.qaPassed && e.savedToSellerOS && e.ownerApproved && e.serverReceiptPresent &&
    ["APPROVED_FOR_EBAY_SYNC", "PENDING_EBAY_SYNC", "REVALIDATING", "SYNCING", "OFFICIAL_READBACK_REQUIRED", "UNKNOWN_COMMIT"].includes(e.state)
  const status = ["REQUIRES_ATTENTION", "ATTENTION"].includes(e.state) ? "REQUIRES_ATTENTION" : synced ? "SYNCED_WITH_EBAY" :
    pending ? "PENDING_EBAY_SYNC" : e.qaPassed && e.savedToSellerOS && !e.ownerApproved ? "OWNER_APPROVAL_REQUIRED" :
    e.savedToSellerOS ? "GUARDADA_EN_SELLER_OS" : e.qaPassed ? "QA_APROBADO" : "MEJORA_GENERADA"
  const steps = [
    { key: "generated", label: "Generada", complete: e.generated },
    { key: "qa", label: "QA", complete: e.qaPassed },
    { key: "saved", label: "Seller OS", complete: e.savedToSellerOS },
    { key: "ebay", label: "eBay", complete: synced },
  ]
  return { status, ...VISUAL_STATUS_DESIGN_V1[status], steps, synced,
    action: status === "OWNER_APPROVAL_REQUIRED" ? "Revisa el cambio y aprueba esta imagen. Después confirma el Preview completo." :
      pending ? "Seller OS conserva el trabajo y verificará eBay al sincronizar." : synced ? "eBay confirmó esta imagen." :
      status === "REQUIRES_ATTENTION" ? "Revisa el Preview antes de continuar." : "La propuesta permanece guardada para revisión." }
}
