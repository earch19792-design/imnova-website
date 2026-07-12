export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  runEbayLunaOpportunityScan,
} from "@/lib/ebay/ebay-luna-demand-opportunity-gateway"
import {
  getEbayObservationPersistenceState,
  loadEbayListingObservationHistory,
  persistEbayOpportunityObservation,
} from "@/lib/ebay/ebay-luna-opportunity-observation-store"
import {
  normalizeLunaOpportunityCandidate,
} from "@/lib/ebay/ebay-luna-catalog-normalization"
import type {
  EbayListingObservation,
  LunaOpportunityCandidateInput,
} from "@/lib/ebay/ebay-luna-opportunity-types"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_LUNA_OPPORTUNITY_SCAN_FAILED"
}

function safeCandidates(value: unknown) {
  return Array.isArray(value)
    ? value.slice(0, 25).map((entry) => record(entry) as LunaOpportunityCandidateInput)
    : []
}

function safeCategoryIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && /^\d+$/.test(entry)).slice(0, 3)
    : []
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 }
    )
  }
  try {
    const body = record(await req.json())
    const candidates = safeCandidates(body.candidates)
    if (!candidates.length) {
      return NextResponse.json(
        { success: false, error: "LUNA_OPPORTUNITY_CANDIDATES_REQUIRED" },
        { status: 400 }
      )
    }
    const useStoredHistory = body.useStoredHistory === true
    const persistObservations = body.persistObservations === true
    const persistence = getEbayObservationPersistenceState()
    const historyByCandidate: Record<string, EbayListingObservation[]> = {}
    let supabase: ReturnType<typeof getSupabaseAdminClient> | null = null
    if ((useStoredHistory || persistObservations) && persistence.configured) {
      supabase = getSupabaseAdminClient()
    }
    if (useStoredHistory && supabase) {
      const since = new Date(Date.now() - 35 * 86_400_000).toISOString()
      for (const candidate of candidates.slice(0, 5)) {
        const normalized = normalizeLunaOpportunityCandidate(candidate)
        historyByCandidate[normalized.candidateKey] =
          await loadEbayListingObservationHistory(
            supabase,
            normalized.candidateKey,
            since
          )
      }
    }
    const scan = await runEbayLunaOpportunityScan({
      candidates,
      observationHistoryByCandidate: historyByCandidate,
      bestSellingCategoryIds: safeCategoryIds(body.bestSellingCategoryIds),
    })
    const persistenceResults = []
    for (const assessment of scan.rankedOpportunities) {
      persistenceResults.push(
        supabase
          ? await persistEbayOpportunityObservation(
              supabase,
              assessment,
              assessment.currentObservations,
              persistObservations
            )
          : {
              persisted: false,
              state: persistence.configured
                ? "PERSISTENCE_NOT_REQUESTED"
                : "EBAY_MARKET_OBSERVATION_WRITES_DISABLED",
            }
      )
    }
    return NextResponse.json({
      success: true,
      scan,
      persistence: {
        ...persistence,
        requested: persistObservations,
        results: persistenceResults,
      },
      safety: {
        ebayWriteUsed: false,
        supabaseWriteUsed: persistenceResults.some((result) => result.persisted),
        tokenReturned: false,
        canPublish: false,
      },
    })
  } catch (error) {
    const code = safeErrorCode(error)
    const status = code === "EBAY_READONLY_ENV_MISSING" ? 503 : 502
    return NextResponse.json({ success: false, error: code }, { status })
  }
}
