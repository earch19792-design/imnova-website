export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { POST as runAmazonConnieReadOnlySync } from
  "@/app/api/cron/amazon-connie-readonly-sync/route"

/** Vercel Cron invokes GET; the protected runtime remains POST-only. */
export function GET(req: Request) {
  return runAmazonConnieReadOnlySync(req)
}
