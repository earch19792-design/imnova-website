import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  EBAY_LISTING_QUALITY_REPORT_SOURCE,
  parseEbayListingQualityReportV1,
// @ts-expect-error Node's direct TypeScript audit runner requires the suffix.
} from "./ebay-listing-quality-report-import-v1.ts"

export const OWNER_LISTING_QUALITY_REPORT_IMPORT_VERSION =
  "REMOTE_OPERATOR_LISTING_QUALITY_REPORT_OWNER_IMPORT_V1_2026_09_02"

export type OwnerQualityReportSnapshotV1 = ReturnType<
  typeof parseEbayListingQualityReportV1>

export type OwnerQualityLiveListingV1 = Readonly<{
  listingKey: string
  itemId: string
  sku: string | null
}>

export type ExactProductTruthV1 = Readonly<{
  reference: string
  itemSpecifics: Readonly<Record<string, string>>
}>

export class OwnerQualityReportImportError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
    this.name = "OwnerQualityReportImportError"
  }
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : null
}

function normalized(value: unknown) {
  return (text(value, 160) ?? "").toLocaleLowerCase("en-US")
}

function normalizedSku(value: unknown) {
  return (text(value, 120) ?? "").toLocaleUpperCase("en-US")
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function reportDate(value: unknown) {
  const candidate = text(value, 40)
  if (!candidate) return null
  const iso = candidate.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/)
  const us = candidate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const result = iso ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
      : null
  if (!result) return null
  const parsed = new Date(`${result}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result
    ? result : null
}

function signalType(row: OwnerQualityReportSnapshotV1["rows"][number]) {
  const value = normalized([row.recommendationCategory, row.recommendationType,
    row.recommendationText, row.qualityIssue, row.itemSpecificName]
    .filter(Boolean).join(" "))
  if (row.itemSpecificName || /item specific|aspect|attribute/.test(value)) {
    return "ITEM_SPECIFIC_MISSING" as const
  }
  if (/image|photo|picture|gallery/.test(value)) return "IMAGE_REVIEW" as const
  if (/title/.test(value)) return "TITLE_REVIEW" as const
  if (/category/.test(value)) return "CATEGORY_REVIEW" as const
  if (/description/.test(value)) return "DESCRIPTION_REVIEW" as const
  return "GENERAL_LISTING_QUALITY" as const
}

function exactFact(truth: ExactProductTruthV1 | undefined, field: string | null) {
  if (!truth || !field) return null
  const wanted = normalized(field)
  const entry = Object.entries(truth.itemSpecifics).find(([name, value]) =>
    normalized(name) === wanted && Boolean(text(value, 240)))
  return entry ? { field: text(entry[0], 120)!, value: text(entry[1], 240)!,
    reference: truth.reference } : null
}

const NEED_EVIDENCE =
  "eBay recomienda completar este dato, pero todavía no tenemos información suficiente. No necesitas hacer nada."

export function prepareOwnerListingQualityReportImportV1(input: {
  snapshot: OwnerQualityReportSnapshotV1
  accountKey: string
  accountAlias: string
  importedBy: string
  liveScope: Readonly<{ scopeId: string; observedAt: string | null;
    identityStatus: string }>
  liveListings: readonly OwnerQualityLiveListingV1[]
  productTruthByItemId?: ReadonlyMap<string, ExactProductTruthV1>
  now?: string
}) {
  if (!input.accountKey || !input.accountAlias ||
      !/^[0-9a-f-]{36}$/i.test(input.importedBy)) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_OWNER_SCOPE_INVALID")
  }
  if (input.liveScope.identityStatus !== "CERTIFIED" ||
      !input.liveScope.observedAt || !input.liveScope.scopeId) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_CURRENT_LIVE_SCOPE_UNPROVEN")
  }
  const accounts = [...new Set(input.snapshot.rows.map((row) =>
    text(row.reportAccount, 120)).filter((value): value is string => Boolean(value)))]
  if (accounts.length !== 1 || normalized(accounts[0]) !==
      normalized(input.accountAlias) || input.snapshot.rows.some((row) =>
        !text(row.reportAccount, 120))) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_ACCOUNT_MATCH_UNPROVEN")
  }
  const dates = input.snapshot.rows.map((row) => reportDate(row.reportDate))
  if (dates.some((value) => !value) || new Set(dates).size !== 1) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_DATE_UNPROVEN")
  }
  const normalizedReportDate = dates[0]!
  const now = new Date(input.now ?? new Date().toISOString())
  if (!Number.isFinite(now.getTime()) || normalizedReportDate > now.toISOString().slice(0, 10)) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_DATE_INVALID")
  }
  const marketplaces = [...new Set(input.snapshot.rows.map((row) =>
    normalized(row.marketplace)).filter(Boolean))]
  if (marketplaces.some((value) => !["ebay_us", "us", "ebay.com"].includes(value))) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_MARKETPLACE_MISMATCH")
  }
  const liveByItem = new Map(input.liveListings.map((listing) =>
    [listing.itemId, listing]))
  if (liveByItem.size !== input.liveListings.length || input.liveListings.some((row) =>
    !/^\d{9,20}$/.test(row.itemId))) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_CURRENT_LIVE_SCOPE_AMBIGUOUS")
  }
  if (input.snapshot.rows.some((row) => !row.itemId || !/^\d{9,20}$/.test(row.itemId))) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_EXACT_ITEM_ID_REQUIRED")
  }

  let nonliveRowsExcluded = 0
  const covered = new Set<string>()
  const seen = new Set<string>()
  const signals = input.snapshot.rows.flatMap((row) => {
    const listing = liveByItem.get(row.itemId!)
    if (!listing) { nonliveRowsExcluded += 1; return [] }
    const reportSku = normalizedSku(row.sku)
    const listingSku = normalizedSku(listing.sku)
    if (reportSku && (!listingSku || reportSku !== listingSku)) {
      throw new OwnerQualityReportImportError("QUALITY_REPORT_SKU_MAPPING_MISMATCH")
    }
    covered.add(row.itemId!)
    const type = signalType(row)
    const proposedField = text(row.itemSpecificName, 120)
    const dedupeKey = `sha256:${sha([row.itemId, type, normalized(proposedField),
      normalized(row.recommendationCategory), normalized(row.recommendationType),
      normalized(row.recommendationText ?? row.qualityIssue)].join("|"))}`
    if (seen.has(dedupeKey)) return []
    seen.add(dedupeKey)
    const truth = input.productTruthByItemId?.get(row.itemId!)
    const fact = exactFact(truth, proposedField)
    const truthSupported = Boolean(fact || truth && type !== "ITEM_SPECIFIC_MISSING")
    const freshness = normalizedReportDate === now.toISOString().slice(0, 10)
      ? "CURRENT" as const : "STALE" as const
    const actionable = truthSupported && freshness === "CURRENT"
    const displayField = proposedField ?? "la información del producto"
    const happening = proposedField
      ? `eBay recomienda completar ${displayField} en este producto.`
      : "eBay encontró una mejora posible en la información de este producto."
    const why = proposedField
      ? `Agregar ${displayField} puede ayudar a que eBay entienda mejor el listing.`
      : "Una ficha clara puede ayudar a que eBay y los compradores entiendan mejor el producto."
    const recommendation = fact
      ? `Seller OS encontró un valor respaldado por el producto exacto: ${fact.value}.`
      : truthSupported
        ? "Seller OS confirmó la identidad del producto exacto. Revisa la mejora sin cambiar hechos del producto."
      : NEED_EVIDENCE
    const whatToDo = freshness === "STALE"
      ? "Este reporte está desactualizado. No necesitas hacer nada con esta señal."
      : fact ? `Revisa ${fact.field}: ${fact.value}.`
        : truthSupported ? "Revisa la mejora propuesta y confirma que representa el producto exacto."
          : NEED_EVIDENCE
    const priority = !actionable ? "WAIT" as const
      : type === "IMAGE_REVIEW" ? "ENRICH" as const
        : type === "ITEM_SPECIFIC_MISSING" ? "NEEDS_ATTENTION" as const
          : "CAN_IMPROVE" as const
    return [{
      item_id: row.itemId!, sku: row.sku,
      signal_type: type,
      raw_signal_reference: row.sourceRowFingerprint,
      normalized_recommendation: recommendation,
      what_is_happening: happening,
      why_it_matters: why,
      seller_os_recommendation: recommendation,
      what_to_do_now: whatToDo,
      priority_class: priority,
      product_truth_supported: truthSupported,
      proposed_field: fact?.field ?? null,
      proposed_value: fact?.value ?? null,
      product_truth_reference: fact?.reference ??
        (truthSupported ? truth?.reference ?? null : null),
      operator_action_required: actionable,
      sku_match_when_available: reportSku ? true : null,
      dedupe_key: dedupeKey,
    }]
  })
  const freshness = normalizedReportDate === now.toISOString().slice(0, 10)
    ? "CURRENT" as const : "STALE" as const
  const actionable = signals.filter((row) => row.operator_action_required).length
  const needEvidence = signals.filter((row) =>
    !row.product_truth_supported).length
  return Object.freeze({
    import: Object.freeze({
      marketplace_account_key: input.accountKey,
      parser_version: input.snapshot.parserVersion,
      source_file_fingerprint: input.snapshot.sourceFileFingerprint,
      file_name: input.snapshot.fileName,
      report_account: accounts[0],
      report_date: normalizedReportDate,
      report_observed_at: `${normalizedReportDate}T00:00:00.000Z`,
      freshness,
      live_scope_id: input.liveScope.scopeId,
      live_scope_observed_at: input.liveScope.observedAt,
      current_live_count: input.liveListings.length,
      report_row_count: input.snapshot.rows.length,
      live_listings_covered: covered.size,
      signals_imported: signals.length,
      signals_actionable: actionable,
      signals_need_evidence: needEvidence,
      nonlive_rows_excluded: nonliveRowsExcluded,
      imported_by: input.importedBy,
    }),
    signals: Object.freeze(signals),
    guards: Object.freeze({ currentLive: true as const,
      exactItemIdMatch: true as const, nonliveRowsExcluded: true as const,
      duplicateTaskCount: 0 as const, factInvented: false as const,
      rawFileStored: false as const, remoteRawAccess: false as const }),
  })
}

function itemSpecifics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([name, raw]) => {
    const safeName = text(name, 120)
    const safeValue = text(raw, 240)
    return safeName && safeValue ? [[safeName, safeValue]] : []
  }))
}

export async function readExactProductTruthForLiveListingsV1(input: {
  supabase: SupabaseClient
  accountKey: string
  itemIds: readonly string[]
}) {
  if (!input.itemIds.length) return new Map<string, ExactProductTruthV1>()
  const links = await input.supabase.from("ebay_manual_listing_links")
    .select("ebay_item_id,opportunity_id,candidate_key,verification_status,connector_listing_status")
    .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
    .eq("verification_status", "verified").eq("connector_listing_status", "active")
    .in("ebay_item_id", [...input.itemIds])
  if (links.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_PRODUCT_TRUTH_READ_FAILED")
  const opportunityIds = [...new Set((links.data ?? []).map((row) =>
    text(row.opportunity_id, 40)).filter((value): value is string => Boolean(value)))]
  if (!opportunityIds.length) return new Map<string, ExactProductTruthV1>()
  const packages = await input.supabase.from("ebay_listing_packages")
    .select("id,opportunity_id,candidate_key,status,package_data")
    .eq("status", "approved").in("opportunity_id", opportunityIds)
  if (packages.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_PRODUCT_TRUTH_READ_FAILED")
  const result = new Map<string, ExactProductTruthV1>()
  for (const link of links.data ?? []) {
    const packageRow = (packages.data ?? []).find((row) =>
      row.opportunity_id === link.opportunity_id && row.candidate_key === link.candidate_key)
    if (!packageRow || result.has(link.ebay_item_id)) continue
    const data = packageRow.package_data && typeof packageRow.package_data === "object" &&
      !Array.isArray(packageRow.package_data)
      ? packageRow.package_data as Record<string, unknown> : {}
    const specifics = itemSpecifics(data.itemSpecifics ?? data.aspects)
    result.set(link.ebay_item_id, Object.freeze({
      reference: `APPROVED_EXACT_LISTING_PACKAGE:${packageRow.id}`,
      itemSpecifics: Object.freeze(specifics),
    }))
  }
  return result
}

export async function persistOwnerListingQualityReportV1(input: {
  supabase: SupabaseClient
  prepared: ReturnType<typeof prepareOwnerListingQualityReportImportV1>
}) {
  const existing = await input.supabase.from("ebay_listing_quality_report_imports")
    .select("id").eq("marketplace_account_key",
      input.prepared.import.marketplace_account_key)
    .eq("source_file_fingerprint", input.prepared.import.source_file_fingerprint)
    .maybeSingle()
  if (existing.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_DUPLICATE_CHECK_FAILED")
  if (existing.data?.id) return { importId: existing.data.id, idempotent: true as const }
  const result = await input.supabase.rpc("import_ebay_listing_quality_report_v1", {
    p_import: input.prepared.import,
    p_signals: input.prepared.signals,
  })
  if (result.error || !text(result.data, 40)) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_PERSIST_FAILED")
  }
  return { importId: String(result.data), idempotent: false as const }
}

export async function readOwnerListingQualityReportStatusV1(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: string
}) {
  const result = await input.supabase.from("ebay_listing_quality_report_imports")
    .select("id,imported_at,report_date,live_listings_covered,signals_imported,signals_actionable,signals_need_evidence,nonlive_rows_excluded")
    .eq("marketplace_account_key", input.accountKey)
    .order("imported_at", { ascending: false }).limit(1).maybeSingle()
  if (result.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_STATUS_READ_FAILED")
  const today = new Date(input.now ?? new Date().toISOString()).toISOString().slice(0, 10)
  if (!result.data) return Object.freeze({ state: "MISSING" as const,
    lastReportImportedAt: null, reportDate: null, reportFreshness: "MISSING" as const,
    liveListingsCovered: 0, signalsImported: 0, signalsActionable: 0,
    signalsNeedEvidence: 0, nonliveRowsExcluded: 0, reminderVisible: true as const })
  const current = result.data.report_date === today
  return Object.freeze({ state: current ? "CURRENT" as const : "STALE" as const,
    lastReportImportedAt: result.data.imported_at,
    reportDate: result.data.report_date,
    reportFreshness: current ? "CURRENT" as const : "STALE" as const,
    liveListingsCovered: result.data.live_listings_covered,
    signalsImported: result.data.signals_imported,
    signalsActionable: result.data.signals_actionable,
    signalsNeedEvidence: result.data.signals_need_evidence,
    nonliveRowsExcluded: result.data.nonlive_rows_excluded,
    reminderVisible: !current })
}

export type RemoteListingQualitySignalV1 = Readonly<{
  itemId: string
  signalType: string
  freshness: "CURRENT" | "STALE"
  whatIsHappening: string
  whyItMatters: string
  sellerOsRecommendation: string
  whatToDoNow: string
  priorityClass: "NEEDS_ATTENTION" | "CAN_IMPROVE" | "ENRICH" | "WAIT"
  productTruthSupported: boolean
  proposedField: string | null
  proposedValue: string | null
  operatorActionRequired: boolean
}>

export async function readRemoteListingQualitySignalsV1(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: string
}) {
  const latest = await input.supabase.from("ebay_listing_quality_report_imports")
    .select("id,report_date").eq("marketplace_account_key", input.accountKey)
    .order("imported_at", { ascending: false }).limit(1).maybeSingle()
  if (latest.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_STATUS_READ_FAILED")
  if (!latest.data?.id) return Object.freeze([]) as readonly RemoteListingQualitySignalV1[]
  const rows = await input.supabase.from("ebay_listing_quality_report_signals")
    .select("item_id,signal_type,freshness,what_is_happening,why_it_matters,seller_os_recommendation,what_to_do_now,priority_class,product_truth_supported,proposed_field,proposed_value,operator_action_required")
    .eq("report_import_id", latest.data.id).order("created_at", { ascending: true })
  if (rows.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_SIGNAL_READ_FAILED")
  const today = new Date(input.now ?? new Date().toISOString()).toISOString().slice(0, 10)
  const dynamicallyStale = latest.data.report_date !== today
  return Object.freeze((rows.data ?? []).map((row) => Object.freeze({
    itemId: row.item_id, signalType: row.signal_type,
    freshness: dynamicallyStale ? "STALE" as const
      : row.freshness as "CURRENT" | "STALE",
    whatIsHappening: row.what_is_happening,
    whyItMatters: row.why_it_matters,
    sellerOsRecommendation: row.seller_os_recommendation,
    whatToDoNow: dynamicallyStale
      ? "Este reporte está desactualizado. No necesitas hacer nada con esta señal."
      : row.what_to_do_now,
    priorityClass: dynamicallyStale ? "WAIT" as const
      : row.priority_class as RemoteListingQualitySignalV1["priorityClass"],
    productTruthSupported: row.product_truth_supported,
    proposedField: row.proposed_field, proposedValue: row.proposed_value,
    operatorActionRequired: dynamicallyStale ? false
      : row.operator_action_required,
  })))
}

export const OWNER_QUALITY_REPORT_SAFETY_V1 = Object.freeze({
  source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
  deterministicFirst: true as const,
  remoteOperatorUploadAccess: false as const,
  remoteOperatorRawReportAccess: false as const,
  factInvented: false as const,
  marketplaceWrites: 0 as const,
  listingMutations: 0 as const,
  newListingPublications: 0 as const,
  buyerMessages: 0 as const,
  postsaleActions: 0 as const,
})
