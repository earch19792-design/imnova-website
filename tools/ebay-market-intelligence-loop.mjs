import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import process from "node:process"

import {
  parseCompetitorListingsCsv,
  parseCompetitorListingsJson,
  parseMarketIntelligenceJson,
  runEbayMarketIntelligenceLoop,
} from "../lib/ebay/market-intelligence/index.ts"

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function usage() {
  process.stdout.write(
    "Usage: node tools/ebay-market-intelligence-loop.mjs --input input.json " +
    "[--competitors competitors.json|csv] [--output-dir output]\n",
  )
}

const inputPath = argument("--input")
const competitorsPath = argument("--competitors")
const outputDirectory = resolve(argument("--output-dir") ?? "market-intelligence-output")

if (!inputPath) {
  usage()
  process.exitCode = 1
} else if (!existsSync(inputPath)) {
  throw new Error("MARKET_INTELLIGENCE_INPUT_FILE_NOT_FOUND")
} else {
  const input = parseMarketIntelligenceJson(readFileSync(inputPath, "utf8"))
  if (competitorsPath) {
    if (!existsSync(competitorsPath)) throw new Error("MARKET_INTELLIGENCE_COMPETITORS_FILE_NOT_FOUND")
    const source = readFileSync(competitorsPath, "utf8")
    input.competitorListings = extname(competitorsPath).toLowerCase() === ".csv"
      ? parseCompetitorListingsCsv(source)
      : parseCompetitorListingsJson(source)
  }
  const result = runEbayMarketIntelligenceLoop(input)
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(join(outputDirectory, "report.json"), result.files["report.json"], "utf8")
  writeFileSync(join(outputDirectory, "report.md"), result.files["report.md"], "utf8")
  process.stdout.write(`Saved report.json and report.md in ${outputDirectory}\n`)
}
