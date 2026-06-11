export const runtime = "nodejs"

import { NextResponse } from "next/server"

import {
  supabase,
} from "../../../lib/supabase"

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
}

type WhatsAppResult =
  Awaited<ReturnType<typeof sendWhatsAppUpdate>>

type JsonRecord =
  Record<string, unknown>

function getTemplateName(
  status?: string
) {

  return status === "Disponible"
    ? "imnova_product_launch"
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

async function saveNotificationLog(
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
      await supabase
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

export async function POST(
  req: Request
) {

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
    } = body

    let result: WhatsAppResult

    try {

      result =
        await sendWhatsAppUpdate(
          product || "",
          status || "",
          progress || "",
          imageUrl || ""
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
          {
            productId,
            product,
            status,
            progress,
            imageUrl,
            source,
            triggeredBy,
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
        {
          productId,
          product,
          status,
          progress,
          imageUrl,
          source,
          triggeredBy,
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
        body,
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
