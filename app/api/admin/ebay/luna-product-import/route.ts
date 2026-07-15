export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  buildDirectedLunaPackRows,
  fetchDirectedLunaProduct,
  normalizeDirectedPackSizes,
} from "@/lib/ebay/ebay-luna-directed-product-import"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

const IMPORT_CONFIRMATION = "IMPORTAR_PACKS_LUNA_3_6_12"

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^LUNA_DIRECTED_IMPORT_[A-Z0-9_]+$/.test(message)
    ? message
    : /^LUNA_DIRECTED_IMPORT_(FETCH)_\d{3}$/.test(message)
      ? message
      : "LUNA_DIRECTED_IMPORT_FAILED"
}

function noStore(payload: Record<string, unknown>, init?: ResponseInit) {
  const response = NextResponse.json(payload, init)
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return noStore(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (!validation.userId) return noStore(
    { success: false, error: "LUNA_DIRECTED_IMPORT_HUMAN_ADMIN_REQUIRED" },
    { status: 403 },
  )
  try {
    const body = object(await req.json())
    const action = body.action === "preview" || body.action === "import" ? body.action : ""
    if (!action) return noStore(
      { success: false, error: "LUNA_DIRECTED_IMPORT_ACTION_INVALID" },
      { status: 400 },
    )
    const product = await fetchDirectedLunaProduct(body.productUrl)
    const packSizes = normalizeDirectedPackSizes(body.packSizes)
    if (action === "preview") {
      return noStore({
        success: true,
        product,
        packSizes,
        notices: [
          "SOURCE_UNIT_UPC_NOT_USED_FOR_MULTIPACK",
          "INVENTORY_QUANTITY_NOT_INFERRED",
          "DEMAND_SCORE_NOT_INVENTED",
          "IMAGES_REQUIRE_HUMAN_APPROVAL",
        ],
        safety: { ebayWriteUsed: false, canPublish: false, whatsappUsed: false },
      })
    }
    if (body.confirmation !== IMPORT_CONFIRMATION) {
      return noStore(
        { success: false, error: "LUNA_DIRECTED_IMPORT_HUMAN_CONFIRMATION_REQUIRED" },
        { status: 400 },
      )
    }
    const rows = buildDirectedLunaPackRows({
      product,
      sourceVariantId: body.sourceVariantId,
      packSizes,
      humanConfirmedCommercialPacks: body.humanConfirmedCommercialPacks,
    })
    const supabase = getSupabaseAdminClient()
    const { data: existing, error: existingError } = await supabase
      .from("ebay_luna_opportunity_queue")
      .select("candidate_key,queue_status")
      .in("candidate_key", rows.map((row) => row.candidate_key))
    if (existingError) throw new Error("LUNA_DIRECTED_IMPORT_EXISTING_READ_FAILED")
    const protectedStatuses = new Map((existing ?? [])
      .filter((row) => ["listed", "archived"].includes(row.queue_status))
      .map((row) => [row.candidate_key, row.queue_status]))
    const persistedRows = rows.map((row) => ({
      ...row,
      queue_status: protectedStatuses.get(row.candidate_key) ?? row.queue_status,
    }))
    const { data, error } = await supabase
      .from("ebay_luna_opportunity_queue")
      .upsert(persistedRows, { onConflict: "candidate_key" })
      .select("id,candidate_key,product_title,variant_title,supplier_sku,queue_status")
    if (error || !data || data.length !== rows.length) {
      throw new Error("LUNA_DIRECTED_IMPORT_PERSIST_FAILED")
    }
    return noStore({
      success: true,
      imported: data,
      idempotentKeys: rows.map((row) => row.candidate_key),
      safety: { ebayWriteUsed: false, canPublish: false, whatsappUsed: false },
    })
  } catch (error) {
    return noStore({ success: false, error: safeError(error) }, { status: 502 })
  }
}
