"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import type { ListingCaseProjectionV1 } from
  "@/lib/ebay/seller-os-listing-registry-v1"

type Case = ListingCaseProjectionV1 & { case_id: string;
  last_reconciled_sweep_id: string | null }
type ReviewCase = { itemId: string; customLabel: string | null;
  currentTitle: string | null; origin: string; identitySource: string;
  identityStatus: string; stockguardStatus: string; classification: string;
  bucket: "READY_TO_CONFIRM_EXACT" | "CONFLICT_REVIEW" | "NO_EXACT_SOURCE";
  confidenceBasis: string; lastOwnerAction: string | null;
  lastOwnerActionAt: string | null;
  reasonCode: string; recommendedOwnerAction: string;
  conflictingItemIds: string[]; candidates: Array<{ productId: string;
    variantId: string; sku: string; opportunityId: string | null;
    source: string; preflightStatus: string | null; title?: string | null;
    imageUrl?: string | null }> }
type RegistryResponse = { success: boolean; error?: string; cases?: Case[];
  failedOperation?: string | null; errorDetail?: string | null;
  currentLiveCertified?: boolean; lastCertifiedLiveCount?: number | null;
  lastCertifiedAt?: string | null; durableReadback?: string;
  currentSweepId?: string | null; currentLiveCaseCount?: number | null;
  operationalBuckets?: Array<{ itemId: string; bucket: string }>;
  bucketCounts?: Record<string, number>; batchId?: string;
  confirmedCount?: number; requestedCount?: number; selectedCount?: number;
  alreadyLinkedCount?: number; blockedCount?: number;
  auditStatus?: "COMPLETE" | "RECONCILIATION_REQUIRED";
  auditWarnings?: Array<{ itemId?: string; blocker: string }>;
  blockedRows?: Array<{ itemId: string; blocker: string }>;
  canonicalStockReadReady?: boolean;
  canonicalStockListings?: CanonicalStockResponse["listings"] }
  & { reviewQueue?: ReviewCase[]; reviewSweepId?: string | null }
type CanonicalStockResponse = { success: boolean; cohortComplete?: boolean;
  sourceStatus?: { listingRegistry?: string };
  listings?: Array<{ itemId: string; supplierLinkage: string;
    stockFreshness: string; sku?: string | null; title?: string | null;
    components?: Array<{ supplierProductId: string | null;
      supplierVariantId: string | null; supplierSku: string | null }> }> }
type ManualCandidate = { productId: string; variantId: string; sku: string;
  title: string; variantTitle: string | null; imageUrl: string | null;
  stockAvailability: string; stockQuantity: number | null;
  stockObservedAt: string | null; existingOpportunityId?: string | null;
  conflictingRelationship?: { itemId: string; title: string | null;
    imageUrl: string | null; customLabel: string | null; status: string;
    supplierSku: string; productId: string; variantId: string;
    decisionId: string; reasonCode: string;
    supersessionEligible: boolean } | null }
type ManualIdentitySearch = { success?: boolean; error?: string;
  item?: { itemId: string; title: string | null; imageUrl: string | null;
    customLabel: string | null; status: string };
  candidates?: ManualCandidate[] }

function applyCanonicalStockRead(registry: RegistryResponse,
  stock: CanonicalStockResponse | null): RegistryResponse {
  if (!registry.currentLiveCertified || !stock?.success ||
      stock.cohortComplete !== true ||
      stock.sourceStatus?.listingRegistry !== "CURRENT_FRESH") {
    return { ...registry, canonicalStockReadReady: false } as RegistryResponse
  }
  const canonicalIds = new Set((stock.listings ?? []).map((row) => row.itemId))
  const certified = new Set((stock.listings ?? []).filter((row) =>
    row.supplierLinkage === "CERTIFIED").map((row) => row.itemId))
  const buckets = (registry.operationalBuckets ?? []).filter((row) =>
    canonicalIds.has(row.itemId)).map((row) => ({
    ...row, bucket: certified.has(row.itemId) ? "LINKED_EXACT" : row.bucket,
  }))
  const bucketIds = new Set(buckets.map((row) => row.itemId))
  for (const row of stock.listings ?? []) {
    if (row.supplierLinkage === "CERTIFIED" && !bucketIds.has(row.itemId)) {
      buckets.push({ itemId: row.itemId, bucket: "LINKED_EXACT" })
      bucketIds.add(row.itemId)
    }
  }
  const counts = {
    LINKED_EXACT: buckets.filter((row) => row.bucket === "LINKED_EXACT").length,
    READY_TO_CONFIRM_EXACT: buckets.filter((row) =>
      row.bucket === "READY_TO_CONFIRM_EXACT").length,
    CONFLICT_REVIEW: buckets.filter((row) =>
      row.bucket === "CONFLICT_REVIEW").length,
    NO_EXACT_SOURCE: buckets.filter((row) =>
      row.bucket === "NO_EXACT_SOURCE").length,
  }
  return { ...registry, operationalBuckets: buckets, bucketCounts: counts,
    canonicalStockReadReady: buckets.length === canonicalIds.size &&
      [...canonicalIds].every((itemId) => bucketIds.has(itemId)),
    canonicalStockListings: stock.listings } as RegistryResponse
}

function show(value: string | null | undefined) { return value || "Por verificar" }
function officialEbayImage(value: string | null | undefined) {
  return value && /^https:\/\/i\.ebayimg\.com\/images\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|webp)$/.test(value)
    ? value : null
}
function provenLunaImage(value: string | null | undefined) {
  return value && /^https:\/\/cdn\.shopify\.com\/s\/files\/1\/0798\/2520\/7520\//.test(value)
    ? value : null
}
type ReviewAction = "confirm_exact_link" | "reject_candidate" |
  "keep_manual_no_luna" | "review_conflict"

export default function ListingsPage() {
  const [data, setData] = useState<RegistryResponse | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [itemId, setItemId] = useState("")
  const [linkItemId, setLinkItemId] = useState("")
  const [opportunityId, setOpportunityId] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [reviewSelection, setReviewSelection] = useState<{
    itemId: string; action: ReviewAction; candidate: ReviewCase["candidates"][number] | null
  } | null>(null)
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [notice, setNotice] = useState("")
  const [filter, setFilter] = useState("ALL")
  const [bucket, setBucket] = useState("READY_TO_CONFIRM_EXACT")
  const [selectedExact, setSelectedExact] = useState<string[]>([])
  const [batchBlockedRows, setBatchBlockedRows] = useState<Array<{
    itemId: string; blocker: string }>>([])
  const [manualTarget, setManualTarget] = useState<string | null>(null)
  const [manualSearch, setManualSearch] = useState("")
  const [manualResults, setManualResults] = useState<ManualIdentitySearch | null>(null)
  const [manualCandidate, setManualCandidate] = useState<ManualCandidate | null>(null)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualDecisionFeedback, setManualDecisionFeedback] = useState<{
    status: "PENDING" | "SUCCESS" | "ERROR"; message: string;
    requestTraceId?: string; itemId?: string; httpStatus?: number;
    failedStage?: string; canonicalReadback?: string; receiptId?: string;
    sku?: string; productId?: string; variantId?: string;
    stockguardStatus?: string } | null>(null)
  const batchConfirm = useCallback(async () => {
    if (!selectedExact.length) return
    setBusy(true); setError(""); setNotice(""); setBatchBlockedRows([])
    try {
      const { data: session, error: authError } = await supabase.auth.getSession()
      if (authError || !session.session) throw new Error("AUTH_REQUIRED")
      const headers = { Authorization: `Bearer ${session.session.access_token}`,
        "Content-Type": "application/json" }
      const response = await fetch("/api/admin/ebay/listings/registry", {
        method: "POST", cache: "no-store", headers,
        body: JSON.stringify({ action: "batch_confirm_exact_links",
          ebayItemIds: selectedExact,
          confirmation: "CONFIRM_SELECTED_EXACT_LINKS" }),
      })
      const result = await response.json() as RegistryResponse
      if (!response.ok || !result.success) {
        throw new Error(`${result.error ?? "BATCH_CONFIRMATION_FAILED"} · ${result.confirmedCount ?? 0}/${result.requestedCount ?? selectedExact.length} confirmed${result.batchId ? ` · batch ${result.batchId}` : ""}`)
      }
      const refreshed = await fetch("/api/admin/ebay/listings/registry", {
        cache: "no-store", headers })
      const readback = await refreshed.json() as RegistryResponse
      if (!refreshed.ok || !readback.success) throw new Error("LISTING_REGISTRY_DURABLE_READBACK_FAILED")
      const canonicalResponse = await fetch("/api/admin/ebay/stockguard-freshness", {
        cache: "no-store", headers })
      const canonicalStock = canonicalResponse.ok
        ? await canonicalResponse.json() as CanonicalStockResponse : null
      const synchronized = applyCanonicalStockRead(readback, canonicalStock)
      setData(synchronized)
      setSelectedExact([])
      setBatchBlockedRows(result.blockedRows ?? [])
      setNotice(`Batch ${result.batchId}: ${result.confirmedCount ?? 0} confirmed, ${result.alreadyLinkedCount ?? 0} already linked, ${result.blockedCount ?? 0} blocked of ${result.selectedCount ?? selectedExact.length} selected.${result.auditStatus === "RECONCILIATION_REQUIRED" ? " Batch audit needs reconciliation; durable links are preserved." : ""}`)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message :
        "BATCH_CONFIRMATION_FAILED"
      try {
        const { data: session } = await supabase.auth.getSession()
        if (!session.session) throw new Error("AUTH_REQUIRED")
        const headers = { Authorization: `Bearer ${session.session.access_token}` }
        const [registryResponse, stockResponse] = await Promise.all([
          fetch("/api/admin/ebay/listings/registry", { cache: "no-store", headers }),
          fetch("/api/admin/ebay/stockguard-freshness", { cache: "no-store", headers }),
        ])
        if (!registryResponse.ok || !stockResponse.ok) throw new Error("READBACK_FAILED")
        const registry = await registryResponse.json() as RegistryResponse
        const stock = await stockResponse.json() as CanonicalStockResponse
        const synchronized = applyCanonicalStockRead(registry, stock)
        if (!synchronized.canonicalStockReadReady) throw new Error("READBACK_UNPROVEN")
        const linked = new Set((stock.listings ?? []).filter((row) =>
          row.supplierLinkage === "CERTIFIED").map((row) => row.itemId))
        const committed = selectedExact.filter((itemId) => linked.has(itemId))
        const remaining = selectedExact.filter((itemId) => !linked.has(itemId) &&
          synchronized.operationalBuckets?.some((row) =>
            row.itemId === itemId && row.bucket === "READY_TO_CONFIRM_EXACT"))
        setData(synchronized)
        setSelectedExact(remaining)
        setNotice(`Canonical readback: ${committed.length} linked, ${remaining.length} still ready of ${selectedExact.length} selected.`)
        setError(`${message} · Canonical readback preserved committed links.`)
      } catch { setError(message) }
    } finally { setBusy(false) }
  }, [selectedExact])
  const request = useCallback(async (action?: string, ebayItemId?: string,
    selectedOpportunityId?: string, candidate?: ReviewCase["candidates"][number] | null) => {
    setBusy(true); setError(""); setNotice("")
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session.session) throw new Error("AUTH_REQUIRED")
      const response = await fetch("/api/admin/ebay/listings/registry", {
        method: action ? "POST" : "GET", cache: "no-store",
        headers: { Authorization: `Bearer ${session.session.access_token}`,
          ...(action ? { "Content-Type": "application/json" } : {}) },
        body: action ? JSON.stringify({ action, ebayItemId,
          opportunityId: selectedOpportunityId,
          candidateSku: candidate?.sku,
          candidateProductId: candidate?.productId,
          candidateVariantId: candidate?.variantId,
          confirmation: action === "link_existing" ? "VINCULAR_IDENTIDAD_CANONICA" :
            ["confirm_exact_link", "reject_candidate"].includes(action)
              ? "CONFIRM_EXACT_LISTING_LUNA" :
              ["keep_manual_no_luna", "review_conflict"].includes(action)
                ? "CONFIRM_OWNER_REVIEW_ACTION" : undefined }) : undefined,
      })
      const result = await response.json() as RegistryResponse
      if (!response.ok || !result.success) {
        const detail = [result.failedOperation, result.errorDetail]
          .filter(Boolean).join(" · ")
        throw new Error([result.error ?? "LISTING_REGISTRY_READ_FAILED", detail]
          .filter(Boolean).join(" · "))
      }
      const canonicalResponse = await fetch(
        "/api/admin/ebay/stockguard-freshness", { cache: "no-store",
          headers: { Authorization: `Bearer ${session.session.access_token}` } })
      const canonicalStock = canonicalResponse.ok
        ? await canonicalResponse.json() as CanonicalStockResponse : null
      if (action) {
        const refreshed = await fetch("/api/admin/ebay/listings/registry", {
          cache: "no-store", headers: {
            Authorization: `Bearer ${session.session.access_token}` },
        })
        const readback = await refreshed.json() as RegistryResponse
        if (!refreshed.ok || !readback.success) throw new Error("LISTING_REGISTRY_DURABLE_READBACK_FAILED")
        const synchronized = applyCanonicalStockRead(readback, canonicalStock)
        setData(synchronized)
        setSelectedExact((synchronized.reviewQueue ?? [])
          .filter((row) => row.bucket === "READY_TO_CONFIRM_EXACT" &&
            !synchronized.operationalBuckets?.some((entry) =>
              entry.itemId === row.itemId && entry.bucket === "LINKED_EXACT"))
          .map((row) => row.itemId))
      } else {
        const synchronized = applyCanonicalStockRead(result, canonicalStock)
        setData(synchronized)
        setSelectedExact((synchronized.reviewQueue ?? [])
          .filter((row) => row.bucket === "READY_TO_CONFIRM_EXACT" &&
            !synchronized.operationalBuckets?.some((entry) =>
              entry.itemId === row.itemId && entry.bucket === "LINKED_EXACT"))
          .map((row) => row.itemId))
      }
      if (action === "import_existing" && ebayItemId) setLinkItemId(ebayItemId)
      if (["confirm_exact_link", "reject_candidate", "keep_manual_no_luna",
        "review_conflict"].includes(action ?? "")) {
        setReviewSelection(null); setReviewConfirmed(false)
        setNotice(`Acción OWNER guardada y leída: ${action} · Item ${ebayItemId}`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LISTING_REGISTRY_READ_FAILED")
    } finally { setBusy(false) }
  }, [])
  useEffect(() => { void request() }, [request])
  const currentCases = useMemo(() => (data?.cases ?? []).filter((row) =>
    data?.currentLiveCertified && row.last_reconciled_sweep_id === data.currentSweepId), [data])
  const rows = useMemo(() => (data?.cases ?? []).filter((row) =>
    filter === "ALL" || row.identity_status === filter ||
    row.stockguard_link_status === filter), [data, filter])
  const counts = useMemo(() => {
    const cases = currentCases
    return { linked: cases.filter((row) => row.identity_status === "LINKED_EXACT").length,
      ambiguous: cases.filter((row) => ["AMBIGUOUS", "DUPLICATE_IDENTITY",
        "NEEDS_OWNER_REVIEW"].includes(row.identity_status)).length,
      missing: cases.filter((row) => row.identity_status === "MISSING_LUNA_IDENTITY").length,
      stockguard: cases.filter((row) => row.stockguard_link_status.startsWith("LINKED_")).length }
  }, [currentCases])
  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, ReviewCase[]>()
    for (const row of data?.reviewQueue ?? []) {
      if (row.classification !== "DUPLICATE" || !row.customLabel) continue
      groups.set(row.customLabel, [...(groups.get(row.customLabel) ?? []), row])
    }
    return [...groups.entries()].filter(([, rows]) => rows.length > 1)
  }, [data])
  const ready = (data?.reviewQueue ?? []).filter((row) =>
    data?.currentLiveCertified && data.canonicalStockReadReady &&
      row.bucket === "READY_TO_CONFIRM_EXACT" &&
      !data.operationalBuckets?.some((entry) => entry.itemId === row.itemId &&
        entry.bucket === "LINKED_EXACT"))
  const searchManualIdentity = useCallback(async () => {
    if (!manualTarget || !manualSearch.trim()) return
    setManualBusy(true); setError("")
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session.session) throw new Error("AUTH_REQUIRED")
      const url = new URLSearchParams({ itemId: manualTarget, q: manualSearch.trim() })
      const response = await fetch(`/api/admin/ebay/listings/identity-resolution?${url}`, {
        cache: "no-store", headers: { Authorization: `Bearer ${session.session.access_token}` },
      })
      const result = await response.json() as ManualIdentitySearch
      if (!response.ok || !result.success) throw new Error(result.error ?? "MANUAL_IDENTITY_SEARCH_FAILED")
      setManualResults(result); setManualCandidate(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "MANUAL_IDENTITY_SEARCH_FAILED") }
    finally { setManualBusy(false) }
  }, [manualSearch, manualTarget])
  const loadManualIdentityTarget = useCallback(async (targetItemId: string) => {
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session.session) throw new Error("AUTH_REQUIRED")
      const params = new URLSearchParams({ itemId: targetItemId })
      const response = await fetch(`/api/admin/ebay/listings/identity-resolution?${params}`, {
        cache: "no-store", headers: { Authorization: `Bearer ${session.session.access_token}` },
      })
      const result = await response.json() as ManualIdentitySearch
      if (!response.ok || !result.success) throw new Error(result.error ?? "MANUAL_IDENTITY_TARGET_READ_FAILED")
      setManualResults(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "MANUAL_IDENTITY_TARGET_READ_FAILED") }
  }, [])
  const decideManualIdentity = useCallback(async (action: "CONFIRM_EXACT_LUNA_LINK" |
    "CONFIRM_SUPERSESSION" |
    "KEEP_UNLINKED_NO_SOURCE_YET" | "REJECT_CANDIDATE" | "REVIEW_CONFLICT") => {
    if (!manualTarget || (["CONFIRM_EXACT_LUNA_LINK", "CONFIRM_SUPERSESSION",
      "REJECT_CANDIDATE"].includes(action) && !manualCandidate)) {
      setManualDecisionFeedback({ status: "ERROR",
        message: "MANUAL_IDENTITY_EXACT_CANDIDATE_REQUIRED" })
      return
    }
    if (["CONFIRM_EXACT_LUNA_LINK", "CONFIRM_SUPERSESSION"].includes(action) &&
        manualCandidate && !window.confirm(action === "CONFIRM_SUPERSESSION"
          ? `CONFIRM SUPERSESSION: quarantine ${manualCandidate.conflictingRelationship?.itemId ?? "unknown"} and link current eBay Item ${manualTarget} to ${manualCandidate.sku} / ${manualCandidate.productId} / ${manualCandidate.variantId}?`
          : `CONFIRM EXACT LUNA LINK for eBay Item ${manualTarget} to ${manualCandidate.sku} / ${manualCandidate.productId} / ${manualCandidate.variantId}?`)) return
    const requestTraceId = crypto.randomUUID()
    let httpStatus = 0
    let failedStage = "FRONTEND_REQUEST"
    setManualBusy(true); setError(""); setNotice("")
    setManualDecisionFeedback({ status: "PENDING", message: "Submitting OWNER decision",
      requestTraceId, itemId: manualTarget })
    try {
      failedStage = "OWNER_AUTHORIZATION"
      const { data: session, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session.session) throw new Error("AUTH_REQUIRED")
      if (["CONFIRM_EXACT_LUNA_LINK", "CONFIRM_SUPERSESSION"].includes(action)) {
        const headers = { Authorization: `Bearer ${session.session.access_token}`,
          "X-Request-Trace-Id": requestTraceId }
        failedStage = "CURRENT_LIVE_PREFLIGHT"
        const currentResponse = await fetch("/api/admin/ebay/listings/registry", {
          cache: "no-store", headers })
        httpStatus = currentResponse.status
        const current = await currentResponse.json() as RegistryResponse
        if (!currentResponse.ok || !current.success) throw new Error(
          current.error ?? "MANUAL_IDENTITY_CURRENT_LIVE_READ_FAILED")
        const sweepAge = Date.now() - Date.parse(current.lastCertifiedAt ?? "")
        if (!current.currentLiveCertified || !Number.isFinite(sweepAge) ||
            sweepAge > 10 * 60_000) {
          failedStage = "OFFICIAL_SWEEP_PREFLIGHT"
          const sweepResponse = await fetch("/api/admin/ebay/listings/registry", {
            method: "POST", cache: "no-store", headers: {
              ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reconcile_current_live" }),
          })
          httpStatus = sweepResponse.status
          const sweep = await sweepResponse.json() as RegistryResponse
          if (!sweepResponse.ok || !sweep.success ||
              !sweep.currentLiveCertified) throw new Error(
            sweep.error ?? "MANUAL_IDENTITY_OFFICIAL_SWEEP_REQUIRED")
          if (!sweep.cases?.some((row) => row.ebay_item_id === manualTarget &&
              row.listing_status === "ACTIVE")) {
            throw new Error("MANUAL_IDENTITY_CURRENT_LIVE_TARGET_REQUIRED")
          }
        }
      }
      failedStage = "API_ROUTE"
      const response = await fetch("/api/admin/ebay/listings/identity-resolution", {
        method: "POST", cache: "no-store", headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
          "X-Request-Trace-Id": requestTraceId,
        }, body: JSON.stringify({ action, itemId: manualTarget,
          requestTraceId,
          ...(manualCandidate ? { productId: manualCandidate.productId,
            variantId: manualCandidate.variantId, sku: manualCandidate.sku,
            confirmation: action === "CONFIRM_SUPERSESSION"
              ? "CONFIRM SUPERSESSION" : "CONFIRM EXACT LUNA LINK",
            ...(action === "CONFIRM_SUPERSESSION" ? {
              supersedeItemId: manualCandidate.conflictingRelationship?.itemId } : {})
          } : {}) }),
      })
      const result = await response.json() as { success?: boolean; error?: string;
        requestTraceId?: string; httpStatus?: number; failedStage?: string;
        linkReceiptId?: string; receiptId?: string; itemId?: string;
        supplierIdentity?: { sku: string;
          productId: string; variantId: string };
        supplierLinkage?: string; stockguardMonitoring?: string;
        canonicalReadback?: string; eventId?: string }
      httpStatus = response.status
      if (!response.ok || !result.success) {
        failedStage = result.failedStage ?? "API_ROUTE"
        throw new Error(result.error ?? "MANUAL_IDENTITY_DECISION_FAILED")
      }
      if (["CONFIRM_EXACT_LUNA_LINK", "CONFIRM_SUPERSESSION"].includes(action)) {
        const confirmedIdentity = result.supplierIdentity
        if (result.requestTraceId !== requestTraceId ||
            result.itemId !== manualTarget || !result.linkReceiptId ||
            result.canonicalReadback !== "PASS" ||
            result.supplierLinkage !== "CERTIFIED" ||
            result.stockguardMonitoring !== "ACTIVE" ||
            !confirmedIdentity ||
            confirmedIdentity.sku !== manualCandidate?.sku ||
            confirmedIdentity.productId !== manualCandidate?.productId ||
            confirmedIdentity.variantId !== manualCandidate?.variantId) {
          throw new Error("MANUAL_IDENTITY_SUCCESS_READBACK_INCOMPLETE")
        }
        setManualDecisionFeedback({ status: "SUCCESS", message: "LINKED_EXACT",
          requestTraceId, itemId: manualTarget, httpStatus,
          canonicalReadback: result.canonicalReadback,
          receiptId: result.linkReceiptId, sku: confirmedIdentity.sku,
          productId: confirmedIdentity.productId,
          variantId: confirmedIdentity.variantId,
          stockguardStatus: result.stockguardMonitoring })
      } else {
        setManualDecisionFeedback({ status: "SUCCESS",
          requestTraceId, itemId: manualTarget, httpStatus,
          message: `${action} saved · receipt ${result.eventId ?? "READBACK_PASS"}` })
      }
      void request()
    } catch (cause) {
      const message = cause instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/.test(cause.message)
        ? cause.message : "MANUAL_IDENTITY_REQUEST_FAILED"
      setManualDecisionFeedback({ status: "ERROR", message,
        requestTraceId, itemId: manualTarget, httpStatus, failedStage })
      setError(message)
    }
    finally { setManualBusy(false) }
  }, [manualCandidate, manualTarget, request])
  const visibleBucket = (data?.operationalBuckets ?? []).filter((row) =>
    data?.currentLiveCertified && row.bucket === bucket)
  const caseByItem = new Map(currentCases.map((row) => [row.ebay_item_id, row]))
  for (const row of data?.canonicalStockListings ?? []) {
    if (row.supplierLinkage === "CERTIFIED" && !caseByItem.has(row.itemId)) {
      caseByItem.set(row.itemId, { case_id: `canonical:${row.itemId}`,
        ebay_item_id: row.itemId, ebay_title: row.title ?? null,
        ebay_custom_label: null, origin: "IMPORTED_LEGACY",
        identity_status: "LINKED_EXACT", stockguard_link_status: "LINKED_MONITOR_ONLY",
        supplier_sku: row.sku ?? row.components?.[0]?.supplierSku ?? null,
        luna_product_id: row.components?.[0]?.supplierProductId ?? null,
        luna_variant_id: row.components?.[0]?.supplierVariantId ?? null,
      } as Case)
    }
    if (row.supplierLinkage === "CERTIFIED" && caseByItem.has(row.itemId)) {
      const existing = caseByItem.get(row.itemId)!
      caseByItem.set(row.itemId, { ...existing,
        identity_status: "LINKED_EXACT", stockguard_link_status: "LINKED_MONITOR_ONLY",
        supplier_sku: row.sku ?? row.components?.[0]?.supplierSku ?? existing.supplier_sku,
        luna_product_id: row.components?.[0]?.supplierProductId ?? existing.luna_product_id,
        luna_variant_id: row.components?.[0]?.supplierVariantId ?? existing.luna_variant_id,
      })
    }
  }
  const reviewByItem = new Map((data?.reviewQueue ?? []).map((row) => [row.itemId, row]))
  return <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-7 text-slate-900 md:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-black">Listings</h1>
          <p className="mt-1 text-sm text-slate-600">Un caso por cuenta e Item ID. Importación y StockGuard comparten identidad; ninguna acción aquí publica ni cambia cantidades.</p></div>
        <button type="button" disabled={busy} onClick={() => void request("reconcile_current_live")}
          className="rounded-lg bg-cyan-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "Leyendo eBay…" : "Reconciliar LIVE oficial"}</button>
      </header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">{notice}</p>}
      {!data?.currentLiveCertified && <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>LIVE actual pendiente de certificación.</strong> Los casos guardados se muestran como historial.
        {data?.lastCertifiedLiveCount != null && <> Última cohorte: {data.lastCertifiedLiveCount} · {show(data.lastCertifiedAt)}.</>}
      </section>}
      <section className="hidden grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen de reconciliación">
        {[["Casos exactos", counts.linked], ["Revisión de identidad", counts.ambiguous],
          ["Sin Luna", counts.missing], ["StockGuard vinculado", counts.stockguard]].map(([label, value]) =>
          <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{data?.currentLiveCertified ? value : "—"}</p></div>)}
      </section>
      <nav aria-label="Listing identity buckets" className="grid gap-2 sm:grid-cols-4">
        {[["LINKED_EXACT", "Linked"], ["READY_TO_CONFIRM_EXACT", "Ready to link"],
          ["CONFLICT_REVIEW", "Conflicts"], ["NO_EXACT_SOURCE", "No exact source"]]
          .map(([value, label]) => <button key={value} type="button"
            onClick={() => setBucket(value)} aria-pressed={bucket === value}
            className={`rounded-xl border p-4 text-left ${bucket === value ? "border-cyan-700 bg-cyan-50" : "bg-white"}`}>
            <span className="text-sm font-bold">{label}</span><span className="mt-1 block text-2xl font-black">
              {data?.currentLiveCertified && data.canonicalStockReadReady
                ? data.bucketCounts?.[value] ?? 0 : "—"}</span></button>)}
      </nav>
      {bucket === "READY_TO_CONFIRM_EXACT" && <section className="rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div><h2 className="text-xl font-black">Ready to link</h2>
            <p className="text-sm text-slate-600">Exact supplier identity candidates from the current official LIVE cohort.</p></div>
          <div className="flex flex-wrap gap-2"><button type="button"
            disabled={busy || !data?.canonicalStockReadReady || !ready.length} onClick={() => setSelectedExact(ready.map((row) => row.itemId))}
            className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50">SELECT ALL EXACT</button>
            <button type="button" disabled={busy || !data?.currentLiveCertified || !data.canonicalStockReadReady || !selectedExact.length}
              onClick={() => void batchConfirm()}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
              CONFIRM SELECTED EXACT LINKS ({selectedExact.length})</button></div>
        </div>
        {batchBlockedRows.length > 0 && <div role="status" className="border-b border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">Rows held for review</p><ul className="mt-1 list-disc pl-5">{batchBlockedRows.map((row) => <li key={row.itemId}>{row.itemId}: {row.blocker}</li>)}</ul></div>}
        <div className="space-y-3 p-4">{ready.map((review) => {
          const row = caseByItem.get(review.itemId)
          const candidate = review.candidates[0]
          if (!row || !candidate) return null
          return <article key={review.itemId} className="grid gap-4 rounded-lg border p-4 md:grid-cols-[auto_1fr_1fr_1fr]">
            <label className="flex items-start gap-2 text-sm font-bold"><input type="checkbox"
              aria-label={`Select exact link ${review.itemId}`}
              checked={selectedExact.includes(review.itemId)}
              onChange={(event) => setSelectedExact((before) => event.target.checked
                ? [...before, review.itemId] : before.filter((id) => id !== review.itemId))} />Select</label>
            <div><h3 className="font-black">eBay</h3>
              {officialEbayImage(row.ebay_image_url) && <img src={officialEbayImage(row.ebay_image_url)!} alt={`eBay listing ${review.itemId}`}
                className="my-2 h-24 w-24 object-contain" />}
              <p className="font-bold">{review.itemId}</p><p>{show(row.ebay_title)}</p>
              <p className="text-xs">Custom Label: {show(review.customLabel)}</p></div>
            <div><h3 className="font-black">Luna</h3>
              {provenLunaImage(candidate.imageUrl) && <img src={provenLunaImage(candidate.imageUrl)!} alt="Luna product"
                className="my-2 h-24 w-24 object-contain" />}
              <p className="font-bold">{candidate.sku}</p><p>{show(candidate.title)}</p>
              <p className="text-xs">Product {candidate.productId}<br />Variant {candidate.variantId}</p></div>
            <div><h3 className="font-black">Evidence</h3>
              <p className="text-sm">{review.confidenceBasis}</p>
              <p className="text-xs">Provenance: {candidate.source}<br />
                Identity preflight: {candidate.preflightStatus}<br />Contradiction: none found</p></div>
          </article>
        })}{!ready.length && <p className="text-sm text-slate-500">No clean exact candidates in this cohort.</p>}</div>
      </section>}
      {bucket !== "READY_TO_CONFIRM_EXACT" && <section className="rounded-xl border bg-white">
        <div className="border-b p-4"><h2 className="text-xl font-black">
          {bucket === "LINKED_EXACT" ? "Linked" : bucket === "CONFLICT_REVIEW" ? "Conflicts" : "No exact source"}</h2>
          {bucket === "NO_EXACT_SOURCE" && <p className="text-sm text-slate-600">These are legitimate eBay listings without a proven Luna source. No routine OWNER click is needed.</p>}</div>
        <div className="divide-y">{visibleBucket.map(({ itemId }) => {
          const row = caseByItem.get(itemId)
          const review = reviewByItem.get(itemId)
          if (!row) return null
          return <article key={itemId} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_2fr_2fr_auto]">
            <div className="font-black">{itemId}<p className="font-normal">{show(row.ebay_custom_label)}</p></div>
            <div className="flex items-start gap-3">
              {officialEbayImage(row.ebay_image_url) && <img src={officialEbayImage(row.ebay_image_url)!} alt={`eBay listing ${itemId}`}
                className="h-24 w-24 shrink-0 object-contain" />}
              <div>{show(row.ebay_title)}<p className="text-xs text-slate-500">{row.origin} · {row.identity_source}</p></div>
            </div>
            <div>{bucket === "LINKED_EXACT"
              ? <><strong>{row.supplier_sku}</strong><p>{row.luna_product_id} / {row.luna_variant_id}</p>
                <p className="text-xs">StockGuard: {row.stockguard_link_status}</p></>
              : <><strong>{review?.reasonCode ?? "IDENTITY_REVIEW_REQUIRED"}</strong>
                {review?.conflictingItemIds.length ? <p>Conflicting Item IDs: {review.conflictingItemIds.join(", ")}</p> : null}
                {review?.candidates.map((candidate) => <p key={`${candidate.productId}:${candidate.variantId}`}>
                  {candidate.sku} · {candidate.productId} / {candidate.variantId} · {candidate.source}</p>)}
                {bucket === "NO_EXACT_SOURCE" && <a href="/admin/ebay/listings/register"
                  className="font-bold text-cyan-800">Link source if new evidence exists</a>}</>}</div>
            {(bucket === "CONFLICT_REVIEW" || bucket === "NO_EXACT_SOURCE") && <button type="button"
              disabled={busy || manualBusy} onClick={() => {
                setManualTarget(itemId); setManualSearch(""); setManualResults(null)
                setManualCandidate(null); setManualDecisionFeedback(null); setError("")
                void loadManualIdentityTarget(itemId)
              }} className="h-fit rounded-lg border border-cyan-700 px-3 py-2 font-bold text-cyan-900">RESOLVE IDENTITY</button>}
          </article>
        })}{!visibleBucket.length && <p className="p-4 text-sm text-slate-500">No cases in this bucket.</p>}</div>
      </section>}
      {manualTarget && <div role="dialog" aria-modal="true" aria-labelledby="manual-identity-title"
        className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
        <section className="mx-auto my-6 max-w-6xl rounded-xl bg-white p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3"><div>
            <h2 id="manual-identity-title" className="text-xl font-black">Resolve identity · Item {manualTarget}</h2>
            <p className="text-sm text-slate-600">A Custom Label is correlation evidence only. Review the Luna identity and confirm it explicitly.</p>
          </div><button type="button" disabled={manualBusy}
            onClick={() => setManualTarget(null)} className="rounded border px-3 py-2 disabled:opacity-50">Close</button></div>
          {manualDecisionFeedback && <div role={manualDecisionFeedback.status === "ERROR" ? "alert" : "status"}
            className={`mt-4 rounded-lg border p-3 text-sm font-bold ${manualDecisionFeedback.status === "ERROR" ? "border-rose-300 bg-rose-50 text-rose-900" : manualDecisionFeedback.status === "PENDING" ? "border-cyan-300 bg-cyan-50 text-cyan-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
            Status: {manualDecisionFeedback.status === "SUCCESS" ? "LINKED_EXACT" : manualDecisionFeedback.status}<br />
            Request trace ID: {manualDecisionFeedback.requestTraceId ?? "—"}<br />
            Item ID: {manualDecisionFeedback.itemId ?? manualTarget}<br />
            {manualDecisionFeedback.status === "ERROR" ? <>
              HTTP status: {manualDecisionFeedback.httpStatus ?? 0}<br />
              Blocker: {manualDecisionFeedback.message}<br />
              Failed stage: {manualDecisionFeedback.failedStage ?? "UNKNOWN"}
            </> : manualDecisionFeedback.status === "PENDING" ? manualDecisionFeedback.message : <>
              Link receipt ID: {manualDecisionFeedback.receiptId ?? "—"}<br />
              Supplier SKU: {manualDecisionFeedback.sku}<br />
              Product ID: {manualDecisionFeedback.productId}<br />
              Variant ID: {manualDecisionFeedback.variantId}<br />
              Canonical readback: {manualDecisionFeedback.canonicalReadback}<br />
              StockGuard: {manualDecisionFeedback.stockguardStatus}
            </>}
          </div>}
          {manualResults?.item && <div className="mt-4 grid gap-4 rounded-lg border p-4 md:grid-cols-2">
            <div><h3 className="font-black">eBay listing · {manualResults.item.itemId}</h3>
              {officialEbayImage(manualResults.item.imageUrl) && <img src={officialEbayImage(manualResults.item.imageUrl)!} alt="eBay listing" className="my-2 h-28 w-28 object-contain" />}
              <p>{manualResults.item.title ?? "Title unavailable"}</p>
              <p>Custom Label: {manualResults.item.customLabel ?? "None"}</p>
              <p>Current status: {manualResults.item.status}</p></div>
            <div><label className="font-black" htmlFor="manual-luna-search">Search Luna by SKU, productId, variantId, or title</label>
              <div className="mt-2 flex gap-2"><input id="manual-luna-search" value={manualSearch}
                onChange={(event) => setManualSearch(event.target.value)} maxLength={80}
                className="min-w-0 flex-1 rounded border px-3 py-2" placeholder="SKU or product terms" />
                <button type="button" disabled={manualBusy || !manualSearch.trim()} onClick={() => void searchManualIdentity()}
                  className="rounded bg-cyan-800 px-3 py-2 font-bold text-white disabled:opacity-50">Search (max 20)</button></div>
            </div>
          </div>}
          <div className="mt-4 grid gap-3 md:grid-cols-2">{(manualResults?.candidates ?? []).map((candidate) => {
            const selected = manualCandidate?.productId === candidate.productId &&
              manualCandidate?.variantId === candidate.variantId && manualCandidate?.sku === candidate.sku
            return <button key={`${candidate.productId}:${candidate.variantId}:${candidate.sku}`} type="button"
              aria-pressed={selected} onClick={() => setManualCandidate(candidate)}
              className={`grid gap-3 rounded-lg border p-4 text-left sm:grid-cols-[auto_1fr] ${selected ? "border-cyan-800 bg-cyan-50" : "bg-white"}`}>
              {provenLunaImage(candidate.imageUrl) && <img src={provenLunaImage(candidate.imageUrl)!} alt="Luna product" className="h-24 w-24 object-contain" />}
              <span><strong>{candidate.title}</strong><br />{candidate.variantTitle ?? "Variant"}<br />SKU: {candidate.sku}<br />productId: {candidate.productId}<br />variantId: {candidate.variantId}<br />Stock: {candidate.stockQuantity !== null ? candidate.stockQuantity : candidate.stockAvailability === "IN_STOCK" ? "IN STOCK — quantity not provided by source" : candidate.stockAvailability}<br />Stock observed: {candidate.stockObservedAt ?? "UNKNOWN"}</span>
            </button>
          })}</div>
          {manualCandidate?.conflictingRelationship && manualResults?.item &&
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <h3 className="font-black">Identity conflict · {manualCandidate.conflictingRelationship.reasonCode}</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="rounded border bg-white p-3"><strong>CURRENT RELATIONSHIP</strong>
                  {officialEbayImage(manualCandidate.conflictingRelationship.imageUrl) &&
                    <img src={officialEbayImage(manualCandidate.conflictingRelationship.imageUrl)!}
                      alt="Current eBay listing" className="my-2 h-24 w-24 object-contain" />}
                  <p>Item {manualCandidate.conflictingRelationship.itemId} · {manualCandidate.conflictingRelationship.status}</p>
                  <p>{manualCandidate.conflictingRelationship.title ?? "Title unavailable"}</p>
                  <p>Custom Label: {manualCandidate.conflictingRelationship.customLabel ?? "None"}</p>
                  <p>{manualCandidate.conflictingRelationship.supplierSku}<br />
                    {manualCandidate.conflictingRelationship.productId} / {manualCandidate.conflictingRelationship.variantId}</p>
                  <p className="text-xs">Decision: {manualCandidate.conflictingRelationship.decisionId}</p>
                </div>
                <div className="rounded border bg-white p-3"><strong>PROPOSED RELATIONSHIP</strong>
                  <div className="my-2 flex gap-2">
                    {officialEbayImage(manualResults.item.imageUrl) &&
                      <img src={officialEbayImage(manualResults.item.imageUrl)!} alt="Proposed eBay listing"
                        className="h-24 w-24 object-contain" />}
                    {provenLunaImage(manualCandidate.imageUrl) &&
                      <img src={provenLunaImage(manualCandidate.imageUrl)!} alt="Proposed Luna product"
                        className="h-24 w-24 object-contain" />}
                  </div>
                  <p>Item {manualResults.item.itemId} · {manualResults.item.title}</p>
                  <p>{manualCandidate.title}</p>
                  <p>{manualCandidate.sku}<br />{manualCandidate.productId} / {manualCandidate.variantId}</p>
                  <p className="text-xs">Existing opportunity: {manualCandidate.existingOpportunityId ?? "None"}</p>
                </div>
              </div>
              <p className="mt-2 text-sm">The current relationship remains quarantined until an explicit OWNER decision.</p>
            </div>}
          {manualResults && !manualResults.candidates?.length && <p className="mt-3 text-sm">No Luna candidates found. Keep this listing unlinked until exact source evidence is available.</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">
            <button type="button" disabled={manualBusy || !manualCandidate}
              onClick={() => void decideManualIdentity("REJECT_CANDIDATE")}
              className="rounded border px-4 py-2 font-bold disabled:opacity-50">REJECT CANDIDATE</button>
            <button type="button" disabled={manualBusy}
              onClick={() => void decideManualIdentity("REVIEW_CONFLICT")}
              className="rounded border px-4 py-2 font-bold">{manualCandidate?.conflictingRelationship ? "KEEP CURRENT / REVIEW CONFLICT" : "REVIEW CONFLICT"}</button>
            <button type="button" disabled={manualBusy} onClick={() => void decideManualIdentity("KEEP_UNLINKED_NO_SOURCE_YET")}
              className="rounded border px-4 py-2 font-bold">KEEP UNLINKED / NO SOURCE YET</button>
            <button type="button" disabled={manualBusy || !manualCandidate ||
              Boolean(manualCandidate.conflictingRelationship &&
                !manualCandidate.conflictingRelationship.supersessionEligible) ||
              manualDecisionFeedback?.status === "SUCCESS"}
              onClick={() => void decideManualIdentity(manualCandidate?.conflictingRelationship
                ? "CONFIRM_SUPERSESSION" : "CONFIRM_EXACT_LUNA_LINK")}
              className="rounded bg-emerald-700 px-4 py-2 font-black text-white disabled:opacity-50">
              {manualCandidate?.conflictingRelationship ? "CONFIRM SUPERSESSION" : "CONFIRM EXACT LUNA LINK"}</button>
          </div>
        </section>
      </div>}
      <section id="identity-review" className="hidden overflow-hidden rounded-xl border bg-white">
        <div className="border-b p-4"><h2 className="text-lg font-black">Revisión de identidad · {data?.reviewQueue?.length ?? 0}</h2>
          <p className="text-sm text-slate-600">Casos pendientes del barrido certificado {show(data?.reviewSweepId)}. Confirma cada vínculo con la cuenta e identidad oficiales. Si el barrido vence, usa «Reconciliar LIVE oficial» antes de confirmar.</p></div>
        {duplicateGroups.map(([label, rows]) => <div key={label} className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <strong>Conflicto de Custom Label {label}</strong> · Item IDs {rows.map((row) => row.itemId).join(" y ")}. Ambos quedan bloqueados hasta revisión OWNER.
          {rows.map((row) => <p key={row.itemId} className="mt-1">{row.itemId}: {row.candidates.length ?
            row.candidates.map((candidate) => `${candidate.sku} / ${candidate.productId} / ${candidate.variantId} (${candidate.source})`).join("; ") :
            "sin identidad Luna durable"}</p>)}
        </div>)}
        <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr>
            <th className="p-3">Item ID</th><th className="p-3">Custom Label / SKU</th>
            <th className="p-3">Título oficial del barrido</th><th className="p-3">Origen</th>
            <th className="p-3">Identidad / StockGuard</th><th className="p-3">Candidato Luna</th>
            <th className="p-3">Motivo / base de coincidencia</th>
            <th className="p-3">Acción OWNER</th>
          </tr></thead>
          <tbody>{(data?.reviewQueue ?? []).map((row) => <tr key={row.itemId} className="border-t align-top">
            <td className="p-3 font-bold">{row.itemId}</td>
            <td className="p-3">{show(row.customLabel)}</td>
            <td className="p-3">{row.currentTitle ?? "Título oficial pendiente de captura"}</td>
            <td className="p-3">{row.origin}<br /><span className="text-xs text-slate-500">{row.identitySource}</span></td>
            <td className="p-3 text-xs">{row.identityStatus}<br />{row.stockguardStatus}</td>
            <td className="p-3 text-xs">{row.candidates.length ? row.candidates.map((candidate) =>
              <div key={`${candidate.productId}:${candidate.variantId}:${candidate.sku}`} className="mb-2">
                {candidate.sku}<br />{candidate.productId} / {candidate.variantId}<br />
                {candidate.source} · {show(candidate.preflightStatus)}
              </div>) : "Ninguno probado"}
              {row.conflictingItemIds.length > 0 && <div>Item IDs en conflicto: {row.conflictingItemIds.join(", ")}</div>}</td>
            <td className="p-3"><strong>{row.classification}</strong><br />{row.reasonCode}<br />
              <span className="text-xs">Base: {row.confidenceBasis}</span></td>
            <td className="p-3 text-xs">{row.recommendedOwnerAction}
              {row.lastOwnerAction && <p className="mt-1">Última acción: {row.lastOwnerAction} · {show(row.lastOwnerActionAt)}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {row.reasonCode === "EXACT_CANDIDATE_REQUIRES_GUARDED_LINK" &&
                  row.candidates.length === 1 && <button type="button" disabled={busy || !data?.currentLiveCertified}
                    onClick={() => { setReviewSelection({ itemId: row.itemId, action: "confirm_exact_link", candidate: row.candidates[0] }); setReviewConfirmed(false) }}
                    className="rounded bg-cyan-800 px-2 py-1 font-bold text-white">CONFIRM EXACT LINK</button>}
                {row.identityStatus === "MISSING_LUNA_IDENTITY" && row.candidates.length === 1 &&
                  <button type="button" disabled={busy || !data?.currentLiveCertified}
                    onClick={() => { setReviewSelection({ itemId: row.itemId, action: "reject_candidate", candidate: row.candidates[0] }); setReviewConfirmed(false) }}
                    className="rounded border px-2 py-1 font-bold">REJECT CANDIDATE</button>}
                {row.identityStatus === "MISSING_LUNA_IDENTITY" &&
                  <button type="button" disabled={busy || !data?.currentLiveCertified}
                    onClick={() => { setReviewSelection({ itemId: row.itemId, action: "keep_manual_no_luna", candidate: null }); setReviewConfirmed(false) }}
                    className="rounded border px-2 py-1 font-bold">KEEP MANUAL / NO LUNA</button>}
                <button type="button" disabled={busy || !data?.currentLiveCertified}
                  onClick={() => { setReviewSelection({ itemId: row.itemId, action: "review_conflict", candidate: null }); setReviewConfirmed(false) }}
                  className="rounded border px-2 py-1 font-bold">REVIEW CONFLICT</button>
              </div>
              {reviewSelection?.itemId === row.itemId && <div className="mt-3 rounded border border-cyan-300 bg-cyan-50 p-2">
                <strong>{reviewSelection.action}</strong><br />
                {reviewSelection.candidate && <span>{reviewSelection.candidate.sku} · {reviewSelection.candidate.productId} / {reviewSelection.candidate.variantId}<br /></span>}
                {reviewSelection.action === "keep_manual_no_luna" && row.candidates.length > 0 &&
                  <span className="font-bold text-amber-900">Este caso tiene candidato Luna exacto. Confirma NO LUNA sólo si sabes que no es su proveedor.<br /></span>}
                <label className="mt-2 flex gap-2"><input type="checkbox" checked={reviewConfirmed}
                  onChange={(event) => setReviewConfirmed(event.target.checked)} />Confirmo esta acción para el Item ID {row.itemId}.</label>
                <button type="button" disabled={busy || !reviewConfirmed}
                  onClick={() => void request(reviewSelection.action, row.itemId, undefined, reviewSelection.candidate)}
                  className="mt-2 rounded bg-cyan-800 px-2 py-1 font-bold text-white disabled:opacity-50">Guardar y comprobar</button>
              </div>}
            </td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <details id="import-existing" className="hidden rounded-xl border bg-white p-5"><summary className="cursor-pointer font-bold">Importar un Item ID fuera del barrido actual</summary>
        <h2 className="text-lg font-black">Link / Import Existing eBay Listing</h2>
        <p className="mt-1 text-sm text-slate-600">Lee Item ID, vendedor, estado y Custom Label desde eBay. Si falta identidad Luna, guarda el caso para revisión.</p>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault(); void request("import_existing", itemId)
        }}>
          <label className="sr-only" htmlFor="existing-item-id">eBay Item ID</label>
          <input id="existing-item-id" value={itemId} onChange={(event) => setItemId(event.target.value.trim())}
            inputMode="numeric" pattern="[0-9]{9,20}" required placeholder="eBay Item ID"
            className="min-w-56 rounded-lg border px-3 py-2 text-sm" />
          <button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Leer e importar</button>
        </form>
      </details>
      <details id="link-identity" className="hidden rounded-xl border bg-white p-5"><summary className="cursor-pointer font-bold">Vínculo manual de compatibilidad</summary>
        <h2 className="text-lg font-black">Vincular identidad canónica</h2>
        <p className="mt-1 text-sm text-slate-600">Selecciona el Item ID importado y una oportunidad canónica exacta. El flujo existente verifica la cuenta, el Custom Label y la identidad Luna antes de activar el vínculo.</p>
        <form className="mt-3 space-y-3" onSubmit={(event) => {
          event.preventDefault()
          if (confirmed) void request("link_existing", linkItemId, opportunityId)
        }}>
          <div className="flex flex-wrap gap-2"><input aria-label="eBay Item ID para vincular" value={linkItemId}
            onChange={(event) => setLinkItemId(event.target.value.trim())}
            inputMode="numeric" pattern="[0-9]{9,20}" required placeholder="eBay Item ID"
            className="min-w-56 rounded-lg border px-3 py-2 text-sm" />
          <input aria-label="Opportunity ID canónico" value={opportunityId}
            onChange={(event) => setOpportunityId(event.target.value.trim())}
            pattern="[0-9a-fA-F-]{36}" required placeholder="Opportunity ID canónico"
            className="min-w-72 rounded-lg border px-3 py-2 text-sm" /></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
            Confirmo que seleccioné la oportunidad exacta para este Item ID.</label>
          <button disabled={busy || !confirmed} className="rounded-lg bg-cyan-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Verificar y vincular</button>
        </form>
      </details>
      <section className="hidden overflow-hidden rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-lg font-black">Registro canónico · {rows.length} de {data?.cases?.length ?? 0} casos guardados{data?.currentLiveCertified ? ` · ${currentCases.length} LIVE` : ""}</h2>
          <select aria-label="Filtrar listings" value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            {[["ALL", "Todos"], ["LINKED_EXACT", "Exactos"], ["LINKABLE_EXACT", "Vinculables"],
              ["AMBIGUOUS", "Ambiguos"], ["DUPLICATE_IDENTITY", "Duplicados"],
              ["MISSING_LUNA_IDENTITY", "Sin Luna"], ["NEEDS_OWNER_REVIEW", "Revisión OWNER"],
              ["LINKED_ACTIVE", "StockGuard activo"], ["LINKED_MONITOR_ONLY", "Sólo monitoreo"]].map(([value, label]) =>
              <option key={value} value={value}>{label}</option>)}</select>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr>
            <th className="p-3">eBay Item ID</th><th className="p-3">Título</th><th className="p-3">Custom Label / SKU</th>
            <th className="p-3">Caso / producto</th><th className="p-3">Luna</th>
            <th className="p-3">Origen / estado</th><th className="p-3">Identidad</th>
            <th className="p-3">StockGuard</th><th className="p-3">Siguiente bloqueo</th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.case_id} className="border-t align-top">
            <td className="p-3 font-bold">{row.ebay_item_id}</td>
            <td className="p-3">{show(row.ebay_title)}</td>
            <td className="p-3">{show(row.ebay_custom_label)}</td>
            <td className="p-3 text-xs">{row.case_id}<br />Oportunidad {show(row.opportunity_id)}<br />Paquete {show(row.listing_package_id)}</td>
            <td className="p-3 text-xs">Producto {show(row.luna_product_id)}<br />Variante {show(row.luna_variant_id)}<br />SKU {show(row.supplier_sku)}</td>
            <td className="p-3">{row.origin}<br /><span className="text-xs text-slate-500">{data?.currentLiveCertified && row.last_reconciled_sweep_id === data.currentSweepId ? "LIVE ACTUAL" : "HISTÓRICO"}</span></td>
            <td className="p-3 font-bold">{row.identity_status}</td>
            <td className="p-3">{row.stockguard_link_status}</td>
            <td className="p-3">{show(row.next_blocker)}{row.next_blocker &&
              <a href="#identity-review"
                className="mt-1 block font-bold text-cyan-800">Revisar identidad OWNER</a>}</td>
          </tr>)}</tbody>
        </table></div>
        {!busy && rows.length === 0 && <p className="p-5 text-sm text-slate-500">No hay casos con ese filtro.</p>}
      </section>
    </div>
  </main>
}
