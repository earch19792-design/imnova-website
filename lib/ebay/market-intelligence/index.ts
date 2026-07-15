// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { ebayMarketIntelligenceInputSchema } from "./schema.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { buildMarketIntelligenceReport, serializeMarketIntelligenceReport } from "./report.ts"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
export * from "./types.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
export * from "./schema.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
export * from "./calculations.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
export * from "./importers.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
export * from "./report.ts"

export function runEbayMarketIntelligenceLoop(input: unknown, generatedAt = new Date()) {
  const validated = ebayMarketIntelligenceInputSchema.parse(input)
  const report = buildMarketIntelligenceReport(validated, generatedAt)
  const serialized = serializeMarketIntelligenceReport(report)
  return {
    report,
    files: {
      "report.json": serialized.json,
      "report.md": serialized.markdown,
    },
    safety: {
      scrapingUsed: false,
      competitorContentCopied: false,
      inferredSalesPresentedAsVerified: false,
    },
  }
}
