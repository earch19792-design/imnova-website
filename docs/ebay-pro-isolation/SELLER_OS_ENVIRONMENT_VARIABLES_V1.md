# Seller OS V1 environment inventory

No values belong in this document. `false`, an empty value, and a missing
variable are intentionally fail-closed unless a different safe default is
listed. The authenticated read-only preflight is
`GET /api/admin/ebay/configuration/preflight`; it returns status enums only.

Status enums: `PRESENT`, `MISSING`, `INVALID_FORMAT`, `IDENTITY_UNBOUND`,
`SCOPE_NOT_VERIFIED`.

## Read-only eBay and Analytics

| Variable | Purpose | Secret | Environment / scope | Safe default | Consumers and inheritance risk |
|---|---|---:|---|---|---|
| `EBAY_CLIENT_ID` | OAuth client for seller reads | No | Preview/Production; official eBay app | Missing blocks | Trading, Inventory read-only and Analytics share it |
| `EBAY_CLIENT_SECRET` | OAuth client secret | Yes | Server only | Missing blocks | Shared by all generic seller-read gateways |
| `EBAY_SELLER_REFRESH_TOKEN` | Official seller authorization | Yes | Server only; must include each required read scope | Missing blocks; preflight reports `SCOPE_NOT_VERIFIED` | A token from another account must never be inherited |
| `EBAY_SELLER_ACCOUNT_KEY` | Human-readable account alias | No | Server; `A-Za-z0-9._-`, max 80 | Missing blocks account-scoped workflows | Combined with the verified identity fingerprint |
| `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID` | Expected official seller identity | Sensitive | Server/Preview and read-only verification | Missing requires a valid fingerprint | Shared identity binding for manual listing, sync and Production target |
| `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT` | Preferred 64-hex expected identity fingerprint | Sensitive | Server | Missing falls back to account fingerprint alias or User ID derivation | Takes precedence over `...EXPECTED_ACCOUNT_FINGERPRINT` |
| `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT` | Compatibility alias for expected fingerprint | Sensitive | Server | Missing is safe if preferred name/User ID binds identity | Lower precedence; avoid defining both differently |

The generic refresh token is reused for Trading, Inventory read-only and
Analytics. Scope and account identity must both be verified; presence alone is
not proof of authorization.

## Draft Sandbox

| Variable | Purpose | Secret | Environment / scope | Safe default | Consumers and precedence |
|---|---|---:|---|---|---|
| `EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID` | Sandbox OAuth client | No | Development/Preview | Missing blocks | Draft gateway only |
| `EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET` | Sandbox OAuth secret | Yes | Server only | Missing blocks | Draft gateway only |
| `EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN` | Sandbox seller authorization | Yes | Server; Inventory write/account read scopes | Missing blocks; scope not inferred | Never falls back to generic or Production token |
| `EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID` | Expected Sandbox seller | Sensitive | Server | Missing requires fingerprint | Identity preflight |
| `EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_CREDENTIAL_FINGERPRINT` | Preferred Sandbox fingerprint | Sensitive | Server; 64 lowercase hex | Missing uses compatibility alias/User ID | Higher precedence |
| `EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT` | Compatibility fingerprint alias | Sensitive | Server | Missing allowed if identity otherwise bound | Lower precedence |
| `EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_HMAC_SECRET` | Preferred approval snapshot HMAC | Yes | Server; at least 32 characters | Missing blocks execution | Higher precedence |
| `EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET` | Compatibility HMAC alias | Yes | Server | Missing allowed if preferred HMAC exists | Lower precedence |

## Draft Production target

“Production target” means eBay Production credentials used from an authorized
Vercel Preview. A Vercel Production deployment is always blocked.

| Variable | Purpose | Secret | Environment / scope | Safe default | Consumers and precedence |
|---|---|---:|---|---|---|
| `EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID` | Isolated Production OAuth client | No | Authorized Preview only | Missing blocks | Never falls back to generic/Sandbox |
| `EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET` | Isolated Production OAuth secret | Yes | Server/Preview | Missing blocks | Draft gateway only |
| `EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN` | Isolated Production draft authorization | Yes | Authorized Preview; Inventory write scopes | Missing blocks | Never inherited from read-only token |
| `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID` | Expected Production seller | Sensitive | Server/Preview | Missing requires fingerprint | Also binds official read account |
| `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT` | Preferred Production fingerprint | Sensitive | Server/Preview; 64 lowercase hex | Missing uses compatibility alias/User ID | Higher precedence |
| `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT` | Compatibility fingerprint alias | Sensitive | Server/Preview | Missing allowed if otherwise bound | Lower precedence |
| `EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_HMAC_SECRET` | Preferred Production snapshot HMAC | Yes | Server/Preview; at least 32 characters | Missing blocks | Higher precedence |
| `EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET` | Compatibility HMAC alias | Yes | Server/Preview | Missing allowed if preferred HMAC exists | Lower precedence |
| `EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED` | Target-specific kill switch | No | Preview only | `false` | Must be true in addition to master flag |
| `EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH` | Exact authorized branch | No | Preview | Missing blocks | Compared byte-for-byte with Git ref |
| `EBAY_DRAFT_ONLY_WRITES_ENABLED` | Master draft-write switch | No | Development/Preview | `false` | Does not enable `publishOffer` |
| `EBAY_DRAFT_ONLY_TARGET` | `SANDBOX` or `PRODUCTION` | No | Server | `SANDBOX` | Invalid values fail closed |
| `VERCEL_ENV` | Deployment class | No | Vercel-managed | Missing is not Production authorization | Production target requires exactly `preview` |
| `VERCEL_GIT_COMMIT_REF` | Deployment branch | No | Vercel-managed Preview | Missing blocks Production target | Must exactly equal allowed branch |

## Supabase

| Variable | Purpose | Secret | Environment / scope | Safe default | Consumers / risk |
|---|---|---:|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project API URL | No | Browser and server | Missing blocks | Preview must point only to staging for the pilot |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Auth/RLS key | Public credential | Browser and server auth validation | Missing blocks Admin auth | Must match the URL project |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only operational access | Yes | Server only | Missing blocks | Never expose to browser or reuse across projects |

## Cron and runtime

| Variable | Purpose | Secret | Environment / scope | Safe default | Consumers / risk |
|---|---|---:|---|---|---|
| `CRON_SECRET` | Bearer protection for scheduled routes | Yes | Production server; at least 16 chars | Missing denies cron | Shared by the two existing cron routes |
| `EBAY_PRO_RUNTIME` | Explicit environment isolation | No | All server deployments | Inferred fail-closed in Production | `production`/`production_core` block Seller OS |
| `EBAY_MARKETPLACE_INSIGHTS_ENABLED` | Enable marketplace read intelligence | No | Server | `false` | Read subsystem only |
| `EBAY_MARKET_OBSERVATION_WRITES_ENABLED` | Persist market observations | No | Server | `false` | Database writes, never eBay writes |
| `EBAY_LUNA_BEST_SELLING_CATEGORY_IDS` | Category allowlist | No | Server | Empty | Comma-separated numeric category IDs |

## Images

| Variable | Purpose | Secret | Environment / scope | Safe default | Consumers / risk |
|---|---|---:|---|---|---|
| `EBAY_IMAGE_SOURCE_HOSTS` | Additional authorized remote image hosts | No | Server | Built-in Luna/Shopify hosts only | Adding a host expands the download trust boundary |

Image storage also requires the three Supabase variables. No public bucket
credential is accepted from the client.

## Seller WhatsApp

| Variable | Purpose | Secret | Environment / scope | Safe default | Consumers / inheritance risk |
|---|---|---:|---|---|---|
| `EBAY_SELLER_WHATSAPP_ENABLED` | Seller delivery kill switch | No | Non-Production Seller OS runtime | `false` | Real delivery remains blocked in Production core |
| `EBAY_SELLER_WHATSAPP_RECIPIENT` | E.164-like recipient | Sensitive | Server | Missing blocks | One account/operator destination |
| `EBAY_SELLER_WHATSAPP_TEMPLATE_NAME` | Immediate approved template | No | Server | Missing blocks | Must pass Meta preflight |
| `EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME` | Digest approved template | No | Server | Missing blocks | Must pass Meta preflight |
| `EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE` | Exact template language | No | Server | `es` | Must match Meta approval |
| `EBAY_SELLER_WHATSAPP_DIGEST_HOUR_UTC` | Digest hour | No | Server | Application default | Integer 0–23 |
| `EBAY_SELLER_COMMAND_CENTER_URL` | Link rendered in messages | No | Server; HTTPS | Missing blocks complete configuration | Never accept credentials in URL |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API token | Yes | Server only | Missing blocks | Shared with non-Seller WhatsApp code; inheritance risk |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta sender phone ID | Sensitive | Server | Missing blocks | Shared global namespace |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta business account ID | Sensitive | Server | Missing blocks | Shared global namespace |

## Safe inheritance rules

1. Sandbox never inherits Production or generic credentials.
2. Production draft credentials never inherit the generic read-only token.
3. `...EXPECTED_CREDENTIAL_FINGERPRINT` wins over the compatibility
   `...EXPECTED_ACCOUNT_FINGERPRINT` alias.
4. `...PREFLIGHT_HMAC_SECRET` wins over the compatibility
   `...PREFLIGHT_SNAPSHOT_SECRET` alias.
5. Defining both an alias and its preferred name with different values is an
   invalid operational configuration even though only the preferred value is
   consumed.
6. Flags default to false. Presence of credentials never enables a write.
