import listingAdminReadOnlyData from "../../../tools/fixtures/ebay-listing-admin-read-only-items-v1.json"

const contractVersion =
  "EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1"

const safetyBadges = [
  "Read-only",
  "Dry-run",
  "No eBay API",
  "No real draft",
  "Not published",
  "Human review required",
]

const disabledActions = [
  "No publish",
  "No real draft",
  "No eBay sync",
  "No listing mutation",
  "No OAuth",
  "No Supabase write",
]

const decisionTones = {
  PROCEED_TO_HUMAN_REVIEW:
    "border-emerald-300/20 bg-emerald-300/[0.05]",
  BLOCK_DO_NOT_ADVANCE:
    "border-red-300/20 bg-red-300/[0.05]",
  REVIEW_ECONOMICS:
    "border-amber-300/20 bg-amber-300/[0.05]",
  COMPLETE_MISSING_DATA:
    "border-orange-300/20 bg-orange-300/[0.05]",
  REVIEW_COMPLIANCE:
    "border-yellow-300/20 bg-yellow-300/[0.05]",
  DISCARD_CANDIDATE:
    "border-slate-300/20 bg-slate-300/[0.05]",
}

const decisionLabels = {
  PROCEED_TO_HUMAN_REVIEW:
    "Puede pasar a revisión humana",
  COMPLETE_MISSING_DATA:
    "Faltan datos antes de avanzar",
  REVIEW_ECONOMICS:
    "Revisar precio, margen y ROI",
  REVIEW_COMPLIANCE:
    "Revisar cumplimiento y riesgos",
  BLOCK_DO_NOT_ADVANCE:
    "Bloqueado: no avanzar",
  DISCARD_CANDIDATE:
    "Descartar candidato",
}

const listingStateLabels = {
  LISTING_DRAFT_READY:
    "Propuesta lista para revisión interna",
  LISTING_DATA_INCOMPLETE:
    "Datos incompletos",
  LISTING_REVIEW_REQUIRED:
    "Revisión requerida",
  LISTING_BLOCKED:
    "Bloqueado",
}

const qaStateLabels = {
  QA_PASSED_FOR_HUMAN_REVIEW:
    "QA pasó para revisión humana",
  QA_INCOMPLETE:
    "QA incompleto",
  QA_REVIEW_REQUIRED:
    "QA requiere revisión",
  QA_BLOCKED:
    "QA bloqueado",
}

const safetySummaryLabels = {
  totalItems:
    "Propuestas simuladas",
  blockedItems:
    "Bloqueadas",
  itemsRequiringHumanReview:
    "Requieren revisión humana",
  unsafeItemsRejected:
    "Rechazadas por seguridad",
}

const safetyFlags =
  Object.entries(
    listingAdminReadOnlyData.items[0]?.safetyFlags ?? {}
  ).map(([label, value]) => [
    label,
    String(value),
  ])

function formatListSummary(values: string[]) {
  if (values.length === 0) {
    return "None"
  }

  return values.join(", ")
}

export default function EbayListingProposalsPage() {
  const {
    items,
    safetySummary,
  } = listingAdminReadOnlyData

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
                Read-only dry-run visibility
              </p>
              <h1 className="mt-4 text-4xl font-black tracking-[-0.03em] text-white md:text-5xl">
                eBay Listing Proposals
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">
                This screen is advisory-only. No eBay action is performed.
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

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/50">
            Qué estás viendo
          </p>
          <div className="mt-4 grid gap-4 text-sm leading-7 text-white/70 lg:grid-cols-3">
            <p>
              Esta pantalla muestra propuestas simuladas de listing para revisión interna.
            </p>
            <p>
              No publica, no crea drafts reales y no se conecta con eBay.
            </p>
            <p>
              Su objetivo es ayudarte a entender qué productos podrían avanzar, cuáles requieren datos y cuáles están bloqueados.
            </p>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Data status
            </h2>
            <div className="mt-5 grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-white/40">
                  Data source
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  simulated fixture
                </p>
                <p className="mt-1 text-xs text-white/40">
                  Data source: simulated fixture
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-white/40">
                  Contract
                </p>
                <p className="mt-2 break-words text-sm font-semibold text-white">
                  {contractVersion}
                </p>
                <p className="mt-1 font-mono text-[11px] text-white/35">
                  contractVersion
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-black text-white">
              Confirmaciones de seguridad
            </h2>
            <p className="mt-2 font-mono text-[11px] text-white/35">
              Safety flags
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {safetyFlags.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <span className="text-xs text-white/45">
                    {label}
                  </span>
                  <span className="text-sm font-black text-cyan-100">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-lg font-black text-white">
              Resumen seguro
            </h2>
            <p className="font-mono text-[11px] text-white/35">
              safetySummary
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(safetySummary).map(([label, value]) => (
              <div
                key={label}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
              >
                <p className="text-xs uppercase tracking-[0.24em] text-white/40">
                  {
                    safetySummaryLabels[
                      label as keyof typeof safetySummaryLabels
                    ] ?? label
                  }
                </p>
                <p className="mt-1 font-mono text-[11px] text-white/35">
                  {label}
                </p>
                <p className="mt-3 text-3xl font-black text-cyan-100">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/50">
                Simulated fixture
              </p>
              <h2 className="mt-2 text-2xl font-black text-white">
                Read-only proposal items
              </h2>
            </div>
            <p className="text-sm text-white/45">
              Safe fixture records only. No real product data.
            </p>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            {items.map((item) => (
              <article
                key={item.caseId}
                className={`rounded-3xl border p-5 ${
                  decisionTones[
                    item.recommendedDecision as keyof typeof decisionTones
                  ]
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">
                  {item.caseId}
                </p>
                <h3 className="mt-3 text-lg font-black text-white">
                  {item.candidateName}
                </h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {item.badges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[11px] font-semibold text-white/70"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-xs text-white/40">
                      Estado del listing
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {
                        listingStateLabels[
                          item.listingState as keyof typeof listingStateLabels
                        ] ?? item.listingState
                      }
                      <span className="mt-1 block font-mono text-[11px] font-semibold text-white/35">
                        listingState: {item.listingState}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">
                      Estado QA
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {
                        qaStateLabels[
                          item.qaState as keyof typeof qaStateLabels
                        ] ?? item.qaState
                      }
                      <span className="mt-1 block font-mono text-[11px] font-semibold text-white/35">
                        qaState: {item.qaState}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">
                      Decisión recomendada
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {
                        decisionLabels[
                          item.recommendedDecision as keyof typeof decisionLabels
                        ] ?? item.recommendedDecision
                      }
                      <span className="mt-1 block font-mono text-[11px] font-semibold text-white/35">
                        recommendedDecision: {item.recommendedDecision}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">
                      Datos faltantes
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {item.missingData.length}:{" "}
                      {formatListSummary(item.missingData)}
                      <span className="mt-1 block font-mono text-[11px] font-semibold text-white/35">
                        missingData
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">
                      Riesgos detectados
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {item.riskFlags.length}:{" "}
                      {formatListSummary(item.riskFlags)}
                      <span className="mt-1 block font-mono text-[11px] font-semibold text-white/35">
                        riskFlags
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">
                      Razones de bloqueo
                    </dt>
                    <dd className="mt-1 break-words text-sm font-bold text-white">
                      {item.blockedReasons.length}:{" "}
                      {formatListSummary(item.blockedReasons)}
                      <span className="mt-1 block font-mono text-[11px] font-semibold text-white/35">
                        blockedReasons
                      </span>
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                    Acciones humanas requeridas
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-white/35">
                    Required human actions
                  </p>
                  <ul className="mt-3 space-y-2 text-sm font-semibold text-white/75">
                    {item.requiredHumanActions.map((action) => (
                      <li key={action}>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-red-300/15 bg-red-300/[0.04] p-6">
          <h2 className="text-lg font-black text-white">
            Actions disabled in V1
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {disabledActions.map((action) => (
              <div
                key={action}
                className="rounded-2xl border border-red-200/10 bg-black/20 px-4 py-3 text-sm font-semibold text-red-50/80"
              >
                {action}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
