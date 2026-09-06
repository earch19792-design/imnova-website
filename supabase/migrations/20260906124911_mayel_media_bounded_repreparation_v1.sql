-- A Media create response can be accepted by eBay while omitting every
-- usable image identity. Seller OS permits one delayed, durable
-- re-preparation for that exact failure class. This does not authorize or
-- retry any listing mutation.

alter table public.seller_os_operational_learning_ledger_v1
  drop constraint seller_os_operational_learning_retry_check;

alter table public.seller_os_operational_learning_ledger_v1
  add constraint seller_os_operational_learning_retry_check check (
    retry_safety in (
      'SAFE_READ_ONLY_RECONCILIATION',
      'SAFE_IDEMPOTENT_RUNTIME_RESUME',
      'SAFE_BOUNDED_MEDIA_REPREPARATION',
      'OWNER_COMMERCIAL_AUTHORIZATION_REQUIRED',
      'ENGINEERING_REQUIRED',
      'NOT_APPLICABLE'
    )
    and recovery_class in (
      'AUTO_RECOVERABLE',
      'OWNER_COMMERCIAL',
      'ENGINEERING_REQUIRED',
      'OBSERVATION_ONLY'
    )
  );

notify pgrst, 'reload schema';
