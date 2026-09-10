import "server-only"
import { keywordRecord as record, keywordWireDigestV1 as digest } from "../seller-os/keyword-intelligence-handoff-v1"
import { protectedContentFieldsV1, validateMayelContentPatchV1, type MayelLiveContentV1 } from "../seller-os/mayel-autonomous-content-v1"
import { getEbayTradingReadOnlyAccessToken, tradingXmlTagValue } from "./ebay-manual-listing-trading-readonly"
import { readOfficialActiveListingImageSnapshotV1 } from "./ebay-active-listing-image-revision-service"
import { prepareEbayActiveListingManagementExecutorV1, executeEbayInventoryManagedContentMutationV1 } from "./ebay-draft-only-gateway"
import { getEbayProRuntimeBoundary } from "./environment-boundaries"

export function contentInventoryProtectedV1(value: unknown, keys: string[]) {
  const v = record(value), product = { ...record(v.product) }
  for (const key of keys) delete product[key]
  const next: Record<string, unknown> = { ...v, product }
  for (const key of ["sku", "locale", "groupIds", "inventoryItemGroupKeys"]) delete next[key]
  return next
}
export async function readMayelContentLiveV1(input: { accountKey: string; itemId: string; sku: string }, fetchImpl: typeof fetch = fetch) {
  const accessToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
  const official = await readOfficialActiveListingImageSnapshotV1({ ...input, expectedSku: input.sku, accessToken, fetchImpl, includeContent: true })
  if (!official.content || official.content.variationPresent || !official.protectedFields) throw Error("CONTENT_EXACT_SINGLE_SKU_REQUIRED")
  const management = await prepareEbayActiveListingManagementExecutorV1(input, fetchImpl)
  if (management.managementModel === "MANAGEMENT_MODEL_UNPROVEN" || management.groupedInventoryItem) throw Error("CONTENT_MANAGEMENT_AUTHORITY_REQUIRED")
  const content = { title: official.content.title, description: official.content.description, aspects: official.content.aspects }
  const protectedFields = { ...official.protectedFields, orderedGallery: official.pictureUrls }
  const inventoryPreserved = management.inventoryItemPayload
  return { content, protectedFields, inventoryPreserved, management, observedAt: official.observedAt,
    categoryId: official.protectedFields.categoryId,
    baseHash: digest({ content, protectedFields, inventory: management.inventoryEvidenceDigest, management: management.managementModel }) }
}
const normalized = (value: unknown) => {
  const c = record(value), aspects = record(c.aspects)
  return { title: c.title, description: String(c.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/\r\n/g, "\n").trim(),
    aspects: Object.fromEntries(Object.entries(aspects).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])) }
}
export function contentReadbackMatchesV1(current: Awaited<ReturnType<typeof readMayelContentLiveV1>>, audit: Record<string, unknown>) {
  const keys = Object.keys(record(audit.patch))
  return current.categoryId === audit.categoryId && current.management.managementModel === audit.managementModel &&
    digest(normalized(current.content)) === digest(normalized(audit.after)) &&
    digest(protectedContentFieldsV1(current.protectedFields, keys)) === digest(protectedContentFieldsV1(record(audit.protectedBefore), keys)) &&
    digest(contentInventoryProtectedV1(current.inventoryPreserved, keys)) === digest(contentInventoryProtectedV1(audit.inventoryBefore, keys))
}
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
export function mayelContentRevisionXmlV1(itemId: string, value: unknown) {
  if (!/^\d{9,20}$/.test(itemId)) throw Error("CONTENT_EXACT_LISTING_REQUIRED")
  const p = validateMayelContentPatchV1(value)
  const fields = (p.title ? `<Title>${xml(p.title)}</Title>` : "") + (p.description ? `<Description>${xml(p.description)}</Description>` : "") +
    (p.aspects ? `<ItemSpecifics>${Object.entries(p.aspects).map(([name, values]) => `<NameValueList><Name>${xml(name)}</Name>${values.map(v => `<Value>${xml(v)}</Value>`).join("")}</NameValueList>`).join("")}</ItemSpecifics>` : "")
  return `<?xml version="1.0" encoding="utf-8"?><ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item><ItemID>${itemId}</ItemID>${fields}</Item></ReviseFixedPriceItemRequest>`
}
/** Official contracts: /Devzone/XML/docs/Reference/eBay/ReviseFixedPriceItem.html
 * and /api-docs/sell/static/inventory/inventory-item-to-offer.html.
 * Exactly one mutation, then the shared runtime performs official readback. */
export async function executeMayelContentMutationV1(input: { accountKey: string; itemId: string; sku: string;
  current: Awaited<ReturnType<typeof readMayelContentLiveV1>>; patch: Partial<MayelLiveContentV1> }, fetchImpl: typeof fetch = fetch) {
  if (getEbayProRuntimeBoundary({ pathname: "/api/runtime/operational-integrity", method: "POST" }).runtime !== "seller_os_dedicated_preprod") throw Error("CONTENT_PREPROD_ONLY")
  const patch = validateMayelContentPatchV1(input.patch), m = input.current.management
  if (m.managementModel === "INVENTORY_API_MANAGED") {
    const result = await executeEbayInventoryManagedContentMutationV1({ ...input, patch,
      inventoryItemPayload: m.inventoryItemPayload ?? {}, inventoryEvidenceDigest: m.inventoryEvidenceDigest ?? "" }, fetchImpl)
    if (!result.ok) throw Error("CONTENT_INVENTORY_WRITE_REQUIRES_READBACK")
  } else if (m.managementModel === "TRADING_MANAGED") {
    const accessToken = await getEbayTradingReadOnlyAccessToken(fetchImpl)
    const r = await fetchImpl("https://api.ebay.com/ws/api.dll", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(25_000),
      headers: { "Content-Type": "text/xml", "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem", "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
        "X-EBAY-API-SITEID": "0", "X-EBAY-API-IAF-TOKEN": accessToken }, body: mayelContentRevisionXmlV1(input.itemId, patch) })
    const body = await r.text()
    if (!r.ok || !["success", "warning"].includes(String(tradingXmlTagValue(body, "Ack")).toLowerCase())) throw Error("CONTENT_TRADING_WRITE_REQUIRES_READBACK")
  } else throw Error("CONTENT_MANAGEMENT_AUTHORITY_REQUIRED")
  return { writes: 1, mediaWrites: 0 }
}
