# Temporary generic seller OAuth reauthorization V1

Status: implementation gate only. Do not launch consent until the exact Preview
SHA, stable branch alias, Supabase ledger RPCs, and eBay Auth Accepted URL have
all been certified.

## Purpose and scope

This temporary helper obtains one replacement candidate for
`EBAY_SELLER_REFRESH_TOKEN` by reusing the existing Production eBay app, seller
binding, Client ID/Secret, and `EBAY_RuName`. It requests exactly:

- `https://api.ebay.com/oauth/api_scope`
- `https://api.ebay.com/oauth/api_scope/sell.inventory.readonly`
- `https://api.ebay.com/oauth/api_scope/sell.analytics.readonly`
- `https://api.ebay.com/oauth/api_scope/sell.account.readonly`

Fulfillment, Marketing, Inventory write, and every other scope are excluded.

## Authorization-request live preflight

The initial implementation serialized scope separators through
`URLSearchParams`, which emitted `+`. The established eBay consent builders in
this repository and eBay's documented examples use RFC 3986 `%20` separators.
The helper now uses one explicit `encodeURIComponent` serializer for the actual
authorization request and for its live preflight; `+`, double encoding, extra
parameters, and `prompt` are rejected.

Before any transaction state, ledger row, cookie, or browser redirect, an
authenticated Preview admin must run a non-interactive diagnostic. It probes
the same Production Client ID and the exact `EBAY_RuName`, without trying the
historical Commercial Orders RuName or any fallback, in these isolated stages:

1. base;
2. base + Account readonly;
3. base + Account readonly + Inventory readonly;
4. the full four-scope set;
5. the full set with a valid diagnostic state;
6. the same request using the retired `+` separator, for exact serialization
   isolation only.

The probe sends no cookie, authorization header, Client Secret, body, login, or
consent. It follows only the mandatory first eBay-owned routing hop from
`auth.ebay.com` to the byte-equivalent `auth2.ebay.com/oauth2/authorize`
request. It never follows a sign-in, consent, callback, error, or external
target. Each logical test has one three-second deadline across at most two eBay
GETs, tests run sequentially, and there are no retries, preserving function-
response headroom.

Only fixed classifications reach the UI. Client ID, RuName, state, full URL,
redirect Location, response body, provider error description, and provider
cookies are discarded. Network, timeout, unknown HTML, unrecognized redirect,
rate limit, or any ambiguous response fails closed.

The real start re-runs the complete diagnostic. It may create a PENDING state
only when every canonical `%20` scope phase and the canonical state request are
accepted, the RuName/app binding passes, the fixed runtime credential
fingerprints match, and all preflight safety counters remain zero. The retired
`+` request and `ROOT_CAUSE` are diagnostic only: an accepted `+` request or
`STILL_UNPROVEN` causal label cannot override or weaken the exact positive
conjunction. Therefore:

```text
AUTH_REQUEST_LIVE_PREFLIGHT = PASS
then CREATE_PENDING_STATE
then SET_COOKIE
then RETURN THE HUMAN REDIRECT
```

The separate diagnostic action creates zero ledger rows, sets zero cookies,
returns no authorization URL, redirects zero humans, and performs zero token
exchanges.

## Installed-runtime certification

After the human installs the replacement credential, the protected page has a
separate `certify_installed_runtime` action. It reads only the server-side
`EBAY_SELLER_REFRESH_TOKEN`; the request cannot supply a token or environment
override, and there is no Vault, candidate, Orders, or legacy fallback.

Successful certification performs exactly five bounded read-only eBay calls:
four-scope refresh, strict bound `GetUser`, Inventory locations, Analytics
traffic, and Account privilege. It creates no OAuth state, cookie, ledger row,
authorization URL, consent, code exchange, handoff, Supabase/Vault/Vercel
mutation, or marketplace write. Its JSON contains only fixed classifications,
sanitized call evidence, and zero-valued safety counters; neither refresh nor
access token can enter the response.

The same page also exposes the separate `diagnose_inventory_consumer` action.
It retains every Preview/branch/host/same-origin/human-admin/fixed-credential
gate, reads only the installed generic environment token, and executes at most
three sequential calls: refresh with exactly base + Inventory readonly,
strict bound `GetUser`, then the Commercial Monitor's exact
`GET /sell/inventory/v1/inventory_item?limit=50&offset=0` request. It never
calls offers, Analytics, Orders, Vault, ledger, callback, consent, or a writer.
The response contains only HTTP/content-type classifications, sorted safe
top-level property names, array/total/continuation presence and counts, a fixed
catalog-state enum, sanitized call/budget counters, and zero safety counters.
Raw JSON, SKUs, product data, URLs/query strings, credentials, headers, tokens,
cookies, and provider descriptions are discarded and never returned.

## Global one-time claim

The browser transaction uses a five-minute signed, Secure, HttpOnly,
SameSite=Lax cookie. The only durable data is a SHA-256 hash of the random state
plus `PENDING/CLAIMED`, version, and timestamps.

Before any authorization-code exchange, the callback invokes the single SQL
claim:

```text
PENDING --atomic conditional UPDATE...RETURNING--> CLAIMED
```

`CLAIMED` is terminal. There is no reset, retry, recovery, or completion state.
A crash, timeout, exchange failure, failed capability probe, or lost response
after the claim requires a completely new ceremony and state.

The table stores no raw state, OAuth code, token, cookie, client credential,
admin identity, seller identity, account key, PII, URL, or business data. Direct
table access is revoked; service-role can invoke only the create and atomic-claim
RPCs.

Expired metadata is opportunistically removed after seven days by a later
start. Cleanup deletes rows; it never changes `CLAIMED` back to `PENDING`.

## Candidate-only proof

After a successful claim, the callback performs at most six eBay calls, with no
retry:

1. authorization-code exchange;
2. candidate refresh using the exact four-scope union;
3. strict Trading `GetUser` (`UserID` and `Site` only);
4. Inventory `getInventoryLocations` scope probe;
5. Analytics `traffic_report` scope probe;
6. Account `getPrivileges` scope probe.

Only the newly issued candidate refresh token is accepted. The verifier has no
fallback to the existing `EBAY_SELLER_REFRESH_TOKEN`. `GetUser` must match the
configured Production fingerprint and optional expected UserID, and must return
an explicit US site. Authorized empty REST results are sufficient; business
data content is neither required nor retained.

The Vercel function ceiling is 30 seconds. The helper uses a 24-second internal
hard budget, stops external work at 21 seconds, and reserves three seconds for
the sanitized terminal response and cookie deletion. Its absolute network cap
is six calls. Ledger create/claim waits are independently capped at 1.5 seconds;
a claim that completes after the application timeout can only consume the state
and can never continue into an OAuth exchange.

## One-time handoff

Only after every capability succeeds may the callback render the refresh token
in one protected HTML response. The token is never placed in JSON, URL, query,
cookie, log, telemetry, Supabase, Vault, Vercel, source, GitHub, markdown, or the
filesystem by the helper. The response uses no-store/no-cache headers,
no-referrer, noindex, frame denial, and a restrictive CSP. Reload, replay, Back,
or a second callback cannot claim the state again at the server.

The operator must paste the value directly into a new Sensitive Preview
branch override for:

```text
EBAY_SELLER_REFRESH_TOKEN
feature/seller-os-canonical-integration-foundation-v1
```

The existing shared Preview value is not edited. Rollback deletes only that
branch override and redeploys. Before relying on isolation, Vercel metadata must
show the exact branch on that entry; `target=preview` with no branch is a shared
Preview variable and does not satisfy this rollback contract.

## Deployment and retirement

The additive Supabase migration must be applied to the authorized non-Production
runtime before the helper can start. GitHub/Vercel deployment does not apply the
migration automatically.

After successful token installation and read-only certification:

1. remove the temporary page, API route, domain/core/ledger adapters, tests, and
   this document;
2. apply a separate retirement migration that revokes/drops the two RPCs and
   drops `ebay_seller_oauth_reauth_state_ledger`;
3. remove the temporary eBay Auth Accepted URL mapping;
4. retain no state rows or token material;
5. keep PR, Production, Product Case, Registry, Vault, and marketplace write
   boundaries unchanged unless separately authorized.
