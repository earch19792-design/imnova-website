import { runEbayOpenAiFiveProductShadowFixture } from
  "../lib/ebay/ebay-openai-intelligence-gateway.ts"

const result = await runEbayOpenAiFiveProductShadowFixture({
  timeoutProductIndex: 3,
})

console.log(JSON.stringify(result, null, 2))

if (
  result.products !== 5
  || result.completed !== 4
  || result.isolated !== 1
  || result.realOpenAiCalls !== 0
  || result.stateMutations !== 0
  || result.ebayWrites !== 0
) {
  process.exitCode = 1
}
