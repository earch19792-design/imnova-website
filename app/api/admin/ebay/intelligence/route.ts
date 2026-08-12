export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getCommercialMonitorReadonly } from
  "@/lib/ebay/commercial-monitor-readonly-service"
import { getEbayCommercialMonitorLiveReadonly } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { buildProactiveExceptionQueueV1, evaluateReplaceKillIntelligenceV1,
  selectMaterialPrioritiesV2 } from
  "@/lib/ebay/ebay-seller-os-portfolio-intelligence-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return NextResponse.json({ success: false,
    error: auth.error ?? "admin_forbidden" }, { status: auth.status || 403 })
  const account = getEbaySellerAccountScopeConfiguration()
  const live = await getEbayCommercialMonitorLiveReadonly({ accountKey: account.accountKey,
    accountAlias: account.accountAlias })
  const monitor = await getCommercialMonitorReadonly(
    account.accountKey ? getSupabaseAdminClient() : null,
    { accountKey: account.accountKey, accountAlias: account.accountAlias,
      configurationReason: account.reason }, live)
  const queue = buildProactiveExceptionQueueV1({ monitor, maximumEntries: 250 })
  const listingByKey = new Map(monitor.listings.map((listing) => [listing.key, listing]))
  const decisionRows = monitor.backend.decisions.map((decision) => {
    const listing = listingByKey.get(decision.listingKey) ?? null
    const replacement = listing ? evaluateReplaceKillIntelligenceV1({ listing, decision }) : null
    return { itemId: listing?.identity.itemId ?? null, title: listing?.identity.title ?? null,
      ...decision, replacement }
  })
  const experimentRows = monitor.listings.flatMap((listing) => listing.experiment.status === "AVAILABLE"
    ? [{ itemId: listing.identity.itemId, title: listing.identity.title,
      experimentId: listing.experiment.experimentId,
      lifecycleState: listing.experiment.lifecycleState,
      testedVariable: listing.experiment.testedVariable,
      frozenVariables: listing.experiment.frozenVariables,
      nextReviewAt: listing.experiment.nextReviewAt ?? null,
      checkpointGate: listing.experiment.checkpointGate,
      currentEvidenceValue: listing.experiment.currentEvidenceValue ?? null,
      minimumEvidenceValue: listing.experiment.minimumEvidenceValue ?? null,
      externalSignalCodes: listing.experiment.externalSignalCodes ?? [],
      outcomeProvenance: listing.experiment.source,
      doNotTouch: listing.experiment.lifecycleState === "RUNNING",
      hardOverride: decisionRows.find((row) => row.listingKey === listing.key)
        ?.reasonCodes.includes("HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW") ?? false }]
    : [])
  return NextResponse.json({ success: true, generatedAt: monitor.generatedAt,
    decisions: {
      taxonomyVersion: "DECISION_TAXONOMY_V2_2026_08_12",
      todaysPriorities: selectMaterialPrioritiesV2(queue, 20),
      exceptionQueue: queue,
      criticalNow: queue.filter((row) => row.classification === "CRITICAL_OPERATIONAL"),
      actionable: queue.filter((row) => row.classification === "ACTIONABLE_COMMERCIAL"),
      researchOrEvidence: queue.filter((row) => row.classification === "RESEARCH_OR_EVIDENCE"),
      capabilityBlockers: queue.filter((row) => row.classification === "CAPABILITY_BLOCKED"),
      commercialInterventions: queue.filter((row) =>
        row.classification === "ACTIONABLE_COMMERCIAL"),
      humanReview: queue.filter((row) => row.classification === "HUMAN_REVIEW"),
      doNotTouch: queue.filter((row) => row.classification === "DO_NOT_TOUCH"),
      replacementCandidates: decisionRows.filter((row) => row.replacement &&
        ["REPLACE_CANDIDATE", "KILL_REVIEW"].includes(row.replacement.status)),
      waiting: queue.filter((row) => row.classification === "WAIT"),
      healthy: queue.filter((row) => row.classification === "HEALTHY"),
      rows: decisionRows,
    },
    experiments: {
      active: experimentRows.filter((row) => row.lifecycleState === "RUNNING"),
      doNotTouch: experimentRows.filter((row) => row.doNotTouch),
      readyToEvaluate: experimentRows.filter((row) => row.lifecycleState === "READY_TO_EVALUATE"),
      softSignals: decisionRows.filter((row) => (row.externalSignalCount ?? 0) > 0 &&
        !row.reasonCodes.includes("HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW")),
      hardOverrides: experimentRows.filter((row) => row.hardOverride), rows: experimentRows,
    },
    learning: {
      status: monitor.learning.status,
      storedLearningStatus: monitor.learning.categoryAdjustments.length ? "AVAILABLE" : "NONE",
      observedSource: monitor.learning.categoryAdjustments.length ? monitor.learning.source : null,
      eligibleSources: ["EXPERIMENT_OUTCOME", "LISTING_OUTCOME", "FAMILY_OUTCOME",
        "CATEGORY_OUTCOME"],
      evidenceTimestamp: monitor.learning.evidenceTimestamp,
      listingLevelLearnings: [], familyCandidates: [],
      categoryCandidates: monitor.learning.categoryAdjustments,
      transferState: monitor.learning.categoryAdjustments.length
        ? "CATEGORY_CANDIDATES_REQUIRE_ELIGIBLE_EVIDENCE" : "INSUFFICIENT_FOR_GENERALIZATION",
      limitationCode: monitor.learning.limitationCode,
      universalRuleAllowed: false, syntheticLearning: false,
    },
    safety: { mode: "READ_ONLY", marketplaceWrites: 0, inventoryWrites: 0,
      registryWrites: 0, productCaseMutations: 0, buyerPiiIncluded: false } })
}
