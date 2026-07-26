-- Compensating rollback. The audit ledger is retained and no previously
-- superseded candidate or published opportunity is revived.

begin;

revoke execute on function
  public.read_eligible_ebay_luna_opportunities_v2(
    text,
    text,
    integer,
    integer
  )
  from service_role;

revoke insert on table
  public.ebay_luna_opportunity_acquisition_dispositions
  from service_role;

comment on table
  public.ebay_luna_opportunity_acquisition_dispositions is
  'Compensating rollback applied: immutable account-scoped audit retained; read RPC and new inserts disabled.';

notify pgrst, 'reload schema';

commit;
