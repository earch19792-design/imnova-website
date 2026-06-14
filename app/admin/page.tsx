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
  getAdminDashboardMetrics,
  getAdminProductPage,
  getAdminPriorityProducts,
  getAdminProductSuggestions,
  getCommunitySubscriberStats,
  getPublicNichesWithSubniches,
  getRecentSubscribersWithInterests,
  getAdminValidationActionProducts,
  getSubnicheDemandWithProducts,
  getTopCommunityAreas,
  getTopCommunityNiches,
  getTopCommunitySubniches,
  getProductStates,
  type CommunitySubscriberStats,
  type CommunitySubscriberWithInterests,
  type StrategicNicheWithSubniches,
  type SubnicheDemandWithProducts,
  type TopCommunityArea,
  type TopCommunityNiche,
  type TopCommunitySubniche,
  updateProduct,
} from "@/lib/products-service"

import {
  supabase,
} from "@/lib/supabase"

import {
  signOutAdmin,
  validateAdminSession,
} from "@/lib/admin-auth"

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

type ValidationSummary = {
  pendingDecision: number
  readyToAdvance: number
  needsAdjustment: number
  paused: number
  discarded: number
  highInterest: number
  activeSurveys: number
  averageSurveyScore: number | null
  averageSocialScore: number | null
  totalVotes: number
  hasValidationData: boolean
}

type AdminDashboardMetrics = {
  totalProducts: number
  productsWithoutState: number
  productsWithoutSlug: number
  stateCounts: Record<string, number>
  validationSummary: ValidationSummary
}

type ValidationActionProducts = {
  readyToAdvance: Product[]
  pendingDecision: Product[]
  needsAdjustment: Product[]
}

type ManualSubscriberFormData = {
  nombre: string
  telefono: string
  email: string
  objetivo_principal: string
}

const EMPTY_VALIDATION_SUMMARY: ValidationSummary = {
  pendingDecision: 0,
  readyToAdvance: 0,
  needsAdjustment: 0,
  paused: 0,
  discarded: 0,
  highInterest: 0,
  activeSurveys: 0,
  averageSurveyScore: null,
  averageSocialScore: null,
  totalVotes: 0,
  hasValidationData: false,
}

const EMPTY_DASHBOARD_METRICS: AdminDashboardMetrics = {
  totalProducts: 0,
  productsWithoutState: 0,
  productsWithoutSlug: 0,
  stateCounts: {},
  validationSummary:
    EMPTY_VALIDATION_SUMMARY,
}

const EMPTY_COMMUNITY_SUBSCRIBER_STATS: CommunitySubscriberStats = {
  totalSubscribers: 0,
  subscribersWithInterests: 0,
  subscribersWithAreaInterests: 0,
  subscribersWithSubnicheInterests: 0,
  percentWithWhatsapp: 0,
  percentWithEmail: 0,
}

const EMPTY_VALIDATION_ACTION_PRODUCTS: ValidationActionProducts = {
  readyToAdvance: [],
  pendingDecision: [],
  needsAdjustment: [],
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
  value?: number | string | null
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const numericValue =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function formatCommunityPercent(
  value: number
) {
  return `${Math.round(value)}%`
}

function formatCommunityDate(
  value?: string | null
) {
  if (!value) {
    return "Sin fecha"
  }

  try {
    return new Intl.DateTimeFormat(
      "es-NI",
      {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone:
          "America/Managua",
      }
    ).format(
      new Date(value)
    )
  } catch {
    return "Fecha no disponible"
  }
}

const demandOpportunityLabels: Record<
  SubnicheDemandWithProducts["opportunity_status"],
  string
> = {
  alta_demanda_sin_producto:
    "Alta demanda sin producto",
  producto_con_demanda:
    "Producto con demanda",
  producto_sin_demanda_suficiente:
    "Producto con baja demanda",
  en_validacion:
    "En validacion",
}

const demandOpportunityClassNames: Record<
  SubnicheDemandWithProducts["opportunity_status"],
  string
> = {
  alta_demanda_sin_producto:
    "border-emerald-300/25 bg-emerald-300/[0.10] text-emerald-100",
  producto_con_demanda:
    "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100",
  producto_sin_demanda_suficiente:
    "border-amber-200/25 bg-amber-200/[0.10] text-amber-100",
  en_validacion:
    "border-violet-300/25 bg-violet-300/[0.10] text-violet-100",
}

const ADMIN_PRODUCT_LIST_BATCH_SIZE =
  24

const MAX_MANUAL_COMMUNITY_INTERESTS =
  5

const adminMenuGuides = {
  dashboard: {
    title:
      "Empieza por las senales y la prioridad.",
    description:
      "Usa esta vista para decidir que requiere atencion hoy antes de entrar a editar productos.",
    steps: [
      "Revisa metricas generales y validacion comunitaria.",
      "Abre los productos listos para avanzar, pendientes o en ajuste.",
      "Despues entra al detalle para completar informacion y tomar accion.",
    ],
    reminder:
      "El dashboard orienta decisiones; la edicion profunda vive en el detalle del producto.",
  },
  products: {
    title:
      "Ordena el pipeline sin disparar notificaciones.",
    description:
      "Esta lista sirve para encontrar productos, asignar estado y entrar al detalle cuando toque configurar informacion.",
    steps: [
      "Filtra por estado o busqueda para ubicar el producto.",
      "Cambia estado solo cuando la informacion este revisada.",
      "Usa Ver detalle para configurar validacion, contenido, comercializacion y notificaciones.",
    ],
    reminder:
      "Guardar estado desde Productos no envia WhatsApp. Las notificaciones son manuales desde el detalle.",
  },
  campaigns: {
    title:
      "Activa campanas con una intencion clara.",
    description:
      "Usa Campanas para registrar esfuerzos de validacion, comunidad o crecimiento ligados a ideas y productos.",
    steps: [
      "Define si la campana valida una idea o impulsa un producto.",
      "Registra canal, estado y leads para mantener lectura operativa.",
      "Cruza los resultados con validacion comunitaria antes de avanzar etapas.",
    ],
    reminder:
      "Las campanas ayudan a generar senales, pero no mueven estados automaticamente.",
  },
  community: {
    title:
      "Lee comunidad e intereses antes de decidir.",
    description:
      "Usa esta vista para registrar miembros, normalizar intereses y cruzar demanda real contra productos disponibles.",
    steps: [
      "Revisa las metricas de comunidad e identifica los nichos con mas seleccion.",
      "Distingue areas generales del popup y subnichos especificos del Admin.",
      "Usa Demanda vs Productos solo para priorizar con subnichos especificos.",
    ],
    reminder:
      "subscriber_area_interests mide intereses generales; subscriber_interests mide subnichos especificos.",
  },
  analytics: {
    title:
      "Lee aprendizaje antes de escalar.",
    description:
      "Analytics resume rendimiento por canal y volumen para detectar que merece mas atencion.",
    steps: [
      "Compara canales activos y senales generadas.",
      "Identifica donde hay traccion real antes de invertir mas.",
      "Vuelve a Productos o Detalle para tomar accion operativa.",
    ],
    reminder:
      "Los numeros deben apoyar decisiones, no reemplazar la revision estrategica.",
  },
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
    dashboardMetrics,
    setDashboardMetrics,
  ] = useState<AdminDashboardMetrics>(
    EMPTY_DASHBOARD_METRICS
  )

  const [
    validationActionProducts,
    setValidationActionProducts,
  ] = useState<ValidationActionProducts>(
    EMPTY_VALIDATION_ACTION_PRODUCTS
  )

  const [
    selectedMenu,
    setSelectedMenu,
  ] = useState("dashboard")

  const [
    productSearchTerm,
    setProductSearchTerm,
  ] = useState("")

  const [
    productStateFilter,
    setProductStateFilter,
  ] = useState("all")

  const [
    adminProducts,
    setAdminProducts,
  ] = useState<Product[]>([])

  const [
    adminProductsTotal,
    setAdminProductsTotal,
  ] = useState(0)

  const [
    adminProductPage,
    setAdminProductPage,
  ] = useState(0)

  const [
    isLoadingAdminProducts,
    setIsLoadingAdminProducts,
  ] = useState(false)

  const [
    adminProductsError,
    setAdminProductsError,
  ] = useState("")

  const [
    savingProductStateId,
    setSavingProductStateId,
  ] = useState<string | null>(null)

  const [
    productStateMessage,
    setProductStateMessage,
  ] = useState("")

  const [
    productStateError,
    setProductStateError,
  ] = useState("")

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
    communitySubscribers,
    setCommunitySubscribers,
  ] = useState<CommunitySubscriberWithInterests[]>([])

  const [
    communityStats,
    setCommunityStats,
  ] = useState<CommunitySubscriberStats>(
    EMPTY_COMMUNITY_SUBSCRIBER_STATS
  )

  const [
    topCommunityNiches,
    setTopCommunityNiches,
  ] = useState<TopCommunityNiche[]>([])

  const [
    topCommunityAreas,
    setTopCommunityAreas,
  ] = useState<TopCommunityArea[]>([])

  const [
    topCommunitySubniches,
    setTopCommunitySubniches,
  ] = useState<TopCommunitySubniche[]>([])

  const [
    subnicheDemandWithProducts,
    setSubnicheDemandWithProducts,
  ] = useState<SubnicheDemandWithProducts[]>([])

  const [
    communityNichesWithSubniches,
    setCommunityNichesWithSubniches,
  ] = useState<StrategicNicheWithSubniches[]>([])

  const [
    selectedManualSubnicheIds,
    setSelectedManualSubnicheIds,
  ] = useState<string[]>([])

  const [
    manualSubscriberForm,
    setManualSubscriberForm,
  ] = useState<ManualSubscriberFormData>({
    nombre: "",
    telefono: "",
    email: "",
    objetivo_principal:
      "Registro manual para comunidad WhatsApp IMNOVA.",
  })

  const [
    isLoadingCommunity,
    setIsLoadingCommunity,
  ] = useState(false)

  const [
    isSavingCommunitySubscriber,
    setIsSavingCommunitySubscriber,
  ] = useState(false)

  const [
    communityMessage,
    setCommunityMessage,
  ] = useState("")

  const [
    communityError,
    setCommunityError,
  ] = useState("")

  const [
    validationIdea,
    setValidationIdea,
  ] = useState("")

  const [
    campaignProduct,
    setCampaignProduct,
  ] = useState("")

  const [
    campaignProductSuggestions,
    setCampaignProductSuggestions,
  ] = useState<Product[]>([])

  const [
    isLoadingCampaignProductSuggestions,
    setIsLoadingCampaignProductSuggestions,
  ] = useState(false)

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

      const states =
        await getProductStates()

      const [
        metrics,
        priorityProducts,
        actionProducts,
      ] =
        await Promise.all([
          getAdminDashboardMetrics(
            states || []
          ),
          getAdminPriorityProducts(6),
          getAdminValidationActionProducts(),
        ])

      setLiveProducts(
        (priorityProducts || []).map(
          normalizeProduct
        )
      )

      setDashboardMetrics(
        metrics as AdminDashboardMetrics
      )

      setValidationActionProducts({
        readyToAdvance:
          (
            actionProducts.readyToAdvance ||
            []
          ).map(normalizeProduct),
        pendingDecision:
          (
            actionProducts.pendingDecision ||
            []
          ).map(normalizeProduct),
        needsAdjustment:
          (
            actionProducts.needsAdjustment ||
            []
          ).map(normalizeProduct),
      })

      setProductStates(
        states || []
      )

      console.log(
        "ADMIN DASHBOARD METRICS:",
        metrics
      )

      console.log(
        "PRODUCT STATES:",
        states
      )

    }

  const loadAdminProductPage =
    async (
      page = 0,
      mode: "replace" | "append" =
        "replace"
    ) => {

      setIsLoadingAdminProducts(true)
      setAdminProductsError("")

      try {

        const result =
          await getAdminProductPage({
            search:
              productSearchTerm,
            stateId:
              productStateFilter,
            limit:
              ADMIN_PRODUCT_LIST_BATCH_SIZE,
            page,
          })

        const normalizedProducts =
          (result.products || []).map(
            normalizeProduct
          )

        setAdminProducts(
          (currentProducts) =>
            mode === "append"
              ? [
                  ...currentProducts,
                  ...normalizedProducts,
                ]
              : normalizedProducts
        )

        setAdminProductsTotal(
          result.count || 0
        )

        setAdminProductPage(page)

      } catch (error) {

        console.error(
          "LOAD ADMIN PRODUCT PAGE ERROR:",
          error
        )

        setAdminProductsError(
          "No se pudieron cargar los productos."
        )

      } finally {

        setIsLoadingAdminProducts(false)

      }

    }

  const handleProductUpdate =
    async () => {

      await loadAdminData()

      if (
        selectedMenu === "products"
      ) {
        await loadAdminProductPage()
      }

    }

  const loadCommunitySubscribers =
    async () => {

      setIsLoadingCommunity(true)

      try {
        const [
          stats,
          areas,
          niches,
          subniches,
          subscribers,
          nichesWithSubniches,
          demandWithProducts,
        ] =
          await Promise.all([
            getCommunitySubscriberStats(),
            getTopCommunityAreas(5),
            getTopCommunityNiches(5),
            getTopCommunitySubniches(5),
            getRecentSubscribersWithInterests(10),
            getPublicNichesWithSubniches(),
            getSubnicheDemandWithProducts(10),
          ])

        setCommunityStats(
          stats
        )

        setTopCommunityAreas(
          areas || []
        )

        setTopCommunityNiches(
          niches || []
        )

        setTopCommunitySubniches(
          subniches || []
        )

        setCommunitySubscribers(
          subscribers || []
        )

        setCommunityNichesWithSubniches(
          nichesWithSubniches || []
        )

        setSubnicheDemandWithProducts(
          demandWithProducts || []
        )
      } catch (error) {
        console.error(
          "LOAD COMMUNITY SUBSCRIBERS ERROR:",
          error
        )

        setCommunityStats(
          EMPTY_COMMUNITY_SUBSCRIBER_STATS
        )

        setTopCommunityNiches([])
        setTopCommunitySubniches([])
        setCommunitySubscribers([])
        setCommunityNichesWithSubniches([])
        setSubnicheDemandWithProducts([])
      } finally {
        setIsLoadingCommunity(false)
      }

    }

  const updateManualSubscriberField =
    (
      field: keyof ManualSubscriberFormData,
      value: string
    ) => {
      setManualSubscriberForm(
        currentForm => ({
          ...currentForm,
          [field]: value,
        })
      )
    }

  const manualSubnichesById =
    useMemo(
      () => {
        const subnichesById =
          new Map<
            string,
            StrategicNicheWithSubniches["subniches"][number]
          >()

        communityNichesWithSubniches.forEach(
          (niche) => {
            niche.subniches.forEach(
              (subniche) => {
                subnichesById.set(
                  subniche.id,
                  subniche
                )
              }
            )
          }
        )

        return subnichesById
      },
      [communityNichesWithSubniches]
    )

  const selectedManualSubnicheNames =
    useMemo(
      () =>
        selectedManualSubnicheIds
          .map(
            (subnicheId) => {
              const subniche =
                manualSubnichesById.get(
                  subnicheId
                )

              return subniche
                ? subniche.public_name ||
                    subniche.name
                : ""
            }
          )
          .filter(Boolean),
      [
        manualSubnichesById,
        selectedManualSubnicheIds,
      ]
    )

  const toggleManualSubniche =
    (subnicheId: string) => {
      const isSelected =
        selectedManualSubnicheIds.includes(
          subnicheId
        )

      if (!isSelected) {
        setCommunityError("")
      }

      if (
        !isSelected &&
        selectedManualSubnicheIds.length >=
          MAX_MANUAL_COMMUNITY_INTERESTS
      ) {
        setCommunityError(
          `Selecciona maximo ${MAX_MANUAL_COMMUNITY_INTERESTS} intereses.`
        )
        return
      }

      setSelectedManualSubnicheIds(
        currentSubnicheIds =>
          currentSubnicheIds.includes(
            subnicheId
          )
            ? currentSubnicheIds.filter(
                currentSubnicheId =>
                  currentSubnicheId !==
                  subnicheId
              )
            : [
                ...currentSubnicheIds,
                subnicheId,
              ]
      )
    }

  const handleCreateManualSubscriber =
    async () => {

      setCommunityMessage("")
      setCommunityError("")

      const name =
        manualSubscriberForm.nombre.trim()

      const phone =
        manualSubscriberForm.telefono.trim()

      const email =
        manualSubscriberForm.email.trim()

      if (
        !name ||
        (
          !phone &&
          !email
        )
      ) {
        setCommunityError(
          "Nombre y al menos WhatsApp o email son obligatorios."
        )
        return
      }

      if (
        selectedManualSubnicheIds.length === 0
      ) {
        setCommunityError(
          "Selecciona al menos un interes normalizado."
        )
        return
      }

      setIsSavingCommunitySubscriber(true)

      try {
        const selectedSubnicheNames =
          Array.from(
            new Set(
              selectedManualSubnicheNames
            )
          )

        const {
          data: sessionData,
          error: sessionError,
        } =
          await supabase.auth.getSession()

        const accessToken =
          sessionData.session?.access_token

        if (
          sessionError ||
          !accessToken
        ) {
          throw new Error(
            "No se pudo validar la sesion Admin."
          )
        }

        const response =
          await fetch(
            "/api/community/register",
            {
              method:
                "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${accessToken}`,
              },
              body:
                JSON.stringify({
                  name,
                  email,
                  whatsapp:
                    phone,
                  country:
                    "505",
                  selectedSubnicheIds:
                    selectedManualSubnicheIds,
                  selectedSubnicheNames,
                  source:
                    "admin_manual",
                  objective:
                    manualSubscriberForm.objetivo_principal,
                }),
            }
          )

        const result =
          await response.json()
            .catch(() => null)

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ||
              "No se pudo registrar el contacto."
          )
        }

        if (result.warnings?.length) {
          console.warn(
            "ADMIN MANUAL COMMUNITY REGISTER WARNINGS:",
            result.warnings
          )
        }

        setCommunityMessage(
          "Contacto agregado a la comunidad con intereses normalizados."
        )

        setManualSubscriberForm({
          nombre: "",
          telefono: "",
          email: "",
          objetivo_principal:
            "Registro manual para comunidad WhatsApp IMNOVA.",
        })

        setSelectedManualSubnicheIds([])

        await loadCommunitySubscribers()
      } catch (error) {
        console.error(
          "CREATE MANUAL COMMUNITY SUBSCRIBER UI ERROR:",
          error
        )

        setCommunityError(
          error instanceof Error
            ? error.message
            : "No se pudo registrar el contacto."
        )
      } finally {
        setIsSavingCommunitySubscriber(false)
      }

    }

  const handleAdminProductStateChange =
    async (
      product: Product,
      nextStateId: string
    ) => {

      const normalizedStateId =
        nextStateId || null

      if (
        (product.state_id || null) ===
        normalizedStateId
      ) {
        return
      }

      setSavingProductStateId(product.id)
      setProductStateMessage("")
      setProductStateError("")

      try {

        const result =
          await updateProduct(
            product.id,
            {
              state_id:
                normalizedStateId,
            }
          )

        if (!result) {
          throw new Error(
            "No se pudo actualizar el estado del producto."
          )
        }

        setAdminProducts(
          currentProducts =>
            currentProducts.map(
              currentProduct =>
                currentProduct.id === product.id
                  ? {
                      ...currentProduct,
                      state_id:
                        normalizedStateId,
                    }
                  : currentProduct
            )
        )

        setLiveProducts(
          currentProducts =>
            currentProducts.map(
              currentProduct =>
                currentProduct.id === product.id
                  ? {
                      ...currentProduct,
                      state_id:
                        normalizedStateId,
                    }
                  : currentProduct
            )
        )

        setProductStateMessage(
          "Estado actualizado. Las notificaciones se envian desde el detalle del producto."
        )

        await Promise.all([
          loadAdminData(),
          loadAdminProductPage(
            0,
            "replace"
          ),
        ])

      } catch (error) {

        console.error(
          "UPDATE ADMIN PRODUCT STATE ERROR:",
          error
        )

        setProductStateError(
          "No se pudo actualizar el estado. Intenta nuevamente o abre el detalle del producto."
        )

      } finally {

        setSavingProductStateId(null)

      }

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

    let isMounted = true

    async function validateAccess() {
      const result =
        await validateAdminSession()

      if (!isMounted) {
        return
      }

      if (!result.isAdmin) {
        router.replace(
          "/admin/login"
        )

        return
      }

      setIsAuthenticated(true)
    }

    validateAccess()

    return () => {
      isMounted = false
    }

  }, [router])

  useEffect(() => {

    if (!isAuthenticated) return

    loadAdminData()

  }, [isAuthenticated])

  useEffect(() => {

    if (
      !isAuthenticated ||
      selectedMenu !== "products"
    ) {
      return
    }

    const timeout =
      window.setTimeout(
        () => {
          loadAdminProductPage()
        },
        250
      )

    return () =>
      window.clearTimeout(timeout)

  }, [
    isAuthenticated,
    selectedMenu,
    productSearchTerm,
    productStateFilter,
  ])

  useEffect(() => {

    if (
      !isAuthenticated ||
      selectedMenu !== "community"
    ) {
      return
    }

    loadCommunitySubscribers()

  }, [
    isAuthenticated,
    selectedMenu,
  ])

  useEffect(() => {

    if (
      !isAuthenticated ||
      !showCampaignModal ||
      campaignType !== "product"
    ) {
      return
    }

    const timeout =
      window.setTimeout(
        async () => {
          setIsLoadingCampaignProductSuggestions(true)

          try {
            const products =
              await getAdminProductSuggestions(
                campaignProduct,
                20
              )

            setCampaignProductSuggestions(
              (products || []).map(
                normalizeProduct
              )
            )
          } catch (error) {
            console.error(
              "LOAD CAMPAIGN PRODUCT SUGGESTIONS ERROR:",
              error
            )

            setCampaignProductSuggestions([])
          } finally {
            setIsLoadingCampaignProductSuggestions(false)
          }
        },
        250
      )

    return () =>
      window.clearTimeout(timeout)

  }, [
    isAuthenticated,
    showCampaignModal,
    campaignType,
    campaignProduct,
  ])

  const handleLogout =
    async () => {

      await signOutAdmin()
      setIsAuthenticated(false)

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
        dashboardMetrics.stateCounts ||
        {},
      [dashboardMetrics.stateCounts]
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
              dashboardMetrics.totalProducts > 0
                ? Math.round(
                    (
                      count /
                      dashboardMetrics.totalProducts
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
        dashboardMetrics.totalProducts,
        productStates,
        stateCounts,
      ]
    )

  const validationSummary =
    dashboardMetrics.validationSummary ||
    EMPTY_VALIDATION_SUMMARY

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
        return [
          {
            title:
              "Listos para avanzar",
            description:
              "Productos con validacion positiva listos para revision de etapa.",
            accentClassName:
              "border-emerald-200/20 bg-emerald-200/[0.045]",
            products:
              validationActionProducts.readyToAdvance,
          },
          {
            title:
              "Pendientes de decision",
            description:
              "Productos con datos o encuestas pendientes de decision estrategica.",
            accentClassName:
              "border-amber-200/20 bg-amber-200/[0.045]",
            products:
              validationActionProducts.pendingDecision,
          },
          {
            title:
              "Requieren ajuste",
            description:
              "Productos que necesitan revisar propuesta, nicho o beneficio antes de avanzar.",
            accentClassName:
              "border-cyan-200/20 bg-cyan-200/[0.04]",
            products:
              validationActionProducts.needsAdjustment,
          },
        ]
      },
      [validationActionProducts]
    )

  const hasMoreAdminProducts =
    adminProducts.length <
    adminProductsTotal

  const selectedStateFilterName =
    useMemo(
      () => {
        if (productStateFilter === "all") {
          return "Todos los estados"
        }

        if (productStateFilter === "no-state") {
          return "Sin estado"
        }

        return (
          productStates.find(
            state =>
              state.id === productStateFilter
          )?.name || "Estado seleccionado"
        )
      },
      [
        productStateFilter,
        productStates,
      ]
    )

  const activeAdminGuide =
    adminMenuGuides[
      selectedMenu as keyof typeof adminMenuGuides
    ] || adminMenuGuides.dashboard

  const dashboardProducts =
    useMemo(
      () =>
        [...liveProducts]
          .sort(
            (
              productA,
              productB
            ) => {

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
    dashboardMetrics.productsWithoutState

  const productsWithoutSlug =
    dashboardMetrics.productsWithoutSlug

  const activeCampaigns =
    campaigns.filter(
      (campaign) =>
        campaign.status ===
        "Active"
    ).length

  const topCommunityNiche =
    topCommunityNiches[0]

  const topCommunityArea =
    topCommunityAreas[0]

  const topCommunitySubniche =
    topCommunitySubniches[0]

  const topCommunityNicheName =
    topCommunityNiche?.niche_public_name ||
    topCommunityNiche?.niche_name ||
    "Sin datos"

  const topCommunityAreaName =
    topCommunityArea?.area_label ||
    "Sin datos"

  const topCommunitySubnicheName =
    topCommunitySubniche?.subniche_public_name ||
    topCommunitySubniche?.subniche_name ||
    "Sin datos"

  const maxTopCommunityAreaCount =
    Math.max(
      1,
      ...topCommunityAreas.map(
        (area) =>
          area.count
      )
    )

  const maxTopCommunityNicheCount =
    Math.max(
      1,
      ...topCommunityNiches.map(
        (niche) =>
          niche.count
      )
    )

  const maxTopCommunitySubnicheCount =
    Math.max(
      1,
      ...topCommunitySubniches.map(
        (subniche) =>
          subniche.count
      )
    )

  const communityMetricCards = [
    {
      label:
        "Total miembros",
      value:
        communityStats.totalSubscribers.toLocaleString(
          "es-NI"
        ),
      detail:
        "Registros en subscribers",
    },
    {
      label:
        "Con areas generales",
      value:
        communityStats.subscribersWithAreaInterests.toLocaleString(
          "es-NI"
        ),
      detail:
        "Fuente: subscriber_area_interests",
    },
    {
      label:
        "Con subnichos",
      value:
        communityStats.subscribersWithSubnicheInterests.toLocaleString(
          "es-NI"
        ),
      detail:
        "Fuente: subscriber_interests",
    },
    {
      label:
        "Area mas popular",
      value:
        topCommunityAreaName,
      detail:
        topCommunityArea
          ? `${topCommunityArea.count} selecciones`
          : "Pendiente de datos",
    },
    {
      label:
        "Nicho especifico mas popular",
      value:
        topCommunityNicheName,
      detail:
        topCommunityNiche
          ? `${topCommunityNiche.count} selecciones`
          : "Pendiente de datos",
    },
    {
      label:
        "Subnicho especifico mas popular",
      value:
        topCommunitySubnicheName,
      detail:
        topCommunitySubniche
          ? `${topCommunitySubniche.count} selecciones`
          : "Pendiente de datos",
    },
    {
      label:
        "% con WhatsApp",
      value:
        formatCommunityPercent(
          communityStats.percentWithWhatsapp
        ),
      detail:
        "Contacto directo disponible",
    },
    {
      label:
        "% con email",
      value:
        formatCommunityPercent(
          communityStats.percentWithEmail
        ),
      detail:
        "Canal correo disponible",
    },
  ]

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
                  : selectedMenu === "community"
                  ? "Comunidad"
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
                  : selectedMenu === "community"
                  ? "Resumen de miembros, intereses normalizados y demanda de la comunidad IMNOVA."
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

        <section
          className="
            mt-10
            rounded-[34px]
            border
            border-cyan-300/15
            bg-cyan-300/[0.04]
            p-6
            backdrop-blur-md
          "
        >
          <div
            className="
              flex
              flex-col
              gap-6
              xl:flex-row
              xl:items-start
              xl:justify-between
            "
          >
            <div className="max-w-3xl">
              <p
                className="
                  text-[10px]
                  uppercase
                  tracking-[0.35em]
                  text-cyan-100/65
                "
              >
                Guia de administracion
              </p>

              <h2
                className="
                  mt-4
                  text-3xl
                  font-black
                  tracking-[-0.04em]
                  text-white
                "
              >
                {activeAdminGuide.title}
              </h2>

              <p
                className="
                  mt-3
                  text-sm
                  leading-6
                  text-white/55
                "
              >
                {activeAdminGuide.description}
              </p>
            </div>

            <div
              className="
                grid
                gap-3
                md:grid-cols-3
                xl:min-w-[560px]
              "
            >
              {activeAdminGuide.steps.map((step, index) => (
                <div
                  key={step}
                  className="
                    rounded-2xl
                    border
                    border-white/10
                    bg-black/25
                    p-4
                  "
                >
                  <span
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.24em]
                      text-cyan-100/45
                    "
                  >
                    Paso {index + 1}
                  </span>

                  <p
                    className="
                      mt-3
                      text-sm
                      leading-6
                      text-white/65
                    "
                  >
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <p
            className="
              mt-5
              rounded-2xl
              border
              border-white/10
              bg-black/25
              p-4
              text-sm
              leading-6
              text-white/50
            "
          >
            {activeAdminGuide.reminder}
          </p>
        </section>

        {
          selectedMenu === "dashboard" && (

            <>

              <div className="mt-16">
                <Metrics
                  stateCounts={stateCounts}
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
                  dashboardMetrics.totalProducts === 0 ? (

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
                          mt-8
                          flex
                          flex-col
                          gap-3
                          border-t
                          border-white/10
                          pt-7
                          lg:flex-row
                          lg:items-end
                          lg:justify-between
                        "
                      >
                        <div>
                          <p
                            className="
                              text-[10px]
                              uppercase
                              tracking-[0.30em]
                              text-cyan-100/60
                            "
                          >
                            Acciones recomendadas
                          </p>

                          <p
                            className="
                              mt-3
                              max-w-2xl
                              text-sm
                              leading-6
                              text-white/45
                            "
                          >
                            Productos que requieren lectura operativa segun la
                            validacion comunitaria. El estado no cambia desde
                            aqui.
                          </p>
                        </div>
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

                                      group.products
                                        .slice(
                                          0,
                                          3
                                        )
                                        .map(
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
                                                Interes {score === null ? "N/A" : `${score}%`} - {votes} respuestas
                                              </p>

                                              {
                                                product.slug ? (

                                                  <button
                                                    type="button"
                                                    onClick={() => {
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
                                                    "
                                                  >
                                                    Ver detalle
                                                  </button>

                                                ) : (

                                                  <p
                                                    className="
                                                      mt-4
                                                      text-xs
                                                      font-semibold
                                                      text-white/30
                                                    "
                                                  >
                                                    Sin detalle disponible
                                                  </p>

                                                )
                                              }

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
                dashboardMetrics.totalProducts === 0 ? (

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
                            {dashboardMetrics.totalProducts} productos
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
                  mt-8
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
                    grid
                    gap-4
                    lg:grid-cols-[1fr_260px_auto]
                    lg:items-center
                  "
                >
                  <input
                    type="search"
                    value={productSearchTerm}
                    onChange={(event) =>
                      setProductSearchTerm(
                        event.target.value
                      )
                    }
                    placeholder="Buscar por nombre, categoria o ruta"
                    className="
                      w-full
                      rounded-2xl
                      border
                      border-white/10
                      bg-black/35
                      px-5
                      py-4
                      text-sm
                      text-white
                      outline-none
                      transition-all
                      duration-300
                      placeholder:text-white/30
                      focus:border-cyan-300/40
                      focus:bg-black/50
                    "
                  />

                  <select
                    value={productStateFilter}
                    onChange={(event) =>
                      setProductStateFilter(
                        event.target.value
                      )
                    }
                    className="
                      w-full
                      rounded-2xl
                      border
                      border-white/10
                      bg-[#0b0b0b]
                      px-5
                      py-4
                      text-sm
                      text-white
                      outline-none
                      transition-all
                      duration-300
                      focus:border-cyan-300/40
                    "
                  >
                    <option value="all">
                      Todos los estados ({dashboardMetrics.totalProducts})
                    </option>

                    <option value="no-state">
                      Sin estado ({productsWithoutState})
                    </option>

                    {
                      productStates.map(
                        (state) => (

                          <option
                            key={state.id}
                            value={state.id}
                          >
                            {state.name} ({stateCounts[state.id] || 0})
                          </option>

                        )
                      )
                    }
                  </select>

                  <div
                    className="
                      flex
                      items-center
                      justify-between
                      gap-4
                      lg:justify-end
                    "
                  >
                    <span
                      className="
                        whitespace-nowrap
                        text-xs
                        uppercase
                        tracking-[0.22em]
                        text-white/35
                      "
                    >
                      {adminProductsTotal} resultados
                    </span>

                    {
                      (
                        productSearchTerm ||
                        productStateFilter !==
                          "all"
                      ) && (

                        <button
                          type="button"
                          onClick={() => {
                            setProductSearchTerm("")
                            setProductStateFilter("all")
                          }}
                          className="
                            rounded-2xl
                            border
                            border-white/10
                            bg-white/[0.04]
                            px-4
                            py-3
                            text-xs
                            font-semibold
                            uppercase
                            tracking-[0.18em]
                            text-white/70
                            transition-all
                            duration-300
                            hover:bg-white/[0.08]
                            hover:text-white
                          "
                        >
                          Limpiar
                        </button>

                      )
                    }
                  </div>
                </div>
              </div>

              <div
                className="
                  mt-6
                  rounded-[28px]
                  border
                  border-cyan-300/15
                  bg-cyan-300/[0.04]
                  p-5
                  backdrop-blur-md
                "
              >
                <div
                  className="
                    flex
                    flex-col
                    gap-4
                    lg:flex-row
                    lg:items-center
                    lg:justify-between
                  "
                >
                  <div>
                    <p
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.30em]
                        text-cyan-100/65
                      "
                    >
                      Orquestador de productos
                    </p>

                    <p
                      className="
                        mt-3
                        max-w-4xl
                        text-sm
                        leading-6
                        text-white/55
                      "
                    >
                      Cambia estados de forma rapida desde esta lista y abre el
                      detalle para configurar validacion, contenido,
                      comercializacion, distribucion y notificaciones.
                    </p>
                  </div>

                  <p
                    className="
                      rounded-2xl
                      border
                      border-white/10
                      bg-black/25
                      px-4
                      py-3
                      text-xs
                      uppercase
                      tracking-[0.18em]
                      text-white/45
                    "
                  >
                    Guardar estado no envia WhatsApp
                  </p>
                </div>

                {
                  productStateMessage && (

                    <p
                      className="
                        mt-4
                        rounded-2xl
                        border
                        border-emerald-200/15
                        bg-emerald-200/[0.05]
                        p-4
                        text-sm
                        leading-6
                        text-emerald-100
                      "
                    >
                      {productStateMessage}
                    </p>

                  )
                }

                {
                  productStateError && (

                    <p
                      className="
                        mt-4
                        rounded-2xl
                        border
                        border-red-200/15
                        bg-red-200/[0.05]
                        p-4
                        text-sm
                        leading-6
                        text-red-100
                      "
                    >
                      {productStateError}
                    </p>

                  )
                }
              </div>

              {
                adminProductsError && (

                  <div
                    className="
                      mt-8
                      rounded-[28px]
                      border
                      border-white/10
                      bg-black/25
                      p-8
                      text-sm
                      leading-6
                      text-white/50
                    "
                  >
                    {adminProductsError}
                  </div>

                )
              }

              {
                !adminProductsError &&
                  !isLoadingAdminProducts &&
                  adminProductsTotal === 0 && (

                  <div
                    className="
                      mt-8
                      rounded-[28px]
                      border
                      border-white/10
                      bg-black/25
                      p-8
                      text-sm
                      leading-6
                      text-white/50
                    "
                  >
                    <p
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.28em]
                        text-cyan-100/60
                      "
                    >
                      {selectedStateFilterName}
                    </p>

                    <h3
                      className="
                        mt-4
                        text-3xl
                        font-black
                        tracking-[-0.04em]
                        text-white
                      "
                    >
                      No hay productos en este filtro.
                    </h3>

                    <p
                      className="
                        mt-4
                        max-w-4xl
                        text-sm
                        leading-6
                        text-white/50
                      "
                    >
                      {
                        dashboardMetrics.totalProducts > 0
                          ? "Hay productos registrados, pero ninguno coincide con el estado o busqueda actual. Revisa Todos los estados o Sin estado para asignarles una etapa."
                          : "Todavia no hay productos registrados. Cuando existan productos, podras asignarles estado desde esta seccion."
                      }
                    </p>

                    <div
                      className="
                        mt-6
                        flex
                        flex-wrap
                        gap-3
                      "
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setProductSearchTerm("")
                          setProductStateFilter("all")
                        }}
                        className="
                          rounded-2xl
                          border
                          border-cyan-300/25
                          bg-cyan-300/10
                          px-5
                          py-3
                          text-xs
                          font-bold
                          uppercase
                          tracking-[0.18em]
                          text-cyan-100
                          transition-all
                          duration-300
                          hover:bg-cyan-300/20
                        "
                      >
                        Ver todos
                      </button>

                      {
                        productsWithoutState > 0 && (

                          <button
                            type="button"
                            onClick={() => {
                              setProductSearchTerm("")
                              setProductStateFilter("no-state")
                            }}
                            className="
                              rounded-2xl
                              border
                              border-amber-200/20
                              bg-amber-200/[0.06]
                              px-5
                              py-3
                              text-xs
                              font-bold
                              uppercase
                              tracking-[0.18em]
                              text-amber-100
                              transition-all
                              duration-300
                              hover:bg-amber-200/[0.10]
                            "
                          >
                            Ver sin estado ({productsWithoutState})
                          </button>

                        )
                      }
                    </div>
                  </div>

                )
              }

              {
                isLoadingAdminProducts &&
                  adminProducts.length === 0 && (

                  <div
                    className="
                      mt-8
                      rounded-[28px]
                      border
                      border-cyan-300/15
                      bg-cyan-300/[0.04]
                      p-8
                      text-sm
                      leading-6
                      text-cyan-100/70
                    "
                  >
                    Cargando productos...
                  </div>

                )
              }

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
                  adminProducts.map(
                    (product) => {

                      const state =
                        productStates.find(
                          (item) =>
                            item.id === product.state_id
                        )

                      const progress =
                        state?.progress || 0

                      const isSavingState =
                        savingProductStateId ===
                        product.id

                      const productImage =
                        product.image_url ||
                        product.image ||
                        ""

                      const validationDecision =
                        normalizeValidationValue(
                          product.validation_decision
                        )

                      const surveyScore =
                        getValidNumber(
                          product.survey_score
                        )

                      const surveyVotes =
                        getValidNumber(
                          product.survey_votes
                        )

                      const socialScore =
                        getValidNumber(
                          product.social_interest_score
                        )

                      const canOpenProductDetail =
                        Boolean(product.slug)

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

                            <div
                              className="
                                flex
                                gap-5
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
                                  productImage ? (

                                    <img
                                      src={productImage}
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
                                        text-[10px]
                                        uppercase
                                        tracking-[0.22em]
                                        text-white/25
                                      "
                                    >
                                      IM
                                    </span>

                                  )
                                }
                              </div>

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
                                    text-3xl
                                    font-black
                                    tracking-[-0.04em]
                                    text-white
                                    sm:text-4xl
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
                                  {product.category || "Sin categoria"}
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

                          <div
                            className="
                              mt-6
                              grid
                              gap-4
                              lg:grid-cols-[1fr_1fr]
                            "
                          >
                            <label
                              className="
                                rounded-3xl
                                border
                                border-white/10
                                bg-black/25
                                p-4
                              "
                            >
                              <span
                                className="
                                  text-[10px]
                                  uppercase
                                  tracking-[0.24em]
                                  text-white/35
                                "
                              >
                                Estado operativo
                              </span>

                              <select
                                value={
                                  product.state_id ||
                                  ""
                                }
                                disabled={isSavingState}
                                onChange={(event) =>
                                  handleAdminProductStateChange(
                                    product,
                                    event.target.value
                                  )
                                }
                                className="
                                  mt-3
                                  w-full
                                  rounded-2xl
                                  border
                                  border-white/10
                                  bg-[#0b0b0b]
                                  px-4
                                  py-3
                                  text-sm
                                  text-white
                                  outline-none
                                  transition-all
                                  duration-300
                                  focus:border-cyan-300/40
                                  disabled:cursor-not-allowed
                                  disabled:opacity-60
                                "
                              >
                                <option value="">
                                  Sin estado
                                </option>

                                {
                                  productStates.map(
                                    (stateOption) => (

                                      <option
                                        key={stateOption.id}
                                        value={stateOption.id}
                                      >
                                        {stateOption.name}
                                      </option>

                                    )
                                  )
                                }
                              </select>

                              <p
                                className="
                                  mt-3
                                  text-xs
                                  leading-5
                                  text-white/35
                                "
                              >
                                {
                                  isSavingState
                                    ? "Guardando estado..."
                                    : "Cambio rapido sin notificacion automatica."
                                }
                              </p>
                            </label>

                            <div
                              className="
                                rounded-3xl
                                border
                                border-white/10
                                bg-black/25
                                p-4
                              "
                            >
                              <p
                                className="
                                  text-[10px]
                                  uppercase
                                  tracking-[0.24em]
                                  text-white/35
                                "
                              >
                                Validacion
                              </p>

                              <div
                                className="
                                  mt-4
                                  flex
                                  flex-wrap
                                  gap-2
                                "
                              >
                                <span
                                  className="
                                    rounded-full
                                    border
                                    border-amber-200/15
                                    bg-amber-200/[0.06]
                                    px-3
                                    py-2
                                    text-[10px]
                                    uppercase
                                    tracking-[0.18em]
                                    text-amber-100/80
                                  "
                                >
                                  Decision {validationDecision}
                                </span>

                                <span
                                  className="
                                    rounded-full
                                    border
                                    border-white/10
                                    bg-white/[0.04]
                                    px-3
                                    py-2
                                    text-[10px]
                                    uppercase
                                    tracking-[0.18em]
                                    text-white/55
                                  "
                                >
                                  Encuesta {
                                    surveyScore === null
                                      ? "N/A"
                                      : `${surveyScore}%`
                                  }
                                </span>

                                <span
                                  className="
                                    rounded-full
                                    border
                                    border-white/10
                                    bg-white/[0.04]
                                    px-3
                                    py-2
                                    text-[10px]
                                    uppercase
                                    tracking-[0.18em]
                                    text-white/55
                                  "
                                >
                                  {surveyVotes || 0} resp.
                                </span>

                                <span
                                  className="
                                    rounded-full
                                    border
                                    border-white/10
                                    bg-white/[0.04]
                                    px-3
                                    py-2
                                    text-[10px]
                                    uppercase
                                    tracking-[0.18em]
                                    text-white/55
                                  "
                                >
                                  Social {
                                    socialScore === null
                                      ? "N/A"
                                      : `${socialScore}%`
                                  }
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={
                              !canOpenProductDetail
                            }
                            onClick={() => {

                              if (
                                !canOpenProductDetail
                              ) {

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
                              disabled:cursor-not-allowed
                              disabled:border-white/5
                              disabled:bg-white/[0.02]
                              disabled:text-white/25
                            "
                          >
                            {
                              canOpenProductDetail
                                ? "Configurar producto"
                                : "Sin ruta para configurar"
                            }
                          </button>

                        </div>

                      )

                    }
                  )
                }

              </div>

              {
                hasMoreAdminProducts && (

                  <div
                    className="
                      mt-10
                      flex
                      justify-center
                    "
                  >
                    <button
                      type="button"
                      disabled={
                        isLoadingAdminProducts
                      }
                      onClick={() =>
                        loadAdminProductPage(
                          adminProductPage + 1,
                          "append"
                        )
                      }
                      className="
                        rounded-2xl
                        border
                        border-cyan-400/25
                        bg-cyan-400/10
                        px-6
                        py-3
                        text-sm
                        font-semibold
                        uppercase
                        tracking-[0.18em]
                        text-cyan-200
                        transition-all
                        duration-300
                        hover:bg-cyan-400/20
                        disabled:cursor-not-allowed
                        disabled:opacity-50
                      "
                    >
                      Ver más productos
                    </button>
                  </div>

                )
              }

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
          selectedMenu === "community" && (

            <div className="mt-16">

              <section
                className="
                  rounded-[34px]
                  border
                  border-cyan-300/15
                  bg-white/[0.035]
                  p-6
                  md:p-8
                "
              >
                <div
                  className="
                    flex
                    flex-col
                    gap-5
                    xl:flex-row
                    xl:items-end
                    xl:justify-between
                  "
                >
                  <div>
                    <p
                      className="
                        text-xs
                        uppercase
                        tracking-[0.32em]
                        text-cyan-100/60
                      "
                    >
                      Comunidad e intereses
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
                      Demanda real de la comunidad
                    </h2>

                    <p
                      className="
                        mt-3
                        max-w-3xl
                        text-sm
                        leading-7
                        text-white/50
                      "
                    >
                      Que areas generales elige la comunidad y que subnichos especificos tienen demanda real.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={loadCommunitySubscribers}
                    disabled={isLoadingCommunity}
                    className="
                      w-full
                      rounded-2xl
                      border
                      border-cyan-300/20
                      bg-cyan-300/10
                      px-5
                      py-3
                      text-xs
                      font-bold
                      uppercase
                      tracking-[0.22em]
                      text-cyan-100
                      transition-all
                      duration-300
                      hover:border-cyan-200/40
                      hover:bg-cyan-300/15
                      disabled:cursor-not-allowed
                      disabled:opacity-50
                      sm:w-auto
                    "
                  >
                    {isLoadingCommunity
                      ? "Actualizando"
                      : "Actualizar"}
                  </button>
                </div>

                {communityStats.totalSubscribers === 0 ? (
                  <div
                    className="
                      mt-8
                      rounded-3xl
                      border
                      border-white/10
                      bg-black/30
                      p-6
                      text-sm
                      text-white/50
                    "
                  >
                    No hay miembros registrados todavia.
                  </div>
                ) : (
                  <>
                    {communityStats.subscribersWithInterests === 0 && (
                      <div
                        className="
                          mt-8
                          rounded-3xl
                          border
                          border-amber-200/15
                          bg-amber-200/[0.06]
                          p-5
                          text-sm
                          leading-6
                          text-amber-100/80
                        "
                      >
                        Los intereses apareceran cuando la comunidad seleccione areas desde el popup o subnichos especificos desde Admin.
                      </div>
                    )}

                    <div
                      className="
                        mt-8
                        grid
                        grid-cols-1
                        gap-4
                        md:grid-cols-2
                        xl:grid-cols-3
                      "
                    >
                      {communityMetricCards.map(
                        (metric) => (
                          <div
                            key={metric.label}
                            className="
                              rounded-3xl
                              border
                              border-white/10
                              bg-black/30
                              p-5
                            "
                          >
                            <p className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                              {metric.label}
                            </p>

                            <p
                              className="
                                mt-4
                                min-h-[64px]
                                text-2xl
                                font-black
                                leading-tight
                                break-words
                                text-white
                              "
                            >
                              {metric.value}
                            </p>

                            <p className="mt-3 text-xs leading-5 text-white/40">
                              {metric.detail}
                            </p>
                          </div>
                        )
                      )}
                    </div>

                    <div
                      className="
                        mt-6
                        grid
                        grid-cols-1
                        gap-6
                        xl:grid-cols-3
                      "
                    >
                      <div
                        className="
                          rounded-3xl
                          border
                          border-white/10
                          bg-black/25
                          p-6
                        "
                      >
                        <p className="text-xs uppercase tracking-[0.28em] text-white/45">
                          Top 5 areas generales
                        </p>

                        <div className="mt-6 space-y-4">
                          {topCommunityAreas.length === 0 ? (
                            <p className="rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-white/45">
                              Las areas apareceran cuando la comunidad seleccione intereses desde el popup.
                            </p>
                          ) : (
                            topCommunityAreas.map(
                              (area) => {
                                const width =
                                  Math.max(
                                    8,
                                    Math.round(
                                      (
                                        area.count /
                                        maxTopCommunityAreaCount
                                      ) * 100
                                    )
                                  )

                                return (
                                  <div
                                    key={area.area_id}
                                    className="space-y-2"
                                  >
                                    <div className="flex items-center justify-between gap-4 text-sm">
                                      <span className="min-w-0 break-words font-semibold text-white/80">
                                        {area.area_label}
                                      </span>
                                      <span className="text-white/45">
                                        {area.count}
                                      </span>
                                    </div>

                                    {area.area_description && (
                                      <p className="text-xs leading-5 text-cyan-100/45">
                                        {area.area_description}
                                      </p>
                                    )}

                                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className="h-full rounded-full bg-cyan-300"
                                        style={{
                                          width:
                                            `${width}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                )
                              }
                            )
                          )}
                        </div>
                      </div>

                      <div
                        className="
                          rounded-3xl
                          border
                          border-white/10
                          bg-black/25
                          p-6
                        "
                      >
                        <p className="text-xs uppercase tracking-[0.28em] text-white/45">
                          Top 5 nichos especificos
                        </p>

                        <div className="mt-6 space-y-4">
                          {topCommunityNiches.length === 0 ? (
                            <p className="rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-white/45">
                              Los nichos especificos apareceran cuando existan subnichos reales seleccionados.
                            </p>
                          ) : (
                            topCommunityNiches.map(
                              (niche) => {
                                const width =
                                  Math.max(
                                    8,
                                    Math.round(
                                      (
                                        niche.count /
                                        maxTopCommunityNicheCount
                                      ) * 100
                                    )
                                  )

                                return (
                                  <div
                                    key={niche.niche_id}
                                    className="space-y-2"
                                  >
                                    <div className="flex items-center justify-between gap-4 text-sm">
                                      <span className="min-w-0 break-words font-semibold text-white/80">
                                        {niche.niche_public_name || niche.niche_name}
                                      </span>
                                      <span className="text-white/45">
                                        {niche.count}
                                      </span>
                                    </div>

                                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className="h-full rounded-full bg-cyan-300"
                                        style={{
                                          width:
                                            `${width}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                )
                              }
                            )
                          )}
                        </div>
                      </div>

                      <div
                        className="
                          rounded-3xl
                          border
                          border-white/10
                          bg-black/25
                          p-6
                        "
                      >
                        <p className="text-xs uppercase tracking-[0.28em] text-white/45">
                          Top 5 subnichos especificos
                        </p>

                        <div className="mt-6 space-y-4">
                          {topCommunitySubniches.length === 0 ? (
                            <p className="rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-white/45">
                              Los subnichos apareceran cuando Admin o una accion especifica registre intereses detallados.
                            </p>
                          ) : (
                            topCommunitySubniches.map(
                              (subniche) => {
                                const width =
                                  Math.max(
                                    8,
                                    Math.round(
                                      (
                                        subniche.count /
                                        maxTopCommunitySubnicheCount
                                      ) * 100
                                    )
                                  )

                                return (
                                  <div
                                    key={subniche.subniche_id}
                                    className="space-y-2"
                                  >
                                    <div className="flex items-center justify-between gap-4 text-sm">
                                      <span className="min-w-0 break-words font-semibold text-white/80">
                                        {subniche.subniche_public_name || subniche.subniche_name}
                                      </span>
                                      <span className="text-white/45">
                                        {subniche.count}
                                      </span>
                                    </div>

                                    {subniche.niche_public_name && (
                                      <p className="text-xs text-cyan-100/45">
                                        {subniche.niche_public_name}
                                      </p>
                                    )}

                                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                      <div
                                        className="h-full rounded-full bg-cyan-300"
                                        style={{
                                          width:
                                            `${width}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                )
                              }
                            )
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="
                        mt-6
                        rounded-3xl
                        border
                        border-emerald-300/15
                        bg-emerald-300/[0.04]
                        p-6
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
                          <p className="text-xs uppercase tracking-[0.28em] text-emerald-100/60">
                            Demanda vs Productos
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
                            Oportunidades por subnicho especifico
                          </h3>

                          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">
                            Compara subnichos especificos guardados en subscriber_interests con productos asociados y encuestas activas.
                          </p>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs leading-5 text-white/45">
                          Lectura de diagnostico. No crea encuestas ni cambia estados.
                        </div>
                      </div>

                      {subnicheDemandWithProducts.length === 0 ? (
                        <p className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-5 text-sm leading-6 text-white/45">
                          No hay suficiente informacion de comunidad para cruzar demanda y productos todavia.
                        </p>
                      ) : (
                        <div className="mt-6 overflow-x-auto">
                          <table className="min-w-[1080px] w-full border-separate border-spacing-y-3 text-left">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                                <th className="px-4 py-2">
                                  Subnicho
                                </th>
                                <th className="px-4 py-2">
                                  Nicho
                                </th>
                                <th className="px-4 py-2">
                                  Miembros
                                </th>
                                <th className="px-4 py-2">
                                  Productos asociados
                                </th>
                                <th className="px-4 py-2">
                                  Encuestas
                                </th>
                                <th className="px-4 py-2">
                                  Estado
                                </th>
                                <th className="px-4 py-2">
                                  Futuro
                                </th>
                              </tr>
                            </thead>

                            <tbody>
                              {subnicheDemandWithProducts.map(
                                (demand) => (
                                  <tr
                                    key={demand.subniche_id}
                                    className="bg-black/30"
                                  >
                                    <td className="rounded-l-2xl border-y border-l border-white/10 px-4 py-4">
                                      <p className="text-sm font-semibold text-white/85">
                                        {demand.subniche_public_name || demand.subniche_name}
                                      </p>
                                    </td>

                                    <td className="border-y border-white/10 px-4 py-4">
                                      <p className="text-sm text-cyan-100/60">
                                        {demand.niche_public_name || demand.niche_name || "Sin nicho"}
                                      </p>
                                    </td>

                                    <td className="border-y border-white/10 px-4 py-4">
                                      <p className="text-lg font-black text-white">
                                        {demand.interested_members_count.toLocaleString("es-NI")}
                                      </p>
                                      <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/30">
                                        interesados
                                      </p>
                                    </td>

                                    <td className="border-y border-white/10 px-4 py-4">
                                      {demand.products.length === 0 ? (
                                        <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40">
                                          Sin producto asociado
                                        </p>
                                      ) : (
                                        <div className="space-y-3">
                                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">
                                            {demand.products_count === 1
                                              ? "1 producto asociado"
                                              : `${demand.products_count.toLocaleString("es-NI")} productos asociados`}
                                          </p>

                                          {demand.products.slice(0, 3).map(
                                            (product) => (
                                              <div
                                                key={product.id}
                                                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2"
                                              >
                                                <div className="min-w-0">
                                                  <p className="truncate text-xs font-semibold text-white/75">
                                                    {product.name}
                                                  </p>

                                                  {(product.validation_status || product.survey_status) && (
                                                    <p className="mt-1 truncate text-[10px] uppercase tracking-[0.12em] text-white/30">
                                                      {product.validation_status || "sin validacion"} · {product.survey_status || "sin encuesta"}
                                                    </p>
                                                  )}
                                                </div>

                                                {product.slug ? (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      router.push(
                                                        `/admin/products/${product.slug}`
                                                      )
                                                    }
                                                    className="shrink-0 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100 transition-all hover:bg-cyan-300/15"
                                                  >
                                                    Ver detalle
                                                  </button>
                                                ) : (
                                                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-white/25">
                                                    Sin detalle
                                                  </span>
                                                )}
                                              </div>
                                            )
                                          )}

                                          {demand.products_count > 3 && (
                                            <p className="text-xs text-white/35">
                                              +{(demand.products_count - 3).toLocaleString("es-NI")} productos mas
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </td>

                                    <td className="border-y border-white/10 px-4 py-4">
                                      <p className="text-lg font-black text-white">
                                        {demand.active_surveys_count.toLocaleString("es-NI")}
                                      </p>
                                      <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/30">
                                        activas / {demand.total_surveys_count.toLocaleString("es-NI")} total
                                      </p>
                                    </td>

                                    <td className="border-y border-white/10 px-4 py-4">
                                      <span
                                        className={`
                                          inline-flex
                                          rounded-full
                                          border
                                          px-3
                                          py-2
                                          text-[10px]
                                          font-semibold
                                          uppercase
                                          tracking-[0.14em]
                                          ${demandOpportunityClassNames[demand.opportunity_status]}
                                        `}
                                      >
                                        {demandOpportunityLabels[demand.opportunity_status]}
                                      </span>
                                    </td>

                                    <td className="rounded-r-2xl border-y border-r border-white/10 px-4 py-4">
                                      <div className="flex flex-wrap gap-2">
                                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-white/35">
                                          Crear encuesta
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>

              <div
                className="
                  mt-8
                  grid
                  grid-cols-1
                  gap-6
                  xl:grid-cols-[1.1fr_0.9fr]
                "
              >

                <div
                  className="
                    rounded-3xl
                    border
                    border-cyan-400/20
                    bg-cyan-400/[0.05]
                    p-8
                  "
                >
                  <p
                    className="
                      text-xs
                      uppercase
                      tracking-[0.3em]
                      text-cyan-200/70
                    "
                  >
                    Comunidad WhatsApp
                  </p>

                  <h2
                    className="
                      mt-4
                      text-4xl
                      font-black
                      text-white
                    "
                  >
                    Agregar contacto manual
                  </h2>

                  <p
                    className="
                      mt-4
                      max-w-2xl
                      text-sm
                      leading-7
                      text-white/50
                    "
                  >
                    Usa este modulo cuando una persona autorizo ser parte de la comunidad por llamada, evento, tienda fisica, redes sociales o WhatsApp.
                  </p>

                  <div
                    className="
                      mt-8
                      grid
                      grid-cols-1
                      gap-5
                      md:grid-cols-2
                    "
                  >
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.25em] text-white/45">
                        Nombre
                      </span>
                      <input
                        value={manualSubscriberForm.nombre}
                        onChange={(event) =>
                          updateManualSubscriberField(
                            "nombre",
                            event.target.value
                          )
                        }
                        placeholder="Ej: Maria Lopez"
                        className="
                          w-full
                          rounded-2xl
                          border
                          border-white/10
                          bg-black/40
                          px-5
                          py-4
                          text-white
                          outline-none
                        "
                      />
                      <p className="text-xs leading-5 text-white/35">
                        Identifica a la persona de forma humana y clara.
                      </p>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.25em] text-white/45">
                        WhatsApp
                      </span>
                      <input
                        value={manualSubscriberForm.telefono}
                        onChange={(event) =>
                          updateManualSubscriberField(
                            "telefono",
                            event.target.value
                          )
                        }
                        placeholder="86546986 o 50586546986"
                        className="
                          w-full
                          rounded-2xl
                          border
                          border-white/10
                          bg-black/40
                          px-5
                          py-4
                          text-white
                          outline-none
                        "
                      />
                      <p className="text-xs leading-5 text-white/35">
                        Puede ser numero nacional de 8 digitos o formato internacional.
                      </p>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.25em] text-white/45">
                        Email opcional
                      </span>
                      <input
                        value={manualSubscriberForm.email}
                        onChange={(event) =>
                          updateManualSubscriberField(
                            "email",
                            event.target.value
                          )
                        }
                        placeholder="cliente@correo.com"
                        className="
                          w-full
                          rounded-2xl
                          border
                          border-white/10
                          bg-black/40
                          px-5
                          py-4
                          text-white
                          outline-none
                        "
                      />
                      <p className="text-xs leading-5 text-white/35">
                        Si no existe email, deja este campo vacio.
                      </p>
                    </label>

                    <div className="space-y-4 md:col-span-2">
                      <div>
                        <span className="text-xs uppercase tracking-[0.25em] text-cyan-100/60">
                          Intereses normalizados
                        </span>
                        <p className="mt-2 text-xs leading-5 text-white/35">
                          Selecciona subnichos especificos de IMNOVA OS. Se guardan en subscriber_interests; las areas generales del popup viven en subscriber_area_interests.
                        </p>
                      </div>

                      {communityNichesWithSubniches.length === 0 ? (
                        <div
                          className="
                            rounded-2xl
                            border
                            border-white/10
                            bg-black/30
                            p-5
                            text-sm
                            text-white/45
                          "
                        >
                          No se pudieron cargar los intereses publicos. Actualiza la comunidad o revisa las politicas de lectura.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {communityNichesWithSubniches.map(
                            (niche) => (
                              <div
                                key={niche.id}
                                className="
                                  rounded-2xl
                                  border
                                  border-white/10
                                  bg-black/25
                                  p-4
                                "
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <h4 className="text-sm font-bold text-white/85">
                                    {niche.public_name || niche.name}
                                  </h4>
                                  <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                                    {niche.subniches.length} opciones
                                  </span>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                  {niche.subniches.map(
                                    (subniche) => {
                                      const isSelected =
                                        selectedManualSubnicheIds.includes(
                                          subniche.id
                                        )

                                      const isDisabled =
                                        !isSelected &&
                                        selectedManualSubnicheIds.length >=
                                          MAX_MANUAL_COMMUNITY_INTERESTS

                                      return (
                                        <button
                                          key={subniche.id}
                                          type="button"
                                          disabled={isDisabled}
                                          onClick={() =>
                                            toggleManualSubniche(
                                              subniche.id
                                            )
                                          }
                                          className={`
                                            rounded-full
                                            border
                                            px-4
                                            py-2
                                            text-xs
                                            font-semibold
                                            transition-all
                                            duration-300
                                            ${
                                              isSelected
                                                ? "border-cyan-300/45 bg-cyan-300/[0.14] text-cyan-50"
                                                : isDisabled
                                                ? "cursor-not-allowed border-white/5 bg-white/[0.02] text-white/25"
                                                : "border-white/10 bg-white/[0.04] text-white/62 hover:border-cyan-300/25 hover:bg-cyan-300/[0.08]"
                                            }
                                          `}
                                        >
                                          {subniche.public_name || subniche.name}
                                        </button>
                                      )
                                    }
                                  )}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      )}

                      <p className="text-xs leading-5 text-white/40">
                        {selectedManualSubnicheIds.length}/{MAX_MANUAL_COMMUNITY_INTERESTS} intereses seleccionados.
                      </p>
                    </div>

                    <label className="space-y-2 md:col-span-2">
                      <span className="text-xs uppercase tracking-[0.25em] text-white/45">
                        Contexto / consentimiento
                      </span>
                      <textarea
                        value={manualSubscriberForm.objetivo_principal}
                        onChange={(event) =>
                          updateManualSubscriberField(
                            "objetivo_principal",
                            event.target.value
                          )
                        }
                        rows={4}
                        placeholder="Ej: Cliente dio autorizacion en tienda fisica para recibir novedades IMNOVA."
                        className="
                          w-full
                          rounded-2xl
                          border
                          border-white/10
                          bg-black/40
                          px-5
                          py-4
                          text-white
                          outline-none
                        "
                      />
                      <p className="text-xs leading-5 text-white/35">
                        Deja claro de donde viene el contacto y por que se agrega.
                      </p>
                    </label>
                  </div>

                  {(communityMessage || communityError) && (
                    <div
                      className={`
                        mt-6
                        rounded-2xl
                        border
                        px-5
                        py-4
                        text-sm
                        ${
                          communityError
                            ? "border-red-400/20 bg-red-500/10 text-red-200"
                            : "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                        }
                      `}
                    >
                      {communityError || communityMessage}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={isSavingCommunitySubscriber}
                    onClick={handleCreateManualSubscriber}
                    className="
                      mt-8
                      rounded-2xl
                      border
                      border-cyan-300/30
                      bg-cyan-300
                      px-7
                      py-4
                      text-sm
                      font-bold
                      uppercase
                      tracking-[0.22em]
                      text-black
                      transition-all
                      duration-300
                      hover:scale-[1.02]
                      disabled:cursor-not-allowed
                      disabled:opacity-60
                    "
                  >
                    {isSavingCommunitySubscriber
                      ? "Guardando..."
                      : "Agregar a comunidad"}
                  </button>
                </div>

                <div className="space-y-6">
                  <div
                    className="
                      rounded-3xl
                      border
                      border-white/10
                      bg-white/[0.03]
                      p-7
                    "
                  >
                    <p className="text-xs uppercase tracking-[0.28em] text-white/45">
                      Como usarlo
                    </p>
                    <h3 className="mt-4 text-2xl font-bold text-white">
                      Registro manual, no improvisado
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-white/50">
                      Este modulo complementa los registros que llegan desde la web. Sirve para crecer mas rapido cuando el contacto viene desde tienda, evento, llamada o redes.
                    </p>
                    <div className="mt-6 space-y-3 text-sm text-white/55">
                      <p>1. Confirma permiso para recibir mensajes.</p>
                      <p>2. Registra WhatsApp y nicho de interes.</p>
                      <p>3. Usa el detalle del producto para notificaciones manuales.</p>
                    </div>
                  </div>

                  <div
                    className="
                      rounded-3xl
                      border
                      border-white/10
                      bg-white/[0.03]
                      p-7
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
                        <p className="text-xs uppercase tracking-[0.28em] text-white/45">
                          Comunidad reciente
                        </p>
                        <h3 className="mt-3 text-2xl font-bold text-white">
                          Ultimos registros
                        </h3>
                      </div>

                      <button
                        type="button"
                        onClick={loadCommunitySubscribers}
                        disabled={isLoadingCommunity}
                        className="
                          rounded-xl
                          border
                          border-white/10
                          px-4
                          py-2
                          text-xs
                          uppercase
                          tracking-[0.18em]
                          text-white/60
                          disabled:opacity-50
                        "
                      >
                        {isLoadingCommunity
                          ? "Cargando"
                          : "Actualizar"}
                      </button>
                    </div>

                    <div className="mt-6 space-y-3">
                      {communitySubscribers.length === 0 ? (
                        <p className="rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-white/45">
                          No hay miembros registrados todavia.
                        </p>
                      ) : (
                        communitySubscribers.map(
                          (subscriber) => {
                            const normalizedInterests =
                              subscriber.interests.map(
                                (interest) =>
                                  interest.subniche_public_name ||
                                  interest.subniche_name
                              )

                            const areaInterests =
                              subscriber.area_interests.map(
                                (interest) =>
                                  interest.area_label
                              )

                            return (
                              <div
                                key={subscriber.id}
                                className="
                                  rounded-2xl
                                  border
                                  border-white/10
                                  bg-black/30
                                  p-5
                                "
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <h4 className="font-bold text-white">
                                      {subscriber.nombre || "Miembro IMNOVA"}
                                    </h4>
                                    <p className="mt-2 text-sm text-cyan-100/70">
                                      {subscriber.telefono || subscriber.email || "Sin contacto"}
                                    </p>
                                    {subscriber.email && subscriber.telefono && (
                                      <p className="mt-1 text-xs text-white/35">
                                        {subscriber.email}
                                      </p>
                                    )}
                                  </div>
                                  <span className="rounded-full border border-cyan-300/20 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100/60">
                                    {formatCommunityDate(
                                      subscriber.created_at
                                    )}
                                  </span>
                                </div>

                                {areaInterests.length > 0 && (
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {areaInterests
                                      .slice(
                                        0,
                                        3
                                      )
                                      .map(
                                        (interest) => (
                                          <span
                                            key={interest}
                                            className="
                                              rounded-full
                                              border
                                              border-emerald-300/15
                                              bg-emerald-300/[0.08]
                                              px-3
                                              py-1
                                              text-[11px]
                                              text-emerald-50/75
                                            "
                                          >
                                            Area: {interest}
                                          </span>
                                        )
                                      )}
                                  </div>
                                )}

                                {normalizedInterests.length > 0 ? (
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {normalizedInterests
                                      .slice(
                                        0,
                                        4
                                      )
                                      .map(
                                        (interest) => (
                                          <span
                                            key={interest}
                                            className="
                                              rounded-full
                                              border
                                              border-cyan-300/15
                                              bg-cyan-300/[0.08]
                                              px-3
                                              py-1
                                              text-[11px]
                                              text-cyan-50/75
                                            "
                                          >
                                            Subnicho: {interest}
                                          </span>
                                        )
                                      )}
                                  </div>
                                ) : areaInterests.length === 0 ? (
                                  <p className="mt-4 text-xs leading-5 text-white/35">
                                    Sin areas ni subnichos normalizados utiles todavia.
                                  </p>
                                ) : null}

                                {subscriber.objetivo_principal && (
                                  <p className="mt-4 text-xs leading-5 text-white/40">
                                    {subscriber.objetivo_principal}
                                  </p>
                                )}
                              </div>
                            )
                          }
                        )
                      )}
                    </div>
                  </div>
                </div>

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
                    {dashboardMetrics.totalProducts}
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

                    <div>

                      <input
                        value={campaignProduct}
                        onChange={(e) =>
                          setCampaignProduct(
                            e.target.value
                          )
                        }
                        list="campaign-product-options"
                        placeholder="Buscar producto existente"
                        className="
                          w-full
                          rounded-2xl
                          border
                          border-white/10
                          bg-white/[0.03]
                          p-4
                          text-white
                          outline-none
                          transition-all
                          duration-300
                          placeholder:text-white/30
                          focus:border-cyan-300/40
                        "
                      />

                      <datalist id="campaign-product-options">
                        {
                          campaignProductSuggestions.map(
                            (product) => (

                              <option
                                key={product.id}
                                value={product.name}
                              />

                            )
                          )
                        }
                      </datalist>

                      <p
                        className="
                          mt-2
                          text-xs
                          uppercase
                          tracking-[0.18em]
                          text-white/35
                        "
                      >
                        {
                          isLoadingCampaignProductSuggestions
                            ? "Buscando productos..."
                            : `${campaignProductSuggestions.length} sugerencias`
                        }
                      </p>

                    </div>

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
