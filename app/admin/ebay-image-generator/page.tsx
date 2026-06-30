import promptPlan from "../../../tools/fixtures/ebay-listing-image-generation-prompt-plan-v1.json"
import {
  runImageGenerationDryRun,
} from "../../../lib/ebay-winner-pipeline/image-generation-dry-run-runner.mjs"

const safetyBadges = [
  "Safe Preview",
  "OpenAI is not connected",
  "No image is generated",
  "No OpenAI call was made",
  "Internal review only",
  "Human review required",
]

const disabledActions = [
  "Generate Image - Disabled",
  "Send to OpenAI - Disabled",
  "Create eBay Draft - Disabled",
  "Publish - Disabled",
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

const dryRunResult = runImageGenerationDryRun(
  promptPlan,
  {
    evaluatedAt:
      promptPlan.generatedAt || "2026-01-01T00:00:00.000Z",
    runnerVersion:
      "IMAGE_GENERATION_DRY_RUN_RUNNER_LOCAL_IMPLEMENTATION_V1",
  }
)

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "Not provided"
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function ListBlock({
  title,
  items,
}: {
  title: string
  items: string[]
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
      <h3 className="text-sm font-black text-white">
        {title}
      </h3>
      <ul className="mt-4 space-y-3 text-sm leading-6 text-white/65">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FieldGrid({
  fields,
}: {
  fields: Array<[string, unknown]>
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
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

export default function EbayImageGeneratorPage() {
  const {
    productFacts,
    visualStrategy,
    trustSignals,
    outputRequirements,
    safetyFlags,
  } = promptPlan
  const {
    trustSignalEvaluation,
    promptSafetyEvaluation,
    outputRequirements: dryRunOutputRequirements,
    safetyFlags: dryRunSafetyFlags,
  } = dryRunResult

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
                Safe Preview
              </p>
              <h1 className="mt-4 text-4xl font-black tracking-[-0.03em] text-white md:text-5xl">
                Image Generator
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">
                OpenAI is not connected. No image is generated. Internal review only. Human review required.
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "Data source",
              "Source: PromptPlan fixture + local dry run runner",
            ],
            [
              "Runner",
              "Calculated locally by runImageGenerationDryRun",
            ],
            [
              "External calls",
              "No external calls were made",
            ],
            [
              "Case ID",
              promptPlan.caseId,
            ],
            [
              "Image role",
              promptPlan.imageRole,
            ],
            [
              "Prompt status",
              promptPlan.promptStatus,
            ],
            [
              "Dry run status",
              dryRunResult.dryRunStatus,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
            >
              <p className="text-xs uppercase tracking-[0.24em] text-white/40">
                {label}
              </p>
              <p className="mt-3 break-words text-lg font-black text-cyan-100">
                {value}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
          <h2 className="text-lg font-black text-white">
            What you are seeing
          </h2>
          <div className="mt-4 grid gap-4 text-sm leading-7 text-white/70 lg:grid-cols-4">
            <p>
              This is a safe read-only view of the PromptPlan fixture.
            </p>
            <p>
              It does not generate an image or call OpenAI.
            </p>
            <p>
              It does not create a real draft or publish to eBay.
            </p>
            <p>
              Every future image requires QA and human review before use.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.045] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-100/60">
                Dry Run Result
              </p>
              <h2 className="mt-3 text-2xl font-black text-white">
                Image generation cannot proceed yet
              </h2>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-white/65">
                No OpenAI call was made. No image was generated. No eBay draft was created. No listing was published. Human review required.
              </p>
            </div>
            <div className="grid gap-2 text-sm font-black text-amber-100 sm:grid-cols-2">
              <span className="rounded-2xl border border-amber-200/20 bg-black/25 px-4 py-3">
                {dryRunResult.dryRunStatus}
              </span>
              <span className="rounded-2xl border border-amber-200/20 bg-black/25 px-4 py-3">
                {dryRunResult.recommendedNextState}
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Dry Run Summary
          </h2>
          <div className="mt-5">
            <FieldGrid
              fields={[
                [
                  "resultVersion",
                  dryRunResult.resultVersion,
                ],
                [
                  "caseId",
                  dryRunResult.caseId,
                ],
                [
                  "candidateName",
                  dryRunResult.candidateName,
                ],
                [
                  "evaluatedAt",
                  dryRunResult.evaluatedAt,
                ],
                [
                  "sourcePromptPlanVersion",
                  dryRunResult.sourcePromptPlanVersion,
                ],
                [
                  "imageRole",
                  dryRunResult.imageRole,
                ],
                [
                  "targetBuyer",
                  dryRunResult.targetBuyer,
                ],
                [
                  "language",
                  dryRunResult.language,
                ],
                [
                  "dryRunStatus",
                  dryRunResult.dryRunStatus,
                ],
                [
                  "recommendedNextState",
                  dryRunResult.recommendedNextState,
                ],
                [
                  "decisionSummary",
                  dryRunResult.decisionSummary,
                ],
              ]}
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <ListBlock
            title="Missing Data"
            items={dryRunResult.missingData}
          />
          <ListBlock
            title="Blocking Reasons"
            items={
              dryRunResult.blockingReasons.length > 0
                ? dryRunResult.blockingReasons
                : [
                    "No final blocking reason was applied, but more data is required before generation.",
                  ]
            }
          />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Trust Signal Evaluation
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Unverified trust signals are shown as not verified and needs data or blocked. They are not usable for a final image.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(trustSignalEvaluation).map(([key, signal]) => (
              <div
                key={key}
                className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.045] p-5"
              >
                <p className="text-sm font-black text-white">
                  {
                    trustSignalLabels[
                      key as keyof typeof trustSignalLabels
                    ]
                  }
                </p>
                <div className="mt-4 space-y-2 text-sm text-white/65">
                  <p>
                    requested: {formatValue(signal.requested)}
                  </p>
                  <p>
                    allowed: {formatValue(signal.allowed)}
                  </p>
                  <p>
                    verified: {formatValue(signal.verified)}
                  </p>
                  <p className="font-bold text-amber-100">
                    decision: {signal.decision}
                  </p>
                  <p>
                    reason: {signal.reason}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Prompt Safety Evaluation
          </h2>
          <div className="mt-5">
            <FieldGrid
              fields={Object.entries(promptSafetyEvaluation)}
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Dry Run Output Requirements
            </h2>
            <div className="mt-5">
              <FieldGrid
                fields={[
                  [
                    "intendedUse",
                    dryRunOutputRequirements.intendedUse,
                  ],
                  [
                    "mayGenerateImage",
                    dryRunOutputRequirements.mayGenerateImage,
                  ],
                  [
                    "mayCallOpenAi",
                    dryRunOutputRequirements.mayCallOpenAi,
                  ],
                  [
                    "mayCreateRealDraft",
                    dryRunOutputRequirements.mayCreateRealDraft,
                  ],
                  [
                    "mayPublish",
                    dryRunOutputRequirements.mayPublish,
                  ],
                  [
                    "mayMutateListing",
                    dryRunOutputRequirements.mayMutateListing,
                  ],
                  [
                    "requiresImageQaBeforeUse",
                    dryRunOutputRequirements.requiresImageQaBeforeUse,
                  ],
                  [
                    "requiresHumanReview",
                    dryRunOutputRequirements.requiresHumanReview,
                  ],
                ]}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Dry Run Safety Flags
            </h2>
            <div className="mt-5">
              <FieldGrid
                fields={[
                  [
                    "advisoryOnly",
                    dryRunSafetyFlags.advisoryOnly,
                  ],
                  [
                    "dryRunOnly",
                    dryRunSafetyFlags.dryRunOnly,
                  ],
                  [
                    "documentationOnly",
                    (dryRunSafetyFlags as Record<string, unknown>)
                      .documentationOnly,
                  ],
                  [
                    "openAiApiUsed",
                    dryRunSafetyFlags.openAiApiUsed,
                  ],
                  [
                    "imageGenerated",
                    dryRunSafetyFlags.imageGenerated,
                  ],
                  [
                    "externalCallsMade",
                    dryRunSafetyFlags.externalCallsMade,
                  ],
                  [
                    "ebayApiUsed",
                    dryRunSafetyFlags.ebayApiUsed,
                  ],
                  [
                    "realDraftCreated",
                    dryRunSafetyFlags.realDraftCreated,
                  ],
                  [
                    "publishedToEbay",
                    dryRunSafetyFlags.publishedToEbay,
                  ],
                  [
                    "listingMutated",
                    dryRunSafetyFlags.listingMutated,
                  ],
                  [
                    "reportPersisted",
                    dryRunSafetyFlags.reportPersisted,
                  ],
                  [
                    "humanReviewRequired",
                    dryRunSafetyFlags.humanReviewRequired,
                  ],
                ]}
              />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Human Review Requirements
          </h2>
          <div className="mt-5">
            <ListBlock
              title="humanReviewRequirements"
              items={dryRunResult.humanReviewRequirements}
            />
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Disabled Actions
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {disabledActions.map((label) => (
              <button
                key={label}
                type="button"
                disabled
                className="cursor-not-allowed rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-black text-white/45"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            PromptPlan Summary
          </h2>
          <div className="mt-5">
            <FieldGrid
              fields={[
                [
                  "promptVersion",
                  promptPlan.promptVersion,
                ],
                [
                  "caseId",
                  promptPlan.caseId,
                ],
                [
                  "candidateName",
                  promptPlan.candidateName,
                ],
                [
                  "imageRole",
                  promptPlan.imageRole,
                ],
                [
                  "targetBuyer",
                  promptPlan.targetBuyer,
                ],
                [
                  "language",
                  promptPlan.language,
                ],
                [
                  "promptStatus",
                  promptPlan.promptStatus,
                ],
              ]}
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Product Facts
            </h2>
            <div className="mt-5">
              <FieldGrid
                fields={[
                  [
                    "productName",
                    productFacts.productName,
                  ],
                  [
                    "category",
                    productFacts.category,
                  ],
                  [
                    "color",
                    productFacts.color,
                  ],
                  [
                    "material",
                    productFacts.material,
                  ],
                  [
                    "dimensions",
                    "Missing verified dimensions",
                  ],
                  [
                    "factsVerified",
                    productFacts.factsVerified,
                  ],
                ]}
              />
            </div>
            <div className="mt-5 grid gap-4">
              <ListBlock
                title="packageContents"
                items={productFacts.packageContents}
              />
              <ListBlock
                title="allowedUseCases"
                items={productFacts.allowedUseCases}
              />
              <ListBlock
                title="knownLimitations"
                items={productFacts.knownLimitations}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Visual Strategy
            </h2>
            <div className="mt-5">
              <FieldGrid
                fields={[
                  [
                    "backgroundStyle",
                    visualStrategy.backgroundStyle,
                  ],
                  [
                    "composition",
                    visualStrategy.composition,
                  ],
                  [
                    "lighting",
                    visualStrategy.lighting,
                  ],
                  [
                    "mobileFirst",
                    visualStrategy.mobileFirst,
                  ],
                  [
                    "productMustRemainHero",
                    visualStrategy.productMustRemainHero,
                  ],
                  [
                    "lifestyleContext",
                    visualStrategy.lifestyleContext,
                  ],
                  [
                    "avoidVisualClutter",
                    visualStrategy.avoidVisualClutter,
                  ],
                ]}
              />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Trust Signals
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Unverified trust signals are blocked or needs data. They are not usable for a final image.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(trustSignals).map(([key, signal]) => (
              <div
                key={key}
                className="rounded-2xl border border-orange-300/20 bg-orange-300/[0.05] p-5"
              >
                <p className="text-sm font-black text-white">
                  {
                    trustSignalLabels[
                      key as keyof typeof trustSignalLabels
                    ]
                  }
                </p>
                <div className="mt-4 space-y-2 text-sm text-white/65">
                  <p>
                    allowed: {formatValue(signal.allowed)}
                  </p>
                  <p>
                    verified: {formatValue(signal.verified)}
                  </p>
                  <p className="font-bold text-orange-100">
                    status: blocked/needs data
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <ListBlock
            title="Allowed Claims"
            items={promptPlan.allowedClaims}
          />
          <ListBlock
            title="Prohibited Claims"
            items={promptPlan.prohibitedClaims}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <ListBlock
            title="Required Elements"
            items={promptPlan.requiredElements}
          />
          <ListBlock
            title="Forbidden Elements"
            items={promptPlan.forbiddenElements}
          />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Safety Rules
          </h2>
          <div className="mt-5">
            <ListBlock
              title="safetyRules"
              items={promptPlan.safetyRules}
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Output Requirements
            </h2>
            <div className="mt-5">
              <FieldGrid
                fields={Object.entries(outputRequirements)}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Safety Flags
            </h2>
            <div className="mt-5">
              <FieldGrid
                fields={Object.entries(safetyFlags)}
              />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-black text-white">
            Required Human Actions
          </h2>
          <div className="mt-5">
            <ListBlock
              title="requiredHumanActions"
              items={promptPlan.requiredHumanActions}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
