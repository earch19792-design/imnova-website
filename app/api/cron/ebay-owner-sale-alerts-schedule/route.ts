export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { POST as runOwnerSaleAlertLane } from
  "@/app/api/cron/ebay-owner-sale-alerts/route"

/** Vercel Cron GET adapter for the isolated P0 official-order lane. */
export function GET(req: Request) {
  return runOwnerSaleAlertLane(req)
}
