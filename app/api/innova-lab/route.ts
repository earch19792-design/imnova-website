export const runtime = "nodejs"

import { NextResponse } from "next/server"

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js"

import {
  sendWhatsAppUpdate,
} from "../../../lib/whatsapp"

type InnovaLabRequestBody = {
  productId?: string | null
  product?: string
  status?: string
  progress?: string
  imageUrl?: string
  source?: string
  triggeredBy?: string
  force?: boolean
}

type ProductLaunchTargeting = {
  mode:
    | "segmented_by_product_subniches"
    | "segmented_by_product_niche"
    | "all_community"
    | "none"
  subnicheIds: string[]
  subscriberIds: string[]
  phoneCount: number
  warning?: string
}

type WhatsAppResult =
  Awaited<ReturnType<typeof sendWhatsAppUpdate>>

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
      status: 401 | 403
      error: string
    }

function getTemplateName(
  status?: string
) {

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
  result: WhatsAppResult,
  key: "total" | "successful" | "failed"
) {

  const value =
    (result as unknown as JsonRecord)[key]

  return typeof value === "number"
    ? value
    : 0

}

function getSafeErrorMessage(
  result: WhatsAppResult
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

  return {
    ok: true,
    triggeredBy:
      userData.user.email ||
      userData.user.id,
    supabaseClient:
      authenticatedSupabase,
  }

}

async function saveNotificationLog(
  supabaseClient: SupabaseClient,
  body: InnovaLabRequestBody,
  result: WhatsAppResult
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
            getTemplateName(body.status),
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

async function getCommunityRecipientPhones(
  supabaseClient: SupabaseClient
) {

  const { data, error } =
    await supabaseClient
      .from("subscribers")
      .select("telefono")
      .not("telefono", "is", null)
      .limit(500)

  if (error) {
    console.error(
      "GET COMMUNITY WHATSAPP RECIPIENTS ERROR:",
      error
    )

    return []
  }

  return (data || [])
    .map((subscriber) =>
      typeof subscriber.telefono === "string"
        ? subscriber.telefono
        : ""
    )
    .filter(Boolean)

}

async function getProductLaunchRecipientPhones(
  supabaseClient: SupabaseClient,
  productId?: string | null
): Promise<{
  phones: string[]
  targeting: ProductLaunchTargeting
}> {
  const emptyTargeting: ProductLaunchTargeting = {
    mode: "none",
    subnicheIds: [],
    subscriberIds: [],
    phoneCount: 0,
  }

  if (!productId) {
    return {
      phones: [],
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

  if (subnicheIds.length === 0) {
    return {
      phones: [],
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
    await supabaseClient
      .from("subscriber_interests")
      .select("subscriber_id")
      .in("subniche_id", subnicheIds)
      .limit(1000)

  if (interestsError) {
    console.error(
      "GET PRODUCT LAUNCH INTERESTS ERROR:",
      interestsError
    )

    return {
      phones: [],
      targeting: {
        mode,
        subnicheIds,
        subscriberIds: [],
        phoneCount: 0,
        warning:
          "product_launch_interests_lookup_failed",
      },
    }
  }

  const subscriberIds =
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

  if (subscriberIds.length === 0) {
    return {
      phones: [],
      targeting: {
        mode,
        subnicheIds,
        subscriberIds: [],
        phoneCount: 0,
        warning:
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
      .select("id, telefono")
      .in("id", subscriberIds)
      .not("telefono", "is", null)
      .neq("telefono", "")
      .limit(1000)

  if (subscribersError) {
    console.error(
      "GET PRODUCT LAUNCH SUBSCRIBERS ERROR:",
      subscribersError
    )

    return {
      phones: [],
      targeting: {
        mode,
        subnicheIds,
        subscriberIds,
        phoneCount: 0,
        warning:
          "product_launch_subscribers_lookup_failed",
      },
    }
  }

  const phones =
    Array.from(
      new Set(
        (subscribers || [])
          .map(subscriber =>
            typeof subscriber.telefono ===
            "string"
              ? subscriber.telefono
              : ""
          )
          .filter(Boolean)
      )
    )

  return {
    phones,
    targeting: {
      mode,
      subnicheIds,
      subscriberIds,
      phoneCount:
        phones.length,
      ...(phones.length === 0
        ? {
            warning:
              "interested_subscribers_without_whatsapp",
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
        getTemplateName("Disponible")
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

  let body:
    InnovaLabRequestBody | null = null

  try {

    body =
      await req.json()

    const {
      productId,
      product,
      status,
      progress,
      imageUrl,
      source,
      triggeredBy,
      force,
    } = body

    const authenticatedTriggeredBy =
      adminAuth.triggeredBy ||
      triggeredBy ||
      "admin"

    if (
      status === "Disponible" &&
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

    let targeting:
      | ProductLaunchTargeting
      | null = null

    let communityRecipientPhones: string[]

    if (status === "Disponible") {
      const launchRecipients =
        await getProductLaunchRecipientPhones(
          adminAuth.supabaseClient,
          productId
        )

      communityRecipientPhones =
        launchRecipients.phones
      targeting =
        launchRecipients.targeting
    } else {
      communityRecipientPhones =
        await getCommunityRecipientPhones(
          adminAuth.supabaseClient
        )
    }

    let result: WhatsAppResult

    try {

      result =
        await sendWhatsAppUpdate(
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
          triggeredBy:
            authenticatedTriggeredBy,
        },
        result
      )

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
        result.success,

      result,

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

    })

  } catch (error) {

    if (body) {
      await saveNotificationLog(
        adminAuth.supabaseClient,
        {
          ...body,
          triggeredBy:
            adminAuth.triggeredBy ||
            body.triggeredBy,
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
