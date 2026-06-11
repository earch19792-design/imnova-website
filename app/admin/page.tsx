"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import { useRouter } from "next/navigation"

import {
  motion,
} from "framer-motion"

import {
  getProducts,
  getProductStates,
} from "@/lib/products-service"

import { Sidebar } from "@/app/admin/sidebar"
import { Metrics } from "@/app/admin/metrics"

type Product = {
  id: string
  state_id: string | null
  slug?: string
  name: string
  category: string
  commercial_category?: string | null
  strategic_niche_id?: string | null
  primary_subniche_id?: string | null
  target_customer?: string | null
  usage_moment?: string | null
  main_benefit?: string | null
  description?: string
  image_url?: string
  image?: string
  price?: number
  currency?: string
  direct_url?: string
  bullets?: string[]
  featured?: boolean
  survey_score?: number | null
  survey_votes?: number | null
  social_interest_score?: number | null
  survey_status?: string | null
  validation_status?: string | null
  validation_decision?: string | null

  theme?: {
    border: string
    text: string
    bg: string
  }
}

type ProductState = {
  id: string
  name: string
  progress: number
  sort_order?: number
  is_active?: boolean
}

type Campaign = {
  id: number
  name: string
  product: string
  channel: string
  status: string
  leads: number
}

function normalizeValidationValue(
  value?: string | null
) {
  return (
    value || "pendiente"
  )
    .toLowerCase()
    .trim()
}

function getValidNumber(
  value?: number | null
) {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null
}

function getAverage(
  values: Array<number | null>
) {
  const validValues =
    values.filter(
      (value): value is number =>
        value !== null
    )

  if (validValues.length === 0) {
    return null
  }

  const total =
    validValues.reduce(
      (sum, value) =>
        sum + value,
      0
    )

  return Math.round(
    total / validValues.length
  )
}

export default function AdminPage() {

  const router = useRouter()

  const [
    isAuthenticated,
    setIsAuthenticated,
  ] = useState(false)

  const [
    liveProducts,
    setLiveProducts,
  ] = useState<Product[]>([])

  const [
    productStates,
    setProductStates,
  ] = useState<ProductState[]>([])

  const [
    selectedMenu,
    setSelectedMenu,
  ] = useState("dashboard")

  const [
    showCampaignModal,
    setShowCampaignModal,
  ] = useState(false)

  const [
    campaigns,
    setCampaigns,
  ] = useState<Campaign[]>([
    {
      id: 1,
      name: "Mash Coffee TikTok",
      product: "Mash Coffee",
      channel: "TikTok",
      status: "Active",
      leads: 42,
    },
    {
      id: 2,
      name: "Bienes y Raíces Facebook",
      product: "Casas Premium",
      channel: "Facebook",
      status: "Draft",
      leads: 0,
    },
  ])

  const [
    validationIdea,
    setValidationIdea,
  ] = useState("")

  const [
    campaignProduct,
    setCampaignProduct,
  ] = useState("")

  const [
    campaignChannel,
    setCampaignChannel,
  ] = useState("TikTok")

  const [
    campaignBudget,
    setCampaignBudget,
  ] = useState("")

  const [
    campaignType,
    setCampaignType,
  ] = useState("validation")

  const normalizeProduct =
    (product: any): Product => {

      return {
        ...product,

        image:
          product.image ||
          product.image_url ||
          "",

        theme:
          product.theme ?? {
            border: "",
            text: "",
            bg: "",
          },
      }

    }

  const loadAdminData =
    async () => {

      const products =
        await getProducts()

      const states =
        await getProductStates()

      setLiveProducts(
        (products || []).map(
          normalizeProduct
        )
      )

      setProductStates(
        states || []
      )

      console.log(
        "ADMIN PRODUCTS:",
        products
      )

      console.log(
        "PRODUCT STATES:",
        states
      )

    }

  const handleProductUpdate =
    async () => {

      await loadAdminData()

    }

  const createCampaign =
    () => {

      const newCampaign: Campaign = {
        id: Date.now(),

        name:
          campaignType === "validation"
            ? `${validationIdea} ${campaignChannel}`
            : `${campaignProduct} ${campaignChannel}`,

        product:
          campaignType === "validation"
            ? validationIdea
            : campaignProduct,

        channel:
          campaignChannel,

        status:
          "Draft",

        leads:
          0,
      }

      setCampaigns([
        ...campaigns,
        newCampaign,
      ])

      setValidationIdea("")
      setCampaignProduct("")
      setCampaignChannel("TikTok")
      setCampaignBudget("")
      setCampaignType("validation")
      setShowCampaignModal(false)

    }

  useEffect(() => {

    const auth =
      localStorage.getItem(
        "imnova-admin"
      )

    if (
      auth !== "authenticated"
    ) {

      router.push(
        "/admin/login"
      )

      return

    }

    setIsAuthenticated(true)

  }, [router])

  useEffect(() => {

    if (!isAuthenticated) return

    loadAdminData()

  }, [isAuthenticated])

  const handleLogout =
    () => {

      localStorage.removeItem(
        "imnova-admin"
      )

      router.push(
        "/admin/login"
      )

    }

  const stateById =
    useMemo(
      () =>
        new Map<string, ProductState>(
          productStates.map(
            (state) => [
              state.id,
              state,
            ]
          )
        ),
      [productStates]
    )

  const stateCounts =
    useMemo(
      () =>
        liveProducts.reduce<Record<string, number>>(
          (
            counts,
            product
          ) => {

            if (!product.state_id) {
              return counts
            }

            counts[product.state_id] =
              (
                counts[product.state_id] ||
                0
              ) + 1

            return counts

          },
          {}
        ),
      [liveProducts]
    )

  const stateSummaries =
    useMemo(
      () =>
        productStates.map(
          (state) => {

            const count =
              stateCounts[state.id] ||
              0

            const share =
              liveProducts.length > 0
                ? Math.round(
                    (
                      count /
                      liveProducts.length
                    ) * 100
                  )
                : 0

            return {
              ...state,
              count,
              share,
            }

          }
        ),
      [
        liveProducts.length,
        productStates,
        stateCounts,
      ]
    )

  const validationSummary =
    useMemo(
      () => {
        const surveyScores =
          liveProducts.map(
            (product) =>
              getValidNumber(
                product.survey_score
              )
          )

        const socialScores =
          liveProducts.map(
            (product) =>
              getValidNumber(
                product.social_interest_score
              )
          )

        const totalVotes =
          liveProducts.reduce(
            (total, product) => {
              const votes =
                getValidNumber(
                  product.survey_votes
                )

              return total + (votes || 0)
            },
            0
          )

        const hasValidationData =
          liveProducts.some(
            (product) => {
              const decision =
                normalizeValidationValue(
                  product.validation_decision
                )

              const status =
                normalizeValidationValue(
                  product.validation_status
                )

              const surveyStatus =
                normalizeValidationValue(
                  product.survey_status
                )

              return (
                decision !== "pendiente" ||
                status !== "pendiente" ||
                surveyStatus !== "pendiente" ||
                getValidNumber(
                  product.survey_score
                ) !== null ||
                getValidNumber(
                  product.social_interest_score
                ) !== null ||
                (getValidNumber(
                  product.survey_votes
                ) || 0) > 0
              )
            }
          )

        return {
          pendingDecision:
            liveProducts.filter(
              (product) =>
                normalizeValidationValue(
                  product.validation_decision
                ) === "pendiente"
            ).length,
          readyToAdvance:
            liveProducts.filter(
              (product) =>
                normalizeValidationValue(
                  product.validation_decision
                ) === "avanzar"
            ).length,
          needsAdjustment:
            liveProducts.filter(
              (product) =>
                normalizeValidationValue(
                  product.validation_decision
                ) === "ajustar"
            ).length,
          paused:
            liveProducts.filter(
              (product) =>
                normalizeValidationValue(
                  product.validation_decision
                ) === "pausar"
            ).length,
          discarded:
            liveProducts.filter(
              (product) =>
                normalizeValidationValue(
                  product.validation_decision
                ) === "descartar"
            ).length,
          highInterest:
            liveProducts.filter(
              (product) =>
                normalizeValidationValue(
                  product.validation_status
                ) === "interes_alto"
            ).length,
          activeSurveys:
            liveProducts.filter(
              (product) =>
                normalizeValidationValue(
                  product.survey_status
                ) === "activa"
            ).length,
          averageSurveyScore:
            getAverage(surveyScores),
          averageSocialScore:
            getAverage(socialScores),
          totalVotes,
          hasValidationData,
        }
      },
      [liveProducts]
    )

  const validationCards =
    [
      {
        label: "Pendientes",
        value:
          validationSummary.pendingDecision,
      },
      {
        label: "Avanzar",
        value:
          validationSummary.readyToAdvance,
      },
      {
        label: "Ajustar",
        value:
          validationSummary.needsAdjustment,
      },
      {
        label: "Pausadas",
        value:
          validationSummary.paused,
      },
      {
        label: "Interes alto",
        value:
          validationSummary.highInterest,
      },
      {
        label: "Encuestas activas",
        value:
          validationSummary.activeSurveys,
      },
      {
        label: "Interes promedio",
        value:
          validationSummary.averageSurveyScore ===
          null
            ? "N/A"
            : `${validationSummary.averageSurveyScore}%`,
      },
      {
        label: "Respuestas",
        value:
          validationSummary.totalVotes,
      },
    ]

  const validationActionGroups =
    useMemo(
      () => {
        const sortActionProducts =
          (products: Product[]) =>
            [...products]
              .sort(
                (
                  productA,
                  productB
                ) => {
                  const scoreA =
                    getValidNumber(
                      productA.survey_score
                    ) || 0

                  const scoreB =
                    getValidNumber(
                      productB.survey_score
                    ) || 0

                  const votesA =
                    getValidNumber(
                      productA.survey_votes
                    ) || 0

                  const votesB =
                    getValidNumber(
                      productB.survey_votes
                    ) || 0

                  return (
                    scoreB - scoreA ||
                    votesB - votesA ||
                    productA.name.localeCompare(
                      productB.name
                    )
                  )
                }
              )
              .slice(0, 3)

        return [
          {
            title:
              "Listos para avanzar",
            description:
              "Revisar siguiente etapa operativa.",
            accentClassName:
              "border-emerald-200/20 bg-emerald-200/[0.045]",
            products:
              sortActionProducts(
                liveProducts.filter(
                  (product) =>
                    normalizeValidationValue(
                      product.validation_decision
                    ) === "avanzar"
                )
              ),
          },
          {
            title:
              "Pendientes de decision",
            description:
              "Necesitan lectura o cierre estrategico.",
            accentClassName:
              "border-amber-200/20 bg-amber-200/[0.045]",
            products:
              sortActionProducts(
                liveProducts.filter(
                  (product) =>
                    normalizeValidationValue(
                      product.validation_decision
                    ) === "pendiente"
                )
              ),
          },
          {
            title:
              "Requieren ajuste",
            description:
              "Revisar propuesta antes de avanzar.",
            accentClassName:
              "border-cyan-200/20 bg-cyan-200/[0.04]",
            products:
              sortActionProducts(
                liveProducts.filter(
                  (product) =>
                    normalizeValidationValue(
                      product.validation_decision
                    ) === "ajustar"
                )
              ),
          },
        ]
      },
      [liveProducts]
    )

  const dashboardProducts =
    useMemo(
      () =>
        [...liveProducts]
          .sort(
            (
              productA,
              productB
            ) => {

              const featuredScore =
                Number(
                  Boolean(
                    productB.featured
                  )
                ) -
                Number(
                  Boolean(
                    productA.featured
                  )
                )

              if (featuredScore !== 0) {
                return featuredScore
              }

              const progressA =
                stateById.get(
                  productA.state_id ||
                    ""
                )?.progress || 0

              const progressB =
                stateById.get(
                  productB.state_id ||
                    ""
                )?.progress || 0

              return (
                progressB -
                  progressA ||
                productA.name.localeCompare(
                  productB.name
                )
              )

            }
          )
          .slice(
            0,
            6
          ),
      [
        liveProducts,
        stateById,
      ]
    )

  const productsWithoutState =
    liveProducts.filter(
      (product) =>
        !product.state_id
    ).length

  const productsWithoutSlug =
    liveProducts.filter(
      (product) =>
        !product.slug
    ).length

  const activeCampaigns =
    campaigns.filter(
      (campaign) =>
        campaign.status ===
        "Active"
    ).length

  if (!isAuthenticated) {

    return (

      <div
        className="
          min-h-screen
          bg-black
        "
      />

    )

  }

  return (

    <main
      className="
        relative
        min-h-screen
        overflow-hidden
        bg-black
        text-white
      "
    >

      <div className="fixed inset-0 bg-black" />

      <motion.div
        animate={{
          opacity: [0.4, 0.7, 0.4],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          pointer-events-none
          fixed
          left-1/2
          top-0
          h-[900px]
          w-[900px]
          -translate-x-1/2
          rounded-full
          bg-white/[0.03]
          blur-[180px]
        "
      />

      <div
        className="
          pointer-events-none
          fixed
          inset-0
          opacity-[0.015]
          bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
          bg-[size:60px_60px]
        "
      />

      <Sidebar
        selectedMenu={selectedMenu}
        setSelectedMenu={setSelectedMenu}
      />

      <motion.div
        initial={{
          opacity: 0,
          y: 20,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        transition={{
          duration: 1,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="
          relative
          z-10
          ml-0
          lg:ml-[280px]
          px-4
          sm:px-6
          lg:px-10
          py-6
          lg:py-10
        "
      >

        <div
          className="
            flex
            flex-col
            lg:flex-row
            lg:items-start
            lg:justify-between
            gap-6
            lg:gap-10
          "
        >

          <div>

            <div
              className="
                inline-flex
                items-center
                gap-3
                rounded-full
                border
                border-white/10
                bg-white/[0.03]
                px-5
                py-3
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/60
                backdrop-blur-md
              "
            >
              IMNOVA LABS • CORE SYSTEM
            </div>

            <h1
              className="
                mt-8
                text-7xl
                font-black
                leading-none
                tracking-[-0.06em]
                text-white
              "
            >
              {
                selectedMenu === "dashboard"
                  ? "IMNOVA Admin"
                  : selectedMenu === "products"
                  ? "Productos"
                  : selectedMenu === "campaigns"
                  ? "Campañas"
                  : selectedMenu === "analytics"
                  ? "Analytics"
                  : "IMNOVA"
              }
            </h1>

            <p
              className="
                mt-8
                max-w-4xl
                text-2xl
                text-white/50
              "
            >
              {
                selectedMenu === "dashboard"
                  ? "Centro de control para productos, estados, validación y comercialización."
                  : selectedMenu === "products"
                  ? "Gestión centralizada de productos y proyectos."
                  : selectedMenu === "campaigns"
                  ? "Centro de gestión de campañas y generación de leads."
                  : selectedMenu === "analytics"
                  ? "Métricas, rendimiento y crecimiento del ecosistema."
                  : "IMNOVA OS"
              }
            </p>

            <div
              className="
                mt-10
                flex
                flex-wrap
                gap-4
              "
            >

              <button
                onClick={() =>
                  router.push("/")
                }
                className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-white
                  px-7
                  py-4
                  text-sm
                  font-semibold
                  text-black
                  transition-all
                  duration-300
                  hover:scale-[1.02]
                  hover:bg-zinc-200
                "
              >
                Regresar al Sitio
              </button>

              <button
                onClick={handleLogout}
                className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-white/[0.03]
                  px-7
                  py-4
                  text-sm
                  font-semibold
                  text-white
                  backdrop-blur-md
                  transition-all
                  duration-300
                  hover:bg-white/[0.06]
                  hover:border-white/20
                "
              >
                Cerrar Sesión
              </button>

            </div>

          </div>

          <motion.div
            animate={{
              y: [-4, 4, -4],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="
              relative
              overflow-hidden
              rounded-[32px]
              border
              border-white/10
              bg-white/[0.03]
              px-8
              py-7
              backdrop-blur-md
            "
          >

            <div
              className="
                absolute
                inset-0
                bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
              "
            />

            <div className="relative z-10">

              <p
                className="
                  text-[10px]
                  uppercase
                  tracking-[0.35em]
                  text-white/40
                "
              >
                SYSTEM STATUS
              </p>

              <div
                className="
                  mt-5
                  flex
                  items-center
                  gap-4
                "
              >

                <div
                  className="
                    h-3
                    w-3
                    rounded-full
                    bg-green-400
                    shadow-[0_0_15px_rgba(74,222,128,0.7)]
                  "
                />

                <p
                  className="
                    text-lg
                    font-semibold
                    text-white
                  "
                >
                  IMNOVA CORE ACTIVE
                </p>

              </div>

            </div>

          </motion.div>

        </div>

        {
          selectedMenu === "dashboard" && (

            <>

              <div className="mt-16">
                <Metrics
                 products={liveProducts}
                states={productStates}
                   />
              </div>

              <section
                className="
                  mt-8
                  rounded-[34px]
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-8
                  backdrop-blur-md
                "
              >

                <div
                  className="
                    flex
                    flex-col
                    gap-4
                    lg:flex-row
                    lg:items-start
                    lg:justify-between
                  "
                >

                  <div>

                    <p
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.35em]
                        text-amber-200/60
                      "
                    >
                      Validacion comunitaria
                    </p>

                    <h2
                      className="
                        mt-4
                        text-4xl
                        font-black
                        tracking-[-0.04em]
                        text-white
                      "
                    >
                      Senales antes de avanzar
                    </h2>

                    <p
                      className="
                        mt-4
                        max-w-3xl
                        text-sm
                        leading-6
                        text-white/50
                      "
                    >
                      Resumen de decisiones, encuestas y senales de interes
                      antes de avanzar productos.
                    </p>

                  </div>

                  <div
                    className="
                      rounded-2xl
                      border
                      border-cyan-300/15
                      bg-cyan-300/[0.05]
                      px-5
                      py-4
                      text-right
                    "
                  >
                    <p
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.25em]
                        text-cyan-100/60
                      "
                    >
                      Senal social promedio
                    </p>

                    <p
                      className="
                        mt-2
                        text-3xl
                        font-black
                        text-cyan-100
                      "
                    >
                      {
                        validationSummary.averageSocialScore ===
                        null
                          ? "N/A"
                          : `${validationSummary.averageSocialScore}%`
                      }
                    </p>
                  </div>

                </div>

                {
                  liveProducts.length === 0 ? (

                    <p
                      className="
                        mt-6
                        rounded-2xl
                        border
                        border-white/10
                        bg-black/20
                        p-5
                        text-sm
                        leading-6
                        text-white/50
                      "
                    >
                      No hay datos de validacion comunitaria todavia.
                    </p>

                  ) : (

                    <>

                      {
                        !validationSummary.hasValidationData && (

                          <p
                            className="
                              mt-6
                              rounded-2xl
                              border
                              border-white/10
                              bg-black/20
                              p-5
                              text-sm
                              leading-6
                              text-white/50
                            "
                          >
                            Cuando registres encuestas, respuestas o senales
                            sociales, el resumen aparecera aqui.
                          </p>

                        )
                      }

                      <div
                        className="
                          mt-6
                          grid
                          gap-4
                          sm:grid-cols-2
                          lg:grid-cols-4
                        "
                      >

                        {
                          validationCards.map(
                            (item) => (

                              <div
                                key={item.label}
                                className="
                                  rounded-2xl
                                  border
                                  border-white/10
                                  bg-black/20
                                  p-5
                                "
                              >
                                <p
                                  className="
                                    text-[10px]
                                    uppercase
                                    tracking-[0.22em]
                                    text-white/35
                                  "
                                >
                                  {item.label}
                                </p>

                                <p
                                  className="
                                    mt-3
                                    text-3xl
                                    font-black
                                    text-white
                                  "
                                >
                                  {item.value}
                                </p>
                              </div>

                            )
                          )
                        }

                      </div>

                      <div
                        className="
                          mt-6
                          grid
                          gap-4
                          lg:grid-cols-3
                        "
                      >

                        {
                          validationSummary.readyToAdvance > 0 && (

                            <p
                              className="
                                rounded-2xl
                                border
                                border-emerald-200/20
                                bg-emerald-200/[0.06]
                                p-4
                                text-sm
                                leading-6
                                text-emerald-100
                              "
                            >
                              Hay productos listos para revision de avance.
                            </p>

                          )
                        }

                        {
                          validationSummary.pendingDecision > 0 && (

                            <p
                              className="
                                rounded-2xl
                                border
                                border-amber-200/20
                                bg-amber-200/[0.06]
                                p-4
                                text-sm
                                leading-6
                                text-amber-100
                              "
                            >
                              Hay productos pendientes de decision.
                            </p>

                          )
                        }

                        <p
                          className="
                            rounded-2xl
                            border
                            border-white/10
                            bg-black/20
                            p-4
                            text-sm
                            leading-6
                            text-white/45
                          "
                        >
                          Descartadas: {validationSummary.discarded}
                        </p>

                      </div>

                      <div
                        className="
                          mt-6
                          grid
                          gap-5
                          xl:grid-cols-3
                        "
                      >

                        {
                          validationActionGroups.map(
                            (group) => (

                              <div
                                key={group.title}
                                className={`
                                  rounded-[28px]
                                  border
                                  p-5
                                  ${group.accentClassName}
                                `}
                              >

                                <p
                                  className="
                                    text-[10px]
                                    uppercase
                                    tracking-[0.24em]
                                    text-white/40
                                  "
                                >
                                  Accion
                                </p>

                                <h3
                                  className="
                                    mt-3
                                    text-2xl
                                    font-black
                                    tracking-[-0.03em]
                                    text-white
                                  "
                                >
                                  {group.title}
                                </h3>

                                <p
                                  className="
                                    mt-2
                                    text-sm
                                    leading-6
                                    text-white/45
                                  "
                                >
                                  {group.description}
                                </p>

                                <div className="mt-5 space-y-3">

                                  {
                                    group.products.length === 0 ? (

                                      <p
                                        className="
                                          rounded-2xl
                                          border
                                          border-white/10
                                          bg-black/20
                                          p-4
                                          text-sm
                                          text-white/40
                                        "
                                      >
                                        Sin productos en este grupo.
                                      </p>

                                    ) : (

                                      group.products.map(
                                        (product) => {
                                          const state =
                                            stateById.get(
                                              product.state_id ||
                                                ""
                                            )

                                          const score =
                                            getValidNumber(
                                              product.survey_score
                                            )

                                          const votes =
                                            getValidNumber(
                                              product.survey_votes
                                            ) || 0

                                          const decision =
                                            normalizeValidationValue(
                                              product.validation_decision
                                            )

                                          return (

                                            <div
                                              key={product.id}
                                              className="
                                                rounded-2xl
                                                border
                                                border-white/10
                                                bg-black/25
                                                p-4
                                              "
                                            >

                                              <div
                                                className="
                                                  flex
                                                  items-start
                                                  justify-between
                                                  gap-4
                                                "
                                              >

                                                <div className="min-w-0">
                                                  <h4
                                                    className="
                                                      truncate
                                                      text-lg
                                                      font-black
                                                      text-white
                                                    "
                                                  >
                                                    {product.name}
                                                  </h4>

                                                  <p
                                                    className="
                                                      mt-2
                                                      text-[10px]
                                                      uppercase
                                                      tracking-[0.20em]
                                                      text-white/35
                                                    "
                                                  >
                                                    {state?.name || "Sin estado"}
                                                  </p>
                                                </div>

                                                <span
                                                  className="
                                                    rounded-full
                                                    border
                                                    border-white/10
                                                    px-3
                                                    py-1
                                                    text-[10px]
                                                    uppercase
                                                    tracking-[0.16em]
                                                    text-white/50
                                                  "
                                                >
                                                  {decision}
                                                </span>

                                              </div>

                                              <p
                                                className="
                                                  mt-3
                                                  text-sm
                                                  leading-6
                                                  text-white/50
                                                "
                                              >
                                                Interes {score === null ? "N/A" : `${score}%`} · {votes} respuestas
                                              </p>

                                              <button
                                                type="button"
                                                disabled={!product.slug}
                                                onClick={() => {
                                                  if (!product.slug) return

                                                  router.push(
                                                    `/admin/products/${product.slug}`
                                                  )
                                                }}
                                                className="
                                                  mt-4
                                                  rounded-xl
                                                  border
                                                  border-cyan-400/20
                                                  bg-cyan-400/10
                                                  px-4
                                                  py-2
                                                  text-xs
                                                  font-semibold
                                                  text-cyan-200
                                                  transition-all
                                                  duration-300
                                                  hover:bg-cyan-400/20
                                                  disabled:cursor-not-allowed
                                                  disabled:border-white/5
                                                  disabled:bg-white/[0.02]
                                                  disabled:text-white/25
                                                "
                                              >
                                                Ver detalle
                                              </button>

                                            </div>

                                          )
                                        }
                                      )

                                    )
                                  }

                                </div>

                              </div>

                            )
                          )
                        }

                      </div>

                    </>

                  )
                }

              </section>

              {
                liveProducts.length === 0 ? (

                  <div
                    className="
                      mt-12
                      rounded-[34px]
                      border
                      border-white/10
                      bg-white/[0.03]
                      p-8
                      backdrop-blur-md
                    "
                  >

                    <p
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.35em]
                        text-cyan-300/60
                      "
                    >
                      Ecosistema
                    </p>

                    <h2
                      className="
                        mt-4
                        text-4xl
                        font-black
                        tracking-[-0.04em]
                        text-white
                      "
                    >
                      Todavía no hay productos registrados.
                    </h2>

                    <p
                      className="
                        mt-4
                        max-w-3xl
                        text-lg
                        leading-8
                        text-white/50
                      "
                    >
                      Cuando agregues productos, aparecerán aquí organizados por estado.
                    </p>

                  </div>

                ) : (

                  <>

                    <section
                      className="
                        mt-12
                        grid
                        gap-8
                        xl:grid-cols-[1.35fr_0.65fr]
                      "
                    >

                      <div
                        className="
                          rounded-[34px]
                          border
                          border-white/10
                          bg-white/[0.03]
                          p-8
                          backdrop-blur-md
                        "
                      >

                        <div
                          className="
                            flex
                            flex-col
                            gap-4
                            sm:flex-row
                            sm:items-end
                            sm:justify-between
                          "
                        >

                          <div>

                            <p
                              className="
                                text-[10px]
                                uppercase
                                tracking-[0.35em]
                                text-cyan-300/60
                              "
                            >
                              Resumen por estados
                            </p>

                            <h2
                              className="
                                mt-4
                                text-4xl
                                font-black
                                tracking-[-0.04em]
                                text-white
                              "
                            >
                              Ruta operativa
                            </h2>

                          </div>

                          <p
                            className="
                              text-sm
                              uppercase
                              tracking-[0.22em]
                              text-white/35
                            "
                          >
                            {liveProducts.length} productos
                          </p>

                        </div>

                        <div className="mt-8 space-y-5">

                          {
                            stateSummaries.map(
                              (state) => (

                                <div
                                  key={state.id}
                                  className="
                                    border-b
                                    border-white/10
                                    pb-5
                                    last:border-b-0
                                    last:pb-0
                                  "
                                >

                                  <div
                                    className="
                                      flex
                                      items-center
                                      justify-between
                                      gap-4
                                    "
                                  >

                                    <div>

                                      <h3
                                        className="
                                          text-lg
                                          font-semibold
                                          text-white
                                        "
                                      >
                                        {state.name}
                                      </h3>

                                      <p
                                        className="
                                          mt-1
                                          text-xs
                                          uppercase
                                          tracking-[0.22em]
                                          text-white/35
                                        "
                                      >
                                        {state.share}% del ecosistema
                                      </p>

                                    </div>

                                    <div className="text-right">

                                      <p
                                        className="
                                          text-3xl
                                          font-black
                                          text-cyan-200
                                        "
                                      >
                                        {state.count}
                                      </p>

                                      <p
                                        className="
                                          text-[10px]
                                          uppercase
                                          tracking-[0.22em]
                                          text-white/35
                                        "
                                      >
                                        prod.
                                      </p>

                                    </div>

                                  </div>

                                  <div
                                    className="
                                      mt-4
                                      h-[6px]
                                      overflow-hidden
                                      rounded-full
                                      bg-white/5
                                    "
                                  >

                                    <div
                                      className="
                                        h-full
                                        rounded-full
                                        bg-cyan-300
                                      "
                                      style={{
                                        width:
                                          `${state.progress}%`,
                                      }}
                                    />

                                  </div>

                                </div>

                              )
                            )
                          }

                        </div>

                      </div>

                      <div className="space-y-8">

                        <div
                          className="
                            rounded-[34px]
                            border
                            border-white/10
                            bg-white/[0.03]
                            p-8
                            backdrop-blur-md
                          "
                        >

                          <p
                            className="
                              text-[10px]
                              uppercase
                              tracking-[0.35em]
                              text-cyan-300/60
                            "
                          >
                            Accesos rápidos
                          </p>

                          <div className="mt-6 grid gap-3">

                            <button
                              type="button"
                              onClick={() =>
                                setSelectedMenu("products")
                              }
                              className="
                                rounded-2xl
                                border
                                border-white/10
                                bg-white
                                px-5
                                py-4
                                text-left
                                text-sm
                                font-semibold
                                text-black
                                transition-all
                                duration-300
                                hover:scale-[1.01]
                                hover:bg-zinc-200
                              "
                            >
                              Ver productos
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedMenu("campaigns")
                                setShowCampaignModal(true)
                              }}
                              className="
                                rounded-2xl
                                border
                                border-cyan-400/20
                                bg-cyan-400/10
                                px-5
                                py-4
                                text-left
                                text-sm
                                font-semibold
                                text-cyan-200
                                transition-all
                                duration-300
                                hover:bg-cyan-400/20
                              "
                            >
                              Crear campaña
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                router.push("/store")
                              }
                              className="
                                rounded-2xl
                                border
                                border-white/10
                                bg-white/[0.04]
                                px-5
                                py-4
                                text-left
                                text-sm
                                font-semibold
                                text-white
                                transition-all
                                duration-300
                                hover:bg-white/[0.07]
                              "
                            >
                              Ver tienda
                            </button>

                            <button
                              type="button"
                              disabled
                              className="
                                cursor-not-allowed
                                rounded-2xl
                                border
                                border-white/5
                                bg-white/[0.02]
                                px-5
                                py-4
                                text-left
                                text-sm
                                font-semibold
                                text-white/30
                              "
                            >
                              Revisar comunidad · Próximamente
                            </button>

                          </div>

                        </div>

                        <div
                          className="
                            rounded-[34px]
                            border
                            border-white/10
                            bg-white/[0.03]
                            p-8
                            backdrop-blur-md
                          "
                        >

                          <p
                            className="
                              text-[10px]
                              uppercase
                              tracking-[0.35em]
                              text-amber-200/60
                            "
                          >
                            Alertas o pendientes
                          </p>

                          <div className="mt-6 space-y-4">

                            {[
                              {
                                label:
                                  "Productos sin estado",
                                value:
                                  productsWithoutState,
                              },
                              {
                                label:
                                  "Productos sin ruta",
                                value:
                                  productsWithoutSlug,
                              },
                              {
                                label:
                                  "Campañas activas",
                                value:
                                  activeCampaigns,
                              },
                            ].map(
                              (item) => (

                                <div
                                  key={item.label}
                                  className="
                                    flex
                                    items-center
                                    justify-between
                                    gap-4
                                    border-b
                                    border-white/10
                                    pb-4
                                    last:border-b-0
                                    last:pb-0
                                  "
                                >

                                  <span className="text-sm text-white/50">
                                    {item.label}
                                  </span>

                                  <span
                                    className="
                                      text-2xl
                                      font-black
                                      text-white
                                    "
                                  >
                                    {item.value}
                                  </span>

                                </div>

                              )
                            )}

                          </div>

                        </div>

                      </div>

                    </section>

                    <section className="mt-12 pb-20">

                      <div
                        className="
                          mb-8
                          flex
                          flex-col
                          gap-4
                          sm:flex-row
                          sm:items-end
                          sm:justify-between
                        "
                      >

                        <div>

                          <p
                            className="
                              text-[10px]
                              uppercase
                              tracking-[0.35em]
                              text-white/35
                            "
                          >
                            Productos recientes / prioritarios
                          </p>

                          <h2
                            className="
                              mt-4
                              text-4xl
                              font-black
                              tracking-[-0.04em]
                              text-white
                            "
                          >
                            Vista rápida
                          </h2>

                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setSelectedMenu("products")
                          }
                          className="
                            rounded-2xl
                            border
                            border-white/10
                            bg-white/[0.04]
                            px-5
                            py-3
                            text-sm
                            font-semibold
                            text-white
                            transition-all
                            duration-300
                            hover:bg-white/[0.07]
                          "
                        >
                          Ver todos
                        </button>

                      </div>

                      <div
                        className="
                          grid
                          grid-cols-1
                          gap-6
                          lg:grid-cols-2
                          2xl:grid-cols-3
                        "
                      >

                        {
                          dashboardProducts.map(
                            (product) => {

                              const state =
                                stateById.get(
                                  product.state_id ||
                                    ""
                                )

                              const image =
                                product.image_url ||
                                product.image ||
                                ""

                              return (

                                <motion.div
                                  key={product.id}
                                  initial={{
                                    opacity: 0,
                                    y: 20,
                                  }}
                                  animate={{
                                    opacity: 1,
                                    y: 0,
                                  }}
                                  transition={{
                                    duration: 0.45,
                                  }}
                                  className="
                                    rounded-[28px]
                                    border
                                    border-white/10
                                    bg-white/[0.03]
                                    p-5
                                    backdrop-blur-md
                                  "
                                >

                                  <div
                                    className="
                                      flex
                                      gap-4
                                    "
                                  >

                                    <div
                                      className="
                                        flex
                                        h-20
                                        w-20
                                        shrink-0
                                        items-center
                                        justify-center
                                        overflow-hidden
                                        rounded-2xl
                                        border
                                        border-white/10
                                        bg-black/35
                                      "
                                    >
                                      {
                                        image ? (
                                          <img
                                            src={image}
                                            alt={product.name}
                                            className="
                                              h-full
                                              w-full
                                              object-cover
                                            "
                                          />
                                        ) : (
                                          <span
                                            className="
                                              text-xs
                                              font-black
                                              text-cyan-200
                                            "
                                          >
                                            IM
                                          </span>
                                        )
                                      }
                                    </div>

                                    <div className="min-w-0 flex-1">

                                      <p
                                        className="
                                          text-[10px]
                                          uppercase
                                          tracking-[0.25em]
                                          text-cyan-300/60
                                        "
                                      >
                                        {state?.name || "Sin estado"}
                                      </p>

                                      <h3
                                        className="
                                          mt-2
                                          truncate
                                          text-2xl
                                          font-black
                                          tracking-[-0.03em]
                                          text-white
                                        "
                                      >
                                        {product.name}
                                      </h3>

                                      <p
                                        className="
                                          mt-2
                                          truncate
                                          text-sm
                                          text-white/40
                                        "
                                      >
                                        {product.category}
                                      </p>

                                    </div>

                                  </div>

                                  <div
                                    className="
                                      mt-5
                                      h-[6px]
                                      overflow-hidden
                                      rounded-full
                                      bg-white/5
                                    "
                                  >

                                    <div
                                      className="
                                        h-full
                                        rounded-full
                                        bg-white/70
                                      "
                                      style={{
                                        width:
                                          `${state?.progress || 0}%`,
                                      }}
                                    />

                                  </div>

                                  <div
                                    className="
                                      mt-5
                                      flex
                                      items-center
                                      justify-between
                                      gap-4
                                    "
                                  >

                                    <span
                                      className="
                                        text-xs
                                        uppercase
                                        tracking-[0.22em]
                                        text-white/35
                                      "
                                    >
                                      {state?.progress || 0}% avance
                                    </span>

                                    <button
                                      type="button"
                                      disabled={!product.slug}
                                      onClick={() => {
                                        if (!product.slug) return

                                        router.push(
                                          `/admin/products/${product.slug}`
                                        )
                                      }}
                                      className="
                                        rounded-xl
                                        border
                                        border-cyan-400/20
                                        bg-cyan-400/10
                                        px-4
                                        py-2
                                        text-xs
                                        font-semibold
                                        text-cyan-200
                                        transition-all
                                        duration-300
                                        hover:bg-cyan-400/20
                                        disabled:cursor-not-allowed
                                        disabled:border-white/5
                                        disabled:bg-white/[0.02]
                                        disabled:text-white/25
                                      "
                                    >
                                      Ver detalle
                                    </button>

                                  </div>

                                </motion.div>

                              )

                            }
                          )
                        }

                      </div>

                    </section>

                  </>

                )
              }

            </>

          )
        }

        {
          selectedMenu === "products" && (

            <div className="mt-16">

              <h2
                className="
                  text-6xl
                  font-black
                  tracking-[-0.05em]
                  text-white
                "
              >
                Productos
              </h2>

              <p
                className="
                  mt-4
                  text-lg
                  text-white/50
                "
              >
                Catálogo central de productos IMNOVA.
              </p>

              <div
                className="
                  mt-10
                  grid
                  grid-cols-1
                  gap-8
                  xl:grid-cols-2
                "
              >

                {
                  liveProducts.map(
                    (product) => {

                      const state =
                        productStates.find(
                          (item) =>
                            item.id === product.state_id
                        )

                      const progress =
                        state?.progress || 0

                      return (

                        <div
                          key={product.id}
                          className="
                            rounded-[32px]
                            border
                            border-white/10
                            bg-white/[0.03]
                            p-8
                            backdrop-blur-md
                            transition-all
                            duration-300
                            hover:border-cyan-400/30
                            hover:bg-white/[0.05]
                          "
                        >

                          <div
                            className="
                              flex
                              flex-col
                              gap-5
                              sm:flex-row
                              sm:items-start
                              sm:justify-between
                            "
                          >

                            <div>

                              <p
                                className="
                                  text-[10px]
                                  uppercase
                                  tracking-[0.35em]
                                  text-cyan-300/60
                                "
                              >
                                Producto
                              </p>

                              <h3
                                className="
                                  mt-3
                                  text-4xl
                                  font-black
                                  tracking-[-0.04em]
                                  text-white
                                "
                              >
                                {product.name}
                              </h3>

                              <p
                                className="
                                  mt-3
                                  text-sm
                                  uppercase
                                  tracking-[0.25em]
                                  text-white/35
                                "
                              >
                                {product.category}
                              </p>

                              <p
                                className="
                                  mt-4
                                  text-sm
                                  text-white/40
                                "
                              >
                                {
                                  product.slug ||
                                  product.direct_url ||
                                  "Sin ruta asignada"
                                }
                              </p>

                            </div>

                            <span
                              className="
                                rounded-full
                                border
                                border-white/10
                                bg-white/[0.05]
                                px-4
                                py-2
                                text-xs
                                uppercase
                                tracking-[0.2em]
                                text-white/70
                              "
                            >
                              {state?.name || "Sin estado"}
                            </span>

                          </div>

                          <div className="mt-8">

                            <div
                              className="
                                flex
                                items-center
                                justify-between
                                text-xs
                                uppercase
                                tracking-[0.25em]
                                text-white/35
                              "
                            >
                              <span>Progreso</span>
                              <span>{progress}%</span>
                            </div>

                            <div
                              className="
                                mt-3
                                h-[6px]
                                w-full
                                overflow-hidden
                                rounded-full
                                bg-white/5
                              "
                            >
                              <div
                                className="
                                  h-full
                                  rounded-full
                                  bg-white/70
                                "
                                style={{
                                  width:
                                    `${progress}%`,
                                }}
                              />
                            </div>

                          </div>

                          <button
                            onClick={() => {

                              if (!product.slug) {

                                console.error(
                                  "PRODUCTO SIN SLUG:",
                                  product
                                )

                                return

                              }

                              router.push(
                                `/admin/products/${product.slug}`
                              )

                            }}
                            className="
                              mt-8
                              rounded-2xl
                              border
                              border-cyan-400/20
                              bg-cyan-400/10
                              px-5
                              py-3
                              text-sm
                              font-semibold
                              text-cyan-300
                              transition-all
                              duration-300
                              hover:bg-cyan-400/20
                            "
                          >
                            Ver detalle
                          </button>

                        </div>

                      )

                    }
                  )
                }

              </div>

            </div>

          )
        }

        {
          selectedMenu === "campaigns" && (

            <div className="mt-16">

              <div
                className="
                  mt-10
                  grid
                  grid-cols-1
                  gap-6
                  md:grid-cols-4
                "
              >

                <div
                  className="
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >
                  <h3>Total Campañas</h3>

                  <p className="mt-3 text-4xl font-bold">
                    {campaigns.length}
                  </p>
                </div>

                <div
                  className="
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >
                  <h3>Activas</h3>

                  <p className="mt-3 text-4xl font-bold">
                    {
                      campaigns.filter(
                        campaign =>
                          campaign.status === "Active"
                      ).length
                    }
                  </p>
                </div>

                <div
                  className="
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >
                  <h3>Leads</h3>

                  <p className="mt-3 text-4xl font-bold">
                    {
                      campaigns.reduce(
                        (total, campaign) =>
                          total + campaign.leads,
                        0
                      )
                    }
                  </p>
                </div>

              </div>

              <div
                className="
                  mt-12
                  overflow-hidden
                  rounded-3xl
                  border
                  border-white/10
                  bg-white/[0.03]
                "
              >

                <div
                  className="
                    flex
                    items-center
                    justify-between
                    border-b
                    border-white/10
                    p-6
                  "
                >

                  <h3
                    className="
                      text-2xl
                      font-bold
                      text-white
                    "
                  >
                    Campañas Activas
                  </h3>

                  <button
                    onClick={() =>
                      setShowCampaignModal(true)
                    }
                    className="
                      rounded-2xl
                      border
                      border-cyan-400/20
                      bg-cyan-400/10
                      px-3
                      sm:px-5
                      py-2
                      text-xs
                      sm:text-sm
                      text-cyan-300
                    "
                  >
                    + Nueva Campaña
                  </button>

                </div>

                <table className="w-full">

                  <thead>

                    <tr
                      className="
                        border-b
                        border-white/10
                        text-left
                      "
                    >

                      <th className="p-5 text-white/60">
                        Campaña
                      </th>

                      <th className="p-5 text-white/60">
                        Producto
                      </th>

                      <th className="p-5 text-white/60">
                        Canal
                      </th>

                      <th className="p-5 text-white/60">
                        Estado
                      </th>

                      <th className="p-5 text-white/60">
                        Leads
                      </th>

                    </tr>

                  </thead>

                  <tbody>

                    {
                      campaigns.map(
                        (campaign) => (

                          <tr
                            key={campaign.id}
                            className="
                              border-b
                              border-white/5
                            "
                          >

                            <td className="p-5 text-white">
                              {campaign.name}
                            </td>

                            <td className="p-5 text-white/70">
                              {campaign.product || "Idea en Validación"}
                            </td>

                            <td className="p-5 text-white/70">
                              {campaign.channel}
                            </td>

                            <td className="p-5">

                              <span
                                className="
                                  rounded-full
                                  bg-yellow-500/20
                                  px-3
                                  py-1
                                  text-yellow-400
                                "
                              >
                                {campaign.status}
                              </span>

                            </td>

                            <td className="p-5 text-white">
                              {campaign.leads}
                            </td>

                          </tr>

                        )
                      )
                    }

                  </tbody>

                </table>

              </div>

            </div>

          )
        }

        {
          selectedMenu === "analytics" && (

            <div className="mt-16">

              <div
                className="
                  mt-10
                  grid
                  grid-cols-1
                  gap-6
                  md:grid-cols-4
                "
              >

                <div
                  className="
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >
                  <h3>Total Campañas</h3>

                  <p className="mt-3 text-4xl font-bold">
                    {campaigns.length}
                  </p>
                </div>

                <div
                  className="
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >
                  <h3>Activas</h3>

                  <p className="mt-3 text-4xl font-bold">
                    {
                      campaigns.filter(
                        campaign =>
                          campaign.status === "Active"
                      ).length
                    }
                  </p>
                </div>

                <div
                  className="
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >
                  <h3>Leads</h3>

                  <p className="mt-3 text-4xl font-bold">
                    {
                      campaigns.reduce(
                        (total, campaign) =>
                          total + campaign.leads,
                        0
                      )
                    }
                  </p>
                </div>

                <div
                  className="
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >
                  <h3>Productos</h3>

                  <p className="mt-3 text-4xl font-bold">
                    {liveProducts.length}
                  </p>
                </div>

                <div
                  className="
                    mt-10
                    w-full
                    rounded-3xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-8
                    md:col-span-4
                  "
                >

                  <h3
                    className="
                      text-2xl
                      font-bold
                      text-white
                    "
                  >
                    Rendimiento por Canal
                  </h3>

                  <div className="mt-6 space-y-4">

                    <div className="flex justify-between text-white">
                      <span>TikTok</span>
                      <span>
                        {
                          campaigns.filter(
                            c => c.channel === "TikTok"
                          ).length
                        }
                      </span>
                    </div>

                    <div className="flex justify-between text-white">
                      <span>Facebook</span>
                      <span>
                        {
                          campaigns.filter(
                            c => c.channel === "Facebook"
                          ).length
                        }
                      </span>
                    </div>

                    <div className="flex justify-between text-white">
                      <span>Instagram</span>
                      <span>
                        {
                          campaigns.filter(
                            c => c.channel === "Instagram"
                          ).length
                        }
                      </span>
                    </div>

                    <div className="flex justify-between text-white">
                      <span>Google Ads</span>
                      <span>
                        {
                          campaigns.filter(
                            c => c.channel === "Google Ads"
                          ).length
                        }
                      </span>
                    </div>

                  </div>

                </div>

              </div>

            </div>

          )
        }

      </motion.div>

      {
        showCampaignModal && (

          <div
            className="
              fixed
              inset-0
              z-[999]
              flex
              items-center
              justify-center
              bg-black/80
              backdrop-blur-md
            "
          >

            <div
              className="
                w-full
                max-w-2xl
                rounded-3xl
                border
                border-white/10
                bg-[#050505]
                p-8
              "
            >

              <div
                className="
                  flex
                  items-center
                  justify-between
                "
              >

                <h2
                  className="
                    text-4xl
                    font-black
                    text-white
                  "
                >
                  Nueva Campaña
                </h2>

                <button
                  onClick={() =>
                    setShowCampaignModal(false)
                  }
                  className="text-white"
                >
                  ✕
                </button>

              </div>

              <div
                className="
                  mt-8
                  grid
                  gap-5
                "
              >

                <select
                  value={campaignType}
                  onChange={(e) =>
                    setCampaignType(
                      e.target.value
                    )
                  }
                  className="
                    w-full
                    rounded-2xl
                    border
                    border-white/10
                    bg-[#0b0b0b]
                    p-4
                    text-white
                  "
                >
                  <option value="validation">
                    Validación
                  </option>

                  <option value="product">
                    Producto Existente
                  </option>
                </select>

                {
                  campaignType === "validation" && (

                    <input
                      value={validationIdea}
                      onChange={(e) =>
                        setValidationIdea(
                          e.target.value
                        )
                      }
                      placeholder="Idea o producto a validar"
                      className="
                        w-full
                        rounded-2xl
                        border
                        border-white/10
                        bg-white/[0.03]
                        p-4
                        text-white
                      "
                    />

                  )
                }

                {
                  campaignType === "product" && (

                    <select
                      value={campaignProduct}
                      onChange={(e) =>
                        setCampaignProduct(
                          e.target.value
                        )
                      }
                      className="
                        w-full
                        rounded-2xl
                        border
                        border-white/10
                        bg-[#0b0b0b]
                        p-4
                        text-white
                      "
                    >
                      <option value="">
                        Seleccionar producto
                      </option>

                      {
                        liveProducts.map(
                          (product) => (

                            <option
                              key={product.id}
                              value={product.name}
                            >
                              {product.name}
                            </option>

                          )
                        )
                      }

                    </select>

                  )
                }

                <select
                  value={campaignChannel}
                  onChange={(e) =>
                    setCampaignChannel(
                      e.target.value
                    )
                  }
                  className="
                    w-full
                    rounded-2xl
                    border
                    border-white/10
                    bg-[#0b0b0b]
                    p-4
                    text-white
                  "
                >
                  <option value="TikTok">
                    TikTok
                  </option>

                  <option value="Facebook">
                    Facebook
                  </option>

                  <option value="Instagram">
                    Instagram
                  </option>

                  <option value="Google Ads">
                    Google Ads
                  </option>
                </select>

                <input
                  value={campaignBudget}
                  onChange={(e) =>
                    setCampaignBudget(
                      e.target.value
                    )
                  }
                  placeholder="Presupuesto"
                  className="
                    w-full
                    rounded-2xl
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-4
                    text-white
                  "
                />

              </div>

              <div
                className="
                  mt-8
                  flex
                  justify-end
                  gap-4
                "
              >

                <button
                  onClick={() =>
                    setShowCampaignModal(false)
                  }
                  className="
                    rounded-2xl
                    border
                    border-white/10
                    px-6
                    py-3
                    text-white
                  "
                >
                  Cancelar
                </button>

                <button
                  onClick={createCampaign}
                  className="
                    rounded-2xl
                    bg-cyan-500
                    px-6
                    py-3
                    font-bold
                    text-black
                  "
                >
                  Crear Campaña
                </button>

              </div>

            </div>

          </div>

        )
      }

    </main>

  )

}
