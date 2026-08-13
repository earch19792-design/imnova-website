export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { handleSellerOsCloudReadRelayRequestV1 } from
  "@/lib/ebay/ebay-seller-os-cloud-read-relay-v1"

// Preview-only, HMAC-authenticated and allowlisted. Vercel Deployment
// Protection remains an independent outer transport boundary.
export async function POST(request: Request) {
  return handleSellerOsCloudReadRelayRequestV1(request)
}
