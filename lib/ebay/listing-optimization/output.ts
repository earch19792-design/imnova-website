import type { ListingOptimizationResult } from "./types.ts"

export function renderFinalListingMarkdown(result: ListingOptimizationResult) {
  const draft = result.listingDraft
  return `# Final eBay Listing Draft

> Human review required. This file does not publish to eBay.

## Title

${draft.title}

## Subtitle

${draft.subtitle ?? "None"}

## Price

${draft.price}

## Category

${draft.category || "BLOCKED: category required"}

## Item Specifics

${Object.entries(draft.itemSpecifics).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Description

${draft.description}

## Shipping

${draft.shippingPolicy}

## Returns

${draft.returnPolicy}

## Review

- Score: ${result.review.score.total}/100
- Stop reason: ${result.stopReason}
- Blocking issues: ${result.review.blockingIssues.length}
- Warnings: ${result.review.warnings.length}
- eBay write used: no
`
}

export function serializeListingOptimizationFiles(result: ListingOptimizationResult) {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
  return {
    "listing-draft.json": json(result.listingDraft),
    "listing-review.json": json(result.review),
    "image-brief.json": json(result.imageBrief),
    "experiment-plan.json": json(result.experimentPlan),
    "optimization-history.json": json(result.optimizationHistory),
    "final-listing.md": renderFinalListingMarkdown(result),
  }
}
