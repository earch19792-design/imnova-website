export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { EBAY_FINAL_PUBLISH_CONFIRMATION } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { getEbayDraftWriteEnvironmentBoundary } from
  "@/lib/ebay/environment-boundaries"
import { publishCurrentRevisionV1 } from
  "@/lib/ebay/ebay-current-publication-executor-server-v1"
import { evaluateCurrentPrepublicationArtifactPolicyV1 } from
  "@/lib/ebay/ebay-current-prepublication-artifact-policy-v1"
import { autonomousGreenfieldCurrentCertificationReadyV1 } from
  "@/lib/ebay/ebay-autonomous-greenfield-current-certification-v1"
import { collectRadarRevenueFactoryCandidateBatchV1,
  ensureRadarCandidateEconomicsPreflightsV1,
  materializeRadarRevenueFactoryCandidateBatchV1 } from
  "@/lib/ebay/ebay-opportunity-radar-revenue-factory-adapter-v1"
import { recoverInterruptedLunaQuickPickRuntimeV1 } from
  "@/lib/ebay/ebay-quick-pick-interrupted-runtime-recovery-v1"
import { recoverFalseExactCategoryAuthorityRuntimeV1 } from
  "@/lib/ebay/ebay-category-authority-runtime-recovery-v1"
import { recoverQuickPickPublisherPackagesV1 } from
  "@/lib/ebay/ebay-quick-pick-publisher-package-recovery-v1"
import { reconcileQuickPickProductResearchHandoffV1 } from
  "@/lib/ebay/ebay-quick-pick-product-research-handoff-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { reconcileCurrentFactoryKeywordContinuationsV2_1 } from
  "@/lib/seller-os/current-keyword-continuation-v2-1"
import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "@/lib/ebay/ebay-smart-stocking-durable-factory-v1"
import { readEbayPackageFeeContextReadonlyV1 } from
  "@/lib/ebay/ebay-package-fee-context-readonly-v1"
import { persistProducedEbayFeeV1, readEbayFeeHandoffV1 } from
  "@/lib/seller-os/ebay-fee-runtime-v1"
import { readSellOneLikeThisV1 } from
  "@/lib/seller-os/sell-one-like-this-runtime-v1"
import { publicationFeeStructureV1 } from
  "@/lib/seller-os/publication-fee-structure-v1"
import { knownBuyerShippingV1 } from
  "@/lib/seller-os/publication-prevalidation-boundary-v1"
import { keywordRecord as record } from
  "@/lib/seller-os/keyword-intelligence-handoff-v1"

function authorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? ""
  const runtimeSecret = process.env.SELLER_OS_RUNTIME_RECOVERY_SECRET
    ?.trim() ?? ""
  return Boolean(
    cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`
    || runtimeSecret && req.headers.get(
      "x-seller-os-runtime-recovery-secret") === runtimeSecret,
  )
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdminClient()
  if (!authorized(req) && !await sellerOsPostRuntimeAuthorizedV1({
    request: req, supabase,
  })) return NextResponse.json({ success: false,
    error: "CRON_UNAUTHORIZED" }, { status: 401 })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "QUICK_PICK_RECOVERY_ACCOUNT_SCOPE_REQUIRED" }, { status: 500 })
  try {
    if (req.headers.get("x-seller-os-runtime-lane") ===
        "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY") {
      const forbiddenIdentityFields = ["productId", "variantId", "supplierSku",
        "packageId", "opportunityId", "candidateId"]
      const requestBody = record(await req.clone().json().catch(() => ({})))
      if (forbiddenIdentityFields.some((key) => key in requestBody)) {
        throw new Error("MANUAL_PRODUCT_ID_INJECTION_FORBIDDEN")
      }
      const boundary = getEbayDraftWriteEnvironmentBoundary()
      if (!boundary.productionDedicatedPreprodBound || !boundary.writeAllowed) {
        throw new Error("CERTIFIED_PREPROD_ONLY")
      }
      const initialized = await supabase.from(
        "seller_os_autonomous_greenfield_canary_v1").upsert({
          account_key: accountKey,
          contract_version:
            "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
          status: "SELECTING",
        }, { onConflict: "account_key", ignoreDuplicates: true })
      if (initialized.error) throw new Error(
        "AUTONOMOUS_GREENFIELD_LEDGER_INITIALIZATION_FAILED")
      const readLedger = async () => {
        const result = await supabase.from(
          "seller_os_autonomous_greenfield_canary_v1").select("*")
          .eq("account_key", accountKey).single()
        if (result.error || !result.data) throw new Error(
          "AUTONOMOUS_GREENFIELD_LEDGER_READ_FAILED")
        return record(result.data)
      }
      let ledger = await readLedger()
      const publicationInput = (publication: Record<string, unknown>) => {
        const revision = record(record(record(publication.sanitized_result)
          .publicationPreparationV1).current)
        return {
          supabase, actor: String(publication.actor_user_id), accountKey,
          publicationId: String(publication.id),
          packageId: String(publication.listing_package_id),
          offerId: String(publication.offer_id), sku: String(publication.sku),
          packageHash: String(revision.packageHash),
          packageGeneration: String(revision.packageGeneration),
          previewHash: String(revision.previewHash),
          idempotencyKey: `publish:${String(publication.id)}`,
          confirmation: EBAY_FINAL_PUBLISH_CONFIRMATION,
        }
      }
      const activeCount = async () => {
        const result = await supabase.from("ebay_active_listings")
          .select("id", { count: "exact", head: true })
          .eq("account_key", accountKey).eq("listing_status", "active")
        if (result.error || result.count === null) throw new Error(
          "AUTONOMOUS_GREENFIELD_ACTIVE_COUNT_READ_FAILED")
        return result.count
      }
      if (ledger.status === "PUBLISHED_CONFIRMED") {
        const publicationRead = await supabase.from(
          "ebay_authorized_listing_publications").select("*")
          .eq("id", String(ledger.publication_id))
          .eq("listing_package_id", String(ledger.listing_package_id))
          .eq("marketplace_account_key", accountKey).single()
        if (publicationRead.error || !publicationRead.data) throw new Error(
          "AUTONOMOUS_GREENFIELD_PUBLICATION_REPLAY_READ_FAILED")
        const replay = record(await publishCurrentRevisionV1(
          publicationInput(record(publicationRead.data))))
        const pass = replay.pass === true && replay.publicationWrites === 0
          && replay.IDEMPOTENT_REPLAY_CONFIRMED === true
          && replay.listingId === ledger.listing_id
        return NextResponse.json({ success: pass,
          contractVersion:
            "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
          status: pass ? "PUBLISHED_CONFIRMED" : "READBACK_REQUIRED",
          selection: { candidateId: ledger.candidate_id,
            productId: ledger.product_id, variantId: ledger.variant_id,
            supplierSku: ledger.supplier_sku,
            packageId: ledger.listing_package_id,
            manualProductSelection: false,
            manualProductIdInjection: false },
          publication: replay,
          ACTIVE_LISTING_COUNT_DELTA: Number(
            ledger.active_listing_count_after) - Number(
            ledger.active_listing_count_before),
          ADDITIONAL_PUBLICATION_WRITE_COUNT: 0,
          SECOND_LISTING_CREATED: false,
          IDEMPOTENT_REPLAY_CONFIRMED: pass,
          CODEX_RUNTIME_DEPENDENCY: false,
          OWNER_ACTION_REQUIRED: false,
          LEGACY_DEPENDENCY_COUNT: 0,
          safety: { concurrency: 1, marketplaceWrites: 0,
            publicationWrites: 0, adsWrites: 0, blindRetryAllowed: false },
        }, { status: pass ? 200 : 409 })
      }
      if (ledger.publication_id && ["PREPUBLICATION_READY", "PUBLISHING"]
          .includes(String(ledger.status))) {
        const publicationRead = await supabase.from(
          "ebay_authorized_listing_publications").select("*")
          .eq("id", String(ledger.publication_id))
          .eq("listing_package_id", String(ledger.listing_package_id))
          .eq("marketplace_account_key", accountKey).single()
        if (publicationRead.error || !publicationRead.data) throw new Error(
          "AUTONOMOUS_GREENFIELD_PUBLICATION_RECOVERY_READ_FAILED")
        const publication = record(await publishCurrentRevisionV1(
          publicationInput(record(publicationRead.data))))
        if (publication.pass !== true) {
          await supabase.from("seller_os_autonomous_greenfield_canary_v1")
            .update({ status: "PUBLISHING",
              evidence: { ...record(ledger.evidence), publication },
              updated_at: new Date().toISOString() })
            .eq("account_key", accountKey)
            .eq("publication_id", String(ledger.publication_id))
          return NextResponse.json({ success: false,
            contractVersion:
              "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
            status: "PUBLICATION_COMMIT_READBACK_PENDING",
            selection: ledger, publication,
            PUBLICATION_COMMIT_ALLOWED: true,
            OWNER_ACTION_REQUIRED: false,
            safety: { concurrency: 1,
              marketplaceWrites: Number(publication.publicationWrites ?? 0),
              publicationWrites: Number(publication.publicationWrites ?? 0),
              adsWrites: 0, blindRetryAllowed: false },
          }, { status: 409 })
        }
        const before = Number(ledger.active_listing_count_before)
        const after = await activeCount()
        const complete = await supabase.from(
          "seller_os_autonomous_greenfield_canary_v1").update({
            status: "PUBLISHED_CONFIRMED", listing_id: publication.listingId,
            active_listing_count_after: after,
            published_confirmed_at: new Date().toISOString(),
            evidence: { ...record(ledger.evidence), publication,
              officialReadbackPass: true,
              activeListingCountDelta: after - before },
            updated_at: new Date().toISOString(),
          }).eq("account_key", accountKey)
            .eq("publication_id", String(ledger.publication_id))
            .eq("active_listing_count_before", before).select("*").single()
        if (complete.error || !complete.data || after - before !== 1) {
          throw new Error("AUTONOMOUS_GREENFIELD_ACTIVE_DELTA_NOT_EXACTLY_ONE")
        }
        return NextResponse.json({ success: true,
          contractVersion:
            "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
          status: "PUBLISHED_CONFIRMED", selection: ledger, publication,
          AUTONOMOUS_CANDIDATE_CONTINUATION: true,
          PUBLICATION_COMMIT_ALLOWED: true,
          PUBLICATION_WRITE_COUNT: Number(publication.publicationWrites),
          PUBLISH_OFFER_CALLED: Number(publication.publicationWrites) === 1,
          ACTIVE_LISTING_COUNT_DELTA: after - before,
          DUPLICATE_LISTING_CREATED: false, DUPLICATE_OFFER_CREATED: false,
          PUBLICATION_INTENT_COUNT: 1, CODEX_RUNTIME_DEPENDENCY: false,
          OWNER_ACTION_REQUIRED: false, LEGACY_DEPENDENCY_COUNT: 0,
          safety: { concurrency: 1,
            marketplaceWrites: Number(publication.publicationWrites),
            publicationWrites: Number(publication.publicationWrites),
            adsWrites: 0, blindRetryAllowed: false },
        })
      }

      let selectionPass: Record<string, unknown> | null = null
      let selectionEvidence: Record<string, unknown> = {}
      if (!ledger.listing_package_id) {
        let batch = await collectRadarRevenueFactoryCandidateBatchV1({
          supabase, accountKey, targetCandidates: 100,
        })
        const economics = await ensureRadarCandidateEconomicsPreflightsV1({
          supabase, accountKey, batch,
        })
        if (economics.attempted > 0) {
          batch = await collectRadarRevenueFactoryCandidateBatchV1({
            supabase, accountKey, targetCandidates: 100,
          })
        }
        let factory = await materializeRadarRevenueFactoryCandidateBatchV1({
          supabase, accountKey, batch,
          taxonomyReader: getEbayTaxonomyListingIntelligence,
          productIdentifierPolicyReader:
            preflightEbayCategoryProductIdentifiers,
        })
        const keyword = await reconcileCurrentFactoryKeywordContinuationsV2_1({
          supabase, accountKey,
        })
        if (keyword.status === "PASS" && factory.listingReady === 0) {
          factory = await materializeRadarRevenueFactoryCandidateBatchV1({
            supabase, accountKey, batch,
            taxonomyReader: getEbayTaxonomyListingIntelligence,
            productIdentifierPolicyReader:
              preflightEbayCategoryProductIdentifiers,
          })
        }
        const profile = await supabase.from("ebay_account_policy_profiles")
          .select("*").eq("account_key", accountKey)
          .eq("marketplace_id", "EBAY_US").maybeSingle()
        if (profile.error || !profile.data) throw new Error(
          "CURRENT_ACCOUNT_POLICY_AUTHORITY_REQUIRED")
        for (const outcome of factory.outcomes.map(record)) {
          if (!autonomousGreenfieldCurrentCertificationReadyV1(outcome)
              || !outcome.listingPackageId
              || !outcome.opportunityId || !outcome.candidateKey
              || !outcome.lunaProductId || !outcome.lunaVariantId
              || !outcome.supplierSku) continue
          const [packageRead, opportunityRead, publicationRead] =
            await Promise.all([
              supabase.from("ebay_listing_packages").select("*")
                .eq("id", String(outcome.listingPackageId))
                .eq("account_key", accountKey).maybeSingle(),
              supabase.from("ebay_luna_opportunity_queue").select("*")
                .eq("id", String(outcome.opportunityId)).maybeSingle(),
              supabase.from("ebay_authorized_listing_publications")
                .select("id").eq("listing_package_id",
                  String(outcome.listingPackageId)).limit(1),
            ])
          if (packageRead.error || !packageRead.data
              || opportunityRead.error || !opportunityRead.data
              || publicationRead.error || publicationRead.data?.length
              || Date.parse(String(packageRead.data.created_at)) <
                Date.parse(String(ledger.started_at))) continue
          const policy = evaluateCurrentPrepublicationArtifactPolicyV1({
            listingPackage: packageRead.data,
            opportunity: opportunityRead.data,
            accountProfile: profile.data, accountKey,
          })
          if (!policy.pass) continue
          selectionPass = outcome
          break
        }
        selectionEvidence = { automaticCandidateBatch: {
          evaluated: factory.lunaProductsEvaluated,
          listingReady: factory.listingReady,
          parked: factory.parked, exceptions: factory.exceptions,
          alreadyLiveExcluded: factory.alreadyLiveExcludedCount,
          waitingBrowserWorker: factory.waitingBrowserWorker,
          autonomouslyContinued: true,
        }, economics, keywordStatus: keyword.status,
          manualProductSelection: false, manualProductIdInjection: false,
          codexRuntimeDependency: false }
        if (!selectionPass) {
          await supabase.from("seller_os_autonomous_greenfield_canary_v1")
            .update({ evidence: { ...record(ledger.evidence),
              ...selectionEvidence }, updated_at: new Date().toISOString() })
            .eq("account_key", accountKey).eq("status", "SELECTING")
          return NextResponse.json({ success: false,
            contractVersion:
              "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
            status: "AUTONOMOUS_CANDIDATE_CONTINUATION_PENDING",
            selectionEvidence,
            AUTONOMOUS_CANDIDATE_CONTINUATION: true,
            MANUAL_PRODUCT_SELECTION: false,
            MANUAL_PRODUCT_ID_INJECTION: false,
            CODEX_RUNTIME_DEPENDENCY: false,
            OWNER_ACTION_REQUIRED: false,
            safety: { marketplaceWrites: 0, publicationWrites: 0,
              adsWrites: 0 },
          }, { status: 202 })
        }
        const claimed = await supabase.rpc(
          "claim_autonomous_greenfield_canary_v1", {
            p_account_key: accountKey,
            p_candidate_id: String(selectionPass.candidateId),
            p_opportunity_id: String(selectionPass.opportunityId),
            p_candidate_key: String(selectionPass.candidateKey),
            p_listing_package_id: String(selectionPass.listingPackageId),
            p_product_id: String(selectionPass.lunaProductId),
            p_variant_id: String(selectionPass.lunaVariantId),
            p_supplier_sku: String(selectionPass.supplierSku),
            p_evidence: selectionEvidence,
          })
        if (claimed.error || !claimed.data) throw new Error(
          "AUTONOMOUS_GREENFIELD_CANDIDATE_CLAIM_FAILED")
        ledger = record(claimed.data)
      }

      const materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
        supabase, accountKey,
        opportunityId: String(ledger.opportunity_id),
        candidateKey: String(ledger.candidate_key),
        taxonomyReader: getEbayTaxonomyListingIntelligence,
        productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
      })
      if (materialized.listingPackageId !== ledger.listing_package_id
          || !autonomousGreenfieldCurrentCertificationReadyV1(materialized)) {
        return NextResponse.json({ success: false,
          contractVersion:
            "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
          status: "CURRENT_PREPUBLICATION_CONTINUATION_PENDING",
          selection: ledger, materialized,
          AUTONOMOUS_CANDIDATE_CONTINUATION: true,
          OWNER_ACTION_REQUIRED: false,
          safety: { marketplaceWrites: 0, publicationWrites: 0,
            adsWrites: 0 },
        }, { status: 202 })
      }
      const packageId = String(ledger.listing_package_id)
      const now = new Date()
      const currentFee = await readEbayFeeHandoffV1({
        supabase, accountKey, packageId, itemId: null,
        sku: String(ledger.supplier_sku), now,
      })
      const currentAuthority = record(currentFee?.authority)
      const currentSource = record(currentAuthority.preSaleSourceContextV1)
      const currentListing = record(currentSource.listing)
      const currentFeeReady = record(currentFee).publicationSubjectMatched === true
        && publicationFeeStructureV1({ authority: currentAuthority,
          subjectMatched: true, accountKey, packageId,
          sku: String(ledger.supplier_sku),
          categoryId: String(currentAuthority.categoryId ?? ""),
          salePrice: Number(currentListing.price),
          buyerShipping: knownBuyerShippingV1(
            currentSource.fulfillmentFeeBasis), now }).feeAuthorityReady
      if (!currentFeeReady) {
        const context = await readEbayPackageFeeContextReadonlyV1(packageId)
        await persistProducedEbayFeeV1({ supabase, accountKey, packageId,
          itemId: null, sku: String(ledger.supplier_sku), context,
          now: new Date() })
      }
      const authorization = req.headers.get("authorization") ?? ""
      const protectionBypass = req.headers.get(
        "x-vercel-protection-bypass") ?? ""
      const artifactResponse = await fetch(new URL(
        "/api/admin/ebay/draft-only", req.url), {
        method: "POST", cache: "no-store",
        headers: { Authorization: authorization,
          "Content-Type": "application/json",
          ...(protectionBypass
            ? { "x-vercel-protection-bypass": protectionBypass } : {}) },
        body: JSON.stringify({
          action: "materialize_current_prepublication_artifacts", packageId,
        }), signal: AbortSignal.timeout(240_000),
      })
      const artifacts = record(await artifactResponse.json().catch(() => null))
      if (!artifactResponse.ok || artifacts.success !== true) {
        return NextResponse.json({ success: false,
          contractVersion:
            "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
          status: "CURRENT_PREPUBLICATION_ARTIFACTS_PENDING",
          selection: ledger, artifacts,
          OWNER_ACTION_REQUIRED: false,
          safety: { marketplaceWrites: Number(record(
              artifacts.safety).marketplaceWrites ?? 0),
            publicationWrites: 0, adsWrites: 0 },
        }, { status: artifactResponse.status })
      }
      const current = await readSellOneLikeThisV1({
        supabase, accountKey, packageId, referenceItemId: "",
      })
      if (current.publicationGate.READY_TO_PUBLISH !== true
          || current.publicationGate.EXECUTOR_CLAIMABLE !== true) {
        return NextResponse.json({ success: false,
          contractVersion:
            "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
          status: "CURRENT_EXECUTION_CONTRACT_NOT_CLAIMABLE",
          selection: ledger, current,
          OWNER_ACTION_REQUIRED: false,
          safety: { marketplaceWrites: Number(record(
              artifacts.safety).marketplaceWrites ?? 0),
            publicationWrites: 0, adsWrites: 0 },
        }, { status: 409 })
      }
      const publicationRead = await supabase.from(
        "ebay_authorized_listing_publications").select("*")
        .eq("id", String(artifacts.publicationIntentId))
        .eq("listing_package_id", packageId)
        .eq("marketplace_account_key", accountKey).single()
      if (publicationRead.error || !publicationRead.data) throw new Error(
        "AUTONOMOUS_GREENFIELD_PUBLICATION_INTENT_READ_FAILED")
      const before = ledger.active_listing_count_before === null
        || ledger.active_listing_count_before === undefined
        ? await activeCount() : Number(ledger.active_listing_count_before)
      const armed = await supabase.from(
        "seller_os_autonomous_greenfield_canary_v1").update({
          status: "PREPUBLICATION_READY",
          publication_id: publicationRead.data.id,
          active_listing_count_before: before,
          evidence: { ...record(ledger.evidence), ...selectionEvidence,
            currentExecutionContractValid: true,
            executorClaimable: true, artifacts },
          updated_at: new Date().toISOString(),
        }).eq("account_key", accountKey)
          .eq("listing_package_id", packageId).select("*").single()
      if (armed.error || !armed.data) throw new Error(
        "AUTONOMOUS_GREENFIELD_PREPUBLICATION_ARM_FAILED")
      const publication = record(await publishCurrentRevisionV1(
        publicationInput(record(publicationRead.data))))
      if (publication.pass !== true) {
        await supabase.from("seller_os_autonomous_greenfield_canary_v1")
          .update({ status: "PUBLISHING",
            evidence: { ...record(record(armed.data).evidence), publication },
            updated_at: new Date().toISOString() })
          .eq("account_key", accountKey).eq("publication_id",
            publicationRead.data.id)
        return NextResponse.json({ success: false,
          contractVersion:
            "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
          status: "PUBLICATION_COMMIT_READBACK_PENDING",
          selection: ledger, publication,
          PUBLICATION_COMMIT_ALLOWED: true,
          OWNER_ACTION_REQUIRED: false,
          safety: { concurrency: 1,
            marketplaceWrites: Number(publication.publicationWrites ?? 0),
            publicationWrites: Number(publication.publicationWrites ?? 0),
            adsWrites: 0, blindRetryAllowed: false },
        }, { status: 409 })
      }
      const after = await activeCount()
      const complete = await supabase.from(
        "seller_os_autonomous_greenfield_canary_v1").update({
          status: "PUBLISHED_CONFIRMED", listing_id: publication.listingId,
          active_listing_count_after: after,
          published_confirmed_at: new Date().toISOString(),
          evidence: { ...record(record(armed.data).evidence), publication,
            officialReadbackPass: true, activeListingCountDelta: after - before },
          updated_at: new Date().toISOString(),
        }).eq("account_key", accountKey)
          .eq("publication_id", publicationRead.data.id)
          .eq("active_listing_count_before", before).select("*").single()
      if (complete.error || !complete.data || after - before !== 1) {
        throw new Error("AUTONOMOUS_GREENFIELD_ACTIVE_DELTA_NOT_EXACTLY_ONE")
      }
      return NextResponse.json({ success: true,
        contractVersion:
          "AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1",
        status: "PUBLISHED_CONFIRMED",
        selection: { candidateId: ledger.candidate_id,
          productId: ledger.product_id, variantId: ledger.variant_id,
          supplierSku: ledger.supplier_sku, packageId,
          manualProductSelection: false, manualProductIdInjection: false },
        current, artifacts, publication,
        AUTONOMOUS_CANDIDATE_CONTINUATION: true,
        PUBLICATION_COMMIT_ALLOWED: true,
        PUBLICATION_WRITE_COUNT: Number(publication.publicationWrites),
        PUBLISH_OFFER_CALLED: Number(publication.publicationWrites) === 1,
        ACTIVE_LISTING_COUNT_DELTA: after - before,
        DUPLICATE_LISTING_CREATED: false,
        DUPLICATE_OFFER_CREATED: false,
        PUBLICATION_INTENT_COUNT: 1,
        CODEX_RUNTIME_DEPENDENCY: false,
        OWNER_ACTION_REQUIRED: false,
        LEGACY_DEPENDENCY_COUNT: 0,
        safety: { concurrency: 1,
          marketplaceWrites: Number(publication.publicationWrites),
          publicationWrites: Number(publication.publicationWrites),
          adsWrites: 0, blindRetryAllowed: false },
      })
    }
    if (req.headers.get("x-seller-os-runtime-lane") ===
        "CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT") {
      const packageId = "695a862f-2385-4b6c-b996-5e4aac2ca36c"
      const opportunityId = "5acad932-7595-4659-9822-b8084ff5a107"
      const [packageRead, queueRead] = await Promise.all([
        supabase.from("ebay_listing_packages")
          .select("id,account_key,opportunity_id,package_data")
          .eq("id", packageId).eq("account_key", accountKey)
          .eq("opportunity_id", opportunityId).limit(1).maybeSingle(),
        supabase.from("ebay_luna_opportunity_queue")
          .select("id,assessment").eq("id", opportunityId)
          .limit(1).maybeSingle(),
      ])
      const packageData = record(packageRead.data?.package_data)
      const marker = record(packageData.currentPublicationFactoryV1)
      const resolver = record(packageData.categoryResolverV1)
      const condition = record(packageData.conditionAuthority)
      const aspects = record(packageData.aspects)
      const exposure = record(packageData.packageExposurePolicyV1)
      const exposureBinding = record(exposure.binding)
      const canonical = record(record(queueRead.data?.assessment)
        .canonicalMarketplaceReadinessV1)
      const settledCurrentAuthorities = !packageRead.error && !queueRead.error
        && marker.version === "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1"
        && marker.packageId === packageId
        && resolver.status === "AUTO_SELECTED"
        && resolver.listingPackageId === packageId
        && condition.factInvented === false
        && condition.lunaProductId === "9220850483424"
        && condition.lunaVariantId === "53002129932512"
        && condition.supplierSku === "FL-NH4784642"
        && condition.categoryId === packageData.categoryId
        && ["Brand", "Style", "Type"].every((key) =>
          typeof aspects[key] === "string" && Boolean(aspects[key]))
        && exposure.sourcePolicy ===
          "SELLER_OS_CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1"
        && exposure.publicationAuthorized === false
        && exposureBinding.packageId === packageId
        && canonical.ready === true
        && canonical.listingPolicyReady === true
      const materialized = settledCurrentAuthorities
        ? { listingPackageId: packageId, packageCreated: false,
          categoryId: packageData.categoryId, categoryReady: true,
          conditionReady: true, requiredItemSpecificsReady: true,
          listingPolicyReady: true }
        : await materializeSellerOsDeterministicFactoryCandidateV1({
          supabase, accountKey,
          opportunityId,
          candidateKey:
            "sha256:f574d51362e8d7869bcc139caf180abceb9f7ff72ccb84fe801d40960ca93ab2",
          taxonomyReader: getEbayTaxonomyListingIntelligence,
          productIdentifierPolicyReader:
            preflightEbayCategoryProductIdentifiers,
          skipKeywordContinuation: true,
        })
      if (materialized.listingPackageId !== packageId ||
          materialized.packageCreated) {
        throw new Error("SAME_LINK_CURRENT_PACKAGE_REUSE_REQUIRED")
      }
      const now = new Date()
      const currentFee = await readEbayFeeHandoffV1({
        supabase, accountKey, packageId, itemId: null,
        sku: "FL-NH4784642", now,
      })
      const currentAuthority = record(currentFee?.authority)
      const currentSource = record(currentAuthority.preSaleSourceContextV1)
      const currentListing = record(currentSource.listing)
      const currentFeeReady = record(currentFee).publicationSubjectMatched === true
        && publicationFeeStructureV1({
          authority: currentAuthority,
          subjectMatched: true,
          accountKey,
          packageId,
          sku: "FL-NH4784642",
          categoryId: String(currentAuthority.categoryId ?? ""),
          salePrice: Number(currentListing.price),
          buyerShipping: knownBuyerShippingV1(
            currentSource.fulfillmentFeeBasis),
          now,
        }).feeAuthorityReady
      const feeContext = currentFeeReady
        ? null : await readEbayPackageFeeContextReadonlyV1(packageId)
      const feeAuthority = currentFeeReady
        ? currentAuthority as Awaited<ReturnType<
          typeof persistProducedEbayFeeV1
        >>
        : await persistProducedEbayFeeV1({
          supabase, accountKey, packageId, itemId: null,
          sku: "FL-NH4784642",
          context: feeContext,
          // Official reads above establish their own observation timestamps.
          // Evaluate only after they complete so fresh evidence is never
          // rejected as being a few seconds in the future.
          now: new Date(),
        })
      const beforeArtifacts = await readSellOneLikeThisV1({
        // The CURRENT package has its own factory marker. No historical item
        // may become a category, specifics, price or exposure authority here.
        supabase, accountKey, packageId, referenceItemId: "",
      })
      let artifactContinuation: Record<string, unknown> | null = null
      if (beforeArtifacts.feeStructure.feeAuthorityReady === true) {
        const authorization = req.headers.get("authorization") ?? ""
        const protectionBypass = req.headers.get(
          "x-vercel-protection-bypass") ?? ""
        const response = await fetch(new URL(
          "/api/admin/ebay/draft-only", req.url), {
          method: "POST", cache: "no-store",
          headers: { Authorization: authorization,
            "Content-Type": "application/json",
            ...(protectionBypass
              ? { "x-vercel-protection-bypass": protectionBypass } : {}) },
          body: JSON.stringify({
            action: "materialize_current_prepublication_artifacts",
            packageId,
          }),
          signal: AbortSignal.timeout(240_000),
        })
        const contentType = response.headers.get("content-type") ?? ""
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error("CURRENT_PREPUBLICATION_RUNTIME_NON_JSON")
        }
        artifactContinuation = record(await response.json().catch(() => null))
        if (!response.ok || artifactContinuation.success !== true) {
          return NextResponse.json({ success: false,
            contractVersion:
              "CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT_V1",
            packageId, packageCreated: false,
            feeAuthorityReady: true, artifactContinuation,
            safety: { ownerRoutineApprovalRequired: false,
              publicationCommitAllowed: false,
              publicMarketplaceExposureAllowed: false,
              blindRetryAllowed: false,
              marketplaceWrites: Number(record(
                artifactContinuation.safety).marketplaceWrites ?? 0),
              publicationWrites: Number(record(
                artifactContinuation.safety).publicationIntentWrites ?? 0),
              adsWrites: 0 },
          }, { status: response.status })
        }
      }
      const current = await readSellOneLikeThisV1({
        supabase, accountKey, packageId, referenceItemId: "",
      })
      return NextResponse.json({
        success: current.feeStructure.feeAuthorityReady === true
          && artifactContinuation?.success === true,
        contractVersion: "CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT_V1",
        packageId,
        packageCreated: false,
        keywordContinuationSkipped: true,
        categoryId: materialized.categoryId,
        categoryReady: materialized.categoryReady,
        conditionReady: materialized.conditionReady,
        requiredItemSpecificsReady:
          materialized.requiredItemSpecificsReady,
        listingPolicyReady: materialized.listingPolicyReady,
        feeAuthority: {
          authorityId: feeAuthority.authorityId,
          state: feeAuthority.state,
          economicsState: feeAuthority.economicsState,
          amount: feeAuthority.amount,
          feeEstimateMode: feeAuthority.feeEstimateMode,
          resolutionBlockers: feeAuthority.resolutionBlockers,
          buyerTaxFeeClassification:
            feeAuthority.buyerTaxFeeClassification,
        },
        feeAuthorityReady: current.feeStructure.feeAuthorityReady,
        feeAuthorityReused: currentFeeReady,
        current: {
          status: current.status,
          blockers: current.blockers,
          publicationGate: current.publicationGate,
        },
        artifactContinuation,
        safety: { ownerRoutineApprovalRequired: false,
          publicationCommitAllowed: false,
          publicMarketplaceExposureAllowed: false,
          blindRetryAllowed: false,
          marketplaceWrites: Number(record(
            record(artifactContinuation).safety).marketplaceWrites ?? 0),
          publicationWrites: Number(record(
            record(artifactContinuation).safety)
            .publicationIntentWrites ?? 0),
          adsWrites: 0 },
      }, { status: current.feeStructure.feeAuthorityReady
          && artifactContinuation?.success === true ? 200 : 503 })
    }
    const currentKeywordHandoff =
      await reconcileCurrentFactoryKeywordContinuationsV2_1({
        supabase, accountKey,
      }).catch(() => Object.freeze({
        contractVersion: "CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1",
        status: "FAIL" as const,
        errorCode: "CURRENT_KEYWORD_CONTINUATION_RECONCILIATION_FAILED",
        marketplaceWrites: 0 as const, publicationWrites: 0 as const,
        adsWrites: 0 as const, ownerActionRequired: false as const,
      }))
    // This bounded reconciliation runs through the already scheduled Quick Pick
    // runtime. It makes old and new eligible intake rows discoverable without
    // requiring an owner resubmission or creating another scheduler/worker.
    const productResearchHandoff =
      await reconcileQuickPickProductResearchHandoffV1({
        supabase, accountKey,
      }).catch(() => Object.freeze({
        contractVersion: "QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_V1",
        status: "FAIL" as const,
        errorCode: "QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_RECONCILIATION_FAILED",
        marketplaceWrites: 0 as const,
        ownerActionRequired: false as const,
      }))
    if (req.headers.get("x-seller-os-runtime-lane") ===
        "PUBLISHER_PREAUTHORIZATION_RECOVERY") {
      const recovery = await recoverQuickPickPublisherPackagesV1({
        supabase, accountKey,
      })
      return NextResponse.json({ success: recovery.status === "PASS" &&
          currentKeywordHandoff.status === "PASS",
        recovery, productResearchHandoff, currentKeywordHandoff,
        safety: { sellerOsRuntimeAuthority: true,
          preAuthorizationPreparationOnly: true,
          activeAuthorizedPackagesExcluded: true,
          ownerAuthorizationCreatedCount: 0,
          marketplaceWrites: 0, listingPublications: 0,
          productDecisions: 0, categorySelections: 0,
          publisherDispatches: 0 } },
      { status: recovery.status === "PASS" &&
          currentKeywordHandoff.status === "PASS" ? 200 : 503 })
    }
    const interruptedClaims = await recoverInterruptedLunaQuickPickRuntimeV1({
      supabase, accountKey,
      taxonomyReader: getEbayTaxonomyListingIntelligence,
      productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
    })
    const categoryAuthority = await recoverFalseExactCategoryAuthorityRuntimeV1({
      supabase, accountKey,
      taxonomyReader: getEbayTaxonomyListingIntelligence,
      productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
    })
    const publisherPackages = await recoverQuickPickPublisherPackagesV1({
      supabase, accountKey,
    })
    const success = interruptedClaims.status === "PASS"
      && categoryAuthority.status === "PASS"
      && publisherPackages.status === "PASS"
      && productResearchHandoff.status === "PASS"
      && currentKeywordHandoff.status === "PASS"
    console.info("SELLER_OS_CATEGORY_AUTHORITY_RECOVERY_V1", {
      status: categoryAuthority.status,
      scannedPackageCount: categoryAuthority.scannedPackageCount,
      eligiblePackageCount: categoryAuthority.eligiblePackageCount,
      rematerializedPackageCount:
        categoryAuthority.rematerializedPackageCount,
      marketplaceWrites: categoryAuthority.marketplaceWrites,
    })
    return NextResponse.json({ success,
      recovery: { currentKeywordHandoff, productResearchHandoff, interruptedClaims,
        categoryAuthority, publisherPackages },
      safety: { marketplaceWrites: 0, listingPublications: 0,
        manualFactInjection: 0, codexProductDecisions: 0,
        codexCategorySelection: 0, itemSpecificPatches: 0 } },
    { status: success ? 200 : 503 })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    return NextResponse.json({ success: false,
      error: /^[A-Z][A-Z0-9_]{2,119}$/.test(code) ? code
        : "QUICK_PICK_RECOVERY_FAILED",
      safety: { marketplaceWrites: 0, listingPublications: 0,
        manualFactInjection: 0, codexProductDecisions: 0 } }, { status: 503 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
