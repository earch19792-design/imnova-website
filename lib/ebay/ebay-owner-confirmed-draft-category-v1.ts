import { createHash } from "node:crypto"
import { currentCategoryAncestryV1 } from "./ebay-package-category-fee-binding-v1"

type R = Record<string, unknown>
const record = (value: unknown): R => value && typeof value === "object" &&
  !Array.isArray(value) ? value as R : {}

/** Binds an OWNER's actual editor selection to exactly one current official
 * Taxonomy leaf. A public category page, suggestion, or path prefix alone
 * cannot produce this receipt. No marketplace write is performed. */
export function resolveOwnerConfirmedDraftCategoryReceiptV1(input: Readonly<{
  ownerSelection: unknown; officialAncestry: unknown
  marketplaceAccountKey: string; productId: string; variantId: string
  supplierSku: string; now?: Date
}>) {
  const now = input.now ?? new Date()
  const owner = record(input.ownerSelection)
  const official = record(input.officialAncestry)
  const selectedAt = Date.parse(String(owner.selectedAt ?? ""))
  const path = owner.fullCategoryPath
  const pathReady = Array.isArray(path) && path.length >= 2 && path.length <= 9 &&
    path.every((part) => typeof part === "string" && part.length > 0 &&
      part.length <= 200 && !/[:\x00-\x1f<>]/.test(part))
  const bound = owner.source === "OWNER_ACTUAL_EBAY_LISTING_EDITOR_SELECTION" &&
    owner.ownerSelectedInActualEbayListingEditor === true &&
    owner.marketplace === "EBAY_US" &&
    owner.marketplaceAccountKey === input.marketplaceAccountKey &&
    owner.productId === input.productId && owner.variantId === input.variantId &&
    owner.supplierSku === input.supplierSku &&
    typeof owner.selectionEvidenceId === "string" &&
    owner.selectionEvidenceId.length >= 8 && owner.selectionEvidenceId.length <= 200 &&
    typeof owner.listingDraftId === "string" &&
    owner.listingDraftId.length >= 8 && owner.listingDraftId.length <= 200 &&
    typeof owner.categoryId === "string" && /^\d{1,20}$/.test(owner.categoryId) &&
    Number.isFinite(selectedAt) && selectedAt <= now.getTime() &&
    pathReady && official.path === path.join(":") &&
    official.leafCategoryTreeNode === true &&
    currentCategoryAncestryV1(official, owner.categoryId, now) &&
    Array.isArray(official.ancestorIds) &&
    official.ancestorIds.length === path.length - 1
  if (!bound) return null
  const digest = createHash("sha256").update(JSON.stringify({
    marketplace: owner.marketplace, account: owner.marketplaceAccountKey,
    productId: owner.productId, variantId: owner.variantId,
    supplierSku: owner.supplierSku, categoryId: owner.categoryId,
    path, selectedAt: owner.selectedAt, listingDraftId: owner.listingDraftId,
    selectionEvidenceId: owner.selectionEvidenceId,
    taxonomyDigest: official.digest, taxonomyTreeVersion: official.treeVersion,
  })).digest("hex")
  return Object.freeze({ status: "OWNER_CONFIRMED" as const,
    source: "OWNER_CONFIRMED_DRAFT_CATEGORY_RECEIPT" as const,
    marketplace: "EBAY_US" as const,
    marketplaceAccountKey: input.marketplaceAccountKey,
    productId: input.productId, variantId: input.variantId,
    supplierSku: input.supplierSku, categoryId: owner.categoryId as string,
    fullCategoryPath: [...path] as string[], selectedAt: owner.selectedAt as string,
    listingDraftId: owner.listingDraftId as string,
    selectionEvidenceId: owner.selectionEvidenceId as string,
    taxonomyTreeVersion: official.treeVersion as string,
    taxonomyDigest: official.digest as string,
    taxonomyFreshUntil: official.freshUntil as string,
    receiptDigest: digest,
    officialCategoryAuthority: input.officialAncestry })
}

/** Revalidate a stored receipt against its exact identity and fresh official
 * ancestry before it may enter prelisting fee policy resolution. */
export function currentOwnerConfirmedDraftCategoryReceiptV1(value: unknown,
  expected: Readonly<{ marketplaceAccountKey: string; productId: string
    variantId: string; supplierSku: string; categoryId: string; now?: Date }>) {
  const receipt = record(value)
  if (receipt.status !== "OWNER_CONFIRMED" ||
      receipt.source !== "OWNER_CONFIRMED_DRAFT_CATEGORY_RECEIPT" ||
      receipt.categoryId !== expected.categoryId ||
      receipt.marketplaceAccountKey !== expected.marketplaceAccountKey ||
      receipt.productId !== expected.productId ||
      receipt.variantId !== expected.variantId ||
      receipt.supplierSku !== expected.supplierSku) return false
  const rebuilt = resolveOwnerConfirmedDraftCategoryReceiptV1({
    ownerSelection: { source: "OWNER_ACTUAL_EBAY_LISTING_EDITOR_SELECTION",
      ownerSelectedInActualEbayListingEditor: true,
      marketplace: receipt.marketplace,
      marketplaceAccountKey: receipt.marketplaceAccountKey,
      productId: receipt.productId, variantId: receipt.variantId,
      supplierSku: receipt.supplierSku, categoryId: receipt.categoryId,
      fullCategoryPath: receipt.fullCategoryPath,
      selectedAt: receipt.selectedAt,
      listingDraftId: receipt.listingDraftId,
      selectionEvidenceId: receipt.selectionEvidenceId },
    officialAncestry: receipt.officialCategoryAuthority,
    marketplaceAccountKey: expected.marketplaceAccountKey,
    productId: expected.productId, variantId: expected.variantId,
    supplierSku: expected.supplierSku, now: expected.now })
  return rebuilt !== null && rebuilt.receiptDigest === receipt.receiptDigest
}
