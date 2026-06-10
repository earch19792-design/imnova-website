"use client"

import Image from "next/image"
import Link from "next/link"

import { motion } from "framer-motion"

import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Info,
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
  problem?: string | null
  human_problem?: string | null
  humanProblem?: string | null
  problemSolved?: string | null
  problem_solved?: string | null
  problema?: string | null
  problema_resuelve?: string | null
  problemaQueResuelve?: string | null
  expected_benefit?: string | null
  expectedBenefit?: string | null
  innovationSubtitle?: string | null
  benefits?: string[] | string | null
  survey_score?: number | string | null
  surveyScore?: number | string | null
  survey_votes?: number | string | null
  surveyVotes?: number | string | null
  validation_status?: string | null
  validationStatus?: string | null
  social_interest?: string | null
  socialInterest?: string | null
  social_signals?: string[] | string | null
  socialSignals?: string[] | string | null
  social_interest_score?: number | string | null
  socialInterestScore?: number | string | null
  social_mentions?: number | string | null
  socialMentions?: number | string | null
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

const officialProductFlow = [
  "Idea",
  "Validación",
  "Priorizado",
  "Testing",
  "Producción",
  "Comercialización",
  "Disponible",
]

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

function getFirstText(
  values: Array<string | null | undefined>
) {
  return (
    values
      .map(value => value?.trim())
      .find(Boolean) || null
  )
}

function parseNumericValue(
  value?: number | string | null
) {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null
  }

  const parsed =
    Number.parseFloat(
      value
        .replace("%", "")
        .replace(",", ".")
        .trim()
    )

  return Number.isFinite(parsed)
    ? parsed
    : null
}

function formatSurveyScore(score: number) {
  return `${Math.round(score)}%`
}

function getSurveyScore(product: Product) {
  const parsedScore =
    parseNumericValue(
      product.survey_score ??
        product.surveyScore
    )

  if (parsedScore === null) {
    return null
  }

  const percentage =
    parsedScore > 0 && parsedScore <= 1
      ? parsedScore * 100
      : parsedScore

  return Math.max(
    0,
    Math.min(
      100,
      percentage
    )
  )
}

function getSurveyVotes(product: Product) {
  const parsedVotes =
    parseNumericValue(
      product.survey_votes ??
        product.surveyVotes
    )

  if (parsedVotes === null) {
    return null
  }

  return Math.max(
    0,
    Math.round(parsedVotes)
  )
}

function getValidationStatus(product: Product) {
  return getFirstText([
    product.validation_status,
    product.validationStatus,
  ])
}

function hasSurveyData(product: Product) {
  return (
    getSurveyScore(product) !== null ||
    getSurveyVotes(product) !== null
  )
}

function hasValidationDecisionData(product: Product) {
  return Boolean(getValidationStatus(product))
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

function hasOfficialValidationAdvance(
  product: LiveProduct
) {
  const productStatus =
    normalizeText(product.status)

  return (
    productStatus.includes("priorizado") ||
    productStatus.includes("testing") ||
    productStatus.includes("produccion")
  )
}

function hasRecordedValidationDecision(
  product: LiveProduct
) {
  return (
    hasValidationDecisionData(product) ||
    hasOfficialValidationAdvance(product)
  )
}

function hasRecordedPositiveValidation(
  product: LiveProduct
) {
  const validationStatus =
    normalizeText(
      getValidationStatus(product) || ""
    )

  return (
    validationStatus.includes("aprob") ||
    validationStatus.includes("validado") ||
    validationStatus.includes("validada") ||
    validationStatus.includes("positivo") ||
    validationStatus.includes("suficiente") ||
    hasOfficialValidationAdvance(product)
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

function getSocialInterestScore(product: Product) {
  const parsedScore =
    parseNumericValue(
      product.social_interest_score ??
        product.socialInterestScore
    )

  if (parsedScore === null) {
    return null
  }

  const percentage =
    parsedScore > 0 && parsedScore <= 1
      ? parsedScore * 100
      : parsedScore

  return Math.max(
    0,
    Math.min(
      100,
      percentage
    )
  )
}

function getSocialMentions(product: Product) {
  const parsedMentions =
    parseNumericValue(
      product.social_mentions ??
        product.socialMentions
    )

  if (parsedMentions === null) {
    return null
  }

  return Math.max(
    0,
    Math.round(parsedMentions)
  )
}

function getSocialSignals(product: Product) {
  return [
    ...normalizeStringList(
      product.social_signals
    ),
    ...normalizeStringList(
      product.socialSignals
    ),
    ...normalizeStringList(
      product.social_interest
    ),
    ...normalizeStringList(
      product.socialInterest
    ),
  ]
}

function hasSocialSignalData(product: Product) {
  return (
    getSocialInterestScore(product) !== null ||
    getSocialMentions(product) !== null ||
    getSocialSignals(product).length > 0
  )
}

function hasCommunitySignalData(product: Product) {
  return (
    hasSurveyData(product) ||
    hasSocialSignalData(product) ||
    hasValidationDecisionData(product)
  )
}

function getSocialSignalSummary(product: Product) {
  const score =
    getSocialInterestScore(product)

  const mentions =
    getSocialMentions(product)

  if (score !== null) {
    return `Interés en redes: ${formatSurveyScore(score)}`
  }

  if (mentions !== null) {
    return `Menciones en redes: ${mentions}`
  }

  const signals =
    getSocialSignals(product)

  if (signals.length > 0) {
    return signals[0]
  }

  return "Señales de redes pendientes"
}

function getSocialSignalDetail(product: Product) {
  const score =
    getSocialInterestScore(product)

  const mentions =
    getSocialMentions(product)

  const signals =
    getSocialSignals(product)

  if (score !== null && mentions !== null) {
    return `Interés en redes: ${formatSurveyScore(score)} con ${mentions} menciones registradas.`
  }

  if (score !== null) {
    return `Interés en redes: ${formatSurveyScore(score)}.`
  }

  if (mentions !== null) {
    return `Menciones en redes: ${mentions}.`
  }

  if (signals.length > 0) {
    return signals.join(", ")
  }

  return "Señales de interés en redes pendientes de la comunidad."
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
    "Nicho pendiente de definir",
  ]
}

function getPopulationProblem(product: LiveProduct) {
  const configuredProblem =
    product.human_problem ||
    product.humanProblem ||
    product.problem ||
    product.problemSolved ||
    product.problem_solved ||
    product.problema ||
    product.problema_resuelve ||
    product.problemaQueResuelve

  if (configuredProblem) {
    return configuredProblem
  }

  return "Problema en validación con la comunidad"
}

function getExpectedBenefit(product: LiveProduct) {
  return (
    getFirstText([
      product.expected_benefit,
      product.expectedBenefit,
      product.innovationSubtitle,
      ...normalizeStringList(product.benefits),
      product.description,
    ]) ||
    "Beneficio esperado pendiente de validar"
  )
}

function getSurveySummary(product: LiveProduct) {
  const score =
    getSurveyScore(product)

  const votes =
    getSurveyVotes(product)

  if (score !== null) {
    return `Interés positivo: ${formatSurveyScore(score)}`
  }

  if (votes !== null) {
    return `Votos recibidos: ${votes}`
  }

  return "Encuesta pendiente"
}

function getSurveyDetail(product: LiveProduct) {
  const score =
    getSurveyScore(product)

  const votes =
    getSurveyVotes(product)

  if (score !== null && votes !== null) {
    return `Interés positivo: ${formatSurveyScore(score)} con ${votes} votos recibidos.`
  }

  if (score !== null) {
    return `Interés positivo: ${formatSurveyScore(score)}.`
  }

  if (votes !== null) {
    return `Votos recibidos: ${votes}.`
  }

  return "Validación comunitaria activa."
}

function getDecisionText(product: LiveProduct) {
  if (hasRecordedPositiveValidation(product)) {
    return "La validación registrada indica que puede evaluarse para pasar al siguiente estado del proceso IMNOVA"
  }

  if (hasCommunitySignalData(product)) {
    return "La decisión de fabricar, ajustar o pausar dependerá de encuestas reales de la comunidad IMNOVA y señales registradas en redes sociales"
  }

  return "La comunidad IMNOVA definirá con encuestas reales y señales de redes si esta idea se fabrica, se ajusta o se pausa"
}

function getComingSoonBadgeLabel(product: LiveProduct) {
  return (
    getValidationStatus(product) ||
    product.status ||
    "Idea en validación"
  )
}

function getOfficialFlowIndex(
  status: string
) {
  const normalizedStatus =
    normalizeText(status)

  const index =
    officialProductFlow.findIndex(
      step =>
        normalizedStatus.includes(
          normalizeText(step)
        )
    )

  return index >= 0
    ? index
    : 0
}

function getOfficialFlowPercent(
  status: string
) {
  const flowIndex =
    getOfficialFlowIndex(status)

  const maxIndex =
    Math.max(
      officialProductFlow.length - 1,
      1
    )

  return `${Math.max(
    8,
    Math.round(
      (flowIndex / maxIndex) *
        100
    )
  )}%`
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

  const decisionRecordedProducts =
    useMemo(
      () =>
        comingSoonProducts.filter(
          hasRecordedValidationDecision
        ),
      [
        comingSoonProducts,
      ]
    )

  const surveyedComingSoonProducts =
    useMemo(
      () =>
        comingSoonProducts.filter(
          hasSurveyData
        ),
      [
        comingSoonProducts,
      ]
    )

  const socialSignalComingSoonProducts =
    useMemo(
      () =>
        comingSoonProducts.filter(
          hasSocialSignalData
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

  const featuredHasPositiveValidation =
    featuredComingSoonProduct
      ? hasRecordedPositiveValidation(
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
            Innovación IMNOVA
          </div>

          <h2 className="mt-9 text-4xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-6xl">
            Comercialización
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              y Viene Pronto
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            Una vista separada para productos que avanzan hacia
            comercialización e ideas que la comunidad ayuda a validar antes de
            fabricar o desarrollar.
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
                  Cercano al mercado
                </p>
                <h3
                  id="commercialization-heading"
                  className="mt-3 text-4xl font-black leading-tight tracking-[-0.04em] text-white md:text-6xl"
                >
                  En preparación comercial
                </h3>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
                  Productos cercanos al mercado que ya pueden explicarse con
                  imagen, contexto e información clara, sin presentarse como
                  disponibles para compra.
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
                  Viene Pronto
                </p>
                <h3
                  id="coming-soon-heading"
                  className="mt-3 text-4xl font-black leading-tight tracking-[-0.04em] text-white md:text-6xl"
                >
                  Ideas en validación comunitaria
                </h3>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
                  Un contador público de ideas que la comunidad ayuda a
                  evaluar. Cada idea muestra nicho, problema humano, señales de
                  encuesta y actividad social; cuando la validación es positiva,
                  puede avanzar hacia el Pipeline Oficial IMNOVA.
                </p>
              </div>

              <div className="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-3xl border border-amber-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-amber-100/45">
                    Ideas cargadas
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {comingSoonProducts.length}
                  </p>
                </div>

                <div className="rounded-3xl border border-amber-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-amber-100/45">
                    Con encuesta
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {surveyedComingSoonProducts.length}
                  </p>
                </div>

                <div className="rounded-3xl border border-amber-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-amber-100/45">
                    Señales sociales
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {socialSignalComingSoonProducts.length}
                  </p>
                </div>

                <div className="rounded-3xl border border-amber-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-amber-100/45">
                    Listas para avanzar
                  </p>
                  <p className="mt-2 text-3xl font-black text-amber-100">
                    {decisionRecordedProducts.length}
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
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={
                          featuredHasPositiveValidation
                            ? "inline-flex items-center gap-2 rounded-full border border-emerald-200/25 bg-emerald-300/[0.10] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-emerald-100"
                            : "inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-100"
                        }
                      >
                        {featuredHasPositiveValidation ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Signal className="h-3.5 w-3.5" />
                        )}
                        {getComingSoonBadgeLabel(
                          featuredComingSoonProduct
                        )}
                      </span>

                      <span className="inline-flex rounded-full border border-amber-200/20 bg-amber-200/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.20em] text-amber-100">
                        {getSurveySummary(
                          featuredComingSoonProduct
                        )}
                      </span>

                      <span className="inline-flex rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-[10px] uppercase tracking-[0.20em] text-zinc-300">
                        {getSocialSignalSummary(
                          featuredComingSoonProduct
                        )}
                      </span>
                    </div>

                    <p className="mt-7 text-[10px] uppercase tracking-[0.32em] text-cyan-100/55">
                      Idea en evaluación
                    </p>
                    <h3 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-[-0.035em] text-white md:text-5xl">
                      {featuredComingSoonProduct.name}
                    </h3>

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

                    <div className="mt-6 grid gap-4 lg:grid-cols-4">
                      <div className="rounded-3xl border border-amber-200/15 bg-amber-200/[0.055] p-5">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/60">
                          Problema que resuelve
                        </p>
                        <p className="mt-4 text-sm leading-7 text-zinc-300">
                          {getPopulationProblem(featuredComingSoonProduct)}
                        </p>
                      </div>

                      <div className="rounded-3xl border border-cyan-200/15 bg-cyan-300/[0.045] p-5">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/60">
                          Promesa funcional
                        </p>
                        <p className="mt-4 text-sm leading-7 text-zinc-300">
                          {getExpectedBenefit(featuredComingSoonProduct)}
                        </p>
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-400">
                          Validación registrada
                        </p>
                        <p className="mt-4 text-sm leading-7 text-zinc-300">
                          {getSurveyDetail(featuredComingSoonProduct)}
                        </p>
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-400">
                          Señales sociales
                        </p>
                        <p className="mt-4 text-sm leading-7 text-zinc-300">
                          {getSocialSignalDetail(featuredComingSoonProduct)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 rounded-3xl border border-emerald-200/15 bg-emerald-300/[0.06] p-5">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-100/65">
                        Siguiente decisión
                      </p>
                      <p className="mt-3 text-sm leading-7 text-emerald-50/85">
                        {getDecisionText(featuredComingSoonProduct)}.
                      </p>
                    </div>

                    <div className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025] p-5">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/65">
                        Camino posible hacia producto oficial
                      </p>
                      <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">
                        La activación de encuestas se gestiona desde IMNOVA. En
                        Home solo mostramos señales y conteos públicos; si el
                        promedio comunitario es alto, la idea puede avanzar por
                        las etapas oficiales hasta convertirse en producto
                        disponible.
                      </p>

                      <div className="relative mt-6 overflow-x-auto pb-3 [scrollbar-width:thin] [scrollbar-color:rgba(251,191,36,0.5)_rgba(255,255,255,0.08)]">
                        <div className="relative min-w-[760px]">
                          <div className="absolute left-0 right-0 top-5 h-1 rounded-full bg-white/10" />
                          <motion.div
                            initial={{
                              width: 0,
                            }}
                            whileInView={{
                              width:
                                getOfficialFlowPercent(
                                  featuredComingSoonProduct.status
                                ),
                            }}
                            transition={{
                              duration: 1,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            viewport={{ once: true }}
                            className="absolute left-0 top-5 h-1 rounded-full bg-gradient-to-r from-amber-200 via-cyan-200 to-emerald-200"
                          />

                          <div className="relative grid grid-cols-7 gap-3">
                            {officialProductFlow.map(
                              (step, index) => {
                                const activeFlowIndex =
                                  getOfficialFlowIndex(
                                    featuredComingSoonProduct.status
                                  )

                                const isReached =
                                  index <= activeFlowIndex

                                const isCurrentStep =
                                  index === activeFlowIndex

                                return (
                                  <div
                                    key={step}
                                    className="text-center"
                                  >
                                    <div
                                      className={
                                        isCurrentStep
                                          ? "mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-cyan-200/50 bg-cyan-300/[0.16] text-cyan-50 shadow-[0_0_34px_rgba(34,211,238,0.22)]"
                                          : isReached
                                            ? "mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200/35 bg-emerald-300/[0.10] text-emerald-100"
                                            : "mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/40 text-zinc-500"
                                      }
                                    >
                                      {isReached ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                      ) : (
                                        <span className="text-[10px] font-black">
                                          {index + 1}
                                        </span>
                                      )}
                                    </div>
                                    <p
                                      className={
                                        isCurrentStep
                                          ? "mt-3 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100"
                                          : "mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500"
                                      }
                                    >
                                      {step}
                                    </p>
                                  </div>
                                )
                              }
                            )}
                          </div>
                        </div>
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
                        className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 text-left backdrop-blur-xl"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              hasRecordedPositiveValidation(product)
                                ? "inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-emerald-300/[0.08] px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-emerald-100"
                                : "inline-flex items-center gap-2 rounded-full border border-cyan-200/15 bg-cyan-300/[0.06] px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-cyan-100"
                            }
                          >
                            {hasRecordedPositiveValidation(product) ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Signal className="h-3 w-3" />
                            )}
                            {getComingSoonBadgeLabel(product)}
                          </span>
                        </div>

                        <div className="mt-4 space-y-3">
                          <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                            Nicho: {getProductNiches(product).join(", ")}
                          </p>
                          <h4 className="mt-2 text-lg font-black leading-tight text-white">
                            {product.name}
                          </h4>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                            Problema: {getPopulationProblem(product)}
                          </p>
                          <div className="rounded-2xl border border-cyan-200/10 bg-cyan-300/[0.045] px-4 py-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] text-cyan-100/55">
                              Promesa funcional
                            </p>
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">
                              {getExpectedBenefit(product)}
                            </p>
                          </div>

                          <div className="rounded-2xl border border-amber-200/10 bg-amber-200/[0.045] px-4 py-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] text-amber-100/55">
                              Validación registrada
                            </p>
                            <p className="mt-2 text-xs leading-5 text-amber-50/80">
                              {getSurveySummary(product)}
                            </p>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                              Señales sociales
                            </p>
                            <p className="mt-2 text-xs leading-5 text-zinc-400">
                              {getSocialSignalSummary(product)}
                            </p>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                              Siguiente decisión
                            </p>
                            <p className="mt-2 text-xs leading-5 text-zinc-400">
                              {getDecisionText(product)}
                            </p>
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
                  No hay ideas en validación comunitaria por ahora.
                </h3>
              </motion.div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
