export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { handleSellerOsMcpProtectedResourceMetadataRouteV1 } from
  "@/lib/ebay/ebay-seller-os-mcp-auth-metadata-v1"

// Canonical path-specific Protected Resource Metadata endpoint (RFC 9728).
export const GET = handleSellerOsMcpProtectedResourceMetadataRouteV1
