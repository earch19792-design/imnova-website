export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

import { handleSellerOsMcpRequestV1 } from
  "@/lib/ebay/ebay-seller-os-mcp-server-v1"

// Publicly addressable in Preview, but never public data: the shared handler
// enforces the protected bearer boundary before MCP negotiation.
export const GET = handleSellerOsMcpRequestV1
export const POST = handleSellerOsMcpRequestV1
export const DELETE = handleSellerOsMcpRequestV1
