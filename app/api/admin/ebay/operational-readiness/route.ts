export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  assessProductCaseOperationalReadinessV1,
  assessStockGuardV2,
  calculateCommercialEconomicsV1,
  captureLunaProductVariantV1,
  linkSupplierToEbayIdentityV1,
} from "@/lib/ebay/ebay-commercial-operational-readiness-v1"
import { parseEbayListingQualityReportV1, QualityReportValidationError } from
  "@/lib/ebay/ebay-listing-quality-report-import-v1"
import { associateEbayListingQualityReportV1,
  summarizeEbayListingQualityAssociationsV1 } from
  "@/lib/ebay/ebay-listing-quality-report-import-v1"
import { getCommercialMonitorReadonly } from
  "@/lib/ebay/commercial-monitor-readonly-service"
import { getEbayCommercialMonitorLiveReadonly } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { renderCommercialWhatsAppAlertDryRunV1,
  WHATSAPP_TEMPLATE_DEFINITIONS_V1 } from
  "@/lib/ebay/ebay-commercial-whatsapp-alert-engine-v1"
import {
  buildLunaWatcherApprovalPersistenceContractV1,
  buildLunaWatcherAutomaticResponseV1,
  evaluateLunaAuthenticatedBrowserCaptureV1,
  resolveLunaWatcherSourcePriorityV1,
  scheduleLunaWatcherObservationV1,
  type LunaExactApprovedLinkV1,
} from "@/lib/ebay/ebay-luna-supplier-stock-watcher-v1"
import {
  auditLunaProtectedSessionConfigurationV1,
} from "@/lib/ebay/ebay-luna-authenticated-http-watcher-v1"
import { captureLunaAuthenticatedBrowserWorkerV1 } from
  "@/lib/ebay/ebay-luna-canonical-browser-worker-server-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeError(error: unknown) {
  if (error instanceof QualityReportValidationError) return error.reason
  const message = error instanceof Error ? error.message : "OPERATIONAL_READINESS_FAILED"
  return /^[A-Z0-9_]+$/.test(message) ? message : "OPERATIONAL_READINESS_FAILED"
}

function capabilities() {
  const ordersConfigured = Boolean(process.env.EBAY_COMMERCIAL_ORDERS_CLIENT_ID &&
    process.env.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET &&
    process.env.EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN)
  const lunaSession = auditLunaProtectedSessionConfigurationV1()
  return {
    marketResearch: "AVAILABLE",
    qualityReport: "READY_FOR_REAL_SAMPLE",
    qualityReportAcquisition: "HUMAN_ASSISTED_CSV_JSON_XLSX",
    orders: ordersConfigured ? "READY_FOR_READONLY_RUNTIME" : "AUTH_PENDING",
    lunaCapture: "AUTHENTICATED_BROWSER_WORKER_REAUTH_GATED",
    lunaSourceMode: "AUTHENTICATED_WEB_SESSION",
    lunaPersistentProfile: "EXISTING_CANONICAL_BROWSER_WORKER",
    lunaServerHttpStockAuthority:
      "NON_AUTHORITATIVE_FOR_AUTHENTICATED_STOCK",
    lunaRuntimeRecapture: "PENDING_REAL_SCHEDULED_OBSERVATION",
    lunaCookiePresent: lunaSession.lunaCookiePresent,
    lunaCookieServerOnly: lunaSession.lunaCookieServerOnly,
    lunaCookieClientExposed: lunaSession.lunaCookieClientExposed,
    supplierIdentity: "EVIDENCE_GATED",
    stockGuard: "READY_BUT_NOT_ACTIVATED",
    economics: "EVIDENCE_GATED",
    whatsapp: "DRY_RUN_ONLY",
    experimentHardOverride: "AVAILABLE",
    remoteDdlRequired: false,
  }
}

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error ?? "admin_forbidden" },
    { status: auth.status || 403 })
  const current = capabilities()
  return NextResponse.json({
    success: true,
    capabilities: current,
    templates: WHATSAPP_TEMPLATE_DEFINITIONS_V1,
    readiness: assessProductCaseOperationalReadinessV1({
      marketResearchReady: true, supplierCaptureReady: true, supplierIdentityReady: false,
      stockGuardReady: true, economicsReady: false, qualityReportReady: false,
      ordersReady: current.orders !== "AUTH_PENDING", whatsappDryRunReady: true,
      experimentOverrideReady: true,
    }),
    safety: { ebayWrites: 0, registryWrites: 0, inventoryWrites: 0,
      fulfillmentWrites: 0, whatsappSends: 0, productCaseMutations: 0, remoteDdl: 0 },
  })
}

export async function POST(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error ?? "admin_forbidden" },
    { status: auth.status || 403 })
  try {
    const body = record(await req.json())
    const input = record(body.input)
    let result: unknown
    if (body.action === "IMPORT_QUALITY_REPORT") {
      const snapshot = parseEbayListingQualityReportV1({
        format: input.format === "XLSX" ? "XLSX" : input.format === "JSON" ? "JSON" : "CSV",
        fileName: typeof input.fileName === "string" ? input.fileName : "quality-report",
        content: typeof input.content === "string" ? input.content : "",
        selectedWorksheet: typeof input.selectedWorksheet === "string"
          ? input.selectedWorksheet : null,
      })
      const account = getEbaySellerAccountScopeConfiguration()
      const live = await getEbayCommercialMonitorLiveReadonly({ accountKey: account.accountKey,
        accountAlias: account.accountAlias })
      const monitor = await getCommercialMonitorReadonly(
        account.accountKey ? getSupabaseAdminClient() : null,
        { accountKey: account.accountKey, accountAlias: account.accountAlias,
          configurationReason: account.reason }, live)
      const associated = associateEbayListingQualityReportV1({ snapshot,
        listings: monitor.listings.map((listing) => ({ listingKey: listing.key,
          itemId: listing.identity.itemId, sku: listing.identity.sku })) })
      result = { source: snapshot.source, parserVersion: snapshot.parserVersion,
        parserStatus: snapshot.parserStatus, fileName: snapshot.fileName,
        sourceFileFingerprint: snapshot.sourceFileFingerprint, importedAt: snapshot.importedAt,
        rowCount: snapshot.rowCount, unknownHeaders: snapshot.unknownHeaders,
        workbook: snapshot.workbook, preview: snapshot.preview,
        association: summarizeEbayListingQualityAssociationsV1(associated),
        previewRows: associated.slice(0, 20).map((row) => ({ sourceRowNumber: row.sourceRowNumber,
          associationStatus: row.associationStatus, recommendationCategory: row.recommendationCategory,
          recommendationType: row.recommendationType, benchmarkAvailable:
            row.reportedBenchmark !== null, topTenBenchmarkAvailable:
            row.topCategoryBenchmark !== null })), rawFileStored: false, remotePersistence: false,
        buyerPiiStored: false }
    } else if (body.action === "CAPTURE_LUNA") {
      result = captureLunaProductVariantV1(input as never)
    } else if (body.action === "LINK_SUPPLIER_IDENTITY") {
      result = linkSupplierToEbayIdentityV1(input as never)
    } else if (body.action === "PREPARE_LUNA_WATCHER") {
      const link = record(input.link) as LunaExactApprovedLinkV1
      result = {
        source: resolveLunaWatcherSourcePriorityV1({
          authenticatedBrowserWorkerReady: false,
        }),
        scheduleState: "READY_PENDING_DURABLE_EXACT_LINK",
        browserFallbackStatus: "REAUTH_REQUIRED_UNTIL_BROWSER_HEALTH_PROVEN",
        exactLinkPersistence: "REQUIRES_SEPARATE_REGISTRY_MUTATION_AUTHORIZATION",
        approvalPersistenceContract:
          buildLunaWatcherApprovalPersistenceContractV1(link),
        registryBusinessDataMutations: 0,
      }
    } else if (body.action === "RUN_LUNA_AUTHENTICATED_CAPTURE") {
      const link = record(input.link) as LunaExactApprovedLinkV1
      const currentCapture = await captureLunaAuthenticatedBrowserWorkerV1(link)
      const observation = evaluateLunaAuthenticatedBrowserCaptureV1({
        link, capture: currentCapture, previous: null,
      })
      result = {
        watcherVersion: observation.contractVersion,
        source: resolveLunaWatcherSourcePriorityV1({
          authenticatedBrowserWorkerReady:
            currentCapture.sourceMode === "AUTHENTICATED_WEB_SESSION" &&
            currentCapture.sessionState === "SESSION_OK",
        }),
        capture: currentCapture,
        observation,
        scheduler: scheduleLunaWatcherObservationV1({ observation,
          commercialExposureScore: Number.isFinite(Number(input.commercialExposureScore))
            ? Number(input.commercialExposureScore) : null }),
        automaticResponse: buildLunaWatcherAutomaticResponseV1({
          link, observation,
          publishedQuantity: Number.isInteger(Number(input.publishedQuantity))
            ? Number(input.publishedQuantity) : null,
        }),
        scheduleActivation: observation.sourceStatus === "SESSION_OK"
          ? "READY_PENDING_DURABLE_EXACT_LINK"
          : "BLOCKED_PENDING_AUTHENTICATED_IDENTITY_CAPTURE",
        browserFallbackRecommended: ["SOURCE_CHANGED", "VARIANT_UNPROVEN"]
          .includes(observation.sourceStatus),
        capturePersistedToBusinessTables: false,
        priorObservationAcceptedFromClient: false,
        confirmationHistorySource: "SERVER_SIDE_SCHEDULED_EVIDENCE_ONLY",
        rawSessionMaterialReceivedByClient: false,
      }
    } else if (body.action === "ASSESS_STOCK_GUARD") {
      result = assessStockGuardV2(input as never)
    } else if (body.action === "CALCULATE_ECONOMICS") {
      result = calculateCommercialEconomicsV1(input as never)
    } else if (body.action === "PREVIEW_WHATSAPP") {
      result = renderCommercialWhatsAppAlertDryRunV1(input as never)
    } else throw new Error("OPERATIONAL_READINESS_ACTION_INVALID")
    return NextResponse.json({ success: true, result, dispatchAllowed: false,
      marketplaceWrites: 0, registryBusinessDataMutations: 0, whatsappSends: 0,
      productCaseMutations: 0 })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error),
      ...(error instanceof QualityReportValidationError ? { diagnosis: error.diagnosis } : {}) },
    { status: 400 })
  }
}
