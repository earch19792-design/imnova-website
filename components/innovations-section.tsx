"use client"

import Image from "next/image"

import { motion } from "framer-motion"

import {
  Activity,
  CheckCircle2,
  Clock3,
  MessageCircle,
  Radio,
  Rocket,
  Signal,
  Target,
  Vote,
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
  survey_status?: string | null
  surveyStatus?: string | null
  survey_votes?: number | string | null
  surveyVotes?: number | string | null
  validation_status?: string | null
  validationStatus?: string | null
  validation_decision?: string | null
  validationDecision?: string | null
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
  "Desarrollo",
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

function getSurveyStatus(product: Product) {
  return getFirstText([
    product.survey_status,
    product.surveyStatus,
  ])
}

function getSurveyStatusLabel(product: Product) {
  const status =
    getSurveyStatus(product)

  if (!status) {
    return "Encuesta pendiente"
  }

  const normalizedStatus =
    normalizeText(status)

  if (
    normalizedStatus.includes("activa") ||
    normalizedStatus.includes("active")
  ) {
    return "Encuesta activa"
  }

  if (
    normalizedStatus.includes("cerrada") ||
    normalizedStatus.includes("closed")
  ) {
    return "Encuesta cerrada"
  }

  if (
    normalizedStatus.includes("pendiente") ||
    normalizedStatus.includes("draft") ||
    normalizedStatus.includes("pending")
  ) {
    return "Encuesta pendiente"
  }

  return `Encuesta: ${status.replace(/_/g, " ")}`
}

function isSurveyActive(product: Product) {
  const status =
    getSurveyStatus(product)

  return status
    ? normalizeText(status).includes("activa") ||
        normalizeText(status).includes("active")
    : false
}

function getValidationStatus(product: Product) {
  return getFirstText([
    product.validation_status,
    product.validationStatus,
  ])
}

function getValidationDecision(product: Product) {
  return getFirstText([
    product.validation_decision,
    product.validationDecision,
  ])
}

function getValidationStatusLabel(product: Product) {
  const status =
    getValidationStatus(product)

  if (!status) {
    return "Validación pendiente"
  }

  return status.replace(/_/g, " ")
}

function hasSurveyData(product: Product) {
  return (
    Boolean(getSurveyStatus(product)) ||
    getSurveyScore(product) !== null ||
    getSurveyVotes(product) !== null
  )
}

function hasValidationDecisionData(product: Product) {
  return Boolean(
    getValidationDecision(product) ||
      getValidationStatus(product)
  )
}

function isApprovedDevelopmentStage(
  product: LiveProduct
) {
  const status =
    normalizeText(product.status)

  return (
    status.includes("desarrollo") ||
    status.includes("testing") ||
    status.includes("produccion")
  )
}

function isAvailableNow(product: LiveProduct) {
  const status =
    normalizeText(product.status)

  return status.includes("disponible")
}

function isCommunityValidationStage(
  product: LiveProduct
) {
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
    productStatus.includes("desarrollo") ||
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
  const validationDecision =
    normalizeText(
      getValidationDecision(product) ||
        ""
    )

  const validationStatus =
    normalizeText(
      getValidationStatus(product) || ""
    )

  return (
    validationDecision.includes("avanzar") ||
    validationStatus.includes("aprob") ||
    validationStatus.includes("interes alto") ||
    validationStatus.includes("interes_alto") ||
    validationStatus.includes("validado") ||
    validationStatus.includes("validada") ||
    validationStatus.includes("positivo") ||
    validationStatus.includes("suficiente") ||
    hasOfficialValidationAdvance(product)
  )
}

function hasRecordedNegativeValidation(
  product: LiveProduct
) {
  const validationDecision =
    normalizeText(
      getValidationDecision(product) ||
        ""
    )

  const validationStatus =
    normalizeText(
      getValidationStatus(product) || ""
    )

  return (
    validationDecision.includes("ajustar") ||
    validationDecision.includes("pausar") ||
    validationDecision.includes("descartar") ||
    validationStatus.includes("rechaz") ||
    validationStatus.includes("descart") ||
    validationStatus.includes("paus") ||
    validationStatus.includes("negativ") ||
    validationStatus.includes("insuficiente") ||
    validationStatus.includes("no prosper") ||
    validationStatus.includes("deten") ||
    validationStatus.includes("ajust")
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
    getSocialInterestScore(product) !== null
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

  if (score !== null) {
    return `Señal social: ${formatSurveyScore(score)}`
  }

  return "Señales sociales pendientes"
}

function getSocialSignalDetail(product: Product) {
  const score =
    getSocialInterestScore(product)

  if (score !== null) {
    return `Señal social registrada: ${formatSurveyScore(score)}.`
  }

  return "Señales sociales pendientes"
}

function getProductNiches(product: LiveProduct) {
  const configuredNiches = [
    ...normalizeStringList(product.nicho),
  ]

  if (configuredNiches.length > 0) {
    return configuredNiches
  }

  return [
    "Nicho en validación",
  ]
}

function getPopulationProblem(product: LiveProduct) {
  const configuredProblem =
    product.problema_resuelve

  if (configuredProblem) {
    return configuredProblem
  }

  return "Problema en validación con la comunidad"
}

function getExpectedBenefit(product: LiveProduct) {
  return (
    getFirstText([
      product.expected_benefit,
      product.description,
    ]) ||
    "Beneficio en evaluación"
  )
}

function getSurveySummary(product: LiveProduct) {
  const realStatusLabel =
    getSurveyStatusLabel(product)

  const realScore =
    getSurveyScore(product)

  const realVotes =
    getSurveyVotes(product)

  if (realScore !== null) {
    return `Interés positivo: ${formatSurveyScore(realScore)}`
  }

  if (realVotes !== null) {
    return `${realVotes} respuestas registradas`
  }

  return realStatusLabel
}

function getSurveyDetail(product: LiveProduct) {
  const hasRealStatus =
    Boolean(getSurveyStatus(product))

  const realScore =
    getSurveyScore(product)

  const realVotes =
    getSurveyVotes(product)

  if (realScore !== null && realVotes !== null) {
    return `Interés positivo: ${formatSurveyScore(realScore)} con ${realVotes} respuestas registradas.`
  }

  if (realScore !== null) {
    return `Interés positivo: ${formatSurveyScore(realScore)}.`
  }

  if (realVotes !== null) {
    return `${realVotes} respuestas registradas.`
  }

  if (hasRealStatus) {
    return getSurveyStatusLabel(product)
  }

  return "Encuesta pendiente."
}

function getDecisionText(product: LiveProduct) {
  const realDecision =
    normalizeText(
      getValidationDecision(product) ||
        ""
    )

  if (realDecision.includes("avanzar")) {
    return "La idea muestra señales para avanzar."
  }

  if (realDecision.includes("ajustar")) {
    return "La idea requiere ajustes antes de avanzar."
  }

  if (realDecision.includes("pausar")) {
    return "La idea queda pausada hasta obtener mayor interés."
  }

  if (realDecision.includes("descartar")) {
    return "La idea no avanza por ahora."
  }

  return "Decisión pendiente."
}

function getDecisionCardClassName(
  product: LiveProduct
) {
  if (hasRecordedNegativeValidation(product)) {
    return "rounded-2xl border border-amber-200/15 bg-amber-200/[0.055] p-4"
  }

  if (hasRecordedPositiveValidation(product)) {
    return "rounded-2xl border border-emerald-200/15 bg-emerald-300/[0.06] p-4"
  }

  return "rounded-2xl border border-white/10 bg-white/[0.035] p-4"
}

function getDecisionTitleClassName(
  product: LiveProduct
) {
  if (hasRecordedNegativeValidation(product)) {
    return "text-[9px] uppercase tracking-[0.18em] text-amber-100/65"
  }

  if (hasRecordedPositiveValidation(product)) {
    return "text-[9px] uppercase tracking-[0.18em] text-emerald-100/65"
  }

  return "text-[9px] uppercase tracking-[0.18em] text-zinc-500"
}

function getDecisionTextClassName(
  product: LiveProduct
) {
  if (hasRecordedNegativeValidation(product)) {
    return "mt-2 text-xs leading-6 text-amber-50/85"
  }

  if (hasRecordedPositiveValidation(product)) {
    return "mt-2 text-xs leading-6 text-emerald-50/85"
  }

  return "mt-2 text-xs leading-6 text-zinc-400"
}

function getDecisionBadgeClassName(
  product: LiveProduct
) {
  if (hasRecordedNegativeValidation(product)) {
    return "mt-3 inline-flex rounded-full border border-amber-200/15 bg-black/25 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-amber-100/75"
  }

  if (hasRecordedPositiveValidation(product)) {
    return "mt-3 inline-flex rounded-full border border-emerald-200/15 bg-black/25 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-emerald-100/75"
  }

  return "mt-3 inline-flex rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-zinc-400"
}

function isCommunityValidationLive(
  product: LiveProduct
) {
  const status =
    normalizeText(product.status)

  return (
    status.includes("validacion") ||
    isSurveyActive(product) ||
    getSurveyScore(product) !== null ||
    hasSocialSignalData(product)
  )
}

function getCommunityPulseScore(
  product: LiveProduct
) {
  const scores = [
    getSurveyScore(product),
    getSocialInterestScore(product),
  ].filter(
    (score): score is number =>
      score !== null
  )

  if (scores.length > 0) {
    return Math.round(
      scores.reduce(
        (total, score) =>
          total + score,
        0
      ) / scores.length
    )
  }

  return null
}

function getCommunityPulseLabel(
  product: LiveProduct
) {
  if (hasRecordedNegativeValidation(product)) {
    return "Idea en ajuste"
  }

  if (hasRecordedPositiveValidation(product)) {
    return "Interés suficiente"
  }

  if (isCommunityValidationLive(product)) {
    return "Encuesta activa"
  }

  return "Preparando validación"
}

function getRouteProgressLabel(
  product: LiveProduct
) {
  if (hasRecordedNegativeValidation(product)) {
    return "No prosperó todavía: se ajusta o pausa"
  }

  if (hasRecordedPositiveValidation(product)) {
    return "Validación positiva: lista para avanzar"
  }

  if (isCommunityValidationLive(product)) {
    return "Idea avanzando con señales activas"
  }

  return "Esperando señales de la comunidad"
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
                "Próximamente",
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

  const approvedDevelopmentProducts =
    useMemo(
      () =>
        products
          .filter(
            product =>
              !isAvailableNow(product) &&
              isApprovedDevelopmentStage(product)
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
              isCommunityValidationStage(product)
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

  const featuredApprovedDevelopmentProduct =
    approvedDevelopmentProducts[0]

  const secondaryApprovedDevelopmentProducts =
    approvedDevelopmentProducts.slice(
      1,
      3
    )

  const hasSecondaryApprovedDevelopmentProducts =
    secondaryApprovedDevelopmentProducts.length > 0

  const featuredComingSoonProduct =
    comingSoonProducts[0]

  const featuredHasPositiveValidation =
    featuredComingSoonProduct
      ? hasRecordedPositiveValidation(
          featuredComingSoonProduct
        )
      : false

  const featuredCommunityPulseScore =
    featuredComingSoonProduct
      ? getCommunityPulseScore(
          featuredComingSoonProduct
        )
      : null

  const featuredCommunityPulseLabel =
    featuredComingSoonProduct
      ? getCommunityPulseLabel(
          featuredComingSoonProduct
        )
      : "Sin encuesta activa"

  const featuredValidationIsLive =
    featuredComingSoonProduct
      ? isCommunityValidationLive(
          featuredComingSoonProduct
        )
      : false

  const featuredValidationDidNotProsper =
    featuredComingSoonProduct
      ? hasRecordedNegativeValidation(
          featuredComingSoonProduct
        )
      : false

  const featuredRouteProgressLabel =
    featuredComingSoonProduct
      ? getRouteProgressLabel(
          featuredComingSoonProduct
        )
      : "Esperando señales de la comunidad"

  const previewComingSoonProducts =
    comingSoonProducts.slice(
      1,
      4
    )

  const hiddenComingSoonProductsCount =
    Math.max(
      comingSoonProducts.length - 4,
      0
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
            Laboratorio IMNOVA
          </div>

          <h2 className="mt-9 text-4xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-6xl">
            Donde nacen
            <span className="block bg-gradient-to-r from-cyan-200 via-white to-amber-200 bg-clip-text text-transparent">
              los próximos productos
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            Aquí una necesidad se convierte en idea, la comunidad decide si
            vale la pena construirla y solo lo que demuestra interés real
            avanza hacia desarrollo.
          </p>
        </motion.div>

        <div className="mt-16 space-y-24">

          <section
            aria-labelledby="production-heading"
            className="relative overflow-hidden rounded-[28px] border border-cyan-200/15 bg-white/[0.026] p-5 shadow-[0_30px_120px_rgba(34,211,238,0.08)] md:p-8 lg:p-10"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/25 to-transparent" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_34%)]" />

            <div className="relative mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.34em] text-cyan-100/60">
                  Aprobado por la comunidad
                </p>
                <h3
                  id="production-heading"
                  className="mt-3 text-4xl font-black leading-tight tracking-[-0.04em] text-white md:text-6xl"
                >
                  En desarrollo activo
                </h3>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">
                  La idea ya pasó el filtro de validación. Ahora IMNOVA la
                  está convirtiendo en una solución real: desarrollo, testing,
                  producción y preparación antes de estar disponible.
                </p>
              </div>

              <div className="grid max-w-sm grid-cols-2 gap-3">
                <div className="rounded-3xl border border-cyan-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-cyan-100/45">
                    Productos
                  </p>
                  <p className="mt-2 text-3xl font-black text-white">
                    {approvedDevelopmentProducts.length}
                  </p>
                </div>

                <div className="rounded-3xl border border-cyan-200/10 bg-black/35 px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-cyan-100/45">
                    Avance
                  </p>
                  <p className="mt-2 text-3xl font-black text-cyan-100">
                    {featuredApprovedDevelopmentProduct?.progress || 0}%
                  </p>
                </div>
              </div>
            </div>

            {featuredApprovedDevelopmentProduct ? (
              <div
                className={
                  hasSecondaryApprovedDevelopmentProducts
                    ? "grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.82fr)]"
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
                  className="relative overflow-hidden rounded-[30px] border border-cyan-200/15 bg-white/[0.035] p-5 backdrop-blur-2xl md:p-6"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.15),transparent_36%)]" />

                  <div className="relative grid gap-6 md:grid-cols-[240px_minmax(0,1fr)] md:items-center">
                    <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-black/40 p-4">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.10),transparent_62%)]" />
                      <Image
                        src={getProductImage(featuredApprovedDevelopmentProduct)}
                        alt={featuredApprovedDevelopmentProduct.name}
                        width={560}
                        height={460}
                        className="relative z-10 max-h-[220px] w-full object-contain"
                      />
                    </div>

                    <div className="relative z-10">
                      <span className="inline-flex rounded-full border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-100">
                        {featuredApprovedDevelopmentProduct.status}
                      </span>

                      <p className="mt-7 text-[10px] uppercase tracking-[0.32em] text-cyan-100/55">
                        {featuredApprovedDevelopmentProduct.category ||
                          "IMNOVA Launch"}
                      </p>

                      <h3 className="mt-4 max-w-3xl text-3xl font-black leading-tight tracking-[-0.035em] text-white md:text-4xl lg:text-5xl">
                        {featuredApprovedDevelopmentProduct.name}
                      </h3>

                      <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400 md:text-base">
                        {featuredApprovedDevelopmentProduct.description ||
                          "Producto aprobado, en desarrollo activo y preparación de lanzamiento."}
                      </p>

                      <div className="mt-6">
                        <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                          <span>
                            {featuredApprovedDevelopmentProduct.status}
                          </span>
                          <span className="text-cyan-100">
                            {featuredApprovedDevelopmentProduct.progress}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <motion.div
                            initial={{
                              width: 0,
                            }}
                            whileInView={{
                              width:
                                `${featuredApprovedDevelopmentProduct.progress}%`,
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

                {hasSecondaryApprovedDevelopmentProducts && (
                  <div className="grid content-start gap-4">
                    <div className="rounded-[24px] border border-cyan-200/10 bg-cyan-300/[0.045] px-5 py-4">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/55">
                        También avanzando
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        Otros productos aprobados que siguen su ruta antes de
                        estar disponibles.
                      </p>
                    </div>

                    {secondaryApprovedDevelopmentProducts.map(
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
                          className="grid grid-cols-[76px_minmax(0,1fr)] gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl"
                        >
                          <div className="flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
                            <img
                              src={getProductImage(product)}
                              alt={product.name}
                              className="h-full w-full object-contain p-2"
                            />
                          </div>

                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                              {product.status}
                            </p>
                            <h4 className="mt-2 truncate text-lg font-black leading-tight text-white">
                              {product.name}
                            </h4>
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
                  No hay productos aprobados en desarrollo actualmente.
                </h3>
              </motion.div>
            )}
          </section>

          <section
            aria-labelledby="coming-soon-heading"
            className="relative overflow-hidden rounded-[36px] border border-cyan-200/25 bg-[linear-gradient(135deg,rgba(6,182,212,0.12),rgba(0,0,0,0.88)_42%,rgba(251,191,36,0.10))] p-5 shadow-[0_34px_150px_rgba(34,211,238,0.13)] md:p-8 lg:p-10"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/45 to-transparent" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(34,211,238,0.18),transparent_32%),radial-gradient(circle_at_78%_18%,rgba(251,191,36,0.14),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.045),transparent_44%)]" />
            <div className="absolute inset-0 opacity-[0.045] bg-[linear-gradient(rgba(103,232,249,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.16)_1px,transparent_1px)] bg-[size:72px_72px]" />

            <div className="relative mb-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/25 bg-cyan-300/[0.10] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-50">
                    <Activity className="h-3.5 w-3.5" />
                  Laboratorio de ideas
                  </span>
                  <span
                    className={
                      featuredValidationIsLive
                        ? "inline-flex items-center gap-2 rounded-full border border-amber-200/35 bg-amber-200/[0.14] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-amber-50 shadow-[0_0_34px_rgba(251,191,36,0.18)]"
                        : "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-white/55"
                    }
                  >
                    <Radio className="h-3.5 w-3.5" />
                    {featuredCommunityPulseLabel}
                  </span>
                </div>
                <h3
                  id="coming-soon-heading"
                  className="mt-6 max-w-4xl text-4xl font-black leading-[0.98] tracking-[-0.045em] text-white md:text-6xl lg:text-7xl"
                >
                  Viene Pronto
                  <span className="block bg-gradient-to-r from-cyan-100 via-white to-amber-100 bg-clip-text text-transparent">
                    lo decide la comunidad.
                  </span>
                </h3>
                <p className="mt-6 max-w-3xl text-base leading-8 text-zinc-300 md:text-lg">
                  Este es el ADN de IMNOVA: detectar una necesidad humana,
                  convertirla en una hipótesis atractiva y dejar que la
                  comunidad, WhatsApp y redes indiquen si esa idea debe
                  avanzar o quedarse en pausa.
                </p>

                <div className="mt-7 grid gap-3 md:grid-cols-3">
                  {[
                    {
                      icon: Target,
                      label: "Necesidad",
                      text: "Detectamos qué desea mejorar la persona y por qué importa.",
                    },
                    {
                      icon: Vote,
                      label: "Deseo real",
                      text: "La comunidad responde si lo compraría, probaría o esperaría.",
                    },
                    {
                      icon: Rocket,
                      label: "Avance",
                      text: "Solo las ideas con señales claras pasan al proceso oficial.",
                    },
                  ].map(item => (
                    <div
                      key={item.label}
                      className="rounded-3xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl"
                    >
                      <item.icon className="h-5 w-5 text-cyan-100" />
                      <p className="mt-4 text-[10px] font-black uppercase tracking-[0.22em] text-white">
                        {item.label}
                      </p>
                      <p className="mt-3 text-xs leading-5 text-zinc-400">
                        {item.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[30px] border border-cyan-200/20 bg-black/55 p-5 shadow-[inset_0_0_45px_rgba(34,211,238,0.08)] backdrop-blur-xl">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,0.16),transparent_28%)]" />
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="relative text-[10px] uppercase tracking-[0.26em] text-cyan-100/55">
                      Radar comunitario
                    </p>
                    <h4 className="relative mt-2 text-2xl font-black text-white">
                      Deseo de mercado
                    </h4>
                  </div>
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08]">
                    <Signal className="h-6 w-6 text-cyan-100" />
                  </div>
                </div>

                <div className="relative mt-5 rounded-[24px] border border-cyan-200/15 bg-cyan-300/[0.055] p-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.20em] text-cyan-100/60">
                        Señal acumulada
                      </p>
                      <p className="mt-2 text-5xl font-black text-cyan-50">
                        {featuredCommunityPulseScore !== null
                          ? `${featuredCommunityPulseScore}%`
                          : "Pendiente"}
                      </p>
                    </div>
                    <div className="flex items-end gap-1.5">
                      {[34, 48, 62, 76, 90].map(height => (
                        <span
                          key={height}
                          className="w-2 rounded-full bg-gradient-to-t from-cyan-400 to-amber-100"
                          style={{
                            height:
                              `${height}px`,
                            opacity:
                              featuredCommunityPulseScore !== null
                                ? 1
                                : 0.34,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-white to-amber-200"
                      style={{
                        width:
                          featuredCommunityPulseScore !== null
                            ? `${featuredCommunityPulseScore}%`
                            : "0%",
                      }}
                    />
                  </div>
                </div>

                <div className="relative mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                      Ideas
                    </p>
                    <p className="mt-2 text-3xl font-black text-white">
                      {comingSoonProducts.length}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                      Encuestas
                    </p>
                    <p className="mt-2 text-3xl font-black text-white">
                      {surveyedComingSoonProducts.length}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                      Redes
                    </p>
                    <p className="mt-2 text-3xl font-black text-white">
                      {socialSignalComingSoonProducts.length}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-200/15 bg-amber-200/[0.055] px-4 py-3">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-amber-100/55">
                      Decisiones
                    </p>
                    <p className="mt-2 text-3xl font-black text-amber-100">
                      {decisionRecordedProducts.length}
                    </p>
                  </div>
                </div>

                <a
                  href="#contact"
                  className="relative mt-5 inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-amber-200/25 bg-amber-200/[0.10] px-5 py-4 text-[10px] font-black uppercase tracking-[0.18em] text-amber-50 transition hover:border-amber-100/45 hover:bg-amber-200/[0.16]"
                >
                  Participar en la validación
                  <MessageCircle className="h-4 w-4" />
                </a>

                <p className="relative mt-4 text-xs leading-6 text-zinc-500">
                  No revelamos todo desde el inicio. Primero medimos si la
                  necesidad también vive en la comunidad.
                </p>
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
                  className="relative overflow-hidden rounded-[34px] border border-amber-200/20 bg-black/45 p-6 shadow-[0_28px_120px_rgba(251,191,36,0.08)] backdrop-blur-2xl md:p-8"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_36%),radial-gradient(circle_at_82%_8%,rgba(251,191,36,0.14),transparent_30%)]" />

                  <div className="relative z-10">
                    <div className="mb-6 flex flex-col gap-3 rounded-[26px] border border-amber-200/15 bg-amber-200/[0.055] p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={
                            featuredValidationIsLive
                              ? "relative flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-100/35 bg-amber-200/[0.14] text-amber-50 shadow-[0_0_30px_rgba(251,191,36,0.20)]"
                              : "relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/50"
                          }
                        >
                          <Radio className="h-5 w-5" />
                          {featuredValidationIsLive && (
                            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.75)]" />
                          )}
                        </span>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/70">
                            Idea bajo prueba real
                          </p>
                          <p className="mt-1 text-sm leading-6 text-zinc-300">
                            Tu respuesta puede decidir si esta idea se desarrolla.
                          </p>
                        </div>
                      </div>

                      <a
                        href="#contact"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-50 transition hover:border-cyan-100/40 hover:bg-cyan-300/[0.13]"
                      >
                        Participar ahora
                        <Vote className="h-4 w-4" />
                      </a>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                      <div>
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
                        </div>

                        <p className="mt-7 text-[10px] uppercase tracking-[0.32em] text-cyan-100/55">
                          Idea que puede convertirse en producto
                        </p>
                        <h3 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-[-0.035em] text-white md:text-5xl">
                          {featuredComingSoonProduct.name}
                        </h3>

                        <div className="mt-7 grid gap-4 md:grid-cols-2">
                          <div className="rounded-3xl border border-cyan-200/15 bg-cyan-300/[0.045] p-5">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/60">
                              Nicho
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              {getProductNiches(
                                featuredComingSoonProduct
                              ).map(niche => (
                                <span
                                  key={niche}
                                  className="rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-cyan-50"
                                >
                                  {niche}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-3xl border border-amber-200/15 bg-amber-200/[0.055] p-5">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/60">
                              Problema humano
                            </p>
                            <p className="mt-4 text-sm leading-7 text-zinc-300">
                              {getPopulationProblem(
                                featuredComingSoonProduct
                              )}
                            </p>
                          </div>

                          <div className="rounded-3xl border border-white/10 bg-black/25 p-5 md:col-span-2">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-400">
                              Promesa inicial
                            </p>
                            <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-300">
                              {getExpectedBenefit(
                                featuredComingSoonProduct
                              )}
                            </p>
                          </div>

                          <div className="rounded-3xl border border-amber-200/15 bg-gradient-to-br from-amber-200/[0.10] to-cyan-300/[0.045] p-5 md:col-span-2">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/65">
                              Suspenso intencional
                            </p>
                            <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-300">
                              La idea aún no se muestra completa porque primero
                              queremos saber si esta necesidad también es tuya.
                              Si la comunidad responde, IMNOVA la convierte en
                              desarrollo real.
                            </p>
                          </div>
                        </div>
                      </div>

                      <aside className="rounded-[28px] border border-white/10 bg-black/30 p-5">
                        <p className="text-[10px] uppercase tracking-[0.24em] text-cyan-100/55">
                          Evidencia en tiempo real
                        </p>

                        <div className="mt-5 grid gap-3">
                          <div className="rounded-2xl border border-amber-200/10 bg-amber-200/[0.045] p-4">
                            <p className="text-[9px] uppercase tracking-[0.18em] text-amber-100/55">
                              Encuesta
                            </p>
                            <p className="mt-2 text-sm font-black text-amber-50">
                              {getSurveySummary(
                                featuredComingSoonProduct
                              )}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              {getSurveyDetail(
                                featuredComingSoonProduct
                              )}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="rounded-full border border-amber-200/15 bg-black/25 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-amber-100/75">
                                {getSurveyStatusLabel(
                                  featuredComingSoonProduct
                                )}
                              </span>
                              {getSurveyScore(
                                featuredComingSoonProduct
                              ) !== null && (
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-zinc-300">
                                  {formatSurveyScore(
                                    getSurveyScore(
                                      featuredComingSoonProduct
                                    ) || 0
                                  )}{" "}
                                  interés positivo
                                </span>
                              )}
                              {getSurveyVotes(
                                featuredComingSoonProduct
                              ) !== null && (
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-zinc-300">
                                  {getSurveyVotes(
                                    featuredComingSoonProduct
                                  )}{" "}
                                  respuestas registradas
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-cyan-200/10 bg-cyan-300/[0.045] p-4">
                            <p className="text-[9px] uppercase tracking-[0.18em] text-cyan-100/55">
                              Redes y canales
                            </p>
                            <p className="mt-2 text-sm font-black text-cyan-50">
                              {getSocialSignalSummary(
                                featuredComingSoonProduct
                              )}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              {getSocialSignalDetail(
                                featuredComingSoonProduct
                              )}
                            </p>
                          </div>

                          <div
                            className={getDecisionCardClassName(
                              featuredComingSoonProduct
                            )}
                          >
                            <p
                              className={getDecisionTitleClassName(
                                featuredComingSoonProduct
                              )}
                            >
                              Decisión comunitaria
                            </p>
                            <p
                              className={getDecisionTextClassName(
                                featuredComingSoonProduct
                              )}
                            >
                              {getDecisionText(
                                featuredComingSoonProduct
                              )}
                            </p>
                            <p
                              className={getDecisionBadgeClassName(
                                featuredComingSoonProduct
                              )}
                            >
                              {getValidationStatusLabel(
                                featuredComingSoonProduct
                              )}
                            </p>
                          </div>
                        </div>
                      </aside>
                    </div>

                    <div className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025] p-5">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/65">
                        Qué pasa después de participar
                      </p>
                      <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">
                        Si la necesidad conecta con suficientes personas, la
                        idea entra al proceso oficial de IMNOVA. Si las señales
                        son débiles, se ajusta, se pausa o se descarta antes de
                        invertir en desarrollo.
                      </p>

                      <div
                        className={
                          featuredValidationDidNotProsper
                            ? "mt-4 inline-flex items-center gap-3 rounded-2xl border border-amber-200/20 bg-amber-200/[0.08] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100"
                            : "mt-4 inline-flex items-center gap-3 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.08] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100"
                        }
                      >
                        {featuredValidationDidNotProsper ? (
                          <Clock3 className="h-4 w-4" />
                        ) : (
                          <Rocket className="h-4 w-4" />
                        )}
                        {featuredRouteProgressLabel}
                      </div>

                      <div className="relative mt-6 overflow-x-auto pb-3 [scrollbar-width:thin] [scrollbar-color:rgba(251,191,36,0.45)_rgba(255,255,255,0.08)] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-amber-200/45 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-white/10">
                        <div className="relative min-w-[1220px] pt-12">
                          <div className="absolute left-0 right-0 top-[68px] h-1 rounded-full bg-white/10" />
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
                            className={
                              featuredValidationDidNotProsper
                                ? "absolute left-0 top-[68px] h-1 rounded-full bg-gradient-to-r from-amber-200 via-orange-300 to-red-300"
                                : "absolute left-0 top-[68px] h-1 rounded-full bg-gradient-to-r from-amber-200 via-cyan-200 to-emerald-200"
                            }
                          />

                          <motion.div
                            initial={{
                              left: "0%",
                              opacity: 0,
                              scale: 0.82,
                            }}
                            whileInView={{
                              left:
                                `calc(${getOfficialFlowPercent(
                                  featuredComingSoonProduct.status
                                )} - 22px)`,
                              opacity: 1,
                              scale: 1,
                            }}
                            transition={{
                              duration: 1.25,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            viewport={{ once: true }}
                            className={
                              featuredValidationDidNotProsper
                                ? "absolute top-[43px] z-20 flex h-11 w-11 items-center justify-center rounded-full border border-amber-200/50 bg-amber-200/[0.14] text-amber-50 shadow-[0_0_34px_rgba(251,191,36,0.24)]"
                                : "absolute top-[43px] z-20 flex h-11 w-11 items-center justify-center rounded-full border border-cyan-100/60 bg-cyan-300/[0.16] text-cyan-50 shadow-[0_0_38px_rgba(34,211,238,0.34)]"
                            }
                            aria-label={featuredRouteProgressLabel}
                          >
                            {!featuredValidationDidNotProsper && (
                              <span className="absolute inset-[-10px] rounded-full border border-cyan-200/25 opacity-60 animate-ping" />
                            )}
                            <span className="absolute inset-0 rounded-full bg-white/[0.06]" />
                            <motion.span
                              animate={
                                featuredValidationDidNotProsper
                                  ? {
                                      rotate: [
                                        -4,
                                        4,
                                        -4,
                                      ],
                                    }
                                  : {
                                      x: [
                                        -1,
                                        3,
                                        -1,
                                      ],
                                      y: [
                                        0,
                                        -2,
                                        0,
                                      ],
                                    }
                              }
                              transition={{
                                duration:
                                  featuredValidationDidNotProsper
                                    ? 1.4
                                    : 1.8,
                                repeat: Infinity,
                                ease: "easeInOut",
                              }}
                              className="relative z-10"
                            >
                              {featuredValidationDidNotProsper ? (
                                <Clock3 className="h-5 w-5" />
                              ) : (
                                <Rocket className="h-5 w-5 rotate-45" />
                              )}
                            </motion.span>
                          </motion.div>

                          <div className="relative grid grid-cols-8 gap-5">
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
                                          ? "mt-3 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.08em] text-cyan-100"
                                          : "mt-3 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
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

                <aside className="grid content-start gap-4">
                  <div className="rounded-[24px] border border-white/10 bg-black/35 p-5 text-left backdrop-blur-xl">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-amber-100/55">
                      Backlog de ideas vivas
                    </p>
                    <h4 className="mt-3 text-2xl font-black text-white">
                      Otras hipótesis en observación
                    </h4>
                    <p className="mt-3 text-xs leading-6 text-zinc-500">
                      Mostramos pocas para mantener foco. El resto permanece
                      conectado a la data y puede avanzar cuando la comunidad
                      muestre interés real.
                    </p>
                  </div>

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

                        <h4 className="mt-4 text-lg font-black leading-tight text-white">
                          {product.name}
                        </h4>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {getProductNiches(product).map(niche => (
                            <span
                              key={niche}
                              className="rounded-full border border-cyan-200/15 bg-cyan-300/[0.06] px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] text-cyan-100"
                            >
                              {niche}
                            </span>
                          ))}
                        </div>

                        <p className="mt-4 line-clamp-2 text-xs leading-5 text-zinc-500">
                          {getPopulationProblem(product)}
                        </p>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <div className="rounded-2xl border border-amber-200/10 bg-amber-200/[0.045] px-3 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-amber-100/55">
                              Encuesta
                            </p>
                            <p className="mt-2 text-xs font-black text-amber-50">
                              {getSurveySummary(product)}
                            </p>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3 py-3">
                            <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                              Señales sociales
                            </p>
                            <p className="mt-2 text-xs font-black text-zinc-300">
                              {getSocialSignalSummary(product)}
                            </p>
                          </div>
                        </div>
                      </motion.article>
                    )
                  )}

                  {hiddenComingSoonProductsCount > 0 && (
                    <div className="rounded-[24px] border border-cyan-200/15 bg-cyan-300/[0.045] p-5 text-center">
                      <p className="text-3xl font-black text-cyan-50">
                        +{hiddenComingSoonProductsCount}
                      </p>
                      <p className="mt-2 text-[10px] uppercase tracking-[0.22em] text-cyan-100/65">
                        ideas más bajo lectura comunitaria
                      </p>
                    </div>
                  )}
                </aside>
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
