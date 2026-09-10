/** The active visual item is independent of the bulk selection. */
export function scopedVisualTasksV1<T extends { ebayItemId: string; visualTaskId: string }>(
  tasks: readonly T[], focusedItemId?: string | null, selectedTaskId?: string | null,
): T[] {
  return tasks.filter(task => (!focusedItemId || task.ebayItemId === focusedItemId) &&
    (!selectedTaskId || task.visualTaskId === selectedTaskId))
}
export function friendlyVisualSyncV1(state: string | undefined) {
  if (state === "SYNCED") return { label: "Sincronizado", action: "El cambio está confirmado en eBay." }
  if (["REQUIRES_ATTENTION", "ATTENTION"].includes(state ?? ""))
    return { label: "Requiere atención", action: "Compara las imágenes actuales con la propuesta guardada antes de autorizar un nuevo cambio." }
  if (["APPROVED_FOR_EBAY_SYNC", "PENDING_EBAY_SYNC", "REVALIDATING", "SYNCING", "OFFICIAL_READBACK_REQUIRED"].includes(state ?? ""))
    return { label: "Pendiente de sincronizar", action: "La propuesta aprobada se enviará cuando pase la comprobación actual de eBay. Puedes cerrar el iPad después de recibir la confirmación de guardado." }
  return { label: "Guardado", action: "Revisa la calidad y aprueba cada propuesta que quieras enviar a eBay." }
}
