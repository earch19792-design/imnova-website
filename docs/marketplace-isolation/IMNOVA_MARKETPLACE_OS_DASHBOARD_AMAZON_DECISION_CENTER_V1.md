# IMNOVA Marketplace OS Dashboard + Amazon Decision Center V1

## Why

LOOP 149UI makes the Marketplace Seller OS visible inside the IMNOVA admin app. The Amazon Track has local decision engines from 149A through 149F, but operators need a readable dashboard that explains product status, route, risk, profitability, blockers, and next actions.

## Current State

eBay Track remains paused/YELLOW operational because the eBay seller account is unresolved. Amazon Track is active as a local decision layer. Production remains frozen and Core-only. The dashboard is read-only and uses sanitized local data.

## Problem Solved

Before this dashboard, the local engines existed as modules, tests, fixtures, and CLI dry-runs. The dashboard converts those decisions into an operator-facing view so the team can see what is blocked, what is watchlisted, what needs human review, and why no product is ready for listing package yet.

## Internal Engine vs Visual Center

The internal engine calculates decisions. The visual center explains them. This page does not replace Seller Central, does not connect to Amazon, and does not execute marketplace actions.

## eBay Track

The dashboard shows eBay as `PAUSED_YELLOW_OPERATIONAL`, with the current foundation at LOOP 149 and the next action to resolve the eBay account before LOOP 150.

## Amazon Track

The dashboard shows Amazon as `ACTIVE_LOCAL_DECISION_ENGINE`, with completed loops 149A, 149B, 149C, 149D, 149E, and 149F. It points to 149G as the next build step.

## 149A–149F Summary

- 149A: Product winner metrics and listing readiness.
- 149B: Seller account setup checklist and category gate.
- 149C: Luna Portex to Amazon catalog matcher.
- 149D: Restriction, category, brand, and GTIN gate.
- 149E: Fees, profit guard, and ROI.
- 149F: Existing ASIN vs new ASIN decision engine.

## DM0628N Interpretation

DM0628N has strong brand/model/size evidence and a match confidence of 97. It has positive ROI, but remains `WATCHLIST_EXISTING_ASIN` because hazmat, chemical, manual Seller Central eligibility, and margin review are unresolved. It cannot proceed to Amazon Listing Package.

## Why No APIs

This loop does not use Amazon API, SP-API, Supabase writes, eBay Production API, WhatsApp, OpenAI, or scrapers. It is a local UI over sanitized data.

## Why Nothing Is Published

No product is published, no ASIN is created, no listing is created, and no Seller Central write is executed. The page is read-only and the roadmap controls are disabled previews.

## WhatsApp and Automation Roadmap

WhatsApp Remote Control and Marketplace Automation are shown only as planned roadmap items. No real WhatsApp send or marketplace automation is active in this loop.

## Codex Self-Improvement Roadmap

IMNOVA Self-Improvement Engine is the planned layer where IMNOVA OS detects internal improvement opportunities from dashboard state, dry-runs, tests, blockers, and operator decisions.

Codex Handoff Layer is the planned bridge that converts those opportunities into safe work orders and prompts for Codex. It does not execute code by itself. It produces reviewable instructions, expected files, validation commands, safety boundaries, and rollback notes for a human to approve.

The intended flow is:

- IMNOVA detects a gap, blocker, or improvement opportunity.
- IMNOVA creates a Self-Improvement Backlog item.
- IMNOVA generates a Codex handoff prompt/work order.
- A human reviews and approves before any implementation starts.
- Codex works in a safe feature branch.
- Tests and PR checks run before any merge decision.
- A human decides whether to merge.

Human approval is mandatory because marketplace automation can affect product eligibility, seller account health, legal/compliance posture, and production safety. The dashboard must never turn an internal suggestion into an automatic code change, branch write, PR merge, Seller Central action, marketplace publication, or Production change.

LOOP 149UI does not connect Codex API. It only displays the roadmap as `ROADMAP_ONLY_NO_API`. The future API path is gated behind explicit later work because prompts must not contain secrets, tokens, customer-sensitive data, marketplace credentials, or uncontrolled production instructions.

Planned sequence:

- 149CODEX-A — Self-Improvement Backlog + Codex Handoff Builder.
- 149CODEX-B — Codex API Connection Layer + Safe Execution Gate.
- Then 149G — Amazon Listing Package Builder.

## How This Feeds 149G

149G can use this operator view as context for the Amazon Listing Package Builder. Products should only continue to package building after route, eligibility, restriction, compliance, and profit gates are resolved.

## Safety Boundaries

- No Production writes.
- No Staging DB writes.
- No Supabase writes.
- No Amazon API or SP-API.
- No Seller Central write.
- No ASIN creation.
- No listing creation.
- No publication.
- No eBay Production API.
- No WhatsApp real send.
- No OpenAI or image generation.
- No Codex API.
- No automatic code changes.
- No automatic merge.
- No scraper.
- No `.env` changes, secrets, tokens, dumps, backups, uploads, downloads, or migrations.

## Definition of Done

The loop is done when the admin route renders the dashboard, the local view model builds, the dry-run summary passes, tests validate the safety flags and product rows, TypeScript passes, and existing Amazon/eBay/Luna regressions remain green.

## Human Explanation Rule

Every product row should explain route, confidence, ROI, net profit, blocker reasons, warnings, and the next human action in plain language.

## Next Step

Recommended strategic step: 149CODEX-A — Self-Improvement Backlog + Codex Handoff Builder.

Then continue Amazon: 149G — Amazon Listing Package Builder.
