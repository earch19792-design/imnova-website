-- Harden the internal immutable-row trigger helper after the batch-5 factory
-- migration. Trigger execution does not require browser roles to hold EXECUTE.
-- This migration is additive and safe to replay.
begin;

do $migration$
begin
  if to_regprocedure(
    'public.prevent_listing_factory_immutable_mutation()'
  ) is null then
    raise exception
      'LISTING_FACTORY_IMMUTABLE_TRIGGER_FUNCTION_NOT_FOUND';
  end if;
end
$migration$;

revoke all on function public.prevent_listing_factory_immutable_mutation()
  from public, anon, authenticated;

commit;
