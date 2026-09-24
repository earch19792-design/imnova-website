import { createHash } from "node:crypto"
import { currentCategoryAncestryV1 } from "./ebay-package-category-fee-binding-v1"

type R = Record<string, unknown>
const record = (value: unknown): R => value && typeof value === "object" &&
  !Array.isArray(value) ? value as R : {}
const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as R)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]))
    : value
const digest = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex")

export const EBAY_LISTING_CATEGORY_AUTHORITY_VERSION =
  "EBAY_LISTING_CATEGORY_AUTHORITY_V1"

type Identity = Readonly<{
  accountKey: string; sku: string; productId: string; variantId: string
  categoryId: string
}>

/** Called only with a server-recorded OWNER category selection or an exact
 * official draft read. A recommendation or public category page is not a
 * selection. Official ancestry must be a current, exact Taxonomy leaf. */
export function createEbayListingCategoryReceiptV1(input: Readonly<{
  identity: Identity
  selection: unknown
  officialAncestry: unknown
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const selection = record(input.selection)
  const official = record(input.officialAncestry)
  const identity = input.identity
  const selectedAt = Date.parse(String(selection.selectedAt ?? ""))
  const allowedSource = selection.source === "OWNER_SELLER_OS_PACKAGE_SELECTION"
    || selection.source === "EBAY_OFFICIAL_DRAFT_CATEGORY_READ"
  const exactSelection = allowedSource &&
    (selection.source !== "OWNER_SELLER_OS_PACKAGE_SELECTION" ||
      typeof selection.actorUserId === "string" &&
      selection.actorUserId.length >= 8) &&
    selection.accountKey === identity.accountKey &&
    selection.sku === identity.sku &&
    selection.productId === identity.productId &&
    selection.variantId === identity.variantId &&
    selection.categoryId === identity.categoryId &&
    typeof selection.sourceId === "string" &&
    selection.sourceId.length >= 8 && selection.sourceId.length <= 200 &&
    Number.isFinite(selectedAt) && selectedAt <= now.getTime()
  const path = String(official.path ?? "").split(":")
  if (!exactSelection || !identity.accountKey || !identity.sku ||
      !identity.productId || !identity.variantId ||
      !/^\d{1,20}$/.test(identity.categoryId) ||
      !currentCategoryAncestryV1(official, identity.categoryId, now) ||
      official.leafCategoryTreeNode !== true ||
      !String(official.treeVersion ?? "").trim() ||
      path.length < 2 || path.length > 9 ||
      path.some((part) => !part || part.length > 200) ||
      !Array.isArray(official.ancestorIds) ||
      official.ancestorIds.length !== path.length - 1 ||
      (selection.categoryPath !== undefined &&
        selection.categoryPath !== official.path)) return null
  const base = {
    contractVersion: EBAY_LISTING_CATEGORY_AUTHORITY_VERSION,
    accountKey: identity.accountKey, marketplace: "EBAY_US" as const,
    sku: identity.sku, productId: identity.productId,
    variantId: identity.variantId, categoryId: identity.categoryId,
    categoryPath: official.path as string,
    leafStatus: "SELECTABLE_LEAF" as const,
    taxonomyTreeId: official.treeId as string,
    taxonomyTreeVersion: official.treeVersion as string,
    taxonomyObservedAt: official.observedAt as string,
    taxonomyFreshUntil: official.freshUntil as string,
    taxonomyDigest: official.digest as string,
    sourceAuthority: selection.source as string,
    sourceId: selection.sourceId as string,
    ownerActorUserId: selection.source === "OWNER_SELLER_OS_PACKAGE_SELECTION"
      ? selection.actorUserId as string : null,
    ownerConfirmedAt: selection.source === "OWNER_SELLER_OS_PACKAGE_SELECTION"
      ? selection.selectedAt as string : null,
    selectedAt: selection.selectedAt as string,
    officialAncestry: input.officialAncestry,
    status: "PROVEN" as const,
  }
  return Object.freeze({ ...base, receiptId: digest(base) })
}

/** The package JSON is the canonical durable store; retain prior receipts
 * without allowing a stale or contradicted current receipt to authorize fees. */
export function reconcileEbayListingCategoryReceiptV1(
  packageData: unknown, nextReceipt: ReturnType<typeof createEbayListingCategoryReceiptV1>,
) {
  const data = record(packageData)
  const state = record(data.categoryAuthorityV1)
  const prior = record(state.current)
  const history = Array.isArray(state.history) ? state.history : []
  if (!nextReceipt) return data
  if (prior.receiptId === nextReceipt.receiptId) return data
  return {
    ...data,
    categoryAuthorityV1: {
      contractVersion: EBAY_LISTING_CATEGORY_AUTHORITY_VERSION,
      current: nextReceipt,
      history: prior.receiptId
        ? [...history, { ...prior, status: "SUPERSEDED",
          supersededBy: nextReceipt.receiptId,
          supersededAt: nextReceipt.selectedAt }]
        : [...history],
    },
  }
}

export function readEbayListingCategoryAuthorityV1(input: Readonly<{
  packageData: unknown; identity: Identity; now?: Date
  currentTreeVersion?: string | null
}>) {
  const now = input.now ?? new Date()
  const data = record(input.packageData)
  const receipt = record(record(data.categoryAuthorityV1).current)
  if (!receipt.receiptId) return { status: "MISSING" as const, receipt: null }
  const { receiptId: _receiptId, ...base } = receipt
  if (receipt.status !== "PROVEN" || receipt.contractVersion !==
      EBAY_LISTING_CATEGORY_AUTHORITY_VERSION ||
      receipt.marketplace !== "EBAY_US" ||
      receipt.accountKey !== input.identity.accountKey ||
      receipt.sku !== input.identity.sku ||
      receipt.productId !== input.identity.productId ||
      receipt.variantId !== input.identity.variantId ||
      receipt.categoryId !== input.identity.categoryId ||
      data.categoryId !== input.identity.categoryId ||
      receipt.leafStatus !== "SELECTABLE_LEAF" ||
      !["OWNER_SELLER_OS_PACKAGE_SELECTION",
        "EBAY_OFFICIAL_DRAFT_CATEGORY_READ"].includes(
        String(receipt.sourceAuthority ?? "")) ||
      (receipt.sourceAuthority === "OWNER_SELLER_OS_PACKAGE_SELECTION" &&
        (typeof receipt.ownerActorUserId !== "string" ||
          receipt.ownerActorUserId.length < 8)) ||
      receipt.receiptId !== digest(base) ||
      record(receipt.officialAncestry).path !== receipt.categoryPath)
    return { status: "CONTRADICTED" as const, receipt: null }
  if (!currentCategoryAncestryV1(receipt.officialAncestry,
      input.identity.categoryId, now) ||
      input.currentTreeVersion &&
      receipt.taxonomyTreeVersion !== input.currentTreeVersion)
    return { status: "STALE" as const, receipt: null }
  return { status: "PROVEN" as const, receipt }
}
