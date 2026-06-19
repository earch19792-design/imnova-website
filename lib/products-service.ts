import { supabase } from "./supabase"

type ProductsQueryOptions = {
  limit?: number
  from?: number
  to?: number
  orderBy?: string
  ascending?: boolean
  availableOnly?: boolean
}

type PublicProductsPageOptions =
  ProductsQueryOptions & {
    page?: number
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
  const states =
    options.availableOnly === false
      ? []
      : await getProductStates()

  const availableStateIds =
    options.availableOnly === false
      ? []
      : getStateIdsByNames(
          states as Array<{
            id: string
            name: string
          }>,
          [
            "Disponible",
          ]
        )

  if (
    options.availableOnly !== false &&
    availableStateIds.length === 0
  ) {
    return []
  }

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

  if (options.availableOnly !== false) {
    query =
      query.in(
        "state_id",
        availableStateIds
      )
  }

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

  const states =
    await getProductStates()

  const availableStateIds =
    getStateIdsByNames(
      states as Array<{
        id: string
        name: string
      }>,
      [
        "Disponible",
      ]
    )

  if (availableStateIds.length === 0) {
    return null
  }

  const { data, error } =
    await supabase
      .from("public_products")
      .select(publicProductSelect)
      .eq(
        "slug",
        slug
      )
      .in(
        "state_id",
        availableStateIds
      )
      .maybeSingle()

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

export async function getPublicProductsPageWithStatesByStateNames(
  stateNames: string[],
  options: PublicProductsPageOptions = {}
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

  const limit =
    Math.min(
      Math.max(
        Math.floor(
          Number(options.limit || 24)
        ),
        1
      ),
      100
    )

  const page =
    Math.max(
      Math.floor(
        Number(options.page || 0)
      ),
      0
    )

  const from =
    page * limit

  const to =
    from + limit - 1

  if (stateIds.length === 0) {
    return {
      products: [],
      states,
      count: 0,
      page,
      limit,
      hasMore: false,
      error: false,
    }
  }

  const { data, error, count } =
    await supabase
      .from("public_products")
      .select(
        publicProductSelect,
        {
          count: "exact",
        }
      )
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
      .range(
        from,
        to
      )

  if (error) {

    console.error(
      "GET PUBLIC PRODUCTS PAGE WITH STATES BY STATE NAMES ERROR:",
      error
    )

    return {
      products: [],
      states,
      count: 0,
      page,
      limit,
      hasMore: false,
      error: true,
    }

  }

  const total =
    count || 0

  return {
    products:
      data || [],
    states,
    count:
      total,
    page,
    limit,
    hasMore:
      to + 1 < total,
    error: false,
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
  subscribersWithAreaInterests: number
  subscribersWithSubnicheInterests: number
  percentWithWhatsapp: number
  percentWithEmail: number
}

export type CommunityGrowthLevelCount = {
  level_key: string
  level_label: string | null
  count: number
}

export type CommunityGrowthSummary = {
  totalReferralCodes: number
  totalReferrals: number
  totalPointsAwarded: number
  vipMembers: number
  activeRewards: number
  transparencyItems: number
  levelCounts: CommunityGrowthLevelCount[]
}

export type TransparencyWallItemStatus =
  | "idea_proposed"
  | "idea_in_validation"
  | "product_in_development"
  | "product_launched"

export type TransparencyWallItem = {
  id: string
  title: string
  summary: string | null
  status: TransparencyWallItemStatus
  product_id: string | null
  idea_lab_item_id: string | null
  trend_signal_id: string | null
  source: string | null
  is_public: boolean | null
  is_active: boolean | null
  display_order: number | null
  published_at: string | null
  created_at: string | null
  updated_at?: string | null
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

export type TopCommunityArea = {
  area_id: string
  area_key: string
  area_label: string
  area_description: string | null
  count: number
}

export type SubnicheDemandProduct = {
  id: string
  name: string
  slug: string | null
  state_id?: string | null
  validation_status?: string | null
  survey_status?: string | null
}

export type SubnicheDemandWithProducts = {
  subniche_id: string
  subniche_name: string
  subniche_public_name: string | null
  niche_id: string | null
  niche_name: string | null
  niche_public_name: string | null
  interested_members_count: number
  products_count: number
  products: SubnicheDemandProduct[]
  active_surveys_count: number
  total_surveys_count: number
  opportunity_status:
    | "alta_demanda_sin_producto"
    | "producto_con_demanda"
    | "producto_sin_demanda_suficiente"
    | "en_validacion"
}

export type CommunitySubscriberNormalizedInterest = {
  subniche_id: string
  subniche_name: string
  subniche_public_name: string | null
  niche_id: string | null
  niche_name: string | null
  niche_public_name: string | null
}

export type CommunitySubscriberAreaInterest = {
  area_id: string
  area_key: string
  area_label: string
  area_description: string | null
}

export type CommunityCommunicationPreference = {
  channel: "whatsapp" | "email"
  opted_in: boolean
  opted_in_at: string | null
  opted_out_at: string | null
  source: string | null
  consent_text: string | null
  updated_at: string | null
}

export type CommunitySubscriberWithInterests =
  CommunitySubscriber & {
    interests: CommunitySubscriberNormalizedInterest[]
    area_interests: CommunitySubscriberAreaInterest[]
    communication_preferences: CommunityCommunicationPreference[]
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

type CommunityAreaInterestRow = {
  subscriber_id: string | null
  area_id: string | null
  created_at?: string | null
}

type CommunityInterestAreaRow = {
  id: string
  key: string | null
  label: string | null
  description: string | null
  display_order?: number | null
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

type ProductSubnicheDemandRow = {
  product_id: string | null
  subniche_id: string | null
}

type ProductPrimarySubnicheDemandRow = {
  id: string | null
  primary_subniche_id: string | null
}

type ProductDemandDetailRow = {
  id: string | null
  name: string | null
  slug: string | null
  state_id: string | null
  validation_status: string | null
  survey_status: string | null
}

type CommunitySurveyDemandRow = {
  id: string | null
  subniche_id: string | null
  status: string | null
}

const EMPTY_COMMUNITY_SUBSCRIBER_STATS: CommunitySubscriberStats = {
  totalSubscribers: 0,
  subscribersWithInterests: 0,
  subscribersWithAreaInterests: 0,
  subscribersWithSubnicheInterests: 0,
  percentWithWhatsapp: 0,
  percentWithEmail: 0,
}

const EMPTY_COMMUNITY_GROWTH_SUMMARY: CommunityGrowthSummary = {
  totalReferralCodes: 0,
  totalReferrals: 0,
  totalPointsAwarded: 0,
  vipMembers: 0,
  activeRewards: 0,
  transparencyItems: 0,
  levelCounts: [],
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

function normalizeDemandStatus(
  status?: string | null
) {
  return (status || "")
    .toLowerCase()
    .trim()
}

function getSubnicheOpportunityStatus({
  activeSurveysCount,
  interestedMembersCount,
  productsCount,
}: {
  activeSurveysCount: number
  interestedMembersCount: number
  productsCount: number
}): SubnicheDemandWithProducts["opportunity_status"] {

  if (activeSurveysCount > 0) {
    return "en_validacion"
  }

  if (
    interestedMembersCount > 0 &&
    productsCount === 0
  ) {
    return "alta_demanda_sin_producto"
  }

  if (
    productsCount > 0 &&
    interestedMembersCount < 3
  ) {
    return "producto_sin_demanda_suficiente"
  }

  if (
    interestedMembersCount > 0 &&
    productsCount > 0
  ) {
    return "producto_con_demanda"
  }

  return "producto_sin_demanda_suficiente"

}

function getSubnicheOpportunitySortValue(
  status: SubnicheDemandWithProducts["opportunity_status"]
) {
  const priority = {
    en_validacion: 0,
    alta_demanda_sin_producto: 1,
    producto_con_demanda: 2,
    producto_sin_demanda_suficiente: 3,
  }

  return priority[status]
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

async function getCommunityAreaInterestRowsForAdmin(): Promise<CommunityAreaInterestRow[]> {

  const rows: CommunityAreaInterestRow[] = []
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } =
      await supabase
        .from("subscriber_area_interests")
        .select(`
          subscriber_id,
          area_id,
          created_at
        `)
        .range(
          from,
          from + pageSize - 1
        )

    if (error) {
      console.error(
        "GET COMMUNITY AREA INTEREST ROWS ERROR:",
        error
      )

      return []
    }

    const page =
      (data || []) as CommunityAreaInterestRow[]

    rows.push(
      ...page.filter(
        (row) =>
          Boolean(row.subscriber_id) &&
          Boolean(row.area_id)
      )
    )

    if (page.length < pageSize) {
      break
    }

    from += pageSize
  }

  return rows

}

async function getCommunityInterestAreaCatalog() {

  const { data, error } =
    await supabase
      .from("community_interest_areas")
      .select(`
        id,
        key,
        label,
        description,
        display_order
      `)
      .order(
        "display_order",
        {
          ascending: true,
        }
      )

  if (error) {
    console.error(
      "GET COMMUNITY INTEREST AREA CATALOG ERROR:",
      error
    )

    return {
      areasById:
        new Map<string, CommunityInterestAreaRow>(),
    }
  }

  const areas =
    (data || []) as CommunityInterestAreaRow[]

  return {
    areasById:
      new Map(
        areas.map(
          (area) => [
            area.id,
            area,
          ]
        )
      ),
  }

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
    areaInterestRows,
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
      getCommunityAreaInterestRowsForAdmin(),
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

  const subscribersWithSubnicheInterests =
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

  const subscribersWithAreaInterests =
    new Set(
      areaInterestRows
        .map((row) =>
          row.subscriber_id
        )
        .filter(
          (subscriberId): subscriberId is string =>
            Boolean(subscriberId)
        )
    ).size

  const subscribersWithInterests =
    new Set([
      ...interestRows
        .map((row) =>
          row.subscriber_id
        )
        .filter(
          (subscriberId): subscriberId is string =>
            Boolean(subscriberId)
        ),
      ...areaInterestRows
        .map((row) =>
          row.subscriber_id
        )
        .filter(
          (subscriberId): subscriberId is string =>
            Boolean(subscriberId)
        ),
    ]).size

  return {
    totalSubscribers,
    subscribersWithInterests,
    subscribersWithAreaInterests,
    subscribersWithSubnicheInterests,
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

async function getSafeTableCount(
  tableName: string,
  applyFilters?: (query: any) => any
) {
  let query =
    supabase
      .from(tableName)
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
    console.warn(
      "GET SAFE TABLE COUNT WARNING:",
      tableName,
      error
    )

    return 0
  }

  return count || 0
}

export async function getCommunityGrowthSummary(): Promise<CommunityGrowthSummary> {
  try {
    const [
      totalReferralCodes,
      totalReferrals,
      activeRewards,
      transparencyItems,
      statusResult,
      pointsResult,
      levelsResult,
    ] =
      await Promise.all([
        getSafeTableCount(
          "community_referral_codes"
        ),
        getSafeTableCount(
          "community_referrals"
        ),
        getSafeTableCount(
          "community_vip_rewards",
          query =>
            query.eq(
              "is_active",
              true
            )
        ),
        getSafeTableCount(
          "transparency_wall_items",
          query =>
            query.eq(
              "is_active",
              true
            )
        ),
        supabase
          .from("community_member_status")
          .select(
            "level_key,is_vip,points_total"
          ),
        supabase
          .from("community_points_ledger")
          .select("points"),
        supabase
          .from("community_levels")
          .select("key,label")
          .eq(
            "is_active",
            true
          ),
      ])

    if (statusResult.error) {
      console.warn(
        "GET COMMUNITY MEMBER STATUS SUMMARY WARNING:",
        statusResult.error
      )
    }

    if (pointsResult.error) {
      console.warn(
        "GET COMMUNITY POINTS SUMMARY WARNING:",
        pointsResult.error
      )
    }

    if (levelsResult.error) {
      console.warn(
        "GET COMMUNITY LEVELS SUMMARY WARNING:",
        levelsResult.error
      )
    }

    const levelLabels =
      new Map(
        (levelsResult.data || []).map(
          (level: any) => [
            String(level.key),
            level.label
              ? String(level.label)
              : null,
          ]
        )
      )

    const levelCountsMap =
      new Map<string, number>()

    const memberStatusRows =
      statusResult.error
        ? []
        : statusResult.data || []

    memberStatusRows.forEach(
      (row: any) => {
        const levelKey =
          String(
            row.level_key ||
            "miembro"
          )

        levelCountsMap.set(
          levelKey,
          (
            levelCountsMap.get(
              levelKey
            ) || 0
          ) + 1
        )
      }
    )

    const totalPointsAwarded =
      pointsResult.error
        ? 0
        : (pointsResult.data || []).reduce(
            (
              total: number,
              row: any
            ) =>
              total +
              Number(row.points || 0),
            0
          )

    const vipMembers =
      memberStatusRows.filter(
        (row: any) =>
          Boolean(row.is_vip)
      ).length

    return {
      totalReferralCodes,
      totalReferrals,
      totalPointsAwarded,
      vipMembers,
      activeRewards,
      transparencyItems,
      levelCounts:
        Array.from(
          levelCountsMap.entries()
        ).map(
          ([levelKey, count]) => ({
            level_key:
              levelKey,
            level_label:
              levelLabels.get(
                levelKey
              ) || null,
            count,
          })
        ),
    }
  } catch (error) {
    console.warn(
      "GET COMMUNITY GROWTH SUMMARY WARNING:",
      error
    )

    return EMPTY_COMMUNITY_GROWTH_SUMMARY
  }
}

const transparencyWallSelect = `
  id,
  title,
  summary,
  status,
  product_id,
  idea_lab_item_id,
  trend_signal_id,
  source,
  is_public,
  is_active,
  display_order,
  published_at,
  created_at,
  updated_at
`

export async function getPublicTransparencyWallItems(
  limit = 12
): Promise<TransparencyWallItem[]> {
  const { data, error } =
    await supabase
      .from("transparency_wall_items")
      .select(transparencyWallSelect)
      .eq(
        "is_public",
        true
      )
      .eq(
        "is_active",
        true
      )
      .order(
        "display_order",
        {
          ascending: true,
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
    console.warn(
      "GET PUBLIC TRANSPARENCY WALL ITEMS WARNING:",
      error
    )

    return []
  }

  return (data || []) as TransparencyWallItem[]
}

export async function getAdminTransparencyWallItems(
  limit = 20
): Promise<TransparencyWallItem[]> {
  const { data, error } =
    await supabase
      .from("transparency_wall_items")
      .select(transparencyWallSelect)
      .order(
        "display_order",
        {
          ascending: true,
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
    console.warn(
      "GET ADMIN TRANSPARENCY WALL ITEMS WARNING:",
      error
    )

    return []
  }

  return (data || []) as TransparencyWallItem[]
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

export async function getTopCommunityAreas(
  limit = 5
): Promise<TopCommunityArea[]> {

  const [
    areaInterestRows,
    catalog,
  ] =
    await Promise.all([
      getCommunityAreaInterestRowsForAdmin(),
      getCommunityInterestAreaCatalog(),
    ])

  const countByAreaId =
    new Map<string, number>()

  areaInterestRows.forEach(
    (areaInterestRow) => {
      if (!areaInterestRow.area_id) {
        return
      }

      countByAreaId.set(
        areaInterestRow.area_id,
        (
          countByAreaId.get(
            areaInterestRow.area_id
          ) || 0
        ) + 1
      )
    }
  )

  return Array.from(
    countByAreaId.entries()
  )
    .map(
      ([
        areaId,
        count,
      ]) => {
        const area =
          catalog.areasById.get(areaId)

        return {
          area_id:
            areaId,
          area_key:
            area?.key ||
            "area_sin_catalogo",
          area_label:
            area?.label ||
            "Area sin catalogo",
          area_description:
            area?.description ||
            null,
          count,
        }
      }
    )
    .sort(
      (
        areaA,
        areaB
      ) =>
        areaB.count -
        areaA.count
    )
    .slice(
      0,
      limit
    )

}

export async function getSubnicheDemandWithProducts(
  limit = 10
): Promise<SubnicheDemandWithProducts[]> {

  try {
    const [
      interestRows,
      catalog,
      productSubnichesResult,
      primaryProductsResult,
      surveysResult,
    ] =
      await Promise.all([
        getCommunityInterestRowsForAdmin(),
        getCommunityStrategicCatalog(),
        supabase
          .from("product_subniches")
          .select(`
            product_id,
            subniche_id
          `),
        supabase
          .from("products")
          .select(`
            id,
            primary_subniche_id
          `)
          .not(
            "primary_subniche_id",
            "is",
            null
          ),
        supabase
          .from("community_surveys")
          .select(`
            id,
            subniche_id,
            status
          `)
          .not(
            "subniche_id",
            "is",
            null
          ),
      ])

    if (productSubnichesResult.error) {
      console.error(
        "GET SUBNICHE DEMAND WITH PRODUCTS ERROR:",
        productSubnichesResult.error
      )

      return []
    }

    if (primaryProductsResult.error) {
      console.error(
        "GET SUBNICHE DEMAND WITH PRODUCTS ERROR:",
        primaryProductsResult.error
      )

      return []
    }

    if (surveysResult.error) {
      console.error(
        "GET SUBNICHE DEMAND WITH PRODUCTS ERROR:",
        surveysResult.error
      )

      return []
    }

    const interestedMembersBySubnicheId =
      new Map<string, number>()

    interestRows.forEach(
      (interestRow) => {
        if (!interestRow.subniche_id) {
          return
        }

        interestedMembersBySubnicheId.set(
          interestRow.subniche_id,
          (
            interestedMembersBySubnicheId.get(
              interestRow.subniche_id
            ) || 0
          ) + 1
        )
      }
    )

    const productIdsBySubnicheId =
      new Map<string, Set<string>>()

    const addProductForSubniche =
      (
        subnicheId?: string | null,
        productId?: string | null
      ) => {
        if (
          !subnicheId ||
          !productId
        ) {
          return
        }

        const productIds =
          productIdsBySubnicheId.get(
            subnicheId
          ) || new Set<string>()

        productIds.add(productId)

        productIdsBySubnicheId.set(
          subnicheId,
          productIds
        )
      }

    ;(
      (
        productSubnichesResult.data || []
      ) as ProductSubnicheDemandRow[]
    ).forEach(
      (row) => {
        addProductForSubniche(
          row.subniche_id,
          row.product_id
        )
      }
    )

    ;(
      (
        primaryProductsResult.data || []
      ) as ProductPrimarySubnicheDemandRow[]
    ).forEach(
      (row) => {
        addProductForSubniche(
          row.primary_subniche_id,
          row.id
        )
      }
    )

    const productIds =
      Array.from(
        new Set(
          Array.from(
            productIdsBySubnicheId.values()
          ).flatMap(
            productIdsSet =>
              Array.from(productIdsSet)
          )
        )
      )

    const productDetailsById =
      new Map<string, SubnicheDemandProduct>()

    if (productIds.length > 0) {
      const {
        data: productDetails,
        error: productDetailsError,
      } =
        await supabase
          .from("products")
          .select(`
            id,
            name,
            slug,
            state_id,
            validation_status,
            survey_status
          `)
          .in(
            "id",
            productIds
          )

      if (productDetailsError) {
        console.error(
          "GET SUBNICHE DEMAND WITH PRODUCTS ERROR:",
          productDetailsError
        )

        return []
      }

      ;(
        (
          productDetails || []
        ) as ProductDemandDetailRow[]
      ).forEach(
        (product) => {
          if (!product.id) {
            return
          }

          productDetailsById.set(
            product.id,
            {
              id:
                product.id,
              name:
                product.name ||
                "Producto sin nombre",
              slug:
                product.slug ||
                null,
              state_id:
                product.state_id ||
                null,
              validation_status:
                product.validation_status ||
                null,
              survey_status:
                product.survey_status ||
                null,
            }
          )
        }
      )
    }

    const totalSurveysBySubnicheId =
      new Map<string, number>()

    const activeSurveysBySubnicheId =
      new Map<string, number>()

    ;(
      (
        surveysResult.data || []
      ) as CommunitySurveyDemandRow[]
    ).forEach(
      (survey) => {
        if (!survey.subniche_id) {
          return
        }

        totalSurveysBySubnicheId.set(
          survey.subniche_id,
          (
            totalSurveysBySubnicheId.get(
              survey.subniche_id
            ) || 0
          ) + 1
        )

        const normalizedStatus =
          normalizeDemandStatus(
            survey.status
          )

        if (
          normalizedStatus === "active" ||
          normalizedStatus === "activa"
        ) {
          activeSurveysBySubnicheId.set(
            survey.subniche_id,
            (
              activeSurveysBySubnicheId.get(
                survey.subniche_id
              ) || 0
            ) + 1
          )
        }
      }
    )

    const subnicheIds =
      new Set<string>([
        ...interestedMembersBySubnicheId.keys(),
        ...productIdsBySubnicheId.keys(),
        ...totalSurveysBySubnicheId.keys(),
      ])

    return Array.from(subnicheIds)
      .map(
        (subnicheId) => {
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

          const interestedMembersCount =
            interestedMembersBySubnicheId.get(
              subnicheId
            ) || 0

          const productsCount =
            productIdsBySubnicheId.get(
              subnicheId
            )?.size || 0

          const products =
            Array.from(
              productIdsBySubnicheId.get(
                subnicheId
              ) || []
            )
              .map(
                productId =>
                  productDetailsById.get(
                    productId
                  ) || null
              )
              .filter(
                (
                  product
                ): product is SubnicheDemandProduct =>
                  Boolean(product)
              )
              .sort(
                (
                  productA,
                  productB
                ) =>
                  productA.name.localeCompare(
                    productB.name
                  )
              )

          const activeSurveysCount =
            activeSurveysBySubnicheId.get(
              subnicheId
            ) || 0

          const totalSurveysCount =
            totalSurveysBySubnicheId.get(
              subnicheId
            ) || 0

          const opportunityStatus =
            getSubnicheOpportunityStatus({
              activeSurveysCount,
              interestedMembersCount,
              productsCount,
            })

          return {
            subniche_id:
              subnicheId,
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
            interested_members_count:
              interestedMembersCount,
            products_count:
              productsCount,
            products,
            active_surveys_count:
              activeSurveysCount,
            total_surveys_count:
              totalSurveysCount,
            opportunity_status:
              opportunityStatus,
          }
        }
      )
      .sort(
        (
          demandA,
          demandB
        ) =>
          getSubnicheOpportunitySortValue(
            demandA.opportunity_status
          ) -
            getSubnicheOpportunitySortValue(
              demandB.opportunity_status
            ) ||
          demandB.interested_members_count -
            demandA.interested_members_count ||
          demandB.products_count -
            demandA.products_count ||
          demandA.subniche_name.localeCompare(
            demandB.subniche_name
          )
      )
      .slice(
        0,
        limit
      )
  } catch (error) {
    console.error(
      "GET SUBNICHE DEMAND WITH PRODUCTS ERROR:",
      error
    )

    return []
  }

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
    areaInterestsResult,
    communicationPreferencesResult,
    catalog,
    areaCatalog,
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
      supabase
        .from("subscriber_area_interests")
        .select(`
          subscriber_id,
          area_id,
          created_at
        `)
        .in(
          "subscriber_id",
          subscriberIds
        ),
      supabase
        .from("communication_preferences")
        .select(`
          subscriber_id,
          channel,
          opted_in,
          opted_in_at,
          opted_out_at,
          source,
          consent_text,
          updated_at
        `)
        .in(
          "subscriber_id",
          subscriberIds
        ),
      getCommunityStrategicCatalog(),
      getCommunityInterestAreaCatalog(),
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

  if (areaInterestsResult.error) {
    console.error(
      "GET RECENT SUBSCRIBERS AREA INTERESTS ERROR:",
      areaInterestsResult.error
    )
  }

  const areaInterestRows =
    areaInterestsResult.error
      ? []
      : (areaInterestsResult.data || []) as CommunityAreaInterestRow[]

  if (communicationPreferencesResult.error) {
    console.warn(
      "GET RECENT SUBSCRIBERS COMMUNICATION PREFERENCES WARNING:",
      communicationPreferencesResult.error
    )
  }

  const communicationPreferenceRows =
    communicationPreferencesResult.error
      ? []
      : (communicationPreferencesResult.data || []) as Array<
          CommunityCommunicationPreference & {
            subscriber_id: string | null
          }
        >

  const interestsBySubscriberId =
    new Map<string, CommunitySubscriberNormalizedInterest[]>()

  const areaInterestsBySubscriberId =
    new Map<string, CommunitySubscriberAreaInterest[]>()

  const communicationPreferencesBySubscriberId =
    new Map<string, CommunityCommunicationPreference[]>()

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

  areaInterestRows.forEach(
    (areaInterestRow) => {
      if (
        !areaInterestRow.subscriber_id ||
        !areaInterestRow.area_id
      ) {
        return
      }

      const area =
        areaCatalog.areasById.get(
          areaInterestRow.area_id
        )

      const subscriberAreaInterests =
        areaInterestsBySubscriberId.get(
          areaInterestRow.subscriber_id
        ) || []

      subscriberAreaInterests.push({
        area_id:
          areaInterestRow.area_id,
        area_key:
          area?.key ||
          "area_sin_catalogo",
        area_label:
          area?.label ||
          "Area sin catalogo",
        area_description:
          area?.description ||
          null,
      })

      areaInterestsBySubscriberId.set(
        areaInterestRow.subscriber_id,
        subscriberAreaInterests
      )
    }
  )

  communicationPreferenceRows.forEach(
    (preferenceRow) => {
      if (!preferenceRow.subscriber_id) {
        return
      }

      const subscriberPreferences =
        communicationPreferencesBySubscriberId.get(
          preferenceRow.subscriber_id
        ) || []

      subscriberPreferences.push({
        channel:
          preferenceRow.channel,
        opted_in:
          preferenceRow.opted_in,
        opted_in_at:
          preferenceRow.opted_in_at,
        opted_out_at:
          preferenceRow.opted_out_at,
        source:
          preferenceRow.source,
        consent_text:
          preferenceRow.consent_text,
        updated_at:
          preferenceRow.updated_at,
      })

      communicationPreferencesBySubscriberId.set(
        preferenceRow.subscriber_id,
        subscriberPreferences
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
      area_interests:
        areaInterestsBySubscriberId.get(
          subscriber.id
        ) || [],
      communication_preferences:
        communicationPreferencesBySubscriberId.get(
          subscriber.id
        ) || [],
      legacy_nichos:
        normalizeLegacyNichos(
          subscriber.nichos
        ),
    })
  )

}

export async function getSubscriberAreaInterestsBySubscriber(
  subscriberId: string
): Promise<CommunitySubscriberAreaInterest[]> {

  const [
    areaInterestsResult,
    areaCatalog,
  ] =
    await Promise.all([
      supabase
        .from("subscriber_area_interests")
        .select(`
          subscriber_id,
          area_id,
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
        ),
      getCommunityInterestAreaCatalog(),
    ])

  if (areaInterestsResult.error) {
    console.error(
      "GET SUBSCRIBER AREA INTERESTS BY SUBSCRIBER ERROR:",
      areaInterestsResult.error
    )

    return []
  }

  return (
    (areaInterestsResult.data || []) as CommunityAreaInterestRow[]
  )
    .map(
      (areaInterestRow) => {
        if (!areaInterestRow.area_id) {
          return null
        }

        const area =
          areaCatalog.areasById.get(
            areaInterestRow.area_id
          )

        return {
          area_id:
            areaInterestRow.area_id,
          area_key:
            area?.key ||
            "area_sin_catalogo",
          area_label:
            area?.label ||
            "Area sin catalogo",
          area_description:
            area?.description ||
            null,
        }
      }
    )
    .filter(
      (
        areaInterest
      ): areaInterest is CommunitySubscriberAreaInterest =>
        Boolean(areaInterest)
    )

}

export async function getRecentSubscribersWithAreaInterests(
  limit = 10
): Promise<CommunitySubscriberWithInterests[]> {
  return getRecentSubscribersWithInterests(limit)
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
  strategic_niche_id?: string | null
  subniche_id?: string | null
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
  strategic_niche_id?: string | null
  subniche_id?: string | null
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
    strategic_niche_id:
      input.strategic_niche_id || null,
    subniche_id:
      input.subniche_id || null,
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

export type CommunityIdeaVoteType =
  | "interested"
  | "not_interested"
  | "would_buy"
  | "wants_trial"

export type CommunityIdeaVote = {
  id: string
  product_id: string | null
  idea_key: string | null
  idea_title: string
  subscriber_id: string | null
  email: string | null
  phone: string | null
  vote_type: CommunityIdeaVoteType
  source: string | null
  strategic_niche_id: string | null
  subniche_id: string | null
  area_id: string | null
  created_at: string | null
  updated_at: string | null
}

export type CommunityIdeaVoteSummary = {
  target_key: string
  product_id: string | null
  idea_key: string | null
  idea_title: string
  total_votes: number
  interested_count: number
  not_interested_count: number
  would_buy_count: number
  wants_trial_count: number
  interested_rate: number
  not_interested_rate: number
  would_buy_rate: number
  wants_trial_rate: number
  last_vote_at: string | null
  recommendation_label: string
}

const communityIdeaVoteSelect = `
  id,
  product_id,
  idea_key,
  idea_title,
  subscriber_id,
  email,
  phone,
  vote_type,
  source,
  strategic_niche_id,
  subniche_id,
  area_id,
  created_at,
  updated_at
`

function createEmptyCommunityIdeaVoteSummary(
  vote: CommunityIdeaVote
): CommunityIdeaVoteSummary {
  const targetKey =
    vote.product_id
      ? `product:${vote.product_id}`
      : `idea:${vote.idea_key || vote.idea_title}`

  return {
    target_key:
      targetKey,
    product_id:
      vote.product_id,
    idea_key:
      vote.idea_key,
    idea_title:
      vote.idea_title,
    total_votes:
      0,
    interested_count:
      0,
    not_interested_count:
      0,
    would_buy_count:
      0,
    wants_trial_count:
      0,
    interested_rate:
      0,
    not_interested_rate:
      0,
    would_buy_rate:
      0,
    wants_trial_rate:
      0,
    last_vote_at:
      vote.updated_at ||
      vote.created_at ||
      null,
    recommendation_label:
      "Necesita mas votos",
  }
}

function getCommunityIdeaVoteRecommendation(
  summary: Pick<
    CommunityIdeaVoteSummary,
    | "total_votes"
    | "interested_rate"
    | "not_interested_rate"
    | "would_buy_rate"
    | "wants_trial_rate"
  >
) {
  if (summary.total_votes < 5) {
    return "Necesita mas votos"
  }

  if (
    summary.would_buy_rate +
      summary.wants_trial_rate >=
    50
  ) {
    return "Alta intencion"
  }

  if (
    summary.interested_rate >= 50 &&
    summary.would_buy_rate < 25
  ) {
    return "Interes temprano"
  }

  if (summary.not_interested_rate >= 50) {
    return "Revisar o ajustar"
  }

  return "En observacion"
}

function summarizeCommunityIdeaVotes(
  votes: CommunityIdeaVote[],
  limit: number
) {
  const summaryByTarget =
    new Map<string, CommunityIdeaVoteSummary>()

  votes.forEach(
    (vote) => {
      const targetKey =
        vote.product_id
          ? `product:${vote.product_id}`
          : `idea:${vote.idea_key || vote.idea_title}`

      const summary =
        summaryByTarget.get(targetKey) ||
        createEmptyCommunityIdeaVoteSummary(vote)

      summary.total_votes += 1

      if (vote.vote_type === "interested") {
        summary.interested_count += 1
      }

      if (vote.vote_type === "not_interested") {
        summary.not_interested_count += 1
      }

      if (vote.vote_type === "would_buy") {
        summary.would_buy_count += 1
      }

      if (vote.vote_type === "wants_trial") {
        summary.wants_trial_count += 1
      }

      const voteTimestamp =
        vote.updated_at ||
        vote.created_at ||
        null

      if (
        voteTimestamp &&
        (
          !summary.last_vote_at ||
          new Date(voteTimestamp).getTime() >
            new Date(summary.last_vote_at).getTime()
        )
      ) {
        summary.last_vote_at =
          voteTimestamp
      }

      summary.interested_rate =
        getCommunityPercent(
          summary.interested_count,
          summary.total_votes
        )

      summary.not_interested_rate =
        getCommunityPercent(
          summary.not_interested_count,
          summary.total_votes
        )

      summary.would_buy_rate =
        getCommunityPercent(
          summary.would_buy_count,
          summary.total_votes
        )

      summary.wants_trial_rate =
        getCommunityPercent(
          summary.wants_trial_count,
          summary.total_votes
        )

      summary.recommendation_label =
        getCommunityIdeaVoteRecommendation(
          summary
        )

      summaryByTarget.set(
        targetKey,
        summary
      )
    }
  )

  return Array.from(
    summaryByTarget.values()
  )
    .sort(
      (
        summaryA,
        summaryB
      ) =>
        summaryB.total_votes -
        summaryA.total_votes
    )
    .slice(
      0,
      limit
    )
}

function normalizeCommunityIdeaVoteIdeaKey(
  value: string
) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 160)
}

export async function getCommunityIdeaVoteSummary(
  limit = 20
): Promise<CommunityIdeaVoteSummary[]> {

  const { data, error } =
    await supabase
      .from("community_idea_votes")
      .select(communityIdeaVoteSelect)
      .order(
        "updated_at",
        {
          ascending: false,
        }
      )
      .limit(1000)

  if (error) {
    console.error(
      "GET COMMUNITY IDEA VOTE SUMMARY ERROR:",
      error
    )

    return []
  }

  return summarizeCommunityIdeaVotes(
    (data || []) as CommunityIdeaVote[],
    limit
  )

}

export async function getCommunityIdeaVoteTargetSummaries(
  limit = 10
): Promise<CommunityIdeaVoteSummary[]> {

  return getCommunityIdeaVoteSummary(
    limit
  )

}

export async function getCommunityIdeaVotesByProduct(
  productId: string
): Promise<CommunityIdeaVote[]> {

  if (!productId) {
    return []
  }

  const { data, error } =
    await supabase
      .from("community_idea_votes")
      .select(communityIdeaVoteSelect)
      .eq(
        "product_id",
        productId
      )
      .order(
        "updated_at",
        {
          ascending: false,
        }
      )
      .limit(100)

  if (error) {
    console.error(
      "GET COMMUNITY IDEA VOTES BY PRODUCT ERROR:",
      error
    )

    return []
  }

  return (data || []) as CommunityIdeaVote[]

}

export async function getCommunityIdeaVotesByIdeaKey(
  ideaKey: string
): Promise<CommunityIdeaVote[]> {

  const normalizedIdeaKey =
    normalizeCommunityIdeaVoteIdeaKey(
      ideaKey
    )

  if (!normalizedIdeaKey) {
    return []
  }

  const { data, error } =
    await supabase
      .from("community_idea_votes")
      .select(communityIdeaVoteSelect)
      .eq(
        "idea_key",
        normalizedIdeaKey
      )
      .order(
        "updated_at",
        {
          ascending: false,
        }
      )
      .limit(100)

  if (error) {
    console.error(
      "GET COMMUNITY IDEA VOTES BY IDEA KEY ERROR:",
      error
    )

    return []
  }

  return (data || []) as CommunityIdeaVote[]

}

export type TrendRadarSignalStatus =
  | "new"
  | "under_review"
  | "candidate"
  | "dismissed"
  | "converted_to_idea"

export type TrendRadarOpportunityType =
  | "producto_emergente"
  | "categoria_en_crecimiento"
  | "problema_repetido"
  | "ingrediente_tendencia"
  | "demanda_sin_producto"
  | "producto_con_alta_intencion"

export type TrendRadarRiskLevel =
  | "low"
  | "medium"
  | "high"

export type TrendRadarSignal = {
  id: string
  source: string
  title: string
  summary: string
  niche_id: string | null
  subniche_id: string | null
  area_id: string | null
  signal_strength: number
  opportunity_type: TrendRadarOpportunityType
  evidence_url: string | null
  evidence_note: string | null
  suggested_product: string | null
  risk_level: TrendRadarRiskLevel
  recommendation: string | null
  status: TrendRadarSignalStatus
  reviewed_by_admin: boolean
  converted_idea_id?: string | null
  created_at: string | null
  updated_at: string | null
}

export type CreateTrendRadarSignalInput = {
  source: string
  title: string
  summary: string
  niche_id?: string | null
  subniche_id?: string | null
  area_id?: string | null
  signal_strength?: number | null
  opportunity_type: TrendRadarOpportunityType
  evidence_url?: string | null
  evidence_note?: string | null
  suggested_product?: string | null
  risk_level?: TrendRadarRiskLevel | null
  recommendation?: string | null
  status?: TrendRadarSignalStatus | null
  reviewed_by_admin?: boolean | null
}

export type UpdateTrendRadarSignalInput =
  Partial<CreateTrendRadarSignalInput> & {
    converted_idea_id?: string | null
  }

export type TrendRadarSignalSummary = {
  total_signals: number
  new_signals: number
  under_review_signals: number
  candidate_signals: number
  dismissed_signals: number
  converted_signals: number
  average_signal_strength: number | null
  high_risk_signals: number
  high_strength_signals: number
}

export type IdeaLabItemStatus =
  | "draft"
  | "under_review"
  | "ready_for_validation"
  | "dismissed"
  | "converted_to_product"

export type IdeaLabItem = {
  id: string
  trend_radar_signal_id: string | null
  title: string
  summary: string
  suggested_product: string | null
  recommendation: string | null
  source: string | null
  evidence_url: string | null
  evidence_note: string | null
  niche_id: string | null
  subniche_id: string | null
  area_id: string | null
  signal_strength: number | null
  risk_level: TrendRadarRiskLevel | null
  status: IdeaLabItemStatus
  created_at: string | null
  updated_at: string | null
}

export type CreateIdeaLabItemInput = {
  trend_radar_signal_id?: string | null
  title: string
  summary: string
  suggested_product?: string | null
  recommendation?: string | null
  source?: string | null
  evidence_url?: string | null
  evidence_note?: string | null
  niche_id?: string | null
  subniche_id?: string | null
  area_id?: string | null
  signal_strength?: number | null
  risk_level?: TrendRadarRiskLevel | null
  status?: IdeaLabItemStatus | null
}

export type IdeaLabItemSummary = {
  total_items: number
  draft_items: number
  under_review_items: number
  ready_for_validation_items: number
  dismissed_items: number
  converted_to_product_items: number
}

const EMPTY_TREND_RADAR_SIGNAL_SUMMARY: TrendRadarSignalSummary = {
  total_signals: 0,
  new_signals: 0,
  under_review_signals: 0,
  candidate_signals: 0,
  dismissed_signals: 0,
  converted_signals: 0,
  average_signal_strength: null,
  high_risk_signals: 0,
  high_strength_signals: 0,
}

const EMPTY_IDEA_LAB_ITEM_SUMMARY: IdeaLabItemSummary = {
  total_items: 0,
  draft_items: 0,
  under_review_items: 0,
  ready_for_validation_items: 0,
  dismissed_items: 0,
  converted_to_product_items: 0,
}

const trendRadarSignalSelect = `
  id,
  source,
  title,
  summary,
  niche_id,
  subniche_id,
  area_id,
  signal_strength,
  opportunity_type,
  evidence_url,
  evidence_note,
  suggested_product,
  risk_level,
  recommendation,
  status,
  reviewed_by_admin,
  created_at,
  updated_at
`

const trendRadarSignalWithConversionSelect = `
  ${trendRadarSignalSelect},
  converted_idea_id
`

const ideaLabItemSelect = `
  id,
  trend_radar_signal_id,
  title,
  summary,
  suggested_product,
  recommendation,
  source,
  evidence_url,
  evidence_note,
  niche_id,
  subniche_id,
  area_id,
  signal_strength,
  risk_level,
  status,
  created_at,
  updated_at
`

function getTrendRadarSignalPayload(
  input: CreateTrendRadarSignalInput
) {
  return {
    source:
      input.source.trim(),
    title:
      input.title.trim(),
    summary:
      input.summary.trim(),
    niche_id:
      input.niche_id || null,
    subniche_id:
      input.subniche_id || null,
    area_id:
      input.area_id || null,
    signal_strength:
      Math.max(
        1,
        Math.min(
          5,
          Math.round(
            input.signal_strength || 1
          )
        )
      ),
    opportunity_type:
      input.opportunity_type,
    evidence_url:
      input.evidence_url?.trim() || null,
    evidence_note:
      input.evidence_note?.trim() || null,
    suggested_product:
      input.suggested_product?.trim() || null,
    risk_level:
      input.risk_level || "medium",
    recommendation:
      input.recommendation?.trim() || null,
    status:
      input.status || "new",
    reviewed_by_admin:
      Boolean(input.reviewed_by_admin),
  }
}

function getTrendRadarSignalUpdatePayload(
  input: UpdateTrendRadarSignalInput
) {
  const payload: Record<string, unknown> = {
    updated_at:
      new Date().toISOString(),
  }

  if (input.source !== undefined) {
    payload.source =
      input.source?.trim()
  }

  if (input.title !== undefined) {
    payload.title =
      input.title?.trim()
  }

  if (input.summary !== undefined) {
    payload.summary =
      input.summary?.trim()
  }

  if (input.niche_id !== undefined) {
    payload.niche_id =
      input.niche_id || null
  }

  if (input.subniche_id !== undefined) {
    payload.subniche_id =
      input.subniche_id || null
  }

  if (input.area_id !== undefined) {
    payload.area_id =
      input.area_id || null
  }

  if (input.signal_strength !== undefined) {
    payload.signal_strength =
      Math.max(
        1,
        Math.min(
          5,
          Math.round(
            input.signal_strength || 1
          )
        )
      )
  }

  if (input.opportunity_type !== undefined) {
    payload.opportunity_type =
      input.opportunity_type
  }

  if (input.evidence_url !== undefined) {
    payload.evidence_url =
      input.evidence_url?.trim() || null
  }

  if (input.evidence_note !== undefined) {
    payload.evidence_note =
      input.evidence_note?.trim() || null
  }

  if (input.suggested_product !== undefined) {
    payload.suggested_product =
      input.suggested_product?.trim() || null
  }

  if (input.risk_level !== undefined) {
    payload.risk_level =
      input.risk_level || "medium"
  }

  if (input.recommendation !== undefined) {
    payload.recommendation =
      input.recommendation?.trim() || null
  }

  if (input.status !== undefined) {
    payload.status =
      input.status || "new"
  }

  if (input.reviewed_by_admin !== undefined) {
    payload.reviewed_by_admin =
      Boolean(input.reviewed_by_admin)
  }

  if (input.converted_idea_id !== undefined) {
    payload.converted_idea_id =
      input.converted_idea_id || null
  }

  return payload
}

function getIdeaLabItemPayload(
  input: CreateIdeaLabItemInput
) {
  return {
    trend_radar_signal_id:
      input.trend_radar_signal_id || null,
    title:
      input.title.trim(),
    summary:
      input.summary.trim(),
    suggested_product:
      input.suggested_product?.trim() || null,
    recommendation:
      input.recommendation?.trim() || null,
    source:
      input.source?.trim() || null,
    evidence_url:
      input.evidence_url?.trim() || null,
    evidence_note:
      input.evidence_note?.trim() || null,
    niche_id:
      input.niche_id || null,
    subniche_id:
      input.subniche_id || null,
    area_id:
      input.area_id || null,
    signal_strength:
      input.signal_strength ?? null,
    risk_level:
      input.risk_level || null,
    status:
      input.status || "draft",
  }
}

export async function getTrendRadarSignals(
  limit = 20
): Promise<TrendRadarSignal[]> {

  const { data, error } =
    await supabase
      .from("trend_radar_signals")
      .select(trendRadarSignalSelect)
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(limit)

  if (error) {
    console.error(
      "GET TREND RADAR SIGNALS ERROR:",
      error
    )

    return []
  }

  return (data || []) as TrendRadarSignal[]

}

export async function getTrendRadarSignalById(
  id: string
): Promise<TrendRadarSignal | null> {

  if (!id) {
    return null
  }

  const { data, error } =
    await supabase
      .from("trend_radar_signals")
      .select(trendRadarSignalSelect)
      .eq(
        "id",
        id
      )
      .maybeSingle()

  if (error) {
    console.error(
      "GET TREND RADAR SIGNAL BY ID ERROR:",
      error
    )

    return null
  }

  return data as TrendRadarSignal | null

}

export async function createTrendRadarSignal(
  input: CreateTrendRadarSignalInput
): Promise<TrendRadarSignal | null> {

  const { data, error } =
    await supabase
      .from("trend_radar_signals")
      .insert(
        getTrendRadarSignalPayload(
          input
        )
      )
      .select(trendRadarSignalSelect)
      .single()

  if (error) {
    console.error(
      "CREATE TREND RADAR SIGNAL ERROR:",
      error
    )

    return null
  }

  return data as TrendRadarSignal

}

export async function updateTrendRadarSignal(
  id: string,
  input: UpdateTrendRadarSignalInput
): Promise<TrendRadarSignal | null> {

  if (!id) {
    return null
  }

  const { data, error } =
    await supabase
      .from("trend_radar_signals")
      .update(
        getTrendRadarSignalUpdatePayload(
          input
        )
      )
      .eq(
        "id",
        id
      )
      .select(trendRadarSignalSelect)
      .single()

  if (error) {
    console.error(
      "UPDATE TREND RADAR SIGNAL ERROR:",
      error
    )

    return null
  }

  return data as TrendRadarSignal

}

export async function getTrendRadarSignalSummary(): Promise<TrendRadarSignalSummary> {

  const { data, error } =
    await supabase
      .from("trend_radar_signals")
      .select(`
        status,
        signal_strength,
        risk_level
      `)

  if (error) {
    console.error(
      "GET TREND RADAR SIGNAL SUMMARY ERROR:",
      error
    )

    return EMPTY_TREND_RADAR_SIGNAL_SUMMARY
  }

  const signals =
    (
      data || []
    ) as Array<{
      status: TrendRadarSignalStatus | null
      signal_strength: number | null
      risk_level: TrendRadarRiskLevel | null
    }>

  const totalSignals =
    signals.length

  if (totalSignals === 0) {
    return EMPTY_TREND_RADAR_SIGNAL_SUMMARY
  }

  const signalStrengthTotal =
    signals.reduce(
      (
        total,
        signal
      ) =>
        total +
        (
          signal.signal_strength || 0
        ),
      0
    )

  return {
    total_signals:
      totalSignals,
    new_signals:
      signals.filter(
        signal =>
          signal.status === "new"
      ).length,
    under_review_signals:
      signals.filter(
        signal =>
          signal.status === "under_review"
      ).length,
    candidate_signals:
      signals.filter(
        signal =>
          signal.status === "candidate"
      ).length,
    dismissed_signals:
      signals.filter(
        signal =>
          signal.status === "dismissed"
      ).length,
    converted_signals:
      signals.filter(
        signal =>
          signal.status ===
          "converted_to_idea"
      ).length,
    average_signal_strength:
      Math.round(
        (
          signalStrengthTotal /
          totalSignals
        ) * 10
      ) / 10,
    high_risk_signals:
      signals.filter(
        signal =>
          signal.risk_level === "high"
      ).length,
    high_strength_signals:
      signals.filter(
        signal =>
          (
            signal.signal_strength ||
            0
          ) >= 4
      ).length,
  }

}

export async function getIdeaLabItems(
  limit = 20
): Promise<IdeaLabItem[]> {

  const { data, error } =
    await supabase
      .from("idea_lab_items")
      .select(ideaLabItemSelect)
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(limit)

  if (error) {
    console.error(
      "GET IDEA LAB ITEMS ERROR:",
      error
    )

    return []
  }

  return (data || []) as IdeaLabItem[]

}

export async function getIdeaLabItemById(
  id: string
): Promise<IdeaLabItem | null> {

  if (!id) {
    return null
  }

  const { data, error } =
    await supabase
      .from("idea_lab_items")
      .select(ideaLabItemSelect)
      .eq(
        "id",
        id
      )
      .maybeSingle()

  if (error) {
    console.error(
      "GET IDEA LAB ITEM BY ID ERROR:",
      error
    )

    return null
  }

  return data as IdeaLabItem | null

}

export async function createIdeaLabItem(
  input: CreateIdeaLabItemInput
): Promise<IdeaLabItem | null> {

  const { data, error } =
    await supabase
      .from("idea_lab_items")
      .insert(
        getIdeaLabItemPayload(input)
      )
      .select(ideaLabItemSelect)
      .single()

  if (error) {
    console.error(
      "CREATE IDEA LAB ITEM ERROR:",
      error
    )

    return null
  }

  return data as IdeaLabItem

}

export async function createIdeaLabItemFromTrendSignal(
  signalId: string
): Promise<IdeaLabItem | null> {

  if (!signalId) {
    return null
  }

  const {
    data: signal,
    error: signalError,
  } =
    await supabase
      .from("trend_radar_signals")
      .select(trendRadarSignalWithConversionSelect)
      .eq(
        "id",
        signalId
      )
      .maybeSingle()

  if (signalError) {
    console.error(
      "CREATE IDEA LAB FROM TREND SIGNAL LOOKUP ERROR:",
      signalError
    )

    return null
  }

  const trendSignal =
    signal as TrendRadarSignal | null

  if (!trendSignal) {
    console.error(
      "CREATE IDEA LAB FROM TREND SIGNAL ERROR:",
      "trend_signal_not_found"
    )

    return null
  }

  if (trendSignal.status !== "candidate") {
    console.error(
      "CREATE IDEA LAB FROM TREND SIGNAL ERROR:",
      "trend_signal_not_candidate"
    )

    return null
  }

  if (trendSignal.converted_idea_id) {
    console.error(
      "CREATE IDEA LAB FROM TREND SIGNAL ERROR:",
      "trend_signal_already_converted"
    )

    return null
  }

  const title =
    trendSignal.suggested_product?.trim() ||
    trendSignal.title

  const idea =
    await createIdeaLabItem({
      trend_radar_signal_id:
        trendSignal.id,
      title,
      summary:
        trendSignal.summary,
      suggested_product:
        trendSignal.suggested_product,
      recommendation:
        trendSignal.recommendation,
      source:
        trendSignal.source,
      evidence_url:
        trendSignal.evidence_url,
      evidence_note:
        trendSignal.evidence_note,
      niche_id:
        trendSignal.niche_id,
      subniche_id:
        trendSignal.subniche_id,
      area_id:
        trendSignal.area_id,
      signal_strength:
        trendSignal.signal_strength,
      risk_level:
        trendSignal.risk_level,
      status:
        "draft",
    })

  if (!idea) {
    return null
  }

  const { error: updateSignalError } =
    await supabase
      .from("trend_radar_signals")
      .update({
        status:
          "converted_to_idea",
        reviewed_by_admin:
          true,
        converted_idea_id:
          idea.id,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        trendSignal.id
      )

  if (updateSignalError) {
    console.error(
      "CREATE IDEA LAB FROM TREND SIGNAL UPDATE ERROR:",
      updateSignalError
    )

    await supabase
      .from("idea_lab_items")
      .delete()
      .eq(
        "id",
        idea.id
      )

    return null
  }

  return idea

}

export async function getIdeaLabItemSummary(): Promise<IdeaLabItemSummary> {

  const { data, error } =
    await supabase
      .from("idea_lab_items")
      .select("status")

  if (error) {
    console.error(
      "GET IDEA LAB ITEM SUMMARY ERROR:",
      error
    )

    return EMPTY_IDEA_LAB_ITEM_SUMMARY
  }

  const items =
    (
      data || []
    ) as Array<{
      status: IdeaLabItemStatus | null
    }>

  return {
    total_items:
      items.length,
    draft_items:
      items.filter(
        item =>
          item.status === "draft"
      ).length,
    under_review_items:
      items.filter(
        item =>
          item.status === "under_review"
      ).length,
    ready_for_validation_items:
      items.filter(
        item =>
          item.status === "ready_for_validation"
      ).length,
    dismissed_items:
      items.filter(
        item =>
          item.status === "dismissed"
      ).length,
    converted_to_product_items:
      items.filter(
        item =>
          item.status ===
          "converted_to_product"
      ).length,
  }

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

export type ProductSubniche = {
  id: string
  product_id: string
  subniche_id: string
  is_primary: boolean | null
  created_at: string | null
  strategic_subniches?:
    | StrategicSubniche
    | StrategicSubniche[]
    | null
}

export type UpdateProductSubnichesResult = {
  success: boolean
  error: string | null
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
): Promise<ProductSubniche[]> {

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

  return (data || []) as ProductSubniche[]

}

export async function updateProductSubniches(
  productId: string,
  subnicheIds: string[],
  primarySubnicheId?: string | null
): Promise<UpdateProductSubnichesResult> {

  const uniqueSubnicheIds =
    Array.from(
      new Set(
        [
          ...(primarySubnicheId
            ? [primarySubnicheId]
            : []),
          ...subnicheIds,
        ]
          .map(subnicheId =>
            subnicheId.trim()
          )
          .filter(Boolean)
      )
    )

  const { error: deleteError } =
    await supabase
      .from("product_subniches")
      .delete()
      .eq(
        "product_id",
        productId
      )

  if (deleteError) {
    console.error(
      "DELETE PRODUCT SUBNICHES ERROR:",
      deleteError
    )

    return {
      success: false,
      error:
        formatSupabaseErrorMessage(
          deleteError
        ) ||
        "No se pudieron limpiar los subnichos del producto.",
    }
  }

  if (uniqueSubnicheIds.length === 0) {
    return {
      success: true,
      error: null,
    }
  }

  const rows =
    uniqueSubnicheIds.map(
      subnicheId => ({
        product_id:
          productId,
        subniche_id:
          subnicheId,
        is_primary:
          Boolean(
            primarySubnicheId &&
            subnicheId === primarySubnicheId
          ),
      })
    )

  const { error: insertError } =
    await supabase
      .from("product_subniches")
      .insert(rows)

  if (insertError) {
    console.error(
      "INSERT PRODUCT SUBNICHES ERROR:",
      {
        error:
          insertError,
        productId,
        rows,
      }
    )

    return {
      success: false,
      error:
        formatSupabaseErrorMessage(
          insertError
        ) ||
        "No se pudieron guardar los subnichos del producto.",
    }
  }

  return {
    success: true,
    error: null,
  }

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
