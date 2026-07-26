-- Compensating rollback for 20260726071000.
-- Restore only the default PUBLIC EXECUTE privilege that existed previously.
-- anon and authenticated inherit this privilege through PUBLIC.
begin;

do $rollback$
begin
  if to_regprocedure(
    'public.prevent_listing_factory_immutable_mutation()'
  ) is null then
    raise exception
      'LISTING_FACTORY_IMMUTABLE_TRIGGER_FUNCTION_NOT_FOUND';
  end if;
end
$rollback$;

grant execute on function public.prevent_listing_factory_immutable_mutation()
  to public;

commit;
