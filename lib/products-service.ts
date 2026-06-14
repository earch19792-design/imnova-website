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

const publicProductSelect = `
  id,
  slug,
  name,
  category,
  description,
  image_url,
  image,
  price,
  currency,
  state_id,
  direct_url,
  amazon_url,
  ebay_url,
  tiktok_url,
  launch_promo_enabled,
  launch_discount_percent,
  launch_promo_start_at,
  launch_promo_end_at,
  launch_promo_duration_days,
  usage_moment,
  main_benefit,
  how_to_use,
  usage_description,
  routine_suggestion,
  benefits,
  bullets,
  functional_claims,
  ingredients_summary,
  lifestyle_image,
  lifestyle_images,
  nicho,
  problema_resuelve,
  expected_benefit,
  survey_status,
  survey_score,
  survey_votes,
  social_interest_score,
  validation_status,
  validation_decision,
  created_at
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

export async function getPublicProducts(
  options: ProductsQueryOptions = {}
) {

  let query =
    supabase
      .from("public_products")
      .select(publicProductSelect)
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
      "GET PUBLIC PRODUCTS ERROR:",
      error
    )

    return []

  }

  return data || []

}

export async function getPublicProductBySlug(
  slug: string
) {

  const { data, error } =
    await supabase
      .from("public_products")
      .select(publicProductSelect)
      .eq(
        "slug",
        slug
      )
      .single()

  if (error) {

    console.error(
      "GET PUBLIC PRODUCT BY SLUG ERROR:",
      error
    )

    return null

  }

  return data

}

export async function getPublicProductsWithStatesByStateNames(
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
      .from("public_products")
      .select(publicProductSelect)
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
      "GET PUBLIC PRODUCTS WITH STATES BY STATE NAMES ERROR:",
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

export async function getPublicAvailableProducts(
  options: ProductsQueryOptions = {}
) {

  const {
    products,
  } =
    await getPublicProductsWithStatesByStateNames(
      [
        "Disponible",
      ],
      options
    )

  return products

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
        "*",
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
        "*"
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
        "*"
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
            "*"
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

export type DistributionLocationProduct = {
  id: string
  name: string
  category: string | null
  image_url: string | null
  image: string | null
  state_id: string | null
}

export type DistributionLocation = {
  id: string
  product_id: string
  external_key: string | null
  channel_category: string | null
  channel_type: string | null
  platform: string | null
  name: string
  country: string | null
  country_code: string | null
  city: string | null
  area: string | null
  address: string | null
  latitude: number | string | null
  longitude: number | string | null
  description: string | null
  product_url: string | null
  map_url: string | null
  is_active: boolean | null
  is_authorized: boolean | null
  availability_status: string | null
  priority: number | null
  created_at: string | null
  updated_at: string | null
  products?:
    | DistributionLocationProduct
    | DistributionLocationProduct[]
    | null
}

export type DistributionLocationInput = {
  product_id: string
  external_key?: string | null
  channel_category?: string | null
  channel_type?: string | null
  platform?: string | null
  name: string
  country?: string | null
  country_code?: string | null
  city?: string | null
  area?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  description?: string | null
  product_url?: string | null
  map_url?: string | null
  is_active?: boolean
  is_authorized?: boolean
  availability_status?: string | null
  priority?: number | null
}

type DistributionLocationsPageOptions = {
  limit?: number
  page?: number
}

function getAvailableStateIds(
  states: Array<{
    id: string
    name: string
  }>
) {
  return states
    .filter((state) =>
      normalizeStateName(
        state.name
      ).includes("disponible")
    )
    .map((state) => state.id)
}

export async function getAvailableDistributionLocationsPage(
  options: DistributionLocationsPageOptions = {}
): Promise<{
  locations: DistributionLocation[]
  count: number
  error: boolean
}> {

  const limit =
    options.limit || 24

  const page =
    options.page || 0

  const from =
    page * limit

  const to =
    from + limit - 1

  const states =
    await getProductStates()

  const availableStateIds =
    getAvailableStateIds(
      states as Array<{
        id: string
        name: string
      }>
    )

  if (availableStateIds.length === 0) {
    return {
      locations: [],
      count: 0,
      error: false,
    }
  }

  const {
    data,
    error,
    count,
  } =
    await supabase
      .from("public_distribution_locations")
      .select("*", {
        count: "exact",
      })
      .order(
        "priority",
        {
          ascending: false,
        }
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .range(from, to)

  if (error) {
    console.error(
      "GET AVAILABLE DISTRIBUTION LOCATIONS ERROR:",
      error
    )

    return {
      locations: [],
      count: 0,
      error: true,
    }
  }

  const locationRows =
    (data || []) as DistributionLocation[]

  const productIds =
    Array.from(
      new Set(
        locationRows
          .map((location) =>
            location.product_id
          )
          .filter(Boolean)
      )
    )

  if (productIds.length === 0) {
    return {
      locations: [],
      count: 0,
      error: false,
    }
  }

  const {
    data: products,
    error: productsError,
  } =
    await supabase
      .from("public_products")
      .select(
        "id,name,category,image_url,image,state_id"
      )
      .in("id", productIds)
      .in(
        "state_id",
        availableStateIds
      )

  if (productsError) {
    console.error(
      "GET AVAILABLE DISTRIBUTION LOCATION PRODUCTS ERROR:",
      productsError
    )

    return {
      locations: [],
      count: 0,
      error: true,
    }
  }

  const productsById =
    new Map(
      (
        (products ||
          []) as DistributionLocationProduct[]
      ).map((product) => [
        product.id,
        product,
      ])
    )

  const availableLocations =
    locationRows
      .map((location) => {
        const product =
          productsById.get(
            location.product_id
          )

        if (!product) {
          return null
        }

        return {
          ...location,
          products:
            product,
        }
      })
      .filter(
        Boolean
      ) as DistributionLocation[]

  return {
    locations:
      availableLocations,
    count:
      Math.min(
        count || availableLocations.length,
        availableLocations.length
      ),
    error: false,
  }

}

export async function getDistributionLocationsByProduct(
  productId: string
): Promise<DistributionLocation[]> {

  const { data, error } =
    await supabase
      .from("distribution_locations")
      .select("*")
      .eq(
        "product_id",
        productId
      )
      .order(
        "priority",
        {
          ascending: false,
        }
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )

  if (error) {
    console.error(
      "GET DISTRIBUTION LOCATIONS ERROR:",
      error
    )

    return []
  }

  return (data || []) as DistributionLocation[]

}

export async function createDistributionLocation(
  input: DistributionLocationInput
): Promise<DistributionLocation | null> {

  const { data, error } =
    await supabase
      .from("distribution_locations")
      .insert({
        product_id:
          input.product_id,
        external_key:
          input.external_key || null,
        channel_category:
          input.channel_category || "physical",
        channel_type:
          input.channel_type || "establecimiento",
        platform:
          input.platform || null,
        name:
          input.name,
        country:
          input.country || "Nicaragua",
        country_code:
          input.country_code || "NI",
        city:
          input.city || "Managua",
        area:
          input.area || null,
        address:
          input.address || null,
        latitude:
          input.latitude ?? null,
        longitude:
          input.longitude ?? null,
        description:
          input.description || null,
        product_url:
          input.product_url || null,
        map_url:
          input.map_url || null,
        is_active:
          input.is_active ?? true,
        is_authorized:
          input.is_authorized ?? true,
        availability_status:
          input.availability_status || "activo",
        priority:
          input.priority ?? 0,
      })
      .select("*")
      .single()

  if (error) {
    console.error(
      "CREATE DISTRIBUTION LOCATION ERROR:",
      error
    )

    return null
  }

  return data as DistributionLocation

}

export async function updateDistributionLocation(
  locationId: string,
  updates: Partial<
    Omit<
      DistributionLocationInput,
      "product_id"
    >
  >
): Promise<DistributionLocation | null> {

  const { data, error } =
    await supabase
      .from("distribution_locations")
      .update(updates)
      .eq("id", locationId)
      .select("*")
      .single()

  if (error) {
    console.error(
      "UPDATE DISTRIBUTION LOCATION ERROR:",
      error
    )

    return null
  }

  return data as DistributionLocation

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

export type CommunitySubscriber = {
  id: string
  nombre: string | null
  telefono: string | null
  email: string | null
  nichos: string[] | string | null
  objetivo_principal: string | null
  created_at: string | null
}

export type ManualCommunitySubscriberInput = {
  nombre: string
  telefono: string
  email?: string | null
  nichos?: string[] | null
  objetivo_principal?: string | null
}

export type SubscriberInterest = {
  id: string
  subscriber_id: string
  subniche_id: string
  source: string | null
  created_at: string | null
}

export type CommunitySubscriberStats = {
  totalSubscribers: number
  subscribersWithInterests: number
  percentWithWhatsapp: number
  percentWithEmail: number
}

export type TopCommunityNiche = {
  niche_id: string
  niche_name: string
  niche_public_name: string | null
  count: number
}

export type TopCommunitySubniche = {
  subniche_id: string
  subniche_name: string
  subniche_public_name: string | null
  niche_public_name: string | null
  count: number
}

export type CommunitySubscriberNormalizedInterest = {
  subniche_id: string
  subniche_name: string
  subniche_public_name: string | null
  niche_id: string | null
  niche_name: string | null
  niche_public_name: string | null
}

export type CommunitySubscriberWithInterests =
  CommunitySubscriber & {
    interests: CommunitySubscriberNormalizedInterest[]
    legacy_nichos: string[]
  }

export type CreateSubscriberInterestInput = {
  subscriber_id: string
  subniche_id: string
  source?: string | null
}

export type CreateSubscriberInterestsInput = {
  subscriber_id: string
  subniche_ids: string[]
  source?: string | null
}

function normalizeCommunityPhone(
  phone: string
) {
  const digits =
    phone.replace(/\D/g, "")

  if (!digits) {
    return ""
  }

  if (digits.length === 8) {
    return `505${digits}`
  }

  return digits
}

function createLocalUuid() {
  const randomUuid =
    globalThis.crypto?.randomUUID?.()

  if (randomUuid) {
    return randomUuid
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    .replace(
      /[xy]/g,
      (character) => {
        const value =
          Math.floor(
            Math.random() * 16
          )

        const uuidValue =
          character === "x"
            ? value
            : (value & 0x3) | 0x8

        return uuidValue.toString(16)
      }
    )
}

function getSubscriberInterestSource(
  source?: string | null
) {
  return source?.trim() ||
    "community_popup"
}

type CommunityInterestRow = {
  subscriber_id: string | null
  subniche_id: string | null
  created_at?: string | null
}

type CommunityStrategicNicheRow = {
  id: string
  name: string | null
  public_name: string | null
}

type CommunityStrategicSubnicheRow = {
  id: string
  niche_id: string | null
  name: string | null
  public_name: string | null
}

const EMPTY_COMMUNITY_SUBSCRIBER_STATS: CommunitySubscriberStats = {
  totalSubscribers: 0,
  subscribersWithInterests: 0,
  percentWithWhatsapp: 0,
  percentWithEmail: 0,
}

function getCommunityPercent(
  value: number,
  total: number
) {
  if (total <= 0) {
    return 0
  }

  return Math.round(
    (value / total) * 100
  )
}

function normalizeLegacyNichos(
  nichos: string[] | string | null
) {
  if (Array.isArray(nichos)) {
    return nichos
      .map((niche) =>
        String(niche).trim()
      )
      .filter(Boolean)
  }

  if (!nichos) {
    return []
  }

  try {
    const parsedNichos =
      JSON.parse(nichos)

    if (Array.isArray(parsedNichos)) {
      return parsedNichos
        .map((niche) =>
          String(niche).trim()
        )
        .filter(Boolean)
    }
  } catch {
    // Legacy values can be stored as comma separated text.
  }

  return nichos
    .split(",")
    .map((niche) =>
      niche.trim()
    )
    .filter(Boolean)
}

async function getCommunityInterestRowsForAdmin(): Promise<CommunityInterestRow[]> {

  const rows: CommunityInterestRow[] = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } =
      await supabase
        .from("subscriber_interests")
        .select(`
          subscriber_id,
          subniche_id,
          created_at
        `)
        .range(
          from,
          from + pageSize - 1
        )

    if (error) {
      console.error(
        "GET COMMUNITY INTEREST ROWS ERROR:",
        error
      )

      return []
    }

    const page =
      (data || []) as CommunityInterestRow[]

    rows.push(
      ...page.filter(
        (row) =>
          Boolean(row.subscriber_id) &&
          Boolean(row.subniche_id)
      )
    )

    if (page.length < pageSize) {
      break
    }

    from += pageSize
  }

  return rows

}

async function getCommunityStrategicCatalog() {

  const [
    nichesResult,
    subnichesResult,
  ] =
    await Promise.all([
      supabase
        .from("strategic_niches")
        .select(`
          id,
          name,
          public_name
        `),
      supabase
        .from("strategic_subniches")
        .select(`
          id,
          niche_id,
          name,
          public_name
        `),
    ])

  if (nichesResult.error) {
    console.error(
      "GET COMMUNITY STRATEGIC NICHES ERROR:",
      nichesResult.error
    )
  }

  if (subnichesResult.error) {
    console.error(
      "GET COMMUNITY STRATEGIC SUBNICHES ERROR:",
      subnichesResult.error
    )
  }

  const niches =
    nichesResult.error
      ? []
      : (nichesResult.data || []) as CommunityStrategicNicheRow[]

  const subniches =
    subnichesResult.error
      ? []
      : (subnichesResult.data || []) as CommunityStrategicSubnicheRow[]

  return {
    nichesById:
      new Map(
        niches.map(
          (niche) => [
            niche.id,
            niche,
          ]
        )
      ),
    subnichesById:
      new Map(
        subniches.map(
          (subniche) => [
            subniche.id,
            subniche,
          ]
        )
      ),
  }

}

export async function getRecentCommunitySubscribers(
  limit = 8
): Promise<CommunitySubscriber[]> {

  const { data, error } =
    await supabase
      .from("subscribers")
      .select(`
        id,
        nombre,
        telefono,
        email,
        nichos,
        objetivo_principal,
        created_at
      `)
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(limit)

  if (error) {
    console.error(
      "GET COMMUNITY SUBSCRIBERS ERROR:",
      error
    )

    return []
  }

  return (data || []) as CommunitySubscriber[]

}

export async function getCommunitySubscriberStats(): Promise<CommunitySubscriberStats> {

  const [
    totalSubscribersResult,
    subscribersWithWhatsappResult,
    subscribersWithEmailResult,
    interestRows,
  ] =
    await Promise.all([
      supabase
        .from("subscribers")
        .select(
          "id",
          {
            count: "exact",
            head: true,
          }
        ),
      supabase
        .from("subscribers")
        .select(
          "id",
          {
            count: "exact",
            head: true,
          }
        )
        .not(
          "telefono",
          "is",
          null
        )
        .neq(
          "telefono",
          ""
        ),
      supabase
        .from("subscribers")
        .select(
          "id",
          {
            count: "exact",
            head: true,
          }
        )
        .not(
          "email",
          "is",
          null
        )
        .neq(
          "email",
          ""
        ),
      getCommunityInterestRowsForAdmin(),
    ])

  if (totalSubscribersResult.error) {
    console.error(
      "GET COMMUNITY TOTAL SUBSCRIBERS ERROR:",
      totalSubscribersResult.error
    )

    return EMPTY_COMMUNITY_SUBSCRIBER_STATS
  }

  if (subscribersWithWhatsappResult.error) {
    console.error(
      "GET COMMUNITY WHATSAPP SUBSCRIBERS ERROR:",
      subscribersWithWhatsappResult.error
    )
  }

  if (subscribersWithEmailResult.error) {
    console.error(
      "GET COMMUNITY EMAIL SUBSCRIBERS ERROR:",
      subscribersWithEmailResult.error
    )
  }

  const totalSubscribers =
    totalSubscribersResult.count || 0

  const subscribersWithWhatsapp =
    subscribersWithWhatsappResult.error
      ? 0
      : subscribersWithWhatsappResult.count || 0

  const subscribersWithEmail =
    subscribersWithEmailResult.error
      ? 0
      : subscribersWithEmailResult.count || 0

  const subscribersWithInterests =
    new Set(
      interestRows
        .map((row) =>
          row.subscriber_id
        )
        .filter(
          (subscriberId): subscriberId is string =>
            Boolean(subscriberId)
        )
    ).size

  return {
    totalSubscribers,
    subscribersWithInterests,
    percentWithWhatsapp:
      getCommunityPercent(
        subscribersWithWhatsapp,
        totalSubscribers
      ),
    percentWithEmail:
      getCommunityPercent(
        subscribersWithEmail,
        totalSubscribers
      ),
  }

}

export async function getTopCommunityNiches(
  limit = 5
): Promise<TopCommunityNiche[]> {

  const [
    interestRows,
    catalog,
  ] =
    await Promise.all([
      getCommunityInterestRowsForAdmin(),
      getCommunityStrategicCatalog(),
    ])

  const countByNicheId =
    new Map<string, number>()

  interestRows.forEach(
    (interestRow) => {
      if (!interestRow.subniche_id) {
        return
      }

      const subniche =
        catalog.subnichesById.get(
          interestRow.subniche_id
        )

      const nicheId =
        subniche?.niche_id ||
        "unknown"

      countByNicheId.set(
        nicheId,
        (
          countByNicheId.get(
            nicheId
          ) || 0
        ) + 1
      )
    }
  )

  return Array.from(
    countByNicheId.entries()
  )
    .map(
      ([
        nicheId,
        count,
      ]) => {
        const niche =
          catalog.nichesById.get(
            nicheId
          )

        return {
          niche_id:
            nicheId,
          niche_name:
            niche?.name ||
            "Nicho sin catalogo",
          niche_public_name:
            niche?.public_name ||
            null,
          count,
        }
      }
    )
    .sort(
      (
        nicheA,
        nicheB
      ) =>
        nicheB.count -
        nicheA.count
    )
    .slice(
      0,
      limit
    )

}

export async function getTopCommunitySubniches(
  limit = 5
): Promise<TopCommunitySubniche[]> {

  const [
    interestRows,
    catalog,
  ] =
    await Promise.all([
      getCommunityInterestRowsForAdmin(),
      getCommunityStrategicCatalog(),
    ])

  const countBySubnicheId =
    new Map<string, number>()

  interestRows.forEach(
    (interestRow) => {
      if (!interestRow.subniche_id) {
        return
      }

      countBySubnicheId.set(
        interestRow.subniche_id,
        (
          countBySubnicheId.get(
            interestRow.subniche_id
          ) || 0
        ) + 1
      )
    }
  )

  return Array.from(
    countBySubnicheId.entries()
  )
    .map(
      ([
        subnicheId,
        count,
      ]) => {
        const subniche =
          catalog.subnichesById.get(
            subnicheId
          )

        const niche =
          subniche?.niche_id
            ? catalog.nichesById.get(
                subniche.niche_id
              )
            : null

        return {
          subniche_id:
            subnicheId,
          subniche_name:
            subniche?.name ||
            "Subnicho sin catalogo",
          subniche_public_name:
            subniche?.public_name ||
            null,
          niche_public_name:
            niche?.public_name ||
            niche?.name ||
            null,
          count,
        }
      }
    )
    .sort(
      (
        subnicheA,
        subnicheB
      ) =>
        subnicheB.count -
        subnicheA.count
    )
    .slice(
      0,
      limit
    )

}

export async function getRecentSubscribersWithInterests(
  limit = 10
): Promise<CommunitySubscriberWithInterests[]> {

  const subscribers =
    await getRecentCommunitySubscribers(
      limit
    )

  if (subscribers.length === 0) {
    return []
  }

  const subscriberIds =
    subscribers.map(
      (subscriber) =>
        subscriber.id
    )

  const [
    interestsResult,
    catalog,
  ] =
    await Promise.all([
      supabase
        .from("subscriber_interests")
        .select(`
          subscriber_id,
          subniche_id,
          created_at
        `)
        .in(
          "subscriber_id",
          subscriberIds
        ),
      getCommunityStrategicCatalog(),
    ])

  if (interestsResult.error) {
    console.error(
      "GET RECENT SUBSCRIBERS INTERESTS ERROR:",
      interestsResult.error
    )
  }

  const interestRows =
    interestsResult.error
      ? []
      : (interestsResult.data || []) as CommunityInterestRow[]

  const interestsBySubscriberId =
    new Map<string, CommunitySubscriberNormalizedInterest[]>()

  interestRows.forEach(
    (interestRow) => {
      if (
        !interestRow.subscriber_id ||
        !interestRow.subniche_id
      ) {
        return
      }

      const subniche =
        catalog.subnichesById.get(
          interestRow.subniche_id
        )

      const niche =
        subniche?.niche_id
          ? catalog.nichesById.get(
              subniche.niche_id
            )
          : null

      const subscriberInterests =
        interestsBySubscriberId.get(
          interestRow.subscriber_id
        ) || []

      subscriberInterests.push({
        subniche_id:
          interestRow.subniche_id,
        subniche_name:
          subniche?.name ||
          "Subnicho sin catalogo",
        subniche_public_name:
          subniche?.public_name ||
          null,
        niche_id:
          subniche?.niche_id ||
          null,
        niche_name:
          niche?.name ||
          null,
        niche_public_name:
          niche?.public_name ||
          null,
      })

      interestsBySubscriberId.set(
        interestRow.subscriber_id,
        subscriberInterests
      )
    }
  )

  return subscribers.map(
    (subscriber) => ({
      ...subscriber,
      interests:
        interestsBySubscriberId.get(
          subscriber.id
        ) || [],
      legacy_nichos:
        normalizeLegacyNichos(
          subscriber.nichos
        ),
    })
  )

}

export async function createManualCommunitySubscriber(
  input: ManualCommunitySubscriberInput
): Promise<{
  subscriber: CommunitySubscriber | null
  error: string | null
}> {

  const phone =
    normalizeCommunityPhone(
      input.telefono
    )

  if (!phone) {
    return {
      subscriber: null,
      error:
        "El numero WhatsApp es obligatorio.",
    }
  }

  const payload = {
    nombre:
      input.nombre.trim(),
    telefono:
      phone,
    email:
      input.email?.trim() || null,
    nichos:
      input.nichos || [],
    objetivo_principal:
      input.objetivo_principal?.trim() ||
      "Registro manual desde Admin para comunidad WhatsApp.",
  }

  const { data, error } =
    await supabase
      .from("subscribers")
      .insert(payload)
      .select(`
        id,
        nombre,
        telefono,
        email,
        nichos,
        objetivo_principal,
        created_at
      `)
      .single()

  if (error) {
    console.error(
      "CREATE MANUAL COMMUNITY SUBSCRIBER ERROR:",
      {
        error,
        payload,
      }
    )

    return {
      subscriber: null,
      error:
        formatSupabaseErrorMessage(error) ||
        "No se pudo registrar el numero WhatsApp.",
    }
  }

  return {
    subscriber:
      data as CommunitySubscriber,
    error: null,
  }

}

export async function createSubscriberInterest(
  input: CreateSubscriberInterestInput
): Promise<SubscriberInterest | null> {

  const subscriberInterest: SubscriberInterest = {
    id:
      createLocalUuid(),
    subscriber_id:
      input.subscriber_id,
    subniche_id:
      input.subniche_id,
    source:
      getSubscriberInterestSource(
        input.source
      ),
    created_at:
      null,
  }

  const { error } =
    await supabase
      .from("subscriber_interests")
      .upsert(
        {
          id:
            subscriberInterest.id,
          subscriber_id:
            subscriberInterest.subscriber_id,
          subniche_id:
            subscriberInterest.subniche_id,
          source:
            subscriberInterest.source,
        },
        {
          onConflict:
            "subscriber_id,subniche_id",
          ignoreDuplicates:
            true,
        }
      )

  if (error) {
    console.error(
      "CREATE SUBSCRIBER INTEREST ERROR:",
      error
    )

    return null
  }

  return subscriberInterest

}

export async function createSubscriberInterests(
  input: CreateSubscriberInterestsInput
): Promise<SubscriberInterest[]> {

  const uniqueSubnicheIds =
    Array.from(
      new Set(
        input.subniche_ids
          .map(subnicheId =>
            subnicheId.trim()
          )
          .filter(Boolean)
      )
    )

  if (uniqueSubnicheIds.length === 0) {
    return []
  }

  const source =
    getSubscriberInterestSource(
      input.source
    )

  const subscriberInterests: SubscriberInterest[] =
    uniqueSubnicheIds.map(
      subnicheId => ({
        id:
          createLocalUuid(),
        subscriber_id:
          input.subscriber_id,
        subniche_id:
          subnicheId,
        source,
        created_at:
          null,
      })
    )

  const { error } =
    await supabase
      .from("subscriber_interests")
      .upsert(
        subscriberInterests.map(
          subscriberInterest => ({
            id:
              subscriberInterest.id,
            subscriber_id:
              subscriberInterest.subscriber_id,
            subniche_id:
              subscriberInterest.subniche_id,
            source:
              subscriberInterest.source,
          })
        ),
        {
          onConflict:
            "subscriber_id,subniche_id",
          ignoreDuplicates:
            true,
        }
      )

  if (error) {
    console.error(
      "CREATE SUBSCRIBER INTERESTS ERROR:",
      error
    )

    return []
  }

  return subscriberInterests

}

export async function getAdminSubscriberInterests(): Promise<SubscriberInterest[]> {

  const { data, error } =
    await supabase
      .from("subscriber_interests")
      .select(`
        id,
        subscriber_id,
        subniche_id,
        source,
        created_at
      `)
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(100)

  if (error) {
    console.error(
      "GET ADMIN SUBSCRIBER INTERESTS ERROR:",
      error
    )

    return []
  }

  return (data || []) as SubscriberInterest[]

}

export async function getSubscriberInterestsBySubscriber(
  subscriberId: string
): Promise<SubscriberInterest[]> {

  const { data, error } =
    await supabase
      .from("subscriber_interests")
      .select(`
        id,
        subscriber_id,
        subniche_id,
        source,
        created_at
      `)
      .eq(
        "subscriber_id",
        subscriberId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )

  if (error) {
    console.error(
      "GET SUBSCRIBER INTERESTS BY SUBSCRIBER ERROR:",
      error
    )

    return []
  }

  return (data || []) as SubscriberInterest[]

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

export type CreateCommunitySurveyResult = {
  survey: CommunitySurvey | null
  error: string | null
  errorCode: string | null
}

function formatSupabaseErrorMessage(
  error: {
    code?: string
    message?: string
    details?: string
    hint?: string
  }
) {
  return [
    error.code
      ? `[${error.code}]`
      : null,
    error.message,
    error.details
      ? `Details: ${error.details}`
      : null,
    error.hint
      ? `Hint: ${error.hint}`
      : null,
  ]
    .filter(Boolean)
    .join(" ")
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
): Promise<CreateCommunitySurveyResult> {

  const payload = {
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
  }

  const { data, error } =
    await supabase
      .from("community_surveys")
      .insert(payload)
      .select("*")
      .single()

  if (error) {

    console.error(
      "CREATE SURVEY ERROR:",
      {
        error,
        payload,
      }
    )

    return {
      survey: null,
      error:
        formatSupabaseErrorMessage(
          error
        ) ||
        "No se pudo crear la encuesta.",
      errorCode:
        error.code || null,
    }

  }

  return {
    survey: data,
    error: null,
    errorCode: null,
  }

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

export type StrategicNiche = {
  id: string
  slug: string
  name: string
  public_name: string | null
  description: string | null
  icon: string | null
  icon_key: string | null
  sort_order: number | null
}

export type StrategicSubniche = {
  id: string
  niche_id: string
  slug: string
  name: string
  public_name: string | null
  description: string | null
  icon: string | null
  icon_key: string | null
  sort_order: number | null
}

export type StrategicNicheWithSubniches =
  StrategicNiche & {
    subniches: StrategicSubniche[]
  }

export async function getPublicStrategicNiches(): Promise<StrategicNiche[]> {

  const { data, error } =
    await supabase
      .from("strategic_niches")
      .select(`
        id,
        slug,
        name,
        public_name,
        description,
        icon,
        icon_key,
        sort_order
      `)
      .eq(
        "is_active",
        true
      )
      .eq(
        "is_public",
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
      "GET PUBLIC STRATEGIC NICHES ERROR:",
      error
    )

    return []

  }

  return (data || []) as StrategicNiche[]

}

export async function getPublicStrategicSubniches(): Promise<StrategicSubniche[]> {

  const { data, error } =
    await supabase
      .from("strategic_subniches")
      .select(`
        id,
        niche_id,
        slug,
        name,
        public_name,
        description,
        icon,
        icon_key,
        sort_order
      `)
      .eq(
        "is_active",
        true
      )
      .eq(
        "is_public",
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
      "GET PUBLIC STRATEGIC SUBNICHES ERROR:",
      error
    )

    return []

  }

  return (data || []) as StrategicSubniche[]

}

export async function getPublicNichesWithSubniches(): Promise<StrategicNicheWithSubniches[]> {

  const [
    niches,
    subniches,
  ] =
    await Promise.all([
      getPublicStrategicNiches(),
      getPublicStrategicSubniches(),
    ])

  const subnichesByNicheId =
    subniches.reduce<
      Map<string, StrategicSubniche[]>
    >(
      (groups, subniche) => {
        const nicheSubniches =
          groups.get(
            subniche.niche_id
          ) || []

        nicheSubniches.push(
          subniche
        )

        groups.set(
          subniche.niche_id,
          nicheSubniches
        )

        return groups
      },
      new Map()
    )

  return niches.map(
    niche => ({
      ...niche,
      subniches:
        subnichesByNicheId.get(
          niche.id
        ) || [],
    })
  )

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
    launch_promo_enabled?: boolean | null
    launch_discount_percent?: number | null
    launch_promo_start_at?: string | null
    launch_promo_end_at?: string | null
    launch_promo_duration_days?: number | null
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
