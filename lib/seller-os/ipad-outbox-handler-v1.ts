import { NextResponse } from "next/server"
import { getSupabaseAdminClient } from "../supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from "../ebay/ebay-seller-account-scope"
import { SELLER_OS_ACCESS_ROLES, type SellerOsAccessRole } from "../seller-os-access-control"
import { saveDurableOutboxV1, readDurableOutboxV1 } from "./ipad-durable-outbox-v1"
export async function handleIpadOutboxV1(input: { body: unknown; actorUserId: string; accessRole: SellerOsAccessRole; traceId: string }) {
 const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
 try {
   if (![SELLER_OS_ACCESS_ROLES.owner, SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator].includes(input.accessRole)) throw Error("OUTBOX_ROLE_REQUIRED")
   const body = input.body as Record<string, unknown>
   if (!body || body.mode !== "IPAD_OUTBOX" || Object.keys(body).some(k => !["mode", "action", "intent", "keys"].includes(k))) throw Error("OUTBOX_INPUT_INVALID")
   const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
   if (!accountKey) throw Error("OUTBOX_ACCOUNT_REQUIRED")
   const scope = { supabase: getSupabaseAdminClient(), accountKey, actorUserId: input.actorUserId, owner: input.accessRole === SELLER_OS_ACCESS_ROLES.owner }
   if (body.action === "PUT") return reply({ success: true, receipt: await saveDurableOutboxV1({ ...scope, intent: body.intent }), traceId: input.traceId })
   if (body.action === "READ" && Array.isArray(body.keys)) return reply({ success: true, receipts: await readDurableOutboxV1({ ...scope, keys: body.keys }), traceId: input.traceId })
   throw Error("OUTBOX_ACTION_INVALID")
 } catch (error) {
   const code = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : "OUTBOX_REQUEST_FAILED"
   return reply({ success: false, error: code, traceId: input.traceId }, code.includes("FAILED") ? 503 : 409)
 }
}
