export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { handleSellerOsControlMcpRequestV1 } from
  "@/lib/ebay/teo-pre-research-control-mcp-v1"

export const GET = handleSellerOsControlMcpRequestV1
export const POST = handleSellerOsControlMcpRequestV1
export const DELETE = handleSellerOsControlMcpRequestV1
