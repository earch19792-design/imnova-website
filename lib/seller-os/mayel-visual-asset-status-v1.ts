/** Presentation only. No IO, authority grants, or persistent state transitions. */
export const VISUAL_STATUS_DESIGN_V1 = {
  MEJORA_GENERADA: { icon: "🔵", label: "Mejora detectada", color: "blue", className: "border-blue-300 bg-blue-50 text-blue-900" },
  QA_APROBADO: { icon: "🟣", label: "QA aprobado", color: "violet", className: "border-violet-300 bg-violet-50 text-violet-900" },
  GUARDADA_EN_SELLER_OS: { icon: "🟦", label: "Guardada en Seller OS", color: "teal", className: "border-teal-300 bg-teal-50 text-teal-900" },
  OWNER_APPROVAL_REQUIRED: { icon: "🟡", label: "En revisión", color: "amber", className: "border-amber-300 bg-amber-50 text-amber-950" },
  PENDING_EBAY_SYNC: { icon: "🟠", label: "Pendiente de eBay", color: "orange", className: "border-orange-300 bg-orange-50 text-orange-950" },
  SYNCED_WITH_EBAY: { icon: "🟢", label: "Sincronizada con eBay", color: "green", className: "border-green-300 bg-green-50 text-green-900" },
  REQUIRES_ATTENTION: { icon: "🔴", label: "Requiere atención", color: "red", className: "border-red-300 bg-red-50 text-red-900" },
} as const
export const AUTONOMOUS_VISUAL_COPY_V1 = "Mayel guarda y sincroniza automáticamente las mejoras seguras. Sólo te muestra cuando algo realmente necesita atención."
export type VisualStatusEvidenceV1 = { autonomousOptimization?: boolean; generated: boolean; qaPassed: boolean; savedToSellerOS: boolean;
  ownerApproved: boolean; serverReceiptPresent: boolean; officialReadback: boolean; readbackCompatible?: boolean; state: string;
  waitingForEbay?: boolean; discarded?: boolean; rejected?: boolean }
export type VisualSyncPresentationV1 = Partial<VisualStatusEvidenceV1> & { approvedForEbaySync?: boolean }
export function visualEvidenceV1(e: VisualSyncPresentationV1 = {}): VisualStatusEvidenceV1 {
  return { ...e, generated: e.generated === true, qaPassed: e.qaPassed === true, savedToSellerOS: e.savedToSellerOS === true,
    ownerApproved: e.ownerApproved === true || e.approvedForEbaySync === true, serverReceiptPresent: e.serverReceiptPresent === true,
    officialReadback: e.officialReadback === true, readbackCompatible: e.readbackCompatible === true, state: e.state ?? "DRAFT" }
}
export function visualAssetStatusV1(e: VisualStatusEvidenceV1) {
  const inactive = e.discarded || e.rejected || e.state === "SUPERSEDED"
  const synced = !inactive && e.generated && e.qaPassed && e.savedToSellerOS && e.ownerApproved && e.serverReceiptPresent &&
    e.officialReadback === true && e.readbackCompatible === true && e.state === "SYNCED"
  const pending = !inactive && (e.waitingForEbay === true || e.serverReceiptPresent &&
    ["APPROVED_FOR_EBAY_SYNC", "PENDING_EBAY_SYNC", "WAITING_FOR_EBAY", "REVALIDATING", "LEASED", "SYNCING", "OFFICIAL_READBACK_REQUIRED", "READBACK_REQUIRED", "UNKNOWN_COMMIT", "UNKNOWN_COMMIT_STATE"].includes(e.state))
  const review = ["QA_READY", "MAYEL_REVIEW_PENDING", "OWNER_APPROVAL_REQUIRED", "pending_review"].includes(e.state) ||
    e.qaPassed && e.savedToSellerOS && !e.ownerApproved
  const status = ["REQUIRES_ATTENTION", "ATTENTION", "ORDER_OR_REPLACEMENT_MISMATCH"].includes(e.state) || e.state === "SYNCED" && !synced ? "REQUIRES_ATTENTION" : synced ? "SYNCED_WITH_EBAY" :
    pending ? "PENDING_EBAY_SYNC" : review ? "OWNER_APPROVAL_REQUIRED" :
    e.savedToSellerOS ? "GUARDADA_EN_SELLER_OS" : e.qaPassed ? "QA_APROBADO" : "MEJORA_GENERADA"
  const steps = [
    { key: "generated", label: "Generada", complete: e.generated },
    { key: "qa", label: "QA", complete: e.qaPassed },
    { key: "saved", label: "Seller OS", complete: e.savedToSellerOS },
    { key: "ebay", label: "eBay", complete: Boolean(synced) },
  ]
  return { status, ...VISUAL_STATUS_DESIGN_V1[status], steps, synced: Boolean(synced),
    action: status === "OWNER_APPROVAL_REQUIRED" ? e.autonomousOptimization ? "Mayel comprueba la identidad y la calidad. No necesitas autorizar cada mejora." : "Compara la propuesta y completa la revisión requerida antes de autorizarla." :
      pending ? "El trabajo permanece guardado. Seller OS espera o verifica eBay; no hace falta reenviarlo." : synced ? "eBay confirmó esta mejora y su posición." :
      status === "REQUIRES_ATTENTION" ? "Hay evidencia que necesita revisión. Consulta los detalles del cambio." :
      e.autonomousOptimization ? AUTONOMOUS_VISUAL_COPY_V1 : "La propuesta permanece guardada para revisión." }
}
/** Aggregate current relevant evidence; no historical success can override pending work. */
export function visualListingStatusV1(rows: VisualSyncPresentationV1[], fallback: VisualSyncPresentationV1 = {}) {
  const active = rows.filter(e => !e.discarded && !e.rejected && e.state !== "SUPERSEDED").map(e => visualAssetStatusV1(visualEvidenceV1(e)))
  if (!active.length) return visualAssetStatusV1(visualEvidenceV1(fallback))
  const priority = ["REQUIRES_ATTENTION", "PENDING_EBAY_SYNC", "OWNER_APPROVAL_REQUIRED", "MEJORA_GENERADA", "QA_APROBADO", "GUARDADA_EN_SELLER_OS", "SYNCED_WITH_EBAY"]
  return [...active].sort((a,b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0]
}

/** A cached local label is never authority; only an exact durable server receipt is. */
export function localReceiptVisualEvidenceV1(row: { intent: { idempotencyKey: string }; receipt?: {
  id: string; idempotencyKey: string; state: string; internalState: string; officialReadback: boolean } | null }): VisualSyncPresentationV1 {
  const receipt = row.receipt
  const bound = Boolean(receipt?.id && receipt.idempotencyKey === row.intent.idempotencyKey)
  const official = bound && receipt?.officialReadback === true && receipt.internalState === "SYNCED"
  return { state: bound ? receipt!.internalState : "DRAFT", savedToSellerOS: bound, serverReceiptPresent: bound,
    // This is a delivery summary, not an assertion that unreviewed files passed QA.
    generated: official, qaPassed: official, approvedForEbaySync: official, officialReadback: official, readbackCompatible: official }
}
