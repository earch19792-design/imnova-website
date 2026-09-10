export function proposalSlotLabelV1(position: number, sourcePosition: number | null, action: string) {
  const slot = position === 0 ? "Principal" : `Imagen ${position + 1}`
  return { slot, action: action === "ADD" ? `Agregar como imagen ${position + 1}` : action === "REPLACE" || action === "REPLACE_MAIN"
    ? `Reemplazar ${sourcePosition === 0 ? "la principal" : `imagen ${(sourcePosition ?? position) + 1}`}` : action === "REMOVE" ? "Eliminar de eBay" : action === "REORDER" ? "Mover" : "Conservar original" }
}
