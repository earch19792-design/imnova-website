# Mayel: browsing during an eBay read outage

The operator reported that “Seleccionar todos los mostrados” did nothing. Preprod request logs returned HTTP 200 for the selector, while the stored current-LIVE authority reported CURRENT_UNAVAILABLE / EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518. The last certified cohort held 23 listings, observed 2026-09-09T18:50:03.817Z, with freshness ending at 19:10:03.817Z. The previous GET projected only current LIVE listings and the UI rendered the resulting empty list without an explanation.

The selector now reads the existing account-scoped authority and registry. It displays at most 20 exact identities per page and preserves the next cursor. A current unavailable state exposes the last certified listings for browsing only, labeled as waiting for verification. It never relabels historical listings as current LIVE. The existing POST current-LIVE guard remains unchanged.

Physical staging verification returned 20 + 3 listings, four bounded database reads and zero eBay calls. Selection can open saved title/SKU/verification date and an ordinary eBay listing link. Ambiguous registry representations do not supply an arbitrary SKU. Loading, empty, unavailable and request-error states are explicit. Retrying the selector performs database reads only. The four primary actions and existing Ayuda / Manual link are preserved.

No publication or Ads operation was executed. No poller, background worker or global scan was added. A physical iPad/browser pass has not been asserted. After installing the missing browser libraries locally under /tmp, the existing browser profile reached /admin/login; it did not share the operator’s current iPad session. The operator can verify the deployed screen in their existing authenticated session.

## Correction: existing image application capability

A subsequent bounded, read-only staging audit found two historical executions for Item ID 366643122092 on 6 September 2026, both APPLIED_AND_OFFICIALLY_VERIFIED, each with marketplace_write_count=1. The account's reusable visual delegation remains ACTIVE. These are prior operations, not writes performed in this closeout. See mayel-existing-visual-application-evidence-v1.json.

It is therefore incorrect to characterize Seller OS as having no proven ability to apply listing improvements. Image application already has successful durable evidence. This is specifically image capability, not certification of every field or advertising.

The current Revenue Engine route exposes ANALYZE/PREVIEW/SIMULATE/RECEIPT/MEASURE/IMAGE. Its IMAGE path creates draft variants; it does not hand those variants to the existing visual task/manifest executor. The established visual runtime consumes OWNER_PREVIEW_READY tasks with exact manifest bindings. The operator's existing workstation remains under the admin page's Ver detalles section. No old manual ChatGPT workflow was reintroduced into the primary menu, and no existing application authority was revoked or bypassed.

Two distinct limitations must remain explicit: current Trading availability is blocked by the observed quota; the new Revenue Engine's end-to-end handoff to the established image application flow is not certified. The successful historic executor must be preserved, not rebuilt or re-certified merely because the new menu lacks that handoff.
