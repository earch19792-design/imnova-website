import type { SupabaseClient } from "@supabase/supabase-js"

import { readLunaQuickPickProgressV1 } from
  "../ebay/ebay-luna-quick-pick-v1"
import { buildSellerOsProductJourneyV1 } from "./product-journey-v1"

type Row = Record<string, unknown>

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {}
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500): string | null {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function unique(values: readonly (string | null)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function latest(values: readonly Row[], field = "updated_at") {
  return ([...values].sort((left, right) =>
    Date.parse(String(right[field] ?? right.created_at ?? "")) -
      Date.parse(String(left[field] ?? left.created_at ?? "")))[0] ?? null)
}

function assertRead(name: string, result: Readonly<{ error?: unknown }>) {
  if (result.error) throw new Error(`PRODUCT_JOURNEY_${name}_READ_FAILED`)
}

export async function readSellerOsProductJourneyV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateId: string
  now?: Date
}>) {
  if (!/^sha256:[0-9a-f]{64}$/.test(input.candidateId)) {
    throw new Error("PRODUCT_JOURNEY_CANDIDATE_ID_INVALID")
  }
  const queueRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("*").eq("candidate_key", input.candidateId)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle()
  assertRead("QUEUE", queueRead)
  const queue = record(queueRead.data)
  if (!text(queue.id, 80)) throw new Error("PRODUCT_JOURNEY_NOT_FOUND")

  let card: Row = {}
  let quickPickProjectionWarning: string | null = null
  try {
    const cardRead = await readLunaQuickPickProgressV1({
      supabase: input.supabase, accountKey: input.accountKey,
      candidateKeys: [input.candidateId], includeRecent: false,
    })
    card = cardRead[0] ? record(cardRead[0]) : {}
  } catch {
    // Quick Pick is an owner projection, not journey authority. A transient
    // failure in that projection must not erase otherwise readable receipts.
    quickPickProjectionWarning = "QUICK_PICK_PROJECTION_READ_UNAVAILABLE"
  }
  const opportunityId = String(queue.id)
  const variantId = text(queue.supplier_variant_id, 80)
  const supplierSku = text(queue.supplier_sku, 160)
  const assessment = record(queue.assessment)
  const familyId = text(record(assessment.radarFactoryCandidateV1).familyId,
    160)

  const [packageRead, researchObservationRead, radarRead, frontierRead,
    shippingClaimRead, queueEventsRead] = await Promise.all([
    input.supabase.from("ebay_listing_packages").select("*")
      .eq("account_key", input.accountKey).eq("opportunity_id", opportunityId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    variantId ? input.supabase.from(
      "marketplace_product_research_capture_observations")
      .select("id,capture_batch_id,evidence_deduplication_key,match_classification,match_reasons,normalized_identity,confirmed_sold_quantity,average_sold_price,average_shipping,last_sold_date,evidence_reviewed,created_at")
      .eq("marketplace_account_key", input.accountKey)
      .eq("matched_supplier_variant_id", variantId)
      .order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    familyId ? input.supabase.rpc("get_seller_os_family_market_radar_v1", {
      p_family_id: familyId, p_limit: 1,
    })
      : Promise.resolve({ data: null, error: null }),
    variantId && supplierSku ? input.supabase.rpc(
      "get_seller_os_latest_profitability_frontiers_v1", {
        p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
        p_family_ids: familyId ? [familyId] : null, p_limit: 100,
      })
      : Promise.resolve({ data: null, error: null }),
    input.supabase.from("seller_os_luna_shipping_job_claims").select("*")
      .eq("account_key", input.accountKey).eq("candidate_id", input.candidateId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("ebay_luna_opportunity_queue_events")
      .select("id,event_type,old_value,new_value,created_at")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false }).limit(100),
  ])
  for (const [name, read] of [["PACKAGE", packageRead],
    ["RESEARCH", researchObservationRead], ["RADAR", radarRead],
    ["FRONTIER", frontierRead], ["SHIPPING", shippingClaimRead],
    ["EVENTS", queueEventsRead]] as const) assertRead(name, read)

  const listingPackage = record(packageRead.data)
  const packageId = text(listingPackage.id, 80)
  const researchObservations = rows(researchObservationRead.data)
  const captureBatchIds = unique(researchObservations.map((entry) =>
    text(entry.capture_batch_id, 80)))
  const [approvalRead, executionRead, publicationRead, batchChildRead,
    activeListingRead, imageAssetsRead, captureBatchRead, researchTaskRead] =
    await Promise.all([
      packageId ? input.supabase.from("ebay_draft_only_approvals")
        .select("*").eq("listing_package_id", packageId)
        .order("updated_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
      packageId ? input.supabase.from("ebay_draft_only_execution_ledger")
        .select("*").eq("listing_package_id", packageId)
        .order("updated_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
      packageId ? input.supabase.from("ebay_authorized_listing_publications")
        .select("*").eq("listing_package_id", packageId)
        .order("updated_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
      input.supabase.from("seller_os_publisher_batch_children_v1")
        .select("*").eq("marketplace_account_key", input.accountKey)
        .eq("candidate_id", input.candidateId)
        .order("updated_at", { ascending: false }).limit(20),
      supplierSku ? input.supabase.from("ebay_active_listings").select("*")
        .eq("account_key", input.accountKey).eq("supplier_sku", supplierSku)
        .order("last_ebay_sync_at", { ascending: false }).limit(1)
        .maybeSingle() : Promise.resolve({ data: null, error: null }),
      packageId ? input.supabase.from("ebay_listing_image_assets")
        .select("id,status,asset_role,source_sha256,output_sha256,position,approved_at,created_at,updated_at")
        .eq("listing_package_id", packageId).order("position",
          { ascending: true }).limit(24)
        : Promise.resolve({ data: [], error: null }),
      captureBatchIds.length ? input.supabase.from(
        "marketplace_product_research_capture_batches").select("*")
        .in("id", captureBatchIds).order("captured_at",
          { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
      captureBatchIds.length ? input.supabase.from(
        "marketplace_product_research_query_tasks")
        .select("*").in("capture_batch_id", captureBatchIds)
        .order("updated_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
    ])
  for (const [name, read] of [["APPROVAL", approvalRead],
    ["EXECUTION", executionRead], ["PUBLICATION", publicationRead],
    ["BATCH_CHILD", batchChildRead], ["ACTIVE_LISTING", activeListingRead],
    ["IMAGES", imageAssetsRead], ["RESEARCH_BATCH", captureBatchRead],
    ["RESEARCH_TASK", researchTaskRead]] as const) assertRead(name, read)

  const researchTasks = rows(researchTaskRead.data)
  const planIds = unique(researchTasks.map((entry) => text(entry.plan_id, 80)))
  const researchPlanRead = planIds.length ? await input.supabase.from(
    "marketplace_product_research_query_plans").select("*")
    .in("id", planIds).order("updated_at", { ascending: false }).limit(20)
    : { data: [], error: null }
  assertRead("RESEARCH_PLAN", researchPlanRead)
  const researchBatches = rows(captureBatchRead.data)
  const research = researchObservations.length || researchTasks.length ||
      researchBatches.length ? Object.freeze({
    planCount: rows(researchPlanRead.data).length,
    taskCount: researchTasks.length,
    completedTaskCount: researchTasks.filter((entry) =>
      ["CAPTURED", "PROCESSED"].includes(String(entry.status))).length,
    failedTaskCount: researchTasks.filter((entry) =>
      Boolean(text(entry.last_error_code, 160))).length,
    captureBatchCount: researchBatches.length,
    sourceRowCount: researchBatches.reduce((sum, entry) => sum +
      (Number(entry.source_row_count) || 0), 0),
    acceptedComparableCount: researchObservations.filter((entry) =>
      entry.match_classification === "EXACT_LUNA_MATCH" &&
      entry.evidence_reviewed === true).length,
    rejectedComparableCount: researchObservations.filter((entry) =>
      entry.match_classification !== "EXACT_LUNA_MATCH").length,
    dedupedComparableCount: new Set(researchObservations.map((entry) =>
      text(entry.evidence_deduplication_key, 100)).filter(Boolean)).size,
    queries: unique(researchTasks.map((entry) =>
      text(entry.search_query, 100))),
    rejectionReasons: unique(researchObservations.flatMap((entry) =>
      Array.isArray(entry.match_reasons)
        ? entry.match_reasons.map((reason) => text(reason, 160)) : [])),
    capturedAt: text(researchBatches[0]?.captured_at, 80)
      ?? text(researchObservations[0]?.created_at, 80),
    confirmedSoldQuantity: researchObservations.reduce((sum, entry) => sum +
      (Number(entry.confirmed_sold_quantity) || 0), 0),
    lastSoldAt: researchObservations.map((entry) =>
      text(entry.last_sold_date, 80)).filter((value): value is string =>
      Boolean(value)).sort((left, right) => Date.parse(right) -
        Date.parse(left))[0] ?? null,
    minimumSoldPrice: (() => {
      const values = researchObservations.map((entry) =>
        Number(entry.average_sold_price)).filter(Number.isFinite)
      return values.length ? Math.min(...values) : null
    })(),
    maximumSoldPrice: (() => {
      const values = researchObservations.map((entry) =>
        Number(entry.average_sold_price)).filter(Number.isFinite)
      return values.length ? Math.max(...values) : null
    })(),
    itemIdDedupeProven: researchObservations.length === new Set(
      researchObservations.map((entry) => text(
        entry.evidence_deduplication_key, 100)).filter(Boolean)).size,
    soldDatesPresent: researchObservations.every((entry) =>
      Boolean(text(entry.last_sold_date, 80))),
    conditionCoverageProven: researchObservations.every((entry) => {
      const identity = record(entry.normalized_identity)
      return Boolean(text(identity.condition, 80)
        ?? text(identity.conditionId, 80))
    }),
    shippingTreatmentProven: researchObservations.every((entry) =>
      Number.isFinite(Number(entry.average_shipping))),
  }) : null
  const batchChildren = rows(batchChildRead.data)
  const exactBatchChild = batchChildren.find((entry) =>
    !packageId || entry.package_id === packageId) ?? batchChildren[0] ?? null
  const publication = latest(rows(publicationRead.data))
  const activeListing = record(activeListingRead.data)
  const journey = buildSellerOsProductJourneyV1({
    now: (input.now ?? new Date()).toISOString(), queue, card,
    listingPackage, approval: latest(rows(approvalRead.data)),
    execution: latest(rows(executionRead.data)), publication,
    batchChild: exactBatchChild, activeListing,
    frontier: (() => {
      const candidates = rows(record(frontierRead.data).frontiers)
      const selected = candidates.find((entry) => {
        const payload = record(entry.frontier)
        return payload.lunaVariantId === variantId &&
          payload.lunaSku === supplierSku
      }) ?? {}
      const payload = record(selected.frontier)
      return {
        frontier_id: selected.frontierId,
        market_price_evidence_reference:
          selected.marketPriceEvidenceReference,
        market_price_evidence_digest: selected.marketPriceEvidenceDigest,
        economic_policy_digest: selected.economicPolicyDigest,
        source_updated_at: selected.sourceUpdatedAt,
        evidence_cutoff_at: selected.evidenceCutoffAt,
        calculated_at: selected.calculatedAt,
        frontier_digest: payload.frontierDigest,
        shipping_status: payload.shippingStatus,
        shipping_value: payload.shippingValue,
        shipping_capture_evidence: payload.shippingCaptureEvidence,
      }
    })(),
    radarObservation: (() => {
      const family = rows(record(radarRead.data).families)[0] ?? {}
      const current = rows(record(family).observationSeries)[0] ?? {}
      return {
        observation_id: current.observationId,
        opportunity_case_id: family.opportunityCaseId,
        observation_window_start: current.observationWindowStart,
        family_demand_status: current.familyDemandStatus,
        demand_evidence_digest: current.demandEvidenceDigest,
        sold_comparable_count: current.soldComparableCount,
        evidence_observed_at: current.evidenceObservedAt,
        maximum_age_seconds: current.maximumAgeSeconds,
        source_contract_version: current.sourceContractVersion,
        fresh: current.fresh,
      }
    })(),
    shippingClaim: record(shippingClaimRead.data), research,
    queueEvents: rows(queueEventsRead.data),
  })
  return Object.freeze({ ...journey, evidenceInventory: Object.freeze({
    reusedExistingAuthorities: Object.freeze([
      "ebay_luna_opportunity_queue.assessment",
      "marketplace_product_research_*",
      "get_seller_os_family_market_radar_v1",
      "get_seller_os_latest_profitability_frontiers_v1",
      "seller_os_luna_shipping_job_claims",
      "ebay_listing_packages",
      "ebay_draft_only_approvals",
      "ebay_draft_only_execution_ledger",
      "seller_os_publisher_batch_children_v1",
      "ebay_authorized_listing_publications",
      "ebay_active_listings",
    ]),
    queueEventCount: rows(queueEventsRead.data).length,
    imageAssetCount: rows(imageAssetsRead.data).length,
    researchObservationCount: researchObservations.length,
    readWarnings: quickPickProjectionWarning
      ? Object.freeze([quickPickProjectionWarning]) : Object.freeze([]),
    newRuntimeCreated: false,
    newLedgerCreated: false,
  }) })
}
