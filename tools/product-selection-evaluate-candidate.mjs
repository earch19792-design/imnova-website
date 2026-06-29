#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  evaluateProductSelectionCandidate,
} from "../lib/ebay-winner-pipeline/product-selection-decision-service.mjs"

function isPlainObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
}

function fail(message) {
  throw new Error(message)
}

export function parseArgs(argv = []) {
  const args = {
    file:
      null,
    caseId:
      null,
    all:
      false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item =
      argv[index]

    if (item === "--file") {
      args.file =
        argv[index + 1] || null
      index += 1
    } else if (item === "--case") {
      args.caseId =
        argv[index + 1] || null
      index += 1
    } else if (item === "--all") {
      args.all =
        true
    } else {
      fail(`Unknown argument: ${item}`)
    }
  }

  if (!args.file) {
    fail("Missing required --file argument.")
  }

  if (!args.caseId && !args.all) {
    fail("Pass --case <caseId> or --all.")
  }

  if (args.caseId && args.all) {
    fail("Use either --case or --all, not both.")
  }

  return args
}

export function loadJsonFile(filePath) {
  const resolvedPath =
    path.resolve(filePath)

  if (!fs.existsSync(resolvedPath)) {
    fail(`JSON file not found: ${filePath}`)
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        resolvedPath,
        "utf8"
      )
    )
  } catch (error) {
    fail(
      `Invalid JSON file: ${filePath}. ${error.message}`
    )
  }
}

export function normalizeCandidateInput(input) {
  if (!isPlainObject(input)) {
    fail("Candidate input must be an object.")
  }

  if ("candidate" in input) {
    if (!isPlainObject(input.candidate)) {
      fail("Input candidate must be an object.")
    }

    return {
      caseId:
        input.caseId || "manual",
      name:
        input.name || "Manual candidate",
      candidate:
        input.candidate,
      expected:
        input.expected || null,
    }
  }

  return {
    caseId:
      input.caseId || "manual",
    name:
      input.name || "Manual candidate",
    candidate:
      input,
    expected:
      null,
  }
}

export function selectCandidateCases(input, options = {}) {
  const caseId =
    options.caseId || null
  const all =
    options.all === true

  if (Array.isArray(input)) {
    if (all) {
      return input.map(normalizeCandidateInput)
    }

    const match =
      input.find(item =>
        item?.caseId === caseId
      )

    if (!match) {
      fail(`Case not found: ${caseId}`)
    }

    return [
      normalizeCandidateInput(match),
    ]
  }

  const normalized =
    normalizeCandidateInput(input)

  if (
    caseId &&
    normalized.caseId !== "manual" &&
    normalized.caseId !== caseId
  ) {
    fail(`Case not found: ${caseId}`)
  }

  return [
    normalized,
  ]
}

function formatMoney(value) {
  return typeof value === "number"
    ? `$${value.toFixed(2)}`
    : "n/a"
}

function formatPercent(value) {
  return typeof value === "number"
    ? `${value.toFixed(2)}%`
    : "n/a"
}

export function formatEvaluationSummary(caseEntry, evaluation) {
  const riskFlags =
    evaluation.riskFlags?.length > 0
      ? evaluation.riskFlags
          .map(flag => flag.code)
          .join(", ")
      : "none"

  return [
    "Product Selection Evaluation",
    `Case: ${caseEntry.caseId} - ${caseEntry.name}`,
    `Decision: ${evaluation.decision}`,
    `State: ${evaluation.state}`,
    `Main reason: ${evaluation.mainReason}`,
    `Risk flags: ${riskFlags}`,
    `Next human action: ${evaluation.nextHumanAction}`,
    "Key numbers:",
    `- estimated price: ${formatMoney(caseEntry.candidate.estimatedEbayPrice)}`,
    `- estimated profit: ${formatMoney(evaluation.keyNumbers.netProfit)}`,
    `- ROI: ${formatPercent(evaluation.keyNumbers.roiPercent)}`,
    `- net margin: ${formatPercent(evaluation.keyNumbers.netMarginPercent)}`,
    `- estimated fees: ${formatMoney(evaluation.keyNumbers.estimatedEbayFees)}`,
    `- estimated shipping: ${formatMoney(evaluation.keyNumbers.estimatedShippingCost)}`,
    `Advisory only: ${evaluation.advisoryOnly === true}`,
  ].join("\n")
}

export function evaluateCandidateCases(caseEntries = []) {
  return caseEntries.map(caseEntry => ({
    caseEntry,
    evaluation:
      evaluateProductSelectionCandidate(
        caseEntry.candidate
      ),
  }))
}

export function runCli(argv = process.argv.slice(2)) {
  const args =
    parseArgs(argv)
  const input =
    loadJsonFile(args.file)
  const caseEntries =
    selectCandidateCases(input, {
      caseId:
        args.caseId,
      all:
        args.all,
    })

  const summaries =
    evaluateCandidateCases(caseEntries)
      .map(({ caseEntry, evaluation }) =>
        formatEvaluationSummary(
          caseEntry,
          evaluation
        )
      )

  return summaries.join("\n\n")
}

const currentFile =
  fileURLToPath(import.meta.url)

if (process.argv[1] === currentFile) {
  try {
    console.log(runCli())
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  }
}
