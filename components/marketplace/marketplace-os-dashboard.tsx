import {
  Boxes,
  GitBranch,
  Lock,
  PauseCircle,
  RadioTower,
  ShieldCheck,
} from "lucide-react"

import {
  AmazonDecisionCenter,
} from "@/components/marketplace/amazon-decision-center"
import type {
  buildMarketplaceOsDashboardViewModel,
} from "@/lib/marketplace/marketplace-os-dashboard-view-model"

type DashboardViewModel = ReturnType<typeof buildMarketplaceOsDashboardViewModel>

const pipelineSteps = [
  "Encontrar productos ganadores",
  "Validar cuenta y categoria",
  "Buscar ASIN correcto",
  "Bloquear riesgos antes de listar",
  "Calcular margen y ROI",
  "Decidir ASIN existente vs nuevo",
  "Preparar listing cuando este aprobado",
]

export function MarketplaceOsDashboard({
  viewModel,
}: {
  viewModel: DashboardViewModel
}) {
  return (
    <main className="min-h-screen bg-[#05070d] px-5 py-8 text-white md:px-10">
      <section className="mx-auto grid max-w-7xl gap-7">
        <a
          href="/admin"
          className="w-fit rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/70"
        >
          Volver a Admin
        </a>

        <header className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] p-6 md:p-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/55">
            Centro de decisiones local · sin API · sin publicacion
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="text-3xl font-black text-white md:text-5xl">
                IMNOVA Marketplace OS
              </h1>
              <p className="mt-3 text-xl font-black text-cyan-100">
                Que vender, que bloquear y que hacer ahora
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Version
              </p>
              <p className="mt-2 text-sm font-black text-white">
                {viewModel.dashboardVersion}
              </p>
            </div>
          </div>
          <p className="mt-5 max-w-4xl text-sm leading-7 text-white/65">
            Vista operativa para vendedores. Resume productos evaluados, margen, bloqueos, ASIN probable y proxima accion sin tocar Seller Central, Amazon API, eBay Production, WhatsApp, OpenAI, Produccion o Staging DB.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-lg border border-amber-300/20 bg-amber-300/[0.045] p-5">
            <div className="flex items-center gap-2 text-amber-100">
              <PauseCircle className="h-4 w-4" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">
                eBay
              </h2>
            </div>
            <p className="mt-4 text-lg font-black text-white">
              {viewModel.ebayTrack.status}
            </p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              {viewModel.ebayTrack.reason}. {viewModel.ebayTrack.nextAction}.
            </p>
          </article>

          <article className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.045] p-5">
            <div className="flex items-center gap-2 text-emerald-100">
              <RadioTower className="h-4 w-4" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">
                Amazon
              </h2>
            </div>
            <p className="mt-4 text-lg font-black text-white">
              {viewModel.amazonTrack.status}
            </p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              Track activo para investigar productos, decidir ruta ASIN y evitar listings riesgosos.
            </p>
          </article>

          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center gap-2 text-cyan-100">
              <Lock className="h-4 w-4" />
              <h2 className="text-sm font-black uppercase tracking-[0.18em]">
                Produccion
              </h2>
            </div>
            <p className="mt-4 text-lg font-black text-white">
              {viewModel.production.status}
            </p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              Nada se publica ni se escribe en marketplaces desde esta vista.
            </p>
          </article>
        </section>

        <section className="rounded-lg border border-white/10 bg-black/25 p-5">
          <div className="flex items-center gap-2 text-cyan-100">
            <Boxes className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              Flujo Amazon
            </h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {pipelineSteps.map(step => (
              <div
                key={step}
                className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
              >
                <p className="text-sm font-black text-white">
                  {step}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/45">
                  Control local antes de vender
                </p>
              </div>
            ))}
          </div>
        </section>

        <AmazonDecisionCenter viewModel={viewModel} />

        <section className="rounded-lg border border-violet-300/20 bg-violet-300/[0.045] p-5">
          <div className="flex items-center gap-2 text-violet-100">
            <GitBranch className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              Automejora IMNOVA / Roadmap Codex
            </h2>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
            <div>
              <p className="text-lg font-black text-white">
                Mejoras internas con aprobacion humana
              </p>
              <p className="mt-3 text-sm leading-7 text-white/65">
                IMNOVA OS podra detectar oportunidades de mejora, preparar work orders/prompts para Codex y pasarlos por aprobacion humana antes de cualquier implementacion.
              </p>
              <p className="mt-3 text-sm leading-7 text-white/65">
                Codex API no esta conectada. No hay cambios automaticos de codigo, merge automatico, writes a main, toque a Produccion ni secretos en prompts.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Secuencia segura
              </p>
              <p className="mt-3 text-sm font-black text-white">
                {viewModel.codexSelfImprovement.nextPlannedLoop}
              </p>
              <p className="mt-3 text-sm font-black text-white">
                {viewModel.codexSelfImprovement.futureApiLoop}
              </p>
              <p className="mt-3 text-sm font-black text-cyan-100">
                Luego continuar Amazon: {viewModel.thenContinueToAmazonListingPackageBuilder}
              </p>
              <button
                className="mt-5 rounded-md border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/35"
                disabled
                type="button"
              >
                Solo preview
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center gap-2 text-cyan-100">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">
              WhatsApp + Automatizacion
            </h2>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {viewModel.roadmap.map(item => (
              <article
                key={item.name}
                className="rounded-lg border border-white/10 bg-black/25 p-4"
              >
                <p className="text-sm font-black text-white">
                  {item.name}
                </p>
                <p className="mt-2 text-sm text-cyan-100/70">
                  {item.status}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/50">
                  {item.safety}
                </p>
                <button
                  className="mt-4 rounded-md border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/35"
                  disabled
                  type="button"
                >
                  Solo preview
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}
