alter table public.ebay_commercial_improvement_executions
  drop constraint if exists ebay_commercial_improvement_action_check;

alter table public.ebay_commercial_improvement_executions
  add constraint ebay_commercial_improvement_action_check check (
    action_type in ('PRICE', 'PROMOTED_LISTINGS_GENERAL', 'END_LISTING')
  );

comment on constraint ebay_commercial_improvement_action_check
  on public.ebay_commercial_improvement_executions is
  'Only human-confirmed commercial actions are accepted. END_LISTING also requires a fresh exact Luna out-of-stock observation and official eBay readback.';
