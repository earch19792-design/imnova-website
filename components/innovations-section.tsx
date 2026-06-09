"use client"

import Image from "next/image"
import Link from "next/link"

import { motion } from "framer-motion"

import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Info,
  MessageCircle,
  Rocket,
  Signal,
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
  nicho?: string | null
  nichos?: string[] | string | null
  niche?: string | null
  niches?: string[] | string | null
  problemSolved?: string | null
  problem_solved?: string | null
  problema?: string | null
  problema_resuelve?: string | null
  problemaQueResuelve?: string | null
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

type SurveyIntent = {
  productName: string
  niches: string[]
  problem: string
  promise: string
  source: "web"
}

type InnovationsSectionProps = {
  onSurveyInterest?: (
    intent: SurveyIntent
  ) => void
}

const communityApprovalThreshold = 70

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
  ].some(
    state => status.includes(state)
  )
}

function isIdeaApproved(product: LiveProduct) {
  return (
    product.progress >=
    communityApprovalThreshold
  )
}

function getPublicState(product: LiveProduct) {
  const status =
    normalizeText(product.status)

  if (status.includes("comercial")) {
    return "LISTO PARA SER COMERCIALIZADO"
  }

  return "DESARROLLO"
}

function getCustomerOutcome(product: LiveProduct) {
  return (
    product.problemSolved ||
    product.problem_solved ||
    product.problema ||
    product.problema_resuelve ||
    product.problemaQueResuelve ||
    product.innovationSubtitle ||
    product.description ||
    "un resultado funcional pensado para mejorar energia, bienestar y rendimiento diario"
  )
}

function normalizeStringList(
  value?: string[] | string | null
) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }

  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
}

function getProductNiches(product: LiveProduct) {
  const configuredNiches = [
    ...normalizeStringList(product.nichos),
    ...normalizeStringList(product.niches),
    ...normalizeStringList(product.nicho),
    ...normalizeStringList(product.niche),
  ]

  if (configuredNiches.length > 0) {
    return configuredNiches
  }

  return [
    "Nicho pendiente desde Admin",
  ]
}

function getPopulationProblem(product: LiveProduct) {
  const configuredProblem =
    product.problemSolved ||
    product.problem_solved ||
    product.problema ||
    product.problema_resuelve ||
    product.problemaQueResuelve

  if (configuredProblem) {
    return configuredProblem
  }

  return "problema humano pendiente desde Admin"
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

function getValidationPromise(product: LiveProduct) {
  const outcome =
    getCustomerOutcome(product)

  return `Una posible solucion IMNOVA para ${outcome}. La comunidad decide si esta idea merece avanzar.`
}

function getSurveyIntent(product: LiveProduct): SurveyIntent {
  return {
    productName:
      product.name,
    niches:
      getProductNiches(product),
    problem:
      getPopulationProblem(product),
    promise:
      getValidationPromise(product),
    source:
      "web",
  }
}

export function InnovationsSection({
  onSurveyInterest,
}: InnovationsSectionProps) {
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
          "idea-validation-products"
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

  const approvedIdeaProducts =
    useMemo(
      () =>
        comingSoonProducts.filter(
          isIdeaApproved
        ),
      [
        comingSoonProducts,
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

  const featuredComingSoonApproved =
    featuredComingSoonProduct
      ? isIdeaApproved(
          featuredComingSoonProduct
        )
      : false

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
          className="mx-auto max-w-3xl text-center"
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Clock3 className="h-4 w-4" />
            Mapa comercial
          </div>

          <h2 className="mt-9 text-4xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-6xl">
            Listo para ser comercializado
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              y viene pronto
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            Una vista separada para productos ya revelados y desarrollos en
            expectativa. Cada bloque responde una pregunta distinta sin mezclar
            estados ni rutas de compra.
          </p>
        </motion.div>

        <div className="mt-16 space-y-24">

          <section
            aria-labelledby="commercialization-heading"
            className="relative overflow-hidden rounded-[28px] border border-cyan-200/15 bg-white/[0.026] p-5 shadow-[0_30px_120px_rgba(34,211,238,0.08)] md:p-8 lg:p-10"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/25 to-transparent" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_34%)]" />

            <div className="relative mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.34em] text-cyan-100/60">
                  Listo para vender
                </p>
                <h3
                  id="commercialization-heading"
                  className="mt-3 text-4xl font-black leading-tight tracking-[-0.04em] text-white md:text-6xl"
                >
                  Listo para ser comercializado
                </h3>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
                  Productos que ya pueden mostrarse con nombre, imagen real e
                  informacion completa para evaluar su propuesta comercial.
                </p>
              </div>

              <div className="grid max-w-sm grid-cols-2 gap-3">
                <div className="rounded-3xl border border-cyan-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-cyan-100/45">
                    Productos
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {commercializationProducts.length}
                  </p>
                </div>

                <div className="rounded-3xl border border-cyan-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-cyan-100/45">
                    Avance
                  </p>
                  <p className="mt-2 text-3xl font-black text-cyan-100">
                    {featuredCommercializationProduct?.progress || 0}%
                  </p>
                </div>
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
                        LISTO PARA SER COMERCIALIZADO
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
                          "Producto listo para ser comercializado."}
                      </p>

                      {featuredCommercializationProduct.slug && (
                        <Link
                          href={`/store/${featuredCommercializationProduct.slug}`}
                          className="mt-8 inline-flex items-center justify-center gap-3 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-200/35 hover:bg-cyan-300/[0.13]"
                        >
                          Ver más información
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
                              LISTO PARA SER COMERCIALIZADO
                            </p>
                            <h4 className="mt-2 truncate text-lg font-black leading-tight text-white">
                              {product.name}
                            </h4>
                            {product.slug && (
                              <Link
                                href={`/store/${product.slug}`}
                                className="mt-3 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100"
                              >
                                Ver más información
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
                  No hay productos listos para ser comercializados actualmente.
                </h3>
              </motion.div>
            )}
          </section>

          <section
            aria-labelledby="coming-soon-heading"
            className="relative overflow-hidden rounded-[28px] border border-amber-200/15 bg-white/[0.026] p-5 shadow-[0_30px_120px_rgba(251,191,36,0.07)] md:p-8 lg:p-10"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/25 to-transparent" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.07),transparent_34%)]" />

            <div className="relative mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.34em] text-cyan-100/60">
                  Validacion comunitaria
                </p>
                <h3
                  id="coming-soon-heading"
                  className="mt-3 text-4xl font-black leading-tight tracking-[-0.04em] text-white md:text-6xl"
                >
                  Ideas que la comunidad ayuda a decidir
                </h3>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
                  IMNOVA detecta una oportunidad, define el nicho, identifica
                  el problema humano y comparte una promesa inicial. La
                  comunidad responde desde la web, WhatsApp o redes sociales.
                  El objetivo es medir si esa idea realmente resuelve una
                  necesidad humana y si existe interes suficiente para seguir
                  investigandola.
                </p>
              </div>

              <div className="grid max-w-xl grid-cols-3 gap-3">
                <div className="rounded-3xl border border-amber-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-amber-100/45">
                    Ideas
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {comingSoonProducts.length}
                  </p>
                </div>

                <div className="rounded-3xl border border-amber-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-amber-100/45">
                    Necesidad validada
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {approvedIdeaProducts.length}
                  </p>
                </div>

                <div className="rounded-3xl border border-amber-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-amber-100/45">
                    Canales
                  </p>
                  <p className="mt-2 text-3xl font-black text-amber-100">
                    3
                  </p>
                </div>
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
                    <span
                      className={
                        featuredComingSoonApproved
                          ? "inline-flex items-center gap-2 rounded-full border border-emerald-200/25 bg-emerald-300/[0.10] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-emerald-100"
                          : "inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-100"
                      }
                    >
                      {featuredComingSoonApproved ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Signal className="h-3.5 w-3.5" />
                      )}
                      {featuredComingSoonApproved
                        ? "Necesidad validada"
                        : "En encuesta"}
                    </span>

                    <p className="mt-7 text-[10px] uppercase tracking-[0.32em] text-cyan-100/55">
                      Nicho
                    </p>

                    <div className="mt-4 flex max-w-3xl flex-wrap gap-3">
                      {getProductNiches(
                        featuredComingSoonProduct
                      ).map(niche => (
                        <span
                          key={niche}
                          className="rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-cyan-50"
                        >
                          {niche}
                        </span>
                      ))}
                    </div>

                    <div className="mt-6 grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
                      <div className="rounded-3xl border border-amber-200/15 bg-amber-200/[0.055] p-5">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/60">
                          Problema que resuelve
                        </p>
                        <p className="mt-4 text-sm leading-7 text-zinc-300">
                          {getPopulationProblem(featuredComingSoonProduct)}.
                        </p>
                      </div>

                      <div className="rounded-3xl border border-cyan-200/15 bg-cyan-300/[0.045] p-5">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/60">
                          Promesa inicial
                        </p>
                        <p className="mt-4 text-sm leading-7 text-zinc-300">
                          {getValidationPromise(featuredComingSoonProduct)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 md:grid-cols-3">
                      {[
                        "Idea detectada",
                        "Problema humano definido",
                        featuredComingSoonApproved
                          ? "Interes validado"
                          : "Midiendo interes",
                      ].map(step => (
                        <div
                          key={step}
                          className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300"
                        >
                          {step}
                        </div>
                      ))}
                    </div>

                    {featuredComingSoonApproved && (
                      <div className="mt-6 rounded-3xl border border-emerald-200/20 bg-emerald-300/[0.08] p-5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-100/70">
                          Notificacion de validacion
                        </p>
                        <p className="mt-3 text-sm leading-7 text-emerald-50/85">
                          La comunidad confirma que esta idea toca una
                          necesidad real. El interes recopilado por los canales
                          disponibles indica que vale la pena seguir
                          investigandola.
                        </p>
                      </div>
                    )}

                    <div className="mt-6 grid gap-3 md:grid-cols-3">
                      {[
                        {
                          channel:
                            "Web",
                          detail:
                            "Encuesta directa en la pagina",
                        },
                        {
                          channel:
                            "WhatsApp",
                          detail:
                            "Interes por mensajes y seguimiento",
                        },
                        {
                          channel:
                            "Redes sociales",
                          detail:
                            "Senales de comunidad y conversacion",
                        },
                      ].map(item => (
                        <div
                          key={item.channel}
                          className="rounded-2xl border border-cyan-200/10 bg-cyan-300/[0.045] px-4 py-4"
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                            {item.channel}
                          </p>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">
                            {item.detail}
                          </p>
                        </div>
                      ))}
                    </div>

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

                    {featuredComingSoonApproved ? (
                      <div
                        className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-emerald-200/25 bg-emerald-300/[0.10] px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-200/40 hover:bg-emerald-300/[0.16]"
                      >
                        Necesidad validada
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onSurveyInterest?.(
                            getSurveyIntent(
                              featuredComingSoonProduct
                            )
                          )
                        }
                        className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-200/35 hover:bg-cyan-300/[0.13]"
                      >
                        Responder encuesta
                        <MessageCircle className="h-4 w-4" />
                      </button>
                    )}

                    <div className="mt-8">
                      <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        <span>
                          {featuredComingSoonApproved
                            ? "Interes validado por comunidad"
                            : "Interes medido por canales"}
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
                      <motion.button
                        key={product.id}
                        type="button"
                        onClick={() =>
                          onSurveyInterest?.(
                            getSurveyIntent(product)
                          )
                        }
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
                        className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4 text-left backdrop-blur-xl transition hover:border-cyan-200/25 hover:bg-cyan-300/[0.055]"
                      >
                        <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
                          <Rocket className="h-6 w-6 text-cyan-100/55" />
                        </div>

                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                            {getProductNiches(product).join(" · ")}
                          </p>
                          <h4 className="mt-2 truncate text-lg font-black leading-tight text-white">
                            {isIdeaApproved(product)
                              ? "Necesidad validada"
                              : "Idea en validacion"}
                          </h4>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                            {isIdeaApproved(product)
                              ? "La comunidad muestra interes suficiente en esta necesidad."
                              : `Midiendo si resuelve ${getPopulationProblem(product)}.`}
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
                      </motion.button>
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
                  No hay ideas en validacion comunitaria por ahora.
                </h3>
              </motion.div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
