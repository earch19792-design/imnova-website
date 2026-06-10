"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import { motion } from "framer-motion"

import {
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

function getStageDescription(stageName: string) {
  const name =
    normalizeText(stageName)

  if (name.includes("idea")) {
    return "Aquí nacen oportunidades detectadas por IMNOVA antes de convertirse en un producto visible."
  }

  if (name.includes("valid")) {
    return "La comunidad ayuda a validar si la idea resuelve una necesidad real y merece avanzar."
  }

  if (name.includes("prioriz")) {
    return "Las ideas con mayor señal se ordenan por potencial, urgencia y viabilidad."
  }

  if (name.includes("testing")) {
    return "El producto se prueba, se ajusta y se prepara para demostrar valor en condiciones reales."
  }

  if (name.includes("produccion")) {
    return "La propuesta pasa a una etapa tangible: formulación, empaque, mockups y preparación operativa."
  }

  if (name.includes("comercial")) {
    return "El producto está listo para salir al mercado y conectar con canales de venta."
  }

  if (name.includes("disponible")) {
    return "El producto ya puede comprarse o presentarse oficialmente como parte del ecosistema."
  }

  return "Etapa activa del sistema IMNOVA para ordenar productos, decisiones y próximos movimientos."
}

export function InnovationTracker() {
  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  const [
    productStates,
    setProductStates,
  ] = useState<ProductState[]>([])

  const [
    selectedStageId,
    setSelectedStageId,
  ] = useState<string | null>(null)

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
        : `${activeStages.length} etapas activas`

  const selectedStage =
    useMemo(
      () =>
        stages.find(
          stage =>
            stage.id === selectedStageId
        ) ||
        activeStages[0] ||
        stages[0],
      [
        activeStages,
        selectedStageId,
        stages,
      ]
    )

  useEffect(() => {
    if (stages.length === 0) {
      return
    }

    const selectedExists =
      stages.some(
        stage =>
          stage.id === selectedStageId
      )

    if (!selectedExists) {
      setSelectedStageId(
        (
          activeStages[0] ||
          stages[0]
        ).id
      )
    }
  }, [
    activeStages,
    selectedStageId,
    stages,
  ])

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
            Avance de productos
          </div>

          <h2 className="mt-9 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
            Ruta de productos
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              IMNOVA
            </span>
          </h2>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
            Una vista simple para entender en qué etapa está cada producto:
            desde una idea validada hasta estar disponible para comprar.
          </p>
        </motion.div>

        <div className="mx-auto mt-12 flex max-w-4xl flex-wrap items-center justify-center gap-3">
          {[
            {
              label: "Avance",
              value: `${globalProgress}%`,
            },
            {
              label: "Productos",
              value: String(totalProducts),
            },
            {
              label: "Estado actual",
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
              No hay productos activos en la ruta.
            </p>
          </motion.div>
        )}

        {totalProducts > 0 && selectedStage && (
          <motion.div
            initial={{
              opacity: 0,
              y: 24,
            }}
            whileInView={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration: 0.75,
            }}
            viewport={{ once: true }}
            className="mt-12 overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.035] backdrop-blur-2xl"
          >
            <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
              <div className="border-b border-white/10 p-5 md:p-7 lg:border-b-0 lg:border-r">
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-100/70">
                  Etapas del producto
                </p>

                <h3 className="mt-3 text-2xl font-black leading-tight text-white md:text-4xl">
                  De idea a compra, sin complicarlo.
                </h3>

                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  Selecciona una etapa para ver qué significa y qué productos
                  están avanzando ahí.
                </p>

                <div className="mt-6 grid gap-2">
                  {stages.map(
                    (stage, index) => {
                      const isSelected =
                        selectedStage.id ===
                        stage.id

                      const isActive =
                        stage.count > 0

                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() =>
                            setSelectedStageId(
                              stage.id
                            )
                          }
                          className={`group flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                            isSelected
                              ? "border-cyan-200/40 bg-cyan-300/[0.12] text-white shadow-[0_0_42px_rgba(34,211,238,0.12)]"
                              : "border-white/10 bg-black/25 text-zinc-400 hover:border-white/20 hover:text-white"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                              Paso{" "}
                              {String(index + 1).padStart(
                                2,
                                "0"
                              )}
                            </span>
                            <span className="mt-1 block truncate text-xs font-black uppercase tracking-[0.12em]">
                              {getPublicStageLabel(
                                stage.name
                              )}
                            </span>
                          </span>

                          <span
                            className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                              isActive
                                ? "border-cyan-200/30 bg-cyan-300/[0.10] text-cyan-100"
                                : "border-white/10 bg-white/[0.025] text-zinc-500"
                            }`}
                          >
                            {stage.count}
                          </span>
                        </button>
                      )
                    }
                  )}
                </div>
              </div>

              <div className="relative overflow-hidden p-6 md:p-9">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_15%,rgba(34,211,238,0.16),transparent_36%)]" />

                <div className="relative z-10">
                  {(() => {
                    const Icon =
                      getStageIcon(
                        selectedStage.name
                      )

                    return (
                      <div className="flex flex-wrap items-start justify-between gap-5">
                        <div className="flex items-center gap-4">
                          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/25 bg-cyan-300/[0.10] text-cyan-100 shadow-[0_0_55px_rgba(34,211,238,0.14)]">
                            <Icon className="h-7 w-7" />
                          </div>

                          <div>
                            <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/60">
                              Etapa seleccionada
                            </p>
                            <h4 className="mt-2 text-3xl font-black leading-tight text-white md:text-5xl">
                              {getPublicStageLabel(
                                selectedStage.name
                              )}
                            </h4>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-right">
                          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                            Avance
                          </p>
                          <p className="mt-1 text-3xl font-black text-cyan-100">
                            {selectedStage.progress}%
                          </p>
                        </div>
                      </div>
                    )
                  })()}

                  <p className="mt-8 max-w-2xl text-base leading-8 text-zinc-300">
                    {getStageDescription(
                      selectedStage.name
                    )}
                  </p>

                  <div className="mt-8">
                    <div className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                      <span>Productos en esta etapa</span>
                      <span>
                        {selectedStage.count}{" "}
                        {selectedStage.count === 1
                          ? "producto"
                          : "productos"}
                      </span>
                    </div>

                    {selectedStage.products.length > 0 ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {selectedStage.products
                          .slice(
                            0,
                            4
                          )
                          .map(product => (
                            <div
                              key={product.id}
                              title={product.name}
                              className="rounded-2xl border border-white/10 bg-black/35 px-4 py-4"
                            >
                              <p className="truncate text-sm font-black text-white">
                                {product.name}
                              </p>
                              <p className="mt-2 truncate text-xs text-zinc-500">
                                {product.category ||
                                  "Producto IMNOVA"}
                              </p>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-5 py-6 text-sm text-zinc-500">
                        Aún no hay productos en esta etapa.
                      </div>
                    )}

                    {selectedStage.products.length > 4 && (
                      <p className="mt-4 text-xs uppercase tracking-[0.16em] text-cyan-100/70">
                        +{selectedStage.products.length - 4} productos más en
                        esta etapa
                      </p>
                    )}
                  </div>

                  <div className="mt-8 h-2 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      key={selectedStage.id}
                      initial={{
                        width: 0,
                      }}
                      animate={{
                        width: `${selectedStage.progress}%`,
                      }}
                      transition={{
                        duration: 0.65,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-white to-amber-200"
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  )
}
