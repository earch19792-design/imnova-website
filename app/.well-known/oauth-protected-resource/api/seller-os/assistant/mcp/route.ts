export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { handleSellerOsMcpProtectedResourceMetadataV1 } from
  "@/lib/ebay/ebay-seller-os-mcp-oauth-v1"

// Canonical path-specific Protected Resource Metadata endpoint (RFC 9728).
export const GET = handleSellerOsMcpProtectedResourceMetadataV1
