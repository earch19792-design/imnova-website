# Active listing sync — pilot runbook

## Pilot strategy

The active-listing sync is manual and Admin-authenticated. It is not declared
in `vercel.json` and has no `CRON_SECRET` execution path.

Run it:

1. immediately after a manual Item ID is registered and verified;
2. before every operational review of stock, cost, mapping or listing status;
3. after changing or ending the listing in Seller Hub.

The Command Center displays the last start, last success, last error and any
active lease. A second execution receives
`EBAY_ACTIVE_LISTING_SYNC_ALREADY_RUNNING` until the current lease finishes or
expires. Snapshot generations still prevent a delayed worker from resurrecting
an older listing state.

## Future compatible-plan strategy

After the pilot, a plan that supports the required interval may invoke:

```text
POST /api/admin/ebay/active-listings/sync
```

through a dedicated server-to-server Admin identity. Do not reuse the browser
session and do not restore the previous GET-with-`CRON_SECRET` execution path.
The recommended starting interval is every 30–60 minutes, with observability
for duration, pagination and expired leases before increasing frequency.

No cron is activated by this runbook. The existing schedules remain unchanged:

- `market-radar-luna-sync`: `0 9 * * *`
- `ebay-luna-opportunity-scan`: `17 9 * * *`
