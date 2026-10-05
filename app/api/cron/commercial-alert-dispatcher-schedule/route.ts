export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { POST as runCommercialAlertDispatcher } from
  "@/app/api/cron/commercial-alert-dispatcher/route"

/**
 * Vercel Cron invokes configured paths with GET. The operational dispatcher
 * stays POST-only; this adapter preserves its authorization and runtime gates.
 */
export function GET(req: Request) {
  return runCommercialAlertDispatcher(req)
}
