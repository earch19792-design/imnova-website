# eBay Sandbox OAuth V1

## Why

LOOP 148 introduces the secure eBay Sandbox OAuth layer needed before any Sandbox draft work can start. It prepares authorization URL creation, callback parsing, and a gated token exchange path without touching Production or creating listings.

## Current State

- Production remains frozen and Core-only.
- eBay Pro remains isolated in PRE/Staging.
- LOOP 147 completed Image Package Workflow.
- The user has an eBay Developer Sandbox keyset, but keys must stay outside code, docs, prompts, logs, and commits.
- Draft creation and publication remain blocked.

## What Sandbox OAuth Does

- Defines Sandbox OAuth endpoints and default scopes.
- Validates local Sandbox OAuth configuration.
- Builds an eBay Sandbox authorization URL.
- Parses callback URL or authorization code locally.
- Prepares token exchange against eBay Sandbox only.
- Sanitizes reports so secrets, authorization codes, and tokens are never printed in full.
- Allows optional token output only under `/tmp` with an explicit CLI flag.

## What It Does Not Do

- It does not call eBay Production.
- It does not create eBay drafts.
- It does not publish listings.
- It does not write to Staging.
- It does not use Supabase, WhatsApp real send, OpenAI, image generation, uploads, scrapers, downloads, migrations, db push, db pull, deploys, or env file changes.
- It does not commit or print secrets.

## Required Local Env Vars

For local real execution, values must be exported temporarily outside the repo:

- `EBAY_OAUTH_TARGET_ENV=sandbox`
- `EBAY_SANDBOX_CLIENT_ID`
- `EBAY_SANDBOX_CLIENT_SECRET` for token exchange only
- `EBAY_SANDBOX_RUNAME`
- `EBAY_SANDBOX_SCOPES` optional
- `EBAY_SANDBOX_AUTH_CODE` optional for exchange
- `EBAY_SANDBOX_CALLBACK_URL` optional for parsing a full callback URL
- `EBAY_SANDBOX_OAUTH_APPROVED=APPROVE_LOOP_148_EBAY_SANDBOX_OAUTH`

Do not save these values in `.env*` during this loop.

## How To Build Sandbox Authorization URL

Use `--build-auth-url` with `EBAY_OAUTH_TARGET_ENV=sandbox`, `EBAY_SANDBOX_CLIENT_ID`, `EBAY_SANDBOX_RUNAME`, and the exact approval phrase. This mode does not need client secret and does not call eBay.

The authorization endpoint must be:

`https://auth.sandbox.ebay.com/oauth2/authorize`

## How To Parse Callback

Use `--parse-callback` with either `EBAY_SANDBOX_CALLBACK_URL` or `EBAY_SANDBOX_AUTH_CODE`. The CLI reports whether an auth code is present, but it redacts the code.

## How To Exchange Token Safely

Use `--exchange-token` only with:

- `EBAY_OAUTH_TARGET_ENV=sandbox`
- `EBAY_SANDBOX_CLIENT_ID`
- `EBAY_SANDBOX_CLIENT_SECRET`
- `EBAY_SANDBOX_RUNAME`
- `EBAY_SANDBOX_AUTH_CODE`
- exact LOOP 148 approval phrase

The token endpoint must be:

`https://api.sandbox.ebay.com/identity/v1/oauth2/token`

The CLI may use `fetch` only for this Sandbox token exchange path.

## Why Secrets/Tokens Never Go To Repo

Client secrets, auth codes, access tokens, and refresh tokens are runtime-only. Reports show SET/MISSING or redacted previews. Token files are not stored by default. If token storage is explicitly requested, the output path must be under `/tmp`.

## Why Production OAuth Is Blocked

Production OAuth endpoints are exported only so tests and validation can reject them. LOOP 148 is Sandbox-only. Production API, Production OAuth, real drafts, and publication remain blocked.

## Token Handling Rules

- Do not print client secret.
- Do not print full auth code.
- Do not print access token.
- Do not print refresh token.
- Do not write token files inside the repository.
- Optional token output must be `/tmp/...` and should use file mode `600`.

## No Draft/Publication In LOOP 148

OAuth readiness does not authorize draft creation or publication. LOOP 149 is the first Sandbox Draft Listing step, and Production remains off-limits.

## How This Feeds LOOP 149 Sandbox Draft Listing

LOOP 149 can use the sanitized Sandbox OAuth readiness output and optional local `/tmp` token file to prepare a Sandbox draft flow. It must continue to keep Production blocked.

## Safety Boundaries

- No Production writes.
- No Staging writes.
- No Supabase writes or SQL.
- No eBay Production API.
- No draft creation.
- No publication.
- No WhatsApp real send.
- No OpenAI, image generation, uploads, scrapers, downloads, migrations, db push, db pull, deploys, or env file changes.

## Definition Of Done Applied

This loop is limited to eBay Sandbox OAuth, includes tests, includes dry-run output, validates blocked Production behavior, reports numeric/sanitized outputs, and keeps drafts/publication blocked.

## Human Explanation Rule Applied

The final report must explain what changed, why it changed, what problem it solves, what was protected, what changed materially, what was not touched, how this moves IMNOVA toward eBay sales, and the exact next loop.

## Next Step

149 — eBay Sandbox Draft Listing
