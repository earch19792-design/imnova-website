"use client"

import {
  useCallback,
  useEffect,
  useState,
} from "react"

import {
  useParams,
  useRouter,
} from "next/navigation"

import {
  createCommunitySurvey,
  createSocialSignal,
  createSurveyResponse,
  getCommunitySurveysByProduct,
  getNotificationLogsByProduct,
  getProductBySlug,
  getProductStates,
  getSocialSignalsByProduct,
  getSurveyResponsesByProduct,
  type CommunitySurvey,
  type NotificationLog,
  type SocialSignal,
  type SurveyResponse,
  updateProduct,
} from "@/lib/products-service"

type DistributionChannel = {
  id: string
  country?: string
  city?: string
  type: string
  name: string
  location: string
  status: string
  url?: string
  note?: string
}

type Product = {
  id: string
  slug: string
  state_id: string | null
  name: string
  category: string
  commercial_category?: string | null
  strategic_niche_id?: string | null
  primary_subniche_id?: string | null
  target_customer?: string | null
  usage_moment?: string | null
  main_benefit?: string | null
  how_to_use?: string | null
  usage_description?: string | null
  routine_suggestion?: string[] | string | null
  benefits?: string[] | string | null
  functional_claims?: string[] | string | null
  ingredients_summary?: string | null
  lifestyle_image?: string | null
  lifestyle_images?: string[] | string | null
  description?: string | null
  image_url?: string | null
  image?: string | null
  price?: number | null
  currency?: string | null
  direct_url?: string | null
  amazon_url?: string | null
  ebay_url?: string | null
  tiktok_url?: string | null
  distribution_channels?: DistributionChannel[] | string | null
  commercial_notes?: string | null
  nicho?: string | null
  problema_resuelve?: string | null
  expected_benefit?: string | null
  survey_status?: string | null
  survey_score?: number | string | null
  survey_votes?: number | string | null
  social_interest_score?: number | string | null
  validation_status?: string | null
  validation_decision?: string | null
  validation_notes?: string | null
  bullets?: string[] | string | null
}

type ProductState = {
  id: string
  name: string
  progress: number
}

const officialStateFlow = [
  "Idea",
  "Validación",
  "Priorizado",
  "Testing",
  "Producción",
  "Comercialización",
  "Disponible",
]

type StateRecommendation = {
  currentStateName: string
  decision: string
  recommendedStateName: string
  recommendationTitle: string
  recommendationDescription: string
  riskLevel: "success" | "warning" | "danger" | "neutral"
}

function getNextStateRecommendation({
  currentStateName,
  decision,
}: {
  currentStateName: string
  decision: string
}): StateRecommendation {
  const normalizedDecision =
    decision || "pendiente"

  if (normalizedDecision === "avanzar") {
    const currentIndex =
      officialStateFlow.indexOf(
        currentStateName
      )

    const nextState =
      currentIndex >= 0
        ? officialStateFlow[
            currentIndex + 1
          ]
        : officialStateFlow[0]

    if (!nextState) {
      return {
        currentStateName,
        decision: normalizedDecision,
        recommendedStateName:
          "Sin siguiente estado",
        recommendationTitle:
          "Producto ya esta en etapa final",
        recommendationDescription:
          "Este producto ya esta en Disponible. No hay un siguiente estado dentro del flujo oficial.",
        riskLevel: "success",
      }
    }

    return {
      currentStateName,
      decision: normalizedDecision,
      recommendedStateName: nextState,
      recommendationTitle:
        "Puede avanzar",
      recommendationDescription:
        "Los datos de validacion sugieren que este producto puede avanzar al siguiente estado.",
      riskLevel: "success",
    }
  }

  if (normalizedDecision === "ajustar") {
    return {
      currentStateName,
      decision: normalizedDecision,
      recommendedStateName:
        "Mantener en validacion",
      recommendationTitle:
        "Requiere ajustes",
      recommendationDescription:
        "La idea requiere ajustes antes de avanzar. Revisa nicho, problema humano, beneficio esperado o respuesta de comunidad.",
      riskLevel: "warning",
    }
  }

  if (normalizedDecision === "pausar") {
    return {
      currentStateName,
      decision: normalizedDecision,
      recommendedStateName:
        "No avanzar por ahora",
      recommendationTitle:
        "Pausar avance",
      recommendationDescription:
        "La validacion sugiere pausar este producto hasta obtener mayor interes o nueva evidencia.",
      riskLevel: "neutral",
    }
  }

  if (normalizedDecision === "descartar") {
    return {
      currentStateName,
      decision: normalizedDecision,
      recommendedStateName:
        "No avanzar",
      recommendationTitle:
        "No continuar por ahora",
      recommendationDescription:
        "La validacion indica que esta idea no deberia avanzar por ahora.",
      riskLevel: "danger",
    }
  }

  return {
    currentStateName,
    decision: "pendiente",
    recommendedStateName:
      "Sin recomendacion",
    recommendationTitle:
      "Decision pendiente",
    recommendationDescription:
      "Aun no hay decision suficiente para recomendar avance.",
    riskLevel: "neutral",
  }
}

type FormData = {
  name: string
  category: string
  description: string
  image_url: string
  price: string
  currency: string
  state_id: string
  nicho: string
  problema_resuelve: string
  expected_benefit: string
  survey_status: string
  survey_score: string
  survey_votes: string
  social_interest_score: string
  validation_status: string
  validation_decision: string
  validation_notes: string
  usage_moment: string
  main_benefit: string
  how_to_use: string
  usage_description: string
  routine_suggestion: string
  benefits: string
  bullets: string
  functional_claims: string
  ingredients_summary: string
  lifestyle_images: string
  direct_url: string
  amazon_url: string
  ebay_url: string
  tiktok_url: string
  distribution_channels: string
  commercial_notes: string
}

type ProductUpdateData = {
  name: string
  category: string
  description: string | null
  image_url: string | null
  price: number | null
  currency: string | null
  state_id: string | null
  nicho?: string | null
  problema_resuelve?: string | null
  expected_benefit?: string | null
  survey_status?: string | null
  survey_score?: number | null
  survey_votes?: number
  social_interest_score?: number | null
  validation_status?: string | null
  validation_decision?: string | null
  validation_notes?: string | null
  usage_moment?: string | null
  main_benefit?: string | null
  how_to_use?: string | null
  usage_description?: string | null
  routine_suggestion?: string[]
  benefits?: string[]
  bullets?: string[]
  functional_claims?: string[]
  ingredients_summary?: string | null
  lifestyle_image?: string | null
  lifestyle_images?: string[]
  direct_url?: string | null
  amazon_url?: string | null
  ebay_url?: string | null
  tiktok_url?: string | null
  distribution_channels?: DistributionChannel[]
  commercial_notes?: string | null
}

type CommunitySurveyFormData = {
  title: string
  question: string
  description: string
  channel: string
  status: string
  target_audience: string
}

type SurveyResponseFormData = {
  survey_id: string
  channel: string
  respondent_name: string
  respondent_phone: string
  respondent_email: string
  response_value: string
  response_label: string
  score: string
  comment: string
  source: string
}

type SocialSignalFormData = {
  platform: string
  metric_name: string
  metric_value: string
  sentiment: string
  notes: string
}

const sections = [
  {
    id: "general",
    label: "General",
  },
  {
    id: "estado",
    label: "Estado",
  },
  {
    id: "validacion",
    label: "Validacion",
  },
  {
    id: "comercializacion",
    label: "Comercializacion",
  },
  {
    id: "contenido",
    label: "Contenido",
  },
  {
    id: "notificaciones",
    label: "Notificaciones",
  },
]

const inputClassName =
  "mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-cyan-300/50"

const MAX_LIFESTYLE_IMAGES = 3

const defaultSurveyFormData: CommunitySurveyFormData = {
  title: "",
  question: "",
  description: "",
  channel: "multi_channel",
  status: "draft",
  target_audience: "",
}

const defaultResponseFormData: SurveyResponseFormData = {
  survey_id: "",
  channel: "whatsapp",
  respondent_name: "",
  respondent_phone: "",
  respondent_email: "",
  response_value: "",
  response_label: "",
  score: "",
  comment: "",
  source: "admin_manual",
}

const defaultSocialSignalFormData: SocialSignalFormData = {
  platform: "instagram",
  metric_name: "",
  metric_value: "",
  sentiment: "neutral",
  notes: "",
}

const surveyChannels = [
  "whatsapp",
  "instagram",
  "facebook",
  "tiktok",
  "email",
  "multi_channel",
]

const surveyStatuses = [
  "draft",
  "active",
  "closed",
]

const socialPlatforms = [
  "instagram",
  "facebook",
  "tiktok",
  "whatsapp",
  "website",
  "other",
]

const socialSentiments = [
  "positive",
  "neutral",
  "negative",
  "mixed",
]

function normalizeEditableList(
  value?: string[] | string | null
) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map(item => String(item).trim())
      .filter(Boolean)
  }

  const trimmedValue =
    value.trim()

  if (!trimmedValue) {
    return []
  }

  try {
    const parsed =
      JSON.parse(trimmedValue)

    if (Array.isArray(parsed)) {
      return parsed
        .map(item => String(item).trim())
        .filter(Boolean)
    }
  } catch {
    // Allows existing comma or line separated values during migration.
  }

  return trimmedValue
    .split(/,|\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function listToLines(
  value?: string[] | string | null
) {
  return normalizeEditableList(value)
    .join("\n")
}

function linesToList(value: string) {
  return value
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function getStringValue(
  value: unknown
) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function normalizeDistributionChannels(
  value?: DistributionChannel[] | string | null
) {
  if (!value) {
    return []
  }

  if (typeof value === "string") {
    const trimmedValue =
      value.trim()

    if (!trimmedValue) {
      return []
    }

    try {
      const parsed =
        JSON.parse(trimmedValue)

      if (!Array.isArray(parsed)) {
        return []
      }

      return normalizeDistributionChannels(
        parsed as DistributionChannel[]
      )
    } catch {
      return []
    }
  }

  return value
    .filter(
      item =>
        item &&
        typeof item === "object"
    )
    .map(
      (item, index) => ({
        id:
          getStringValue(item.id) ||
          `channel-${index + 1}`,
        country:
          getStringValue(item.country) ||
          undefined,
        city:
          getStringValue(item.city) ||
          undefined,
        type:
          getStringValue(item.type) ||
          "marketplace",
        name:
          getStringValue(item.name),
        location:
          getStringValue(item.location),
        status:
          getStringValue(item.status) ||
          "active",
        url:
          getStringValue(item.url) ||
          undefined,
        note:
          getStringValue(item.note) ||
          undefined,
      })
    )
    .filter(
      item =>
        item.name ||
        item.location ||
        item.url
    )
}

function distributionChannelsToText(
  value?: DistributionChannel[] | string | null
) {
  const channels =
    normalizeDistributionChannels(value)

  return channels.length
    ? JSON.stringify(
        channels,
        null,
        2
      )
    : ""
}

function parseDistributionChannelsInput(
  value: string
) {
  const trimmedValue =
    value.trim()

  if (!trimmedValue) {
    return {
      channels: [],
      error: "",
    }
  }

  try {
    const parsed =
      JSON.parse(trimmedValue)

    if (!Array.isArray(parsed)) {
      return {
        channels: [],
        error:
          "Los canales de distribucion deben ser un array JSON.",
      }
    }

    return {
      channels:
        normalizeDistributionChannels(
          parsed as DistributionChannel[]
        ),
      error: "",
    }
  } catch {
    return {
      channels: [],
      error:
        "Los canales de distribucion deben tener formato JSON valido.",
    }
  }
}

function getInitialFormData(
  product: Product
): FormData {

  return {
    name:
      product.name || "",
    category:
      product.category || "",
    description:
      product.description || "",
    image_url:
      product.image_url || "",
    price:
      product.price === null ||
      product.price === undefined
        ? ""
        : String(product.price),
    currency:
      product.currency || "USD",
    state_id:
      product.state_id || "",
    nicho:
      product.nicho || "",
    problema_resuelve:
      product.problema_resuelve || "",
    expected_benefit:
      product.expected_benefit || "",
    survey_status:
      product.survey_status || "pendiente",
    survey_score:
      product.survey_score === null ||
      product.survey_score === undefined
        ? ""
        : String(product.survey_score),
    survey_votes:
      product.survey_votes === null ||
      product.survey_votes === undefined
        ? "0"
        : String(product.survey_votes),
    social_interest_score:
      product.social_interest_score === null ||
      product.social_interest_score === undefined
        ? ""
        : String(product.social_interest_score),
    validation_status:
      product.validation_status || "pendiente",
    validation_decision:
      product.validation_decision || "pendiente",
    validation_notes:
      product.validation_notes || "",
    usage_moment:
      product.usage_moment || "",
    main_benefit:
      product.main_benefit || "",
    how_to_use:
      product.how_to_use || "",
    usage_description:
      product.usage_description || "",
    routine_suggestion:
      listToLines(product.routine_suggestion),
    benefits:
      listToLines(product.benefits),
    bullets:
      listToLines(product.bullets),
    functional_claims:
      listToLines(product.functional_claims),
    ingredients_summary:
      product.ingredients_summary || "",
    lifestyle_images:
      listToLines(
        product.lifestyle_images ||
          product.lifestyle_image
      ),
    direct_url:
      product.direct_url || "",
    amazon_url:
      product.amazon_url || "",
    ebay_url:
      product.ebay_url || "",
    tiktok_url:
      product.tiktok_url || "",
    distribution_channels:
      distributionChannelsToText(
        product.distribution_channels
      ),
    commercial_notes:
      product.commercial_notes || "",
  }

}

function formatNotificationDate(
  value?: string | null
) {

  if (!value) {
    return "Sin fecha"
  }

  const date =
    new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "Fecha no disponible"
  }

  return new Intl.DateTimeFormat(
    "es-NI",
    {
      dateStyle:
        "medium",
      timeStyle:
        "short",
    }
  ).format(date)

}

function getAverageValue(
  values: Array<number | string | null | undefined>
) {

  const numbers =
    values
      .map(value =>
        typeof value === "number"
          ? value
          : value
            ? Number(value)
            : Number.NaN
      )
      .filter(value =>
        Number.isFinite(value)
      )

  if (!numbers.length) {
    return null
  }

  const total =
    numbers.reduce(
      (sum, value) =>
        sum + value,
      0
    )

  return Math.round(
    total / numbers.length
  )

}

export default function ProductDetailPage() {
  const router = useRouter()
  const params = useParams()

  const slug = String(params.slug || "")

  const [isAuthenticated, setIsAuthenticated] =
    useState(false)

  const [product, setProduct] =
    useState<Product | null>(null)

  const [states, setStates] =
    useState<ProductState[]>([])

  const [activeSection, setActiveSection] =
    useState("general")

  const [formData, setFormData] =
    useState<FormData>({
      name: "",
      category: "",
      description: "",
      image_url: "",
      price: "",
      currency: "USD",
      state_id: "",
      nicho: "",
      problema_resuelve: "",
      expected_benefit: "",
      survey_status: "pendiente",
      survey_score: "",
      survey_votes: "0",
      social_interest_score: "",
      validation_status: "pendiente",
      validation_decision: "pendiente",
      validation_notes: "",
      usage_moment: "",
      main_benefit: "",
      how_to_use: "",
      usage_description: "",
      routine_suggestion: "",
      benefits: "",
      bullets: "",
      functional_claims: "",
      ingredients_summary: "",
      lifestyle_images: "",
      direct_url: "",
      amazon_url: "",
      ebay_url: "",
      tiktok_url: "",
      distribution_channels: "",
      commercial_notes: "",
    })

  const [isSaving, setIsSaving] =
    useState(false)

  const [saveMessage, setSaveMessage] =
    useState("")

  const [saveError, setSaveError] =
    useState("")

  const [
    isSendingNotification,
    setIsSendingNotification,
  ] = useState(false)

  const [
    notificationMessage,
    setNotificationMessage,
  ] = useState("")

  const [
    notificationError,
    setNotificationError,
  ] = useState("")

  const [
    notificationLogs,
    setNotificationLogs,
  ] = useState<NotificationLog[]>([])

  const [
    isLoadingNotificationLogs,
    setIsLoadingNotificationLogs,
  ] = useState(false)

  const [surveys, setSurveys] =
    useState<CommunitySurvey[]>([])

  const [responses, setResponses] =
    useState<SurveyResponse[]>([])

  const [socialSignals, setSocialSignals] =
    useState<SocialSignal[]>([])

  const [
    isLoadingValidationData,
    setIsLoadingValidationData,
  ] = useState(false)

  const [
    validationDataError,
    setValidationDataError,
  ] = useState("")

  const [
    validationActionMessage,
    setValidationActionMessage,
  ] = useState("")

  const [
    surveyFormData,
    setSurveyFormData,
  ] = useState<CommunitySurveyFormData>(
    defaultSurveyFormData
  )

  const [
    responseFormData,
    setResponseFormData,
  ] = useState<SurveyResponseFormData>(
    defaultResponseFormData
  )

  const [
    socialSignalFormData,
    setSocialSignalFormData,
  ] = useState<SocialSignalFormData>(
    defaultSocialSignalFormData
  )

  const [isCreatingSurvey, setIsCreatingSurvey] =
    useState(false)

  const [
    isCreatingResponse,
    setIsCreatingResponse,
  ] = useState(false)

  const [
    isCreatingSocialSignal,
    setIsCreatingSocialSignal,
  ] = useState(false)

  const [
    isUpdatingValidationMetrics,
    setIsUpdatingValidationMetrics,
  ] = useState(false)

  const [
    isSavingValidationDecision,
    setIsSavingValidationDecision,
  ] = useState(false)

  const loadNotificationLogs =
    useCallback(
      async (productId: string) => {
        setIsLoadingNotificationLogs(true)

        try {
          const logs =
            await getNotificationLogsByProduct(
              productId
            )

          setNotificationLogs(logs)
        } catch (error) {
          console.error(
            "LOAD NOTIFICATION LOGS ERROR:",
            error
          )
          setNotificationLogs([])
        } finally {
          setIsLoadingNotificationLogs(false)
        }
      },
      []
    )

  const loadValidationData =
    useCallback(
      async (productId: string) => {
        setIsLoadingValidationData(true)
        setValidationDataError("")

        try {
          const [
            surveysData,
            responsesData,
            socialSignalsData,
          ] = await Promise.all([
            getCommunitySurveysByProduct(
              productId
            ),
            getSurveyResponsesByProduct(
              productId
            ),
            getSocialSignalsByProduct(
              productId
            ),
          ])

          setSurveys(surveysData)
          setResponses(responsesData)
          setSocialSignals(socialSignalsData)
        } catch (error) {
          console.error(
            "LOAD VALIDATION DATA ERROR:",
            error
          )
          setValidationDataError(
            "No se pudieron cargar los datos de encuestas comunitarias."
          )
          setSurveys([])
          setResponses([])
          setSocialSignals([])
        } finally {
          setIsLoadingValidationData(false)
        }
      },
      []
    )

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

    async function loadData() {
      const productData =
        await getProductBySlug(slug)

      const statesData =
        await getProductStates()

      setProduct(productData)
      setStates(statesData)
    }

    loadData()
  }, [isAuthenticated, slug])

  useEffect(() => {
    if (!product) return

    setFormData(
      getInitialFormData(product)
    )
  }, [product])

  useEffect(() => {
    const productId =
      product?.id

    if (!productId) {
      setNotificationLogs([])
      return
    }

    void loadNotificationLogs(productId)
  }, [
    loadNotificationLogs,
    product?.id,
  ])

  useEffect(() => {
    const productId =
      product?.id

    if (!productId) {
      setSurveys([])
      setResponses([])
      setSocialSignals([])
      return
    }

    void loadValidationData(productId)
  }, [
    loadValidationData,
    product?.id,
  ])

  const updateField =
    (
      field: keyof FormData,
      value: string
    ) => {
      if (field === "lifestyle_images") {
        const lifestyleImages =
          linesToList(value)

        if (
          lifestyleImages.length >
          MAX_LIFESTYLE_IMAGES
        ) {
          setFormData(
            current => ({
              ...current,
              lifestyle_images:
                lifestyleImages
                  .slice(
                    0,
                    MAX_LIFESTYLE_IMAGES
                  )
                  .join("\n"),
            })
          )

          setSaveMessage("")
          setSaveError(
            "Puedes agregar hasta 3 imágenes lifestyle por producto."
          )
          return
        }
      }

      setFormData(
        current => ({
          ...current,
          [field]: value,
        })
      )

      setSaveMessage("")
      setSaveError("")
    }

  const updateSurveyFormField =
    (
      field: keyof CommunitySurveyFormData,
      value: string
    ) => {
      setSurveyFormData(
        current => ({
          ...current,
          [field]: value,
        })
      )
      setValidationDataError("")
      setValidationActionMessage("")
    }

  const updateResponseFormField =
    (
      field: keyof SurveyResponseFormData,
      value: string
    ) => {
      setResponseFormData(
        current => ({
          ...current,
          [field]: value,
        })
      )
      setValidationDataError("")
      setValidationActionMessage("")
    }

  const updateSocialSignalFormField =
    (
      field: keyof SocialSignalFormData,
      value: string
    ) => {
      setSocialSignalFormData(
        current => ({
          ...current,
          [field]: value,
        })
      )
      setValidationDataError("")
      setValidationActionMessage("")
    }

  const handleCreateSurvey =
    async () => {
      if (!product || isCreatingSurvey) return

      const title =
        surveyFormData.title.trim()

      const question =
        surveyFormData.question.trim()

      if (!title || !question) {
        setValidationActionMessage("")
        setValidationDataError(
          "Titulo y pregunta son obligatorios para crear una encuesta."
        )
        return
      }

      setIsCreatingSurvey(true)
      setValidationDataError("")
      setValidationActionMessage("")

      try {
        const createdSurvey =
          await createCommunitySurvey({
            product_id:
              product.id,
            title,
            question,
            description:
              surveyFormData.description.trim() ||
              null,
            channel:
              surveyFormData.channel,
            status:
              surveyFormData.status,
            target_audience:
              surveyFormData.target_audience.trim() ||
              null,
          })

        if (!createdSurvey) {
          setValidationDataError(
            "No se pudo crear la encuesta."
          )
          return
        }

        setSurveyFormData(
          defaultSurveyFormData
        )
        setValidationActionMessage(
          "Encuesta creada correctamente."
        )
        await loadValidationData(product.id)
      } catch (error) {
        console.error(
          "CREATE SURVEY ACTION ERROR:",
          error
        )
        setValidationDataError(
          "Error al crear la encuesta."
        )
      } finally {
        setIsCreatingSurvey(false)
      }
    }

  const handleCreateResponse =
    async () => {
      if (!product || isCreatingResponse) return

      const surveyId =
        responseFormData.survey_id

      if (!surveyId) {
        setValidationActionMessage("")
        setValidationDataError(
          "Selecciona una encuesta antes de registrar una respuesta."
        )
        return
      }

      const scoreValue =
        responseFormData.score.trim()
          ? Number(responseFormData.score)
          : null

      if (
        scoreValue !== null &&
        (
          Number.isNaN(scoreValue) ||
          scoreValue < 0 ||
          scoreValue > 100
        )
      ) {
        setValidationActionMessage("")
        setValidationDataError(
          "El score de respuesta debe estar entre 0 y 100."
        )
        return
      }

      setIsCreatingResponse(true)
      setValidationDataError("")
      setValidationActionMessage("")

      try {
        const createdResponse =
          await createSurveyResponse({
            survey_id:
              surveyId,
            product_id:
              product.id,
            channel:
              responseFormData.channel,
            respondent_name:
              responseFormData.respondent_name.trim() ||
              null,
            respondent_phone:
              responseFormData.respondent_phone.trim() ||
              null,
            respondent_email:
              responseFormData.respondent_email.trim() ||
              null,
            response_value:
              responseFormData.response_value.trim() ||
              null,
            response_label:
              responseFormData.response_label.trim() ||
              null,
            score:
              scoreValue,
            comment:
              responseFormData.comment.trim() ||
              null,
            source:
              responseFormData.source.trim() ||
              "admin_manual",
          })

        if (!createdResponse) {
          setValidationDataError(
            "No se pudo registrar la respuesta."
          )
          return
        }

        setResponseFormData(
          defaultResponseFormData
        )
        setValidationActionMessage(
          "Respuesta registrada correctamente."
        )
        await loadValidationData(product.id)
      } catch (error) {
        console.error(
          "CREATE RESPONSE ACTION ERROR:",
          error
        )
        setValidationDataError(
          "Error al registrar la respuesta."
        )
      } finally {
        setIsCreatingResponse(false)
      }
    }

  const handleCreateSocialSignal =
    async () => {
      if (
        !product ||
        isCreatingSocialSignal
      ) {
        return
      }

      const metricName =
        socialSignalFormData.metric_name.trim()

      const metricValue =
        socialSignalFormData.metric_value.trim()
          ? Number(socialSignalFormData.metric_value)
          : Number.NaN

      if (!metricName) {
        setValidationActionMessage("")
        setValidationDataError(
          "El nombre de la metrica social es obligatorio."
        )
        return
      }

      if (Number.isNaN(metricValue)) {
        setValidationActionMessage("")
        setValidationDataError(
          "El valor de la metrica social debe ser un numero valido."
        )
        return
      }

      setIsCreatingSocialSignal(true)
      setValidationDataError("")
      setValidationActionMessage("")

      try {
        const createdSignal =
          await createSocialSignal({
            product_id:
              product.id,
            platform:
              socialSignalFormData.platform,
            metric_name:
              metricName,
            metric_value:
              metricValue,
            sentiment:
              socialSignalFormData.sentiment ||
              null,
            notes:
              socialSignalFormData.notes.trim() ||
              null,
          })

        if (!createdSignal) {
          setValidationDataError(
            "No se pudo registrar la senal social."
          )
          return
        }

        setSocialSignalFormData(
          defaultSocialSignalFormData
        )
        setValidationActionMessage(
          "Senal social registrada correctamente."
        )
        await loadValidationData(product.id)
      } catch (error) {
        console.error(
          "CREATE SOCIAL SIGNAL ACTION ERROR:",
          error
        )
        setValidationDataError(
          "Error al registrar la senal social."
        )
      } finally {
        setIsCreatingSocialSignal(false)
      }
    }

  const handleUpdateValidationMetrics =
    async () => {
      if (
        !product ||
        isUpdatingValidationMetrics
      ) {
        return
      }

      const surveyVotes =
        responses.length

      const calculatedSurveyScore =
        getAverageValue(
          responses.map(
            response =>
              response.score
          )
        )

      const calculatedSocialScore =
        getAverageValue(
          socialSignals.map(
            signal =>
              signal.metric_value
          )
        )

      const hasActiveSurveys =
        surveys.some(
          survey =>
            survey.status === "active" ||
            survey.status === "activa"
        )

      const hasClosedSurveys =
        surveys.some(
          survey =>
            survey.status === "closed" ||
            survey.status === "cerrada"
        )

      const nextSurveyStatus =
        hasActiveSurveys
          ? "activa"
          : hasClosedSurveys &&
              surveyVotes > 0
            ? "cerrada"
            : "pendiente"

      let nextValidationStatus =
        "pendiente"

      if (surveyVotes === 0) {
        nextValidationStatus =
          "pendiente"
      } else if (
        calculatedSurveyScore !== null &&
        calculatedSurveyScore >= 80 &&
        surveyVotes >= 10
      ) {
        nextValidationStatus =
          "interes_alto"
      } else if (
        calculatedSurveyScore !== null &&
        calculatedSurveyScore >= 50 &&
        surveyVotes >= 5
      ) {
        nextValidationStatus =
          "en_validacion"
      } else if (
        calculatedSurveyScore !== null &&
        calculatedSurveyScore < 50 &&
        surveyVotes >= 5
      ) {
        nextValidationStatus =
          "requiere_ajuste"
      } else {
        nextValidationStatus =
          "en_validacion"
      }

      setIsUpdatingValidationMetrics(true)
      setValidationActionMessage("")
      setValidationDataError("")

      try {
        const result =
          await updateProduct(
            product.id,
            {
              survey_score:
                calculatedSurveyScore,
              survey_votes:
                surveyVotes,
              social_interest_score:
                calculatedSocialScore,
              survey_status:
                nextSurveyStatus,
              validation_status:
                nextValidationStatus,
            }
          )

        if (!result) {
          setValidationDataError(
            "No se pudieron actualizar las metricas"
          )
          return
        }

        const refreshedProduct =
          await getProductBySlug(slug)

        if (refreshedProduct) {
          setProduct(refreshedProduct)
        } else {
          setProduct(
            current =>
              current
                ? {
                    ...current,
                    survey_score:
                      calculatedSurveyScore,
                    survey_votes:
                      surveyVotes,
                    social_interest_score:
                      calculatedSocialScore,
                    survey_status:
                      nextSurveyStatus,
                    validation_status:
                      nextValidationStatus,
                  }
                : current
          )
        }

        setValidationActionMessage(
          "Metricas de validacion actualizadas"
        )
        await loadValidationData(product.id)
      } catch (error) {
        console.error(
          "UPDATE VALIDATION METRICS ERROR:",
          error
        )
        setValidationDataError(
          "No se pudieron actualizar las metricas"
        )
      } finally {
        setIsUpdatingValidationMetrics(false)
      }
    }

  const saveValidationDecision =
    async () => {
      if (
        !product ||
        isSavingValidationDecision
      ) {
        return
      }

      const updates = {
        validation_decision:
          formData.validation_decision ||
          "pendiente",
        validation_notes:
          formData.validation_notes.trim() ||
          null,
      }

      setIsSavingValidationDecision(true)
      setValidationActionMessage("")
      setValidationDataError("")

      try {
        const result =
          await updateProduct(
            product.id,
            updates
          )

        if (!result) {
          setValidationDataError(
            "No se pudo guardar la decision de validacion."
          )
          return
        }

        setProduct(
          current =>
            current
              ? {
                  ...current,
                  ...updates,
                }
              : current
        )

        setValidationActionMessage(
          "Decision de validacion guardada"
        )
      } catch (error) {
        console.error(
          "SAVE VALIDATION DECISION ERROR:",
          error
        )
        setValidationDataError(
          "No se pudo guardar la decision de validacion."
        )
      } finally {
        setIsSavingValidationDecision(false)
      }
    }

  const saveChanges =
    async () => {
      if (!product || isSaving) return

      const name =
        formData.name.trim()

      const category =
        formData.category.trim()

      const priceValue =
        formData.price.trim()
          ? Number(formData.price)
          : null

      const surveyScoreValue =
        formData.survey_score.trim()
          ? Number(formData.survey_score)
          : null

      const socialInterestScoreValue =
        formData.social_interest_score.trim()
          ? Number(formData.social_interest_score)
          : null

      const surveyVotesValue =
        formData.survey_votes.trim()
          ? Number(formData.survey_votes)
          : 0

      const routineSuggestionValue =
        linesToList(
          formData.routine_suggestion
        )

      const benefitsValue =
        linesToList(formData.benefits)

      const bulletsValue =
        linesToList(formData.bullets)

      const functionalClaimsValue =
        linesToList(
          formData.functional_claims
        )

      const lifestyleImagesValue =
        linesToList(
          formData.lifestyle_images
        ).slice(
          0,
          MAX_LIFESTYLE_IMAGES
        )

      const distributionChannelsResult =
        parseDistributionChannelsInput(
          formData.distribution_channels
        )

      if (!name || !category) {
        setSaveMessage("")
        setSaveError(
          "Nombre y categoria son obligatorios."
        )
        return
      }

      if (
        priceValue !== null &&
        Number.isNaN(priceValue)
      ) {
        setSaveMessage("")
        setSaveError(
          "El precio debe ser un numero valido."
        )
        return
      }

      if (
        surveyScoreValue !== null &&
        (
          Number.isNaN(surveyScoreValue) ||
          surveyScoreValue < 0 ||
          surveyScoreValue > 100
        )
      ) {
        setSaveMessage("")
        setSaveError(
          "El puntaje de encuesta debe estar entre 0 y 100."
        )
        return
      }

      if (
        socialInterestScoreValue !== null &&
        (
          Number.isNaN(socialInterestScoreValue) ||
          socialInterestScoreValue < 0 ||
          socialInterestScoreValue > 100
        )
      ) {
        setSaveMessage("")
        setSaveError(
          "El interes social debe estar entre 0 y 100."
        )
        return
      }

      if (
        Number.isNaN(surveyVotesValue) ||
        !Number.isInteger(surveyVotesValue) ||
        surveyVotesValue < 0
      ) {
        setSaveMessage("")
        setSaveError(
          "Los votos de encuesta deben ser un entero mayor o igual a 0."
        )
        return
      }

      if (
        "distribution_channels" in product &&
        distributionChannelsResult.error
      ) {
        setSaveMessage("")
        setSaveError(
          distributionChannelsResult.error
        )
        return
      }

      setIsSaving(true)
      setSaveMessage("")
      setSaveError("")

      const updates: ProductUpdateData = {
        name,
        category,
        description:
          formData.description.trim() || null,
        image_url:
          formData.image_url.trim() || null,
        price:
          priceValue,
        currency:
          formData.currency.trim() || null,
        state_id:
          formData.state_id || null,
        expected_benefit:
          formData.expected_benefit.trim() ||
          null,
        survey_status:
          formData.survey_status || null,
        survey_score:
          surveyScoreValue,
        survey_votes:
          surveyVotesValue,
        social_interest_score:
          socialInterestScoreValue,
        validation_status:
          formData.validation_status || null,
        validation_decision:
          formData.validation_decision || null,
        validation_notes:
          formData.validation_notes.trim() ||
          null,
        usage_moment:
          formData.usage_moment.trim() ||
          null,
        main_benefit:
          formData.main_benefit.trim() ||
          null,
        how_to_use:
          formData.how_to_use.trim() ||
          null,
        usage_description:
          formData.usage_description.trim() ||
          null,
        routine_suggestion:
          routineSuggestionValue,
        benefits:
          benefitsValue,
        bullets:
          bulletsValue,
        functional_claims:
          functionalClaimsValue,
        ingredients_summary:
          formData.ingredients_summary.trim() ||
          null,
        lifestyle_images:
          lifestyleImagesValue,
        direct_url:
          formData.direct_url.trim() || null,
        amazon_url:
          formData.amazon_url.trim() || null,
        ebay_url:
          formData.ebay_url.trim() || null,
        tiktok_url:
          formData.tiktok_url.trim() || null,
      }

      if ("nicho" in product) {
        updates.nicho =
          formData.nicho.trim() ||
          null
      }

      if ("problema_resuelve" in product) {
        updates.problema_resuelve =
          formData.problema_resuelve.trim() ||
          null
      }

      if ("lifestyle_image" in product) {
        updates.lifestyle_image =
          lifestyleImagesValue[0] ||
          null
      }

      if ("distribution_channels" in product) {
        updates.distribution_channels =
          distributionChannelsResult.channels
      }

      if ("commercial_notes" in product) {
        updates.commercial_notes =
          formData.commercial_notes.trim() ||
          null
      }

      try {
        const result =
          await updateProduct(
            product.id,
            updates
          )

        if (!result) {
          setSaveError(
            "Error al actualizar el producto."
          )
          return
        }

        setProduct(
          current =>
            current
              ? {
                  ...current,
                  ...updates,
                }
              : current
        )

        setSaveMessage(
          "Producto actualizado correctamente"
        )
      } catch {
        setSaveError(
          "Error al actualizar el producto."
        )
      } finally {
        setIsSaving(false)
      }
    }

  const sendManualNotification =
    async () => {
      if (
        !product ||
        isSendingNotification
      ) {
        return
      }

      const savedState =
        states.find(
          item =>
            item.id === product.state_id
        )

      const hasUnsavedStateChange =
        formData.state_id !==
        (product.state_id || "")

      if (!savedState) {
        setNotificationMessage("")
        setNotificationError(
          "No hay un estado guardado válido para enviar la notificación."
        )
        return
      }

      if (hasUnsavedStateChange) {
        setNotificationMessage("")
        setNotificationError(
          "Guarda los cambios antes de enviar la notificación."
        )
        return
      }

      setIsSendingNotification(true)
      setNotificationMessage("")
      setNotificationError("")

      const refreshNotificationLogs =
        async () => {
          await loadNotificationLogs(
            product.id
          )
        }

      try {
        const response =
          await fetch(
            "/api/innova-lab",
            {
              method:
                "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  productId:
                    product.id,
                  product:
                    product.name,
                  status:
                    savedState.name,
                  progress:
                    `${savedState.progress || 0}%`,
                  imageUrl:
                    product.image_url ||
                    product.image ||
                    "",
                  source:
                    "admin_product_detail",
                  triggeredBy:
                    "admin",
                }),
            }
          )

        const text =
          await response.text()

        let payload:
          | {
              success?: boolean
              error?: string
              result?: {
                error?: string
              }
            }
          | null = null

        if (text) {
          try {
            payload =
              JSON.parse(text)
          } catch {
            payload = null
          }
        }

        if (!response.ok) {
          setNotificationError(
            "No se pudo enviar la notificación."
          )
          return
        }

        if (payload?.success !== true) {
          setNotificationError(
            payload?.error ||
              payload?.result?.error ||
              "Meta no confirmó el envío."
          )
          return
        }

        setNotificationMessage(
          "WhatsApp enviado correctamente."
        )
      } catch {
        setNotificationError(
          "Error de conexión al enviar WhatsApp."
        )
      } finally {
        await refreshNotificationLogs()
        setIsSendingNotification(false)
      }
    }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-black" />
    )
  }

  if (!product) {
    return (
      <main className="min-h-screen bg-black p-10 text-white">
        Cargando producto...
      </main>
    )
  }

  const selectedState =
    states.find(
      item =>
        item.id === formData.state_id
    )

  const savedState =
    states.find(
      item =>
        item.id === product.state_id
    )

  const savedStatusName =
    savedState?.name || ""

  const savedProgress =
    savedState?.progress || 0

  const hasUnsavedStateChange =
    formData.state_id !==
    (product.state_id || "")

  const currentValidationDecision =
    (
      formData.validation_decision ||
      product.validation_decision ||
      "pendiente"
    ).toLowerCase()

  const stateRecommendation =
    getNextStateRecommendation({
      currentStateName:
        savedState?.name ||
        "Sin estado",
      decision:
        currentValidationDecision,
    })

  const recommendationVariantClassName =
    stateRecommendation.riskLevel ===
    "success"
      ? "border-emerald-200/20 bg-emerald-200/[0.055] text-emerald-50"
      : stateRecommendation.riskLevel ===
          "warning"
        ? "border-amber-200/20 bg-amber-200/[0.055] text-amber-50"
        : stateRecommendation.riskLevel ===
            "danger"
          ? "border-red-200/20 bg-red-200/[0.055] text-red-50"
          : "border-cyan-200/15 bg-cyan-200/[0.04] text-cyan-50"

  const shouldWarnStateChange =
    hasUnsavedStateChange &&
    [
      "pendiente",
      "ajustar",
      "pausar",
      "descartar",
    ].includes(currentValidationDecision)

  const suggestedTemplate =
    savedStatusName === "Disponible"
      ? "imnova_product_launch"
      : "imnova_update"

  const notificationImage =
    product.image_url ||
    product.image ||
    ""

  const notificationButtonDisabled =
    isSendingNotification ||
    !savedState ||
    hasUnsavedStateChange

  const responseScoreAverage =
    getAverageValue(
      responses.map(
        response =>
          response.score
      )
    )

  const socialMetricAverage =
    getAverageValue(
      socialSignals.map(
        signal =>
          signal.metric_value
      )
    )

  const recentSurveys =
    surveys.slice(0, 5)

  const recentResponses =
    responses.slice(0, 10)

  const recentSocialSignals =
    socialSignals.slice(0, 10)

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white md:px-10">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.10),transparent_42%)]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <button
          onClick={() => router.push("/admin")}
          className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
        >
          &lt;- Volver al Admin
        </button>

        <section className="mt-8 rounded-[36px] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md md:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-300/70">
                Edicion profunda
              </p>

              <h1 className="mt-5 text-4xl font-black tracking-[-0.05em] md:text-6xl">
                {product.name}
              </h1>

              <p className="mt-4 max-w-3xl text-sm leading-6 text-white/55 md:text-base">
                Gestion inicial del producto. General y Estado ya son
                editables; los demas modulos quedan preparados para fases
                siguientes.
              </p>
            </div>

            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
              <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-100/70">
                Estado actual
              </p>
              <p className="mt-3 text-2xl font-bold">
                {selectedState?.name || "Sin estado"}
              </p>
              <p className="mt-1 text-sm text-white/45">
                Avance {selectedState?.progress || 0}%
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {sections.map(
              section => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() =>
                    setActiveSection(
                      section.id
                    )
                  }
                  className={`rounded-full border px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] transition-all ${
                    activeSection === section.id
                      ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                      : "border-white/10 bg-black/30 text-white/45 hover:border-white/20 hover:text-white/70"
                  }`}
                >
                  {section.label}
                </button>
              )
            )}
          </div>
        </section>

        {activeSection === "general" && (
          <section className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
            <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-[10px] uppercase tracking-[0.30em] text-white/40">
                Imagen principal
              </p>

              <div className="mt-5 flex aspect-square items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-black/35">
                {formData.image_url.trim() ? (
                  <img
                    src={formData.image_url}
                    alt={formData.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="px-6 text-center">
                    <p className="text-sm uppercase tracking-[0.24em] text-white/30">
                      Sin imagen
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/45">
                      Agrega una URL publica para mostrar el preview del
                      producto.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-white/[0.03] p-6">
              <p className="text-[10px] uppercase tracking-[0.30em] text-cyan-300/70">
                General
              </p>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <label>
                  <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                    Nombre
                  </span>
                  <input
                    value={formData.name}
                    onChange={(event) =>
                      updateField(
                        "name",
                        event.target.value
                      )
                    }
                    className={inputClassName}
                  />
                </label>

                <label>
                  <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                    Categoria
                  </span>
                  <input
                    value={formData.category}
                    onChange={(event) =>
                      updateField(
                        "category",
                        event.target.value
                      )
                    }
                    className={inputClassName}
                  />
                </label>

                <label className="md:col-span-2">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                    Descripcion
                  </span>
                  <textarea
                    value={formData.description}
                    onChange={(event) =>
                      updateField(
                        "description",
                        event.target.value
                      )
                    }
                    rows={5}
                    className={`${inputClassName} resize-none leading-6`}
                  />
                </label>

                <label className="md:col-span-2">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                    Image URL
                  </span>
                  <input
                    value={formData.image_url}
                    onChange={(event) =>
                      updateField(
                        "image_url",
                        event.target.value
                      )
                    }
                    placeholder="https://..."
                    className={inputClassName}
                  />
                </label>

                <label>
                  <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                    Precio
                  </span>
                  <input
                    value={formData.price}
                    onChange={(event) =>
                      updateField(
                        "price",
                        event.target.value
                      )
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className={inputClassName}
                  />
                </label>

                <label>
                  <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                    Moneda
                  </span>
                  <input
                    value={formData.currency}
                    onChange={(event) =>
                      updateField(
                        "currency",
                        event.target.value
                      )
                    }
                    placeholder="USD"
                    className={inputClassName}
                  />
                </label>
              </div>
            </div>
          </section>
        )}

        {activeSection === "estado" && (
          <section className="mt-6 rounded-[32px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-[10px] uppercase tracking-[0.30em] text-cyan-300/70">
              Estado
            </p>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/55">
              El cambio de estado actualiza el flujo interno del producto. Las
              notificaciones se gestionaran desde el modulo de Notificaciones.
            </p>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
              <label>
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                  Estado del producto
                </span>
                <select
                  value={formData.state_id}
                  onChange={(event) =>
                    updateField(
                      "state_id",
                      event.target.value
                    )
                  }
                  className={inputClassName}
                >
                  <option value="">
                    Sin estado
                  </option>

                  {states.map(
                    state => (
                      <option
                        key={state.id}
                        value={state.id}
                      >
                        {state.name}
                      </option>
                    )
                  )}
                </select>

                {shouldWarnStateChange && (
                  <p className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] p-4 text-sm leading-6 text-amber-100">
                    Revisa la decision de validacion antes de avanzar este
                    producto.
                  </p>
                )}
              </label>

              <div className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
                <p className="text-sm text-white/45">
                  Estado seleccionado
                </p>
                <h3 className="mt-3 text-2xl font-bold">
                  {selectedState?.name || "Sin estado"}
                </h3>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cyan-200"
                    style={{
                      width:
                        `${selectedState?.progress || 0}%`,
                    }}
                  />
                </div>

                <p className="mt-3 text-sm text-white/45">
                  Progreso {selectedState?.progress || 0}%
                </p>
              </div>
            </div>
          </section>
        )}

        {activeSection === "validacion" && (
          <section className="mt-6 rounded-[32px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-[10px] uppercase tracking-[0.30em] text-amber-200/70">
              Validacion comunitaria
            </p>
            <h2 className="mt-4 text-3xl font-black">
              Nicho, problema humano e interes real antes de avanzar al
              desarrollo.
            </h2>

            <p className="mt-4 max-w-4xl text-sm leading-6 text-white/55">
              Cuando el modulo de encuestas este conectado, esta seccion
              ayudara a decidir si una idea avanza al flujo oficial: Idea -
              Validacion - Priorizado - Testing - Produccion -
              Comercializacion - Disponible.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {[
                "Pendiente de encuesta",
                "En validacion",
                "Interes alto",
                "Requiere ajuste",
                "Pausado",
              ].map(
                status => (
                  <span
                    key={status}
                    className="rounded-full border border-amber-200/15 bg-amber-200/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-amber-100/70"
                  >
                    {status}
                  </span>
                )
              )}
            </div>

            <div className={`mt-8 rounded-[32px] border p-6 ${recommendationVariantClassName}`}>
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.30em] opacity-70">
                    Recomendacion de avance
                  </p>
                  <h3 className="mt-3 text-2xl font-black text-white">
                    {stateRecommendation.recommendationTitle}
                  </h3>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">
                    {stateRecommendation.recommendationDescription}
                  </p>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
                    Proximo estado sugerido
                  </p>
                  <p className="mt-3 text-2xl font-black text-white">
                    {stateRecommendation.recommendedStateName}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-5">
                {[
                  [
                    "Decision",
                    stateRecommendation.decision,
                  ],
                  [
                    "Estado actual",
                    stateRecommendation.currentStateName,
                  ],
                  [
                    "Interes encuesta",
                    formData.survey_score
                      ? `${formData.survey_score}%`
                      : "Pendiente",
                  ],
                  [
                    "Respuestas",
                    formData.survey_votes || "0",
                  ],
                  [
                    "Senal social",
                    formData.social_interest_score
                      ? `${formData.social_interest_score}%`
                      : "Pendiente",
                  ],
                ].map(
                  ([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-white/10 bg-black/20 p-4"
                    >
                      <p className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                        {label}
                      </p>
                      <p className="mt-2 text-sm font-bold uppercase tracking-[0.12em] text-white">
                        {value}
                      </p>
                    </div>
                  )
                )}
              </div>

              <p className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-white/60">
                El cambio de estado sigue siendo manual. Esta recomendacion no
                modifica el pipeline.
              </p>
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Nicho
                </p>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Segmento o mercado al que responde esta idea.
                </p>
                {"nicho" in product ? (
                  <input
                    value={formData.nicho}
                    onChange={(event) =>
                      updateField(
                        "nicho",
                        event.target.value
                      )
                    }
                    placeholder="Ej: energia diaria, enfoque, rendimiento"
                    className={inputClassName}
                  />
                ) : (
                  <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/45">
                    Campo pendiente de conectar.
                  </p>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Problema humano
                </p>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Necesidad real que el producto busca resolver.
                </p>
                {"problema_resuelve" in product ? (
                  <textarea
                    value={formData.problema_resuelve}
                    onChange={(event) =>
                      updateField(
                        "problema_resuelve",
                        event.target.value
                      )
                    }
                    placeholder="Describe la necesidad humana que esta idea busca resolver."
                    rows={5}
                    className={`${inputClassName} resize-none leading-6`}
                  />
                ) : (
                  <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/45">
                    Campo pendiente de conectar.
                  </p>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Beneficio esperado
                </p>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Promesa humana inicial que la comunidad debe validar antes de
                  avanzar.
                </p>
                <textarea
                  value={formData.expected_benefit}
                  onChange={(event) =>
                    updateField(
                      "expected_benefit",
                      event.target.value
                    )
                  }
                  placeholder="Describe el beneficio esperado para la persona."
                  rows={4}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Encuesta comunitaria
                </p>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Resultados de encuestas enviadas a la comunidad IMNOVA.
                </p>

                <label className="mt-5 block">
                  <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                    Estado de encuesta
                  </span>
                  <select
                    value={formData.survey_status}
                    onChange={(event) =>
                      updateField(
                        "survey_status",
                        event.target.value
                      )
                    }
                    className={inputClassName}
                  >
                    <option value="pendiente">
                      pendiente
                    </option>
                    <option value="activa">
                      activa
                    </option>
                    <option value="cerrada">
                      cerrada
                    </option>
                  </select>
                </label>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Puntaje 0-100
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formData.survey_score}
                      onChange={(event) =>
                        updateField(
                          "survey_score",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    />
                  </label>

                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Votos
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formData.survey_votes}
                      onChange={(event) =>
                        updateField(
                          "survey_votes",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Senales sociales
                </p>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Interes medido en redes sociales, campanas o comunidad
                  externa.
                </p>

                <label className="mt-5 block">
                  <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                    Interes social 0-100
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.social_interest_score}
                    onChange={(event) =>
                      updateField(
                        "social_interest_score",
                        event.target.value
                      )
                    }
                    className={inputClassName}
                  />
                </label>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Decision
                </p>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  La decision de avanzar, ajustar o pausar debe depender de los
                  datos de comunidad y redes.
                </p>
                <p className="mt-3 rounded-2xl border border-cyan-100/15 bg-cyan-300/[0.05] p-4 text-sm leading-6 text-cyan-50/70">
                  La decision no mueve automaticamente el producto de estado.
                  Solo registra la evaluacion estrategica. El cambio de etapa
                  debe hacerse manualmente desde Estado.
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Estado de validacion
                    </span>
                    <select
                      value={formData.validation_status}
                      onChange={(event) =>
                        updateField(
                          "validation_status",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    >
                      <option value="pendiente">
                        pendiente
                      </option>
                      <option value="en_validacion">
                        en_validacion
                      </option>
                      <option value="interes_alto">
                        interes_alto
                      </option>
                      <option value="requiere_ajuste">
                        requiere_ajuste
                      </option>
                      <option value="pausado">
                        pausado
                      </option>
                    </select>
                  </label>

                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Decision
                    </span>
                    <select
                      value={formData.validation_decision}
                      onChange={(event) =>
                        updateField(
                          "validation_decision",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    >
                      <option value="pendiente">
                        pendiente
                      </option>
                      <option value="avanzar">
                        avanzar
                      </option>
                      <option value="ajustar">
                        ajustar
                      </option>
                      <option value="pausar">
                        pausar
                      </option>
                      <option value="descartar">
                        descartar
                      </option>
                    </select>
                  </label>

                  <label className="md:col-span-2">
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Notas de validacion
                    </span>
                    <textarea
                      value={formData.validation_notes}
                      onChange={(event) =>
                        updateField(
                          "validation_notes",
                          event.target.value
                        )
                      }
                      placeholder="Aprendizajes, riesgos, comentarios de comunidad o siguiente accion."
                      rows={4}
                      className={`${inputClassName} resize-none leading-6`}
                    />
                  </label>

                  <div className="md:col-span-2">
                    <button
                      type="button"
                      onClick={saveValidationDecision}
                      disabled={isSavingValidationDecision}
                      className="rounded-2xl border border-cyan-100/25 bg-cyan-300/[0.10] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-50 transition-colors hover:border-cyan-100/45 hover:bg-cyan-300/[0.16] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingValidationDecision
                        ? "Guardando decision..."
                        : "Guardar decision"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 rounded-[32px] border border-amber-200/15 bg-amber-200/[0.035] p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.30em] text-amber-100/70">
                    Encuestas comunitarias
                  </p>
                  <h3 className="mt-3 text-2xl font-black text-white">
                    Lectura real de interes
                  </h3>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-white/55">
                    Registra encuestas, respuestas manuales y senales sociales.
                    Este panel solo informa; no cambia estados ni decisiones
                    automaticamente.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                  <button
                    type="button"
                    onClick={() =>
                      product &&
                      loadValidationData(product.id)
                    }
                    disabled={isLoadingValidationData}
                    className="w-fit rounded-2xl border border-amber-100/20 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100 transition-colors hover:border-amber-100/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoadingValidationData
                      ? "Cargando..."
                      : "Actualizar"}
                  </button>

                  <button
                    type="button"
                    onClick={handleUpdateValidationMetrics}
                    disabled={isUpdatingValidationMetrics}
                    className="w-fit rounded-2xl bg-amber-100 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isUpdatingValidationMetrics
                      ? "Actualizando metricas..."
                      : "Actualizar metricas de validacion"}
                  </button>
                </div>
              </div>

              {validationActionMessage && (
                <p className="mt-5 rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.06] p-4 text-sm leading-6 text-emerald-100">
                  {validationActionMessage}
                </p>
              )}

              {validationDataError && (
                <p className="mt-5 rounded-2xl border border-red-200/20 bg-red-200/[0.06] p-4 text-sm leading-6 text-red-100">
                  {validationDataError}
                </p>
              )}

              <div className="mt-6 grid gap-4 md:grid-cols-4">
                {[
                  [
                    "Encuestas",
                    surveys.length,
                  ],
                  [
                    "Respuestas",
                    responses.length,
                  ],
                  [
                    "Score promedio",
                    responseScoreAverage === null
                      ? "N/A"
                      : `${responseScoreAverage}%`,
                  ],
                  [
                    "Senales",
                    socialMetricAverage === null
                      ? socialSignals.length
                      : `${socialSignals.length} / ${socialMetricAverage}`,
                  ],
                ].map(
                  ([label, value]) => (
                    <div
                      key={label}
                      className="rounded-3xl border border-white/10 bg-black/25 p-5"
                    >
                      <p className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                        {label}
                      </p>
                      <p className="mt-3 text-3xl font-black text-white">
                        {value}
                      </p>
                    </div>
                  )
                )}
              </div>

              <div className="mt-6 grid gap-5 xl:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-black/30 p-5">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Crear encuesta
                  </p>

                  <label className="mt-5 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Titulo
                    </span>
                    <input
                      value={surveyFormData.title}
                      onChange={(event) =>
                        updateSurveyFormField(
                          "title",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Pregunta
                    </span>
                    <textarea
                      value={surveyFormData.question}
                      onChange={(event) =>
                        updateSurveyFormField(
                          "question",
                          event.target.value
                        )
                      }
                      rows={3}
                      className={`${inputClassName} resize-none leading-6`}
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Descripcion
                    </span>
                    <textarea
                      value={surveyFormData.description}
                      onChange={(event) =>
                        updateSurveyFormField(
                          "description",
                          event.target.value
                        )
                      }
                      rows={3}
                      className={`${inputClassName} resize-none leading-6`}
                    />
                  </label>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Canal
                      </span>
                      <select
                        value={surveyFormData.channel}
                        onChange={(event) =>
                          updateSurveyFormField(
                            "channel",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      >
                        {surveyChannels.map(
                          channel => (
                            <option
                              key={channel}
                              value={channel}
                            >
                              {channel}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Estado
                      </span>
                      <select
                        value={surveyFormData.status}
                        onChange={(event) =>
                          updateSurveyFormField(
                            "status",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      >
                        {surveyStatuses.map(
                          status => (
                            <option
                              key={status}
                              value={status}
                            >
                              {status}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                  </div>

                  <label className="mt-4 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Audiencia objetivo
                    </span>
                    <input
                      value={surveyFormData.target_audience}
                      onChange={(event) =>
                        updateSurveyFormField(
                          "target_audience",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleCreateSurvey}
                    disabled={isCreatingSurvey}
                    className="mt-5 w-full rounded-2xl bg-amber-100 px-5 py-4 text-[10px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCreatingSurvey
                      ? "Creando..."
                      : "Crear encuesta"}
                  </button>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/30 p-5">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Registrar respuesta
                  </p>

                  <label className="mt-5 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Encuesta
                    </span>
                    <select
                      value={responseFormData.survey_id}
                      onChange={(event) =>
                        updateResponseFormField(
                          "survey_id",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    >
                      <option value="">
                        Seleccionar encuesta
                      </option>
                      {surveys.map(
                        survey => (
                          <option
                            key={survey.id}
                            value={survey.id}
                          >
                            {survey.title}
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Canal
                      </span>
                      <select
                        value={responseFormData.channel}
                        onChange={(event) =>
                          updateResponseFormField(
                            "channel",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      >
                        {surveyChannels.map(
                          channel => (
                            <option
                              key={channel}
                              value={channel}
                            >
                              {channel}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Score 0-100
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={responseFormData.score}
                        onChange={(event) =>
                          updateResponseFormField(
                            "score",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      />
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Nombre
                      </span>
                      <input
                        value={responseFormData.respondent_name}
                        onChange={(event) =>
                          updateResponseFormField(
                            "respondent_name",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Fuente
                      </span>
                      <input
                        value={responseFormData.source}
                        onChange={(event) =>
                          updateResponseFormField(
                            "source",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      />
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Telefono
                      </span>
                      <input
                        value={responseFormData.respondent_phone}
                        onChange={(event) =>
                          updateResponseFormField(
                            "respondent_phone",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Email
                      </span>
                      <input
                        value={responseFormData.respondent_email}
                        onChange={(event) =>
                          updateResponseFormField(
                            "respondent_email",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      />
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Valor
                      </span>
                      <input
                        value={responseFormData.response_value}
                        onChange={(event) =>
                          updateResponseFormField(
                            "response_value",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Etiqueta
                      </span>
                      <input
                        value={responseFormData.response_label}
                        onChange={(event) =>
                          updateResponseFormField(
                            "response_label",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      />
                    </label>
                  </div>

                  <label className="mt-4 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Comentario
                    </span>
                    <textarea
                      value={responseFormData.comment}
                      onChange={(event) =>
                        updateResponseFormField(
                          "comment",
                          event.target.value
                        )
                      }
                      rows={3}
                      className={`${inputClassName} resize-none leading-6`}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleCreateResponse}
                    disabled={
                      isCreatingResponse ||
                      !surveys.length
                    }
                    className="mt-5 w-full rounded-2xl bg-cyan-200 px-5 py-4 text-[10px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCreatingResponse
                      ? "Registrando..."
                      : "Registrar respuesta"}
                  </button>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/30 p-5">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Registrar senal social
                  </p>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Plataforma
                      </span>
                      <select
                        value={socialSignalFormData.platform}
                        onChange={(event) =>
                          updateSocialSignalFormField(
                            "platform",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      >
                        {socialPlatforms.map(
                          platform => (
                            <option
                              key={platform}
                              value={platform}
                            >
                              {platform}
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                        Sentimiento
                      </span>
                      <select
                        value={socialSignalFormData.sentiment}
                        onChange={(event) =>
                          updateSocialSignalFormField(
                            "sentiment",
                            event.target.value
                          )
                        }
                        className={inputClassName}
                      >
                        {socialSentiments.map(
                          sentiment => (
                            <option
                              key={sentiment}
                              value={sentiment}
                            >
                              {sentiment}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                  </div>

                  <label className="mt-4 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Metrica
                    </span>
                    <input
                      value={socialSignalFormData.metric_name}
                      onChange={(event) =>
                        updateSocialSignalFormField(
                          "metric_name",
                          event.target.value
                        )
                      }
                      placeholder="likes, comentarios, clicks, interesados"
                      className={inputClassName}
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Valor
                    </span>
                    <input
                      type="number"
                      value={socialSignalFormData.metric_value}
                      onChange={(event) =>
                        updateSocialSignalFormField(
                          "metric_value",
                          event.target.value
                        )
                      }
                      className={inputClassName}
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                      Notas
                    </span>
                    <textarea
                      value={socialSignalFormData.notes}
                      onChange={(event) =>
                        updateSocialSignalFormField(
                          "notes",
                          event.target.value
                        )
                      }
                      rows={5}
                      className={`${inputClassName} resize-none leading-6`}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleCreateSocialSignal}
                    disabled={isCreatingSocialSignal}
                    className="mt-5 w-full rounded-2xl bg-emerald-200 px-5 py-4 text-[10px] font-bold uppercase tracking-[0.18em] text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCreatingSocialSignal
                      ? "Registrando..."
                      : "Registrar senal"}
                  </button>
                </div>
              </div>

              <div className="mt-6 grid gap-5 xl:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Ultimas encuestas
                  </p>
                  <div className="mt-4 space-y-3">
                    {recentSurveys.length ? (
                      recentSurveys.map(
                        survey => (
                          <article
                            key={survey.id}
                            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h4 className="text-sm font-bold text-white">
                                  {survey.title}
                                </h4>
                                <p className="mt-2 text-xs leading-5 text-white/50">
                                  {survey.question}
                                </p>
                              </div>
                              <span className="rounded-full border border-white/10 px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-white/45">
                                {survey.status || "draft"}
                              </span>
                            </div>
                            <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/30">
                              {survey.channel || "multi_channel"} -{" "}
                              {formatNotificationDate(
                                survey.created_at
                              )}
                            </p>
                          </article>
                        )
                      )
                    ) : (
                      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/45">
                        No hay encuestas para este producto.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Ultimas respuestas
                  </p>
                  <div className="mt-4 space-y-3">
                    {recentResponses.length ? (
                      recentResponses.map(
                        response => (
                          <article
                            key={response.id}
                            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h4 className="text-sm font-bold text-white">
                                  {response.respondent_name ||
                                    "Respuesta anonima"}
                                </h4>
                                <p className="mt-2 text-xs leading-5 text-white/50">
                                  {response.response_label ||
                                    response.response_value ||
                                    response.comment ||
                                    "Sin detalle"}
                                </p>
                              </div>
                              <span className="rounded-full border border-cyan-200/20 bg-cyan-200/[0.06] px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-cyan-100">
                                {response.score === null
                                  ? "N/A"
                                  : response.score}
                              </span>
                            </div>
                            <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/30">
                              {response.channel || "canal"} -{" "}
                              {formatNotificationDate(
                                response.created_at
                              )}
                            </p>
                            {(response.respondent_phone ||
                              response.respondent_email) && (
                              <p className="mt-2 text-[11px] text-white/30">
                                {response.respondent_phone ||
                                  ""}
                                {response.respondent_phone &&
                                response.respondent_email
                                  ? " / "
                                  : ""}
                                {response.respondent_email ||
                                  ""}
                              </p>
                            )}
                          </article>
                        )
                      )
                    ) : (
                      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/45">
                        No hay respuestas registradas.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Senales sociales
                  </p>
                  <div className="mt-4 space-y-3">
                    {recentSocialSignals.length ? (
                      recentSocialSignals.map(
                        signal => (
                          <article
                            key={signal.id}
                            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h4 className="text-sm font-bold text-white">
                                  {signal.platform}
                                </h4>
                                <p className="mt-2 text-xs leading-5 text-white/50">
                                  {signal.metric_name}
                                </p>
                              </div>
                              <span className="rounded-full border border-emerald-200/20 bg-emerald-200/[0.06] px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-emerald-100">
                                {signal.metric_value}
                              </span>
                            </div>
                            <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/30">
                              {signal.sentiment || "neutral"} -{" "}
                              {formatNotificationDate(
                                signal.captured_at
                              )}
                            </p>
                            {signal.notes && (
                              <p className="mt-2 text-xs leading-5 text-white/45">
                                {signal.notes}
                              </p>
                            )}
                          </article>
                        )
                      )
                    ) : (
                      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/45">
                        No hay senales sociales registradas.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-6 rounded-2xl border border-amber-200/15 bg-amber-200/[0.04] p-4 text-sm leading-6 text-white/55">
              Este modulo no cambia product_states todavia. La decision real se
              conectara cuando existan encuestas, senales sociales y registro de
              respuestas de la comunidad.
            </p>
          </section>
        )}

        {activeSection === "comercializacion" && (
          <section className="mt-6 rounded-[32px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-[10px] uppercase tracking-[0.30em] text-emerald-200/70">
              Comercializacion
            </p>
            <h2 className="mt-4 text-3xl font-black">
              Canales, enlaces y disponibilidad comercial
            </h2>

            <p className="mt-4 max-w-4xl text-sm leading-6 text-white/55">
              Canales, enlaces y disponibilidad comercial del producto. Esta
              informacion se guarda junto con los cambios del producto y no
              dispara WhatsApp ni modifica estados automaticamente.
            </p>

            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Enlaces principales
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      IMNOVA Store / direct_url
                    </span>
                    <input
                      value={formData.direct_url}
                      onChange={(event) =>
                        updateField(
                          "direct_url",
                          event.target.value
                        )
                      }
                      placeholder="https://..."
                      className={inputClassName}
                    />
                  </label>

                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Amazon
                    </span>
                    <input
                      value={formData.amazon_url}
                      onChange={(event) =>
                        updateField(
                          "amazon_url",
                          event.target.value
                        )
                      }
                      placeholder="https://amazon.com/..."
                      className={inputClassName}
                    />
                  </label>

                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      eBay
                    </span>
                    <input
                      value={formData.ebay_url}
                      onChange={(event) =>
                        updateField(
                          "ebay_url",
                          event.target.value
                        )
                      }
                      placeholder="https://ebay.com/..."
                      className={inputClassName}
                    />
                  </label>

                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      TikTok Shop
                    </span>
                    <input
                      value={formData.tiktok_url}
                      onChange={(event) =>
                        updateField(
                          "tiktok_url",
                          event.target.value
                        )
                      }
                      placeholder="https://..."
                      className={inputClassName}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Precio
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Price
                    </span>
                    <input
                      value={formData.price}
                      onChange={(event) =>
                        updateField(
                          "price",
                          event.target.value
                        )
                      }
                      inputMode="decimal"
                      placeholder="0.00"
                      className={inputClassName}
                    />
                  </label>

                  <label>
                    <span className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                      Currency
                    </span>
                    <input
                      value={formData.currency}
                      onChange={(event) =>
                        updateField(
                          "currency",
                          event.target.value
                        )
                      }
                      placeholder="USD"
                      className={inputClassName}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-3xl border border-emerald-200/15 bg-emerald-200/[0.04] p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-100/65">
                  Estado comercial visual
                </p>
                <p className="mt-4 text-sm leading-6 text-white/55">
                  El estado Comercializacion o Disponible controla cuando este
                  producto aparece como activo para venta. Este modulo solo
                  guarda informacion comercial.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Canales de distribucion
                </p>

                {"distribution_channels" in product ? (
                  <>
                    <p className="mt-3 text-sm leading-6 text-white/50">
                      Editor basico en JSON. Mantiene la estructura existente
                      sin redisenar los canales.
                    </p>
                    <textarea
                      value={formData.distribution_channels}
                      onChange={(event) =>
                        updateField(
                          "distribution_channels",
                          event.target.value
                        )
                      }
                      placeholder={'[\n  {\n    "id": "amazon-us",\n    "type": "marketplace",\n    "name": "Amazon",\n    "location": "Online",\n    "status": "active",\n    "url": "https://..."\n  }\n]'}
                      rows={10}
                      className={`${inputClassName} resize-none font-mono leading-6`}
                    />
                  </>
                ) : (
                  <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/45">
                    distribution_channels pendiente de conectar en Supabase.
                  </p>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Notas comerciales
                </p>

                {"commercial_notes" in product ? (
                  <textarea
                    value={formData.commercial_notes}
                    onChange={(event) =>
                      updateField(
                        "commercial_notes",
                        event.target.value
                      )
                    }
                    placeholder="Notas internas sobre lanzamiento, disponibilidad o canales comerciales."
                    rows={4}
                    className={`${inputClassName} resize-none leading-6`}
                  />
                ) : (
                  <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/45">
                    commercial_notes pendiente de conectar en Supabase.
                  </p>
                )}
              </div>

              <div className="grid gap-4 lg:col-span-2 md:grid-cols-3">
                {[
                  [
                    "Marketplaces",
                    "Pendiente de conectar si se crea un campo dedicado.",
                  ],
                  [
                    "availability_status",
                    "Pendiente de conectar en Supabase.",
                  ],
                  [
                    "launch_status",
                    "Pendiente de conectar en Supabase.",
                  ],
                ].map(
                  ([label, value]) => (
                    <div
                      key={label}
                      className="rounded-3xl border border-white/10 bg-black/25 p-5"
                    >
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                        {label}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-white/45">
                        {value}
                      </p>
                    </div>
                  )
                )}
              </div>
            </div>

            <p className="mt-6 rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.04] p-4 text-sm leading-6 text-white/55">
              Guardar cambios actualiza estos campos comerciales si existen en
              products. No toca Store, APIs, WhatsApp ni product_states.
            </p>
          </section>
        )}

        {activeSection === "contenido" && (
          <section className="mt-6 rounded-[32px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-[10px] uppercase tracking-[0.30em] text-violet-200/70">
              Contenido
            </p>
            <h2 className="mt-4 text-3xl font-black">
              Lifestyle, beneficios y uso
            </h2>

            <p className="mt-4 max-w-4xl text-sm leading-6 text-white/55">
              Este contenido alimenta la seccion publica Ideas de Uso. Usa una
              linea por item en rutinas, beneficios, bullets, claims e imagenes.
            </p>

            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <label className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Momento de uso
                </span>
                <input
                  value={formData.usage_moment}
                  onChange={(event) =>
                    updateField(
                      "usage_moment",
                      event.target.value
                    )
                  }
                  placeholder="Cafe funcional de la manana"
                  className={inputClassName}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Beneficio principal
                </span>
                <input
                  value={formData.main_benefit}
                  onChange={(event) =>
                    updateField(
                      "main_benefit",
                      event.target.value
                    )
                  }
                  placeholder="Cafe funcional con vitaminas y colageno para bienestar diario"
                  className={inputClassName}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Como usarlo
                </span>
                <textarea
                  value={formData.how_to_use}
                  onChange={(event) =>
                    updateField(
                      "how_to_use",
                      event.target.value
                    )
                  }
                  placeholder="Integra Mash Coffee+ en tu rutina diaria como cafe funcional con vitaminas, colageno marino y extractos herbales."
                  rows={4}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Descripcion lifestyle
                </span>
                <textarea
                  value={formData.usage_description}
                  onChange={(event) =>
                    updateField(
                      "usage_description",
                      event.target.value
                    )
                  }
                  placeholder="Una forma moderna de disfrutar cafe con beneficios funcionales, sin azucar y bajo en calorias."
                  rows={4}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Rutina sugerida
                </span>
                <textarea
                  value={formData.routine_suggestion}
                  onChange={(event) =>
                    updateField(
                      "routine_suggestion",
                      event.target.value
                    )
                  }
                  placeholder={"Agitalo bien antes de tomar.\nSirvelo frio sobre hielo.\nAnade tu leche favorita."}
                  rows={6}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Beneficios
                </span>
                <textarea
                  value={formData.benefits}
                  onChange={(event) =>
                    updateField(
                      "benefits",
                      event.target.value
                    )
                  }
                  placeholder={"Cafe funcional\nVitaminas y colageno marino\nSin azucar"}
                  rows={6}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Bullets comerciales
                </span>
                <textarea
                  value={formData.bullets}
                  onChange={(event) =>
                    updateField(
                      "bullets",
                      event.target.value
                    )
                  }
                  placeholder={"Sin azucar\nBajo en calorias\nUso practico diario"}
                  rows={6}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Claims funcionales
                </span>
                <textarea
                  value={formData.functional_claims}
                  onChange={(event) =>
                    updateField(
                      "functional_claims",
                      event.target.value
                    )
                  }
                  placeholder={"Apoya bienestar diario\nContribuye a una rutina simple\nEnergia natural del cafe"}
                  rows={6}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </label>

              <label className="rounded-3xl border border-white/10 bg-black/25 p-5 lg:col-span-2">
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Resumen de ingredientes
                </span>
                <textarea
                  value={formData.ingredients_summary}
                  onChange={(event) =>
                    updateField(
                      "ingredients_summary",
                      event.target.value
                    )
                  }
                  placeholder="Cafe funcional con vitaminas, colageno marino y extractos herbales."
                  rows={4}
                  className={`${inputClassName} resize-none leading-6`}
                />
              </label>

              <div className="rounded-3xl border border-violet-200/15 bg-violet-200/[0.04] p-5 lg:col-span-2">
                <label>
                  <span className="text-[10px] uppercase tracking-[0.24em] text-violet-100/65">
                    Imagenes lifestyle
                  </span>
                  <textarea
                    value={formData.lifestyle_images}
                    onChange={(event) =>
                      updateField(
                        "lifestyle_images",
                        event.target.value
                      )
                    }
                    placeholder={"/images/lifestyle/mash-coffee-01.webp\n/images/lifestyle/mash-coffee-02.webp\n/images/lifestyle/mash-coffee-03.webp"}
                    rows={5}
                    className={`${inputClassName} resize-none leading-6`}
                  />
                </label>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.20em] text-white/45">
                  <span>
                    Maximo 3 URLs
                  </span>
                  <span>
                    {Math.min(
                      linesToList(
                        formData.lifestyle_images
                      ).length,
                      MAX_LIFESTYLE_IMAGES
                    )}
                    /{MAX_LIFESTYLE_IMAGES}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {linesToList(
                    formData.lifestyle_images
                  )
                    .slice(
                      0,
                      MAX_LIFESTYLE_IMAGES
                    )
                    .map(
                      image => (
                        <div
                          key={image}
                          className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35"
                        >
                          <img
                            src={image}
                            alt="Lifestyle preview"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )
                    )}
                </div>
              </div>
            </div>
            <p className="mt-6 rounded-2xl border border-violet-200/15 bg-violet-200/[0.04] p-4 text-sm leading-6 text-white/55">
              Las listas se guardan como arrays JSON. Esta pantalla no envia
              WhatsApp ni cambia estados automaticamente.
            </p>
          </section>
        )}

        {activeSection === "notificaciones" && (
          <section className="mt-6 rounded-[32px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-[10px] uppercase tracking-[0.30em] text-sky-200/70">
              Notificaciones
            </p>
            <h2 className="mt-4 text-3xl font-black">
              WhatsApp y seguimiento manual
            </h2>

            <p className="mt-4 max-w-4xl text-sm leading-6 text-white/55">
              Envía actualizaciones manuales a la comunidad IMNOVA cuando el
              producto cambie de etapa o esté disponible.
            </p>

            <p className="mt-4 rounded-2xl border border-sky-200/15 bg-sky-200/[0.04] p-4 text-sm leading-6 text-white/55">
              Las notificaciones no se envían al guardar cambios. Debes
              enviarlas manualmente desde este módulo.
            </p>

            {hasUnsavedStateChange && (
              <p className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] p-4 text-sm leading-6 text-amber-100">
                Hay cambios pendientes. Guarda antes de notificar.
              </p>
            )}

            <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="rounded-3xl border border-white/10 bg-black/25 p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                  Preview de notificación
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {[
                    [
                      "Producto",
                      product.name,
                    ],
                    [
                      "Estado guardado",
                      savedStatusName ||
                        "Sin estado",
                    ],
                    [
                      "Progreso",
                      `${savedProgress}%`,
                    ],
                    [
                      "Plantilla sugerida",
                      savedState
                        ? suggestedTemplate
                        : "Sin plantilla",
                    ],
                  ].map(
                    ([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <p className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                          {label}
                        </p>
                        <p className="mt-2 break-words text-sm text-white/75">
                          {value}
                        </p>
                      </div>
                    )
                  )}
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                    Imagen
                  </p>
                  {notificationImage ? (
                    <p className="mt-2 break-words text-sm text-white/75">
                      {notificationImage}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-white/45">
                      Sin imagen
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-sky-200/15 bg-sky-200/[0.04] p-5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-sky-100/70">
                  Envío manual
                </p>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  Usa el estado guardado del producto. Si editas el estado,
                  primero guarda los cambios.
                </p>

                <button
                  type="button"
                  onClick={sendManualNotification}
                  disabled={notificationButtonDisabled}
                  className="mt-6 w-full rounded-2xl bg-sky-200 px-5 py-4 text-sm font-bold uppercase tracking-[0.18em] text-black transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSendingNotification
                    ? "Enviando..."
                    : "Enviar notificación"}
                </button>

                {!savedState && (
                  <p className="mt-4 text-sm leading-6 text-red-200">
                    No hay estado guardado válido para notificar.
                  </p>
                )}

                {hasUnsavedStateChange && (
                  <p className="mt-4 text-sm leading-6 text-amber-100">
                    Guarda los cambios antes de enviar la notificación.
                  </p>
                )}

                {notificationMessage && (
                  <p className="mt-4 text-sm leading-6 text-emerald-200">
                    {notificationMessage}
                  </p>
                )}

                {notificationError && (
                  <p className="mt-4 text-sm leading-6 text-red-200">
                    {notificationError}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-black/25 p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/35">
                    Historial reciente
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    Últimas notificaciones
                  </h3>
                </div>
                <p className="text-[10px] uppercase tracking-[0.20em] text-white/35">
                  Máximo 10 registros
                </p>
              </div>

              {isLoadingNotificationLogs ? (
                <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                  Cargando historial...
                </p>
              ) : notificationLogs.length === 0 ? (
                <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/50">
                  Aún no hay notificaciones registradas para este producto.
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {notificationLogs.map(
                    log => {
                      const isSuccess =
                        Boolean(log.success)

                      return (
                        <article
                          key={log.id}
                          className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-xs uppercase tracking-[0.20em] text-white/35">
                                {formatNotificationDate(
                                  log.created_at
                                )}
                              </p>
                              <h4 className="mt-2 text-base font-bold text-white">
                                {log.template_name ||
                                  "Sin plantilla"}
                              </h4>
                            </div>

                            <span
                              className={`w-fit rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
                                isSuccess
                                  ? "border-emerald-200/25 bg-emerald-200/10 text-emerald-100"
                                  : "border-red-200/25 bg-red-200/10 text-red-100"
                              }`}
                            >
                              {isSuccess
                                ? "Enviado"
                                : "Error"}
                            </span>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-4">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                                Canal
                              </p>
                              <p className="mt-1 text-sm text-white/70">
                                {String(
                                  log.channel ||
                                    "whatsapp"
                                ).toUpperCase()}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                                Estado enviado
                              </p>
                              <p className="mt-1 text-sm text-white/70">
                                {log.status_name ||
                                  "Sin estado"}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                                Progreso
                              </p>
                              <p className="mt-1 text-sm text-white/70">
                                {log.progress ||
                                  "Sin progreso"}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                                Resultado
                              </p>
                              <p className="mt-1 text-sm text-white/70">
                                {log.successful ?? 0} ok /{" "}
                                {log.failed ?? 0} error
                              </p>
                            </div>
                          </div>

                          {log.error_message && (
                            <p className="mt-4 rounded-xl border border-red-200/15 bg-red-200/[0.05] p-3 text-sm leading-6 text-red-100/80">
                              {log.error_message}
                            </p>
                          )}
                        </article>
                      )
                    }
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="sticky bottom-4 z-20 mt-8 rounded-[28px] border border-white/10 bg-black/80 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/35">
                Guardado
              </p>
              <p className="mt-1 text-sm text-white/55">
                Guarda General, Estado, Validacion y Contenido. Notificaciones
                no se disparan desde esta pantalla.
              </p>
              {saveMessage && (
                <p className="mt-2 text-sm text-emerald-200">
                  {saveMessage}
                </p>
              )}
              {saveError && (
                <p className="mt-2 text-sm text-red-200">
                  {saveError}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={saveChanges}
              disabled={isSaving}
              className="rounded-2xl bg-white px-7 py-4 text-sm font-bold uppercase tracking-[0.18em] text-black transition-all hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving
                ? "Guardando..."
                : "Guardar cambios"}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
