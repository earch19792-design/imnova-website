export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { handleSellerOsMcpProtectedResourceMetadataRouteV1 } from
  "@/lib/ebay/ebay-seller-os-mcp-auth-metadata-v1"

// Root fallback for clients that probe the origin before the path-specific RFC 9728 URL.
export const GET = handleSellerOsMcpProtectedResourceMetadataRouteV1
