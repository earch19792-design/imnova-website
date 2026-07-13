import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  EbayListingObservation,
} from "./ebay-luna-opportunity-types.ts"
import type {
  buildEbayLunaOpportunityAssessment,
} from "./ebay-luna-demand-opportunity-engine.ts"

type Assessment = ReturnType<typeof buildEbayLunaOpportunityAssessment>

function writesEnabled() {
  return process.env.EBAY_MARKET_OBSERVATION_WRITES_ENABLED?.trim() === "true"
}

export function getEbayObservationPersistenceState() {
  return {
    configured: writesEnabled(),
    defaultWriteEnabled: false,
    requiresExplicitRequest: true,
    tables: [
      "ebay_market_listing_observations",
      "ebay_luna_opportunity_assessments",
    ],
    storesTokens: false,
    storesImages: false,
    storesRawEbayPayload: false,
  }
}

export async function loadEbayListingObservationHistory(
  supabase: SupabaseClient,
  candidateKey: string,
  sinceIso: string
): Promise<EbayListingObservation[]> {
  const { data, error } = await supabase
    .from("ebay_market_listing_observations")
    .select("candidate_key,ebay_item_id,seller_reference,observed_at,estimated_sold_quantity,total_buyer_price,identity_match_score,identity_match_type,evidence_source")
    .eq("candidate_key", candidateKey)
    .gte("observed_at", sinceIso)
    .order("observed_at", { ascending: true })
  if (error) throw new Error("EBAY_OBSERVATION_HISTORY_READ_FAILED")
  return (data ?? []).map((row) => ({
    candidateKey: row.candidate_key,
    itemId: row.ebay_item_id,
    sellerId: row.seller_reference,
    observedAt: row.observed_at,
    estimatedSoldQuantity: row.estimated_sold_quantity,
    price: row.total_buyer_price,
    shippingCost: 0,
    identityMatchScore: Number(row.identity_match_score ?? 0),
    identityMatchType: row.identity_match_type,
    evidenceSource: row.evidence_source,
  }))
}

export async function persistEbayOpportunityObservation(
  supabase: SupabaseClient,
  assessment: Assessment,
  observations: EbayListingObservation[],
  explicitlyRequested: boolean,
  options: { trustedInternalQueueRun?: boolean } = {},
) {
  const persistenceAllowed = writesEnabled() || options.trustedInternalQueueRun === true
  if (!explicitlyRequested || !persistenceAllowed) {
    return {
      persisted: false,
      state: writesEnabled()
        ? "EXPLICIT_PERSISTENCE_NOT_REQUESTED"
        : "EBAY_MARKET_OBSERVATION_WRITES_DISABLED",
    }
  }
  const observationRows = observations.map((entry) => ({
    candidate_key: entry.candidateKey,
    market_radar_product_id: assessment.candidate.marketRadarProductId,
    ebay_item_id: entry.itemId,
    seller_reference: entry.sellerId,
    observed_at: entry.observedAt,
    estimated_sold_quantity: entry.estimatedSoldQuantity,
    total_buyer_price: entry.price === null
      ? null
      : Number((entry.price + (entry.shippingCost ?? 0)).toFixed(2)),
    identity_match_score: entry.identityMatchScore,
    identity_match_type: entry.identityMatchType,
    evidence_source: entry.evidenceSource,
  }))
  if (observationRows.length) {
    const { error } = await supabase
      .from("ebay_market_listing_observations")
      .upsert(observationRows, {
        onConflict: "candidate_key,ebay_item_id,observed_at",
        ignoreDuplicates: true,
      })
    if (error) throw new Error("EBAY_OBSERVATION_PERSIST_FAILED")
  }
  const summary = {
    decision: assessment.decision,
    market: assessment.market,
    economics: assessment.economics,
    expectedMonthlyOpportunity: assessment.expectedMonthlyOpportunity,
    canProceedToListingPackage: assessment.canProceedToListingPackage,
    canPublish: false,
  }
  const { error } = await supabase
    .from("ebay_luna_opportunity_assessments")
    .insert({
      candidate_key: assessment.candidate.candidateKey,
      market_radar_product_id: assessment.candidate.marketRadarProductId,
      engine_version: assessment.engineVersion,
      decision: assessment.decision,
      opportunity_score: assessment.scores.opportunityScore,
      demand_score: assessment.scores.demandScore,
      economics_score: assessment.scores.economicsScore,
      identity_score: assessment.scores.identityScore,
      evidence_basis: assessment.market.rotationEvidenceStatus,
      hard_gates: assessment.hardGates,
      evidence_guards: assessment.evidenceGuards,
      assessment_summary: summary,
    })
  if (error) throw new Error("EBAY_OPPORTUNITY_ASSESSMENT_PERSIST_FAILED")
  return { persisted: true, state: "PERSISTED_INTERNAL_OBSERVATION_ONLY" }
}
