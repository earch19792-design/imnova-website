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
branch override and redeploys.

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
