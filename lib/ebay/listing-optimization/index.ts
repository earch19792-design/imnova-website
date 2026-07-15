// @ts-expect-error Native Node TypeScript tests require explicit extensions.
import { listingOptimizationInputSchema } from "./schema.ts"
// @ts-expect-error Native Node TypeScript tests require explicit extensions.
import { runListingOptimizationLoop } from "./engine.ts"
// @ts-expect-error Native Node TypeScript tests require explicit extensions.
import { serializeListingOptimizationFiles } from "./output.ts"
import type { ListingOptimizationInput } from "./types.ts"

// @ts-expect-error Native Node TypeScript tests require explicit extensions.
export * from "./types.ts"
// @ts-expect-error Native Node TypeScript tests require explicit extensions.
export * from "./schema.ts"
// @ts-expect-error Native Node TypeScript tests require explicit extensions.
export * from "./engine.ts"
// @ts-expect-error Native Node TypeScript tests require explicit extensions.
export * from "./output.ts"

export function executeEbayListingOptimizationLoop(input: unknown, generatedAt = new Date()) {
  const validated = listingOptimizationInputSchema.parse(input) as unknown as ListingOptimizationInput
  const result = runListingOptimizationLoop(validated, generatedAt)
  return {
    result,
    files: serializeListingOptimizationFiles(result),
  }
}
