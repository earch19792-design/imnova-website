/** A pre-publication fee belongs to an exact package revision, never a fabricated eBay item. */
export type FeeSubjectV1 = { itemId: string | null; packageId?: string | null; packageRevision?: string | null; sku?: string | null }
export function feeSubjectMatchesV1(subject: FeeSubjectV1, evidence: Record<string, unknown>) {
  if (subject.itemId !== null) return typeof subject.itemId === "string" && subject.itemId.length > 0 && evidence.itemId === subject.itemId
  return typeof subject.packageId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(subject.packageId) &&
    typeof subject.packageRevision === "string" && /^sha256:[a-f0-9]{64}$/.test(subject.packageRevision) &&
    typeof subject.sku === "string" && subject.sku.length > 0 && evidence.itemId === null &&
    evidence.packageId === subject.packageId && evidence.packageRevision === subject.packageRevision && evidence.sku === subject.sku
}
export function feeSubjectFieldsV1(subject: FeeSubjectV1) {
  return subject.itemId === null ? { itemId: null, packageId: subject.packageId, packageRevision: subject.packageRevision, sku: subject.sku }
    : { itemId: subject.itemId }
}
