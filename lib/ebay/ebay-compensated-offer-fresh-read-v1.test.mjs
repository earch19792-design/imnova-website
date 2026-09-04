import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  classifyCompensatedOfferFreshReadEligibilityV1,
  classifyCompensatedOfferFreshReadV1,
  executeCompensatedOfferFreshReadGateV1,
  isCompensatedPublicationRecoveryErrorCodeV1,
} = await import(
  "./ebay-compensated-offer-fresh-read-v1.ts"
)

const OFFER_ID = "247475747011"
const SKU = "IMNOVA42B4E4B51A124021918289B782A5C6AC"
const ITEM_ID = "366633121948"
const APPROVAL_ID = "8da9dc2f-ec5e-42b4-8b8c-a021d01ceccc"
const EXECUTION_ID = "86a15258-3d6d-4df1-baf4-c2ab4247146d"
const AUTHORIZED_HASH = "a".repeat(64)

function durableState(overrides = {}) {
  return {
    approval: {
      id: APPROVAL_ID,
      status: "consumed",
      revoked_at: null,
      payload_hash: AUTHORIZED_HASH,
    },
    execution: {
      id: EXECUTION_ID,
      approval_id: APPROVAL_ID,
      phase: "completed",
      offer_id: OFFER_ID,
      sku: SKU,
      request_hash: AUTHORIZED_HASH,
    },
    publication: {
      draft_execution_id: EXECUTION_ID,
      draft_approval_id: APPROVAL_ID,
      phase: "terminal_failure",
      offer_id: OFFER_ID,
      sku: SKU,
      listing_id: ITEM_ID,
      publish_attempt_count: 1,
      last_error_code: "EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED",
      sanitized_result: {
        compensatingEndVerified: true,
        officialReadbackNotCurrentLive: true,
      },
    },
    ...overrides,
  }
}

function safeInput(overrides = {}) {
  return {
    expectedOfferId: OFFER_ID,
    expectedSku: SKU,
    expectedHistoricalItemId: ITEM_ID,
    offerVerification: {
      safe: true,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: false,
      associatedListingId: null,
      blocker: "",
    },
    inventoryVerification: { safe: true, blocker: "" },
    historicalItemReadback: {
      ownership: "inactive",
      itemId: ITEM_ID,
      listingStatus: "Ended",
      ebaySku: SKU,
    },
    activeDuplicateCount: 0,
    observedAt: new Date("2026-08-28T21:00:00.000Z"),
    ...overrides,
  }
}

test("unique UNPUBLISHED exact offer is SAFE to rearm existing Golden Path", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput())
  assert.equal(result.OFFER_DISCOVERY_COUNT, 1)
  assert.equal(result.OFFER_ID, OFFER_ID)
  assert.equal(result.OFFER_STATUS, "UNPUBLISHED")
  assert.equal(result.OFFER_HAS_LISTING, false)
  assert.equal(result.ASSOCIATED_LISTING_ID, null)
  assert.equal(result.INVENTORY_ITEM_READBACK_STATUS, "PASS_EXACT_MATCH")
  assert.equal(result.HISTORICAL_ITEM_STATUS, "NOT_ACTIVE")
  assert.equal(result.ACTIVE_DUPLICATE_COUNT, 0)
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION,
    "SAFE_TO_REARM_EXISTING_GOLDEN_PATH")
  assert.equal(result.BLOCKER, null)
  for (const field of ["MARKETPLACE_WRITES", "DATABASE_MUTATIONS",
    "REARM_CALLS", "NEW_OFFERS", "PUBLISH_CALLS", "WITHDRAW_CALLS"]) {
    assert.equal(result[field], 0, field)
  }
})

test("published offer is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: false,
      status: "PUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: ITEM_ID,
      blocker: "EBAY_COMPENSATED_PUBLICATION_RECOVERY_ACTIVE_OR_PUBLISHED_OFFER",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.OFFER_STATUS, "PUBLISHED")
})

test("multiple offers are BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: false,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 2,
      offerHasListing: false,
      associatedListingId: null,
      blocker: "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_AMBIGUOUS",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.OFFER_DISCOVERY_COUNT, 2)
})

test("UNPUBLISHED offer linked to exact inactive historical listing is safe", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: true,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: ITEM_ID,
      blocker: "",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION,
    "SAFE_TO_REARM_EXISTING_GOLDEN_PATH")
  assert.equal(result.OFFER_HAS_LISTING, true)
  assert.equal(result.ASSOCIATED_LISTING_ID, ITEM_ID)
})

test("UNPUBLISHED exact association is BLOCKED when historical listing is active", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: true,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: ITEM_ID,
      blocker: "",
    },
    historicalItemReadback: {
      ownership: "active",
      itemId: ITEM_ID,
      listingStatus: "Active",
      ebaySku: SKU,
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.BLOCKER,
    "EBAY_COMPENSATED_PUBLICATION_ORIGINAL_LISTING_STILL_ACTIVE")
})

test("UNPUBLISHED association to a different historical listing is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: false,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: "366633121949",
      blocker:
        "EBAY_COMPENSATED_PUBLICATION_RECOVERY_HISTORICAL_LISTING_MISMATCH",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.BLOCKER,
    "EBAY_COMPENSATED_PUBLICATION_RECOVERY_HISTORICAL_LISTING_MISMATCH")
})

test("Inventory Item mismatch is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    inventoryVerification: {
      safe: false,
      blocker: "EBAY_INVENTORY_OUTCOME_UNKNOWN",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.INVENTORY_ITEM_READBACK_STATUS, "BLOCKED")
})

test("active duplicate is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    activeDuplicateCount: 1,
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.ACTIVE_DUPLICATE_COUNT, 1)
  assert.equal(result.BLOCKER,
    "EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE")
})

test("exact compensated terminal failure durable state is eligible", () => {
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1(
    durableState(),
  )
  assert.deepEqual(eligibility, {
    eligible: true,
    reasonCode: "COMPENSATED_OFFER_FRESH_READ_REQUIRED",
    verifierExecuted: false,
  })
})

test("exact compensated Quick Pick lineage failure is eligible", () => {
  const state = durableState()
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1({
    ...state,
    publication: {
      ...state.publication,
      last_error_code:
        "EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED",
    },
  })
  assert.equal(eligibility.eligible, true)
  assert.equal(eligibility.reasonCode,
    "COMPENSATED_OFFER_FRESH_READ_REQUIRED")
  assert.equal(isCompensatedPublicationRecoveryErrorCodeV1(
    "EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED",
  ), true)
})

test("eligible gate executes verifier exactly once and emits result", async () => {
  let verifierCalls = 0
  const observed = { OFFER_ID, OFFER_STATUS: "UNPUBLISHED" }
  const result = await executeCompensatedOfferFreshReadGateV1({
    ...durableState(),
    verifier: async () => {
      verifierCalls += 1
      return observed
    },
  })
  assert.equal(verifierCalls, 1)
  assert.equal(result.eligibility.eligible, true)
  assert.equal(result.eligibility.verifierExecuted, true)
  assert.equal(result.compensatedOfferFreshRead, observed)
})

test("ordinary listing GET does not execute verifier", async () => {
  let verifierCalls = 0
  const state = durableState()
  const result = await executeCompensatedOfferFreshReadGateV1({
    ...state,
    publication: { ...state.publication, phase: "published" },
    verifier: async () => {
      verifierCalls += 1
      return {}
    },
  })
  assert.equal(verifierCalls, 0)
  assert.equal(result.eligibility.eligible, false)
  assert.equal(result.eligibility.verifierExecuted, false)
  assert.equal(result.compensatedOfferFreshRead, null)
})

test("wrong terminal error code is not eligible", () => {
  const state = durableState()
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1({
    ...state,
    publication: {
      ...state.publication,
      last_error_code: "EBAY_PUBLISH_WRITE_REJECTED",
    },
  })
  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reasonCode,
    "COMPENSATED_OFFER_FRESH_READ_ERROR_CODE_NOT_ELIGIBLE")
})

test("unverified compensation is not eligible", () => {
  const state = durableState()
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1({
    ...state,
    publication: {
      ...state.publication,
      sanitized_result: {
        compensatingEndVerified: false,
        officialReadbackNotCurrentLive: true,
      },
    },
  })
  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reasonCode,
    "COMPENSATED_OFFER_FRESH_READ_COMPENSATION_NOT_VERIFIED")
})

test("authenticated GET fresh-read branch contains reads only and no rearm", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const start = route.indexOf(
    "async function readCompensatedPublicationFreshSafety(",
  )
  const end = route.indexOf("async function readExactUnpublishedPublicationState(", start)
  assert.ok(start >= 0 && end > start)
  const branch = route.slice(start, end)
  assert.match(branch, /verifyEbayCompensatedOfferRecoveryState/)
  assert.match(branch, /verifyEbayDraftInventoryItem/)
  assert.match(branch, /readManualListingFromTradingApi/)
  assert.match(branch, /listing_status", "active"/)
  assert.match(branch, /Promise\.allSettled/)
  assert.doesNotMatch(branch, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/)
  assert.doesNotMatch(branch, /rearmFinalPublication|publishEbayOfferOnce|createEbayUnpublishedOffer/)
})

test("GET exposes eligibility and fresh read as explicit top-level fields", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, postStart)
  assert.match(get, /executeCompensatedOfferFreshReadGateV1\(\{/)
  assert.match(get, /compensatedOfferFreshReadEligibility,\s*compensatedOfferFreshRead,/)
  assert.match(get,
    /"Cache-Control": "private, no-store, no-cache, max-age=0"/)
})

test("authenticated Workspace rearms only after the fresh SAFE gate", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const workspace = readFileSync(
    new URL("../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url),
    "utf8",
  )
  const effectStart = workspace.indexOf(
    "const eligibility = draftState.compensatedOfferFreshReadEligibility",
  )
  const effectEnd = workspace.indexOf(
    "if (accountPreflightAutoStarted.current) return",
    effectStart,
  )
  const effect = workspace.slice(effectStart, effectEnd)
  assert.ok(effectStart > 0 && effectEnd > effectStart)
  assert.match(effect,
    /verifierExecuted !== true[\s\S]*SAFE_TO_REARM_EXISTING_GOLDEN_PATH/)
  assert.match(effect, /freshRead\.OFFER_ID !== expectedOfferId/)
  assert.equal((effect.match(/action: "rearm_publish"/g) ?? []).length, 1)
  assert.doesNotMatch(effect,
    /action: "(?:approve|execute|publish|reconcile_publish)"/)
  assert.doesNotMatch(effect,
    /createEbayUnpublishedOffer|createOrReplaceEbayDraftInventoryItem|withdraw/)
  assert.match(effect, /ebayWriteUsed !== false/)
  assert.match(effect, /REARMED_AWAITING_HUMAN_PUBLICATION/)
  assert.match(effect, /setPublicationAutomationStartedAt\(Date\.now\(\)\)/)

  const rearmStart = route.indexOf("async function rearmFinalPublication(")
  const rearmEnd = route.indexOf(
    "async function reconcileFinalPublication(",
    rearmStart,
  )
  const rearm = route.slice(rearmStart, rearmEnd)
  const freshReadIndex = rearm.indexOf(
    "readCompensatedPublicationFreshSafety",
  )
  const safeClassificationIndex = rearm.indexOf(
    "SAFE_TO_REARM_EXISTING_GOLDEN_PATH",
  )
  const rearmRpcIndex = rearm.indexOf(".rpc(rearmRpc")
  assert.ok(freshReadIndex > 0)
  assert.ok(safeClassificationIndex > freshReadIndex)
  assert.ok(rearmRpcIndex > safeClassificationIndex)
  assert.doesNotMatch(rearm,
    /publishEbayOfferOnce|createEbayUnpublishedOffer|createOrReplaceEbayDraftInventoryItem|withdrawEbayOffer/)
  assert.match(rearm,
    /compensatedRearmLedgerOnly: compensatedAttachmentFailure/)
  assert.match(rearm,
    /if \(!compensatedAttachmentFailure\) \{[\s\S]*revalidateFinalPublicationDependencies/)
  assert.match(rearm,
    /isCompensatedPublicationRecoveryErrorCodeV1\([\s\S]*publication\.last_error_code/)
  assert.match(rearm,
    /const expectedErrorCode = compensatedAttachmentFailure[\s\S]*text\(publication\.last_error_code\)/)
})

test("compensated hydration preserves the package until the existing rearm RPC", () => {
  const commandCenter = readFileSync(
    new URL("../../app/api/admin/ebay/command-center/route.ts", import.meta.url),
    "utf8",
  )
  const prepareStart = commandCenter.indexOf('if (action === "prepare_package")')
  const saveStart = commandCenter.indexOf('if (action === "save_package")', prepareStart)
  const prepare = commandCenter.slice(prepareStart, saveStart)
  const recoveryRead = prepare.indexOf(
    "compensatedPublicationHydrationIsReadOnly",
  )
  const recoveryReturn = prepare.indexOf(
    'hydrationMode: "COMPENSATED_PUBLICATION_RECOVERY_READ_ONLY"',
  )
  const normalRefresh = prepare.indexOf(
    "resolveSmartStockingListingWorkspaceEvidenceV1",
  )
  assert.ok(recoveryRead > 0)
  assert.ok(recoveryReturn > recoveryRead)
  assert.ok(normalRefresh > recoveryReturn)
  const readOnlyBranch = prepare.slice(recoveryRead, normalRefresh)
  assert.match(readOnlyBranch, /databaseWriteUsed: false/)
  assert.doesNotMatch(readOnlyBranch,
    /\.rpc\(|\.update\(|\.insert\(|\.upsert\(|\.delete\(/)
})

test("compensated rearm uses durable lineage without weakening publish readiness", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260828215432_rearm_compensated_publication_from_durable_lineage_v1.sql",
    import.meta.url,
  ), "utf8")
  const loaderStart = route.indexOf("async function loadFinalPublicationContext(")
  const dependencyStart = route.indexOf(
    "async function revalidateFinalPublicationDependencies(",
  )
  const loader = route.slice(loaderStart, dependencyStart)
  assert.match(loader,
    /if \(options\.compensatedRearmLedgerOnly\)[\s\S]*EBAY_COMPENSATED_PUBLICATION_DURABLE_LINEAGE_CHANGED/)
  assert.ok(loader.indexOf("return {") <
    loader.indexOf("resolveSmartStockingAuthorizedPublicationV1"))
  assert.match(loader, /approval\.payload_hash !== execution\.request_hash/)
  assert.match(loader, /execution\.phase !== "completed"/)
  assert.doesNotMatch(migration,
    /is_ebay_smart_stocking_authorized_publication_v1/)
  assert.match(migration,
    /v_execution\.request_hash is distinct from v_approval\.payload_hash/)
  assert.match(migration,
    /v_publication\.preview->'offerPayload' is distinct from[\s\S]*v_approval\.approved_payload->'offerPayload'/)
  assert.equal((migration.match(
    /update public\.ebay_authorized_listing_publications/g,
  ) ?? []).length, 1)
  assert.doesNotMatch(migration,
    /insert into|delete from|update public\.ebay_listing_packages|update public\.ebay_luna_opportunity_queue/i)
})

test("compensated rearm invokes the installed PostgreSQL RPC identifier", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260828215432_rearm_compensated_publication_from_durable_lineage_v1.sql",
    import.meta.url,
  ), "utf8")
  const declaredIdentifier = migration.match(
    /public\.(rearm_ebay_authorized_listing_after_compensated_monitor_failure_once)\s*\(/,
  )?.[1]
  const rearmStart = route.indexOf("async function rearmFinalPublication(")
  const rearmEnd = route.indexOf(
    "async function reconcileFinalPublication(",
    rearmStart,
  )
  const invokedIdentifier = route.slice(rearmStart, rearmEnd).match(
    /const rearmRpc = compensatedAttachmentFailure\s*\? "([^"]+)"/,
  )?.[1]
  const postgresIdentifierLimit = 63

  assert.ok(declaredIdentifier)
  assert.ok(invokedIdentifier)
  assert.ok(Buffer.byteLength(invokedIdentifier, "utf8") <=
    postgresIdentifierLimit)
  assert.equal(
    invokedIdentifier,
    declaredIdentifier.slice(0, postgresIdentifierLimit),
  )
})

test("Quick Pick lineage handoff keeps exact guards and bounded recovery", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260902000630_reconcile_quick_pick_publication_lineage_v1.sql",
    import.meta.url,
  ), "utf8")
  assert.match(migration,
    /is_ebay_quick_pick_authorized_publication_v1/)
  assert.match(migration,
    /SELLER_OS_QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1/)
  assert.match(migration,
    /QUICK_PICK_DURABLE_GOLDEN_PATH_REVALIDATION_V1/)
  assert.match(migration,
    /coalesce\(v_authorization ->> 'gtin', ''\)/)
  assert.match(migration,
    /SELLER_OS_SMART_STOCKING_AUTHORIZED_PUBLICATION_V1/)
  assert.match(migration,
    /SMART_STOCKING_EXACT_PRODUCT_TRUTH_DURABLE_REVALIDATION_V1/)
  assert.match(migration,
    /EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED/)
  assert.match(migration, /MANUAL_LIVE_SUCCESSOR/)
  assert.doesNotMatch(migration,
    /insert into|delete from|update public\./i)
  assert.doesNotMatch(migration,
    /publishEbayOfferOnce|publishOffer|createEbayUnpublishedOffer|EndFixedPriceItem/)
})

test("Workspace image copy never invents a canonical package count", () => {
  const workspace = readFileSync(
    new URL("../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(workspace,
    /Las siete imágenes aprobadas se inspeccionan/)
  assert.match(workspace,
    /Las imágenes canónicas aprobadas se inspeccionan y se sellan por posición/)
})

test("auth failure returns before verifier and every GET path is write-free", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, postStart)
  assert.ok(get.indexOf("await authenticate(req)") >= 0)
  assert.ok(get.indexOf("if (auth.response) return auth.response") >
    get.indexOf("await authenticate(req)"))
  assert.ok(get.indexOf("executeCompensatedOfferFreshReadGateV1") >
    get.indexOf("if (auth.response) return auth.response"))
  assert.doesNotMatch(get, /\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  assert.doesNotMatch(get,
    /publishEbayOfferOnce|createEbayUnpublishedOffer|withdraw|rearm/i)
})
