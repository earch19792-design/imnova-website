export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { POST as runCommercialMonitor } from
  "@/app/api/cron/ebay-commercial-monitor/route"

/**
 * Vercel Cron invokes configured paths with GET. The operational monitor stays
 * POST-only; this narrow adapter delegates to it so the same authorization
 * checks and runtime boundary are applied to scheduled executions.
 */
export function GET(req: Request) {
  return runCommercialMonitor(req)
}
