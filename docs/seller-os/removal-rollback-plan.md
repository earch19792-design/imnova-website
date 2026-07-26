# Seller OS legacy-removal rollback plan

Scope: staging branch `feature/centralize-ebay-mobile-center` only.

1. Identify the isolation commit and revert that commit through a new reviewed commit; do not reset the branch or database.
2. Restore only a route explicitly proven to be required by Seller OS. Do not restore the public community, store, signup, voting, Idea Lab or campaign APIs as a group.
3. Run the domain-isolation and navigation tests before redeploying.
4. Confirm the deployment still targets Supabase `vsfthqydfrdzulldbfbe` without displaying credentials.
5. Verify OpenAI calls and eBay writes remain zero. No database data or historical migration is removed by this change, so no database rollback is expected.

Production is outside this plan and must remain unchanged.
