import { createClient } from "@supabase/supabase-js"
import { createHash } from "node:crypto"
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const ITEM_IDS = Object.freeze([
  "366543596425", "366569086086", "366574069492", "366575102453",
  "366581670145", "366581718546", "366581941068", "366582544476",
  "366582586826", "366582630351", "366582671136", "366584136876",
  "366584249461", "366584348898", "366588773733", "366592417197",
  "366592485792", "366592919965", "366597434810", "366597514990",
  "366597564952", "366597710103", "366597780377", "366602466981",
  "366608097135", "366608128809",
])

// Candidate discovery evidence recovered from the frozen 26-item P2-I01
// review subject. These tuples are discovery hints only: they never constitute
// an approval and are resolved again against the canonical Luna catalog before
// a protected identity-only read. They are intentionally server-owned and are
// not accepted from CLI/HTTP/MCP caller input.
const RECOVERED_REVIEW_CANDIDATES = Object.freeze({
  "366543596425": ["9220829970656", "48809640722656"],
  "366569086086": ["9220832362720", "48809643409632"],
  "366574069492": ["9220837933280", "48809649504480"],
  "366575102453": ["9220840161504", "48809651699936"],
  "366581670145": ["9220835999968", "48809647177952"],
  "366581718546": ["9220836098272", "48809647276256"],
  "366581941068": ["9220838523104", "48809650094304"],
  "366582544476": ["9220836753632", "48809648095456"],
  "366582586826": ["9220805755104", "48809607659744"],
  "366582630351": ["9220851400928", "48809665724640"],
  "366582671136": ["9220832755936", "48809643802848"],
  "366584136876": ["9220818632928", "48809624535264"],
  "366584249461": ["9220836622560", "48809647931616"],
  "366584348898": ["9220836098272", "48809647276256"],
  "366588773733": ["9220857659616", "48809672769760"],
  "366592417197": ["9220857659616", "48809672769760"],
  "366592485792": ["9220805787872", "48809607692512"],
  "366592919965": ["9220864016608", "53002127507680"],
  "366597434810": ["9220815749344", "48809620930784"],
  "366597514990": ["9220839014624", "48809650585824"],
  "366597564952": ["9635271672032", "51243499913440"],
  "366597710103": ["9220864082144", "48809679814880"],
  "366597780377": ["9220815356128", "48809620504800"],
  "366602466981": ["9220851957984", "53002121347296"],
  "366608097135": ["9220816208096", "48809621848288"],
  "366608128809": ["9220838424800", "48809649996000"],
})
const UNRESOLVED_RETRY_ITEM_IDS = Object.freeze([
  "366582630351", "366602466981",
])

function configuration() {
  if (process.env.P2_I01B_IDENTITY_REVIEW_PREFLIGHT !== "1") {
    throw new Error("P2_I01B_IDENTITY_REVIEW_PREFLIGHT_NOT_AUTHORIZED")
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""
  if (!url || !key) throw new Error("SUPABASE_ADMIN_BINDING_UNAVAILABLE")
  return { url, key }
}

const config = configuration()
const supabase = createClient(config.url, config.key, {
  auth: { persistSession: false, autoRefreshToken: false,
    detectSessionInUrl: false },
})
const [{ resolveSellerOsCurrentLunaIdentityTargetsV1 },
  { createSellerOsLunaIdentityVerificationTargetV1 },
  { createSellerOsLunaIdentityVerificationServerV1 },
  { stableReadonlyCommercialKey }] = await Promise.all([
  import("../lib/ebay/ebay-luna-supplier-linkage-readonly-repository-v1.ts"),
  import("../lib/ebay/ebay-luna-identity-verification-v1.ts"),
  import("../lib/ebay/ebay-luna-identity-verification-server-v1.ts"),
  import("../lib/ebay/commercial-monitor-readonly-utilities.mjs"),
])

const [active, manual] = await Promise.all([
  supabase.from("ebay_active_listings").select("account_key,ebay_item_id")
    .in("ebay_item_id", ITEM_IDS).limit(100),
  supabase.from("ebay_manual_listing_links").select("account_key,ebay_item_id")
    .eq("marketplace_id", "EBAY_US").in("ebay_item_id", ITEM_IDS).limit(100),
])
if (active.error && manual.error) {
  throw new Error("CANONICAL_ACCOUNT_IDENTITY_SOURCE_UNAVAILABLE")
}
const accountKeys = [...new Set([
  ...(active.error ? [] : active.data ?? []),
  ...(manual.error ? [] : manual.data ?? []),
].map((row) => String(row.account_key ?? "").trim()).filter((value) =>
  /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/.test(value)))]
if (accountKeys.length !== 1) {
  throw new Error("CANONICAL_ACCOUNT_IDENTITY_NOT_UNIQUE")
}
const accountKey = accountKeys[0]
const accountAlias = accountKey.split(":", 1)[0]
const digest = stableReadonlyCommercialKey("EBAY_US", accountAlias,
  ...[...ITEM_IDS].sort()).split(":").at(-1)?.slice(0, 20)
if (!digest) throw new Error("CURRENT_COHORT_ID_UNAVAILABLE")
const currentCohortId = `current-live:EBAY_US:${digest}`
const recoveredProductIds = [...new Set(Object.values(
  RECOVERED_REVIEW_CANDIDATES).map(([productId]) => productId))]
const catalogRead = await supabase.from("market_radar_latest_variants")
  .select("supplier_product_id,supplier_variant_id,sku,product_url,snapshot_id")
  .eq("source_key", "lunaportex")
  .in("supplier_product_id", recoveredProductIds)
  .limit(100)
if (catalogRead.error) {
  throw new Error("CURRENT_LUNA_IDENTITY_CATALOG_UNAVAILABLE")
}
const catalogRows = catalogRead.data ?? []
const verify = createSellerOsLunaIdentityVerificationServerV1()
const entries = []
let identityReads = 0
let recoveredCandidateTargets = 0
const verificationItemIds = process.env.P2_I01B_UNRESOLVED_ONLY === "1"
  ? UNRESOLVED_RETRY_ITEM_IDS : ITEM_IDS

for (const ebayItemId of verificationItemIds) {
  let targets
  try {
    targets = await resolveSellerOsCurrentLunaIdentityTargetsV1(supabase, {
      accountKey, currentCohortId, currentItemIds: ITEM_IDS, ebayItemId,
    })
  } catch (cause) {
    entries.push({ ebayItemId, targetCount: 0,
      classification: "IDENTITY_EVIDENCE_INCOMPLETE",
      failureCode: cause instanceof Error ? cause.message
        : "LUNA_IDENTITY_TARGET_RESOLUTION_FAILED" })
    continue
  }
  if (!targets.length) {
    const [productId, variantId] = RECOVERED_REVIEW_CANDIDATES[ebayItemId]
    const matches = catalogRows.filter((row) =>
      row.supplier_product_id === productId &&
      row.supplier_variant_id === variantId &&
      typeof row.sku === "string" && row.sku.trim() &&
      typeof row.product_url === "string" && row.product_url.trim())
    if (matches.length === 1) {
      const row = matches[0]
      const subject = [accountKey, "EBAY_US", currentCohortId, ebayItemId,
        productId, variantId, row.sku, row.snapshot_id]
      const hash = createHash("sha256").update(JSON.stringify(subject))
        .digest("hex")
      try {
        targets = [createSellerOsLunaIdentityVerificationTargetV1({
          currentCohortId,
          candidateId: `luna-linkage-review-candidate-v1:sha256:${hash}`,
          candidateEvidenceDigest: `sha256:${hash}`,
          ebayItemId, lunaProductId: productId, lunaVariantId: variantId,
          lunaSku: row.sku, canonicalSourceUrl: row.product_url,
        })]
        recoveredCandidateTargets += 1
      } catch {
        targets = []
      }
    }
  }
  if (!targets.length) {
    entries.push({ ebayItemId, targetCount: 0,
      classification: "IDENTITY_EVIDENCE_INCOMPLETE",
      failureCode: "CURRENT_LUNA_IDENTITY_TARGET_UNAVAILABLE" })
    continue
  }
  const evidence = []
  for (const target of targets) {
    try {
      identityReads += 1
      evidence.push(await verify(target))
    } catch (cause) {
      evidence.push({ contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1",
        ebayItemId, classification: "IDENTITY_EVIDENCE_INCOMPLETE",
        sourceStatus: "UNAVAILABLE",
        failureCode: cause instanceof Error ? cause.message
          : "LUNA_IDENTITY_VERIFICATION_FAILED" })
    }
  }
  entries.push({ ebayItemId, targetCount: targets.length, evidence })
}

const serialized = JSON.stringify({
  contractVersion: "SELLER_OS_LUNA_IDENTITY_REVIEW_PREFLIGHT_V1",
  currentCohortId,
  currentLiveCount: ITEM_IDS.length,
  entries,
  metrics: {
    lunaIdentityReads: identityReads,
    recoveredCandidateTargets,
    canonicalCatalogRowsRead: catalogRows.length,
    existingEvidenceReusedCount: ITEM_IDS.length,
    verifiedItemCount: verificationItemIds.length,
    lunaStockFactsAccessed: 0,
    lunaStockFactsEmitted: 0,
    lunaStockFactsPersisted: 0,
    databaseWrites: 0,
    ebayTradingCalls: 0,
  },
  safety: {
    credentialsIncluded: false, cookiesIncluded: false,
    rawSourceIncluded: false, stockEvaluated: false,
    marketplaceWrites: 0, vaultWrites: 0,
  },
})
if (/"(?:authorization|cookie|password|secret|credential|inventory_quantity|compare_at_price|available|price)"\s*:/i
  .test(serialized)) {
  throw new Error("P2_I01B_IDENTITY_REVIEW_OUTPUT_UNSAFE")
}
process.stdout.write(`${serialized}\n`)
