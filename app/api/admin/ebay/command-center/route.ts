export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getEbayFirstLunaQueueDashboard } from "@/lib/ebay/ebay-first-luna-scan-service"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

const OPEN_REVIEW_STATUSES = ["in_progress", "blocked", "ready_for_package"]
const REVIEW_STEPS = ["luna", "ebay", "economics", "listing", "review"]

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function strings(value: unknown, limit = 40) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
    : []
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : "COMMAND_CENTER_REQUEST_FAILED"
}

async function opportunity(supabase: ReturnType<typeof getSupabaseAdminClient>, opportunityId: string) {
  const { data, error } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", opportunityId)
    .maybeSingle()
  if (error || !data) throw new Error("COMMAND_CENTER_OPPORTUNITY_NOT_FOUND")
  return data as Record<string, unknown>
}

function buildInitialPackage(row: Record<string, unknown>) {
  const assessment = object(row.assessment)
  const intelligence = object(assessment.listingIntelligencePackage)
  const candidate = object(assessment.candidate)
  const category = object(intelligence.categoryRecommendation)
  const keywordStructure = object(row.keyword_structure)
  const recommended = object(intelligence.titleStrategy)
  const economics = object(assessment.economics)
  const itemSpecifics = object(intelligence.itemSpecifics)
  const imageUrls = strings(candidate.imageUrls, 24)
  return {
    title: String(
      intelligence.recommendedTitle
      ?? recommended.titleFormula
      ?? keywordStructure.titleFormula
      ?? row.product_title
      ?? "",
    ).slice(0, 80),
    categoryId: category.categoryId ?? null,
    categoryName: category.categoryName ?? null,
    aspects: object(itemSpecifics.supplierConfirmed),
    description: String(candidate.description ?? ""),
    imageUrls,
    pricing: {
      currency: "USD",
      supplierCost: row.supplier_price ?? null,
      targetPrice: row.median_total_buyer_price ?? economics.conservativeTotalBuyerPrice ?? null,
      estimatedNetProfit: row.estimated_net_profit ?? economics.estimatedNetProfit ?? null,
    },
    shipping: object(intelligence.shippingRecommendation),
    evidenceSnapshot: {
      opportunityScore: row.opportunity_score ?? 0,
      demandScore: row.demand_score ?? 0,
      economicsScore: row.economics_score ?? 0,
      identityScore: row.identity_score ?? 0,
      hardGates: strings(row.hard_gates),
      evidenceGuards: strings(row.evidence_guards),
      assessment,
    },
  }
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (!validation.userId) return NextResponse.json(
    { success: false, error: "COMMAND_CENTER_REVIEWER_REQUIRED" },
    { status: 403 },
  )
  try {
    const supabase = getSupabaseAdminClient()
    const reviewer = validation.userId
    const url = new URL(req.url)
    const opportunityId = url.searchParams.get("opportunity") ?? ""
    const [dashboard, sessions, packages, alertOutbox] = await Promise.all([
      getEbayFirstLunaQueueDashboard(supabase),
      supabase
        .from("ebay_command_center_reviews")
        .select("*")
        .eq("user_id", reviewer)
        .in("status", OPEN_REVIEW_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase
        .from("ebay_listing_packages")
        .select("*")
        .eq("created_by", reviewer)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase
        .from("ebay_seller_alert_outbox")
        .select("id,alert_type,priority,entity_type,entity_id,candidate_key,status,payload,due_at,created_at,delivered_at")
        .in("status", ["pending", "leased", "failed", "dead_letter"])
        .order("created_at", { ascending: false })
        .limit(50),
    ])
    const firstError = sessions.error ?? packages.error ?? alertOutbox.error
    if (firstError) throw new Error("COMMAND_CENTER_STATE_READ_FAILED")
    const selectedOpportunity = opportunityId ? await opportunity(supabase, opportunityId) : null
    return NextResponse.json({
      success: true,
      dashboard,
      reviews: sessions.data ?? [],
      listingPackages: packages.data ?? [],
      alerts: {
        activeListingRisks: dashboard.activeListingRisks,
        outbox: alertOutbox.data ?? [],
      },
      selectedOpportunity,
      refreshedAt: new Date().toISOString(),
      safety: { ebayReadOnly: true, ebayWriteUsed: false, canPublish: false },
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: errorCode(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (!validation.userId) return NextResponse.json(
    { success: false, error: "COMMAND_CENTER_REVIEWER_REQUIRED" },
    { status: 403 },
  )
  try {
    const body = object(await req.json())
    const action = typeof body.action === "string" ? body.action : ""
    const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : ""
    const candidateKey = typeof body.candidateKey === "string" ? body.candidateKey.slice(0, 300) : ""
    if (!/^[0-9a-f-]{36}$/i.test(opportunityId) || !candidateKey) {
      return NextResponse.json({ success: false, error: "COMMAND_CENTER_CANDIDATE_REQUIRED" }, { status: 400 })
    }
    const supabase = getSupabaseAdminClient()
    const reviewer = validation.userId
    const sourceOpportunity = await opportunity(supabase, opportunityId)
    if (sourceOpportunity.candidate_key !== candidateKey) {
      return NextResponse.json(
        { success: false, error: "COMMAND_CENTER_CANDIDATE_MISMATCH" },
        { status: 409 },
      )
    }

    if (action === "save_review") {
      const currentStep = REVIEW_STEPS.includes(String(body.currentStep)) ? String(body.currentStep) : "luna"
      const status = OPEN_REVIEW_STATUSES.includes(String(body.status)) ? String(body.status) : "in_progress"
      const { data: existing, error: readError } = await supabase
        .from("ebay_command_center_reviews")
        .select("*")
        .eq("user_id", reviewer)
        .eq("candidate_key", candidateKey)
        .maybeSingle()
      if (readError) throw new Error("COMMAND_CENTER_REVIEW_READ_FAILED")
      const nextState = { ...object(existing?.form_data), ...object(body.formData) }
      const values = {
        opportunity_id: opportunityId,
        candidate_key: candidateKey,
        status,
        current_step: currentStep,
        form_data: {
          ...nextState,
          confirmedFields: strings(body.confirmedFields),
          blockers: strings(body.blockers),
        },
        updated_at: new Date().toISOString(),
      }
      const result = existing?.id
        ? await supabase.from("ebay_command_center_reviews").update(values).eq("id", existing.id).select("*").single()
        : await supabase.from("ebay_command_center_reviews").insert({ ...values, user_id: reviewer }).select("*").single()
      if (result.error) throw new Error("COMMAND_CENTER_REVIEW_SAVE_FAILED")
      return NextResponse.json({ success: true, review: result.data, savedAt: new Date().toISOString(), safety: { ebayWriteUsed: false, canPublish: false } })
    }

    if (action === "prepare_package") {
      const { data: existing, error: readError } = await supabase
        .from("ebay_listing_packages")
        .select("*")
        .eq("opportunity_id", opportunityId)
        .maybeSingle()
      if (readError) throw new Error("COMMAND_CENTER_PACKAGE_READ_FAILED")
      if (existing) return NextResponse.json({ success: true, listingPackage: existing, created: false })
      const seed = buildInitialPackage(sourceOpportunity)
      const { data, error } = await supabase.from("ebay_listing_packages").insert({
        opportunity_id: opportunityId,
        candidate_key: candidateKey,
        status: "draft",
        package_data: seed,
        readiness: 0,
        source_observed_at: sourceOpportunity.last_scanned_at ?? new Date().toISOString(),
        created_by: reviewer,
      }).select("*").single()
      if (error) throw new Error("COMMAND_CENTER_PACKAGE_CREATE_FAILED")
      return NextResponse.json({ success: true, listingPackage: data, created: true, safety: { ebayWriteUsed: false, canPublish: false } })
    }

    if (action === "save_package") {
      const packageId = typeof body.packageId === "string" ? body.packageId : ""
      if (!/^[0-9a-f-]{36}$/i.test(packageId)) {
        return NextResponse.json({ success: false, error: "COMMAND_CENTER_PACKAGE_REQUIRED" }, { status: 400 })
      }
      const form = object(body.packageData)
      const title = String(form.title ?? "").trim().slice(0, 80)
      const status = body.markReady === true ? "ready_for_review" : "draft"
      const sourceGates = [...strings(sourceOpportunity.hard_gates), ...strings(sourceOpportunity.evidence_guards)]
      const completeFields = [title, form.categoryId, String(form.description ?? ""), strings(form.imageUrls, 24)[0], object(form.pricing).targetPrice]
      const missingFields = [
        ...(!title ? ["TITLE_REQUIRED"] : []),
        ...(!form.categoryId ? ["CATEGORY_REQUIRED"] : []),
        ...(!String(form.description ?? "").trim() ? ["DESCRIPTION_REQUIRED"] : []),
        ...(!strings(form.imageUrls, 24).length ? ["IMAGE_REQUIRED"] : []),
        ...(!(Number(object(form.pricing).targetPrice) > 0) ? ["PRICE_REQUIRED"] : []),
      ]
      if (body.markReady === true && (sourceGates.length || missingFields.length)) {
        return NextResponse.json({
          success: false,
          error: "COMMAND_CENTER_PACKAGE_GATES_PENDING",
          blockers: [...sourceGates, ...missingFields],
        }, { status: 409 })
      }
      const readiness = Math.round((completeFields.filter(Boolean).length / completeFields.length) * 100)
      const values = {
        status,
        package_data: {
          title,
          categoryId: form.categoryId || null,
          categoryName: form.categoryName || null,
          aspects: object(form.aspects),
          description: String(form.description ?? "").slice(0, 100_000),
          imageUrls: strings(form.imageUrls, 24),
          pricing: object(form.pricing),
          shipping: object(form.shipping),
        },
        readiness,
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from("ebay_listing_packages")
        .update(values)
        .eq("id", packageId)
        .eq("opportunity_id", opportunityId)
        .eq("candidate_key", candidateKey)
        .select("*")
        .single()
      if (error) throw new Error("COMMAND_CENTER_PACKAGE_SAVE_FAILED")
      return NextResponse.json({ success: true, listingPackage: data, savedAt: new Date().toISOString(), safety: { ebayWriteUsed: false, canPublish: false } })
    }

    return NextResponse.json({ success: false, error: "COMMAND_CENTER_ACTION_INVALID" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ success: false, error: errorCode(error) }, { status: 502 })
  }
}
