export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import {
  createEbayUnpublishedOffer,
  createOrReplaceEbayDraftInventoryItem,
  ebayDraftOnlyRuntimeStatus,
  preflightEbayDraftDependencies,
  preflightEbayDraftSkuCollision,
  sanitizeEbayOfferId,
} from "@/lib/ebay/ebay-draft-only-gateway"
import {
  approvalExpiresAt,
  buildEbayDraftOnlyPayload,
  EBAY_DRAFT_ONLY_APPROVAL_PHRASE,
  evaluateEbayDraftOnlyReadiness,
  hashEbayDraftOnlyPayload,
  type JsonRecord,
} from "@/lib/ebay/ebay-draft-only-readiness"
import { enqueueSellerWhatsAppAlert } from "@/lib/ebay/ebay-seller-whatsapp-alerts"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function uuid(value: unknown) {
  const parsed = text(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)
    ? parsed
    : null
}

function idempotencyKey(value: unknown) {
  const parsed = text(value)
  return /^[A-Za-z0-9._:-]{8,120}$/.test(parsed) ? parsed : null
}

function errorCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+(?:_[0-9]{3})?$/.test(value)
    ? value
    : "EBAY_DRAFT_ONLY_REQUEST_FAILED"
}

function configurationFromApprovedPayload(payload: JsonRecord) {
  const inventory = record(payload.inventoryItemPayload)
  const availability = record(record(inventory.availability).shipToLocationAvailability)
  const offer = record(payload.offerPayload)
  const compliance = record(payload.compliance)
  return {
    sku: payload.sku,
    quantity: availability.quantity,
    condition: inventory.condition,
    packageWeightAndSize: inventory.packageWeightAndSize,
    merchantLocationKey: offer.merchantLocationKey,
    businessPolicies: offer.listingPolicies,
    imageAuthorization: compliance.imageAuthorization,
    aspectValidation: compliance.aspectValidation,
    skuCollisionCheck: compliance.skuCollisionCheck,
  }
}

async function loadPackageContext(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  packageId: string,
  actorUserId: string,
  sku: string,
  excludeApprovalId?: string,
) {
  if (sku && !/^[A-Za-z0-9._-]{1,50}$/.test(sku)) {
    throw new Error("EBAY_DRAFT_ONLY_SKU_INVALID")
  }
  const { data: listingPackage, error: packageError } = await supabase
    .from("ebay_listing_packages")
    .select("*")
    .eq("id", packageId)
    .eq("created_by", actorUserId)
    .maybeSingle()
  if (packageError || !listingPackage) throw new Error("EBAY_DRAFT_ONLY_PACKAGE_NOT_FOUND")
  const { data: opportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("*")
    .eq("id", listingPackage.opportunity_id)
    .maybeSingle()
  if (opportunityError || !opportunity) throw new Error("EBAY_DRAFT_ONLY_OPPORTUNITY_NOT_FOUND")
  const ebaySkuQuery = sku
    ? supabase.from("ebay_active_listings").select("id").eq("ebay_sku", sku).neq("listing_status", "ended").limit(1)
    : Promise.resolve({ data: [], error: null })
  const supplierSkuQuery = sku
    ? supabase.from("ebay_active_listings").select("id").eq("supplier_sku", sku).neq("listing_status", "ended").limit(1)
    : Promise.resolve({ data: [], error: null })
  let ledgerQuery = supabase
    .from("ebay_draft_only_execution_ledger")
    .select("id")
    .eq("target", "SANDBOX")
    .eq("sku", sku || "__missing__")
    .neq("phase", "terminal_failure")
    .limit(1)
  if (excludeApprovalId) ledgerQuery = ledgerQuery.neq("approval_id", excludeApprovalId)
  const [ebaySkuResult, supplierSkuResult, ledgerResult] = await Promise.all([
    ebaySkuQuery,
    supplierSkuQuery,
    ledgerQuery,
  ])
  if (ebaySkuResult.error || supplierSkuResult.error || ledgerResult.error) throw new Error("EBAY_DRAFT_ONLY_COLLISION_READ_FAILED")
  return {
    listingPackage: listingPackage as JsonRecord,
    opportunity: opportunity as JsonRecord,
    activeSkuCollision: Boolean(ebaySkuResult.data?.length || supplierSkuResult.data?.length),
    ledgerSkuCollision: Boolean(ledgerResult.data?.length),
  }
}

function serverApprovedConfiguration(
  raw: JsonRecord,
  listingPackage: JsonRecord,
  opportunity: JsonRecord,
  actor: string,
  now: Date,
  imagesConfirmed: boolean,
) {
  const packageData = record(listingPackage.package_data)
  const images = Array.isArray(packageData.imageUrls)
    ? packageData.imageUrls.filter((item): item is string => typeof item === "string")
    : []
  const assessment = record(opportunity.assessment)
  const intelligence = record(assessment.listingIntelligencePackage)
  const category = record(intelligence.categoryRecommendation)
  const requiredAspects = Array.isArray(category.requiredAspects)
    ? category.requiredAspects.map((item) => text(record(item).name)).filter(Boolean)
    : []
  const requestedAuthorization = record(raw.imageAuthorization)
  const packageCategoryId = text(packageData.categoryId)
  const taxonomyConfirmed = text(category.categoryId) === packageCategoryId
    && text(category.taxonomyStatus) === "AVAILABLE"
  return {
    sku: raw.sku,
    quantity: raw.quantity,
    condition: raw.condition,
    merchantLocationKey: raw.merchantLocationKey,
    businessPolicies: raw.businessPolicies,
    packageWeightAndSize: raw.packageWeightAndSize,
    imageAuthorization: {
      approved: imagesConfirmed,
      approvedAt: now.toISOString(),
      approvedBy: actor,
      approvedImageUrls: images,
      rightsBasis: requestedAuthorization.rightsBasis,
      source: requestedAuthorization.source,
    },
    aspectValidation: {
      validated: taxonomyConfirmed,
      validatedAt: now.toISOString(),
      categoryId: packageCategoryId,
      requiredAspects,
      source: "opportunity.assessment.listingIntelligencePackage.categoryRecommendation",
    },
    skuCollisionCheck: {
      sku: raw.sku,
      serverPreflightRequiredAtExecution: true,
    },
  }
}

function jsonError(error: unknown, status = 502, blockers?: string[]) {
  return NextResponse.json({
    success: false,
    error: errorCode(error),
    ...(blockers ? { blockers } : {}),
    safety: { target: "SANDBOX", canPublish: false },
  }, { status })
}

async function enqueueDraftFailure(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  approval: JsonRecord,
  context: { listingPackage: JsonRecord; opportunity: JsonRecord },
  code: string,
  terminalFailure: boolean,
) {
  await enqueueSellerWhatsAppAlert(supabase, {
    alertType: "draft_failure",
    entityType: "ebay_listing_package",
    entityId: text(approval.listing_package_id),
    candidateKey: text(context.listingPackage.candidate_key),
    title: text(context.opportunity.product_title) || "Draft eBay",
    summary: `El draft no publicado quedó detenido: ${code}. No se llamó a publishOffer.`,
    mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
    facts: { terminalFailure },
  }).catch(() => undefined)
}

async function authenticate(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return {
    response: jsonError(new Error(validation.error ?? "ADMIN_FORBIDDEN"), validation.status || 403),
    actor: null,
  }
  if (!validation.userId) return {
    response: jsonError(new Error("EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED"), 403),
    actor: null,
  }
  return { response: null, actor: validation.userId }
}

export async function GET(req: Request) {
  const auth = await authenticate(req)
  if (auth.response) return auth.response
  if (!auth.actor) return jsonError(new Error("EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED"), 403)
  const packageId = uuid(new URL(req.url).searchParams.get("packageId"))
  if (!packageId) return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_REQUIRED"), 400)
  try {
    const supabase = getSupabaseAdminClient()
    const { data: latestApproval, error: approvalError } = await supabase
      .from("ebay_draft_only_approvals")
      .select("id,status,payload_hash,approved_at,expires_at,consumed_at,revoked_at,approved_payload")
      .eq("listing_package_id", packageId)
      .eq("actor_user_id", auth.actor)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (approvalError) throw new Error("EBAY_DRAFT_ONLY_APPROVAL_READ_FAILED")
    const approvedPayload = record(latestApproval?.approved_payload)
    const initialContext = await loadPackageContext(
      supabase,
      packageId,
      auth.actor,
      "",
      latestApproval?.id,
    )
    const packageConfig = record(initialContext.listingPackage.package_data).draftConfiguration
    const draftConfiguration = latestApproval
      ? configurationFromApprovedPayload(approvedPayload)
      : record(packageConfig)
    const sku = text(record(draftConfiguration).sku)
    const context = sku
      ? await loadPackageContext(supabase, packageId, auth.actor, sku, latestApproval?.id)
      : initialContext
    const readiness = evaluateEbayDraftOnlyReadiness({ ...context, draftConfiguration: record(draftConfiguration) })
    const { data: ledger, error: ledgerError } = latestApproval?.id
      ? await supabase
        .from("ebay_draft_only_execution_ledger")
        .select("id,phase,sku,target,offer_id,completed_at,last_error_code,updated_at")
        .eq("approval_id", latestApproval.id)
        .maybeSingle()
      : { data: null, error: null }
    if (ledgerError) throw new Error("EBAY_DRAFT_ONLY_LEDGER_READ_FAILED")
    return NextResponse.json({
      success: true,
      readiness,
      approval: latestApproval ? { ...latestApproval, approved_payload: undefined } : null,
      execution: ledger,
      runtime: ebayDraftOnlyRuntimeStatus(),
      approvalRequirements: {
        exactPhrase: EBAY_DRAFT_ONLY_APPROVAL_PHRASE,
        oneTime: true,
        expires: true,
        serverDerivedEvidence: [
          "image approval actor and timestamp",
          "approved URLs from the saved package",
          "category and required aspects from the opportunity taxonomy snapshot",
          "live eBay SKU absence immediately before the first PUT",
        ],
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(req: Request) {
  const auth = await authenticate(req)
  if (auth.response) return auth.response
  if (!auth.actor) return jsonError(new Error("EBAY_DRAFT_ONLY_HUMAN_ADMIN_REQUIRED"), 403)
  let body: JsonRecord
  try {
    body = record(await req.json())
  } catch {
    return jsonError(new Error("EBAY_DRAFT_ONLY_JSON_INVALID"), 400)
  }
  const action = text(body.action)
  try {
    if (action === "preview") return previewDraft(body, auth.actor)
    if (action === "approve") return approveDraft(body, auth.actor)
    if (action === "execute") return executeDraft(body, auth.actor)
    if (action === "revoke") return revokeApproval(body, auth.actor)
    return jsonError(new Error("EBAY_DRAFT_ONLY_ACTION_INVALID"), 400)
  } catch (error) {
    return jsonError(error)
  }
}

async function revokeApproval(body: JsonRecord, actor: string) {
  const approvalId = uuid(body.approvalId)
  if (!approvalId) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_REQUIRED"), 400)
  const now = new Date().toISOString()
  const supabase = getSupabaseAdminClient()
  const { data, error } = await supabase
    .from("ebay_draft_only_approvals")
    .update({ status: "revoked", revoked_at: now, updated_at: now })
    .eq("id", approvalId)
    .eq("actor_user_id", actor)
    .eq("status", "approved")
    .select("id,status,revoked_at")
    .maybeSingle()
  if (error || !data) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_NOT_REVOCABLE"), 409)
  }
  return NextResponse.json({
    success: true,
    approval: data,
    safety: { ebayWriteUsed: false, canPublish: false, target: "SANDBOX" },
  })
}

async function previewDraft(body: JsonRecord, actor: string) {
  const packageId = uuid(body.packageId)
  if (!packageId) return jsonError(new Error("EBAY_DRAFT_ONLY_PACKAGE_REQUIRED"), 400)
  const requestedConfiguration = record(body.draftConfiguration)
  const supabase = getSupabaseAdminClient()
  const context = await loadPackageContext(
    supabase,
    packageId,
    actor,
    text(requestedConfiguration.sku),
  )
  const now = new Date()
  const draftConfiguration = serverApprovedConfiguration(
    requestedConfiguration,
    context.listingPackage,
    context.opportunity,
    actor,
    now,
    body.confirmImagesAuthorized === true,
  )
  const readiness = evaluateEbayDraftOnlyReadiness({
    ...context,
    draftConfiguration,
  })
  return NextResponse.json({
    success: true,
    readiness,
    runtime: ebayDraftOnlyRuntimeStatus(),
    safety: { ebayWriteUsed: false, canPublish: false, target: "SANDBOX" },
  })
}

async function approveDraft(body: JsonRecord, actor: string) {
  const packageId = uuid(body.packageId)
  const approvalKey = idempotencyKey(body.idempotencyKey)
  if (!packageId || !approvalKey) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_INPUT_INVALID"), 400)
  if (
    text(body.confirmation) !== EBAY_DRAFT_ONLY_APPROVAL_PHRASE
    || body.confirmUnpublishedOnly !== true
    || body.confirmNoPublish !== true
    || body.confirmImagesAuthorized !== true
  ) return jsonError(new Error("EBAY_DRAFT_ONLY_EXPLICIT_APPROVAL_REQUIRED"), 409)
  const requestedConfiguration = record(body.draftConfiguration)
  const supabase = getSupabaseAdminClient()
  const context = await loadPackageContext(supabase, packageId, actor, text(requestedConfiguration.sku))
  const now = new Date()
  const draftConfiguration = serverApprovedConfiguration(
    requestedConfiguration,
    context.listingPackage,
    context.opportunity,
    actor,
    now,
    true,
  )
  const readiness = evaluateEbayDraftOnlyReadiness({ ...context, draftConfiguration })
  if (!readiness.ready) return jsonError(new Error("EBAY_DRAFT_ONLY_BLOCKED"), 409, readiness.blockers)
  const { data: approval, error } = await supabase
    .rpc("approve_ebay_draft_only_package", {
      p_listing_package_id: packageId,
      p_opportunity_id: context.listingPackage.opportunity_id,
      p_candidate_key: context.listingPackage.candidate_key,
      p_actor_user_id: actor,
      p_payload_hash: readiness.payloadHash,
      p_approved_payload: readiness.payload,
      p_idempotency_key: approvalKey,
      p_expires_at: approvalExpiresAt(now),
    })
    .single()
  if (error) {
    const { data: existing } = await supabase
      .from("ebay_draft_only_approvals")
      .select("id,status,payload_hash,approved_at,expires_at,actor_user_id")
      .eq("approval_idempotency_key", approvalKey)
      .maybeSingle()
    if (existing?.actor_user_id === actor && existing.payload_hash === readiness.payloadHash) {
      return NextResponse.json({ success: true, approval: existing, idempotentReplay: true, safety: { canPublish: false, target: "SANDBOX" } })
    }
    return jsonError(new Error("EBAY_DRAFT_ONLY_ACTIVE_APPROVAL_EXISTS"), 409)
  }
  return NextResponse.json({
    success: true,
    approval: {
      id: record(approval).id,
      status: record(approval).status,
      payload_hash: record(approval).payload_hash,
      approved_at: record(approval).approved_at,
      expires_at: record(approval).expires_at,
    },
    readiness: { ready: true, blockers: [], payloadHash: readiness.payloadHash },
    safety: { approvedForOneUnpublishedDraft: true, canPublish: false, target: "SANDBOX" },
  }, { status: 201 })
}

async function executeDraft(body: JsonRecord, actor: string) {
  const approvalId = uuid(body.approvalId)
  const executionKey = idempotencyKey(body.idempotencyKey)
  if (!approvalId || !executionKey) return jsonError(new Error("EBAY_DRAFT_ONLY_EXECUTION_INPUT_INVALID"), 400)
  const supabase = getSupabaseAdminClient()
  const { data: approval, error: approvalError } = await supabase
    .from("ebay_draft_only_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("actor_user_id", actor)
    .maybeSingle()
  if (approvalError || !approval) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_NOT_FOUND"), 404)
  const { data: existing, error: existingError } = await supabase
    .from("ebay_draft_only_execution_ledger")
    .select("*")
    .eq("approval_id", approvalId)
    .maybeSingle()
  if (existingError) throw new Error("EBAY_DRAFT_ONLY_LEDGER_READ_FAILED")
  if (existing && existing.idempotency_key !== executionKey) return jsonError(new Error("EBAY_DRAFT_ONLY_IDEMPOTENCY_MISMATCH"), 409)
  if (existing?.phase === "completed") return NextResponse.json({
    success: true,
    idempotentReplay: true,
    draft: { offerId: existing.offer_id, sku: existing.sku, status: "UNPUBLISHED", target: "SANDBOX" },
    safety: { canPublish: false },
  })
  if (['offer_create_in_flight', 'offer_outcome_unknown'].includes(existing?.phase)) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_OFFER_RECONCILIATION_REQUIRED"), 409)
  }
  if (existing?.phase === "terminal_failure") return jsonError(new Error("EBAY_DRAFT_ONLY_TERMINAL_FAILURE"), 409)
  if (approval.status !== "approved" || approval.consumed_at || approval.revoked_at) return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_NOT_ACTIVE"), 409)
  if (Date.parse(approval.expires_at) <= Date.now()) {
    await supabase.from("ebay_draft_only_approvals").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", approvalId).eq("status", "approved")
    return jsonError(new Error("EBAY_DRAFT_ONLY_APPROVAL_EXPIRED"), 409)
  }
  const approvedPayload = record(approval.approved_payload)
  const draftConfiguration = configurationFromApprovedPayload(approvedPayload)
  const sku = text(draftConfiguration.sku)
  const context = await loadPackageContext(supabase, approval.listing_package_id, actor, sku, approvalId)
  const readiness = evaluateEbayDraftOnlyReadiness({ ...context, draftConfiguration })
  const currentPayload = buildEbayDraftOnlyPayload(context.listingPackage, context.opportunity, draftConfiguration)
  const currentHash = hashEbayDraftOnlyPayload(currentPayload)
  if (!readiness.ready || currentHash !== approval.payload_hash) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED"), 409, [
      ...readiness.blockers,
      ...(currentHash !== approval.payload_hash ? ["APPROVED_PAYLOAD_CHANGED"] : []),
    ])
  }
  const runtime = ebayDraftOnlyRuntimeStatus()
  if (!runtime.enabled || !runtime.configured || runtime.target !== "SANDBOX") {
    return jsonError(new Error("EBAY_DRAFT_ONLY_RUNTIME_DISABLED"), 409)
  }

  const businessPolicies = record(draftConfiguration.businessPolicies)
  const dependencyPreflight = await preflightEbayDraftDependencies({
    merchantLocationKey: text(draftConfiguration.merchantLocationKey),
    fulfillmentPolicyId: text(businessPolicies.fulfillmentPolicyId),
    paymentPolicyId: text(businessPolicies.paymentPolicyId),
    returnPolicyId: text(businessPolicies.returnPolicyId),
  })
  if (!dependencyPreflight.safe) {
    const unavailable = dependencyPreflight.blocker === "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE"
    return jsonError(
      new Error(dependencyPreflight.blocker ?? "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE"),
      unavailable ? 503 : 409,
    )
  }

  const { data: claimedLedger, error: claimError } = await supabase
    .rpc("claim_ebay_draft_only_execution", {
      p_approval_id: approvalId,
      p_actor_user_id: actor,
      p_idempotency_key: executionKey,
      p_request_hash: currentHash,
      p_sku: sku,
      p_claim_token: randomUUID(),
    })
    .single()
  if (claimError || !claimedLedger) return jsonError(new Error("EBAY_DRAFT_ONLY_SKU_OR_EXECUTION_COLLISION"), 409)
  let ledger = claimedLedger as JsonRecord
  const ledgerId = uuid(ledger.id)
  if (!ledgerId) throw new Error("EBAY_DRAFT_ONLY_LEDGER_ID_INVALID")
  if (ledger.phase === "completed") return NextResponse.json({
    success: true,
    idempotentReplay: true,
    draft: { offerId: ledger.offer_id, sku: ledger.sku, status: "UNPUBLISHED", target: "SANDBOX" },
    safety: { canPublish: false },
  })
  if (['offer_create_in_flight', 'offer_outcome_unknown'].includes(text(ledger.phase))) {
    return jsonError(new Error("EBAY_DRAFT_ONLY_OFFER_RECONCILIATION_REQUIRED"), 409)
  }
  if (ledger.phase === "terminal_failure") return jsonError(new Error("EBAY_DRAFT_ONLY_TERMINAL_FAILURE"), 409)

  if (ledger.phase === "claimed") {
    const preflight = await preflightEbayDraftSkuCollision(sku)
    if (!preflight.safe) {
      await supabase.from("ebay_draft_only_execution_ledger").update({
        phase: preflight.collision ? "terminal_failure" : "claimed",
        last_error_code: preflight.blocker,
        sanitized_result: { collision: preflight.collision },
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", ledgerId).eq("phase", "claimed")
      return jsonError(
        new Error(preflight.blocker ?? "EBAY_SKU_PREFLIGHT_UNAVAILABLE"),
        preflight.collision ? 409 : 503,
      )
    }
  }

  if (ledger.phase === "claimed" || ledger.phase === "retryable_inventory_failure") {
    const inventoryResult = await createOrReplaceEbayDraftInventoryItem(
      sku,
      record(approvedPayload.inventoryItemPayload),
    )
    if (!inventoryResult.ok) {
      const retryable = inventoryResult.retryable || !inventoryResult.outcomeKnown
      await supabase.from("ebay_draft_only_execution_ledger").update({
        phase: retryable ? "retryable_inventory_failure" : "terminal_failure",
        inventory_http_status: inventoryResult.status || null,
        last_error_code: retryable ? "EBAY_INVENTORY_WRITE_RETRYABLE" : "EBAY_INVENTORY_WRITE_REJECTED",
        sanitized_result: inventoryResult.body,
        lease_token: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", ledgerId)
      await enqueueDraftFailure(
        supabase,
        approval,
        context,
        retryable ? "EBAY_INVENTORY_WRITE_RETRYABLE" : "EBAY_INVENTORY_WRITE_REJECTED",
        !retryable,
      )
      return jsonError(new Error(retryable ? "EBAY_INVENTORY_WRITE_RETRYABLE" : "EBAY_INVENTORY_WRITE_REJECTED"), retryable ? 503 : 409)
    }
    const { data, error } = await supabase.from("ebay_draft_only_execution_ledger").update({
      phase: "inventory_confirmed",
      inventory_http_status: inventoryResult.status,
      inventory_confirmed_at: new Date().toISOString(),
      last_error_code: null,
      sanitized_result: {},
      updated_at: new Date().toISOString(),
    }).eq("id", ledgerId).in("phase", ["claimed", "retryable_inventory_failure"]).select("*").single()
    if (error || !data) throw new Error("EBAY_DRAFT_ONLY_INVENTORY_LEDGER_UPDATE_FAILED")
    ledger = data
  }

  const inFlightAt = new Date().toISOString()
  const { data: inFlight, error: inFlightError } = await supabase
    .from("ebay_draft_only_execution_ledger")
    .update({ phase: "offer_create_in_flight", offer_create_started_at: inFlightAt, updated_at: inFlightAt })
    .eq("id", ledgerId)
    .eq("phase", "inventory_confirmed")
    .select("id")
    .single()
  if (inFlightError || !inFlight) throw new Error("EBAY_DRAFT_ONLY_OFFER_LEDGER_CLAIM_FAILED")

  const offerResult = await createEbayUnpublishedOffer(record(approvedPayload.offerPayload))
  if (!offerResult.ok) {
    const unknown = !offerResult.outcomeKnown || offerResult.status >= 500
    await supabase.from("ebay_draft_only_execution_ledger").update({
      phase: unknown ? "offer_outcome_unknown" : "terminal_failure",
      offer_http_status: offerResult.status || null,
      last_error_code: unknown ? "EBAY_OFFER_OUTCOME_UNKNOWN" : "EBAY_OFFER_WRITE_REJECTED",
      sanitized_result: offerResult.body,
      lease_token: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", ledgerId).eq("phase", "offer_create_in_flight")
    await enqueueDraftFailure(
      supabase,
      approval,
      context,
      unknown ? "EBAY_OFFER_OUTCOME_UNKNOWN" : "EBAY_OFFER_WRITE_REJECTED",
      true,
    )
    return jsonError(new Error(unknown ? "EBAY_OFFER_OUTCOME_UNKNOWN" : "EBAY_OFFER_WRITE_REJECTED"), unknown ? 503 : 409)
  }
  const offerId = sanitizeEbayOfferId(offerResult.body.offerId)
  if (!offerId) {
    await supabase.from("ebay_draft_only_execution_ledger").update({ phase: "offer_outcome_unknown", offer_http_status: offerResult.status, last_error_code: "EBAY_OFFER_ID_MISSING", lease_token: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", ledgerId)
    await enqueueDraftFailure(
      supabase,
      approval,
      context,
      "EBAY_OFFER_ID_MISSING",
      true,
    )
    return jsonError(new Error("EBAY_OFFER_ID_MISSING"), 503)
  }
  const { data: completed, error: completionError } = await supabase
    .rpc("complete_ebay_draft_only_execution", {
      p_ledger_id: ledgerId,
      p_actor_user_id: actor,
      p_offer_id: offerId,
      p_offer_http_status: offerResult.status,
    })
    .single()
  if (completionError || !completed) {
    await enqueueDraftFailure(
      supabase,
      approval,
      context,
      "EBAY_DRAFT_ONLY_COMPLETION_PERSIST_FAILED",
      true,
    )
    throw new Error("EBAY_DRAFT_ONLY_COMPLETION_PERSIST_FAILED")
  }
  return NextResponse.json({
    success: true,
    draft: { offerId, sku, status: "UNPUBLISHED", target: "SANDBOX" },
    execution: completed,
    safety: { inventoryItemCreated: true, unpublishedOfferCreated: true, publishOfferCalled: false, canPublish: false },
  }, { status: 201 })
}
