import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { goldenArray as rows, goldenRecord as record, goldenDigest as digest, goldenNumber as number,
  goldenCompetitiveSoldPriceV1, classifyGoldenComparable, type GoldenMarketEvidence } from "../ebay/commercial-golden-path-domain-v1"
import { marketEvidence, duplicateGate, type GoldenContext } from "../ebay/commercial-golden-path-runtime-v1"
import { readGoldenPresaleAuthorityV1 } from "../ebay/commercial-golden-path-presale-authority-v1"
import { getEbayOfficialLiveListingSweepReadonly } from "../ebay/ebay-commercial-monitor-live-readonly"
import { getEbaySellerAccountScopeConfiguration } from "../ebay/ebay-seller-account-scope"
import { buildProductResearchCommercialQueryPlanV1 } from "../ebay/ebay-product-research-query-plan"
import { resolveInheritedLunaSupplierImageRightsV1 } from "../ebay/luna-supplier-image-rights-authority-v1"
import { getEbayTaxonomyListingIntelligence } from "../ebay/ebay-seller-keyword-demand-gateway"
import { preflightEbayCategoryProductIdentifiers } from "../ebay/ebay-draft-only-gateway"
import { resolveCommercialTraceOwnerPricePolicyV1 } from "../ebay/commercial-trace-owner-price-policy-v1"
import { buildQuickPickMarketTestListingReviewV1 } from "../ebay/ebay-quick-pick-market-test-package-v1"
import { readKeywordDecisionHandoffV1 } from "./keyword-intelligence-handoff-v1"
import { readProductResearchWorkerCapability } from "../ebay/ebay-quick-pick-product-research-handoff-v1"
import { readManualListingFromTradingApi } from "../ebay/ebay-manual-listing-trading-readonly"
import { ebayConditionContractFromVerifiedFact } from "../ebay/ebay-manual-listing-domain"
import {readFastListingOutcomesV1} from "./fast-listing-learning-v1"
import { FAST_LISTING_V1, fastProductTruthV1, projectFastListingV1, validateFastCorrectionV1,
  fastReferenceDifferencesV1, type FastField, type FastInput, type FastRecord, type FastOfferInput } from "./fast-listing-v1"

export type FastScope = { supabase: SupabaseClient; accountKey: string; ownerId: string; now?: Date }
const bounded = <T extends { abortSignal: (s: AbortSignal) => T; retry: (b: boolean) => T }>(q: T) => q.abortSignal(AbortSignal.timeout(10000)).retry(false)
const sourceColumns = "snapshot_id,product_id,variant_id,sku,canonical_url,title,price,availability,options,weight,weight_unit,images,product_type,source_fields,source_fingerprint,observed_at,preflight_status,field_truth_v1"
export async function readFastCatalogV1(scope: FastScope, search = "", category = "") {
  const snapshot = await bounded(scope.supabase.from("luna_catalog_snapshots_v1").select("snapshot_id")
    .eq("snapshot_status", "COMPLETE").order("snapshot_completed_at", { ascending: false }).limit(1)).maybeSingle()
  if (snapshot.error || !snapshot.data) throw Error("FAST_LISTING_CATALOG_SNAPSHOT_REQUIRED")
  let q = scope.supabase.from("luna_catalog_snapshot_variants_v1").select(sourceColumns).eq("snapshot_id", snapshot.data.snapshot_id)
  if (category) q = q.eq("product_type", category.slice(0, 100))
  // PostgREST filter syntax is never accepted from the UI.
  const term = search.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80)
  if (term) q = q.or(`sku.ilike.%${term}%,title.ilike.%${term}%,product_id.eq.${/^\d+$/.test(term) ? term : "0"}`)
  const result = await bounded(q.order("title").limit(40))
  if (result.error) throw Error("FAST_LISTING_CATALOG_READ_FAILED")
  return rows(result.data)
}
export async function readFastSourceV1(scope: FastScope, identity: { productId?: string; variantId?: string; sku?: string; opportunityId?: string }) {
  let key = identity
  if (identity.opportunityId) {
    const queue = await bounded(scope.supabase.from("ebay_luna_opportunity_queue").select("supplier_product_id,supplier_variant_id,supplier_sku")
      .eq("id", identity.opportunityId).limit(1)).maybeSingle()
    if (queue.error || !queue.data) throw Error("FAST_LISTING_CANONICAL_CASE_REQUIRED")
    key = { productId: queue.data.supplier_product_id, variantId: queue.data.supplier_variant_id, sku: queue.data.supplier_sku }
  }
  const snapshot = await bounded(scope.supabase.from("luna_catalog_snapshots_v1").select("snapshot_id")
    .eq("snapshot_status", "COMPLETE").order("snapshot_completed_at", { ascending: false }).limit(1)).maybeSingle()
  if (snapshot.error || !snapshot.data) throw Error("FAST_LISTING_CATALOG_SNAPSHOT_REQUIRED")
  let q = scope.supabase.from("luna_catalog_snapshot_variants_v1").select(sourceColumns).eq("snapshot_id", snapshot.data.snapshot_id)
  if (key.productId) q = q.eq("product_id", key.productId)
  if (key.variantId) q = q.eq("variant_id", key.variantId)
  if (key.sku) q = q.eq("sku", key.sku)
  if (!key.productId && !key.sku) throw Error("FAST_LISTING_LUNA_REFERENCE_REQUIRED")
  const r = await bounded(q.limit(2))
  if (r.error || r.data?.length !== 1) throw Error("FAST_LISTING_EXACT_VARIANT_REQUIRED")
  return record(r.data[0])
}
export async function startFastListingV1(scope: FastScope, identity: Parameters<typeof readFastSourceV1>[1]) {
  const source = await readFastSourceV1(scope, identity)
  const r = await scope.supabase.rpc("ensure_seller_os_fast_listing_v1", { p_account_key: scope.accountKey, p_owner_user_id: scope.ownerId,
    p_snapshot_id: source.snapshot_id, p_product_id: source.product_id, p_variant_id: source.variant_id, p_sku: source.sku })
  if (r.error || !r.data) throw Error("FAST_LISTING_INTAKE_FAILED")
  const result=record(r.data)
  return { context:record(result.context), opportunity:record(result.opportunity), source }
}
export async function loadFastListingV1(scope: FastScope, opportunityId: string) {
  const [context, queue, source] = await Promise.all([
    bounded(scope.supabase.from("seller_os_fast_listing_contexts_v1").select("*").eq("account_key", scope.accountKey)
      .eq("opportunity_id", opportunityId).eq("owner_user_id", scope.ownerId).limit(1)).maybeSingle(),
    bounded(scope.supabase.from("ebay_luna_opportunity_queue").select("*").eq("id", opportunityId).limit(1)).maybeSingle(),
    readFastSourceV1(scope, { opportunityId }) ])
  if (context.error || queue.error || !context.data || !queue.data) throw Error("FAST_LISTING_CANONICAL_CONTEXT_REQUIRED")
  return { context: record(context.data), opportunity: record(queue.data), source }
}
type Loaded = Awaited<ReturnType<typeof loadFastListingV1>>
function baseInput(scope: FastScope, loaded: Loaded): FastInput {
  const p = record(loaded.context.preferences), cached = record(p.authorities)
  return { accountKey: scope.accountKey, opportunityId: String(loaded.opportunity.id), candidateKey: String(loaded.opportunity.candidate_key),
    source: loaded.source, corrections: rows(p.corrections) as FastField[], confirmation: record(p.confirmation),
    market: rows(p.market) as unknown as GoldenMarketEvidence[], selectedEvidenceIds: Array.isArray(p.selectedEvidenceIds) ? p.selectedEvidenceIds.map(String) : [],
    packReasons: rows(p.packReasons), selectedQuantity: number(p.selectedQuantity) ?? 1, controlledTest: record(p.controlledTest),
    offers: (rows(p.offers) as unknown as FastOfferInput[]).map(o=>({...o,shipping:record(record(p.shippingReceipts)[String(o.quantity)])})), compliance: record(cached.compliance),
    duplicate: record(cached.duplicate), imageRights: record(cached.imageRights), finalReview: record(p.finalReview), now: scope.now ?? new Date() }
}
export function projectLoadedFastListingV1(scope: FastScope, loaded: Loaded) {
  const input = baseInput(scope, loaded)
  if (!input.offers.length) input.offers = [{ quantity: 1, price: null, priceReference: null, shipping: {}, fee: {}, advertising: null, otherCosts: null, costReference: null }]
  return { ...projectFastListingV1(input), revision: loaded.context.revision, packageId: record(loaded.context.preferences).packageId ?? null,
    pendingAction: loaded.context.pending_action, lastError: loaded.context.last_error, sourceUrl: loaded.source.canonical_url,
    researchPlan: record(record(loaded.context.preferences).researchPlan), shippingRequested: record(record(loaded.context.preferences).shippingRequested),
    reference: record(record(loaded.context.preferences).reference), title: record(record(loaded.context.preferences).draft).title ?? input.source.title,
    outcomes:record(record(loaded.context.preferences).outcomes),
    humanTasks:input.source?projectFastListingV1(input).truth.missing.map(field=>({field,action:"Confirmar o corregir con evidencia del producto exacto",ownerId:scope.ownerId})):[],
    imageAssets: rows(record(record(loaded.context.preferences).authorities).imageRights && record(record(record(loaded.context.preferences).authorities).imageRights).assets) }
}
async function write(scope: FastScope, loaded: Loaded, event: string, patch: FastRecord, token: string | null = null, eventKey?: string) {
  const next = { ...loaded, context: { ...loaded.context, preferences: { ...record(loaded.context.preferences), ...patch } } }
  const projected = projectLoadedFastListingV1(scope, next)
  const projection={...projected,learningEvidenceDigest:digest({event,patch,case:loaded.opportunity.id,revision:loaded.context.revision})}
  const r = await scope.supabase.rpc("write_seller_os_fast_listing_v1", { p_account_key: scope.accountKey, p_owner_user_id: scope.ownerId,
    p_opportunity_id: loaded.opportunity.id, p_revision: loaded.context.revision, p_event_key: eventKey ?? `fast-listing:${digest({ event, patch, revision: loaded.context.revision, case: loaded.opportunity.id })}`,
    p_event_type: event, p_patch: patch, p_projection: projection, p_lease_token: token })
  if (r.error || !r.data) throw Error(r.error?.message?.includes("REVISION_CONFLICT") ? "FAST_LISTING_REVISION_CONFLICT" : "FAST_LISTING_DURABLE_WRITE_FAILED")
  return { ...projection, revision: record(r.data).revision }
}
async function recordFailure(scope:FastScope,opportunityId:string,token:string,code:string) {
  const failurePatch:FastRecord={lease_expires_at:new Date().toISOString(),last_error:code,next_attempt_at:new Date(Date.now()+60000).toISOString()}
  const update=scope.supabase.from("seller_os_fast_listing_contexts_v1").update(failurePatch)
  await update.eq("account_key",scope.accountKey).eq("opportunity_id",opportunityId).eq("lease_token",token)
}
async function existingResearchPlan(scope: FastScope, loaded: Loaded, truth: ReturnType<typeof fastProductTruthV1>) {
  if (typeof truth.values.TITLE !== "string") throw Error("FAST_LISTING_TITLE_REQUIRED")
  const plan = buildProductResearchCommercialQueryPlanV1({ candidate: { supplierVariantId: String(loaded.source.variant_id),
    productName: truth.values.TITLE, brand: typeof truth.values.BRAND === "string" ? truth.values.BRAND : null },
    sourceField: "LUNA_FIELD_PRODUCT_TRUTH_V1.TITLE", sourceAuthority: "LUNA_PRODUCT_TRUTH" })
  const capability = await readProductResearchWorkerCapability(scope)
  const r = await scope.supabase.rpc("create_or_reuse_quick_pick_product_research_plan_v2", { p_plan_id: randomUUID(),
    p_marketplace_account_key: scope.accountKey, p_plan_version: plan.queries[0]?.strategyVersion,
    p_input_hash: digest({planInputHash:plan.inputHash,candidateId:loaded.opportunity.candidate_key}), p_opportunity_id: loaded.opportunity.id, p_candidate_key: loaded.opportunity.candidate_key,
    p_luna_product_id: loaded.source.product_id, p_luna_variant_id: loaded.source.variant_id, p_supplier_sku: loaded.source.sku,
    p_worker_capability_fresh: capability.fresh, p_observed_at: new Date().toISOString(), p_queries: plan.queries.map(q => ({ ordinal: q.ordinal,
      search_query: q.searchQuery, query_hash: q.queryHash, cluster_key_hash: q.clusterKeyHash, category_id: q.categoryId,
      candidate_count: q.candidateCount, candidate_variant_hashes: q.candidateVariantHashes, query_intent: q.intent,
      evidence_basis: q.evidenceBasis, strategy_version: q.strategyVersion })) })
  if (r.error || !r.data) throw Error("FAST_LISTING_EXISTING_RESEARCH_HANDOFF_FAILED")
  const query = [truth.values.BRAND, truth.values.MODEL, truth.values.GTIN, truth.values.TITLE].filter(v => typeof v === "string" && v.trim()).join(" ").slice(0, 240)
  const url = new URL("https://www.ebay.com/sch/i.html"); url.searchParams.set("_nkw", query); url.searchParams.set("LH_Sold", "1"); url.searchParams.set("LH_Complete", "1")
  return { ...record(r.data), query, publicSoldUrl: url.toString(), source: "EXISTING_PRODUCT_RESEARCH_WORKER" }
}
async function evaluate(scope: FastScope, loaded: Loaded) {
  const input = baseInput(scope, loaded), truth = fastProductTruthV1(input.source, input.corrections, input.now), p = record(loaded.context.preferences)
  const account = getEbaySellerAccountScopeConfiguration()
  const ctx = { supabase: scope.supabase, accountKey: scope.accountKey, accountAlias: account.accountAlias,
    principal: { ownerUserId: scope.ownerId, commandClientId: "FAST_LISTING_OWNER_UI" }, now: input.now } as GoldenContext
  const key = { productId: String(input.source.product_id), variantId: String(input.source.variant_id), supplierSku: String(input.source.sku), supplierQuantity: 1 }
  const [market, sweep] = await Promise.all([marketEvidence(ctx, key), getEbayOfficialLiveListingSweepReadonly({ accountKey: scope.accountKey, accountAlias: account.accountAlias ?? "" })])
  const duplicate = await duplicateGate(ctx, key, input.source, sweep).catch(() => ({ status: "UNPROVEN" }))
  input.market = market.rows
  const count = number(truth.values.QUANTITY_OR_SET_COUNT)
  const target = (q: number) => ({ productName: String(truth.values.TITLE ?? ""), manufacturerBrand: typeof truth.values.BRAND === "string" ? truth.values.BRAND : null,
    model: typeof truth.values.MODEL === "string" ? truth.values.MODEL : null, gtin: q === 1 && typeof truth.values.GTIN === "string" ? truth.values.GTIN : null,
    color: typeof truth.values.COLOR === "string" ? truth.values.COLOR : null, packCount: count === null ? null : count * q })
  const confirmed = input.confirmation.truthDigest === truth.evidenceDigest && Boolean(input.confirmation.actorId)
  const policy = record(resolveCommercialTraceOwnerPricePolicyV1({ marketplaceAccountKey: scope.accountKey, lunaProductId: key.productId,
    lunaVariantId: key.variantId, supplierSku: key.supplierSku, sourceFingerprint: String(input.source.source_fingerprint) }))
  const costReference = policy.status === "PROVEN" ? String(policy.policyDigest) : null
  let compliance: FastRecord = {}, category: FastRecord = {}
  const eligible = [1, 2, 3, 4].filter(q => q === 1 || input.packReasons.some(r => r.quantity === q && r.truthDigest === truth.evidenceDigest && r.actorId) ||
    market.rows.some(e => e.listingState === "SOLD" && e.realizedPriceStatus === "PROVEN" && ["EXACT", "CLOSE"].includes(classifyGoldenComparable(target(q), e).classification)))
  const offers: FastOfferInput[] = []
  for (const quantity of eligible) {
    const priced = market.rows.filter(e => e.listingState === "SOLD" && e.currency === "USD" && e.realizedPriceStatus === "PROVEN" && e.realizedSoldPrice !== null && e.realizedSoldPrice > 0 &&
      e.buyerShipping !== null && e.buyerShipping >= 0 && e.soldQuantity !== null && e.soldQuantity > 0 && Number.isSafeInteger(e.soldQuantity) &&
      Date.parse(String(e.lastSoldDate)) <= Date.parse(e.capturedAt) && Date.parse(e.capturedAt) <= +input.now && +input.now-Date.parse(String(e.lastSoldDate))<=90*86400000 &&
      ["EXACT", "CLOSE"].includes(classifyGoldenComparable(target(quantity), e).classification))
      .map(e => ({ ...e, buyerLandedPrice: Math.round((e.realizedSoldPrice! + e.buyerShipping!) * 100) / 100 }))
    const soldPrice = goldenCompetitiveSoldPriceV1(priced).price
    const controlledPrice = record(record(p.controlledPrices)[String(quantity)])
    const controlledValid = input.controlledTest.truthDigest === truth.evidenceDigest && input.controlledTest.confirmed === true && controlledPrice.actorId && controlledPrice.truthDigest === truth.evidenceDigest
    const price = soldPrice ?? (controlledValid ? number(controlledPrice.price) : null)
    const priceReference = soldPrice !== null ? digest(priced.map(e => e.sourceDigest)) : controlledValid ? String(controlledPrice.evidenceDigest) : null
    const authority = confirmed ? await readGoldenPresaleAuthorityV1({ supabase: scope.supabase, accountKey: scope.accountKey,
      candidate: { ...key, supplierQuantity: quantity }, source: input.source, price,
      confirmedOwnerFacts: { values: truth.values, evidenceDigest: truth.evidenceDigest, exactIdentityConfirmed: true },
      selectedCategory: category.status === "PROVEN" ? category as never : undefined }).catch(() => ({ category: {}, fee: {} })) : { category: {}, fee: {} }
    category = record(authority.category)
    const fee = { ...record(authority.fee), sourceFingerprint: input.source.source_fingerprint, truthDigest:truth.evidenceDigest }
    const shipping = record(record(p.shippingReceipts)[String(quantity)])
    const advertising = policy.status === "PROVEN" && record(policy.promotedListings).state === "NOT_APPLICABLE" ? 0 : null
    const otherCosts = policy.status === "PROVEN" && record(policy.otherExplicitCosts).state === "NOT_APPLICABLE" ? 0 : null
    offers.push({ quantity, price, priceReference, fee, shipping, advertising, otherCosts, costReference })
  }
  if (category.status === "PROVEN") {
    const categoryId = String(category.categoryId ?? "")
    const [taxonomy, identifiers] = await Promise.all([getEbayTaxonomyListingIntelligence(String(truth.values.TITLE ?? ""), categoryId, { allowTitleSuggestionFallback: false }),
      preflightEbayCategoryProductIdentifiers({ categoryId, marketplaceId: "EBAY_US", inventoryItemPayload: { product: typeof truth.values.GTIN === "string" ? { upc: truth.values.GTIN } : {} } })])
    const mapping: Record<string,string> = { brand: "BRAND", model: "MODEL", color: "COLOR", material: "MATERIAL", size: "SIZE_SET" }
    const specifics: FastRecord = {}
    for (const aspect of taxonomy.aspects ?? []) { const value = truth.values[mapping[aspect.name.toLowerCase()] ?? aspect.name.toUpperCase()]
      if (typeof value === "string" && aspect.constraintsComplete && (!aspect.maxLength || value.length<=aspect.maxLength) &&
        (aspect.mode !== "SELECTION_ONLY" || aspect.valuesComplete && aspect.values.some(v => v.value.toLowerCase()===value.toLowerCase()))) specifics[aspect.name]=value }
    const missing = (taxonomy.aspects ?? []).filter(a => (a.required || a.officialConditionalRequirement?.evaluation === "APPLIES") && !specifics[a.name]).map(a => a.name)
    const ready = taxonomy.status === "AVAILABLE" && missing.length === 0 && !(taxonomy.aspects ?? []).some(a=>a.officialConditionalRequirement?.evaluation === "UNPROVEN") && identifiers.safe === true
    const regulated = /\b(cure|treats?|supplement|medical|fda approved|pesticide|disinfectant)\b/i.test(String(truth.values.TITLE ?? ""))
    const condition=ebayConditionContractFromVerifiedFact(truth.values.CONDITION)
    compliance = { categoryReady: true, categoryId, conditionReady:Boolean(condition), conditionId:condition?.conditionId ?? null,
      specificsReady: ready, specifics, missing, status: ready && Boolean(condition) && !regulated ? "PROVEN" : "UNPROVEN",
      categoryReceipt: category.receiptId, taxonomy, identifierPreflight: identifiers, reason: regulated ? "OWNER_COMPLIANCE_REQUIRED" : null }
  }
  let imageRights: FastRecord = { status: "UNPROVEN", assets: [] }
  try {
    const identity = { supplierProductId: key.productId, supplierVariantId: key.variantId, supplierSku: key.supplierSku }
    const authorized = resolveInheritedLunaSupplierImageRightsV1({ packageCandidateKey: input.candidateKey, opportunityCandidateKey: input.candidateKey,
      opportunityIdentity: identity, catalogIdentity: identity, catalogSourceKey: "lunaportex", officialImageUrls: Array.isArray(input.source.images) ? input.source.images.map(String) : [], sourceUrl: String(input.source.canonical_url) })
    imageRights = { status: "AUTHORIZED", authority: authorized, representedSupplierQuantity:1, assets: (Array.isArray(input.source.images) ? input.source.images : []).map(url => ({ url, source: "LUNA", authorized: true })) }
  } catch { /* Explicitly unavailable; no competitor or guessed fallback. */ }
  const binding={truthDigest:truth.evidenceDigest,sourceFingerprint:input.source.source_fingerprint,observedAt:input.now.toISOString(),freshUntil:new Date(+input.now+3600000).toISOString()}
  const outcomes=await readFastListingOutcomesV1({supabase:scope.supabase,accountKey:scope.accountKey,packageId:typeof p.packageId==="string"?p.packageId:null,now:input.now})
  return { market: market.rows, offers, outcomes, authorities: { duplicate:{...duplicate,...binding}, compliance:{...compliance,...binding}, category, imageRights:{...imageRights,...binding} }, evaluatedAt: input.now.toISOString() }
}

async function prepare(scope: FastScope, loaded: Loaded) {
  const projection = projectLoadedFastListingV1(scope, loaded)
  if (!projection.canPrepareDraft) throw Error("FAST_LISTING_MINIMUM_DRAFT_TRUTH_REQUIRED")
  const p = record(loaded.context.preferences), facts = projection.truth.values
  const existing = await bounded(scope.supabase.from("ebay_listing_packages").select("id,status,package_data").eq("opportunity_id", loaded.opportunity.id)
    .or(`account_key.eq.${scope.accountKey},account_key.is.null`).order("updated_at", { ascending: false }).limit(2))
  if (existing.error) throw Error("FAST_LISTING_WORKSPACE_READ_FAILED")
  // Existing packages retain their normal/certified authority and owner approvals.
  const previous=existing.data?.[0]
  if(previous && (record(record(previous.package_data).fastListingV1).contractVersion!==FAST_LISTING_V1 || previous.status!=="draft"))
    return { packageId:previous.id,packageReused:true,existingPackageProtected:true }
  const packageId = previous?.id ?? randomUUID()
  const opportunity = { ...loaded.opportunity, assessment: { ...record(loaded.opportunity.assessment), productTruth: {
    title: facts.TITLE, lunaProductId: loaded.source.product_id, lunaVariantId: loaded.source.variant_id,
    supplierSku: loaded.source.sku, sourceUrl: loaded.source.canonical_url, brand: facts.BRAND ?? null } } }
  const keyword = await readKeywordDecisionHandoffV1({ supabase: scope.supabase, binding: { ACCOUNT_KEY: scope.accountKey,
    PRODUCT_ID: String(loaded.source.product_id), VARIANT_ID: String(loaded.source.variant_id), CANDIDATE_KEY: String(loaded.opportunity.candidate_key), OPPORTUNITY_ID: String(loaded.opportunity.id) } })
  const review = buildQuickPickMarketTestListingReviewV1({ opportunity, listingPackage: { id: packageId, package_data: {} },
    catalogRow: { title: facts.TITLE }, keywordDecisionHandoff: keyword,
    keywordDecisionBinding: { ACCOUNT_KEY: scope.accountKey, PRODUCT_ID: String(loaded.source.product_id), VARIANT_ID: String(loaded.source.variant_id),
      CANDIDATE_KEY: String(loaded.opportunity.candidate_key), OPPORTUNITY_ID: String(loaded.opportunity.id) } })
  const c = record(record(p.authorities).compliance), selected = projection.selected
  const title=selected && selected.quantity>1?`Pack ${selected.quantity} · ${review.title}`.slice(0,80):review.title
  const data = { title, description: [...(selected?[`${selected.quantity} unidades proveedor; ${selected.includedCount} piezas incluidas en total.`]:[]),...projection.truth.fields.filter(f => f.STATUS === "PROVEN" &&
    ["TITLE","PACKAGE_CONTENTS","MATERIAL","COLOR","MODEL","SIZE_SET"].includes(f.FIELD)).map(f=>`${f.FIELD}: ${String(f.VALUE)}`)].join("\n"),
    categoryId: c.categoryId ?? null, conditionLabel: facts.CONDITION ?? null, conditionId: c.conditionId ?? null,
    aspects: c.specifics ?? {}, imageUrls: projection.imageAssets.map(a=>a.url),
    pricing: { targetPrice: selected?.price ?? null, currency: "USD", supplierCost: selected?.totalLunaCost ?? null,
      estimatedNetProfit: selected?.netProfit ?? null, estimatedEbayFees: selected?.ebayFee ?? null,estimatedOutboundShipping:selected?.shipping ?? null,
      estimatedNetMarginPercent:selected?.marginPercent ?? null,passesProfitGate:selected?.recommended ?? false,authoritativeSupplierShipping:selected?.shipping!==null },
    offer: { supplierQuantity: selected?.quantity ?? 1, includedCount: selected?.includedCount ?? null },
    productTruth: { values: facts, fields: projection.truth.fields, evidenceDigest: projection.truth.evidenceDigest },
    fastListingV1: { contractVersion: FAST_LISTING_V1, projection, reviewed: false, publicationAuthorized: false, internalDraftOnly: true },
    publication: { mode: "OWNER_MANUAL", publishCapability: false, marketplaceWrites: 0 }, evidenceDigest: digest(projection) }
  if(previous){const updated=await scope.supabase.from("ebay_listing_packages").update({package_data:{...record(previous.package_data),...data},source_observed_at:loaded.source.observed_at})
    .eq("id",packageId).eq("account_key",scope.accountKey).eq("status","draft")
    if(updated.error) throw Error("FAST_LISTING_INTERNAL_DRAFT_UPDATE_FAILED")
    return {packageId,draft:{title:data.title,description:data.description},packageReused:true,preparedAt:new Date().toISOString()}}
  const r = await scope.supabase.from("ebay_listing_packages").insert({ id: packageId, opportunity_id: loaded.opportunity.id,
    candidate_key: loaded.opportunity.candidate_key, account_key: scope.accountKey, status: "draft", readiness: 0, package_data: data,
    created_by: scope.ownerId, source_observed_at: loaded.source.observed_at })
  if (r.error) {
    if (r.error.code === "23505") { const retry=await scope.supabase.from("ebay_listing_packages").select("id").eq("opportunity_id",loaded.opportunity.id).limit(1).maybeSingle()
      if(retry.data) return { packageId: retry.data.id, packageReused: true } }
    throw Error("FAST_LISTING_INTERNAL_DRAFT_WRITE_FAILED")
  }
  return { packageId, draft: { title: data.title, description: data.description }, preparedAt: new Date().toISOString() }
}

export async function runFastListingActionV1(scope: FastScope, opportunityId: string, action: string, body: FastRecord = {}, ownerAction = false) {
  const loaded = await loadFastListingV1(scope, opportunityId), p = record(loaded.context.preferences), now = scope.now ?? new Date()
  const truth = fastProductTruthV1(loaded.source, rows(p.corrections) as FastField[], now)
  if (["CORRECT","CONFIRM","COMPARABLE","PACK","CONTROLLED_TEST","PRICE","SELECT","FINAL_REVIEW","REFERENCE"].includes(action)) {
    if (!ownerAction) throw Error("FAST_LISTING_EXPLICIT_OWNER_ACTION_REQUIRED")
    if (body.revision !== loaded.context.revision) throw Error("FAST_LISTING_REVISION_CONFLICT")
    let patch: FastRecord = {}
    if (action === "CORRECT") {
      const field = String(body.field), corrections = rows(p.corrections) as FastField[]
      const corrected = validateFastCorrectionV1({ field, value: body.value, actorId: scope.ownerId, opportunityId,
        sourceFingerprint: String(loaded.source.source_fingerprint), previous: truth.fields.find(f=>f.FIELD===field)?.EVIDENCE_ID ?? null, now })
      patch = { corrections: [...corrections.filter(c=>c.FIELD!==field), corrected], confirmation: {}, finalReview: {} }
    }
    if (action === "CONFIRM") patch = { confirmation: { actorId: scope.ownerId, confirmedAt: now.toISOString(), truthDigest: truth.evidenceDigest }, finalReview: {} }
    if (action === "CONTROLLED_TEST") patch = { controlledTest: { confirmed: true, actorId: scope.ownerId, reason: String(body.reason ?? "Prueba controlada sin historial exacto").slice(0,500), truthDigest: truth.evidenceDigest, confirmedAt: now.toISOString() }, finalReview: {} }
    if (action === "PACK") {
      const quantity = number(body.quantity), explanation = String(body.explanation ?? "").trim()
      if (!quantity || ![2,3,4].includes(quantity) || explanation.length < 12) throw Error("FAST_LISTING_PACK_EVIDENCE_REQUIRED")
      patch = { packReasons: [...rows(p.packReasons).filter(r=>r.quantity!==quantity), { quantity, reason: "HUMAN_CONFIRMATION", actorId: scope.ownerId,
        truthDigest: truth.evidenceDigest, explanation, confirmedAt: now.toISOString() }], finalReview: {} }
    }
    if (action === "PRICE") {
      const quantity = number(body.quantity), price=number(body.price)
      if (!quantity || ![1,2,3,4].includes(quantity) || price===null || price<=0 || record(p.controlledTest).confirmed!==true) throw Error("FAST_LISTING_CONTROLLED_PRICE_REQUIRED")
      const value = { price, actorId: scope.ownerId, truthDigest: truth.evidenceDigest, observedAt: now.toISOString(), source: "OWNER_CONTROLLED_TEST_PRICE" }
      patch = { controlledPrices: { ...record(p.controlledPrices), [String(quantity)]: { ...value, evidenceDigest: digest(value) } }, finalReview: {} }
    }
    if (action === "COMPARABLE") {
      const evidence = rows(p.market).find(e=>e.evidenceId===body.evidenceId)
      if (!evidence || evidence.listingState!=="SOLD") throw Error("FAST_LISTING_SOLD_COMPARABLE_REQUIRED")
      patch = { selectedEvidenceIds: [...new Set([...(Array.isArray(p.selectedEvidenceIds)?p.selectedEvidenceIds:[]),body.evidenceId])],
        comparableReview: { evidenceId: body.evidenceId, actorId: scope.ownerId, reviewedAt: now.toISOString(), query: record(p.researchPlan).query,
          itemId: String(evidence.sourceLocator).match(/\/itm\/(\d+)/)?.[1] ?? null, price: evidence.realizedSoldPrice,
          shipping: evidence.buyerShipping, packCount: record(evidence.identity).packCount, soldAt: evidence.lastSoldDate,
          sourceDigest:evidence.sourceDigest,capturedAt:evidence.capturedAt,realizedPriceStatus:evidence.realizedPriceStatus,
          matchDegree:projectLoadedFastListingV1(scope,loaded).comparables.find(c=>c.evidenceId===body.evidenceId)?.classification??"UNPROVEN",
          quantitySold:evidence.soldQuantity,humanConfirmed:true,marketplaceWrites:0 }, finalReview: {} }
    }
    if (action === "SELECT") {
      const current=projectLoadedFastListingV1(scope,loaded), quantity=number(body.quantity)
      if (!current.matrix.some(o=>o.quantity===quantity)) throw Error("FAST_LISTING_SUPPORTED_PRESENTATION_REQUIRED")
      patch={selectedQuantity:quantity,finalReview:{}}
    }
    if (action === "FINAL_REVIEW") {
      const current=projectLoadedFastListingV1(scope,loaded)
      if(current.publishBlockers.some(b=>b!=="FINAL_HUMAN_REVIEW_REQUIRED")) throw Error("FAST_LISTING_PUBLICATION_BLOCKERS_REMAIN")
      patch={finalReview:{actorId:scope.ownerId,reviewedAt:now.toISOString(),truthDigest:truth.evidenceDigest,offerDigest:digest(current.selected)}}
    }
    if (action === "REFERENCE") {
      const selected=rows(p.market).find(e=>e.evidenceId===body.evidenceId && Array.isArray(p.selectedEvidenceIds) && p.selectedEvidenceIds.includes(e.evidenceId))
      const itemId=String(selected?.sourceLocator ?? "").match(/\/itm\/(\d{9,20})/)?.[1]
      if(!itemId) throw Error("FAST_LISTING_CONFIRMED_REFERENCE_REQUIRED")
      const official=await readManualListingFromTradingApi(itemId).catch(()=>null)
      patch={reference:{itemId,url:`https://www.ebay.com/sl/sell?mode=SellLikeItem&itemId=${itemId}`,
        differences:fastReferenceDifferencesV1({ ...record(selected?.identity), categoryId:official?.safeDefaults.categoryId,
          condition:official?.safeDefaults.conditionId, title:official?.title, item_id:itemId },truth),productTruthReplaced:false,competitorImagesImported:false}}
    }
    return write(scope,loaded,action,patch)
  }
  if(action==="RESEARCH") return write(scope,loaded,action,{researchPlan:await existingResearchPlan(scope,loaded,truth)})
  if(!["EVALUATE","PREPARE","SHIPPING"].includes(action)) throw Error("FAST_LISTING_ACTION_INVALID")
  const operationKey=typeof body.operationKey==="string"?body.operationKey:`fast-listing:${digest({opportunityId,action,truthDigest:truth.evidenceDigest,
    sourceFingerprint:loaded.source.source_fingerprint,selectedQuantity:p.selectedQuantity,packReasons:p.packReasons,controlledPrices:p.controlledPrices,
    controlledTest:p.controlledTest,confirmation:p.confirmation,selectedEvidenceIds:p.selectedEvidenceIds,shippingReceipts:p.shippingReceipts,
    refresh:action==="EVALUATE"?Math.floor(+now/300000):null})}`
  const token=randomUUID(), claim=await scope.supabase.rpc("claim_seller_os_fast_listing_v1",{p_account_key:scope.accountKey,p_owner_user_id:scope.ownerId,p_opportunity_id:opportunityId,p_action:action,p_operation_key:operationKey,p_token:token})
  if(claim.error || !claim.data) throw Error(claim.error?.message?.includes("RETRY_EXHAUSTED")?"FAST_LISTING_RETRY_EXHAUSTED":"FAST_LISTING_OPERATION_CLAIM_FAILED")
  const c=record(claim.data)
  if(c.claimed!==true) return {...projectLoadedFastListingV1(scope,loaded),operationInProgress:c.completed!==true}
  const active={...loaded,context:record(c.context)}
  try {
    let patch:FastRecord={}
    if(action==="EVALUATE") patch=await evaluate(scope,active)
    if(action==="PREPARE") patch=await prepare(scope,active)
    if(action==="SHIPPING") {
      const projection=projectLoadedFastListingV1(scope,active)
      if(!projection.canPrepareDraft || !projection.identityConfirmed) throw Error("FAST_LISTING_CONFIRMED_SHIPPING_IDENTITY_REQUIRED")
      const requested:FastRecord={}
      for(const offer of projection.matrix) requested[String(offer.quantity)]={quantity:offer.quantity,requestedAt:now.toISOString(),sourceFingerprint:loaded.source.source_fingerprint,truthDigest:truth.evidenceDigest}
      patch={shippingRequested:requested}
    }
    return await write(scope,active,action,patch,token,operationKey)
  } catch(error) {
    const code=error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message)?error.message:"FAST_LISTING_OPERATION_FAILED"
    await recordFailure(scope,opportunityId,token,code)
    throw Error(code)
  }
}
export async function recoverFastListingsV1(input:{supabase:SupabaseClient;accountKey:string}) {
  const query=input.supabase.from("seller_os_fast_listing_contexts_v1").select("*")
  query.eq("account_key",input.accountKey);query.not("pending_action","is",null);query.lt("lease_expires_at",new Date().toISOString())
  query.lte("next_attempt_at",new Date().toISOString());query.lt("attempt_count",3);query.limit(5)
  const pending=await bounded(query)
  if(pending.error) return {status:"UNAVAILABLE",recovered:0,marketplaceWrites:0}
  const results=[]
  for(const row of pending.data??[]) { try { await runFastListingActionV1({...input,ownerId:row.owner_user_id},row.opportunity_id,row.pending_action,{operationKey:row.operation_key});results.push({opportunityId:row.opportunity_id,status:"RECOVERED"}) }
    catch {results.push({opportunityId:row.opportunity_id,status:"PENDING_OR_EXHAUSTED"})} }
  const refresh=await bounded(input.supabase.from("seller_os_fast_listing_contexts_v1").select("opportunity_id,owner_user_id")
    .eq("account_key",input.accountKey).is("pending_action",null).lt("updated_at",new Date(Date.now()-300000).toISOString()).order("updated_at").limit(3))
  for(const row of refresh.data??[]){try{await runFastListingActionV1({...input,ownerId:row.owner_user_id},row.opportunity_id,"EVALUATE");results.push({opportunityId:row.opportunity_id,status:"REFRESHED_EXISTING_EVIDENCE"})}
    catch{results.push({opportunityId:row.opportunity_id,status:"REFRESH_PENDING"})}}
  return {status:"PASS",results,marketplaceWrites:0}
}
