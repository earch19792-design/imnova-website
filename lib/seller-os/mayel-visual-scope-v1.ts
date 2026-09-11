import { visualAssetStatusV1, visualEvidenceV1, type VisualSyncPresentationV1 } from "./mayel-visual-asset-status-v1"

/** The active visual item is independent of the bulk selection. */
export function scopedVisualTasksV1<T extends { ebayItemId: string; visualTaskId: string }>(
  tasks: readonly T[], focusedItemId?: string | null, selectedTaskId?: string | null,
): T[] {
  return tasks.filter(task => (!focusedItemId || task.ebayItemId === focusedItemId) &&
    (!selectedTaskId || task.visualTaskId === selectedTaskId))
}
/** A legacy string has no readback authority. */
export function friendlyVisualSyncV1(evidence: VisualSyncPresentationV1 | string | undefined) {
  return visualAssetStatusV1(visualEvidenceV1(typeof evidence === "string" ? { state: evidence } : evidence))
}
