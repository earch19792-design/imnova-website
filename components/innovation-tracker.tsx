"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { motion } from "framer-motion"

import {
  CheckCircle2,
  CircleDot,
  Factory,
  FlaskConical,
  Lightbulb,
  PackageCheck,
  Radar,
  TestTube2,
} from "lucide-react"

import {
  getProducts,
  getProductStates,
} from "@/lib/products-service"

type Product = {
  id: string
  state_id: string | null
  name: string
  category?: string | null
}

type ProductState = {
  id: string
  name: string
  progress: number
}

type Stage = ProductState & {
  products: Product[]
  count: number
}

const fallbackStages: ProductState[] = [
  {
    id: "idea",
    name: "Idea",
    progress: 10,
  },
  {
    id: "validacion",
    name: "Validación",
    progress: 25,
  },
  {
    id: "priorizado",
    name: "Priorizado",
    progress: 40,
  },
  {
    id: "testing",
    name: "Testing",
    progress: 60,
  },
  {
    id: "produccion",
    name: "Producción",
    progress: 75,
  },
  {
    id: "comercializacion",
    name: "Comercialización",
    progress: 90,
  },
  {
    id: "disponible",
    name: "Disponible",
    progress: 100,
  },
]

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function getPublicStageLabel(stageName: string) {
  const name =
    normalizeText(stageName)

  if (name.includes("comercial")) {
    return "Listo para ser comercializado"
  }

  return stageName
}

function getOfficialStageKey(value: string) {
  const name =
    normalizeText(value)

  if (name.includes("dispon")) {
    return "disponible"
  }

  if (name.includes("comercial")) {
    return "comercializacion"
  }

  if (name.includes("produccion")) {
    return "produccion"
  }

  if (name.includes("testing")) {
    return "testing"
  }

  if (name.includes("prioriz")) {
    return "priorizado"
  }

  if (name.includes("valid")) {
    return "validacion"
  }

  if (
    name.includes("idea") ||
    name.includes("concepto")
  ) {
    return "idea"
  }

  return name
}

function getStageIcon(stageName: string) {
  const name =
    normalizeText(stageName)

  if (
    name.includes("comercial") ||
    name.includes("disponible")
  ) {
    return PackageCheck
  }

  if (name.includes("produccion")) {
    return Factory
  }

  if (name.includes("testing")) {
    return TestTube2
  }

  if (
    name.includes("priorizado") ||
    name.includes("desarrollo")
  ) {
    return FlaskConical
  }

  if (
    name.includes("idea") ||
    name.includes("validacion") ||
    name.includes("concepto")
  ) {
    return Lightbulb
  }

  return CircleDot
}

function isFinalStage(stageName: string) {
  const name =
    normalizeText(stageName)

  return (
    name.includes("comercial") ||
    name.includes("disponible")
  )
}

export function InnovationTracker() {
  const stageRailRef =
    useRef<HTMLDivElement>(null)

  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  const [
    productStates,
    setProductStates,
  ] = useState<ProductState[]>([])

  useEffect(() => {
    async function loadPipeline() {
      const [
        productRows,
        stateRows,
      ] = await Promise.all([
        getProducts(),
        getProductStates(),
      ])

      setProducts(productRows as Product[])
      setProductStates(
        stateRows as ProductState[]
      )
    }

    loadPipeline()
  }, [])

  const stages =
    useMemo<Stage[]>(() => {
      const statesByOfficialKey =
        new Map(
          productStates.map(state => [
            getOfficialStageKey(state.name),
            state,
          ])
        )

      return fallbackStages.map(
        fallbackStage => {
          const officialKey =
            getOfficialStageKey(
              fallbackStage.name
            )

          const state =
            statesByOfficialKey.get(
              officialKey
            ) || fallbackStage

          const stageProducts =
            products.filter(
              product =>
                product.state_id ===
                state.id
            )

          return {
            id: state.id,
            name: fallbackStage.name,
            progress:
              state.progress ??
              fallbackStage.progress,
            products: stageProducts,
            count: stageProducts.length,
          }
        }
      )
    }, [productStates, products])

  const totalProducts =
    useMemo(
      () =>
        stages.reduce(
          (sum, stage) =>
            sum + stage.count,
          0
        ),
      [stages]
    )

  const globalProgress =
    useMemo(() => {
      if (
        stages.length === 0 ||
        totalProducts === 0
      ) {
        return 0
      }

      const weightedProgress =
        stages.reduce(
          (sum, stage) =>
            sum +
            stage.progress *
              stage.count,
          0
        )

      return Math.round(
        weightedProgress /
          Math.max(totalProducts, 1)
      )
    }, [stages, totalProducts])

  const activeStages =
    useMemo(
      () =>
        stages.filter(
          stage => stage.count > 0
        ),
      [stages]
    )

  const activeStageLabel =
    activeStages.length === 0
      ? "Sin iniciar"
      : activeStages.length === 1
        ? getPublicStageLabel(activeStages[0].name)
        : `${activeStages.length} etapas`

  const scrollStageRail =
    (index: number) => {

      const rail =
        stageRailRef.current

      if (!rail) {
        return
      }

      const target =
        rail.children[index] as HTMLElement | undefined

      target?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      })

    }

  return (
    <section
      id="pipeline"
      className="relative isolate overflow-hidden bg-black px-6 py-32 md:py-40"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_42%),linear-gradient(180deg,rgba(0,0,0,0.1),rgba(0,0,0,0.96))]" />
      <div className="absolute inset-0 opacity-[0.025] bg-[linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] bg-[size:96px_96px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl">
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
            duration: 0.8,
          }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl text-center"
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Radar className="h-4 w-4" />
            IMNOVA Labs
          </div>

          <h2 className="mt-9 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
            Pipeline Oficial
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              IMNOVA
            </span>
          </h2>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
            Del concepto al mercado: cada producto avanza por etapas reales
            conectadas a Supabase.
          </p>
        </motion.div>

        <div className="mx-auto mt-12 flex max-w-4xl flex-wrap items-center justify-center gap-3">
          {[
            {
              label: "Pipeline",
              value: `${globalProgress}%`,
            },
            {
              label: "Productos",
              value: String(totalProducts),
            },
            {
              label: "Fase activa",
              value: activeStageLabel,
            },
          ].map(item => (
            <div
              key={item.label}
              className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.035] px-5 py-3 backdrop-blur-xl"
            >
              <span className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                {item.label}
              </span>
              <span className="text-sm font-black uppercase tracking-[0.12em] text-cyan-100">
                {item.value}
              </span>
            </div>
          ))}
        </div>

        {totalProducts === 0 && (
          <motion.div
            initial={{
              opacity: 0,
              y: 18,
            }}
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.65,
            }}
            viewport={{ once: true }}
            className="mx-auto mt-12 max-w-2xl rounded-[28px] border border-white/10 bg-white/[0.035] px-6 py-8 text-center backdrop-blur-xl"
          >
            <CircleDot className="mx-auto h-7 w-7 text-cyan-100/70" />
            <p className="mt-4 text-sm uppercase tracking-[0.2em] text-zinc-400">
              No hay productos activos en el pipeline.
            </p>
          </motion.div>
        )}

        <div className="mx-auto mt-12 flex justify-center md:hidden">
          <div className="rounded-full border border-cyan-200/15 bg-cyan-300/[0.08] px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/75">
            Desliza para ver todas las etapas
          </div>
        </div>

        <div className="mt-8 overflow-x-auto px-2 pb-12 [scrollbar-width:thin] [scrollbar-color:rgba(103,232,249,0.5)_rgba(255,255,255,0.08)] md:mt-16">
          <div className="min-w-[1080px] pr-24 xl:min-w-0 xl:pr-0">
            <div className="relative">
              <div className="pointer-events-none absolute left-0 right-0 top-7 h-px bg-gradient-to-r from-cyan-200/15 via-cyan-200/45 to-amber-200/25" />
              <motion.div
                initial={{
                  scaleX: 0,
                }}
                whileInView={{
                  scaleX:
                    globalProgress / 100,
                }}
                transition={{
                  duration: 1.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                viewport={{ once: true }}
                className="pointer-events-none absolute left-0 right-0 top-7 h-px origin-left bg-gradient-to-r from-cyan-300 to-amber-200 shadow-[0_0_30px_rgba(34,211,238,0.35)]"
              />

              <div className="relative grid grid-cols-7 gap-3 lg:gap-4">
                {stages.map(
                  (stage, index) => {
                    const Icon =
                      getStageIcon(stage.name)

                    const isEmpty =
                      stage.count === 0

                    const isActive =
                      stage.count > 0

                    const isComplete =
                      stage.count > 0 &&
                      (stage.progress <=
                        globalProgress ||
                        isFinalStage(stage.name))

                    const productPreview =
                      stage.products.slice(0, 1)

                    const remainingProducts =
                      Math.max(
                        stage.products.length -
                          productPreview.length,
                        0
                      )

                    return (
                      <motion.div
                        key={stage.id}
                        initial={{
                          opacity: 0,
                          y: 24,
                        }}
                        whileInView={{
                          opacity: 1,
                          y: 0,
                        }}
                        transition={{
                          duration: 0.65,
                          delay:
                            index * 0.06,
                        }}
                        viewport={{ once: true }}
                        className="relative z-10 min-w-0 text-center"
                      >
                        <div
                          className={`
                            relative
                            mx-auto
                            flex
                            h-12
                            w-12
                            items-center
                            justify-center
                            rounded-full
                            border
                            backdrop-blur-xl
                            ${
                              isComplete
                                ? "border-emerald-200/35 bg-emerald-300/[0.09] text-emerald-100"
                                : isActive
                                  ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-100 shadow-[0_0_48px_rgba(34,211,238,0.22)]"
                                  : "border-white/10 bg-white/[0.035] text-white/45"
                            }
                          `}
                        >
                          {isComplete ? (
                            <CheckCircle2 className="h-5 w-5" />
                          ) : (
                            <Icon className="h-5 w-5" />
                          )}
                        </div>

                        <div className="mt-5 min-w-0">
                          <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                            Etapa{" "}
                            {String(index + 1).padStart(
                              2,
                              "0"
                            )}
                          </div>

                          <h3 className="mt-2 min-h-[2rem] break-words text-[12px] font-black uppercase leading-tight tracking-normal text-white lg:text-[13px]">
                            {getPublicStageLabel(stage.name)}
                          </h3>

                          <div className="mt-3 flex flex-col items-center justify-center gap-2 xl:flex-row">
                            <span className="text-xl font-black tracking-[-0.04em] text-cyan-100 lg:text-2xl">
                              {stage.progress}%
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[9px] uppercase tracking-[0.10em] text-zinc-400">
                              {stage.count} prod.
                            </span>
                          </div>

                          <div className="mx-auto mt-4 max-w-[150px] space-y-2">
                            {productPreview.map(product => (
                              <div
                                key={product.id}
                                title={product.name}
                                className="truncate rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[9px] uppercase tracking-[0.10em] text-zinc-300"
                              >
                                {product.name}
                              </div>
                            ))}

                            {remainingProducts > 0 && (
                              <div className="text-[9px] uppercase tracking-[0.14em] text-cyan-100/70">
                                +{remainingProducts} más
                              </div>
                            )}

                            {isEmpty && (
                              <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-600">
                                Sin productos
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )
                  }
                )}
              </div>
            </div>

            <div className="mt-16">
              <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={{
                    width: 0,
                  }}
                  whileInView={{
                    width: `${globalProgress}%`,
                  }}
                  transition={{
                    duration: 1,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  viewport={{ once: true }}
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-white to-amber-200"
                />
              </div>

              <div className="mt-5 overflow-x-auto rounded-b-[28px] pb-6 [scrollbar-width:thin] [scrollbar-color:rgba(103,232,249,0.5)_rgba(255,255,255,0.08)]">
                <div
                  ref={stageRailRef}
                  className="flex min-w-max items-center gap-3 px-2 pr-[48vw] md:pr-[34vw] xl:pr-10"
                >
                  {stages.map((stage, index) => {
                    const isActive =
                      stage.count > 0

                    const isReached =
                      stage.progress <=
                        globalProgress ||
                      isActive

                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() =>
                          scrollStageRail(index)
                        }
                        className={`
                          group
                          inline-flex
                          min-w-[230px]
                          items-center
                          justify-between
                          gap-3
                          rounded-full
                          border
                          px-4
                          py-3
                          text-left
                          transition-all
                          duration-300
                          ${
                            isReached
                              ? "border-cyan-200/20 bg-cyan-300/[0.08] text-cyan-100"
                              : "border-white/10 bg-white/[0.025] text-zinc-500 hover:border-white/20"
                          }
                        `}
                      >
                        <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.16em]">
                          {getPublicStageLabel(stage.name)}
                        </span>

                        <span className="shrink-0 text-[10px] font-black text-white/70">
                          {stage.progress}%
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
