import type { CommercialMonitorGetDto } from
  "./commercial-monitor-readonly-contract"
import {
  preflightCertifiedOosExecutionV1,
  type CertifiedOosExecutionPreflightV1,
// @ts-ignore -- Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-certified-oos-execution-adapter-v1.ts"

export const AUTO_CERTIFIED_OOS_END_LISTING_VERSION =
  "AUTO_CERTIFIED_OOS_END_LISTING_V1" as const

type ProtectionResult = Readonly<{
  status: "PROTECTED_VERIFIED" | "ALREADY_PROTECTED"
  itemId: string
  sku: string
  marketplaceOperation: CertifiedOosExecutionPreflightV1["marketplaceOperation"]
  ebayWriteCount: 0 | 1
  officialBefore: unknown
  officialAfter: unknown
}>

export async function runAutomaticCertifiedOosProtectionV1(input: Readonly<{
  monitor: CommercialMonitorGetDto
  maxMarketplaceWrites?: number
  allowedItemIds?: readonly string[]
  executor?: (preflight: CertifiedOosExecutionPreflightV1) =>
    Promise<ProtectionResult>
}>) {
  const maximumWrites = Math.max(0, Math.min(
    Math.trunc(input.maxMarketplaceWrites ?? 1),
    1,
  ))
  const allowedItemIds = input.allowedItemIds
    ? new Set(input.allowedItemIds) : null
  const preflights = input.monitor.listings
    .filter((listing) => !allowedItemIds ||
      allowedItemIds.has(listing.identity.itemId))
    .map((listing) => preflightCertifiedOosExecutionV1({
      monitor: input.monitor,
      targetItemId: listing.identity.itemId,
      targetSku: listing.identity.sku ?? "",
      automationAuthorized: true,
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId))
  const eligible = preflights.filter((preflight) =>
    preflight.executionEligible && preflight.mutationRequired)
  const executor = input.executor ?? (async (preflight) => {
    const service = await import("./ebay-commercial-improvement-action-service")
    return service.applyAutomaticCertifiedOosProtectionV1({
      preflight,
      automationAuthorization:
        service.SELLER_OS_AUTOMATIC_CERTIFIED_OOS_AUTHORIZATION_V1,
    })
  })
  const executions: ProtectionResult[] = []
  let writeCount = 0
  for (const preflight of eligible) {
    if (writeCount >= maximumWrites) break
    const result = await executor(preflight)
    executions.push(result)
    writeCount += result.ebayWriteCount
  }
  return Object.freeze({
    contractVersion: AUTO_CERTIFIED_OOS_END_LISTING_VERSION,
    status: executions.some((result) => result.status === "PROTECTED_VERIFIED")
      ? "PROTECTED_VERIFIED" as const
      : eligible.length === 0
        ? "NO_ELIGIBLE_LISTINGS" as const
        : "ALREADY_PROTECTED" as const,
    listingsEvaluated: preflights.length,
    eligibleItemIds: Object.freeze(eligible.map((entry) => entry.itemId)),
    blockedCandidates: Object.freeze(preflights
      .filter((entry) => entry.status === "BLOCKED")
      .map((entry) => Object.freeze({ itemId: entry.itemId, sku: entry.sku,
        blockerCodes: entry.blockerCodes }))),
    marketplaceSafetyGate: Object.freeze({
      status: input.monitor.liveCertification.status,
      marketplaceId: input.monitor.liveCertification.marketplaceId,
      account: input.monitor.liveCertification.account,
      oauth: input.monitor.liveCertification.oauth,
      marketplaceWrites:
        input.monitor.liveCertification.safety.marketplaceWrites,
    }),
    deferredEligibleItemIds: Object.freeze(
      eligible.slice(executions.length).map((entry) => entry.itemId),
    ),
    executions: Object.freeze(executions),
    ebayWriteCount: writeCount,
    maximumMarketplaceWritesPerRun: maximumWrites,
    humanInterventionCount: 0 as const,
    browserSessionRequired: false as const,
    marketplaceOperation: "EndFixedPriceItem" as const,
    endingReason: "NotAvailable" as const,
  })
}
