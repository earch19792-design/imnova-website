"use client"

import { useState } from "react"

import { motion } from "framer-motion"

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
    label: "01",
    title: "La comunidad elige",
    shortTitle: "Intereses",
    simple:
      "La persona selecciona los temas que realmente le importan.",
    imnova:
      "IMNOVA convierte esa eleccion en una senal ordenada de comunidad.",
    result:
      "El sistema empieza escuchando, no adivinando.",
    icon: UsersRound,
    tone: "cyan",
  },
  {
    id: "demand",
    label: "02",
    title: "Se mide la demanda",
    shortTitle: "Demanda",
    simple:
      "Los intereses se agrupan por nichos y areas de oportunidad.",
    imnova:
      "El Admin muestra que temas tienen mas comunidad interesada.",
    result:
      "Aparecen oportunidades con producto, sin producto o en validacion.",
    icon: BarChart3,
    tone: "emerald",
  },
  {
    id: "idea",
    label: "03",
    title: "Nace una idea",
    shortTitle: "Idea",
    simple:
      "Una necesidad clara se convierte en concepto de producto.",
    imnova:
      "La idea recibe nicho, problema humano y beneficio esperado.",
    result:
      "Deja de ser una ocurrencia y entra al sistema IMNOVA OS.",
    icon: Lightbulb,
    tone: "amber",
  },
  {
    id: "survey",
    label: "04",
    title: "Se pregunta antes",
    shortTitle: "Encuesta",
    simple:
      "La comunidad responde preguntas cortas y faciles.",
    imnova:
      "Cada encuesta queda conectada al nicho y al producto correcto.",
    result:
      "La decision se apoya en senales reales, no solo en intuicion.",
    icon: ClipboardCheck,
    tone: "violet",
  },
  {
    id: "decision",
    label: "05",
    title: "Se decide con criterio",
    shortTitle: "Decision",
    simple:
      "IMNOVA revisa interes, utilidad, riesgo y claridad comercial.",
    imnova:
      "El producto puede avanzar, ajustarse, pausarse o descartarse.",
    result:
      "Solo avanza lo que demuestra sentido para la comunidad y el mercado.",
    icon: FlaskConical,
    tone: "cyan",
  },
  {
    id: "launch",
    label: "06",
    title: "Se prepara el lanzamiento",
    shortTitle: "Producto",
    simple:
      "El producto se conecta con disponibilidad, canales y comunicacion.",
    imnova:
      "Store, distribuidores, encuestas y comunidad trabajan con la misma informacion.",
    result:
      "El lanzamiento llega con mas claridad y menos improvisacion.",
    icon: Rocket,
    tone: "emerald",
  },
  {
    id: "learning",
    label: "07",
    title: "El aprendizaje vuelve",
    shortTitle: "Aprendizaje",
    simple:
      "Cada encuesta, registro y compra mejora la siguiente decision.",
    imnova:
      "IMNOVA OS vuelve a alimentar demanda, productos y futuras pruebas.",
    result:
      "El sistema aprende y la innovacion no empieza desde cero.",
    icon: RefreshCw,
    tone: "amber",
  },
] as const

const osSystemStages = [
  {
    label: "Entrada",
    title: "Comunidad",
    detail:
      "Personas, WhatsApp, correo e intereses.",
    stepId: "community",
    accent: "bg-cyan-200 text-black",
  },
  {
    label: "Orden",
    title: "Nichos + demanda",
    detail:
      "Temas elegidos, prioridad y oportunidades.",
    stepId: "demand",
    accent: "bg-emerald-200 text-black",
  },
  {
    label: "Prueba",
    title: "Ideas + encuestas",
    detail:
      "Preguntas antes de fabricar o escalar.",
    stepId: "survey",
    accent: "bg-violet-200 text-black",
  },
  {
    label: "Salida",
    title: "Productos",
    detail:
      "Avanzar, ajustar, pausar o lanzar.",
    stepId: "launch",
    accent: "bg-amber-200 text-black",
  },
] as const

const toneClassNames = {
  cyan:
    "border-cyan-200/35 bg-cyan-300/[0.10] text-cyan-100 shadow-[0_0_34px_rgba(34,211,238,0.12)]",
  emerald:
    "border-emerald-200/30 bg-emerald-300/[0.09] text-emerald-100 shadow-[0_0_34px_rgba(16,185,129,0.10)]",
  amber:
    "border-amber-200/30 bg-amber-200/[0.09] text-amber-100 shadow-[0_0_34px_rgba(251,191,36,0.10)]",
  violet:
    "border-violet-200/30 bg-violet-300/[0.10] text-violet-100 shadow-[0_0_34px_rgba(167,139,250,0.10)]",
} as const

const activeStageIds = {
  Entrada: [
    "community",
  ],
  Orden: [
    "demand",
    "idea",
  ],
  Prueba: [
    "survey",
    "decision",
  ],
  Salida: [
    "launch",
    "learning",
  ],
} as const

export function ImnovaOsFlowSection({
  onJoinCommunity,
}: ImnovaOsFlowSectionProps) {
  const [
    activeStepId,
    setActiveStepId,
  ] =
    useState<(typeof osFlowSteps)[number]["id"]>(
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(34,211,238,0.13),transparent_34%),radial-gradient(circle_at_82%_68%,rgba(251,191,36,0.10),transparent_34%)]" />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-end">
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
              Un sistema que escucha,
              <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
                valida y lanza mejor.
              </span>
            </h2>

            <p className="mt-7 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
              IMNOVA OS conecta comunidad, demanda, encuestas y productos en un
              circuito simple: primero escuchamos, luego validamos y despues
              decidimos que debe avanzar.
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
                value: "Demanda",
                detail:
                  "Lo que IMNOVA analiza.",
              },
              {
                label: "Salida",
                value: "Productos",
                detail:
                  "Lo que puede avanzar.",
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

        <div className="mt-16 grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
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
            <div className="rounded-[32px] border border-white/10 bg-black/45 p-6 shadow-[0_30px_130px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:p-7">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/55">
                    Mapa simple
                  </p>
                  <h3 className="mt-3 text-3xl font-black leading-tight tracking-[-0.035em] text-white">
                    El circuito IMNOVA OS
                  </h3>
                </div>

                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-cyan-200/25 bg-cyan-300/[0.10] text-center shadow-[0_0_42px_rgba(34,211,238,0.13)]">
                  <div>
                    <p className="text-xl font-black leading-none text-white">
                      OS
                    </p>
                    <p className="mt-1 text-[9px] font-black uppercase tracking-[0.18em] text-cyan-100/70">
                      IMNOVA
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8 grid gap-3">
                {osSystemStages.map((stage, index) => {
                  const relatedIds =
                    activeStageIds[stage.label] as readonly string[]

                  const isActive =
                    relatedIds.includes(
                      activeStep.id
                    )

                  return (
                    <button
                      key={stage.label}
                      type="button"
                      onClick={() =>
                        setActiveStepId(stage.stepId)
                      }
                      className={`
                        group
                        grid
                        grid-cols-[auto_1fr_auto]
                        items-center
                        gap-4
                        rounded-[24px]
                        border
                        p-4
                        text-left
                        transition-all
                        duration-300
                        ${
                          isActive
                            ? "border-cyan-200/35 bg-white/[0.07]"
                            : "border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.045]"
                        }
                      `}
                    >
                      <span
                        className={`flex h-11 w-11 items-center justify-center rounded-2xl text-[11px] font-black ${stage.accent}`}
                      >
                        {index + 1}
                      </span>

                      <span>
                        <span className="block text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                          {stage.label}
                        </span>
                        <span className="mt-1 block text-lg font-black leading-tight text-white">
                          {stage.title}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-zinc-500">
                          {stage.detail}
                        </span>
                      </span>

                      <ArrowRight
                        className={`
                          h-5
                          w-5
                          transition-transform
                          duration-300
                          ${
                            isActive
                              ? "text-cyan-100"
                              : "text-white/25 group-hover:translate-x-0.5 group-hover:text-white/60"
                          }
                        `}
                      />
                    </button>
                  )
                })}
              </div>

              <div className="mt-6 rounded-[24px] border border-amber-200/15 bg-amber-200/[0.055] p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/60">
                  En una frase
                </p>
                <p className="mt-3 text-sm leading-7 text-zinc-300">
                  Comunidad elige intereses, IMNOVA mide demanda, prueba ideas
                  con encuestas y convierte las mejores senales en productos.
                </p>
              </div>
            </div>
          </motion.div>

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
              delay: 0.06,
            }}
            viewport={{
              once: true,
            }}
            className="grid gap-6"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {osFlowSteps.map(step => {
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
                      min-h-[118px]
                      rounded-[24px]
                      border
                      p-4
                      text-left
                      transition-all
                      duration-300
                      ${
                        isActive
                          ? toneClassNames[step.tone]
                          : "border-white/10 bg-white/[0.025] text-white/65 hover:border-white/20 hover:bg-white/[0.05]"
                      }
                    `}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-black uppercase tracking-[0.20em] opacity-55">
                        {step.label}
                      </span>
                      <Icon className="h-5 w-5" />
                    </div>

                    <p className="mt-5 text-base font-black leading-tight text-white">
                      {step.shortTitle}
                    </p>
                  </button>
                )
              })}
            </div>

            <motion.aside
              key={activeStep.id}
              initial={{
                opacity: 0,
                y: 16,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              transition={{
                duration: 0.35,
              }}
              className="rounded-[32px] border border-white/10 bg-black/45 p-6 shadow-[0_30px_130px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:p-7"
            >
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/55">
                    Paso {activeStep.label} - IMNOVA OS
                  </p>

                  <h3 className="mt-3 text-3xl font-black leading-tight tracking-[-0.035em] text-white md:text-4xl">
                    {activeStep.title}
                  </h3>
                </div>

                <div
                  className={`
                    flex
                    h-14
                    w-14
                    shrink-0
                    items-center
                    justify-center
                    rounded-2xl
                    border
                    ${toneClassNames[activeStep.tone]}
                  `}
                >
                  <ActiveIcon className="h-6 w-6" />
                </div>
              </div>

              <div className="mt-7 grid gap-4 md:grid-cols-3">
                {[
                  {
                    label: "Persona",
                    text:
                      activeStep.simple,
                  },
                  {
                    label: "IMNOVA",
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
                    className="rounded-[22px] border border-white/10 bg-white/[0.035] p-5"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                      {item.label}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-zinc-300">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={onJoinCommunity}
                  className="inline-flex items-center justify-center gap-3 rounded-2xl border border-cyan-200/40 bg-cyan-200 px-5 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-black transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
                >
                  Unirme a la comunidad
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
          </motion.div>
        </div>
      </div>
    </section>
  )
}
