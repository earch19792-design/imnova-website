import {
  SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS,
  buildSellerOsLunaLinkageReviewEntryV2,
  buildSellerOsLunaLinkageReviewSetV2,
  type SellerOsLunaLinkageReviewClassificationV2,
  type SellerOsLunaLinkageReviewEntryV2,
  type SellerOsLunaLinkageReviewSetV2,
} from "./ebay-luna-linkage-approval-control-plane-v1"

export const SELLER_OS_LUNA_LINKAGE_REVIEW_ACTIVATION_VERSION =
  "SELLER_OS_LUNA_LINKAGE_REVIEW_ACTIVATION_V1" as const
export const SELLER_OS_P2_I01C_FROZEN_COHORT_ID =
  "current-live:EBAY_US:65d937e5538aa26c3c00" as const
export const SELLER_OS_P2_I01C_RECEIPT_SOURCE_PATH =
  "/home/earch/.codex/sessions/2026/08/21/" +
  "rollout-2026-08-21T11-25-50-01a0255b-881d-7a83-b265-f200915ea572.jsonl"

const RECEIPT_VERSION = "SELLER_OS_LUNA_IDENTITY_REVIEW_PREFLIGHT_V1"
const IDENTITY_VERSION = "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1"
const MAXIMUM_SESSION_LOG_BYTES = 150_000_000
const MAXIMUM_CLOCK_SKEW_MS = 5 * 60_000
const DIGEST = /^luna-identity-v1:sha256:[0-9a-f]{64}$/
const CURRENT_IDENTITY_REFERENCE = /^luna-current-identity:[0-9a-f]{64}$/
const CANDIDATE_ID =
  /^luna-linkage-review-candidate-v1:sha256:[0-9a-f]{64}$/
const CANDIDATE_DIGEST = /^sha256:[0-9a-f]{64}$/
const ACCOUNT_KEY = /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/

export const SELLER_OS_P2_I01C_FROZEN_ITEM_IDS = Object.freeze([
  "366543596425", "366569086086", "366574069492", "366575102453",
  "366581670145", "366581718546", "366581941068", "366582544476",
  "366582586826", "366582630351", "366582671136", "366584136876",
  "366584249461", "366584348898", "366588773733", "366592417197",
  "366592485792", "366592919965", "366597434810", "366597514990",
  "366597564952", "366597710103", "366597780377", "366602466981",
  "366608097135", "366608128809",
] as const)

type FrozenItemId = typeof SELLER_OS_P2_I01C_FROZEN_ITEM_IDS[number]

type FrozenListing = Readonly<{
  ebaySku: string | null
  listingTitle: string
  classification: SellerOsLunaLinkageReviewClassificationV2
  linkageMode:
    | "SINGLE_COMPONENT"
    | "SIMPLE_MULTIPLIER"
    | "MULTI_COMPONENT_BOM"
  supplierQuantityRequired: number
  conflictSignals: readonly string[]
  requiredBundleComponents: readonly string[]
}>

type ExpectedLunaIdentity = Readonly<{
  productId: string
  variantId: string
  sku: string
}>

type CurrentIdentity = Readonly<{
  productId: string
  productTitle: string
  handle: string
  variantId: string
  variantTitle: string
  sku: string
  barcode: string | null
  model: string | null
  structuredVariantAttributes: readonly Readonly<{
    name: string
    value: string
  }>[]
}>

type VerifiedEvidence = Readonly<{
  ebayItemId: FrozenItemId
  currentLunaIdentity: CurrentIdentity
  defaultTitleOnly: true
  configurationProven: false
  observedAt: string
  evidenceDigest: string
}>

const FROZEN_LISTINGS: Readonly<Record<FrozenItemId, FrozenListing>> =
  Object.freeze({
    "366543596425": Object.freeze({
      ebaySku: "IMN-LST-000003",
      listingTitle: "Lysol To Go Disinfecting Wipes Lemon Lime Blossom 15 Ct 3 Pack Travel Size",
      classification: "CONFLICTING_MATCH",
      linkageMode: "SIMPLE_MULTIPLIER",
      supplierQuantityRequired: 3,
      conflictSignals: Object.freeze([
        "LISTING_IDENTITY_REPRESENTATION_CONFLICT",
        "SUPPLIER_QUANTITY_HUMAN_CONFIRMATION_REQUIRED",
      ]),
      requiredBundleComponents: Object.freeze(["LYSOL_WIPES_UNIT_X3"]),
    }),
    "366569086086": bundle(
      "IMN-LST-000001",
      "40L Tactical Backpack MOLLE 3 Day Assault Pack Black Sunglasses Bundle",
      ["BACKPACK", "SUNGLASSES"],
    ),
    "366574069492": unresolved(
      "IMN-LST-000015",
      "Digital Kitchen Food Scale Nutrition Calculator Calories Macros Meal Prep LCD",
    ),
    "366575102453": unresolved(
      "IMNOVABB1275E4372746779DF3FDB3DBD3C652",
      "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
      ["HISTORICAL_MAPPING_BELONGS_TO_DIFFERENT_EBAY_ITEM"],
    ),
    "366581670145": bundle(
      "IMN-LST-000002",
      "Chest Crossbody Bag Sling Backpack for Men USB Charge Port Black w/ Sunglasses",
      ["BLACK_CROSSBODY_BAG", "SUNGLASSES"],
    ),
    "366581718546": unresolved(
      "IMN-LST-000013",
      "Chest Crossbody Bag Sling Backpack for Men USB Charge Port Brown PU Leather",
    ),
    "366581941068": Object.freeze({
      ebaySku: "IMN-LST-000008",
      listingTitle: "Wireless-N WiFi Repeater 300Mbps Range Extender Signal Booster WPS Ethernet",
      classification: "AMBIGUOUS_MATCH",
      linkageMode: "SINGLE_COMPONENT",
      supplierQuantityRequired: 1,
      conflictSignals: Object.freeze([
        "MULTIPLE_PLAUSIBLE_LUNA_PRODUCTS",
        "DEFAULT_TITLE_CONFIGURATION_UNPROVEN",
      ]),
      requiredBundleComponents: Object.freeze([]),
    }),
    "366582544476": unresolved(
      "IMN-LST-000012",
      "Handheld Car Vacuum Cleaner 9000Pa 2-in-1 Air Duster 120W Cordless Rechargeable",
    ),
    "366582586826": unresolved(
      "IMN-LST-000011",
      "Z6 AI Translator 138 Languages Two-Way Voice Offline Photo 4.1in Touchscreen",
    ),
    "366582630351": Object.freeze({
      ebaySku: "IMN-LST-000014",
      listingTitle: "2 Pack Ultrasonic Pest Control Repeller Plug-In Indoor Mouse Insect Repellent",
      classification: "IDENTITY_EVIDENCE_INCOMPLETE",
      linkageMode: "SIMPLE_MULTIPLIER",
      supplierQuantityRequired: 2,
      conflictSignals: Object.freeze([
        "PACK_COUNT_REQUIRES_HUMAN_CONFIRMATION",
        "SUPPLIER_QUANTITY_HUMAN_CONFIRMATION_REQUIRED",
      ]),
      requiredBundleComponents: Object.freeze(["ULTRASONIC_REPELLER_UNIT_X2"]),
    }),
    "366582671136": unresolved(
      "IMN-LST-000005",
      "Women's Butterfly & Heart Layered Necklace Adjustable Chain Pendant Boho Gold",
    ),
    "366584136876": bundle(
      "IMN-LST-000016",
      "Under Cabinet Paper Towel Holder & Stone Dish Drying Mat 2 Piece Bundle",
      ["PAPER_TOWEL_HOLDER", "STONE_DRYING_MAT"],
    ),
    "366584249461": bundle(
      "IMN-LST-000017",
      "32oz Cold Brew Coffee Maker Pitcher Fine Mesh Filter Stone Drying Mat Bundle",
      ["COLD_BREW_MAKER", "STONE_DRYING_MAT"],
    ),
    "366584348898": bundle(
      "IMN-LST-000010",
      "Chest Crossbody Bag Sling Backpack for Men USB Charge Port Brown w/ Power Bank",
      ["BROWN_CROSSBODY_BAG", "POWER_BANK"],
    ),
    "366588773733": bundle(
      "IMN-LST-000022",
      "3 Piece Dog Car Travel Kit Seat Cover Tether Handheld Vacuum Cleaning Bundle",
      ["DOG_SEAT_COVER", "DOG_TETHER", "HANDHELD_VACUUM"],
    ),
    "366592417197": unresolved(
      "IMN-LST-000023",
      "Dog Car Seat Cover Hammock Back Seat Waterproof Car Truck SUV 600D Oxford Black",
    ),
    "366592485792": unresolved(
      "IMN-LST-000024",
      "S80 Language Translator 138 Languages AI Voice Two-Way Portable 14 Offline Black",
    ),
    "366592919965": unresolved(
      "IMN-LST-000026",
      "Men's 14K Gold Plated White Sapphire Statement Cocktail Ring Adjustable Size",
      ["DUPLICATE_EBAY_SKU_CONFLICT"],
    ),
    "366597434810": unresolved(
      "IMN-LST-000025",
      "Mini Body Camera 1080P Portable Pocket Wearable Video Recorder No WiFi",
    ),
    "366597514990": conflicting(
      "IMN-LST-000026",
      "Dog Cat Food & Water Bowl Set with Gravity Water Dispenser Pink",
      ["DUPLICATE_EBAY_SKU_CONFLICT"],
    ),
    "366597564952": unresolved(
      "IMN-LST-000027",
      "EMS Abdominal Muscle Toning Trainer ABS Stimulator Battery Powered Home Fitness",
    ),
    "366597710103": unresolved(
      "IMN-LST-000028",
      "Boho Macrame Table Runner 12x72 Woven Cotton Jute Tassels Farmhouse Decor",
    ),
    "366597780377": conflicting(
      "IMN-LST-000029",
      "Automatic Dog Bark Control Collar Dual Mode Adjustable Training Black Green",
      ["SUPPLIER_PACK_CONFIGURATION_CONFLICT"],
    ),
    "366602466981": Object.freeze({
      ebaySku: "FL-3SISTER-KEYCHAIN",
      listingTitle: "Big Middle Little Sister Heart Key Chain 3 Piece Puzzle Silver Gift Set",
      classification: "EXACT_UNIQUE_MATCH",
      linkageMode: "SINGLE_COMPONENT",
      supplierQuantityRequired: 1,
      conflictSignals: Object.freeze([
        "HISTORICAL_MAPPING_BELONGS_TO_DIFFERENT_EBAY_ITEM",
        "DEFAULT_TITLE_CONFIGURATION_UNPROVEN",
      ]),
      requiredBundleComponents: Object.freeze([]),
    }),
    "366608097135": unresolved(
      null,
      "Paper Towel Holder Under Cabinet Stainless Steel Wall Mount Self Adhesive SUS304",
    ),
    "366608128809": unresolved(
      null,
      "Retractable Car Charger 4 in 1 Fast Car Phone Charger 120W With USB Type C Cable",
    ),
  })

export const SELLER_OS_P2_I01C_EXPECTED_LUNA_IDENTITIES = Object.freeze({
  "366543596425": identity("9220829970656", "48809640722656", "ITEM3995"),
  "366569086086": identity("9220832362720", "48809643409632", "ITEM3752"),
  "366574069492": identity("9220837933280", "48809649504480", "Jhoel-Food Scale-with Nutritional-Calculator-B0CS36YWSB"),
  "366575102453": identity("9220840161504", "48809651699936", "ITEM3155"),
  "366581670145": identity("9220835999968", "48809647177952", "Alibaba-Body-Bag-Black-B07PJK56FP"),
  "366581718546": identity("9220836098272", "48809647276256", "Alibaba-Body-Bag-Brown-B0BGK71P7X-1"),
  "366581941068": identity("9220838523104", "48809650094304", "ITEM3310"),
  "366582544476": identity("9220836753632", "48809648095456", "ITEM3429"),
  "366582586826": identity("9220805755104", "48809607659744", "ITEM5810"),
  "366582630351": identity("9220851400928", "48809665724640", "FL-CONTROL-ULTRASONIC"),
  "366582671136": identity("9220832755936", "48809643802848", "ITEM3704"),
  "366584136876": identity("9220818632928", "48809624535264", "ITEM4895"),
  "366584249461": identity("9220836622560", "48809647931616", "Alibaba-ColdBrew-CoffeeMaker-B00FFLY64U"),
  "366584348898": identity("9220836098272", "48809647276256", "Alibaba-Body-Bag-Brown-B0BGK71P7X-1"),
  "366588773733": identity("9220857659616", "48809672769760", "FL-DOG-BACK-SEAT-COVER"),
  "366592417197": identity("9220857659616", "48809672769760", "FL-DOG-BACK-SEAT-COVER"),
  "366592485792": identity("9220805787872", "48809607692512", "ITEM5803"),
  "366592919965": identity("9220864016608", "53002127507680", "FL-LUXURY-MEN-RING"),
  "366597434810": identity("9220815749344", "48809620930784", "ITEM5195"),
  "366597514990": identity("9220839014624", "48809650585824", "M-Cat-Food-and-Water-Bowl-Set-Pink-B08T692F2S"),
  "366597564952": identity("9635271672032", "51243499913440", "ITEM898"),
  "366597710103": identity("9220864082144", "48809679814880", "FL-Mac-Table-Runner"),
  "366597780377": identity("9220815356128", "48809620504800", "ITEM5254"),
  "366602466981": identity("9220851957984", "53002121347296", "FL-3SISTER-KEYCHAIN"),
  "366608097135": identity("9220816208096", "48809621848288", "ITEM5133"),
  "366608128809": identity("9220838424800", "48809649996000", "M-Retractable-Fast-Car-Phone-Charger-B0CC4LM6V1"),
} satisfies Record<FrozenItemId, ExpectedLunaIdentity>)

function bundle(ebaySku: string, listingTitle: string,
  requiredBundleComponents: readonly string[]): FrozenListing {
  return Object.freeze({
    ebaySku, listingTitle,
    classification: "BUNDLE_INCOMPLETE" as const,
    linkageMode: "MULTI_COMPONENT_BOM" as const,
    supplierQuantityRequired: 1,
    conflictSignals: Object.freeze([
      "BUNDLE_COMPONENTS_INCOMPLETE",
      "ALL_BOM_COMPONENTS_REQUIRED",
    ]),
    requiredBundleComponents: Object.freeze([...requiredBundleComponents]),
  })
}

function unresolved(ebaySku: string | null,
  listingTitle: string, additionalConflicts: readonly string[] = []): FrozenListing {
  return Object.freeze({
    ebaySku, listingTitle,
    classification: "IDENTITY_EVIDENCE_INCOMPLETE" as const,
    linkageMode: "SINGLE_COMPONENT" as const,
    supplierQuantityRequired: 1,
    conflictSignals: Object.freeze([
      ...additionalConflicts,
      "DEFAULT_TITLE_CONFIGURATION_UNPROVEN",
      "STRUCTURED_VARIANT_ATTRIBUTES_MISSING",
    ]),
    requiredBundleComponents: Object.freeze([]),
  })
}

function conflicting(ebaySku: string | null, listingTitle: string,
  conflicts: readonly string[]): FrozenListing {
  return Object.freeze({
    ebaySku, listingTitle,
    classification: "CONFLICTING_MATCH" as const,
    linkageMode: "SINGLE_COMPONENT" as const,
    supplierQuantityRequired: 1,
    conflictSignals: Object.freeze([
      ...conflicts,
      "DEFAULT_TITLE_CONFIGURATION_UNPROVEN",
    ]),
    requiredBundleComponents: Object.freeze([]),
  })
}

function identity(productId: string, variantId: string,
  sku: string): ExpectedLunaIdentity {
  return Object.freeze({ productId, variantId, sku })
}

function fail(code: string): never {
  throw new Error(code)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",")
}

function safeText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

function finiteTimestamp(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null
  }
  return new Date(value).toISOString()
}

function isFrozenItemId(value: unknown): value is FrozenItemId {
  return typeof value === "string" &&
    (SELLER_OS_P2_I01C_FROZEN_ITEM_IDS as readonly string[]).includes(value)
}

function safeInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum &&
    Number(value) <= maximum ? Number(value) : null
}

function validateMetrics(value: unknown, entryCount: number) {
  const metrics = record(value)
  const allowed = new Set([
    "canonicalCatalogRowsRead", "databaseWrites", "ebayTradingCalls",
    "existingEvidenceReusedCount", "lunaIdentityReads",
    "lunaStockFactsAccessed", "lunaStockFactsEmitted",
    "lunaStockFactsPersisted", "recoveredCandidateTargets",
    "verifiedItemCount",
  ])
  if (Object.keys(metrics).some((key) => !allowed.has(key)) ||
      safeInteger(metrics.lunaIdentityReads, 0, 50) === null ||
      metrics.databaseWrites !== 0 || metrics.ebayTradingCalls !== 0 ||
      metrics.lunaStockFactsAccessed !== 0 ||
      metrics.lunaStockFactsEmitted !== 0 ||
      metrics.lunaStockFactsPersisted !== 0 ||
      (metrics.existingEvidenceReusedCount !== undefined &&
        metrics.existingEvidenceReusedCount !== 26) ||
      (metrics.verifiedItemCount !== undefined &&
        metrics.verifiedItemCount !== entryCount)) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_METRICS_INVALID")
  }
}

function validateSafety(value: unknown) {
  const safety = record(value)
  if (!exactKeys(safety, [
    "cookiesIncluded", "credentialsIncluded", "marketplaceWrites",
    "rawSourceIncluded", "stockEvaluated", "vaultWrites",
  ]) || safety.cookiesIncluded !== false ||
      safety.credentialsIncluded !== false ||
      safety.rawSourceIncluded !== false || safety.stockEvaluated !== false ||
      safety.marketplaceWrites !== 0 || safety.vaultWrites !== 0) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_SAFETY_INVALID")
  }
}

function validateIdentity(value: unknown, expected: ExpectedLunaIdentity) {
  const identityValue = record(value)
  if (!exactKeys(identityValue, [
    "barcode", "handle", "model", "productId", "productTitle", "sku",
    "structuredVariantAttributes", "variantId", "variantTitle",
  ]) || identityValue.productId !== expected.productId ||
      identityValue.variantId !== expected.variantId ||
      identityValue.sku !== expected.sku) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_IDENTITY_CONFLICT")
  }
  const productTitle = safeText(identityValue.productTitle, 240)
  const variantTitle = safeText(identityValue.variantTitle, 240)
  const handle = safeText(identityValue.handle, 240)
  const barcode = identityValue.barcode === null ? null
    : safeText(identityValue.barcode, 120)
  const model = identityValue.model === null ? null
    : safeText(identityValue.model, 120)
  const attributes = identityValue.structuredVariantAttributes
  if (!productTitle || !variantTitle || !handle ||
      (identityValue.barcode !== null && !barcode) ||
      (identityValue.model !== null && !model) || !Array.isArray(attributes) ||
      attributes.length > 12) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_IDENTITY_INVALID")
  }
  const normalizedAttributes = attributes.map((attribute) => {
    const candidate = record(attribute)
    const name = safeText(candidate.name, 80)
    const attributeValue = safeText(candidate.value, 120)
    if (!exactKeys(candidate, ["name", "value"]) || !name || !attributeValue) {
      fail("LUNA_LINKAGE_REVIEW_RECEIPT_IDENTITY_INVALID")
    }
    return Object.freeze({ name, value: attributeValue })
  })
  return Object.freeze({
    productId: expected.productId,
    productTitle,
    handle,
    variantId: expected.variantId,
    variantTitle,
    sku: expected.sku,
    barcode,
    model,
    structuredVariantAttributes: Object.freeze(normalizedAttributes),
  })
}

function validateEvidence(value: unknown, ebayItemId: FrozenItemId) {
  const evidence = record(value)
  if (!exactKeys(evidence, [
    "acquisitionMethod", "candidateEvidenceDigest", "candidateId",
    "classification", "commerceFactsUsedForIdentity", "configurationProven",
    "contractVersion", "currentCohortId", "currentLunaIdentity",
    "defaultTitleOnly", "ebayItemId", "evidenceDigest", "evidenceReference",
    "observedAt", "rawSourceIncluded", "sessionMaterialIncluded",
    "sourceStatus",
  ]) || evidence.contractVersion !== IDENTITY_VERSION ||
      evidence.currentCohortId !== SELLER_OS_P2_I01C_FROZEN_COHORT_ID ||
      evidence.ebayItemId !== ebayItemId ||
      evidence.classification !== "EXACT_UNIQUE_MATCH" ||
      evidence.acquisitionMethod !== "CANONICAL_SERVER_READ_IDENTITY_ONLY" ||
      evidence.sourceStatus !== "AVAILABLE" ||
      evidence.defaultTitleOnly !== true ||
      evidence.configurationProven !== false ||
      evidence.commerceFactsUsedForIdentity !== false ||
      evidence.rawSourceIncluded !== false ||
      evidence.sessionMaterialIncluded !== false ||
      typeof evidence.candidateId !== "string" ||
      !CANDIDATE_ID.test(evidence.candidateId) ||
      typeof evidence.candidateEvidenceDigest !== "string" ||
      !CANDIDATE_DIGEST.test(evidence.candidateEvidenceDigest) ||
      typeof evidence.evidenceDigest !== "string" ||
      !DIGEST.test(evidence.evidenceDigest) ||
      typeof evidence.evidenceReference !== "string" ||
      !CURRENT_IDENTITY_REFERENCE.test(evidence.evidenceReference)) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_EVIDENCE_INVALID")
  }
  const observedAt = finiteTimestamp(evidence.observedAt)
  if (!observedAt) fail("LUNA_LINKAGE_REVIEW_RECEIPT_CLOCK_INVALID")
  return Object.freeze({
    ebayItemId,
    currentLunaIdentity: validateIdentity(evidence.currentLunaIdentity,
      SELLER_OS_P2_I01C_EXPECTED_LUNA_IDENTITIES[ebayItemId]),
    defaultTitleOnly: true as const,
    configurationProven: false as const,
    observedAt,
    evidenceDigest: evidence.evidenceDigest,
  })
}

function validateReceipt(value: unknown) {
  const receipt = record(value)
  if (!exactKeys(receipt, [
    "contractVersion", "currentCohortId", "currentLiveCount", "entries",
    "metrics", "safety",
  ]) || receipt.contractVersion !== RECEIPT_VERSION ||
      receipt.currentCohortId !== SELLER_OS_P2_I01C_FROZEN_COHORT_ID ||
      receipt.currentLiveCount !== SELLER_OS_P2_I01C_FROZEN_ITEM_IDS.length ||
      !Array.isArray(receipt.entries) || receipt.entries.length < 1 ||
      receipt.entries.length > SELLER_OS_P2_I01C_FROZEN_ITEM_IDS.length) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_CONTRACT_INVALID")
  }
  validateMetrics(receipt.metrics, receipt.entries.length)
  validateSafety(receipt.safety)
  const itemIds = new Set<string>()
  const evidence: VerifiedEvidence[] = []
  for (const valueEntry of receipt.entries) {
    const entry = record(valueEntry)
    const ebayItemId = entry.ebayItemId
    if (!isFrozenItemId(ebayItemId) || itemIds.has(ebayItemId)) {
      fail("LUNA_LINKAGE_REVIEW_RECEIPT_COHORT_INVALID")
    }
    itemIds.add(ebayItemId)
    if (entry.targetCount === 1) {
      if (!exactKeys(entry, ["ebayItemId", "evidence", "targetCount"]) ||
          !Array.isArray(entry.evidence) || entry.evidence.length !== 1) {
        fail("LUNA_LINKAGE_REVIEW_RECEIPT_TARGET_INVALID")
      }
      evidence.push(validateEvidence(entry.evidence[0], ebayItemId))
    } else if (entry.targetCount === 0) {
      if (!exactKeys(entry, [
        "classification", "ebayItemId", "failureCode", "targetCount",
      ]) || entry.classification !== "IDENTITY_EVIDENCE_INCOMPLETE" ||
          !safeText(entry.failureCode, 120)) {
        fail("LUNA_LINKAGE_REVIEW_RECEIPT_TARGET_INVALID")
      }
    } else {
      fail("LUNA_LINKAGE_REVIEW_RECEIPT_TARGET_INVALID")
    }
  }
  return Object.freeze(evidence)
}

function extractVerifiedEvidence(sessionLogText: string) {
  if (typeof sessionLogText !== "string" || sessionLogText.length < 1 ||
      Buffer.byteLength(sessionLogText, "utf8") > MAXIMUM_SESSION_LOG_BYTES) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_SOURCE_INVALID")
  }
  const evidence = new Map<FrozenItemId, VerifiedEvidence>()
  let receiptCount = 0
  let offset = 0
  while (offset <= sessionLogText.length) {
    const next = sessionLogText.indexOf("\n", offset)
    const end = next === -1 ? sessionLogText.length : next
    const line = sessionLogText.slice(offset, end)
    offset = next === -1 ? sessionLogText.length + 1 : next + 1
    if (!line.includes(RECEIPT_VERSION)) continue
    let event: Record<string, unknown>
    try { event = record(JSON.parse(line)) } catch { continue }
    const payload = record(event.payload)
    const item = record(payload.item)
    if (item.type !== "CommandExecution" || typeof item.stdout !== "string") {
      continue
    }
    for (const outputLine of item.stdout.split("\n")) {
      if (!outputLine.startsWith("{") ||
          !outputLine.includes(RECEIPT_VERSION)) continue
      let candidate: unknown
      try { candidate = JSON.parse(outputLine) } catch {
        fail("LUNA_LINKAGE_REVIEW_RECEIPT_MALFORMED")
      }
      if (record(candidate).contractVersion !== RECEIPT_VERSION) continue
      receiptCount += 1
      for (const current of validateReceipt(candidate)) {
        const previous = evidence.get(current.ebayItemId)
        if (!previous || Date.parse(current.observedAt) >
            Date.parse(previous.observedAt)) {
          evidence.set(current.ebayItemId, current)
        } else if (current.observedAt === previous.observedAt &&
            current.evidenceDigest !== previous.evidenceDigest) {
          fail("LUNA_LINKAGE_REVIEW_RECEIPT_REPLAY_CONFLICT")
        }
      }
    }
  }
  if (!receiptCount) fail("LUNA_LINKAGE_REVIEW_RECEIPT_MISSING")
  if (evidence.size !== SELLER_OS_P2_I01C_FROZEN_ITEM_IDS.length ||
      SELLER_OS_P2_I01C_FROZEN_ITEM_IDS.some((itemId) =>
        !evidence.has(itemId))) {
    fail("LUNA_LINKAGE_REVIEW_RECEIPT_COVERAGE_INCOMPLETE")
  }
  return Object.freeze({ evidence, receiptCount })
}

function classificationCounts(entries: readonly SellerOsLunaLinkageReviewEntryV2[]) {
  const result: Record<SellerOsLunaLinkageReviewClassificationV2, number> = {
    EXACT_UNIQUE_MATCH: 0,
    AMBIGUOUS_MATCH: 0,
    CONFLICTING_MATCH: 0,
    NO_MATCH: 0,
    BUNDLE_INCOMPLETE: 0,
    IDENTITY_EVIDENCE_INCOMPLETE: 0,
  }
  for (const entry of entries) result[entry.classification] += 1
  return Object.freeze(result)
}

export type SellerOsLunaLinkageReviewActivationPlanV1 = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_LINKAGE_REVIEW_ACTIVATION_VERSION
  reviewSet: SellerOsLunaLinkageReviewSetV2
  receiptCount: number
  evidenceEarliestObservedAt: string
  evidenceLatestObservedAt: string
  earliestEvidenceExpiresAt: string
  reviewObservedAt: string
  classificationCounts: Readonly<Record<
    SellerOsLunaLinkageReviewClassificationV2, number
  >>
}>

export function buildSellerOsLunaLinkageReviewActivationV1(input: Readonly<{
  receiptSourcePath: string
  sessionLogText: string
  accountKey: string
  now: string
}>): SellerOsLunaLinkageReviewActivationPlanV1 {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== [
        "accountKey", "now", "receiptSourcePath", "sessionLogText",
      ].sort().join(",") ||
      input.receiptSourcePath !== SELLER_OS_P2_I01C_RECEIPT_SOURCE_PATH ||
      !ACCOUNT_KEY.test(input.accountKey)) {
    fail("LUNA_LINKAGE_REVIEW_ACTIVATION_INPUT_INVALID")
  }
  const now = finiteTimestamp(input.now)
  if (!now) fail("LUNA_LINKAGE_REVIEW_ACTIVATION_CLOCK_INVALID")
  const receiptEvidence = extractVerifiedEvidence(input.sessionLogText)
  const evidenceRows = SELLER_OS_P2_I01C_FROZEN_ITEM_IDS.map((itemId) => {
    const evidence = receiptEvidence.evidence.get(itemId)
    if (!evidence) fail("LUNA_LINKAGE_REVIEW_RECEIPT_COVERAGE_INCOMPLETE")
    const age = Date.parse(now) - Date.parse(evidence.observedAt)
    if (age < -MAXIMUM_CLOCK_SKEW_MS) {
      fail("LUNA_LINKAGE_REVIEW_EVIDENCE_FUTURE_REJECTED")
    }
    if (age > SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS *
        1_000) {
      fail("LUNA_LINKAGE_REVIEW_EVIDENCE_STALE")
    }
    return evidence
  })
  const observedTimes = evidenceRows.map((evidence) => evidence.observedAt)
    .sort()
  const reviewObservedAt = observedTimes.at(-1)
  if (!reviewObservedAt) fail("LUNA_LINKAGE_REVIEW_RECEIPT_COVERAGE_INCOMPLETE")
  const entries = evidenceRows.map((evidence) => {
    const listing = FROZEN_LISTINGS[evidence.ebayItemId]
    const missingBundleSignals = listing.classification ===
      "BUNDLE_INCOMPLETE"
      ? listing.requiredBundleComponents.slice(1).map((component) =>
          `REQUIRED_COMPONENT_UNRESOLVED_${component}`)
      : []
    const component = Object.freeze({
      lunaProductId: evidence.currentLunaIdentity.productId,
      lunaVariantId: evidence.currentLunaIdentity.variantId,
      lunaSku: evidence.currentLunaIdentity.sku,
      productTitle: evidence.currentLunaIdentity.productTitle,
      variantTitle: evidence.currentLunaIdentity.variantTitle,
      supplierQuantityRequired: listing.supplierQuantityRequired,
      quantityBasis: "HUMAN_CONFIRMATION_REQUIRED" as const,
      variantPresence: "PRESENT" as const,
      exactProductIdentity: true,
      exactVariantIdentity: true,
      exactSupplierSku: true,
      structuredVariantAttributesComplete: false,
      identityConflict: listing.classification === "CONFLICTING_MATCH",
    })
    return buildSellerOsLunaLinkageReviewEntryV2({
      currentCohortId: SELLER_OS_P2_I01C_FROZEN_COHORT_ID,
      accountKey: input.accountKey,
      ebayItemId: evidence.ebayItemId,
      ebaySku: listing.ebaySku,
      listingTitle: listing.listingTitle,
      classification: listing.classification,
      linkageMode: listing.linkageMode,
      components: [component],
      matchSignals: [
        "CURRENT_LUNA_CANDIDATE_PRODUCT_IDENTITY_CONFIRMED",
        "CURRENT_LUNA_CANDIDATE_VARIANT_IDENTITY_CONFIRMED",
        "CURRENT_LUNA_CANDIDATE_SKU_IDENTITY_CONFIRMED",
        "CANONICAL_SERVER_READ_IDENTITY_CONFIRMED",
        ...(evidence.ebayItemId === "366602466981"
          ? ["EBAY_SUPPLIER_SKU_EXACT"] : []),
      ],
      conflictSignals: listing.classification === "BUNDLE_INCOMPLETE"
        ? [...listing.conflictSignals, ...missingBundleSignals,
            "DEFAULT_TITLE_CONFIGURATION_UNPROVEN"]
        : listing.conflictSignals,
      // The approval contract deliberately recognizes the verifier digest,
      // not its convenience `luna-current-identity:` display reference.
      evidenceReferences: [evidence.evidenceDigest],
      evidenceObservedAt: evidence.observedAt,
      reviewObservedAt,
      identityEvidenceProvenance: {
        contractVersion: IDENTITY_VERSION,
        sourceStatus: "AVAILABLE",
        acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY",
      },
      decisionVersion: 1,
    })
  })
  if (entries.some((entry) =>
    entry.allowedOperatorDecisions.includes("APPROVE_EXACT_LINKAGE"))) {
    fail("LUNA_LINKAGE_REVIEW_UNAUTHORIZED_APPROVAL_ELIGIBILITY")
  }
  const reviewSet = buildSellerOsLunaLinkageReviewSetV2({
    currentCohortId: SELLER_OS_P2_I01C_FROZEN_COHORT_ID,
    accountKey: input.accountKey,
    currentLiveCount: SELLER_OS_P2_I01C_FROZEN_ITEM_IDS.length,
    entries,
  })
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_LINKAGE_REVIEW_ACTIVATION_VERSION,
    reviewSet,
    receiptCount: receiptEvidence.receiptCount,
    evidenceEarliestObservedAt: observedTimes[0],
    evidenceLatestObservedAt: observedTimes.at(-1)!,
    earliestEvidenceExpiresAt: new Date(Date.parse(observedTimes[0]) +
      SELLER_OS_LUNA_LINKAGE_IDENTITY_EVIDENCE_MAXIMUM_AGE_SECONDS * 1_000)
      .toISOString(),
    reviewObservedAt,
    classificationCounts: classificationCounts(reviewSet.entries),
  })
}

export function createSellerOsLunaLinkageReviewActivationOutputV1(input:
Readonly<{
  plan: SellerOsLunaLinkageReviewActivationPlanV1
  persistence: Readonly<{
    requested: boolean
    status: "NOT_REQUESTED" | "CREATED" | "IDEMPOTENT_SUCCESS"
  }>
}>) {
  const entries = input.plan.reviewSet.entries.map((entry) => {
    const listing = FROZEN_LISTINGS[entry.ebayItemId as FrozenItemId]
    return Object.freeze({
      ebayItemId: entry.ebayItemId,
      ebaySku: entry.ebaySku,
      listingTitle: entry.listingTitle,
      classification: entry.classification,
      currentLunaProductId: entry.components[0]?.lunaProductId ?? null,
      currentLunaVariantId: entry.components[0]?.lunaVariantId ?? null,
      currentLunaSku: entry.components[0]?.lunaSku ?? null,
      supplierQuantityRequired: entry.supplierQuantityRequired,
      requiredBundleComponents: listing.requiredBundleComponents,
      conflictSignals: entry.conflictSignals,
      evidenceObservedAt: entry.evidenceObservedAt,
      evidenceDigest: entry.evidenceDigest,
      evidenceFreshness: entry.evidenceFreshness,
      allowedOperatorDecisions: entry.allowedOperatorDecisions,
      recommendedSafeDecision: entry.recommendedSafeDecision,
    })
  })
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_LINKAGE_REVIEW_ACTIVATION_VERSION,
    currentCohortId: input.plan.reviewSet.currentCohortId,
    currentLiveCount: input.plan.reviewSet.currentLiveCount,
    reviewSetId: input.plan.reviewSet.reviewSetId,
    reviewSetDigest: input.plan.reviewSet.reviewSetDigest,
    reviewObservedAt: input.plan.reviewObservedAt,
    evidenceEarliestObservedAt: input.plan.evidenceEarliestObservedAt,
    evidenceLatestObservedAt: input.plan.evidenceLatestObservedAt,
    earliestEvidenceExpiresAt: input.plan.earliestEvidenceExpiresAt,
    receiptCount: input.plan.receiptCount,
    classificationCounts: input.plan.classificationCounts,
    entries: Object.freeze(entries),
    persistence: Object.freeze({
      requested: input.persistence.requested,
      status: input.persistence.status,
      reviewSetMutationCalls: input.persistence.requested ? 1 : 0,
      decisionRpcCalls: 0 as const,
    }),
    safety: Object.freeze({
      automaticApprovalWrites: 0 as const,
      humanDecisionWrites: 0 as const,
      ebayCalls: 0 as const,
      ebayWrites: 0 as const,
      lunaIdentityReads: 0 as const,
      lunaStockReads: 0 as const,
      lunaPolling: 0 as const,
      stockEvaluated: false as const,
      credentialsIncluded: false as const,
      cookiesIncluded: false as const,
    }),
  })
}
