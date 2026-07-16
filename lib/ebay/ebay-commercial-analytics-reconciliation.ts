import { getComparableEbayTrafficAnalytics } from "./ebay-commercial-readers"
import {
  calculateSellerHubCtr,
  classifySellerHubComparison,
  closedEbayAnalyticsWindow,
  type ComparableEbayTrafficAnalytics,
  type SellerHubEvidence,
} from "./ebay-commercial-analytics-domain"

export const EBAY_COMMERCIAL_PILOT_LISTING_ID = "366543596425"

function sanitizedReportAudit(report: ComparableEbayTrafficAnalytics) {
  const metrics = report.observations.map((row) => ({
    listingId: row.listingId,
    impressions: row.applicability.impressions ? row.impressions : null,
    views: row.applicability.views ? row.views : null,
    transactions: row.applicability.transactions ? row.transactions : null,
    ctr: row.applicability.ctr ? row.ctr : null,
    salesConversionRate: row.applicability.salesConversionRate
      ? row.salesConversionRate
      : null,
    revenue: null,
  }))
  return {
    requestedListingIds: report.requestedListingIds,
    returnedListingDimensions: report.returnedListingDimensions,
    matchedListingIds: report.matchedListingIds,
    unmatchedRequestedListingIds: report.unmatchedRequestedListingIds,
    unexpectedDimensions: report.unexpectedDimensions,
    queryDimension: report.queryDimension,
    queryTimeZone: report.queryTimeZone,
    windowStart: report.windowStart,
    windowEnd: report.windowEnd,
    reportStartDate: report.reportCoverage.reportStartDay,
    reportEndDate: report.reportCoverage.reportEndDay,
    lastUpdatedDate: report.reportCoverage.lastUpdatedDay,
    completenessStatus: report.completenessStatus,
    dataFreshnessStatus: report.dataFreshnessStatus,
    warnings: report.reportCoverage.warnings,
    metrics,
  }
}

export async function compareEbayCommercialAnalyticsWithSellerHub(input: {
  listingId?: string
  now?: Date
  evidence?: SellerHubEvidence
}) {
  const listingId = input.listingId ?? EBAY_COMMERCIAL_PILOT_LISTING_ID
  if (listingId !== EBAY_COMMERCIAL_PILOT_LISTING_ID) {
    throw new Error("EBAY_ANALYTICS_COMPARISON_LISTING_NOT_ALLOWED")
  }
  const evidence = input.evidence ?? {
    impressions: 18,
    views: 1,
    transactions: 0,
    ctr: 5.6,
    scope: "LISTING" as const,
  }
  const now = input.now ?? new Date()
  const operationalWindow = closedEbayAnalyticsWindow(now, 7)
  const comparisonWindow = closedEbayAnalyticsWindow(now, 90)
  const [operational, comparison] = await Promise.all([
    getComparableEbayTrafficAnalytics({
      listingIds: [listingId],
      dateFrom: operationalWindow.dateFrom,
      dateTo: operationalWindow.dateTo,
      timeZone: "UTC",
    }),
    getComparableEbayTrafficAnalytics({
      listingIds: [listingId],
      dateFrom: comparisonWindow.dateFrom,
      dateTo: comparisonWindow.dateTo,
      timeZone: "UTC",
    }),
  ])
  const classification = classifySellerHubComparison({
    listingId,
    evidence,
    operational,
    comparison,
  })
  return {
    classification,
    explanation: classification === "MATCH_DIFFERENT_WINDOW"
      ? "La ventana diagnóstica amplia coincide con Seller Hub; la ventana operativa de 7 días cerrados tiene otro alcance temporal."
      : classification === "MATCH_EXACT"
        ? "La ventana operativa coincide con la evidencia de Seller Hub."
        : classification === "REPORT_NOT_UPDATED_YET"
          ? "eBay todavía no ha consolidado la fecha final solicitada."
          : classification === "LISTING_DIMENSION_MISMATCH"
            ? "La respuesta oficial no contiene una fila LISTING emparejada con el Item ID solicitado."
            : classification === "METRIC_MAPPING_ERROR"
              ? "Las métricas oficiales devueltas no conservan la relación esperada entre vistas, impresiones y CTR para el mismo alcance."
              : "Los metadatos oficiales disponibles no bastan para atribuir la diferencia a una sola causa.",
    sellerHubEvidence: {
      ...evidence,
      calculatedCtr: calculateSellerHubCtr(evidence.views, evidence.impressions),
    },
    operational: sanitizedReportAudit(operational),
    comparison: sanitizedReportAudit(comparison),
    safety: {
      persistencePerformed: false,
      commercialRulesEvaluated: false,
      alertsGenerated: 0,
      fulfillmentTasksCreated: 0,
      whatsappDelivered: 0,
      ebayWrites: 0,
      rawPayloadReturned: false,
      buyerPiiReturned: false,
    },
  }
}
