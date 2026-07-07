# eBay Pro Staging Workstream PRE-139

## Why

PRE-139 freezes the operating structure for eBay Professional Seller OS before execution resumes. The goal is to move quickly without weakening Production, mixing workstreams, or using marketplace credentials before the official authorization loop.

## Current State

- LOOP 136, LOOP 137, and LOOP 138 are integrated.
- Production is clean and Core-only.
- eBay Pro is blocked in Production.
- Staging is reserved for eBay Pro work.
- Local work remains dry-run and development only.
- The eBay Developer Sandbox keyset has been created by the operator.
- The Sandbox keyset must not be used until LOOP 148 — eBay Sandbox OAuth.

## Production Frozen Rule

Production is frozen for eBay Pro. No eBay Pro activation, writes, credentials, marketplace actions, listing drafts, OAuth, messaging delivery, or staging experiments are allowed in Production.

Production remains Core-only unless a future checkpoint explicitly approves a change.

## PRE/Staging Workstream Rule

eBay Pro work happens in PRE/Staging only. Staging is the eBay Pro workshop for guarded implementation, dry-runs, controlled approvals, and later Sandbox integration.

Local execution is dry-run/dev only. Local work may validate pure modules, fixtures, documentation, and static tests, but it must not connect to live systems.

## Future Base Branch

Future eBay Pro base branch:

`staging/ebay-pro-seller-os`

## Main Stability Rule

`main` stays stable. eBay Pro workstream merges into `main` are not allowed unless a checkpoint is explicitly approved.

## Credential And Write Rules

- No eBay keys in Production.
- No Production writes.
- No Production eBay Pro activation.
- No Staging database writes unless the current loop explicitly authorizes them.
- No OAuth or token use before LOOP 148.
- No real WhatsApp delivery unless the current loop explicitly authorizes it.
- No Supabase write, SQL, migration, or schema change unless the current loop explicitly authorizes it.
- No `.env*` creation or modification.

## Workshop Boundary

Staging is the eBay Pro workshop. Production is not the workshop. Local is not a live integration environment.

## Next Loop

139 — Execution Harness con candado
