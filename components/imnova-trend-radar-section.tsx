"use client"

import { motion } from "framer-motion"

import {
  Activity,
  ArrowUpRight,
  Coffee,
  Dumbbell,
  Leaf,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

type ImnovaTrendRadarSectionProps = {
  onJoinCommunity: () => void
}

const trendSignals = [
  {
    label: "Rendimiento diario",
    title: "Creatina, proteina y recuperacion activa",
    niche: "Fitness, rendimiento y recuperacion",
    summary:
      "El interes por ingredientes usados en rendimiento se esta moviendo hacia rutinas mas cotidianas: energia, fuerza, recuperacion y consistencia.",
    opportunity:
      "IMNOVA lo observa para posibles formatos simples, claros y faciles de integrar a la vida diaria.",
    sourceLabel: "NIH ODS",
    sourceHref:
      "https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/",
    icon: Dumbbell,
    tone:
      "border-cyan-200/25 bg-cyan-300/[0.07] text-cyan-100",
  },
  {
    label: "Microbiota",
    title: "Digestión, balance y alimentos funcionales",
    niche: "Bienestar y salud natural",
    summary:
      "La conversacion sobre microbiota mantiene a la digestion como una entrada fuerte para bebidas, fibras, fermentados y formulas de balance diario.",
    opportunity:
      "El radar ayuda a detectar si la comunidad quiere soluciones de digestion, ligereza o bienestar intestinal.",
    sourceLabel: "NIH ODS",
    sourceHref:
      "https://ods.od.nih.gov/factsheets/Probiotics-HealthProfessional/",
    icon: Leaf,
    tone:
      "border-emerald-200/25 bg-emerald-300/[0.07] text-emerald-100",
  },
  {
    label: "Energia limpia",
    title: "Cafe funcional y enfoque sin complicacion",
    niche: "Bienestar y salud natural",
    summary:
      "El cafe sigue siendo un habito diario ideal para probar beneficios funcionales percibidos: energia, enfoque, ritual y conveniencia.",
    opportunity:
      "IMNOVA puede usar encuestas para validar sabores, formatos, combinaciones e interes real antes de ampliar lineas.",
    sourceLabel: "NIH ODS",
    sourceHref:
      "https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/",
    icon: Coffee,
    tone:
      "border-amber-200/25 bg-amber-300/[0.07] text-amber-100",
  },
  {
    label: "Grasas funcionales",
    title: "Omega-3, fuentes algales y bienestar cotidiano",
    niche: "Salud y funcionalidad especifica",
    summary:
      "Las grasas funcionales siguen apareciendo en conversaciones de nutricion, formulacion y consumo consciente, con interes creciente por fuentes alternativas.",
    opportunity:
      "El enfoque correcto es educativo y prudente: observar demanda sin prometer efectos medicos.",
    sourceLabel: "NIH ODS",
    sourceHref:
      "https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/",
    icon: Activity,
    tone:
      "border-violet-200/25 bg-violet-300/[0.07] text-violet-100",
  },
] as const

export function ImnovaTrendRadarSection({
  onJoinCommunity,
}: ImnovaTrendRadarSectionProps) {
  return (
    <section
      id="trend-radar"
      className="relative z-20 overflow-hidden bg-black px-6 py-24 md:py-32"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/20 to-transparent" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] bg-[linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] bg-[size:96px_96px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.55),transparent_40%,rgba(0,0,0,0.72))]" />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <motion.div
            initial={{
              opacity: 0,
              y: 28,
            }}
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.75,
            }}
            viewport={{
              once: true,
            }}
          >
            <div className="inline-flex items-center gap-3 rounded-full border border-amber-200/20 bg-amber-200/[0.08] px-5 py-3">
              <Radar className="h-4 w-4 text-amber-100" />
              <span className="text-[10px] font-black uppercase tracking-[0.30em] text-amber-100/70">
                Radar IMNOVA
              </span>
            </div>

            <h2 className="mt-8 max-w-4xl text-4xl font-black leading-[0.98] tracking-[-0.045em] text-white md:text-6xl">
              Tendencias que estamos
              <span className="block bg-gradient-to-r from-amber-200 via-white to-cyan-200 bg-clip-text text-transparent">
                observando de cerca.
              </span>
            </h2>

            <p className="mt-7 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
              IMNOVA observa senales de mercado, estudios y conversaciones de
              consumo para detectar oportunidades antes de convertirlas en
              productos, encuestas o pruebas.
            </p>
          </motion.div>

          <motion.div
            initial={{
              opacity: 0,
              y: 28,
            }}
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.75,
              delay: 0.08,
            }}
            viewport={{
              once: true,
            }}
            className="grid gap-3 sm:grid-cols-3"
          >
            {[
              {
                label: "Hoy",
                value: "Manual",
                detail:
                  "Seleccionado con criterio editorial.",
              },
              {
                label: "Manana",
                value: "Borradores",
                detail:
                  "Script con fuentes y revision Admin.",
              },
              {
                label: "Siempre",
                value: "Prudente",
                detail:
                  "Sin claims medicos ni promesas.",
              },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-[24px] border border-white/10 bg-white/[0.035] p-5"
              >
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  {item.label}
                </p>
                <p className="mt-4 text-2xl font-black text-white">
                  {item.value}
                </p>
                <p className="mt-3 text-sm leading-6 text-zinc-500">
                  {item.detail}
                </p>
              </div>
            ))}
          </motion.div>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {trendSignals.map((signal, index) => (
            <motion.article
              key={signal.title}
              initial={{
                opacity: 0,
                y: 26,
              }}
              whileInView={{
                opacity: 1,
                y: 0,
              }}
              transition={{
                duration: 0.65,
                delay:
                  index * 0.05,
              }}
              viewport={{
                once: true,
              }}
              className="group rounded-[30px] border border-white/10 bg-white/[0.035] p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-200/20 hover:bg-white/[0.055]"
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${signal.tone}`}
                >
                  <signal.icon className="h-6 w-6" />
                </div>

                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <span className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
                    {signal.label}
                  </span>
                  <span className="rounded-full border border-cyan-200/15 bg-cyan-300/[0.06] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/60">
                    Tendencia observada
                  </span>
                </div>
              </div>

              <h3 className="mt-7 text-2xl font-black leading-tight tracking-[-0.035em] text-white md:text-3xl">
                {signal.title}
              </h3>

              <p className="mt-3 text-[11px] font-black uppercase leading-5 tracking-[0.18em] text-amber-100/55">
                {signal.niche}
              </p>

              <p className="mt-5 text-sm leading-7 text-zinc-400">
                {signal.summary}
              </p>

              <div className="mt-6 rounded-[24px] border border-white/10 bg-black/25 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.20em] text-white/35">
                  Senal para IMNOVA
                </p>
                <p className="mt-3 text-sm leading-7 text-zinc-300">
                  {signal.opportunity}
                </p>
              </div>

              <a
                href={signal.sourceHref}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/50 transition hover:text-white"
              >
                Fuente: {signal.sourceLabel}
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </motion.article>
          ))}
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6">
            <div className="flex gap-4">
              <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-cyan-100" />
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-white/70">
                  Nota editorial
                </p>
                <p className="mt-3 text-sm leading-7 text-zinc-500">
                  Este radar no es consejo medico ni recomendacion de consumo.
                  Son senales para investigar, validar con comunidad y revisar
                  con fuentes confiables antes de crear productos.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onJoinCommunity}
            className="inline-flex items-center justify-center gap-3 rounded-[24px] border border-amber-200/35 bg-amber-200 px-6 py-5 text-[11px] font-black uppercase tracking-[0.18em] text-black transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
          >
            Votar mis intereses
            <Sparkles className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  )
}
