import { createReadStream, lstatSync, realpathSync } from "node:fs"
import { registerHooks } from "node:module"
import { createInterface } from "node:readline"

import { createClient } from "@supabase/supabase-js"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const [{
  SELLER_OS_P2_I01C_FROZEN_COHORT_ID,
  SELLER_OS_P2_I01C_FROZEN_ITEM_IDS,
  SELLER_OS_P2_I01C_RECEIPT_SOURCE_PATH,
  buildSellerOsLunaLinkageReviewActivationV1,
  createSellerOsLunaLinkageReviewActivationOutputV1,
}, { createSellerOsLunaLinkageApprovalRepositoryV1 },
  { stableReadonlyCommercialKey }] = await Promise.all([
  import("../lib/ebay/ebay-luna-linkage-review-activation-v1.ts"),
  import("../lib/ebay/ebay-luna-linkage-approval-repository-v1.ts"),
  import("../lib/ebay/commercial-monitor-readonly-utilities.mjs"),
])

const RECEIPT_VERSION = "SELLER_OS_LUNA_IDENTITY_REVIEW_PREFLIGHT_V1"
const MAXIMUM_SOURCE_BYTES = 150_000_000
const MAXIMUM_SELECTED_RECEIPT_BYTES = 20_000_000
const ACCOUNT_KEY = /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/

function fail(code) {
  throw new Error(code)
}

function configuration() {
  const persistValue = process.env.P2_I01C_REVIEW_SET_PERSIST?.trim() ?? ""
  if (!["", "0", "1"].includes(persistValue)) {
    fail("P2_I01C_REVIEW_SET_PERSIST_GATE_INVALID")
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""
  if (!url || !serviceRoleKey) fail("SUPABASE_ADMIN_BINDING_UNAVAILABLE")
  return Object.freeze({
    url,
    serviceRoleKey,
    persistenceRequested: persistValue === "1",
  })
}

async function readSanitizedReceiptLines() {
  const path = SELLER_OS_P2_I01C_RECEIPT_SOURCE_PATH
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path ||
      stat.size < 1 || stat.size > MAXIMUM_SOURCE_BYTES ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_SOURCE_INVALID")
  }
  const selected = []
  let selectedBytes = 0
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  for await (const line of lines) {
    if (!line.includes(RECEIPT_VERSION)) continue
    const bytes = Buffer.byteLength(line, "utf8") + 1
    selectedBytes += bytes
    if (selectedBytes > MAXIMUM_SELECTED_RECEIPT_BYTES) {
      lines.close()
      fail("LUNA_LINKAGE_REVIEW_RECEIPT_SELECTION_TOO_LARGE")
    }
    selected.push(line)
  }
  if (!selected.length) fail("LUNA_LINKAGE_REVIEW_RECEIPT_MISSING")
  return `${selected.join("\n")}\n`
}

async function resolveCanonicalAccountKey(supabase) {
  const [active, manual] = await Promise.all([
    supabase.from("ebay_active_listings")
      .select("account_key,ebay_item_id")
      .in("ebay_item_id", SELLER_OS_P2_I01C_FROZEN_ITEM_IDS)
      .limit(100),
    supabase.from("ebay_manual_listing_links")
      .select("account_key,ebay_item_id")
      .eq("marketplace_id", "EBAY_US")
      .in("ebay_item_id", SELLER_OS_P2_I01C_FROZEN_ITEM_IDS)
      .limit(100),
  ])
  if (active.error || manual.error) {
    fail("CANONICAL_ACCOUNT_IDENTITY_SOURCE_UNAVAILABLE")
  }
  const frozenIds = new Set(SELLER_OS_P2_I01C_FROZEN_ITEM_IDS)
  const rows = [...(active.data ?? []), ...(manual.data ?? [])]
  if (!rows.length || rows.some((row) =>
    !frozenIds.has(String(row.ebay_item_id ?? "")))) {
    fail("CANONICAL_ACCOUNT_IDENTITY_SUBJECT_INVALID")
  }
  const accountKeys = [...new Set(rows.map((row) =>
    String(row.account_key ?? "").trim()).filter((value) =>
      ACCOUNT_KEY.test(value)))]
  if (accountKeys.length !== 1 || rows.some((row) =>
    String(row.account_key ?? "").trim() !== accountKeys[0])) {
    fail("CANONICAL_ACCOUNT_IDENTITY_NOT_UNIQUE")
  }
  const accountKey = accountKeys[0]
  const accountAlias = accountKey.split(":", 1)[0]
  const digest = stableReadonlyCommercialKey(
    "EBAY_US",
    accountAlias,
    ...[...SELLER_OS_P2_I01C_FROZEN_ITEM_IDS].sort(),
  ).split(":").at(-1)?.slice(0, 20)
  if (`current-live:EBAY_US:${digest ?? ""}` !==
      SELLER_OS_P2_I01C_FROZEN_COHORT_ID) {
    fail("CANONICAL_ACCOUNT_COHORT_BINDING_MISMATCH")
  }
  return accountKey
}

async function assertNoExistingDecisions(supabase) {
  const result = await supabase.from("seller_os_luna_linkage_decisions")
    .select("decision_id", { count: "exact", head: true })
  if (result.error || result.count !== 0) {
    fail("P2_I01C_EXISTING_HUMAN_DECISIONS_REQUIRE_RECONCILIATION")
  }
  return 0
}

function emit(value) {
  const serialized = JSON.stringify(value)
  if (/"(?:accountKey|authorization|cookie|cookieHeader|password|secret|credential|serviceRoleKey|rawSource|sessionMaterial)"\s*:/i
    .test(serialized)) {
    fail("P2_I01C_REVIEW_ACTIVATION_OUTPUT_UNSAFE")
  }
  process.stdout.write(`${serialized}\n`)
}

const config = configuration()
const supabase = createClient(config.url, config.serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
const [sessionLogText, accountKey] = await Promise.all([
  readSanitizedReceiptLines(),
  resolveCanonicalAccountKey(supabase),
])
const plan = buildSellerOsLunaLinkageReviewActivationV1({
  receiptSourcePath: SELLER_OS_P2_I01C_RECEIPT_SOURCE_PATH,
  sessionLogText,
  accountKey,
  now: new Date().toISOString(),
})
await assertNoExistingDecisions(supabase)

if (!config.persistenceRequested) {
  emit(createSellerOsLunaLinkageReviewActivationOutputV1({
    plan,
    persistence: { requested: false, status: "NOT_REQUESTED" },
  }))
  process.exit(0)
}

emit(Object.freeze({
  contractVersion: "SELLER_OS_LUNA_LINKAGE_REVIEW_ACTIVATION_PREWRITE_V1",
  currentCohortId: plan.reviewSet.currentCohortId,
  currentLiveCount: plan.reviewSet.currentLiveCount,
  reviewSetId: plan.reviewSet.reviewSetId,
  reviewSetDigest: plan.reviewSet.reviewSetDigest,
  decisionCount: 0,
  reviewSetMutationCalls: 0,
  decisionRpcCalls: 0,
  safety: Object.freeze({
    ebayCalls: 0,
    lunaReads: 0,
    stockEvaluated: false,
    credentialsIncluded: false,
    cookiesIncluded: false,
  }),
}))
const repository = createSellerOsLunaLinkageApprovalRepositoryV1(supabase)
const receipt = await repository.replaceReviewSet(plan.reviewSet)
emit(createSellerOsLunaLinkageReviewActivationOutputV1({
  plan,
  persistence: { requested: true, status: receipt.status },
}))
