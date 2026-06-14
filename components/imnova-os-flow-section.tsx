"use client"

import {
  useState,
} from "react"

import {
  motion,
} from "framer-motion"

import {
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  FlaskConical,
  Lightbulb,
  RefreshCw,
  Rocket,
  Sparkles,
  UsersRound,
} from "lucide-react"

type ImnovaOsFlowSectionProps = {
  onJoinCommunity: () => void
}

const osFlowSteps = [
  {
    id: "community",
    label: "1",
    title: "La comunidad elige",
    shortTitle: "Comunidad",
    plain:
      "La persona dice que temas le interesan.",
    imnova:
      "IMNOVA guarda esa senal como interes real de comunidad.",
    result:
      "Sabemos que quiere la gente antes de crear mas productos.",
    icon: UsersRound,
    tone:
      "cyan",
  },
  {
    id: "demand",
    label: "2",
    title: "Se ordena la demanda",
    shortTitle: "Demanda",
    plain:
      "Los intereses se agrupan por nichos y subnichos.",
    imnova:
      "El Admin ve que temas tienen mas comunidad interesada.",
    result:
      "Aparecen oportunidades claras: con producto, sin producto o en validacion.",
    icon: BarChart3,
    tone:
      "emerald",
  },
  {
    id: "idea",
    label: "3",
    title: "Nace una idea",
    shortTitle: "Idea",
    plain:
      "Una necesidad se convierte en concepto de producto.",
    imnova:
      "El producto recibe nicho, subnicho, problema humano y beneficio esperado.",
    result:
      "La idea deja de ser intuicion y entra al sistema IMNOVA OS.",
    icon: Lightbulb,
    tone:
      "amber",
  },
  {
    id: "survey",
    label: "4",
    title: "Se pregunta antes de fabricar",
    shortTitle: "Encuesta",
    plain:
      "La comunidad responde encuestas simples.",
    imnova:
      "Cada encuesta hereda el nicho y subnicho del producto.",
    result:
      "Las respuestas ayudan a decidir si la idea merece avanzar.",
    icon: ClipboardCheck,
    tone:
      "violet",
  },
  {
    id: "validation",
    label: "5",
    title: "IMNOVA valida",
    shortTitle: "Validacion",
    plain:
      "Se revisan interes, senales, riesgo y utilidad real.",
    imnova:
      "El producto puede avanzar, ajustarse, pausarse o descartarse.",
    result:
      "No todo se lanza: solo avanza lo que demuestra sentido.",
    icon: FlaskConical,
    tone:
      "cyan",
  },
  {
    id: "launch",
    label: "6",
    title: "Llega al mercado",
    shortTitle: "Lanzamiento",
    plain:
      "El producto se prepara para compra, disponibilidad y canales.",
    imnova:
      "Se conectan store, marketplaces, distribuidores y comunicacion.",
    result:
      "La comunidad ve productos mas alineados con lo que pidio.",
    icon: Rocket,
    tone:
      "emerald",
  },
  {
    id: "learning",
    label: "7",
    title: "El aprendizaje vuelve",
    shortTitle: "Aprendizaje",
    plain:
      "Cada compra, encuesta y senal mejora la siguiente decision.",
    imnova:
      "IMNOVA OS vuelve a alimentar demanda, productos y nuevas pruebas.",
    result:
      "El sistema aprende y la innovacion no empieza desde cero.",
    icon: RefreshCw,
    tone:
      "amber",
  },
]

const toneClassNames = {
  cyan:
    "border-cyan-200/35 bg-cyan-300/[0.10] text-cyan-100 shadow-[0_0_34px_rgba(34,211,238,0.12)]",
  emerald:
    "border-emerald-200/30 bg-emerald-300/[0.09] text-emerald-100 shadow-[0_0_34px_rgba(16,185,129,0.10)]",
  amber:
    "border-amber-200/30 bg-amber-200/[0.09] text-amber-100 shadow-[0_0_34px_rgba(251,191,36,0.10)]",
  violet:
    "border-violet-200/30 bg-violet-300/[0.10] text-violet-100 shadow-[0_0_34px_rgba(167,139,250,0.10)]",
}

export function ImnovaOsFlowSection({
  onJoinCommunity,
}: ImnovaOsFlowSectionProps) {
  const [
    activeStepId,
    setActiveStepId,
  ] =
    useState(
      osFlowSteps[0].id
    )

  const activeStep =
    osFlowSteps.find(
      step =>
        step.id === activeStepId
    ) || osFlowSteps[0]

  const ActiveIcon =
    activeStep.icon

  return (
    <section
      id="imnova-os"
      className="relative z-20 overflow-hidden bg-[#030303] px-6 py-28 md:py-36"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/25 to-transparent" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] bg-[linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] bg-[size:82px_82px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(34,211,238,0.06),transparent_28%,rgba(251,191,36,0.04)_72%,transparent)]" />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
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
            <div className="inline-flex items-center gap-3 rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-5 py-3">
              <Sparkles className="h-4 w-4 text-cyan-100" />
              <span className="text-[10px] font-black uppercase tracking-[0.30em] text-cyan-100/70">
                Como funciona IMNOVA OS
              </span>
            </div>

            <h2 className="mt-8 max-w-4xl text-4xl font-black leading-[0.98] tracking-[-0.045em] text-white md:text-6xl">
              De intereses reales
              <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
                a mejores productos.
              </span>
            </h2>

            <p className="mt-7 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
              IMNOVA OS es el sistema que conecta comunidad, demanda, encuestas,
              productos y aprendizaje. En simple: escuchamos primero, validamos
              despues y lanzamos con mas claridad.
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
                label: "Entrada",
                value: "Intereses",
                detail:
                  "Lo que la comunidad elige.",
              },
              {
                label: "Motor",
                value: "Validacion",
                detail:
                  "Encuestas, senales y decision.",
              },
              {
                label: "Salida",
                value: "Productos",
                detail:
                  "Lanzamientos con mas sentido.",
              },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-[26px] border border-white/10 bg-white/[0.035] p-5"
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

        <div className="mt-16 grid gap-8 lg:grid-cols-[1fr_420px]">
          <motion.div
            initial={{
              opacity: 0,
              y: 32,
            }}
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.8,
            }}
            viewport={{
              once: true,
            }}
            className="relative"
          >
            <div className="hidden lg:block absolute left-8 right-8 top-[74px] h-px bg-gradient-to-r from-cyan-200/20 via-white/18 to-amber-200/20" />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {osFlowSteps.map((step, index) => {
                const Icon =
                  step.icon

                const isActive =
                  step.id === activeStep.id

                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() =>
                      setActiveStepId(step.id)
                    }
                    className={`
                      group
                      relative
                      min-h-[178px]
                      rounded-[28px]
                      border
                      p-5
                      text-left
                      transition-all
                      duration-300
                      ${
                        isActive
                          ? toneClassNames[step.tone as keyof typeof toneClassNames]
                          : "border-white/10 bg-black/35 text-white/65 hover:border-white/20 hover:bg-white/[0.045]"
                      }
                    `}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`
                          flex
                          h-11
                          w-11
                          items-center
                          justify-center
                          rounded-2xl
                          border
                          ${
                            isActive
                              ? "border-white/25 bg-black/25"
                              : "border-white/10 bg-white/[0.04] text-cyan-100/70"
                          }
                        `}
                      >
                        <Icon className="h-5 w-5" />
                      </span>

                      <span className="text-[10px] font-black uppercase tracking-[0.22em] opacity-55">
                        Paso {step.label}
                      </span>
                    </div>

                    <p className="mt-5 text-lg font-black leading-tight text-white">
                      {step.shortTitle}
                    </p>

                    <p className="mt-3 text-sm leading-6 text-zinc-400 group-hover:text-zinc-300">
                      {step.plain}
                    </p>

                    {index < osFlowSteps.length - 1 && (
                      <span className="absolute -right-3 top-[62px] hidden h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black text-white/45 xl:flex">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </motion.div>

          <motion.aside
            key={activeStep.id}
            initial={{
              opacity: 0,
              x: 18,
            }}
            animate={{
              opacity: 1,
              x: 0,
            }}
            transition={{
              duration: 0.35,
            }}
            className="rounded-[32px] border border-white/10 bg-black/45 p-6 shadow-[0_30px_130px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
          >
            <div
              className={`
                inline-flex
                h-14
                w-14
                items-center
                justify-center
                rounded-2xl
                border
                ${toneClassNames[activeStep.tone as keyof typeof toneClassNames]}
              `}
            >
              <ActiveIcon className="h-6 w-6" />
            </div>

            <p className="mt-6 text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/55">
              Paso {activeStep.label} · IMNOVA OS
            </p>

            <h3 className="mt-3 text-3xl font-black leading-tight tracking-[-0.035em] text-white">
              {activeStep.title}
            </h3>

            <div className="mt-7 space-y-4">
              {[
                {
                  label: "En palabras simples",
                  text:
                    activeStep.plain,
                },
                {
                  label: "Que hace IMNOVA",
                  text:
                    activeStep.imnova,
                },
                {
                  label: "Resultado",
                  text:
                    activeStep.result,
                },
              ].map(item => (
                <div
                  key={item.label}
                  className="border-l border-cyan-200/20 pl-4"
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                    {item.label}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                onClick={onJoinCommunity}
                className="inline-flex items-center justify-center gap-3 rounded-2xl border border-cyan-200/40 bg-cyan-200 px-5 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-black transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
              >
                Participar en IMNOVA OS
                <ArrowRight className="h-4 w-4" />
              </button>

              <a
                href="#innovations"
                className="inline-flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-white/65 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
              >
                Ver ideas activas
                <Sparkles className="h-4 w-4" />
              </a>
            </div>
          </motion.aside>
        </div>
      </div>
    </section>
  )
}
