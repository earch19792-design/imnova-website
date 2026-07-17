import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  enqueueSellerWhatsAppAlert,
  resolveSellerWhatsAppAlert,
} from "./ebay-seller-whatsapp-alerts"
import type { SellerWhatsAppAlertType } from "./ebay-seller-whatsapp-alert-policy"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import {
  canonicalizeActiveListingProtectionRows,
  type CanonicalActiveListingProtectionGroup,
} from "./ebay-active-listing-protection-domain"

export const SELLER_SCAN_LANES = ["protection", "event", "hot", "baseline", "coverage"] as const
export type SellerScanLane = typeof SELLER_SCAN_LANES[number]

export type SellerScanTask = {
  id: string
  task_key: string
  candidate_key: string
  market_radar_product_id: string | null
  supplier_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  lane: SellerScanLane
  priority: number | string
  status: "queued" | "leased" | "retry" | "completed" | "dead_letter" | "cancelled"
  due_at: string
  attempts: number
  max_attempts: number
  lease_owner: string | null
  lease_expires_at: string | null
  source_snapshot_id: string | null
  source_observed_at: string | null
  metadata: Record<string, unknown> | null
}

type AutomationRunKind =
  | "luna_sync"
  | "ebay_scan"
  | "risk_monitor"
  | "alert_delivery"
  | "manual_acceleration"

type AutomationTrigger = "schedule" | "mobile" | "admin" | "event" | "recovery"

function safeCode(value: unknown, fallback = "AUTOMATION_FAILED") {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : ""
  return /^[A-Z0-9_]+$/.test(message) ? message.slice(0, 120) : fallback
}

export function buildSellerWorkerId(prefix = "ebay-scan") {
  return `${prefix}:${randomUUID()}`
}

export async function createSellerAutomationRun(
  supabase: SupabaseClient,
  input: {
    runKind: AutomationRunKind
    triggerSource?: AutomationTrigger
    workerId?: string | null
    lanes?: SellerScanLane[]
    scanRunId?: string | null
    metrics?: Record<string, unknown>
  },
) {
  const { data, error } = await supabase
    .from("ebay_seller_automation_runs")
    .insert({
      run_kind: input.runKind,
      trigger_source: input.triggerSource ?? "schedule",
      worker_id: input.workerId ?? null,
      lanes: input.lanes ?? [],
      scan_run_id: input.scanRunId ?? null,
      metrics: input.metrics ?? {},
    })
    .select("*")
    .single()
  if (error || !data) throw new Error("SELLER_AUTOMATION_RUN_CREATE_FAILED")
  return data
}

export async function finishSellerAutomationRun(
  supabase: SupabaseClient,
  runId: string,
  input: {
    status: "completed" | "partial" | "failed" | "cancelled"
    claimedTasks?: number
    successfulTasks?: number
    failedTasks?: number
    deadLetterTasks?: number
    metrics?: Record<string, unknown>
    error?: unknown
  },
) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from("ebay_seller_automation_runs")
    .update({
      status: input.status,
      claimed_tasks: input.claimedTasks ?? 0,
      successful_tasks: input.successfulTasks ?? 0,
      failed_tasks: input.failedTasks ?? 0,
      dead_letter_tasks: input.deadLetterTasks ?? 0,
      metrics: input.metrics ?? {},
      last_error_code: input.error ? safeCode(input.error) : null,
      heartbeat_at: now,
      completed_at: now,
    })
    .eq("id", runId)
  if (error) throw new Error("SELLER_AUTOMATION_RUN_FINISH_FAILED")
}

export async function reconcileSellerScanTasks(
  supabase: SupabaseClient,
  options: { forceDue?: boolean; limit?: number } = {},
) {
  const { data, error } = await supabase.rpc("reconcile_ebay_seller_scan_tasks", {
    p_force_due: options.forceDue === true,
    p_limit: Math.max(1, Math.min(options.limit ?? 2_000, 10_000)),
  })
  if (error) throw new Error("SELLER_SCAN_TASK_RECONCILE_FAILED")
  const row = Array.isArray(data) ? data[0] : data
  return {
    insertedOrUpdated: Number(row?.inserted_or_updated ?? 0),
    dueNow: Number(row?.due_now ?? 0),
  }
}

export async function claimSellerScanTasks(
  supabase: SupabaseClient,
  options: {
    workerId: string
    limit?: number
    leaseSeconds?: number
    lanes?: SellerScanLane[] | null
  },
) {
  const { data, error } = await supabase.rpc("claim_ebay_seller_scan_tasks", {
    p_worker_id: options.workerId,
    p_limit: Math.max(1, Math.min(options.limit ?? 2, 25)),
    p_lease_seconds: Math.max(30, Math.min(options.leaseSeconds ?? 180, 900)),
    p_lanes: options.lanes?.length ? options.lanes : null,
  })
  if (error) throw new Error("SELLER_SCAN_TASK_CLAIM_FAILED")
  return (data ?? []) as SellerScanTask[]
}

export async function completeSellerScanTask(
  supabase: SupabaseClient,
  taskId: string,
  workerId: string,
  result: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc("complete_ebay_seller_scan_task", {
    p_task_id: taskId,
    p_worker_id: workerId,
    p_result: result,
  })
  if (error) throw new Error("SELLER_SCAN_TASK_COMPLETE_FAILED")
  return data as SellerScanTask
}

export async function failSellerScanTask(
  supabase: SupabaseClient,
  task: SellerScanTask,
  workerId: string,
  errorValue: unknown,
) {
  const code = safeCode(errorValue, "EBAY_CANDIDATE_SCAN_FAILED")
  const { data, error } = await supabase.rpc("fail_ebay_seller_scan_task", {
    p_task_id: task.id,
    p_worker_id: workerId,
    p_error_code: code,
    p_error_detail: errorValue instanceof Error ? errorValue.message.slice(0, 500) : null,
  })
  if (error) throw new Error("SELLER_SCAN_TASK_FAIL_FAILED")
  return data as SellerScanTask
}

type ListingRow = {
  id: string
  account_key: string
  source: string
  ebay_item_id: string
  ebay_sku: string | null
  listing_status: string
  title: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  supplier_cost_at_linking: number | string | null
  last_ebay_sync_at: string | null
  raw_payload: Record<string, unknown> | null
}

type CanonicalListingGroup = CanonicalActiveListingProtectionGroup<ListingRow>

type LatestSupplyRow = {
  product_id: string
  supplier_variant_id: string | null
  sku: string | null
  price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  captured_at: string | null
  snapshot_id: string | null
}

function numeric(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function riskPriority(type: string) {
  if (type === "out_of_stock" || type === "mapping_broken") return "critical"
  if (type === "low_stock" || type === "margin_review" || type === "price_up") return "high"
  return "medium"
}

function riskCopy(type: string) {
  if (type === "out_of_stock") return {
    summary: "Luna Portex reportó el producto sin stock.",
    action: "Revisar y pausar el listing antes de aceptar otra venta.",
  }
  if (type === "low_stock") return {
    summary: "Luna Portex reportó tres unidades o menos.",
    action: "Reducir la cantidad eBay o confirmar reposición inmediatamente.",
  }
  if (type === "stock_unknown") return {
    summary: "La observación de stock Luna está vencida o no es verificable.",
    action: "Reconectar Luna y confirmar stock antes de mantener el listing activo.",
  }
  if (type === "price_up") return {
    summary: "El costo Luna aumentó frente al costo registrado al vincular el listing.",
    action: "Recalcular margen y ajustar el precio sólo después de revisión humana.",
  }
  return {
    summary: "No se pudo reconciliar el listing activo con una variante vigente de Luna.",
    action: "Corregir el vínculo SKU/variante y confirmar stock manualmente.",
  }
}

function whatsappRiskType(type: string): SellerWhatsAppAlertType | null {
  if (type === "out_of_stock" || type === "low_stock" ||
      type === "price_up" || type === "mapping_broken") return type
  return null
}

function supplierCostChangePercent(
  listing: ListingRow,
  currentSupplierPrice: unknown,
) {
  const linked = numeric(
    listing.supplier_cost_at_linking ??
    listing.raw_payload?.supplierCostAtLinking ??
    listing.raw_payload?.supplier_cost_at_linking,
  )
  const current = numeric(currentSupplierPrice)
  return linked !== null && linked > 0 && current !== null
    ? ((current - linked) / linked) * 100
    : null
}

function canonicalListingIdentityHash(canonicalKey: string) {
  return createHash("sha256").update(canonicalKey).digest("hex")
}

function canonicalRiskFingerprint(
  listingIdentityHash: string,
  riskType: string,
) {
  return `active-listing-v2:${listingIdentityHash}:${riskType}`
}

function canonicalWhatsAppEntityId(listingIdentityHash: string) {
  return `canonical:${listingIdentityHash}`
}

async function resolveProtectionWhatsAppAlert(
  supabase: SupabaseClient,
  entityId: string,
  type: string,
) {
  const alertType = whatsappRiskType(type)
  if (!alertType) return
  await resolveSellerWhatsAppAlert(supabase, {
    alertType,
    entityType: "ebay_active_listing",
    entityId,
  }).catch(() => undefined)
}

async function resolveProtectionRisks(
  supabase: SupabaseClient,
  input: {
    listingIds: string[]
    riskTypes: string[]
    keepRiskId?: string | null
  },
) {
  if (!input.listingIds.length || !input.riskTypes.length) return []
  const now = new Date().toISOString()
  let query = supabase
    .from("ebay_active_listing_risk_events")
    .update({ resolved_at: now, last_detected_at: now })
    .in("active_listing_id", input.listingIds)
    .in("risk_type", input.riskTypes)
    .is("resolved_at", null)
  if (input.keepRiskId) query = query.neq("id", input.keepRiskId)
  const { data, error } = await query.select("id")
  if (error) throw new Error("ACTIVE_LISTING_RISK_RESOLVE_FAILED")
  const resolvedRiskIds = (data ?? [])
    .map((row) => typeof row.id === "string" ? row.id : null)
    .filter((id): id is string => Boolean(id))
  if (!resolvedRiskIds.length) return resolvedRiskIds

  // An unresolved duplicate must not remain visible in the in-app queue after
  // its canonical risk has been selected. Delivered rows remain immutable
  // audit evidence.
  const { error: alertError } = await supabase
    .from("ebay_seller_alert_outbox")
    .update({
      status: "cancelled",
      last_error_code: "CANONICAL_LISTING_DEDUPED",
      updated_at: now,
    })
    .eq("channel", "in_app")
    .eq("entity_type", "ebay_active_listing_risk")
    .in("entity_id", resolvedRiskIds)
    .in("status", ["pending", "failed"])
  if (alertError) throw new Error("SELLER_ALERT_OUTBOX_RESOLVE_FAILED")
  return resolvedRiskIds
}

async function resolveProtectionAlertIdentities(
  supabase: SupabaseClient,
  group: CanonicalListingGroup,
  listingIdentityHash: string,
  riskTypes: string[],
) {
  const entityIds = [
    canonicalWhatsAppEntityId(listingIdentityHash),
    ...group.memberListingIds,
  ]
  await Promise.all(entityIds.flatMap((entityId) =>
    riskTypes.map((riskType) =>
      resolveProtectionWhatsAppAlert(supabase, entityId, riskType)
    )
  ))
}

async function upsertProtectionAlert(
  supabase: SupabaseClient,
  input: {
    listing: ListingRow
    accountKey: string
    type: string
    evidence: Record<string, unknown>
    riskFingerprint: string
    whatsappEntityId: string
  },
) {
  const copy = riskCopy(input.type)
  const { data: riskData, error: riskError } = await supabase.rpc("upsert_ebay_active_listing_risk", {
    p_active_listing_id: input.listing.id,
    p_risk_type: input.type,
    p_risk_priority: riskPriority(input.type),
    p_risk_summary: copy.summary,
    p_recommended_action: copy.action,
    p_risk_fingerprint: input.riskFingerprint,
    p_evidence: input.evidence,
  })
  const risk = (Array.isArray(riskData) ? riskData[0] : riskData) as {
    risk_id?: string
    was_resolved?: boolean
    occurrence_count?: number
  } | null
  if (riskError || !risk?.risk_id) throw new Error("ACTIVE_LISTING_RISK_UPSERT_FAILED")
  const wasResolved = risk.was_resolved === true
  const whatsappType = whatsappRiskType(input.type)
  if (whatsappType) {
    await enqueueSellerWhatsAppAlert(supabase, {
      alertType: whatsappType,
      entityType: "ebay_active_listing",
      entityId: input.whatsappEntityId,
      candidateKey: input.listing.supplier_sku,
      title: input.listing.title || "Listing activo eBay",
      summary: copy.summary,
      mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
      facts: {
        hasActiveListing: true,
        supplierAvailable: input.evidence.available === true
          ? true
          : input.evidence.available === false
            ? false
            : null,
        currentStock: numeric(input.evidence.inventoryQuantity),
        costChangePct: supplierCostChangePercent(
          input.listing,
          input.evidence.supplierPrice,
        ),
      },
    }).catch(() => undefined)
  }

  const alertFingerprint = `risk:${input.riskFingerprint}`
  const { data: existingAlert, error: existingAlertError } = await supabase
    .from("ebay_seller_alert_outbox")
    .select("id,status")
    .eq("alert_fingerprint", alertFingerprint)
    .maybeSingle()
  if (existingAlertError) throw new Error("SELLER_ALERT_OUTBOX_READ_FAILED")
  if (existingAlert && !wasResolved) return risk.risk_id
  const { error: alertError } = await supabase
    .from("ebay_seller_alert_outbox")
    .upsert({
      alert_fingerprint: alertFingerprint,
      alert_type: input.type,
      priority: riskPriority(input.type),
      entity_type: "ebay_active_listing_risk",
      entity_id: risk.risk_id,
      channel: "in_app",
      status: "pending",
      attempts: 0,
      delivered_at: null,
      last_error_code: null,
      payload: {
        accountKey: input.accountKey,
        riskId: risk.risk_id,
        listingId: input.listing.id,
        ebayItemId: input.listing.ebay_item_id,
        title: input.listing.title,
        summary: copy.summary,
        recommendedAction: copy.action,
        evidence: input.evidence,
      },
      due_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "alert_fingerprint" })
  if (alertError) throw new Error("SELLER_ALERT_OUTBOX_UPSERT_FAILED")
  return risk.risk_id
}

export async function reconcileActiveListingProtectionRisks(
  supabase: SupabaseClient,
  options: { limit?: number; timeBudgetMs?: number } = {},
) {
  const startedAt = Date.now()
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500))
  const timeBudgetMs = Math.max(1_000, Math.min(options.timeBudgetMs ?? 8_000, 30_000))
  const accountScope = getEbaySellerAccountScopeConfiguration()
  if (!accountScope.accountKey) {
    return {
      status: "ACCOUNT_SCOPE_NOT_CONFIGURED" as const,
      accountScopeReason: accountScope.reason,
      activeListingsSelected: 0,
      activeListingRowsSelected: 0,
      duplicateListingRowsCollapsed: 0,
      listingsEvaluated: 0,
      listingsDeferred: 0,
      listingsHealthy: 0,
      risksDetected: 0,
      elapsedMs: Date.now() - startedAt,
    }
  }
  const { data: listingData, error: listingError } = await supabase
    .from("ebay_active_listings")
    .select("id,account_key,source,ebay_item_id,ebay_sku,listing_status,title,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_cost_at_linking,last_ebay_sync_at,raw_payload")
    .eq("account_key", accountScope.accountKey)
    .eq("listing_status", "active")
    .order("last_radar_review_at", { ascending: true, nullsFirst: true })
    .order("ebay_item_id", { ascending: true })
    .order("ebay_sku", { ascending: true, nullsFirst: true })
    .order("source", { ascending: true })
    .order("id", { ascending: true })
    // Read a bounded duplicate-aware window. The evaluation limit below is
    // applied after canonicalization, not to connector rows.
    .limit(Math.min(1_000, limit * 3))
  if (listingError) throw new Error("ACTIVE_LISTING_PROTECTION_READ_FAILED")
  const listingRows = (listingData ?? []) as ListingRow[]
  const listings = canonicalizeActiveListingProtectionRows(listingRows)
    .slice(0, limit)
  const activeListingRowsSelected = listings.reduce(
    (count, group) => count + group.memberListingIds.length,
    0,
  )
  let risksDetected = 0
  let listingsHealthy = 0
  let listingsEvaluated = 0

  for (const group of listings) {
    if (listingsEvaluated > 0 && Date.now() - startedAt >= timeBudgetMs) break
    listingsEvaluated += 1
    const listing = group.listing
    const listingIdentityHash = canonicalListingIdentityHash(group.canonicalKey)
    const listingIdentityEvidence = {
      version: "EBAY_ACTIVE_LISTING_CANONICAL_IDENTITY_V2",
      accountKey: group.accountKey,
      ebayItemId: group.ebayItemId,
      ebaySku: group.ebaySku,
      canonicalListingId: listing.id,
      canonicalSource: listing.source,
      canonicalListingStatus: listing.listing_status,
      observations: group.observations,
    }
    let latest: LatestSupplyRow | null = null
    if (listing.market_radar_product_id) {
      let query = supabase
        .from("market_radar_latest_variants")
        .select("product_id,supplier_variant_id,sku,price,available,inventory_quantity,captured_at,snapshot_id")
        .eq("product_id", listing.market_radar_product_id)
      if (listing.supplier_variant_id) query = query.eq("supplier_variant_id", listing.supplier_variant_id)
      else if (listing.supplier_sku) query = query.eq("sku", listing.supplier_sku)
      const { data } = await query.limit(1).maybeSingle()
      latest = data as LatestSupplyRow | null
    }

    const detected: string[] = []
    if (!latest) detected.push("mapping_broken")
    else {
      const ageMs = latest.captured_at ? Date.now() - Date.parse(latest.captured_at) : Number.POSITIVE_INFINITY
      if (latest.available === false || latest.inventory_quantity === 0) detected.push("out_of_stock")
      else if (ageMs > 36 * 60 * 60 * 1000) detected.push("stock_unknown")
      else if (latest.inventory_quantity !== null && latest.inventory_quantity <= 3) detected.push("low_stock")

      const linkedCost = numeric(
        listing.supplier_cost_at_linking ??
        listing.raw_payload?.supplierCostAtLinking ??
        listing.raw_payload?.supplier_cost_at_linking,
      )
      const currentCost = numeric(latest.price)
      if (linkedCost !== null && currentCost !== null && currentCost > linkedCost * 1.05) detected.push("price_up")
    }

    if (!detected.length) {
      listingsHealthy += 1
      const allRiskTypes = [
        "out_of_stock",
        "stock_unknown",
        "low_stock",
        "price_up",
        "mapping_broken",
      ]
      await resolveProtectionRisks(supabase, {
        listingIds: group.memberListingIds,
        riskTypes: allRiskTypes,
      })
      await supabase
        .from("ebay_active_listings")
        .update({ last_radar_review_at: new Date().toISOString() })
        .in("id", group.memberListingIds)
      await resolveProtectionAlertIdentities(
        supabase,
        group,
        listingIdentityHash,
        allRiskTypes,
      )
      continue
    }

    for (const type of detected) {
      const riskId = await upsertProtectionAlert(supabase, {
        listing,
        accountKey: accountScope.accountKey,
        type,
        riskFingerprint: canonicalRiskFingerprint(listingIdentityHash, type),
        whatsappEntityId: canonicalWhatsAppEntityId(listingIdentityHash),
        evidence: {
          listingIdentity: listingIdentityEvidence,
          supplierVariantId: latest?.supplier_variant_id ?? listing.supplier_variant_id,
          supplierSku: latest?.sku ?? listing.supplier_sku,
          available: latest?.available ?? null,
          inventoryQuantity: latest?.inventory_quantity ?? null,
          supplierPrice: latest?.price ?? null,
          capturedAt: latest?.captured_at ?? null,
          snapshotId: latest?.snapshot_id ?? null,
        },
      })
      await resolveProtectionRisks(supabase, {
        listingIds: group.memberListingIds,
        riskTypes: [type],
        keepRiskId: riskId,
      })
      // Resolve pre-V2 per-row WhatsApp identities while keeping the canonical
      // account + item + SKU identity active.
      await Promise.all(group.memberListingIds.map((listingId) =>
        resolveProtectionWhatsAppAlert(supabase, listingId, type)
      ))
      risksDetected += 1
    }

    const resolvedTypes = ["out_of_stock", "stock_unknown", "low_stock", "price_up", "mapping_broken"]
      .filter((type) => !detected.includes(type))
    if (resolvedTypes.length) {
      await resolveProtectionRisks(supabase, {
        listingIds: group.memberListingIds,
        riskTypes: resolvedTypes,
      })
      await resolveProtectionAlertIdentities(
        supabase,
        group,
        listingIdentityHash,
        resolvedTypes,
      )
    }
    await supabase
      .from("ebay_active_listings")
      .update({ last_radar_review_at: new Date().toISOString() })
      .in("id", group.memberListingIds)
  }

  return {
    activeListingsSelected: listings.length,
    activeListingRowsSelected,
    duplicateListingRowsCollapsed:
      Math.max(0, activeListingRowsSelected - listings.length),
    listingsEvaluated,
    listingsDeferred: Math.max(0, listings.length - listingsEvaluated),
    listingsHealthy,
    risksDetected,
    elapsedMs: Date.now() - startedAt,
  }
}

export async function getSellerAutomationHealth(supabase: SupabaseClient) {
  const now = new Date().toISOString()
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey ?? "__unconfigured__"
  const [due, leased, retries, dead, pendingAlerts, latestRuns] = await Promise.all([
    supabase.from("ebay_seller_scan_tasks").select("id", { count: "exact", head: true }).in("status", ["queued", "retry"]).lte("due_at", now),
    supabase.from("ebay_seller_scan_tasks").select("id", { count: "exact", head: true }).eq("status", "leased"),
    supabase.from("ebay_seller_scan_tasks").select("id", { count: "exact", head: true }).eq("status", "retry"),
    supabase.from("ebay_seller_scan_tasks").select("id", { count: "exact", head: true }).eq("status", "dead_letter"),
    supabase.from("ebay_seller_alert_outbox").select("id", { count: "exact", head: true }).eq("payload->>accountKey", accountKey).in("status", ["pending", "failed"]),
    supabase.from("ebay_seller_automation_runs").select("id,run_kind,status,started_at,completed_at,last_error_code,metrics").order("started_at", { ascending: false }).limit(8),
  ])
  const firstError = due.error ?? leased.error ?? retries.error ?? dead.error ?? pendingAlerts.error ?? latestRuns.error
  if (firstError) throw new Error("SELLER_AUTOMATION_HEALTH_READ_FAILED")
  return {
    dueTasks: due.count ?? 0,
    leasedTasks: leased.count ?? 0,
    retryTasks: retries.count ?? 0,
    deadLetterTasks: dead.count ?? 0,
    pendingAlerts: pendingAlerts.count ?? 0,
    latestRuns: latestRuns.data ?? [],
  }
}
