import { supabase } from "./supabase"

type ProductsQueryOptions = {
  limit?: number
  from?: number
  to?: number
  orderBy?: string
  ascending?: boolean
}

type AdminProductPageOptions = {
  search?: string
  stateId?: string
  limit?: number
  page?: number
}

const ADMIN_PRODUCT_SUMMARY_SELECT = `
  id,
  state_id,
  slug,
  name,
  category,
  image_url,
  image,
  direct_url,
  featured,
  survey_score,
  survey_votes,
  social_interest_score,
  survey_status,
  validation_status,
  validation_decision
`

function getValidMetricNumber(
  value: unknown
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

function getMetricAverage(
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

async function getProductsCount(
  applyFilters?: (query: any) => any
) {
  let query =
    supabase
      .from("products")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        }
      )

  if (applyFilters) {
    query =
      applyFilters(query)
  }

  const { count, error } =
    await query

  if (error) {
    console.error(
      "GET PRODUCTS COUNT ERROR:",
      error
    )

    return 0
  }

  return count || 0
}

function normalizeStateName(
  name: string
) {
  return name
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim()
}

function getStateIdsByNames(
  states: Array<{
    id: string
    name: string
  }>,
  stateNames: string[]
) {
  const normalizedNames =
    new Set(
      stateNames.map(
        normalizeStateName
      )
    )

  return states
    .filter(
      state => {
        const normalizedState =
          normalizeStateName(
            state.name
          )

        return Array.from(
          normalizedNames
        ).some(
          normalizedName =>
            normalizedState ===
              normalizedName ||
            normalizedState.includes(
              normalizedName
            )
        )
      }
    )
    .map(state => state.id)
}

export async function getProducts() {

  const { data, error } =
    await supabase
      .from("products")
      .select("*")
      .order(
        "created_at",
        {
          ascending: false,
        }
      )

  if (error) {

    console.error(
      "GET PRODUCTS ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getAdminProductPage(
  options: AdminProductPageOptions = {}
) {

  const limit =
    options.limit || 24

  const page =
    options.page || 0

  const from =
    page * limit

  const to =
    from + limit - 1

  let query =
    supabase
      .from("products")
      .select(
        ADMIN_PRODUCT_SUMMARY_SELECT,
        {
          count: "exact",
        }
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )

  if (
    options.stateId &&
    options.stateId !== "all"
  ) {
    query =
      options.stateId === "no-state"
        ? query.is(
            "state_id",
            null
          )
        : query.eq(
            "state_id",
            options.stateId
          )
  }

  const search =
    options.search
      ?.trim()
      .replace(
        /[%_,]/g,
        " "
      )

  if (search) {
    const pattern =
      `%${search}%`

    query =
      query.or(
        [
          `name.ilike.${pattern}`,
          `category.ilike.${pattern}`,
          `slug.ilike.${pattern}`,
          `direct_url.ilike.${pattern}`,
        ].join(",")
      )
  }

  const {
    data,
    error,
    count,
  } =
    await query.range(
      from,
      to
    )

  if (error) {

    console.error(
      "GET ADMIN PRODUCT PAGE ERROR:",
      error
    )

    return {
      products: [],
      count: 0,
    }

  }

  return {
    products: data || [],
    count: count || 0,
  }

}

export async function getAdminProductSuggestions(
  search = "",
  limit = 20
) {

  let query =
    supabase
      .from("products")
      .select(
        ADMIN_PRODUCT_SUMMARY_SELECT
      )
      .order(
        "name",
        {
          ascending: true,
        }
      )
      .limit(limit)

  const normalizedSearch =
    search
      .trim()
      .replace(
        /[%_,]/g,
        " "
      )

  if (normalizedSearch) {
    const pattern =
      `%${normalizedSearch}%`

    query =
      query.or(
        [
          `name.ilike.${pattern}`,
          `category.ilike.${pattern}`,
          `slug.ilike.${pattern}`,
        ].join(",")
      )
  }

  const { data, error } =
    await query

  if (error) {
    console.error(
      "GET ADMIN PRODUCT SUGGESTIONS ERROR:",
      error
    )

    return []
  }

  return data || []

}

export async function getAdminPriorityProducts(
  limit = 6
) {

  const { data, error } =
    await supabase
      .from("products")
      .select(
        ADMIN_PRODUCT_SUMMARY_SELECT
      )
      .order(
        "featured",
        {
          ascending: false,
          nullsFirst: false,
        }
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(limit)

  if (error) {

    console.error(
      "GET ADMIN PRIORITY PRODUCTS ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getAdminValidationActionProducts() {

  const getProductsByDecision =
    async (
      decision: string,
      includePendingNull = false
    ) => {
      let query =
        supabase
          .from("products")
          .select(
            ADMIN_PRODUCT_SUMMARY_SELECT
          )
          .order(
            "survey_score",
            {
              ascending: false,
              nullsFirst: false,
            }
          )
          .order(
            "survey_votes",
            {
              ascending: false,
              nullsFirst: false,
            }
          )
          .order(
            "name",
            {
              ascending: true,
            }
          )
          .limit(3)

      query =
        includePendingNull
          ? query.or(
              "validation_decision.is.null,validation_decision.eq.pendiente,validation_decision.eq."
            )
          : query.eq(
              "validation_decision",
              decision
            )

      const { data, error } =
        await query

      if (error) {
        console.error(
          "GET ADMIN VALIDATION ACTION PRODUCTS ERROR:",
          error
        )

        return []
      }

      return data || []
    }

  const [
    readyToAdvance,
    pendingDecision,
    needsAdjustment,
  ] =
    await Promise.all([
      getProductsByDecision("avanzar"),
      getProductsByDecision(
        "pendiente",
        true
      ),
      getProductsByDecision("ajustar"),
    ])

  return {
    readyToAdvance,
    pendingDecision,
    needsAdjustment,
  }

}

export async function getAdminDashboardMetrics(
  states: Array<{
    id: string
    name: string
  }>
) {

  const stateCountEntries =
    await Promise.all(
      states.map(
        async (state) => [
          state.id,
          await getProductsCount(
            (query) =>
              query.eq(
                "state_id",
                state.id
              )
          ),
        ] as const
      )
    )

  const stateCounts =
    Object.fromEntries(
      stateCountEntries
    )

  const [
    totalProducts,
    productsWithoutState,
    productsWithoutSlug,
    pendingDecision,
    readyToAdvance,
    needsAdjustment,
    paused,
    discarded,
    highInterest,
    activeSurveys,
  ] =
    await Promise.all([
      getProductsCount(),
      getProductsCount(
        (query) =>
          query.is(
            "state_id",
            null
          )
      ),
      getProductsCount(
        (query) =>
          query.or(
            "slug.is.null,slug.eq."
          )
      ),
      getProductsCount(
        (query) =>
          query.or(
            "validation_decision.is.null,validation_decision.eq.pendiente,validation_decision.eq."
          )
      ),
      getProductsCount(
        (query) =>
          query.eq(
            "validation_decision",
            "avanzar"
          )
      ),
      getProductsCount(
        (query) =>
          query.eq(
            "validation_decision",
            "ajustar"
          )
      ),
      getProductsCount(
        (query) =>
          query.eq(
            "validation_decision",
            "pausar"
          )
      ),
      getProductsCount(
        (query) =>
          query.eq(
            "validation_decision",
            "descartar"
          )
      ),
      getProductsCount(
        (query) =>
          query.eq(
            "validation_status",
            "interes_alto"
          )
      ),
      getProductsCount(
        (query) =>
          query.eq(
            "survey_status",
            "activa"
          )
      ),
    ])

  const {
    data: metricRows,
    error: metricError,
  } =
    await supabase
      .from("products")
      .select(
        "survey_score,survey_votes,social_interest_score"
      )

  if (metricError) {
    console.error(
      "GET ADMIN DASHBOARD METRICS VALUES ERROR:",
      metricError
    )
  }

  const safeMetricRows =
    metricRows || []

  const surveyScores =
    safeMetricRows.map(
      (row: any) =>
        getValidMetricNumber(
          row.survey_score
        )
    )

  const socialScores =
    safeMetricRows.map(
      (row: any) =>
        getValidMetricNumber(
          row.social_interest_score
        )
    )

  const totalVotes =
    safeMetricRows.reduce(
      (total: number, row: any) => {
        const votes =
          getValidMetricNumber(
            row.survey_votes
          )

        return total + (votes || 0)
      },
      0
    )

  const averageSurveyScore =
    getMetricAverage(surveyScores)

  const averageSocialScore =
    getMetricAverage(socialScores)

  return {
    totalProducts,
    productsWithoutState,
    productsWithoutSlug,
    stateCounts,
    validationSummary: {
      pendingDecision,
      readyToAdvance,
      needsAdjustment,
      paused,
      discarded,
      highInterest,
      activeSurveys,
      averageSurveyScore,
      averageSocialScore,
      totalVotes,
      hasValidationData:
        readyToAdvance > 0 ||
        needsAdjustment > 0 ||
        paused > 0 ||
        discarded > 0 ||
        highInterest > 0 ||
        activeSurveys > 0 ||
        averageSurveyScore !== null ||
        averageSocialScore !== null ||
        totalVotes > 0,
    },
  }

}

export async function getProductsByStateNames(
  stateNames: string[],
  options: ProductsQueryOptions = {}
) {

  const states =
    await getProductStates()

  const stateIds =
    getStateIdsByNames(
      states as Array<{
        id: string
        name: string
      }>,
      stateNames
    )

  if (stateIds.length === 0) {
    return []
  }

  let query =
    supabase
      .from("products")
      .select("*")
      .in(
        "state_id",
        stateIds
      )
      .order(
        options.orderBy ||
          "created_at",
        {
          ascending:
            options.ascending ??
            false,
        }
      )

  if (
    typeof options.from === "number" &&
    typeof options.to === "number"
  ) {
    query =
      query.range(
        options.from,
        options.to
      )
  } else if (
    typeof options.limit === "number"
  ) {
    query =
      query.limit(
        options.limit
      )
  }

  const { data, error } =
    await query

  if (error) {

    console.error(
      "GET PRODUCTS BY STATE NAMES ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getProductsWithStatesByStateNames(
  stateNames: string[],
  options: ProductsQueryOptions = {}
) {

  const states =
    await getProductStates()

  const stateIds =
    getStateIdsByNames(
      states as Array<{
        id: string
        name: string
      }>,
      stateNames
    )

  if (stateIds.length === 0) {
    return {
      products: [],
      states,
    }
  }

  let query =
    supabase
      .from("products")
      .select("*")
      .in(
        "state_id",
        stateIds
      )
      .order(
        options.orderBy ||
          "created_at",
        {
          ascending:
            options.ascending ??
            false,
        }
      )

  if (
    typeof options.from === "number" &&
    typeof options.to === "number"
  ) {
    query =
      query.range(
        options.from,
        options.to
      )
  } else if (
    typeof options.limit === "number"
  ) {
    query =
      query.limit(
        options.limit
      )
  }

  const { data, error } =
    await query

  if (error) {

    console.error(
      "GET PRODUCTS WITH STATES BY STATE NAMES ERROR:",
      error
    )

    return {
      products: [],
      states,
    }

  }

  return {
    products: data || [],
    states,
  }

}

export async function getAvailableProducts(
  options: ProductsQueryOptions = {}
) {
  return getProductsByStateNames(
    [
      "Disponible",
    ],
    options
  )
}

export async function getProductStates() {

  const { data, error } =
    await supabase
      .from("product_states")
      .select("*")
      .eq(
        "is_active",
        true
      )
      .order(
        "sort_order",
        {
          ascending: true,
        }
      )

  if (error) {

    console.error(
      "GET PRODUCT STATES ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getProductBySlug(
  slug: string
) {

  const { data, error } =
    await supabase
      .from("products")
      .select("*")
      .eq(
        "slug",
        slug
      )
      .single()

  if (error) {

    console.error(
      "GET PRODUCT BY SLUG ERROR:",
      error
    )

    return null

  }

  return data

}

export type NotificationLog = {
  id: string
  product_id: string | null
  channel: string | null
  template_name: string | null
  status_name: string | null
  progress: string | null
  success: boolean | null
  successful: number | null
  failed: number | null
  error_message: string | null
  source: string | null
  triggered_by: string | null
  created_at: string | null
}

export async function getNotificationLogsByProduct(
  productId: string
): Promise<NotificationLog[]> {

  const { data, error } =
    await supabase
      .from("notification_logs")
      .select(`
        id,
        product_id,
        channel,
        template_name,
        status_name,
        progress,
        success,
        successful,
        failed,
        error_message,
        source,
        triggered_by,
        created_at
      `)
      .eq(
        "product_id",
        productId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(10)

  if (error) {

    console.error(
      "GET NOTIFICATION LOGS ERROR:",
      error
    )

    return []

  }

  return data || []

}

export type CommunitySurvey = {
  id: string
  product_id: string
  title: string
  question: string
  description: string | null
  channel: string | null
  status: string | null
  target_audience: string | null
  created_at: string | null
  closed_at: string | null
}

export type CreateCommunitySurveyInput = {
  product_id: string
  title: string
  question: string
  description?: string | null
  channel?: string | null
  status?: string | null
  target_audience?: string | null
}

export async function getCommunitySurveysByProduct(
  productId: string
): Promise<CommunitySurvey[]> {

  const { data, error } =
    await supabase
      .from("community_surveys")
      .select("*")
      .eq(
        "product_id",
        productId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )

  if (error) {

    console.error(
      "GET COMMUNITY SURVEYS ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function createCommunitySurvey(
  input: CreateCommunitySurveyInput
): Promise<CommunitySurvey | null> {

  const { data, error } =
    await supabase
      .from("community_surveys")
      .insert({
        product_id:
          input.product_id,
        title:
          input.title,
        question:
          input.question,
        description:
          input.description || null,
        channel:
          input.channel || null,
        status:
          input.status || null,
        target_audience:
          input.target_audience || null,
      })
      .select("*")
      .single()

  if (error) {

    console.error(
      "CREATE COMMUNITY SURVEY ERROR:",
      error
    )

    return null

  }

  return data

}

export type SurveyResponse = {
  id: string
  survey_id: string
  product_id: string
  channel: string | null
  respondent_name: string | null
  respondent_phone: string | null
  respondent_email: string | null
  response_value: string | null
  response_label: string | null
  score: number | null
  comment: string | null
  source: string | null
  created_at: string | null
}

export type CreateSurveyResponseInput = {
  survey_id: string
  product_id: string
  channel: string
  respondent_name?: string | null
  respondent_phone?: string | null
  respondent_email?: string | null
  response_value?: string | null
  response_label?: string | null
  score?: number | null
  comment?: string | null
  source?: string | null
}

export async function getSurveyResponsesByProduct(
  productId: string
): Promise<SurveyResponse[]> {

  const { data, error } =
    await supabase
      .from("survey_responses")
      .select("*")
      .eq(
        "product_id",
        productId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(50)

  if (error) {

    console.error(
      "GET SURVEY RESPONSES ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function createSurveyResponse(
  input: CreateSurveyResponseInput
): Promise<SurveyResponse | null> {

  const { data, error } =
    await supabase
      .from("survey_responses")
      .insert({
        survey_id:
          input.survey_id,
        product_id:
          input.product_id,
        channel:
          input.channel,
        respondent_name:
          input.respondent_name || null,
        respondent_phone:
          input.respondent_phone || null,
        respondent_email:
          input.respondent_email || null,
        response_value:
          input.response_value || null,
        response_label:
          input.response_label || null,
        score:
          input.score ?? null,
        comment:
          input.comment || null,
        source:
          input.source || null,
      })
      .select("*")
      .single()

  if (error) {

    console.error(
      "CREATE SURVEY RESPONSE ERROR:",
      error
    )

    return null

  }

  return data

}

export type SocialSignal = {
  id: string
  product_id: string
  platform: string
  metric_name: string
  metric_value: number
  sentiment: string | null
  notes: string | null
  captured_at: string | null
}

export type CreateSocialSignalInput = {
  product_id: string
  platform: string
  metric_name: string
  metric_value: number
  sentiment?: string | null
  notes?: string | null
}

export async function getSocialSignalsByProduct(
  productId: string
): Promise<SocialSignal[]> {

  const { data, error } =
    await supabase
      .from("social_signals")
      .select("*")
      .eq(
        "product_id",
        productId
      )
      .order(
        "captured_at",
        {
          ascending: false,
        }
      )

  if (error) {

    console.error(
      "GET SOCIAL SIGNALS ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function createSocialSignal(
  input: CreateSocialSignalInput
): Promise<SocialSignal | null> {

  const { data, error } =
    await supabase
      .from("social_signals")
      .insert({
        product_id:
          input.product_id,
        platform:
          input.platform,
        metric_name:
          input.metric_name,
        metric_value:
          input.metric_value,
        sentiment:
          input.sentiment || null,
        notes:
          input.notes || null,
      })
      .select("*")
      .single()

  if (error) {

    console.error(
      "CREATE SOCIAL SIGNAL ERROR:",
      error
    )

    return null

  }

  return data

}

export async function getStrategicNiches() {

  const { data, error } =
    await supabase
      .from("strategic_niches")
      .select(`
        *,
        strategic_subniches (*)
      `)
      .eq(
        "is_active",
        true
      )
      .order(
        "sort_order",
        {
          ascending: true,
        }
      )

  if (error) {

    console.error(
      "GET STRATEGIC NICHES ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getProductSubniches(
  productId: string
) {

  const { data, error } =
    await supabase
      .from("product_subniches")
      .select(`
        *,
        strategic_subniches (*)
      `)
      .eq(
        "product_id",
        productId
      )
      .order(
        "is_primary",
        {
          ascending: false,
        }
      )

  if (error) {

    console.error(
      "GET PRODUCT SUBNICHES ERROR:",
      error
    )

    return []

  }

  return data || []

}

function serializeSupabaseError(
  error: unknown
) {

  if (!error) {
    return null
  }

  if (error instanceof Error) {
    return {
      name:
        error.name,
      message:
        error.message,
      stack:
        error.stack,
    }
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    const entries =
      Object.getOwnPropertyNames(error)
        .map(
          key => [
            key,
            (error as Record<string, unknown>)[key],
          ]
        )

    return {
      ...Object.fromEntries(entries),
      raw:
        error,
    }
  }

  return {
    message:
      String(error),
  }

}

export async function updateProduct(
  productId: string,
  updates: {
    name?: string
    category?: string
    description?: string | null
    image_url?: string | null
    price?: number | null
    currency?: string | null
    direct_url?: string | null
    amazon_url?: string | null
    ebay_url?: string | null
    tiktok_url?: string | null
    state_id?: string | null
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
    commercial_category?: string | null
    strategic_niche_id?: string | null
    primary_subniche_id?: string | null
    target_customer?: string | null
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
    distribution_channels?: Array<{
      id: string
      country?: string
      city?: string
      type: string
      name: string
      location: string
      status: string
      url?: string
      note?: string
    }>
    commercial_notes?: string | null
  }
) {

  console.log(
    "UPDATE PRODUCT:",
    {
      productId,
      updates,
    }
  )

  const { error, count } =
    await supabase
      .from("products")
      .update(
        updates,
        {
          count: "exact",
        }
      )
      .eq(
        "id",
        productId
      )

  if (error) {

    console.error(
      "UPDATE PRODUCT ERROR:",
      serializeSupabaseError(error)
    )

    return null

  }

  const data = {
    id: productId,
    ...updates,
    count,
  }

  console.log(
    "PRODUCT UPDATED:",
    data
  )

  return data

}
