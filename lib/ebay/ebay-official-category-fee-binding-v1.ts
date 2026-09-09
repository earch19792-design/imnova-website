import savedSnapshot from "../../docs/ebay-official-basic-fee-policy-snapshot-v1.json" with { type: "json" }
import type { TradingManualListingResult } from "./ebay-manual-listing-trading-readonly"

/** GetItem CategoryName is a fully qualified official category path. Never
 * classify fees using the title, SKU, a similar sale or a historical category map.
 * This binds base policy only; buyer basis and material adjustments stay separate.
 */
export function bindOfficialCategoryFeePolicyV1(input: { listing: TradingManualListingResult;
  accountKey: string; storeLevel: string | null; storeReference: string | null; now: Date; policySnapshot?: typeof savedSnapshot | null }) {
  const snapshot = input.policySnapshot === undefined ? savedSnapshot : input.policySnapshot
  if (!snapshot) return { status: "NEEDS_EVIDENCE" as const, limitation: "CURRENT_OFFICIAL_FEE_SOURCE_UNAVAILABLE", policy: null }
  const l = input.listing, path = l.categoryPath?.split(":").map(p => p.trim()) ?? []
  const valid = input.accountKey.length > 0 && l.ownership === "verified" && l.currency === "USD" &&
    Boolean(l.safeDefaults.categoryId) && l.secondaryCategoryId === null && path.length >= 2 && path.every(Boolean) &&
    Boolean(input.storeReference) && snapshot.storeLevels.includes(input.storeLevel ?? "") &&
    snapshot.saleFormats.includes(l.saleFormat ?? "") &&
    Date.parse(l.observedAt) <= input.now.getTime() && input.now.getTime() - Date.parse(l.observedAt) < 86400000 &&
    Date.parse(snapshot.verifiedAt) <= input.now.getTime() && input.now.getTime() - Date.parse(snapshot.verifiedAt) < 86400000
  const matches = snapshot.rules.filter(r => (r.root === path[0] || r.roots?.includes(path[0])) &&
    (!r.requiredBranch || path[1] === r.requiredBranch) && !r.excludedBranches?.includes(path[1]))
  if (!valid || matches.length !== 1) return { status: "NEEDS_EVIDENCE" as const,
    limitation: "OFFICIAL_CATEGORY_FORMAT_STORE_POLICY_BINDING_UNPROVEN", policy: null }
  const rule = matches[0]
  return { status: "PROVEN_BASE_POLICY_ONLY" as const, limitation: null,
    policy: { status: "PROVEN", marketplace: snapshot.marketplace, currency: snapshot.currency,
      categoryIds: [l.safeDefaults.categoryId], categoryPath: l.categoryPath,
      marketplaceAccountKey: input.accountKey, itemId: l.itemId,
      categoryReference: `EBAY_TRADING_GET_ITEM:${l.itemId}:${l.observedAt}`,
      storeReference: input.storeReference, storeLevels: [input.storeLevel], saleFormats: [l.saleFormat],
      source: snapshot.source, sourceVersion: snapshot.snapshotVersion,
      reference: `${snapshot.snapshotVersion}:${rule.id}:${l.safeDefaults.categoryId}`,
      observedAt: snapshot.verifiedAt, freshUntil: new Date(Date.parse(snapshot.verifiedAt) + 86400000).toISOString(),
      // This is the snapshot's observation coverage, not an invented legal effective date.
      effectiveFrom: snapshot.verifiedAt, effectiveUntil: new Date(Date.parse(snapshot.verifiedAt) + 86400000).toISOString(),
      effectiveDateBasis: "VERIFIED_SNAPSHOT_OBSERVATION_COVERAGE", sourceEffectiveDate: snapshot.sourceEffectiveDate,
      tierMethod: rule.tierMethod, tiers: rule.tiers, perOrder: snapshot.perOrder } }
}
