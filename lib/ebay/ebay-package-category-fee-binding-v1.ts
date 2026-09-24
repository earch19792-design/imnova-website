import { createHash } from "node:crypto"
import type snapshot from "../../docs/ebay-official-basic-fee-policy-snapshot-v1.json"
import { keywordRecord as record } from "../seller-os/keyword-intelligence-handoff-v1"

export const CATEGORY_ANCESTRY_SOURCE = "EBAY_TAXONOMY_EXACT_CATEGORY_ANCESTRY_V1"
export function exactCategoryAncestryV1(payload: unknown, categoryId: string, treeId: string, now: Date) {
  const p = record(payload)
  const matches = (Array.isArray(p.categorySuggestions) ? p.categorySuggestions.slice(0, 20).map(record) : [])
    .filter(s => record(s.category).categoryId === categoryId)
  if (p.categoryTreeId !== treeId || matches.length !== 1 || !p.categoryTreeVersion) return null
  const s = matches[0], leaf = record(s.category)
  const ancestors = (Array.isArray(s.categoryTreeNodeAncestors) ? s.categoryTreeNodeAncestors.map(record) : [])
    .sort((a,b) => Number(a.categoryTreeNodeLevel)-Number(b.categoryTreeNodeLevel))
  if (!ancestors.length || ancestors.length > 8 || ancestors.some((a,i) => a.categoryTreeNodeLevel !== i+1) ||
    s.categoryTreeNodeLevel !== ancestors.length+1) return null
  const nodes = [...ancestors, leaf]
  if (new Set(nodes.map(n=>n.categoryId)).size !== nodes.length || nodes.some(n => !/^\d+$/.test(String(n.categoryId)) ||
    typeof n.categoryName !== "string" || !n.categoryName || n.categoryName.length > 200 || /[:\x00-\x1f<>]/.test(n.categoryName))) return null
  // The official getCategorySuggestions response contains leaf categories.
  // Retain that endpoint guarantee for manual-editor receipt validation.
  return { source: CATEGORY_ANCESTRY_SOURCE, status: "PROVEN", marketplace: "EBAY_US", categoryId, treeId,
    leafCategoryTreeNode: true,
    treeVersion: p.categoryTreeVersion, path: nodes.map(n=>n.categoryName).join(":"),
    ancestorIds: ancestors.map(n=>String(n.categoryId)), observedAt: now.toISOString(),
    freshUntil: new Date(now.getTime()+6*3600_000).toISOString(),
    digest: createHash("sha256").update(JSON.stringify({categoryId,treeId,nodes})).digest("hex") }
}

export function currentCategoryAncestryV1(value: unknown, categoryId: unknown, now: Date) {
  const a = record(value)
  return a.source === CATEGORY_ANCESTRY_SOURCE && a.status === "PROVEN" && a.marketplace === "EBAY_US" &&
    a.categoryId === categoryId && /^[a-f0-9]{64}$/.test(String(a.digest)) &&
    Date.parse(String(a.observedAt)) <= now.getTime() && Date.parse(String(a.freshUntil)) > now.getTime() &&
    Array.isArray(a.ancestorIds) && typeof a.path === "string"
}

export function bindPackageCategoryFeeV1(input: { ancestry: unknown; policySnapshot: unknown; store: unknown;
  accountKey: string; packageId: string; packageRevision: string; sku: string; categoryId: string; now: Date }) {
  const a=record(input.ancestry), store=record(input.store), raw=record(input.policySnapshot)
  if (!currentCategoryAncestryV1(a,input.categoryId,input.now) || store.status !== "PROVEN" ||
    raw.source !== "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822" ||
    !Array.isArray(raw.storeLevels) || !raw.storeLevels.includes(store.storeSubscriptionLevel) ||
    !Array.isArray(raw.saleFormats) || !raw.saleFormats.includes("FixedPriceItem") ||
    !Number.isFinite(Date.parse(String(raw.verifiedAt))) || !store.source ||
    Date.parse(String(raw.verifiedAt)) > input.now.getTime() ||
    input.now.getTime()-Date.parse(String(raw.verifiedAt)) >= 86400000 || !Array.isArray(raw.rules)) return null
  const p=raw as unknown as typeof snapshot, path=String(a.path).split(":")
  const rules=p.rules.filter(r=>(r.root===path[0] || r.roots?.includes(path[0])) &&
    (!r.requiredBranch || r.requiredBranch===path[1]) && !r.excludedBranches?.includes(path[1]))
  if (rules.length !== 1) return null
  const rule=rules[0]
  return { status:"PROVEN_BASE_POLICY_ONLY", policy:{status:"PROVEN",marketplace:"EBAY_US",currency:"USD",
    marketplaceAccountKey:input.accountKey,itemId:null,packageId:input.packageId,packageRevision:input.packageRevision,sku:input.sku,
    categoryIds:[input.categoryId],categoryPath:a.path,categoryReference:`${a.source}:${a.digest}`,
    storeReference:store.source,storeLevels:[store.storeSubscriptionLevel],saleFormats:["FixedPriceItem"],
    source:p.source,sourceVersion:p.snapshotVersion,reference:`${p.snapshotVersion}:${rule.id}:${input.categoryId}`,
    observedAt:p.verifiedAt,freshUntil:a.freshUntil,effectiveFrom:p.verifiedAt,effectiveUntil:a.freshUntil,
    effectiveDateBasis:"VERIFIED_SNAPSHOT_OBSERVATION_COVERAGE",sourceEffectiveDate:p.sourceEffectiveDate,
    tierMethod:rule.tierMethod,tiers:rule.tiers,perOrder:p.perOrder} }
}


export function reusablePackageFeeContextV1(value: unknown, binding: {accountKey:string;packageId:string;
  productId:unknown;variantId:unknown;sku:unknown;categoryId:string;price:unknown}, now:Date) {
  const c=record(value), i=record(c.identity), l=record(c.listing), tax=record(c.feeTaxPolicy)
  const observed=Date.parse(String(c.observedAt)), policyDate=Date.parse(String(record(c.officialFeePolicySnapshot).verifiedAt))
  if(c.marketplaceAccountKey!==binding.accountKey || i.packageId!==binding.packageId || i.productId!==binding.productId ||
    i.variantId!==binding.variantId || i.sku!==binding.sku || i.itemId!==null || i.marketplace!=="EBAY_US" ||
    l.categoryId!==binding.categoryId || l.price!==binding.price || l.currency!=="USD" ||
    !["FixedPriceItem","FIXED_PRICE"].includes(String(l.saleFormat)) ||
    !Number.isFinite(observed) || observed>now.getTime() || now.getTime()-observed>=6*3600_000 ||
    !Number.isFinite(policyDate) || policyDate>now.getTime() || now.getTime()-policyDate>=6*3600_000 ||
    !(Date.parse(String(tax.freshUntil))>now.getTime()) || !c.subscription || !c.accountPerformance) return null
  return c
}
