export const runtime = "nodejs"

import { NextResponse } from "next/server"

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js"

import {
  sendWhatsAppDistributionChannel,
  sendWhatsAppUpdate,
} from "../../../lib/whatsapp"

import {
  sendDistributionChannelEmail,
  sendProductLaunchEmail,
} from "../../../lib/email"

type InnovaLabRequestBody = {
  notificationType?:
    | "product_update"
    | "product_launch"
    | "distribution_channel"
  productId?: string | null
  product?: string
  status?: string
  progress?: string
  imageUrl?: string
  source?: string
  triggeredBy?: string
  force?: boolean
  distributionLocation?: {
    id?: string | null
    name?: string | null
    city?: string | null
    area?: string | null
    address?: string | null
    productUrl?: string | null
    mapUrl?: string | null
    availabilityStatus?: string | null
    isAuthorized?: boolean | null
    isActive?: boolean | null
  } | null
}

type ProductLaunchTargeting = {
  mode:
    | "segmented_by_product_subniches"
    | "segmented_by_product_niche"
    | "segmented_by_area_interests"
    | "segmented_by_product_interests_and_areas"
    | "all_community"
    | "none"
  subnicheIds: string[]
  areaKeys?: string[]
  subscriberIds: string[]
  phoneCount: number
  emailCount: number
  warning?: string
}

type CommunicationChannel =
  | "whatsapp"
  | "email"

type NotificationResult = {
  success: boolean
  error?: string
  total?: number
  successful?: number
  failed?: number
  results?: unknown[]
  [key: string]: unknown
}

type ProductLaunchEmailResult =
  Awaited<ReturnType<typeof sendProductLaunchEmail>>

type DistributionChannelEmailResult =
  Awaited<ReturnType<typeof sendDistributionChannelEmail>>

type JsonRecord =
  Record<string, unknown>

type AdminAuthResult =
  | {
      ok: true
      triggeredBy: string
      supabaseClient: SupabaseClient
    }
  | {
      ok: false
      status: 401 | 403 | 500
      error: string
    }

const productLaunchNicheAreaMap:
  Record<string, string[]> = {
    bienestar_diario: [
      "bienestar_salud_natural",
    ],
    nutricion_funcional: [
      "bienestar_salud_natural",
    ],
    vida_activa: [
      "fitness_rendimiento_recuperacion",
    ],
    soporte_funcional: [
      "salud_funcionalidad_especifica",
    ],
    digestion_balance: [
      "salud_funcionalidad_especifica",
    ],
    energia_enfoque: [
      "salud_funcionalidad_especifica",
    ],
    belleza_natural: [
      "cuidado_belleza_natural",
    ],
    bienestar_animal: [
      "bienestar_animal_mascotas",
    ],
  }

const productLaunchSubnicheAreaMap:
  Record<string, string[]> = {
    cafe_funcional: [
      "bienestar_salud_natural",
    ],
    vitaminas_minerales: [
      "bienestar_salud_natural",
    ],
    proteina_funcional: [
      "fitness_rendimiento_recuperacion",
    ],
    superfoods: [
      "bienestar_salud_natural",
    ],
    colageno: [
      "cuidado_belleza_natural",
    ],
    piel_cabello: [
      "cuidado_belleza_natural",
    ],
    clean_beauty: [
      "cuidado_belleza_natural",
    ],
    digestion: [
      "salud_funcionalidad_especifica",
    ],
    extractos_herbales: [
      "salud_funcionalidad_especifica",
    ],
    detox_suave: [
      "salud_funcionalidad_especifica",
    ],
    energia_natural: [
      "fitness_rendimiento_recuperacion",
    ],
    enfoque_mental: [
      "salud_funcionalidad_especifica",
    ],
    hidratacion: [
      "fitness_rendimiento_recuperacion",
    ],
    recuperacion: [
      "fitness_rendimiento_recuperacion",
    ],
    articulaciones: [
      "fitness_rendimiento_recuperacion",
    ],
    mascotas: [
      "bienestar_animal_mascotas",
    ],
    caballos: [
      "bienestar_animal_mascotas",
    ],
    aves_peces: [
      "bienestar_animal_mascotas",
    ],
    vida_saludable: [
      "bienestar_salud_natural",
    ],
    productos_naturales: [
      "bienestar_salud_natural",
    ],
    bienestar_holistico: [
      "bienestar_salud_natural",
    ],
    defensas: [
      "salud_funcionalidad_especifica",
    ],
    sueno_descanso: [
      "salud_funcionalidad_especifica",
    ],
    estres_balance: [
      "salud_funcionalidad_especifica",
    ],
    longevidad: [
      "salud_funcionalidad_especifica",
    ],
  }

function getTemplateName({
  status,
  notificationType,
}: {
  status?: string
  notificationType?: InnovaLabRequestBody["notificationType"]
}
) {

  if (
    notificationType ===
    "distribution_channel"
  ) {
    return process.env.WHATSAPP_DISTRIBUTION_CHANNEL_TEMPLATE_NAME?.trim() ||
      "imnova_distribution_channel"
  }

  return status === "Disponible"
    ? process.env.WHATSAPP_PRODUCT_LAUNCH_TEMPLATE_NAME?.trim() ||
        "imnova_product_launch"
    : "imnova_update"

}

function asRecord(
  value: unknown
): JsonRecord | null {

  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as JsonRecord
    : null

}

function getResultNumber(
  result: NotificationResult,
  key: "total" | "successful" | "failed"
) {

  const value =
    (result as unknown as JsonRecord)[key]

  return typeof value === "number"
    ? value
    : 0

}

function getSafeErrorMessage(
  result: NotificationResult
) {

  if (result.success) {
    return null
  }

  const resultRecord =
    result as unknown as JsonRecord

  const directError =
    resultRecord.error

  if (
    typeof directError === "string" &&
    directError
  ) {
    return directError
  }

  const results =
    resultRecord.results

  if (Array.isArray(results)) {
    const failedResult =
      results.find(
        item =>
          asRecord(item)?.success ===
          false
      )

    const failedRecord =
      asRecord(failedResult)

    const itemError =
      failedRecord?.error

    if (
      typeof itemError === "string" &&
      itemError
    ) {
      return itemError
    }

    const dataRecord =
      asRecord(failedRecord?.data)

    const metaError =
      dataRecord?.error

    const metaErrorRecord =
      asRecord(metaError)

    const metaMessage =
      metaErrorRecord?.message

    if (
      typeof metaMessage === "string" &&
      metaMessage
    ) {
      return metaMessage
    }

    if (metaError) {
      return JSON.stringify(metaError)
    }
  }

  return "WhatsApp no confirmo el envio."

}

function getBearerToken(
  req: Request
) {

  const authorization =
    req.headers.get("authorization") ||
    ""

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null
  }

  const token =
    authorization
      .slice("Bearer ".length)
      .trim()

  return token || null

}

function getSupabaseServerClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return null
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

async function validateAdminRequest(
  req: Request
): Promise<AdminAuthResult> {

  const token =
    getBearerToken(req)

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
    }
  }

  const authenticatedSupabase =
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        },
      }
    )

  const {
    data: userData,
    error: userError,
  } =
    await authenticatedSupabase.auth.getUser(
      token
    )

  if (
    userError ||
    !userData.user
  ) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
    }
  }

  const {
    data: isAdmin,
    error: adminError,
  } =
    await authenticatedSupabase.rpc(
      "is_admin"
    )

  if (
    adminError ||
    isAdmin !== true
  ) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden",
    }
  }

  const serverSupabase =
    getSupabaseServerClient()

  if (!serverSupabase) {
    return {
      ok: false,
      status: 500,
      error:
        "server_supabase_service_role_not_configured",
    }
  }

  return {
    ok: true,
    triggeredBy:
      userData.user.email ||
      userData.user.id,
    supabaseClient:
      serverSupabase,
  }

}

async function saveNotificationLog(
  supabaseClient: SupabaseClient,
  body: InnovaLabRequestBody,
  result: NotificationResult
) {

  const total =
    getResultNumber(
      result,
      "total"
    )

  try {

    const { error } =
      await supabaseClient
        .from("notification_logs")
        .insert({
          product_id:
            body.productId || null,
          product_name:
            body.product || null,
          channel:
            "whatsapp",
          template_name:
            getTemplateName({
              status:
                body.status,
              notificationType:
                body.notificationType,
            }),
          status_name:
            body.status || null,
          progress:
            body.progress || null,
          image_url:
            body.imageUrl || null,
          success:
            Boolean(result.success),
          total,
          successful:
            getResultNumber(
              result,
              "successful"
            ),
          failed:
            getResultNumber(
              result,
              "failed"
            ),
          meta_response:
            result,
          error_message:
            getSafeErrorMessage(result),
          triggered_by:
            body.triggeredBy || "admin",
          source:
            body.source || "api",
          phone_count:
            total,
        })

    if (error) {
      console.error(
        "NOTIFICATION LOG ERROR:",
        error
      )

      return error.message
    }

  } catch (error) {
    console.error(
      "NOTIFICATION LOG ERROR:",
      error
    )

    return String(error)
  }

  return null

}

async function saveEmailNotificationLog(
  supabaseClient: SupabaseClient,
  body: InnovaLabRequestBody,
  result: ProductLaunchEmailResult
) {
  const total =
    getResultNumber(
      result,
      "total"
    )

  try {
    const { error } =
      await supabaseClient
        .from("notification_logs")
        .insert({
          product_id:
            body.productId || null,
          product_name:
            body.product || null,
          channel:
            "email",
          template_name:
            body.notificationType ===
            "distribution_channel"
              ? "distribution_channel_email"
              : "product_launch_email",
          status_name:
            body.status || null,
          progress:
            body.progress || null,
          image_url:
            body.imageUrl || null,
          success:
            Boolean(result.success),
          total,
          successful:
            getResultNumber(
              result,
              "successful"
            ),
          failed:
            getResultNumber(
              result,
              "failed"
            ),
          meta_response:
            result,
          error_message:
            getSafeErrorMessage(result),
          triggered_by:
            body.triggeredBy || "admin",
          source:
            body.source || "api",
          phone_count:
            total,
        })

    if (error) {
      console.error(
        "EMAIL NOTIFICATION LOG ERROR:",
        error
      )

      return error.message
    }
  } catch (error) {
    console.error(
      "EMAIL NOTIFICATION LOG ERROR:",
      error
    )

    return String(error)
  }

  return null
}

async function getCommunityRecipientPhones(
  supabaseClient: SupabaseClient
) {

  const { data, error } =
    await supabaseClient
      .from("subscribers")
      .select("id, telefono")
      .not("telefono", "is", null)
      .limit(500)

  if (error) {
    console.error(
      "GET COMMUNITY WHATSAPP RECIPIENTS ERROR:",
      error
    )

    return []
  }

  const subscriberIds =
    (data || [])
      .map(subscriber =>
        typeof subscriber.id === "string"
          ? subscriber.id
          : ""
      )
      .filter(Boolean)

  const {
    subscriberIds:
      whatsappOptedInSubscriberIds,
  } =
    await getOptedInSubscriberIdsByChannel(
      supabaseClient,
      subscriberIds,
      "whatsapp"
    )

  return (data || [])
    .filter(subscriber =>
      typeof subscriber.id === "string" &&
      whatsappOptedInSubscriberIds.has(
        subscriber.id
      )
    )
    .map((subscriber) =>
      typeof subscriber.telefono === "string"
        ? subscriber.telefono
        : ""
    )
    .filter(Boolean)

}

async function getOptedInSubscriberIdsByChannel(
  supabaseClient: SupabaseClient,
  subscriberIds: string[],
  channel: CommunicationChannel
) {
  if (subscriberIds.length === 0) {
    return {
      subscriberIds:
        new Set<string>(),
      warning: null,
    }
  }

  const { data, error } =
    await supabaseClient
      .from("communication_preferences")
      .select("subscriber_id")
      .in(
        "subscriber_id",
        subscriberIds
      )
      .eq(
        "channel",
        channel
      )
      .eq(
        "opted_in",
        true
      )

  if (error) {
    console.error(
      "GET OPTED-IN COMMUNICATION PREFERENCES ERROR:",
      error
    )

    return {
      subscriberIds:
        new Set<string>(),
      warning:
        "communication_preferences_lookup_failed",
    }
  }

  return {
    subscriberIds:
      new Set(
        (data || [])
          .map(row =>
            typeof row.subscriber_id ===
            "string"
              ? row.subscriber_id
              : ""
          )
          .filter(Boolean)
      ),
    warning: null,
  }
}

async function getProductLaunchAreaKeys({
  supabaseClient,
  strategicNicheId,
  subnicheIds,
}: {
  supabaseClient: SupabaseClient
  strategicNicheId?: string | null
  subnicheIds: string[]
}) {
  const areaKeys =
    new Set<string>()

  if (strategicNicheId) {
    const {
      data: niche,
      error: nicheError,
    } =
      await supabaseClient
        .from("strategic_niches")
        .select("slug")
        .eq("id", strategicNicheId)
        .maybeSingle()

    if (nicheError) {
      console.error(
        "GET PRODUCT LAUNCH NICHE AREA ERROR:",
        nicheError
      )
    }

    const nicheSlug =
      typeof niche?.slug === "string"
        ? niche.slug
        : ""

    productLaunchNicheAreaMap[nicheSlug]
      ?.forEach(areaKey =>
        areaKeys.add(areaKey)
      )
  }

  if (subnicheIds.length > 0) {
    const {
      data: subniches,
      error: subnichesError,
    } =
      await supabaseClient
        .from("strategic_subniches")
        .select("slug")
        .in("id", subnicheIds)

    if (subnichesError) {
      console.error(
        "GET PRODUCT LAUNCH SUBNICHE AREA ERROR:",
        subnichesError
      )
    }

    ;(subniches || [])
      .map(row =>
        typeof row.slug === "string"
          ? row.slug
          : ""
      )
      .filter(Boolean)
      .forEach(slug => {
        productLaunchSubnicheAreaMap[slug]
          ?.forEach(areaKey =>
            areaKeys.add(areaKey)
          )
      })
  }

  return Array.from(areaKeys)
}

async function getSubscriberIdsByAreaKeys(
  supabaseClient: SupabaseClient,
  areaKeys: string[]
) {
  if (areaKeys.length === 0) {
    return {
      subscriberIds: [] as string[],
      warning: null as string | null,
    }
  }

  const {
    data: areas,
    error: areasError,
  } =
    await supabaseClient
      .from("community_interest_areas")
      .select("id")
      .in("key", areaKeys)
      .eq("is_active", true)

  if (areasError) {
    console.error(
      "GET PRODUCT LAUNCH AREA LOOKUP ERROR:",
      areasError
    )

    return {
      subscriberIds: [],
      warning:
        "product_launch_area_lookup_failed",
    }
  }

  const areaIds =
    (areas || [])
      .map(row =>
        typeof row.id === "string"
          ? row.id
          : ""
      )
      .filter(Boolean)

  if (areaIds.length === 0) {
    return {
      subscriberIds: [],
      warning:
        "product_launch_area_not_found",
    }
  }

  const {
    data: areaInterests,
    error: areaInterestsError,
  } =
    await supabaseClient
      .from("subscriber_area_interests")
      .select("subscriber_id")
      .in("area_id", areaIds)
      .limit(1000)

  if (areaInterestsError) {
    console.error(
      "GET PRODUCT LAUNCH AREA INTERESTS ERROR:",
      areaInterestsError
    )

    return {
      subscriberIds: [],
      warning:
        "product_launch_area_interests_lookup_failed",
    }
  }

  return {
    subscriberIds:
      Array.from(
        new Set(
          (areaInterests || [])
            .map(row =>
              typeof row.subscriber_id ===
              "string"
                ? row.subscriber_id
                : ""
            )
            .filter(Boolean)
        )
      ),
    warning: null,
  }
}

async function getProductLaunchRecipientPhones(
  supabaseClient: SupabaseClient,
  productId?: string | null
): Promise<{
  phones: string[]
  emails: string[]
  targeting: ProductLaunchTargeting
}> {
  const emptyTargeting: ProductLaunchTargeting = {
    mode: "none",
    subnicheIds: [],
    subscriberIds: [],
    phoneCount: 0,
    emailCount: 0,
  }

  if (!productId) {
    return {
      phones: [],
      emails: [],
      targeting: {
        ...emptyTargeting,
        warning:
          "product_id_required_for_segmented_launch",
      },
    }
  }

  const {
    data: product,
    error: productError,
  } =
    await supabaseClient
      .from("products")
      .select(
        "primary_subniche_id, strategic_niche_id"
      )
      .eq("id", productId)
      .maybeSingle()

  if (productError) {
    console.error(
      "GET PRODUCT LAUNCH PRODUCT ERROR:",
      productError
    )

    return {
      phones: [],
      emails: [],
      targeting: {
        ...emptyTargeting,
        warning:
          "product_launch_product_lookup_failed",
      },
    }
  }

  const {
    data: productSubniches,
    error: productSubnichesError,
  } =
    await supabaseClient
      .from("product_subniches")
      .select("subniche_id")
      .eq("product_id", productId)

  if (productSubnichesError) {
    console.error(
      "GET PRODUCT LAUNCH SUBNICHES ERROR:",
      productSubnichesError
    )
  }

  let subnicheIds =
    Array.from(
      new Set(
        [
          typeof product?.primary_subniche_id ===
          "string"
            ? product.primary_subniche_id
            : "",
          ...(productSubniches || [])
            .map(row =>
              typeof row.subniche_id ===
              "string"
                ? row.subniche_id
                : ""
            ),
        ].filter(Boolean)
      )
    )

  let mode: ProductLaunchTargeting["mode"] =
    "segmented_by_product_subniches"

  if (
    subnicheIds.length === 0 &&
    typeof product?.strategic_niche_id ===
      "string" &&
    product.strategic_niche_id
  ) {
    const {
      data: nicheSubniches,
      error: nicheSubnichesError,
    } =
      await supabaseClient
        .from("strategic_subniches")
        .select("id")
        .eq(
          "niche_id",
          product.strategic_niche_id
        )
        .eq("is_active", true)
        .eq("is_public", true)

    if (nicheSubnichesError) {
      console.error(
        "GET PRODUCT LAUNCH NICHE SUBNICHES ERROR:",
        nicheSubnichesError
      )
    }

    subnicheIds =
      (nicheSubniches || [])
        .map(row =>
          typeof row.id === "string"
            ? row.id
            : ""
        )
        .filter(Boolean)

    mode =
      subnicheIds.length > 0
        ? "segmented_by_product_niche"
        : "none"
  }

  const areaKeys =
    await getProductLaunchAreaKeys({
      supabaseClient,
      strategicNicheId:
        typeof product?.strategic_niche_id ===
        "string"
          ? product.strategic_niche_id
          : null,
      subnicheIds,
    })

  if (
    subnicheIds.length === 0 &&
    areaKeys.length === 0
  ) {
    return {
      phones: [],
      emails: [],
      targeting: {
        ...emptyTargeting,
        warning:
          "product_without_normalized_interests",
      },
    }
  }

  const {
    data: interestRows,
    error: interestsError,
  } =
    subnicheIds.length > 0
      ? await supabaseClient
          .from("subscriber_interests")
          .select("subscriber_id")
          .in("subniche_id", subnicheIds)
          .limit(1000)
      : {
          data: [],
          error: null,
        }

  if (interestsError) {
    console.error(
      "GET PRODUCT LAUNCH INTERESTS ERROR:",
      interestsError
    )

    return {
      phones: [],
      emails: [],
      targeting: {
        mode,
        subnicheIds,
        subscriberIds: [],
        phoneCount: 0,
        emailCount: 0,
        warning:
          "product_launch_interests_lookup_failed",
      },
    }
  }

  const specificSubscriberIds =
    Array.from(
      new Set(
        (interestRows || [])
          .map(row =>
            typeof row.subscriber_id ===
            "string"
              ? row.subscriber_id
              : ""
          )
          .filter(Boolean)
      )
    )

  let areaInterestWarning:
    string | null = null

  const areaSubscriberResult =
    await getSubscriberIdsByAreaKeys(
      supabaseClient,
      areaKeys
    )

  areaInterestWarning =
    areaSubscriberResult.warning

  const areaSubscriberIds =
    areaSubscriberResult.subscriberIds

  const subscriberIds =
    Array.from(
      new Set([
        ...specificSubscriberIds,
        ...areaSubscriberIds,
      ])
    )

  if (
    specificSubscriberIds.length > 0 &&
    areaSubscriberIds.length > 0
  ) {
    mode =
      "segmented_by_product_interests_and_areas"
  } else if (areaSubscriberIds.length > 0) {
    mode =
        "segmented_by_area_interests"
  }

  if (subscriberIds.length === 0) {
    return {
      phones: [],
      emails: [],
      targeting: {
        mode,
        subnicheIds,
        areaKeys,
        subscriberIds: [],
        phoneCount: 0,
        emailCount: 0,
        warning:
          areaInterestWarning ||
          "no_interested_subscribers_for_product_launch",
      },
    }
  }

  const {
    data: subscribers,
    error: subscribersError,
  } =
    await supabaseClient
      .from("subscribers")
      .select("id, telefono, email")
      .in("id", subscriberIds)
      .limit(1000)

  if (subscribersError) {
    console.error(
      "GET PRODUCT LAUNCH SUBSCRIBERS ERROR:",
      subscribersError
    )

    return {
      phones: [],
      emails: [],
      targeting: {
        mode,
        subnicheIds,
        subscriberIds,
        phoneCount: 0,
        emailCount: 0,
        warning:
          "product_launch_subscribers_lookup_failed",
      },
    }
  }

  const [
    whatsappOptInResult,
    emailOptInResult,
  ] =
    await Promise.all([
      getOptedInSubscriberIdsByChannel(
        supabaseClient,
        subscriberIds,
        "whatsapp"
      ),
      getOptedInSubscriberIdsByChannel(
        supabaseClient,
        subscriberIds,
        "email"
      ),
    ])

  const consentWarning =
    whatsappOptInResult.warning ||
    emailOptInResult.warning

  const phones =
    Array.from(
      new Set(
        (subscribers || [])
          .filter(subscriber =>
            typeof subscriber.id ===
              "string" &&
            whatsappOptInResult.subscriberIds.has(
              subscriber.id
            )
          )
          .map(subscriber =>
            typeof subscriber.telefono ===
            "string"
              ? subscriber.telefono
              : ""
          )
          .filter(Boolean)
      )
    )

  const emails =
    Array.from(
      new Set(
        (subscribers || [])
          .filter(subscriber =>
            typeof subscriber.id ===
              "string" &&
            emailOptInResult.subscriberIds.has(
              subscriber.id
            )
          )
          .map(subscriber =>
            typeof subscriber.email ===
            "string"
              ? subscriber.email.trim().toLowerCase()
              : ""
          )
          .filter(email =>
            Boolean(email) &&
            email.includes("@")
          )
      )
    )

  return {
    phones,
    emails,
    targeting: {
      mode,
      subnicheIds,
      areaKeys,
      subscriberIds,
      phoneCount:
        phones.length,
      emailCount:
        emails.length,
      ...(consentWarning
        ? {
            warning:
              consentWarning,
          }
        : phones.length === 0 &&
          emails.length === 0
        ? {
            warning:
              "interested_subscribers_without_opted_in_channels",
          }
        : {}),
    },
  }
}

async function hasSuccessfulProductLaunchNotification(
  supabaseClient: SupabaseClient,
  productId?: string | null
) {
  if (!productId) {
    return false
  }

  const {
    data,
    error,
  } =
    await supabaseClient
      .from("notification_logs")
      .select("id")
      .eq("product_id", productId)
      .eq(
        "template_name",
        getTemplateName({
          status:
            "Disponible",
          notificationType:
            "product_launch",
        })
      )
      .eq("success", true)
      .limit(1)
      .maybeSingle()

  if (error) {
    console.error(
      "CHECK PRODUCT LAUNCH NOTIFICATION ERROR:",
      error
    )
    return false
  }

  return Boolean(data?.id)
}

function getDistributionLocationLabel(
  location:
    InnovaLabRequestBody["distributionLocation"]
) {
  const parts =
    [
      location?.area,
      location?.city,
      location?.address,
    ]
      .map(value =>
        typeof value === "string"
          ? value.trim()
          : ""
      )
      .filter(Boolean)

  return parts.length > 0
    ? parts.join(", ")
    : "ubicacion disponible"
}

async function hasSuccessfulDistributionChannelNotification(
  supabaseClient: SupabaseClient,
  productId?: string | null,
  source?: string
) {
  if (!productId) {
    return false
  }

  const thirtyDaysAgo =
    new Date(
      Date.now() -
        30 *
          24 *
          60 *
          60 *
          1000
    ).toISOString()

  const templateName =
    getTemplateName({
      notificationType:
        "distribution_channel",
    })

  const recentResult =
    await supabaseClient
      .from("notification_logs")
      .select("id")
      .eq("product_id", productId)
      .eq(
        "template_name",
        templateName
      )
      .eq("success", true)
      .gte("created_at", thirtyDaysAgo)
      .limit(1)
      .maybeSingle()

  if (recentResult.error) {
    console.error(
      "CHECK RECENT DISTRIBUTION CHANNEL NOTIFICATION ERROR:",
      recentResult.error
    )
  } else if (recentResult.data?.id) {
    return true
  }

  if (!source) {
    return false
  }

  const {
    data,
    error,
  } =
    await supabaseClient
      .from("notification_logs")
      .select("id")
      .eq("product_id", productId)
      .eq(
        "template_name",
        templateName
      )
      .eq("source", source)
      .eq("success", true)
      .limit(1)
      .maybeSingle()

  if (error) {
    console.error(
      "CHECK DISTRIBUTION CHANNEL NOTIFICATION ERROR:",
      error
    )
    return false
  }

  return Boolean(data?.id)
}

export async function POST(
  req: Request
) {

  const adminAuth =
    await validateAdminRequest(req)

  if (!adminAuth.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          adminAuth.error,
      },
      {
        status:
          adminAuth.status,
      }
    )
  }

  let requestBody:
    InnovaLabRequestBody | null = null

  try {

    const body =
      await req.json() as InnovaLabRequestBody

    requestBody =
      body

    const {
      notificationType,
      productId,
      product,
      status,
      progress,
      imageUrl,
      source,
      triggeredBy,
      force,
      distributionLocation,
    } = body

    const authenticatedTriggeredBy =
      adminAuth.triggeredBy ||
      triggeredBy ||
      "admin"

    const isDistributionChannelNotification =
      notificationType ===
      "distribution_channel"

    const isProductLaunchNotification =
      !isDistributionChannelNotification &&
      status === "Disponible"

    const distributionLocationLabel =
      getDistributionLocationLabel(
        distributionLocation
      )

    if (
      isProductLaunchNotification &&
      productId &&
      force !== true &&
      await hasSuccessfulProductLaunchNotification(
        adminAuth.supabaseClient,
        productId
      )
    ) {
      return NextResponse.json({
        success: true,
        warning:
          "product_launch_already_notified",
        result: {
          success: true,
          total: 0,
          successful: 0,
          failed: 0,
          results: [],
        },
      })
    }

    if (
      isDistributionChannelNotification &&
      productId &&
      source &&
      force !== true &&
      await hasSuccessfulDistributionChannelNotification(
        adminAuth.supabaseClient,
        productId,
        source
      )
    ) {
      return NextResponse.json({
        success: true,
        warning:
          "distribution_channel_already_notified",
        result: {
          success: true,
          total: 0,
          successful: 0,
          failed: 0,
          results: [],
        },
      })
    }

    let targeting:
      | ProductLaunchTargeting
      | null = null

    let communityRecipientPhones: string[]
    let communityRecipientEmails: string[] = []

    if (
      isProductLaunchNotification ||
      isDistributionChannelNotification
    ) {
      const launchRecipients =
        await getProductLaunchRecipientPhones(
          adminAuth.supabaseClient,
          productId
        )

      communityRecipientPhones =
        launchRecipients.phones
      communityRecipientEmails =
        launchRecipients.emails
      targeting =
        launchRecipients.targeting
    } else {
      communityRecipientPhones =
        await getCommunityRecipientPhones(
          adminAuth.supabaseClient
        )
    }

    let result: NotificationResult

    try {

      result =
        isDistributionChannelNotification
          ? await sendWhatsAppDistributionChannel({
              product:
                product || "",
              channelName:
                distributionLocation?.name || "",
              locationLabel:
                distributionLocationLabel,
              recipientPhones:
                communityRecipientPhones,
            })
          : await sendWhatsAppUpdate(
              product || "",
              status || "",
              progress || "",
              imageUrl || "",
              communityRecipientPhones
            )

    } catch (error) {

      result = {
        success: false,
        error:
          String(error),
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
      }

      const logError =
        await saveNotificationLog(
          adminAuth.supabaseClient,
          {
            productId,
            product,
            status,
            progress,
            imageUrl,
            source,
            notificationType,
            distributionLocation,
            triggeredBy:
              authenticatedTriggeredBy,
          },
          result
        )

      console.error(
        "API ERROR:",
        error
      )

      return NextResponse.json(
        {
          success: false,
          error: String(error),
          result,
          ...(logError
            ? {
                warning:
                  "NOTIFICATION_LOG_FAILED",
                log_error:
                  logError,
              }
            : {}),
        },
        {
          status: 500,
        }
      )

    }

    const logError =
      await saveNotificationLog(
        adminAuth.supabaseClient,
        {
          productId,
          product,
          status,
          progress,
          imageUrl,
          source,
          notificationType,
          distributionLocation,
          triggeredBy:
            authenticatedTriggeredBy,
        },
        result
      )

    let emailResult:
      | ProductLaunchEmailResult
      | DistributionChannelEmailResult
      | null = null

    let emailLogError:
      string | null = null

    if (isDistributionChannelNotification) {
      emailResult =
        await sendDistributionChannelEmail({
          emails:
            communityRecipientEmails,
          product:
            product || "",
          channelName:
            distributionLocation?.name || "",
          locationLabel:
            distributionLocationLabel,
          productUrl:
            distributionLocation?.productUrl || undefined,
          mapUrl:
            distributionLocation?.mapUrl || undefined,
        })

      emailLogError =
        await saveEmailNotificationLog(
          adminAuth.supabaseClient,
          {
            productId,
            product,
            status,
            progress,
            imageUrl,
            source,
            notificationType,
            distributionLocation,
            triggeredBy:
              authenticatedTriggeredBy,
          },
          emailResult
        )
    } else if (isProductLaunchNotification) {
      emailResult =
        await sendProductLaunchEmail({
          emails:
            communityRecipientEmails,
          product:
            product || "",
          imageUrl:
            imageUrl || "",
        })

      emailLogError =
        await saveEmailNotificationLog(
          adminAuth.supabaseClient,
          {
            productId,
            product,
            status,
            progress,
            imageUrl,
            source,
            notificationType,
            distributionLocation,
            triggeredBy:
              authenticatedTriggeredBy,
          },
          emailResult
        )
    }

    if (
      process.env.NODE_ENV ===
      "development"
    ) {

      console.log(
        "WHATSAPP RESULT:",
        result
      )

    }

    return NextResponse.json({

      success:
        result.success ||
        Boolean(emailResult?.success),

      result,

      ...(emailResult
        ? {
            emailResult,
          }
        : {}),

      ...(targeting
        ? {
            targeting,
          }
        : {}),

      ...(logError
        ? {
            warning:
              "NOTIFICATION_LOG_FAILED",
            log_error:
              logError,
          }
        : {}),

      ...(emailLogError
        ? {
            email_warning:
              "EMAIL_NOTIFICATION_LOG_FAILED",
            email_log_error:
              emailLogError,
          }
        : {}),

    })

  } catch (error) {

    if (requestBody) {
      await saveNotificationLog(
        adminAuth.supabaseClient,
        {
          ...requestBody,
          triggeredBy:
            adminAuth.triggeredBy ||
            requestBody.triggeredBy,
        },
        {
          success: false,
          error:
            String(error),
          total: 0,
          successful: 0,
          failed: 0,
          results: [],
        }
      )
    }

    console.error(
      "API ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error: String(error),
      },
      {
        status: 500,
      }
    )

  }

}
