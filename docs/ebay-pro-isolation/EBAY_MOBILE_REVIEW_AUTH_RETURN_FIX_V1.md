# EBAY Mobile Review Auth Return Fix V1

## Problem

`/admin/ebay/mobile-review` correctly detected a missing Supabase session as `AUTH_REQUIRED`, but the only available recovery action was to retry the Radar read. A retry cannot create an admin session, so a user opening the route directly could not continue to the login flow.

## Correction

- `AUTH_REQUIRED` now displays an explicit `Iniciar sesión` link.
- The link sends the internal destination as `returnTo=/admin/ebay/mobile-review`.
- After a successful admin sign-in, the login page returns to the validated internal admin destination.
- Radar empty/request failures continue to show `Reintentar lectura` instead of a login action.
- Unsafe, external or malformed `returnTo` values fall back to `/admin`.

## Safety

- Existing Supabase admin authentication remains unchanged.
- No credentials, tokens or session values are logged or persisted by this fix.
- No Supabase database write.
- No eBay API or write.
- No publication capability.
- `canPublish` remains false in Mobile Review.
