"use client"

import {
  motion,
  useInView,
} from "framer-motion"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  Boxes,
  Layers3,
  Lightbulb,
  Radar,
  Rocket,
  Store,
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
  featuredLaunch?: boolean | null
}

type ProductState = {
  id: string
  name: string
  progress: number
}

type LiveProduct = Product & {
  status: string
  progress: number
}

const productViews = [
  {
    key: "ideas",
    label: "Ideas en análisis",
    headline: "Ideas que vienen construyéndose.",
    detail:
      "Explora los conceptos que IMNOVA está analizando antes de convertirlos en productos reales dentro del ecosistema.",
    icon: Lightbulb,
    accent: "text-amber-200",
  },
  {
    key: "development",
    label: "Productos en desarrollo",
    headline: "Productos que están tomando forma.",
    detail:
      "Mira los productos que avanzan por desarrollo, testing o producción antes de salir oficialmente al mercado.",
    icon: Layers3,
    accent: "text-violet-200",
  },
  {
    key: "market",
    label: "Ya comercializándose",
    headline: "Productos disponibles en el mercado.",
    detail:
      "Consulta los productos que ya se están comercializando y conectando con mercados, tiendas y plataformas.",
    icon: Store,
    accent: "text-amber-200",
  },
]

function normalizeText(
  value: string
) {

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

}

export function TechnologySection() {

  const ref =
    useRef(null)

  const isInView =
    useInView(
      ref,
      {
        once: true,
        margin: "-100px",
      }
    )

  const [
    products,
    setProducts,
  ] = useState<LiveProduct[]>([])

  const [
    activeModule,
    setActiveModule,
  ] = useState(productViews[2])

  const [
    activeProductIndex,
    setActiveProductIndex,
  ] = useState(0)

  useEffect(
    () => {

      let isMounted =
        true

      async function loadEcosystem() {

        const [
          productRows,
          stateRows,
        ] = await Promise.all([
          getProducts(),
          getProductStates(),
        ])

        const stateMap =
          new Map(
            (stateRows as ProductState[]).map(
              state => [
                state.id,
                state,
              ]
            )
          )

        const liveProducts =
          (productRows as Product[]).map(
            product => {

              const state =
                product.state_id
                  ? stateMap.get(
                      product.state_id
                    )
                  : null

              return {
                ...product,
                status:
                  state?.name ||
                  "Próximamente",
                progress:
                  state?.progress ||
                  0,
              }

            }
          )

        if (isMounted) {
          setProducts(liveProducts)
        }

      }

      loadEcosystem()

      return () => {
        isMounted = false
      }

    },
    []
  )

  const commercialProducts =
    useMemo(
      () =>
        products.filter(
          product => {

            const status =
              normalizeText(
                product.status
              )

            return (
              status.includes("comercial") ||
              status.includes("disponible")
            )

          }
        ),
      [
        products,
      ]
    )

  const ideaProducts =
    useMemo(
      () =>
        products.filter(
          product => {

            const status =
              normalizeText(
                product.status
              )

            return (
              status.includes("idea") ||
              status.includes("validacion") ||
              status.includes("priorizado") ||
              status.includes("concepto")
            )

          }
        ),
      [
        products,
      ]
    )

  const developmentProducts =
    useMemo(
      () =>
        products.filter(
          product => {

            const status =
              normalizeText(
                product.status
              )

            return (
              status.includes("desarrollo") ||
              status.includes("testing") ||
              status.includes("produccion")
            )

          }
        ),
      [
        products,
      ]
    )

  const selectedProducts =
    useMemo(
      () => {

        if (activeModule.key === "ideas") {
          return ideaProducts
        }

        if (activeModule.key === "development") {
          return developmentProducts
        }

        return commercialProducts

      },
      [
        activeModule.key,
        commercialProducts,
        developmentProducts,
        ideaProducts,
      ]
    )

  const productionProducts =
    useMemo(
      () => {

        return [
          ...selectedProducts,
        ].sort(
          (a, b) =>
            b.progress - a.progress
        )

      },
      [
        selectedProducts,
      ]
    )

  useEffect(
    () => {

      if (productionProducts.length <= 1) {
        setActiveProductIndex(0)
        return
      }

      const interval =
        window.setInterval(
          () => {
            setActiveProductIndex(
              index =>
                (index + 1) %
                productionProducts.length
            )
          },
          3000
        )

      return () =>
        window.clearInterval(interval)

    },
    [
      productionProducts.length,
    ]
  )

  const activeProductionProduct =
    productionProducts[
      activeProductIndex %
        Math.max(
          productionProducts.length,
          1
        )
    ]

  const nextLaunch =
    useMemo(
      () =>
        products
          .filter(
            product =>
              !commercialProducts.some(
                commercial =>
                  commercial.id === product.id
              )
          )
          .sort(
            (a, b) =>
              b.progress - a.progress
          )[0],
      [
        products,
        commercialProducts,
      ]
    )

  const metrics = [
    {
      label: "Ideas",
      value:
        ideaProducts.length,
      icon: Lightbulb,
    },
    {
      label: "Desarrollo",
      value:
        developmentProducts.length,
      icon: Boxes,
    },
    {
      label: "Comercialización",
      value:
        commercialProducts.length,
      icon: Rocket,
    },
  ]

  return (
    <section
      id="technology"
      ref={ref}
      className="
        relative
        isolate
        overflow-hidden
        bg-black
        py-32
        md:py-44
      "
    >

      <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.05)_1px,transparent_1px)] bg-[size:92px_92px] opacity-25" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(34,211,238,0.13),transparent_46%),linear-gradient(180deg,rgba(0,0,0,0.15),rgba(0,0,0,0.9))]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        <motion.div
          initial={{
            opacity: 0,
            y: 28,
          }}
          animate={
            isInView
              ? {
                  opacity: 1,
                  y: 0,
                }
              : {}
          }
          transition={{
            duration: 0.8,
          }}
          className="mx-auto max-w-5xl text-center"
        >

          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Radar className="h-4 w-4" />
            IMNOVA Core System
          </div>

          <h2 className="mt-9 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
            El ecosistema que convierte ideas en{" "}
            <span className="bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              productos reales
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            IMNOVA construye marcas y experiencias premium enfocadas en
            bienestar, innovación funcional y desarrollo de productos para
            consumidores que buscan soluciones más inteligentes, eficientes y
            alineadas con el futuro.
          </p>

        </motion.div>

        <div className="mt-14 grid gap-6 lg:grid-cols-[0.82fr_1.38fr]">

          <motion.div
            initial={{
              opacity: 0,
              x: -28,
            }}
            animate={
              isInView
                ? {
                    opacity: 1,
                    x: 0,
                  }
                : {}
            }
            transition={{
              duration: 0.75,
              delay: 0.1,
            }}
            className="rounded-[32px] border border-white/10 bg-white/[0.035] p-5 backdrop-blur-2xl lg:sticky lg:top-28 lg:self-start"
          >

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {metrics.map(
                metric => (
                  <div
                    key={metric.label}
                    className="rounded-[24px] border border-white/10 bg-black/30 p-5"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                        <metric.icon className="h-5 w-5 text-cyan-200" />
                      </div>

                      <div className="text-right text-3xl font-black tracking-[-0.04em] text-cyan-200">
                        {metric.value}
                      </div>
                    </div>

                    <p className="mt-4 text-xs uppercase tracking-[0.22em] text-zinc-500">
                      {metric.label}
                    </p>
                  </div>
                )
              )}
            </div>

          </motion.div>

          <motion.div
            initial={{
              opacity: 0,
              x: 28,
            }}
            animate={
              isInView
                ? {
                    opacity: 1,
                    x: 0,
                  }
                : {}
            }
            transition={{
              duration: 0.75,
              delay: 0.2,
            }}
            className="relative overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.035] p-5 backdrop-blur-2xl"
          >

            <div className="absolute inset-0 bg-[radial-gradient(circle_at_55%_45%,rgba(34,211,238,0.12),transparent_42%)]" />

            <div className="relative grid gap-6 lg:grid-cols-[1fr_0.88fr]">

              <div className="relative min-h-[360px] overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-6">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:54px_54px] opacity-35" />

                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    animate={{
                      rotate: 360,
                    }}
                    transition={{
                      duration: 46,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="absolute h-60 w-60 rounded-full border border-cyan-300/20"
                  />

                  <motion.div
                    animate={{
                      rotate: -360,
                    }}
                    transition={{
                      duration: 34,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="absolute h-44 w-44 rounded-full border border-dashed border-amber-200/20"
                  />

                  <div className="relative flex h-36 w-36 items-center justify-center overflow-hidden rounded-[32px] border border-cyan-300/25 bg-cyan-300/10 shadow-[0_0_90px_rgba(34,211,238,0.18)]">
                    {activeProductionProduct?.image_url ||
                    activeProductionProduct?.image ? (
                      <motion.img
                        key={activeProductionProduct.id}
                        src={activeProductionProduct.image_url || activeProductionProduct.image || ""}
                        alt={activeProductionProduct.name}
                        initial={{
                          opacity: 0,
                          scale: 0.92,
                        }}
                        animate={{
                          opacity: 1,
                          scale: 1,
                        }}
                        transition={{
                          duration: 0.55,
                        }}
                        className="h-full w-full object-contain p-3"
                      />
                    ) : (
                      <Layers3 className="h-11 w-11 text-cyan-100" />
                    )}
                  </div>
                </div>

                <div className="relative z-10 flex h-full flex-col justify-between gap-6">
                  <div className="max-w-md rounded-[24px] border border-white/10 bg-black/45 p-4 backdrop-blur-xl">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/60">
                      Selecciona qué quieres ver
                    </p>

                    <div className="mt-4 grid gap-3">
                      {productViews.map(
                        (module, index) => (
                          <button
                            key={module.key}
                            type="button"
                            onClick={() => {
                              setActiveModule(module)
                              setActiveProductIndex(0)
                            }}
                            className={`
                              group
                              grid
                              grid-cols-[auto_1fr_auto]
                              items-center
                              gap-3
                              rounded-2xl
                              border
                              px-4
                              py-3
                              text-left
                              transition-all
                              duration-300
                              ${
                                activeModule.key === module.key
                                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                                  : "border-white/10 bg-black/40 text-zinc-500 hover:border-cyan-300/25 hover:text-cyan-100"
                              }
                            `}
                          >
                            <span className="text-[10px] font-black text-cyan-100/70">
                              {String(index + 1).padStart(2, "0")}
                            </span>

                            <span className="text-[11px] uppercase tracking-[0.18em]">
                              {module.label}
                            </span>

                            <module.icon className={`h-3.5 w-3.5 ${module.accent}`} />
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="self-end rounded-full border border-white/10 bg-black/45 px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500 backdrop-blur-xl">
                    {activeProductionProduct?.status || "Estado por definir"}
                  </div>
                </div>
              </div>

              <div className="rounded-[30px] border border-white/10 bg-black/35 p-6 lg:min-h-[360px]">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045]">
                  <activeModule.icon className={`h-6 w-6 ${activeModule.accent}`} />
                </div>

                <p className="mt-8 text-[10px] uppercase tracking-[0.28em] text-cyan-100/65">
                  Módulo seleccionado
                </p>

                <h3 className="mt-4 text-2xl font-black leading-tight tracking-[-0.03em] text-white xl:text-3xl">
                  {activeModule.headline}
                </h3>

                <p className="mt-5 text-sm leading-7 text-zinc-400">
                  {activeModule.detail}
                </p>

                <div className="mt-8 space-y-3">
                  {activeProductionProduct && (
                    <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-4">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-100/65">
                        Producto destacado
                      </p>

                      <h4 className="mt-2 truncate text-xl font-black text-white">
                        {activeProductionProduct.name}
                      </h4>

                      <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        <span>{activeProductionProduct.status}</span>
                        <span className="text-cyan-100">
                          {activeProductionProduct.progress}%
                        </span>
                      </div>

                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <motion.div
                          initial={{
                            width: 0,
                          }}
                          animate={{
                            width: `${activeProductionProduct.progress}%`,
                          }}
                          transition={{
                            duration: 0.7,
                          }}
                          className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-amber-200"
                        />
                      </div>
                    </div>
                  )}

                  {selectedProducts.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        Sin productos en esta etapa
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        Cuando agregues productos con este estado en Admin,
                        aparecerán automáticamente aquí.
                      </p>
                    </div>
                  )}

                  {selectedProducts.length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        Productos en esta vista
                      </p>

                      <div className="mt-3 space-y-2">
                        {selectedProducts
                          .slice(0, 4)
                          .map(
                            product => (
                              <div
                                key={product.id}
                                className="flex items-center justify-between gap-3 rounded-xl bg-black/30 px-3 py-2"
                              >
                                <span className="truncate text-sm text-white/80">
                                  {product.name}
                                </span>
                                <span className="text-xs text-cyan-100">
                                  {product.progress}%
                                </span>
                              </div>
                            )
                          )}
                      </div>
                    </div>
                  )}

                  {nextLaunch && (
                    <div className="rounded-2xl border border-amber-200/15 bg-amber-200/[0.055] px-4 py-4">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-amber-100/65">
                        Próximo lanzamiento
                      </p>

                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
                          {nextLaunch.image_url ||
                          nextLaunch.image ? (
                            <img
                              src={nextLaunch.image_url || nextLaunch.image || ""}
                              alt={nextLaunch.name}
                              className="h-full w-full object-contain p-1.5"
                            />
                          ) : (
                            <Rocket className="h-5 w-5 text-amber-100" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <h4 className="truncate text-base font-black text-white">
                            {nextLaunch.name}
                          </h4>
                          <p className="mt-1 text-xs text-zinc-500">
                            {nextLaunch.status} · {nextLaunch.progress}%
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {[
                    "Productos",
                    "Estado",
                    "Canales",
                  ].map(
                    item => (
                      <div
                        key={item}
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3"
                      >
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                          {item}
                        </span>
                        <span className="text-xs uppercase tracking-[0.18em] text-cyan-100">
                          Sincronizado
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>

            </div>

          </motion.div>

        </div>

      </div>

    </section>
  )

}
