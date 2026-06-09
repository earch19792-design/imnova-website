"use client"

import {
  useEffect,
  useMemo,
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
  count: number
}

const fallbackStages: ProductState[] = [
  {
    id: "idea",
    name: "Idea",
    progress: 10,
  },
  {
    id: "desarrollo",
    name: "Desarrollo",
    progress: 35,
  },
  {
    id: "testing",
    name: "Testing",
    progress: 60,
  },
  {
    id: "produccion",
    name: "Produccion",
    progress: 82,
  },
  {
    id: "comercializacion",
    name: "Comercializacion",
    progress: 100,
  },
]

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
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

  if (name.includes("desarrollo")) {
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
      const source =
        productStates.length > 0
          ? productStates
          : fallbackStages

      return source.map(stage => ({
        ...stage,
        count:
          products.filter(
            product =>
              product.state_id ===
              stage.id
          ).length,
      }))
    }, [productStates, products])

  const totalProducts =
    products.length

  const globalProgress =
    useMemo(() => {
      if (stages.length === 0) {
        return 0
      }

      if (totalProducts === 0) {
        return Math.round(
          stages.reduce(
            (sum, stage) =>
              sum + stage.progress,
            0
          ) / stages.length
        )
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

  const activeStage =
    stages.find(
      stage =>
        stage.count > 0 &&
        !isFinalStage(stage.name)
    ) ||
    stages.find(stage => stage.count > 0) ||
    stages[0]

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
            Desarrollo de
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              Innovaciones
            </span>
          </h2>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-8 text-zinc-400 md:text-lg">
            Un flujo simple para ver como avanzan las ideas hasta convertirse
            en productos listos para mercado.
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
              value:
                activeStage?.name ||
                "Sin iniciar",
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

        <div className="relative mt-20">
          <div className="pointer-events-none absolute bottom-8 left-6 top-8 w-px bg-gradient-to-b from-cyan-200/15 via-cyan-200/45 to-amber-200/25 lg:left-0 lg:right-0 lg:top-[54px] lg:h-px lg:w-auto lg:bg-gradient-to-r" />
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
            className="pointer-events-none absolute left-0 right-0 top-[54px] hidden h-px origin-left bg-gradient-to-r from-cyan-300 to-amber-200 shadow-[0_0_30px_rgba(34,211,238,0.35)] lg:block"
          />

          <div
            className="relative grid gap-9 lg:gap-5"
            style={{
              gridTemplateColumns:
                "repeat(auto-fit, minmax(150px, 1fr))",
            }}
          >
            {stages.map(
              (stage, index) => {
                const Icon =
                  getStageIcon(stage.name)

                const isActive =
                  activeStage?.id ===
                  stage.id

                const isComplete =
                  stage.progress <=
                    globalProgress ||
                  isFinalStage(stage.name)

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
                    className="relative z-10 grid grid-cols-[52px_minmax(0,1fr)] items-start gap-4 lg:block lg:text-center"
                  >
                    <div
                      className={`
                        relative
                        flex
                        h-14
                        w-14
                        items-center
                        justify-center
                        rounded-full
                        border
                        backdrop-blur-xl
                        lg:mx-auto
                        ${
                          isActive
                            ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-100 shadow-[0_0_48px_rgba(34,211,238,0.22)]"
                            : isComplete
                              ? "border-emerald-200/35 bg-emerald-300/[0.09] text-emerald-100"
                              : "border-white/10 bg-white/[0.035] text-white/45"
                        }
                      `}
                    >
                      {isComplete ? (
                        <CheckCircle2 className="h-6 w-6" />
                      ) : (
                        <Icon className="h-6 w-6" />
                      )}
                    </div>

                    <div className="min-w-0 lg:mt-6">
                      <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        Etapa{" "}
                        {String(index + 1).padStart(
                          2,
                          "0"
                        )}
                      </div>

                      <h3 className="mt-3 truncate text-lg font-black uppercase tracking-[0.04em] text-white">
                        {stage.name}
                      </h3>

                      <div className="mt-4 flex items-center gap-3 lg:justify-center">
                        <span className="text-2xl font-black tracking-[-0.04em] text-cyan-100">
                          {stage.progress}%
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                          {stage.count} prod.
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )
              }
            )}
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-5xl">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
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

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
            <span>Idea</span>
            <span>Desarrollo</span>
            <span>Validacion</span>
            <span>Mercado</span>
          </div>
        </div>
      </div>
    </section>
  )
}
