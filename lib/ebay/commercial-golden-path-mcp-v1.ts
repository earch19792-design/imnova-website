import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { SellerOsControlPrincipalV1 } from "./teo-pre-research-control-oauth-v1"
import { createGoldenContextV1, evaluateGoldenRuntimeV1, previewGoldenCategoryV1, importGoldenManualV1, prepareGoldenRuntimeV1, reconcileGoldenRuntimeV1, readGoldenMonitoringV1 } from "./commercial-golden-path-runtime-v1"

export const GOLDEN_PATH_MCP_TOOL_NAMES_V1 = [
  "seller_os_preview_category_opportunities_v1", "seller_os_evaluate_candidate_v1",
  "seller_os_import_manual_market_evidence_v1", "seller_os_prepare_intelligent_listing_package_v1",
  "seller_os_reconcile_and_enroll_listing_v1", "seller_os_get_golden_path_monitoring_v1",
] as const
export const goldenCandidateSchemaV1 = z.object({ productId: z.string().regex(/^\d{1,30}$/), variantId: z.string().regex(/^\d{1,30}$/), supplierSku: z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/), supplierQuantity: z.number().int().min(1).max(20).default(1) }).strict()
const identity = z.object({ productName: z.string().min(1).max(500), manufacturerBrand: z.string().max(160).nullable().optional(), gtin: z.string().max(30).nullable().optional(), mpn: z.string().max(160).nullable().optional(), model: z.string().max(160).nullable().optional(), packCount: z.number().int().min(1).max(1000).nullable(), unitCount: z.number().int().min(1).max(1000).nullable().optional(), size: z.string().max(160).nullable().optional(), color: z.string().max(160).nullable().optional(), scent: z.string().max(160).nullable().optional(), variant: z.string().max(160).nullable().optional(), condition: z.string().max(80).nullable().optional() }).strict()
export const goldenManualRowSchemaV1 = z.object({ sourceLocator: z.string().min(8).max(1000), sourceDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/), listingState: z.enum(["SOLD", "ACTIVE"]), identity, requestedClassification: z.enum(["EXACT", "CLOSE", "FAMILY", "REJECTED_COMPARABLE"]), reviewReason: z.string().min(8).max(1000), soldQuantity: z.number().int().min(1).max(1000000).nullable(), realizedSoldPrice: z.number().positive().max(1000000).nullable(), activeListingPrice: z.number().positive().max(1000000).nullable().optional(), buyerShipping: z.number().nonnegative().max(10000).nullable(), currency: z.literal("USD"), lastSoldDate: z.iso.datetime().nullable(), capturedAt: z.iso.datetime(), realizedPriceStatus: z.enum(["PROVEN", "UNPROVEN", "UNAVAILABLE"]) }).strict()
const profit = z.number().min(4).max(10000).default(4)
export function registerGoldenPathControlToolsV1(server: McpServer, principal: SellerOsControlPrincipalV1, oauthResource: string) {
  const schemas = [
    z.object({ category: z.string().min(1).max(100).default("Personal Care"), limit: z.number().int().min(1).max(20).default(5), targetNetProfit: profit }).strict(),
    z.object({ candidate: goldenCandidateSchemaV1, targetNetProfit: profit }).strict(),
    z.object({ candidate: goldenCandidateSchemaV1, rows: z.array(goldenManualRowSchemaV1).min(1).max(50), operatorAttested: z.literal(true) }).strict(),
    z.object({ evaluationReceiptId: z.string().uuid() }).strict(),
    z.object({ packageReceiptId: z.string().uuid(), itemId: z.string().regex(/^\d{9,20}$/).optional(), dryRun: z.boolean().default(true) }).strict(),
    z.object({ itemId: z.string().regex(/^\d{9,20}$/) }).strict(),
  ]
  const descriptions = [
    "Commercial Golden Path: demand-first bounded category opportunities, classified EXACT/CLOSE SOLD, separate FAMILY, canonical Luna, official LIVE Duplicate Gate, real shipping, economics and GO/HOLD/REJECT/UNPROVEN. Stores an internal audit receipt. A fresh supplier shipping quote may temporarily change its cart, with verified restoration and no purchase/payment. No marketplace writes.",
    "Deep dive one exact Luna product/variant/supplier SKU/offer quantity. Reuses durable authorities and fails closed on missing evidence. Stores an internal audit receipt. A fresh supplier shipping quote may temporarily change its cart, with verified restoration and no purchase/payment. No marketplace writes.",
    "Import operator-attested manual Terapeak SOLD or ACTIVE observations with realized price, buyer shipping, sold quantity, last sold date, match classification and source provenance. Deduplicates durably. Never changes supplier Product Truth.",
    "Reevaluate a candidate and prepare a draft-only listing package only when the current decision is GO. Stores the internal package and receipts; OWNER publishes manually. No eBay offer, publish or inventory write.",
    "After OWNER manual publication: authoritative SKU to Item ID discovery and GetItem LIVE readback. dryRun defaults true. With dryRun false, atomically link Registry, StockGuard monitoring and analytics internally. A draft or simulation is never enrollment. No marketplace write.",
    "Read managed listing monitoring for exact 24H/7D/30D windows. Unknown metrics stay null. Enrollment never proves data availability. No automatic END or marketplace writes.",
  ]
  for (let i = 0; i < GOLDEN_PATH_MCP_TOOL_NAMES_V1.length; i++) {
    server.registerTool(GOLDEN_PATH_MCP_TOOL_NAMES_V1[i], { title: GOLDEN_PATH_MCP_TOOL_NAMES_V1[i], description: descriptions[i], inputSchema: schemas[i],
      // Internal durable receipts are writes. They are deliberately not disguised as read-only Tunnel tools.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: i === 2 || i === 4 },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["openid", "profile"] }], marketplaceWriteCapability: "ABSENT", receiptWrites: "INTERNAL_ONLY", supplierCartAcquisition: [0, 1, 3].includes(i) ? "TEMPORARY_CART_WRITES_WITH_RESTORATION_READBACK_NO_PURCHASE" : "ABSENT" } }, async (args: unknown) => {
      try {
        const ctx = await createGoldenContextV1(principal, oauthResource)
        let result: unknown
        if (i === 0) { const a = schemas[0].parse(args) as { category: string; limit: number; targetNetProfit: number }; result = await previewGoldenCategoryV1(ctx, a.category, a.limit, a.targetNetProfit) }
        else if (i === 1) { const a = schemas[1].parse(args) as { candidate: z.infer<typeof goldenCandidateSchemaV1>; targetNetProfit: number }; result = await evaluateGoldenRuntimeV1(ctx, a.candidate, a.targetNetProfit) }
        else if (i === 2) { const a = schemas[2].parse(args) as { candidate: z.infer<typeof goldenCandidateSchemaV1>; rows: z.infer<typeof goldenManualRowSchemaV1>[] }; result = await importGoldenManualV1(ctx, a.candidate, a.rows) }
        else if (i === 3) { const a = schemas[3].parse(args) as { evaluationReceiptId: string }; result = await prepareGoldenRuntimeV1(ctx, a.evaluationReceiptId) }
        else if (i === 4) { const a = schemas[4].parse(args) as { packageReceiptId: string; itemId?: string; dryRun: boolean }; result = await reconcileGoldenRuntimeV1(ctx, a.packageReceiptId, a.itemId, a.dryRun) }
        else { const a = schemas[5].parse(args) as { itemId: string }; result = await readGoldenMonitoringV1(ctx, a.itemId) }
        return { structuredContent: { result }, content: [{ type: "text" as const, text: "Seller OS returned Commercial Golden Path evidence and its durable receipt. Publication remains OWNER manual." }] }
      } catch (error) {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{3,120}$/.test(error.message) ? error.message : "GOLDEN_PATH_FAILED_CLOSED"
        return { isError: true, structuredContent: { result: { contractVersion: "COMMERCIAL_GOLDEN_PATH_V1", status: "UNPROVEN", reasonCodes: [code], marketplaceWrites: 0 } }, content: [{ type: "text" as const, text: code }] }
      }
    })
  }
}
