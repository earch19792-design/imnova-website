import { supabase } from "./supabase"

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
