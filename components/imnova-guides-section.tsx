"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import { motion } from "framer-motion"

import {
  ArrowUpRight,
  Brain,
  Search,
  Sparkles,
  type LucideIcon,
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
  description?: string | null
  image?: string | null
  image_url?: string | null
}

type ProductState = {
  id: string
  name: string
  progress: number
}

type GuideCard = {
  id: string
  title: string
  description: string
  cta: string
  stage: "all" | "ideas" | "development" | "market"
  status?: string
  image?: string | null
  icon: LucideIcon
}

type ImnovaGuidesSectionProps = {
  onJoinFamily?: () => void
}

const pageSize =
  6

function normalizeText(
  value: string
) {

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

}

function getGuideStage(
  status: string
): GuideCard["stage"] {

  const normalized =
    normalizeText(status)

  if (
    normalized.includes("disponible") ||
    normalized.includes("comercial")
  ) {
    return "market"
  }

  if (
    normalized.includes("desarrollo") ||
    normalized.includes("testing") ||
    normalized.includes("produccion")
  ) {
    return "development"
  }

  return "ideas"

}

export function ImnovaGuidesSection({
  onJoinFamily: _onJoinFamily,
}: ImnovaGuidesSectionProps) {

  const [
    products,
    setProducts,
  ] = useState<Product[]>([])

  const [
    states,
    setStates,
  ] = useState<ProductState[]>([])

  const [
    activeStage,
    setActiveStage,
  ] = useState<GuideCard["stage"]>("all")

  const [
    query,
    setQuery,
  ] = useState("")

  const [
    visibleCount,
    setVisibleCount,
  ] = useState(pageSize)

  useEffect(
    () => {

      let mounted =
        true

      async function loadGuides() {

        const [
          productRows,
          stateRows,
        ] = await Promise.all([
          getProducts(),
          getProductStates(),
        ])

        if (!mounted) {
          return
        }

        setProducts(
          productRows as Product[]
        )
        setStates(
          stateRows as ProductState[]
        )

      }

      loadGuides()

      return () => {
        mounted = false
      }

    },
    []
  )

  const stateMap =
    useMemo(
      () =>
        new Map(
          states.map(
            state => [
              state.id,
              state,
            ]
          )
        ),
      [
        states,
      ]
    )

  const productGuides =
    useMemo<GuideCard[]>(
      () =>
        products
          .map(
            product => {

              const state =
                product.state_id
                  ? stateMap.get(
                      product.state_id
                    )
                  : null

              const status =
                state?.name ||
                "Idea"

              const stage =
                getGuideStage(status)

              return {
                id:
                  product.id,
                title:
                  product.name,
                description:
                  product.description ||
                  `Guía rápida para entender cómo usar ${product.name} y aprovecharlo dentro de una rutina IMNOVA.`,
                cta:
                  "Ver producto",
                stage,
                status,
                image:
                  product.image_url ||
                  product.image ||
                  null,
                icon:
                  Sparkles,
              }

            }
          )
          .filter(
            guide =>
              normalizeText(
                guide.status || ""
              ).includes("disponible")
          ),
      [
        products,
        stateMap,
      ]
    )

  const allGuides =
    useMemo(
      () => [
        ...productGuides,
      ],
      [
        productGuides,
      ]
    )

  const stageOptions =
    useMemo(
      () => [
        {
          id: "all" as const,
          label: "Todos",
          count:
            allGuides.length,
        },
        {
          id: "market" as const,
          label: "Disponibles",
          count:
            allGuides.filter(
              guide =>
                guide.stage === "market"
            ).length,
        },
      ],
      [
        allGuides,
      ]
    )

  const filteredGuides =
    useMemo(
      () => {

        const normalizedQuery =
          normalizeText(query)

        return allGuides.filter(
          guide => {

            const matchesStage =
              activeStage === "all" ||
              guide.stage === activeStage

            const searchable =
              normalizeText(
                [
                  guide.title,
                  guide.description,
                  guide.status || "",
                ].join(" ")
              )

            return (
              matchesStage &&
              searchable.includes(
                normalizedQuery
              )
            )

          }
        )

      },
      [
        activeStage,
        allGuides,
        query,
      ]
    )

  const visibleGuides =
    filteredGuides.slice(
      0,
      visibleCount
    )

  const hasMore =
    filteredGuides.length >
    visibleGuides.length

  const selectStage =
    (stage: GuideCard["stage"]) => {

      setActiveStage(stage)
      setVisibleCount(pageSize)

    }

  return (
    <section
      id="imnova-guides"
      className="relative isolate overflow-hidden bg-black py-32 md:py-40"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.11),transparent_40%),radial-gradient(circle_at_80%_60%,rgba(251,191,36,0.08),transparent_34%)]" />
      <div className="absolute inset-0 opacity-[0.022] bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:92px_92px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <motion.div
          initial={{
            opacity: 0,
            y: 30,
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
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Brain className="h-4 w-4" />
            Centro de guías
          </div>

          <h2 className="mt-9 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
            Guías IMNOVA
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            Explora únicamente productos disponibles y listos para uso. La
            sección carga solo una parte visible para mantenerse rápida aunque
            el ecosistema crezca.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex flex-wrap gap-3">
            {stageOptions.map(
              option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    selectStage(option.id)
                  }
                  className={`
                    rounded-2xl
                    border
                    px-4
                    py-3
                    text-xs
                    font-black
                    uppercase
                    tracking-[0.16em]
                    transition-all
                    duration-300
                    ${
                      activeStage === option.id
                        ? "border-cyan-200/40 bg-cyan-300/[0.14] text-cyan-50"
                        : "border-white/10 bg-white/[0.035] text-white/55 hover:border-cyan-200/25 hover:text-cyan-100"
                    }
                  `}
                >
                  {option.label}
                  <span className="ml-2 text-cyan-100/65">
                    {option.count}
                  </span>
                </button>
              )
            )}
          </div>

          <label className="relative block lg:min-w-[360px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-100/45" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setVisibleCount(pageSize)
              }}
              placeholder="Buscar guía o producto"
              className="w-full rounded-2xl border border-white/10 bg-black/45 py-4 pl-11 pr-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-200/35"
            />
          </label>
        </div>

        <div className="mt-8 flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          <span>
            Mostrando {visibleGuides.length} de {filteredGuides.length}
          </span>
          <span>
            Render escalable
          </span>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleGuides.map(
            (guide, index) => {
              const Icon =
                guide.icon

              return (
                <motion.article
                  key={guide.id}
                  initial={{
                    opacity: 0,
                    y: 34,
                  }}
                  whileInView={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.72,
                    delay:
                      index * 0.04,
                  }}
                  viewport={{ once: true }}
                  className="group relative flex min-h-[330px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-cyan-200/25 hover:bg-white/[0.055]"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_42%)] opacity-0 transition duration-300 group-hover:opacity-100" />

                  <div className="relative z-10 flex flex-1 flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-cyan-200/15 bg-cyan-300/[0.08]">
                        {guide.image ? (
                          <img
                            src={guide.image}
                            alt={guide.title}
                            className="h-full w-full object-contain p-1.5"
                          />
                        ) : (
                          <Icon className="h-6 w-6 text-cyan-100" />
                        )}
                      </div>

                      {guide.status && (
                        <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-white/45">
                          {guide.status}
                        </span>
                      )}
                    </div>

                    <h3 className="mt-8 text-2xl font-black leading-tight tracking-[-0.03em] text-white">
                      {guide.title}
                    </h3>

                    <p className="mt-5 flex-1 text-sm leading-7 text-zinc-400">
                      {guide.description}
                    </p>

                    <span className="mt-8 inline-flex items-center gap-2 self-start rounded-3xl border border-white/10 bg-white/[0.035] px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                      {guide.cta}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </motion.article>
              )
            }
          )}
        </div>

        {filteredGuides.length === 0 && (
          <div className="mt-10 rounded-[28px] border border-white/10 bg-white/[0.035] p-8 text-center text-sm leading-7 text-zinc-400">
            No hay guías para esta búsqueda.
          </div>
        )}

        {hasMore && (
          <div className="mt-10 flex justify-center">
            <button
              type="button"
              onClick={() =>
                setVisibleCount(
                  count =>
                    count + pageSize
                )
              }
              className="rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-cyan-100 transition-colors hover:border-cyan-200/35 hover:bg-cyan-300/[0.14]"
            >
              Ver más guías
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
