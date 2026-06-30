import listingPackage from "../../../tools/fixtures/ebay-first-listing-package-v1.json"
import qaReview from "../../../tools/fixtures/ebay-first-listing-qa-review-v1.json"
import type {
  ReactNode,
} from "react"

const safetyBadges = [
  "Read-only preview",
  "No eBay connection",
  "No draft created",
  "Do not publish yet",
  "Human review required",
]

const disabledActions = [
  "Import Sold Listings -- Disabled",
  "Validate Terapeak -- Disabled",
  "Create eBay Draft -- Disabled",
  "Publish to eBay -- Disabled",
  "Create Pack Listing -- Disabled",
  "Generate Images -- Disabled",
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
          <dt className="text-xs uppercase tracking-[0.22em] text-white/40">
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

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="text-lg font-black text-white">
        {title}
      </h2>
      <div className="mt-5">
        {children}
      </div>
    </section>
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
                eBay Listing Package
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">
                Read-only preview for the first listing package and QA review. No eBay connection. No draft created. Do not publish yet. Human review required.
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            [
              "Listing Status",
              `${listingPackage.listingPackageStatus} / ${listingPackage.publicationStatus}`,
            ],
            [
              "QA Decision",
              `${qaReview.qaStatus} / ${qaReview.draftRecommendation} / ${qaReview.publicationRecommendation}`,
            ],
            [
              "Marketplace",
              `${listingPackage.marketplace} / ${listingPackage.language}`,
            ],
            [
              "Case ID",
              listingPackage.caseId,
            ],
            [
              "Safety",
              `eBay API ${listingPackage.safetyFlags.ebayApiUsed}; OpenAI API ${listingPackage.safetyFlags.openAiApiUsed}; imageGenerated ${listingPackage.safetyFlags.imageGenerated}; publishedToEbay ${listingPackage.safetyFlags.publishedToEbay}`,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
            >
              <p className="text-xs uppercase tracking-[0.24em] text-white/40">
                {label}
              </p>
              <p className="mt-3 break-words text-sm font-black text-cyan-100">
                {value}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Control Markers
          </h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {statusMarkers.map((marker) => (
              <span
                key={marker}
                className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-white/70"
              >
                {marker}
              </span>
            ))}
          </div>
        </section>

        <Section title="Listing Overview">
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
                "listingPackageStatus",
                listingPackage.listingPackageStatus,
              ],
              [
                "publicationStatus",
                listingPackage.publicationStatus,
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
              [
                "condition",
                listingPackage.condition.suggestedCondition,
              ],
              [
                "categorySuggestion",
                listingPackage.categorySuggestion.primaryCategoryName,
              ],
            ]}
          />
        </Section>

        <Section title="Buyer-Facing Copy">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <FieldGrid
                fields={[
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
              <div className="mt-5">
                <h3 className="text-sm font-black text-white">
                  titleAlternatives
                </h3>
                <div className="mt-3">
                  <ListBlock items={listingPackage.titleAlternatives} />
                </div>
              </div>
              <div className="mt-5">
                <h3 className="text-sm font-black text-white">
                  bullets
                </h3>
                <div className="mt-3">
                  <ListBlock items={listingPackage.buyerFacingCopy.bullets} />
                </div>
              </div>
            </div>
            <div className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <h3 className="text-sm font-black text-white">
                  descriptionPlainText
                </h3>
                <p className="mt-3 text-sm leading-7 text-white/65">
                  {listingPackage.buyerFacingCopy.descriptionPlainText}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <h3 className="text-sm font-black text-white">
                  descriptionHtml read-only text
                </h3>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-white/60">
                  {listingPackage.buyerFacingCopy.descriptionHtml}
                </pre>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Item Specifics">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
        </Section>

        <Section title="Price Strategy">
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
          <p className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.045] p-4 text-sm leading-7 text-amber-50/80">
            Final price cannot be set until cost, fees, shipping, margin, sold price benchmark, and Terapeak validation are complete.
          </p>
        </Section>

        <Section title="Shipping & Returns">
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
        </Section>

        <Section title="US Buyer Trust Signals">
          <p className="mb-5 text-sm leading-7 text-white/60">
            Do not use if not verified. Do not use on main image. USA flag must not imply Made in USA.
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
        </Section>

        <Section title="Main Image Policy">
          <FieldGrid
            fields={[
              [
                "real product photo required",
                listingPackage.mainImagePolicy.imageSourceRequired,
              ],
              [
                "AI generated allowed",
                listingPackage.mainImagePolicy.aiGeneratedAllowed,
              ],
              [
                "pure white background",
                listingPackage.mainImagePolicy.backgroundRequired,
              ],
              [
                "1600 px minimo",
                listingPackage.mainImagePolicy.minimumResolutionPx,
              ],
              [
                "no text",
                listingPackage.mainImagePolicy.textAllowed,
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
                "no watermarks",
                listingPackage.mainImagePolicy.watermarksAllowed,
              ],
              [
                "status",
                listingPackage.mainImagePolicy.status,
              ],
            ]}
          />
        </Section>

        <Section title="Secondary Image Strategy">
          <div className="grid gap-4 lg:grid-cols-2">
            {listingPackage.imagePlan.secondaryImages.map((image) => (
              <article
                key={image.role}
                className="rounded-2xl border border-white/10 bg-black/20 p-5"
              >
                <p className="text-xs uppercase tracking-[0.22em] text-white/40">
                  Image {image.imageNumber}
                </p>
                <h3 className="mt-2 text-base font-black text-white">
                  {image.role}
                </h3>
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
        </Section>

        <Section title="Optional US Buyer Trust Visual">
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
        </Section>

        <Section title="Terapeak Validation">
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
        </Section>

        <Section title="Sold Listings Benchmark">
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
        </Section>

        <Section title="Luna Portex Pack Fulfillment Review">
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
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-black text-white">
                feesToVerify
              </h3>
              <div className="mt-3">
                <ListBlock
                  items={listingPackage.lunaPortexPackFulfillmentReview.feesToVerify}
                />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-black text-white">
                requiredHumanActions
              </h3>
              <div className="mt-3">
                <ListBlock
                  items={listingPackage.lunaPortexPackFulfillmentReview.requiredHumanActions}
                />
              </div>
            </div>
          </div>
        </Section>

        <Section title="QA Review">
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
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
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
        </Section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Section title="Blocking Reasons">
            <ListBlock items={qaReview.blockingReasons} />
          </Section>
          <Section title="Missing Data">
            <ListBlock items={qaReview.missingData} />
          </Section>
          <Section title="Required Human Actions">
            <ListBlock items={qaReview.requiredHumanActions} />
          </Section>
          <Section title="Pre-Draft Checklist">
            <ListBlock items={qaReview.preDraftChecklist} />
          </Section>
          <Section title="Pre-Publish Checklist">
            <ListBlock items={qaReview.prePublishChecklist} />
          </Section>
          <Section title="Safety Flags">
            <FieldGrid
              fields={Object.entries(qaReview.safetyFlags)}
            />
          </Section>
        </section>

        <section className="rounded-3xl border border-red-300/15 bg-red-300/[0.04] p-6">
          <h2 className="text-lg font-black text-white">
            Disabled Actions
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {disabledActions.map((action) => (
              <button
                key={action}
                type="button"
                disabled
                className="cursor-not-allowed rounded-2xl border border-red-200/10 bg-black/20 px-4 py-3 text-sm font-black text-red-50/65"
              >
                {action}
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
