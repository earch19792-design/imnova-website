import type {
  ReactNode,
} from "react"
import listingPackage from "../../../tools/fixtures/ebay-first-listing-package-v1.json"
import qaReview from "../../../tools/fixtures/ebay-first-listing-qa-review-v1.json"

const safetyBadges = [
  "Read-only preview",
  "No eBay connection",
  "No draft created",
  "Do not publish yet",
  "Human review required",
]

const executiveBlockers = [
  "Terapeak validation missing",
  "Sold listings benchmark missing",
  "Authorized Luna Portex catalog image missing",
  "White-background main image enhancement pending",
  "Main image QA pending",
  "Shipping/returns not confirmed",
  "Price and margin not validated",
]

const decisionCards = [
  {
    label:
      "Do not create draft",
    detail:
      "QA needs data before any eBay draft can be considered.",
    tone:
      "border-rose-300/25 bg-rose-300/[0.06] text-rose-50",
  },
  {
    label:
      "Do not publish",
    detail:
      "Terapeak, benchmark, shipping, images, and margin are incomplete.",
    tone:
      "border-rose-300/25 bg-rose-300/[0.06] text-rose-50",
  },
  {
    label:
      "Ready for internal preparation only",
    detail:
      "Use this package to organize work, not to create live marketplace actions.",
    tone:
      "border-amber-300/25 bg-amber-300/[0.06] text-amber-50",
  },
]

const actionPlan = [
  {
    title:
      "Product facts",
    items: [
      "dimensions",
      "material",
      "package contents",
    ],
  },
  {
    title:
      "Market validation",
    items: [
      "Terapeak validation",
      "Sold listings benchmark",
    ],
  },
  {
    title:
      "Operations",
    items: [
      "shipping policy",
      "return policy",
      "stock location",
      "Luna Portex packing fee",
    ],
  },
  {
    title:
      "Assets",
    items: [
      "authorized Luna Portex catalog image",
      "white-background main image enhancement",
      "secondary images",
      "image QA",
    ],
  },
  {
    title:
      "Approval",
    items: [
      "human review before draft",
      "human approval before publish",
    ],
  },
]

const disabledActions = [
  {
    label:
      "Import Sold Listings",
    reason:
      "Disabled: benchmark import not implemented yet",
  },
  {
    label:
      "Validate Terapeak",
    reason:
      "Disabled: manual validation required first",
  },
  {
    label:
      "Create eBay Draft",
    reason:
      "Disabled: QA needs data",
  },
  {
    label:
      "Publish to eBay",
    reason:
      "Disabled: Terapeak and benchmark missing",
  },
  {
    label:
      "Create Pack Listing",
    reason:
      "Disabled: waiting for conversion data",
  },
  {
    label:
      "Generate Images",
    reason:
      "Disabled: authorized catalog source and image QA required",
  },
]

const statusMarkers = [
  "LISTING_PACKAGE_NEEDS_DATA",
  "NOT_READY_TO_PUBLISH",
  "LISTING_QA_NEEDS_DATA",
  "DO_NOT_CREATE_DRAFT",
  "DO_NOT_PUBLISH",
  "TERAPEAK_VALIDATION_REQUIRED",
  "SOLD_LISTINGS_BENCHMARK_REQUIRED",
  "WAITING_FOR_CONVERSION_DATA",
  "PACKING_FEE_VERIFICATION_REQUIRED",
  "AUTHORIZED_CATALOG_IMAGE_REQUIRED_FOR_MAIN_IMAGE",
  "CATALOG_IMAGE_ENHANCEMENT_REQUIRED",
  "ebay_only_connector_or_import",
  "structured_requirement_only",
  "pack x2",
  "pack x3",
  "pack x6",
  "pack x12",
]

const trustSignalLabels = {
  freeShipping:
    "Free Shipping",
  shipsFromUsa:
    "Ships from USA",
  inStockInUsa:
    "In Stock in USA",
  usaFlag:
    "USA flag",
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "Not provided"
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/50">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-lg font-black text-white">
        {title}
      </h2>
      <div className="mt-5">
        {children}
      </div>
    </section>
  )
}

function FieldGrid({
  fields,
}: {
  fields: Array<[string, unknown]>
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(([label, value]) => (
        <div
          key={label}
          className="rounded-2xl border border-white/10 bg-black/20 p-4"
        >
          <dt className="text-xs uppercase tracking-[0.2em] text-white/40">
            {label}
          </dt>
          <dd className="mt-2 break-words text-sm font-bold text-white">
            {formatValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ListBlock({
  items,
}: {
  items: string[]
}) {
  return (
    <ul className="grid gap-3 text-sm leading-6 text-white/70">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
        >
          {item}
        </li>
      ))}
    </ul>
  )
}

export default function EbayListingPackagePage() {
  const trustSignals =
    listingPackage.trustSignals
  const optionalTrustVisual =
    listingPackage.optionalUsBuyerTrustVisual
  const soldListingsBenchmark =
    listingPackage.soldListingsBenchmarkStrategy
  const sellOneLikeThis =
    soldListingsBenchmark.sellOneLikeThisStrategy

  return (
    <main className="min-h-screen bg-[#05070d] px-6 py-8 text-white md:px-10 lg:px-14">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <a
          href="/admin"
          className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/70 transition hover:border-cyan-300/30 hover:text-cyan-100"
        >
          Back to Admin
        </a>

        <section className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-100/60">
                Professional Listing MVP
              </p>
              <h1 className="mt-4 text-4xl font-black text-white md:text-5xl">
                Listing Package QA
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">
                Seller View for the first listing package and QA review. Read-only preview. No eBay connection. No draft created. Do not publish yet. Human review required.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {safetyBadges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-white/70"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>

        <Section
          title="Executive Status"
          eyebrow="Seller View"
        >
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-rose-300/25 bg-rose-300/[0.06] p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  [
                    "Status: Not ready",
                    "Critical listing requirements are incomplete.",
                  ],
                  [
                    "Main risk: Do not publish yet",
                    "Publishing now would rely on unverified facts.",
                  ],
                  [
                    "Next step: Complete critical data before creating an eBay draft",
                    "Resolve market, operations, image, and margin blockers.",
                  ],
                  [
                    "Ready for: Internal preparation only",
                    "Use this view to organize seller work safely.",
                  ],
                ].map(([title, detail]) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-white/10 bg-black/25 p-4"
                  >
                    <h3 className="text-sm font-black text-white">
                      {title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-white/65">
                      {detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.055] p-5">
              <h3 className="text-sm font-black text-white">
                What Blocks Publishing
              </h3>
              <ul className="mt-4 space-y-3 text-sm font-semibold text-amber-50/85">
                {executiveBlockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                  >
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {decisionCards.map((card) => (
              <article
                key={card.label}
                className={`rounded-3xl border p-5 ${card.tone}`}
              >
                <h3 className="text-lg font-black">
                  {card.label}
                </h3>
                <p className="mt-3 text-sm leading-6 opacity-80">
                  {card.detail}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Listing Preview">
          <div className="grid gap-5 xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
            <div className="flex min-h-[240px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/[0.035] p-6 text-center xl:min-h-0">
              <p className="text-lg font-black text-white">
                Authorized Luna Portex catalog image required
              </p>
              <div className="mt-5 space-y-2 text-sm font-semibold text-white/65">
                <p>
                  White-background enhancement required
                </p>
                <p>
                  No AI-generated product
                </p>
                <p>
                  No product alteration
                </p>
                <p>
                  No badges or flags
                </p>
                <p>
                  Source authorization required
                </p>
              </div>
            </div>

            <div className="min-w-0 rounded-3xl border border-white/10 bg-black/20 p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-white/40">
                Seller listing preview
              </p>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
                  Title
                </h2>
                <p className="mt-3 break-words text-lg font-bold leading-7 text-cyan-100">
                  {listingPackage.listingTitle}
                </p>
              </div>

              <ul className="mt-4 grid gap-3 text-sm leading-6 text-white/70">
                {listingPackage.buyerFacingCopy.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="break-words rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    {bullet}
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
                  Short description
                </p>
                <p className="mt-3 break-words text-sm leading-7 text-white/60">
                  {listingPackage.buyerFacingCopy.descriptionPlainText}
                </p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  [
                    "Condition",
                    listingPackage.condition.suggestedCondition,
                  ],
                  [
                    "Category",
                    "Pending confirmation",
                  ],
                  [
                    "Price: Pending",
                    "Cost, fees, margin, and sold price benchmark required.",
                  ],
                  [
                    "Shipping: Pending",
                    "Shipping policy and stock location must be confirmed.",
                  ],
                  [
                    "Returns: Pending",
                    "Return policy must be confirmed.",
                  ],
                  [
                    "Draft status: Blocked",
                    qaReview.draftRecommendation,
                  ],
                  [
                    "Publish status: Blocked",
                    qaReview.publicationRecommendation,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-bold text-white">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Action Plan">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {actionPlan.map((group) => (
              <article
                key={group.title}
                className="rounded-3xl border border-white/10 bg-black/20 p-5"
              >
                <h3 className="text-sm font-black text-white">
                  {group.title}
                </h3>
                <ul className="mt-4 space-y-2 text-sm leading-6 text-white/65">
                  {group.items.map((item) => (
                    <li key={item}>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Required Human Actions">
          <ListBlock items={qaReview.requiredHumanActions} />
        </Section>

        <Section title="Product / Pricing / Shipping">
          <div className="grid gap-5">
            <div>
              <h3 className="text-sm font-black text-white">
                Listing Overview
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "caseId",
                      listingPackage.caseId,
                    ],
                    [
                      "marketplace",
                      listingPackage.marketplace,
                    ],
                    [
                      "language",
                      listingPackage.language,
                    ],
                    [
                      "candidateName",
                      listingPackage.candidateName,
                    ],
                    [
                      "listingTitle",
                      listingPackage.listingTitle,
                    ],
                    [
                      "subtitleSuggestion",
                      listingPackage.subtitleSuggestion,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Buyer-Facing Copy
              </h3>
              <div className="mt-3 grid gap-5 lg:grid-cols-2">
                <ListBlock items={listingPackage.titleAlternatives} />
                <ListBlock items={listingPackage.buyerFacingCopy.bullets} />
              </div>
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-black text-white">
                  descriptionHtml read-only text
                </p>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-white/60">
                  {listingPackage.buyerFacingCopy.descriptionHtml}
                </pre>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Item Specifics
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {listingPackage.itemSpecifics.map((item) => (
                  <div
                    key={item.name}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <p className="text-sm font-black text-white">
                      {item.name}
                    </p>
                    <p className="mt-2 text-sm text-cyan-100">
                      {item.value}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-amber-100/70">
                      {item.verificationStatus.includes("missing")
                        ? "needs data"
                        : item.verificationStatus}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Price Strategy
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "suggestedPriceUsd",
                      listingPackage.priceStrategy.suggestedPriceUsd,
                    ],
                    [
                      "minimumPriceUsd",
                      listingPackage.priceStrategy.minimumPriceUsd,
                    ],
                    [
                      "targetProfitUsd",
                      listingPackage.priceStrategy.targetProfitUsd,
                    ],
                    [
                      "needsCostVerification",
                      listingPackage.priceStrategy.needsCostVerification,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Shipping & Returns
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "shippingCopy",
                      listingPackage.shipping.shippingCopy,
                    ],
                    [
                      "freeShippingAllowed",
                      listingPackage.shipping.freeShippingAllowed,
                    ],
                    [
                      "freeShippingVerified",
                      listingPackage.shipping.freeShippingVerified,
                    ],
                    [
                      "shipsFromUsaAllowed",
                      listingPackage.shipping.shipsFromUsaAllowed,
                    ],
                    [
                      "shipsFromUsaVerified",
                      listingPackage.shipping.shipsFromUsaVerified,
                    ],
                    [
                      "inStockInUsaAllowed",
                      listingPackage.shipping.inStockInUsaAllowed,
                    ],
                    [
                      "inStockInUsaVerified",
                      listingPackage.shipping.inStockInUsaVerified,
                    ],
                    [
                      "returnPolicyCopy",
                      listingPackage.returns.returnPolicyCopy,
                    ],
                    [
                      "needsHumanConfirmation",
                      listingPackage.returns.needsHumanConfirmation,
                    ],
                  ]}
                />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Image Plan">
          <div className="grid gap-5">
            <div>
              <h3 className="text-sm font-black text-white">
                Main Image Policy
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "authorized catalog source",
                      listingPackage.mainImagePolicy.imageSourceRequired,
                    ],
                    [
                      "sourceAuthorizationRequired",
                      listingPackage.mainImagePolicy.sourceAuthorizationRequired,
                    ],
                    [
                      "catalogSource",
                      listingPackage.mainImagePolicy.catalogSource,
                    ],
                    [
                      "physicalProductInSellerPossessionRequired",
                      listingPackage.mainImagePolicy.physicalProductInSellerPossessionRequired,
                    ],
                    [
                      "enhancementRequired",
                      listingPackage.mainImagePolicy.enhancementRequired,
                    ],
                    [
                      "White-background main image required",
                      listingPackage.mainImagePolicy.finalBackgroundRequired,
                    ],
                    [
                      "1600 px minimum",
                      listingPackage.mainImagePolicy.minimumResolutionPx,
                    ],
                    [
                      "no text",
                      listingPackage.mainImagePolicy.textAllowed,
                    ],
                    [
                      "no trust badges",
                      listingPackage.mainImagePolicy.trustBadgesAllowed,
                    ],
                    [
                      "no trust badges",
                      optionalTrustVisual.mainImageExclusions.includes("no trust badges"),
                    ],
                    [
                      "no USA flag",
                      optionalTrustVisual.mainImageExclusions.includes("no USA flag"),
                    ],
                    [
                      "No AI-generated product",
                      listingPackage.mainImagePolicy.aiGeneratedProductAllowed,
                    ],
                    [
                      "controlled background cleanup after review",
                      listingPackage.mainImagePolicy.aiAssistedBackgroundCleanupAllowedAfterHumanReview,
                    ],
                    [
                      "status",
                      listingPackage.mainImagePolicy.status,
                    ],
                    [
                      "enhancementStatus",
                      listingPackage.mainImageEnhancementPolicy.status,
                    ],
                    [
                      "no watermarks",
                      listingPackage.mainImagePolicy.watermarksAllowed,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Main Image Enhancement Policy
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                    Allowed enhancements
                  </p>
                  <ListBlock items={listingPackage.mainImageEnhancementPolicy.allowedEnhancements} />
                </div>
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
                    Prohibited enhancements
                  </p>
                  <ListBlock items={listingPackage.mainImageEnhancementPolicy.prohibitedEnhancements} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Secondary Image Strategy
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {listingPackage.imagePlan.secondaryImages.map((image) => (
                  <article
                    key={image.role}
                    className="rounded-2xl border border-white/10 bg-black/20 p-5"
                  >
                    <p className="text-xs uppercase tracking-[0.22em] text-white/40">
                      Image {image.imageNumber}
                    </p>
                    <h4 className="mt-2 text-base font-black text-white">
                      {image.role}
                    </h4>
                    <p className="mt-2 text-sm text-cyan-100">
                      {image.title}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/65">
                      {image.purpose}
                    </p>
                    <div className="mt-4 grid gap-2 text-sm text-white/65 sm:grid-cols-2">
                      <p>
                        status: {image.status}
                      </p>
                      <p>
                        textAllowed: {formatValue(image.textAllowed)}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <p className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-sm font-semibold text-cyan-50/80">
                Only dimensions allows text.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Market Validation">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-black text-white">
                Terapeak Validation
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "requiredBeforePublish",
                      listingPackage.terapeakValidation.requiredBeforePublish,
                    ],
                    [
                      "status",
                      listingPackage.terapeakValidation.status,
                    ],
                    [
                      "sales volume",
                      listingPackage.terapeakValidation.salesVolumeRequired,
                    ],
                    [
                      "average sold price",
                      listingPackage.terapeakValidation.averageSoldPriceRequired,
                    ],
                    [
                      "sell-through rate",
                      listingPackage.terapeakValidation.sellThroughRateRequired,
                    ],
                    [
                      "active listings",
                      listingPackage.terapeakValidation.activeListingsRequired,
                    ],
                    [
                      "competition review",
                      listingPackage.terapeakValidation.competitionReviewRequired,
                    ],
                    [
                      "margin validation",
                      listingPackage.terapeakValidation.marginValidationRequired,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Sold Listings Benchmark
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "strategyStatus",
                      soldListingsBenchmark.strategyStatus,
                    ],
                    [
                      "manualCopyNotScalable",
                      soldListingsBenchmark.manualCopyNotScalable,
                    ],
                    [
                      "preferredFutureAcquisitionMode",
                      soldListingsBenchmark.preferredFutureAcquisitionMode,
                    ],
                    [
                      "currentLoopAcquisitionMode",
                      soldListingsBenchmark.currentLoopAcquisitionMode,
                    ],
                    [
                      "Sell One Like This",
                      sellOneLikeThis.status,
                    ],
                    [
                      "mustRewriteTitle",
                      sellOneLikeThis.mustRewriteTitle,
                    ],
                    [
                      "mustRewriteDescription",
                      sellOneLikeThis.mustRewriteDescription,
                    ],
                    [
                      "mustReplacePhotos",
                      sellOneLikeThis.mustReplacePhotos,
                    ],
                    [
                      "mustNotCopyCompetitorContent",
                      sellOneLikeThis.mustNotCopyCompetitorContent,
                    ],
                  ]}
                />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Trust Signals">
          <p className="mb-5 text-sm leading-7 text-white/60">
            US Buyer Trust Signals must stay inactive until verified. Do not use on main image. USA flag must not imply Made in USA.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(trustSignals).map(([key, signal]) => (
              <div
                key={key}
                className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.045] p-5"
              >
                <h3 className="text-sm font-black text-white">
                  {
                    trustSignalLabels[
                      key as keyof typeof trustSignalLabels
                    ]
                  }
                </h3>
                <div className="mt-4 space-y-2 text-sm text-white/70">
                  <p>
                    allowed: {formatValue(signal.allowed)}
                  </p>
                  <p>
                    verified: {formatValue(signal.verified)}
                  </p>
                  <p>
                    instruction: {signal.instruction}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-black text-white">
              Optional US Buyer Trust Visual
            </h3>
            <div className="mt-3">
              <FieldGrid
                fields={[
                  [
                    "allowedOnlyIfVerified",
                    optionalTrustVisual.allowedOnlyAfterVerification,
                  ],
                  [
                    "notMainImage",
                    optionalTrustVisual.neverOnMainImage,
                  ],
                  [
                    "USA flag allowed only if verified",
                    optionalTrustVisual.signals.usaFlag.verified,
                  ],
                  [
                    "mustNotImplyMadeInUsa",
                    optionalTrustVisual.signals.usaFlag.mustNotImplyMadeInUsa,
                  ],
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="Pack Strategy">
          <p className="mb-5 text-sm leading-7 text-white/60">
            {listingPackage.postConversionPackStrategy.strategyStatus}. Pack listings only after conversion data, Terapeak validation, and demand evidence.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {listingPackage.postConversionPackStrategy.recommendedPackOptions.map((pack) => (
              <div
                key={pack.packSize}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <h3 className="text-sm font-black text-white">
                  pack x{pack.packSize}
                </h3>
                <p className="mt-2 text-sm text-cyan-100">
                  {pack.status}
                </p>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  {pack.purpose}
                </p>
                <p className="mt-3 text-sm font-bold text-amber-100">
                  requiresMarginValidation {formatValue(pack.requiresMarginValidation)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <h3 className="text-sm font-black text-white">
              Luna Portex Pack Fulfillment Review
            </h3>
            <div className="mt-3">
              <FieldGrid
                fields={[
                  [
                    "status",
                    listingPackage.lunaPortexPackFulfillmentReview.status,
                  ],
                  [
                    "requiredBeforePackListing",
                    listingPackage.lunaPortexPackFulfillmentReview.requiredBeforePackListing,
                  ],
                  [
                    "marginRule",
                    listingPackage.lunaPortexPackFulfillmentReview.marginRule,
                  ],
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="QA Details">
          <div className="grid gap-5">
            <div>
              <h3 className="text-sm font-black text-white">
                QA Review
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "qaStatus",
                      qaReview.qaStatus,
                    ],
                    [
                      "publicationRecommendation",
                      qaReview.publicationRecommendation,
                    ],
                    [
                      "draftRecommendation",
                      qaReview.draftRecommendation,
                    ],
                    [
                      "overallDecision",
                      qaReview.overallDecision,
                    ],
                    [
                      "decisionSummary",
                      qaReview.decisionSummary,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-black text-white">
                  Blocking Reasons
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.blockingReasons} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black text-white">
                  Missing Data
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.missingData} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black text-white">
                  Pre-Draft Checklist
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.preDraftChecklist} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black text-white">
                  Pre-Publish Checklist
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.prePublishChecklist} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {Object.entries(qaReview.sectionReviews).map(([key, review]) => (
                <article
                  key={key}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                >
                  <h3 className="text-sm font-black text-white">
                    {key}
                  </h3>
                  <p className="mt-2 text-sm font-bold text-amber-100">
                    {review.status}
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-white/65">
                    {review.checks.map((check) => (
                      <li key={check}>
                        {check}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </Section>

        <Section title="System Safety / Audit">
          <div className="grid gap-5">
            <div>
              <h3 className="text-sm font-black text-white">
                Technical status markers
              </h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {statusMarkers.map((marker) => (
                  <span
                    key={marker}
                    className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-white/70"
                  >
                    {marker}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Safety Flags
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={Object.entries(qaReview.safetyFlags)}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Disabled Actions
              </h3>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {disabledActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-2xl border border-red-200/10 bg-black/20 px-4 py-3 text-left text-sm text-red-50/70"
                  >
                    <span className="block font-black">
                      {action.label}
                    </span>
                    <span className="mt-2 block leading-6 text-red-50/55">
                      {action.reason}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </main>
  )
}
