# Mayel: browsing during an eBay read outage

The operator reported that “Seleccionar todos los mostrados” did nothing. Preprod request logs returned HTTP 200 for the selector, while the stored current-LIVE authority reported CURRENT_UNAVAILABLE / EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518. The last certified cohort held 23 listings, observed 2026-09-09T18:50:03.817Z, with freshness ending at 19:10:03.817Z. The previous GET projected only current LIVE listings and the UI rendered the resulting empty list without an explanation.

The selector now reads the existing account-scoped authority and registry. It displays at most 20 exact identities per page and preserves the next cursor. A current unavailable state exposes the last certified listings for browsing only, labeled as waiting for verification. It never relabels historical listings as current LIVE. The existing POST current-LIVE guard remains unchanged.

Physical staging verification returned 20 + 3 listings, four bounded database reads and zero eBay calls. Selection can open saved title/SKU/verification date and an ordinary eBay listing link. Ambiguous registry representations do not supply an arbitrary SKU. Loading, empty, unavailable and request-error states are explicit. Retrying the selector performs database reads only. The four primary actions and existing Ayuda / Manual link are preserved.

No publication or Ads operation was executed. No poller, background worker or global scan was added. A physical iPad/browser pass has not been asserted. After installing the missing browser libraries locally under /tmp, the existing browser profile reached /admin/login; it did not share the operator’s current iPad session. The operator can verify the deployed screen in their existing authenticated session.
