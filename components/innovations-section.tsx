"use client"

import Image from "next/image"
import Link from "next/link"

import { motion } from "framer-motion"

import {
  ArrowUpRight,
  Clock3,
  Info,
  Rocket,
} from "lucide-react"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  getProducts,
  getProductStates,
} from "@/lib/products-service"

import { supabase } from "@/lib/supabase"

type Product = {
  id: string
  state_id: string | null
  name: string
  category?: string | null
  description?: string | null
  slug?: string | null
  image?: string | null
  image_url?: string | null
  problemSolved?: string | null
  innovationSubtitle?: string | null
  benefits?: string[] | null
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

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function getProductImage(product: Product) {
  return (
    product.image_url ||
    product.image ||
    "/placeholder.jpg"
  )
}

function isCommercializing(product: LiveProduct) {
  const status =
    normalizeText(product.status)

  return (
    status.includes("comercial")
  )
}

function isAvailableNow(product: LiveProduct) {
  const status =
    normalizeText(product.status)

  return status.includes("disponible")
}

function isComingSoon(product: LiveProduct) {
  const status =
    normalizeText(product.status)

  return [
    "idea",
    "validacion",
    "priorizado",
    "testing",
    "produccion",
  ].some(
    state => status.includes(state)
  )
}

function getPublicState(product: LiveProduct) {
  const status =
    normalizeText(product.status)

  if (status.includes("comercial")) {
    return "COMERCIALIZANDOSE"
  }

  return "DESARROLLO"
}

function getCustomerOutcome(product: LiveProduct) {
  return (
    product.problemSolved ||
    product.innovationSubtitle ||
    product.description ||
    "un resultado funcional pensado para mejorar energia, bienestar y rendimiento diario"
  )
}

function getCustomerBenefits(product: LiveProduct) {
  if (
    product.benefits &&
    product.benefits.length > 0
  ) {
    return product.benefits.slice(0, 3)
  }

  const text =
    [
      product.name,
      product.category,
      product.description,
      product.problemSolved,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

  if (
    text.includes("pancake") ||
    text.includes("waffle") ||
    text.includes("prote")
  ) {
    return [
      "Nutricion practica para rutinas activas",
      "Mayor saciedad y energia diaria",
      "Formato pensado para habitos faciles de sostener",
    ]
  }

  if (
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("cafe")
  ) {
    return [
      "Energia limpia para el dia",
      "Apoyo al enfoque mental",
      "Experiencia funcional facil de integrar",
    ]
  }

  return [
    "Bienestar funcional para la vida diaria",
    "Experiencia premium y practica",
    "Valor real para mejorar habitos del cliente",
  ]
}

export function InnovationsSection() {
  const [
    products,
    setProducts,
  ] = useState<LiveProduct[]>([])

  useEffect(() => {
    async function loadProducts() {
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

      setProducts(
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
                "Proximamente",
              progress:
                state?.progress ||
                0,
            }
          }
        )
      )
    }

    loadProducts()

    const channel =
      supabase
        .channel(
          "upcoming-products"
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "products",
          },
          loadProducts
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "product_states",
          },
          loadProducts
        )
        .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const commercializationProducts =
    useMemo(
      () =>
        products
          .filter(
            product =>
              !isAvailableNow(product) &&
              isCommercializing(product)
          )
          .sort(
            (a, b) =>
              b.progress - a.progress
          ),
      [
        products,
      ]
    )

  const comingSoonProducts =
    useMemo(
      () =>
        products
          .filter(
            product =>
              !isAvailableNow(product) &&
              isComingSoon(product)
          )
          .sort(
            (a, b) => {
              if (a.featuredLaunch) {
                return -1
              }

              if (b.featuredLaunch) {
                return 1
              }

              return (
                b.progress -
                a.progress
              )
            }
          ),
      [
        products,
      ]
    )

  const featuredCommercializationProduct =
    commercializationProducts[0]

  const secondaryCommercializationProducts =
    commercializationProducts.slice(
      1,
      3
    )

  const hasSecondaryCommercializationProducts =
    secondaryCommercializationProducts.length > 0

  const featuredComingSoonProduct =
    comingSoonProducts[0]

  const previewComingSoonProducts =
    comingSoonProducts.slice(
      1,
      4
    )

  return (
    <section
      id="innovations"
      className="relative isolate overflow-hidden bg-black py-36 md:py-44"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(34,211,238,0.10),transparent_42%),linear-gradient(180deg,rgba(0,0,0,0.1),rgba(0,0,0,0.95))]" />
      <div className="absolute inset-0 opacity-[0.025] bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:110px_110px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
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
            duration: 0.85,
          }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl text-center"
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Clock3 className="h-4 w-4" />
            Que viene pronto
          </div>

          <h2 className="mt-9 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
            Proximos lanzamientos
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              en preparacion
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            Esta seccion maneja solo dos estados: desarrollo, cuando mantenemos
            el producto en expectativa mostrando el beneficio que traera al
            cliente, y comercializandose, cuando ya se revela el producto.
          </p>
        </motion.div>

        <div className="mt-16 space-y-20">

          <section aria-labelledby="commercialization-heading">
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.34em] text-cyan-100/60">
                  Comercialización
                </p>
                <h3
                  id="commercialization-heading"
                  className="mt-3 text-3xl font-black tracking-[-0.04em] text-white md:text-4xl"
                >
                  Productos ya revelados
                </h3>
              </div>
            </div>

            {featuredCommercializationProduct ? (
              <div
                className={
                  hasSecondaryCommercializationProducts
                    ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.78fr)]"
                    : "grid gap-6"
                }
              >
                <motion.article
                  initial={{
                    opacity: 0,
                    y: 36,
                  }}
                  whileInView={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.85,
                  }}
                  viewport={{ once: true }}
                  className="relative overflow-hidden rounded-[30px] border border-cyan-200/15 bg-white/[0.035] p-6 backdrop-blur-2xl md:p-8"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.15),transparent_36%)]" />

                  <div className="relative grid gap-8 md:grid-cols-[0.9fr_1.1fr] md:items-center">
                    <div className="relative min-h-[300px] overflow-hidden rounded-[26px] border border-white/10 bg-black/40 p-6">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.10),transparent_62%)]" />
                      <Image
                        src={getProductImage(featuredCommercializationProduct)}
                        alt={featuredCommercializationProduct.name}
                        width={560}
                        height={460}
                        className="relative z-10 h-full min-h-[260px] w-full object-contain"
                      />
                    </div>

                    <div className="relative z-10">
                      <span className="inline-flex rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-100">
                        COMERCIALIZANDOSE
                      </span>

                      <p className="mt-7 text-[10px] uppercase tracking-[0.32em] text-cyan-100/55">
                        {featuredCommercializationProduct.category ||
                          "IMNOVA Launch"}
                      </p>

                      <h3 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-[-0.035em] text-white md:text-5xl lg:text-6xl">
                        {featuredCommercializationProduct.name}
                      </h3>

                      <p className="mt-6 max-w-3xl text-base leading-8 text-zinc-400 md:text-lg">
                        {featuredCommercializationProduct.description ||
                          "Producto en etapa de comercialización."}
                      </p>

                      {featuredCommercializationProduct.slug && (
                        <Link
                          href={`/store/${featuredCommercializationProduct.slug}`}
                          className="mt-8 inline-flex items-center justify-center gap-3 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-200/35 hover:bg-cyan-300/[0.13]"
                        >
                          Ver mas informacion
                          <Info className="h-4 w-4" />
                        </Link>
                      )}

                      <div className="mt-8">
                        <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                          <span>
                            {featuredCommercializationProduct.status}
                          </span>
                          <span className="text-cyan-100">
                            {featuredCommercializationProduct.progress}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <motion.div
                            initial={{
                              width: 0,
                            }}
                            whileInView={{
                              width:
                                `${featuredCommercializationProduct.progress}%`,
                            }}
                            transition={{
                              duration: 1,
                            }}
                            viewport={{ once: true }}
                            className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-amber-200"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.article>

                {hasSecondaryCommercializationProducts && (
                  <div className="grid content-start gap-4">
                    {secondaryCommercializationProducts.map(
                      product => (
                        <motion.article
                          key={product.id}
                          initial={{
                            opacity: 0,
                            x: 24,
                          }}
                          whileInView={{
                            opacity: 1,
                            x: 0,
                          }}
                          transition={{
                            duration: 0.7,
                          }}
                          viewport={{ once: true }}
                          className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl"
                        >
                          <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
                            <img
                              src={getProductImage(product)}
                              alt={product.name}
                              className="h-full w-full object-contain p-2"
                            />
                          </div>

                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                              COMERCIALIZANDOSE
                            </p>
                            <h4 className="mt-2 truncate text-lg font-black leading-tight text-white">
                              {product.name}
                            </h4>
                            {product.slug && (
                              <Link
                                href={`/store/${product.slug}`}
                                className="mt-3 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100"
                              >
                                Ver mas informacion
                                <ArrowUpRight className="h-3 w-3" />
                              </Link>
                            )}
                            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                              <div
                                style={{
                                  width: `${product.progress}%`,
                                }}
                                className="h-full rounded-full bg-cyan-200"
                              />
                            </div>
                          </div>
                        </motion.article>
                      )
                    )}
                  </div>
                )}
              </div>
            ) : (
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
                viewport={{ once: true }}
                className="mx-auto rounded-[32px] border border-white/10 bg-white/[0.035] p-8 text-center backdrop-blur-xl"
              >
                <Rocket className="mx-auto h-8 w-8 text-cyan-100" />
                <h3 className="mt-6 text-3xl font-black text-white">
                  No hay productos en comercialización actualmente.
                </h3>
              </motion.div>
            )}
          </section>

          <section
            aria-labelledby="coming-soon-heading"
            className="pt-6 md:pt-10"
          >
            <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.34em] text-cyan-100/60">
                  Viene Pronto
                </p>
                <h3
                  id="coming-soon-heading"
                  className="mt-3 text-2xl font-black leading-tight text-white md:text-3xl"
                >
                  Productos en preparación
                </h3>
              </div>
            </div>

            {featuredComingSoonProduct ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.78fr)]">
                <motion.article
                  initial={{
                    opacity: 0,
                    y: 36,
                  }}
                  whileInView={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.85,
                  }}
                  viewport={{ once: true }}
                  className="relative overflow-hidden rounded-[30px] border border-cyan-200/15 bg-white/[0.035] p-6 backdrop-blur-2xl md:p-8"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.15),transparent_36%)]" />

                  <div className="relative z-10">
                    <span className="inline-flex rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-100">
                      {featuredComingSoonProduct.status}
                    </span>

                    <p className="mt-7 text-[10px] uppercase tracking-[0.32em] text-cyan-100/55">
                      {featuredComingSoonProduct.category ||
                        "IMNOVA Launch"}
                    </p>

                    <h3 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-[-0.035em] text-white md:text-5xl lg:text-6xl">
                      Proximamente
                    </h3>

                    <p className="mt-6 max-w-3xl text-base leading-8 text-zinc-400 md:text-lg">
                      Desarrollo de un producto que resolvera{" "}
                      {getCustomerOutcome(featuredComingSoonProduct)}.
                    </p>

                    <div className="mt-7 grid gap-3 sm:grid-cols-3">
                      {getCustomerBenefits(
                        featuredComingSoonProduct
                      ).map(benefit => (
                        <div
                          key={benefit}
                          className="rounded-2xl border border-cyan-200/10 bg-cyan-300/[0.045] px-4 py-4 text-sm leading-6 text-cyan-50/80"
                        >
                          {benefit}
                        </div>
                      ))}
                    </div>

                    <div className="mt-8 inline-flex rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                      Avisarme cuando salga
                    </div>

                    <div className="mt-8">
                      <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        <span>
                          {featuredComingSoonProduct.status}
                        </span>
                        <span className="text-cyan-100">
                          {featuredComingSoonProduct.progress}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <motion.div
                          initial={{
                            width: 0,
                          }}
                          whileInView={{
                            width:
                              `${featuredComingSoonProduct.progress}%`,
                          }}
                          transition={{
                            duration: 1,
                          }}
                          viewport={{ once: true }}
                          className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-amber-200"
                        />
                      </div>
                    </div>
                  </div>
                </motion.article>

                <div className="grid content-start gap-4">
                  {previewComingSoonProducts.map(
                    product => (
                      <motion.article
                        key={product.id}
                        initial={{
                          opacity: 0,
                          x: 24,
                        }}
                        whileInView={{
                          opacity: 1,
                          x: 0,
                        }}
                        transition={{
                          duration: 0.7,
                        }}
                        viewport={{ once: true }}
                        className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl"
                      >
                        <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
                          <Rocket className="h-6 w-6 text-cyan-100/55" />
                        </div>

                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                            {product.status}
                          </p>
                          <h4 className="mt-2 truncate text-lg font-black leading-tight text-white">
                            Proximamente
                          </h4>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                            {getCustomerOutcome(product)}.
                          </p>
                          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              style={{
                                width: `${product.progress}%`,
                              }}
                              className="h-full rounded-full bg-cyan-200"
                            />
                          </div>
                        </div>
                      </motion.article>
                    )
                  )}
                </div>
              </div>
            ) : (
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
                viewport={{ once: true }}
                className="mx-auto rounded-[32px] border border-white/10 bg-white/[0.035] p-8 text-center backdrop-blur-xl"
              >
                <Rocket className="mx-auto h-8 w-8 text-cyan-100" />
                <h3 className="mt-6 text-3xl font-black text-white">
                  No hay próximos lanzamientos activos.
                </h3>
              </motion.div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
