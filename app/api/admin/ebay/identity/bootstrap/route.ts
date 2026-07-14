export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { handleEbayProductionIdentityBootstrapRequest } from "@/lib/ebay/ebay-production-identity-bootstrap"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

export async function POST(req: Request) {
  return handleEbayProductionIdentityBootstrapRequest(req, {
    validateAdminApiRequest,
  })
}
