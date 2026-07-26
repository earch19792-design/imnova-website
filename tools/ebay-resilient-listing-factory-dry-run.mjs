import {
  runResilientBatchDryRun,
  sha256Hex,
} from "../lib/ebay/ebay-resilient-listing-factory-domain.ts"

const traceability = [
  "identity", "supplier.costUsd", "supplier.stock",
  "economics.recommendedPriceUsd", "listing.categoryId", "listing.title",
  "listing.payloadHash", "visual.main",
].map((field) => ({
  field, source: "DRY_RUN_FIXTURE", observedAt: "2026-07-25T12:00:00.000Z",
  freshness: "FRESH", confidence: 95, evidenceRef: `dry:${field}`,
  normalizationVersion: "v1", decisionRef: `dry:${field}`,
}))

const candidate = (index, fault) => {
  const payloadHash = sha256Hex(`dry-run-payload-${index}`)
  return {
    id: `dry-product-${index}`,
    sku: `IMNOVADRY${String(index).padStart(16, "0")}`,
    ...(fault ? { fault } : {}),
    dossier: {
      productId: `dry-product-${index}`, marketRadarProductId: `dry-radar-${index}`,
      sku: `IMNOVADRY${String(index).padStart(16, "0")}`, version: 1,
      identity: {
        exactMatch: true, supplierSku: `DRY-LUNA-${index}`, brand: "Dry Run Brand",
        model: `MODEL-${index}`, variant: "Standard", color: "Blue", size: "One Size",
        condition: "NEW", packCount: 1, identifiers: { mpn: `MODEL-${index}` },
        confidence: 96, verificationMethod: "DRY_RUN_FIXTURE",
      },
      supplier: {
        sourceKind: "AUTHORIZED_SUPPLIER", source: "DRY_RUN_FIXTURE",
        isFixture: false, costUsd: 10, stock: 12, available: true,
        observedAt: "2026-07-25T12:00:00.000Z", fresh: true,
        weightKnown: true, dimensionsKnown: true, exactPackageKnown: true,
        imageRightsVerified: true,
      },
      market: {
        marketplace: "EBAY_US", evidenceClass: "SOLD_CONFIRMED",
        confirmedSales: 2, activeListings: 3, comparables: [],
        observedAt: "2026-07-25T12:00:00.000Z", fresh: true,
      },
      economics: {
        source: "EBAY_UNIT_ECONOMICS_CANONICAL", policyVersion: "CANONICAL_V1",
        costsComplete: true, recommendedPriceUsd: 29.99, landedPriceUsd: 29.99,
        safeFloorUsd: 24.5, netProfitUsd: 7.5, marginPercent: 25,
        roiPercent: 75, passesCanonicalPolicy: true,
      },
      listing: {
        categoryOfficial: true, categoryId: "1234", requiredAspectsComplete: true,
        titleVerified: true, descriptionVerified: true, claimsVerified: true,
        intellectualPropertyAllowed: true, policiesComplete: true,
        merchantLocationResolved: true, quantity: 3, noSkuCollision: true,
        payloadFrozen: true, payloadHash,
      },
      visual: {
        strategy: "VISUAL_STRATEGY_V3", immutableManifest: true,
        exactIdentityPreserved: true, approvedImageCount: 7,
        mainImageApproved: true, secondaryImagesApproved: 6,
        referencesRecorded: true, promptsRecorded: true, hashesRecorded: true,
      },
      runtime: {
        accountBound: true, marketplaceBound: true, credentialsAvailable: true,
        quotasAvailable: true, ledgerPrepared: true, preflightFresh: true,
      },
      traceability,
    },
  }
}

const batches = [
  {
    name: "five-safe-products",
    candidates: Array.from({ length: 5 }, (_, index) => candidate(index + 1)),
    reserves: [],
  },
  {
    name: "unknown-error-with-reserve",
    candidates: Array.from({ length: 5 }, (_, index) => candidate(
      index + 11,
      index === 2 ? {
        atState: "SUPPLY_VERIFIED", code: "UNKNOWN_PROVIDER_SHAPE",
        dependency: "UNKNOWN", unexpected: true,
      } : undefined,
    )),
    reserves: [candidate(16)],
  },
  {
    name: "global-auth-circuit",
    candidates: Array.from({ length: 5 }, (_, index) => candidate(
      index + 21,
      {
        atState: "MARKET_RESEARCH", code: "EBAY_AUTH_EXPIRED",
        dependency: "EBAY", httpStatus: 401,
      },
    )),
    reserves: [],
  },
]

const output = []
for (const batch of batches) {
  const result = await runResilientBatchDryRun(batch)
  output.push({
    name: batch.name,
    status: result.status,
    selected: result.selected,
    processed: result.processed,
    completed: result.completed,
    quarantined: result.quarantined,
    replacements: result.replacements,
    externalWrites: result.externalWrites,
  })
}

process.stdout.write(`${JSON.stringify({
  mode: "DRY_RUN",
  batches: output,
  ebayWrites: 0,
  productionChanged: false,
  secretsDisplayed: false,
}, null, 2)}\n`)

