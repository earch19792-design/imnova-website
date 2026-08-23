import type { SupabaseClient } from "@supabase/supabase-js"

export type ReadonlySalesAuditSourceStatus = "AVAILABLE" | "PARTIAL" | "ERROR"

export type ReadonlySalesAuditSourceResult<T> = {
  source: string
  status: ReadonlySalesAuditSourceStatus
  rows: T[]
  limitationCode: string | null
  truncated: boolean
}

export type ReadonlyCommercialEventRow = {
  id: string
  event_type: string
  evidence: unknown
  detected_at: string
  marketplace_order_id: string | null
}

export type ReadonlyDeliveryOutboxRow = {
  commercial_event_id: string | null
  channel: string
  status: string
}

export type ReadonlySalesOrderAuditV1 = {
  saleEvents: ReadonlySalesAuditSourceResult<ReadonlyCommercialEventRow>
  saleDeliveries: ReadonlySalesAuditSourceResult<ReadonlyDeliveryOutboxRow>
}

const SALES_EVENT_MAXIMUM = 2_000
const DELIVERY_AUDIT_MAXIMUM = 2_000
const DELIVERY_EVENT_ID_CHUNK_SIZE = 100

function success<T>(source: string, rows: T[], maximum: number) {
  const truncated = rows.length > maximum
  return {
    source,
    status: truncated ? "PARTIAL" as const : "AVAILABLE" as const,
    rows: rows.slice(0, maximum),
    limitationCode: truncated ? `${source}_RESULT_LIMIT_REACHED` : null,
    truncated,
  }
}

function failure<T>(source: string, code: string, rows: T[] = []) {
  return {
    source,
    status: rows.length ? "PARTIAL" as const : "ERROR" as const,
    rows,
    limitationCode: code,
    truncated: false,
  }
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function readSaleEvents(
  supabase: SupabaseClient,
  accountKey: string,
): Promise<ReadonlySalesAuditSourceResult<ReadonlyCommercialEventRow>> {
  const { data, error } = await supabase
    .from("commercial_alert_events")
    .select("id,event_type,evidence,detected_at,marketplace_order_id")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .in("event_type", [
      "SALE_DETECTED",
      "POST_PURCHASE_THANK_YOU_MESSAGE_AUDIT",
      "COMMERCIAL_SALE_LEARNING_EVENT",
      "SALE_TRIGGERED_STOCK_RECHECK",
      "WHATSAPP_SALE_NOTIFICATION_AUDIT",
    ])
    .order("detected_at", { ascending: false })
    .limit(SALES_EVENT_MAXIMUM + 1)
  if (error) {
    return failure(
      "COMMERCIAL_SALE_EVENT_AUDIT",
      "COMMERCIAL_SALE_EVENT_READ_FAILED",
    )
  }
  return success(
    "COMMERCIAL_SALE_EVENT_AUDIT",
    (data ?? []) as ReadonlyCommercialEventRow[],
    SALES_EVENT_MAXIMUM,
  )
}

async function readSaleDeliveries(
  supabase: SupabaseClient,
  accountKey: string,
  eventIds: string[],
): Promise<ReadonlySalesAuditSourceResult<ReadonlyDeliveryOutboxRow>> {
  if (!eventIds.length) {
    return success(
      "COMMERCIAL_SALE_DELIVERY_AUDIT",
      [],
      DELIVERY_AUDIT_MAXIMUM,
    )
  }
  const rows: ReadonlyDeliveryOutboxRow[] = []
  let failed = false
  let budgetReached = false
  const selections = chunks(eventIds, DELIVERY_EVENT_ID_CHUNK_SIZE)
  for (const [index, selection] of selections.entries()) {
    const remaining = DELIVERY_AUDIT_MAXIMUM + 1 - rows.length
    if (remaining <= 0) {
      budgetReached = true
      break
    }
    const { data, error } = await supabase
      .from("alert_delivery_outbox")
      .select("commercial_event_id,channel,status")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", "EBAY_US")
      .in("commercial_event_id", selection)
      .order("created_at", { ascending: false })
      .limit(remaining)
    if (error) {
      failed = true
      continue
    }
    rows.push(...((data ?? []) as ReadonlyDeliveryOutboxRow[]))
    if (rows.length > DELIVERY_AUDIT_MAXIMUM ||
        (rows.length === DELIVERY_AUDIT_MAXIMUM &&
          index < selections.length - 1)) {
      budgetReached = true
      break
    }
  }
  const unique = [...new Map(rows.map((row) => [
    `${row.commercial_event_id}:${row.channel}`,
    row,
  ])).values()]
  if (failed) {
    return failure(
      "COMMERCIAL_SALE_DELIVERY_AUDIT",
      "COMMERCIAL_SALE_DELIVERY_READ_PARTIAL",
      unique.slice(0, DELIVERY_AUDIT_MAXIMUM),
    )
  }
  if (budgetReached) {
    return {
      source: "COMMERCIAL_SALE_DELIVERY_AUDIT",
      status: "PARTIAL",
      rows: unique.slice(0, DELIVERY_AUDIT_MAXIMUM),
      limitationCode: "COMMERCIAL_SALE_DELIVERY_AUDIT_RESULT_LIMIT_REACHED",
      truncated: true,
    }
  }
  return success(
    "COMMERCIAL_SALE_DELIVERY_AUDIT",
    unique,
    DELIVERY_AUDIT_MAXIMUM,
  )
}

export async function readSalesOrderReadonlyAuditV1(
  supabase: SupabaseClient,
  accountKey: string,
): Promise<ReadonlySalesOrderAuditV1> {
  const saleEvents = await readSaleEvents(supabase, accountKey)
  const saleDeliveries = await readSaleDeliveries(
    supabase,
    accountKey,
    [...new Set(saleEvents.rows.map((event) => event.id))],
  )
  return { saleEvents, saleDeliveries }
}
