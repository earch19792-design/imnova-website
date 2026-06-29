#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildListingProposalFromCandidate,
} from "../lib/ebay-winner-pipeline/listing-proposal-generator.mjs"
import {
  evaluateListingProposalQa,
} from "../lib/ebay-winner-pipeline/listing-proposal-qa-runner.mjs"

function isPlainObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
}

function fail(message) {
  throw new Error(message)
}

function formatList(items = []) {
  return items.length > 0
    ? items.join(", ")
    : "none"
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

export function normalizeDryRunInput(input) {
  if (!isPlainObject(input)) {
    fail("Dry-run input must be an object.")
  }

  if ("candidate" in input) {
    if (!isPlainObject(input.candidate)) {
      fail("Input candidate must be an object.")
    }

    return {
      caseId:
        input.caseId || "manual",
      name:
        input.name || "Manual listing candidate",
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
      input.name || "Manual listing candidate",
    candidate:
      input,
    expected:
      null,
  }
}

export function selectDryRunCases(input, options = {}) {
  const caseId =
    options.caseId || null
  const all =
    options.all === true

  if (Array.isArray(input)) {
    if (all) {
      return input.map(normalizeDryRunInput)
    }

    const match =
      input.find(item =>
        item?.caseId === caseId
      )

    if (!match) {
      fail(`Case not found: ${caseId}`)
    }

    return [
      normalizeDryRunInput(match),
    ]
  }

  const normalized =
    normalizeDryRunInput(input)

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

export function runListingProposalDryRun(caseEntry) {
  if (!caseEntry || !isPlainObject(caseEntry.candidate)) {
    fail("Dry-run case is missing candidate.")
  }

  const proposal =
    buildListingProposalFromCandidate(
      caseEntry.candidate,
      {
        sourceCaseId:
          caseEntry.caseId,
        sourceType:
          "listing_proposal_dry_run",
        selectionDecision:
          caseEntry.candidate.selectionDecision || "approve",
        selectionState:
          caseEntry.candidate.selectionState || "APPROVED_FOR_DRAFT",
      }
    )

  const qa =
    evaluateListingProposalQa(proposal)

  return {
    caseEntry,
    proposal,
    qa,
  }
}

export function formatDryRunSummary(result) {
  const {
    caseEntry,
    proposal,
    qa,
  } = result

  const listingProposal =
    proposal.listingProposal || {}
  const review =
    proposal.review || {}
  const safety =
    proposal.safety || {}

  return [
    "eBay Listing Proposal Dry Run",
    `Case: ${caseEntry.caseId} - ${caseEntry.name}`,
    "",
    "Listing:",
    `- Schema: ${proposal.schemaVersion}`,
    `- Listing state: ${review.listingState}`,
    `- Title: ${listingProposal.title?.value || "n/a"}`,
    `- Advisory only: ${listingProposal.advisoryOnly === true}`,
    `- Human review required: ${listingProposal.humanReviewRequired === true}`,
    "",
    "QA:",
    `- Schema: ${qa.schemaVersion}`,
    `- QA state: ${qa.qaState}`,
    `- Missing data: ${formatList(qa.missingData)}`,
    `- Risk flags: ${formatList(qa.riskFlags)}`,
    `- Blocked reasons: ${formatList(qa.blockedReasons)}`,
    `- Required human actions: ${formatList(qa.requiredHumanActions)}`,
    "",
    "Safety:",
    `- Marketplace API used: ${safety.ebayApiUsed === true}`,
    `- Real draft created: ${safety.realDraftCreated === true}`,
    `- Live listing created: ${safety.publishedToEbay === true}`,
    `- Listing mutated: ${safety.listingMutated === true}`,
  ].join("\n")
}

export function runCli(argv = process.argv.slice(2)) {
  const args =
    parseArgs(argv)
  const input =
    loadJsonFile(args.file)
  const caseEntries =
    selectDryRunCases(input, {
      caseId:
        args.caseId,
      all:
        args.all,
    })

  return caseEntries
    .map(caseEntry =>
      formatDryRunSummary(
        runListingProposalDryRun(caseEntry)
      )
    )
    .join("\n\n")
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
