-- Source evidence may be captured before the factual dossier is complete.
-- The V3 revision path remains fail-closed until the dossier is linked.
alter table public.luna_catalog_authorized_source_packs
  alter column authoritative_fact_package_hash drop not null;

alter table public.luna_catalog_authorized_source_packs
  drop constraint if exists luna_catalog_source_pack_identity_check;
alter table public.luna_catalog_authorized_source_packs
  add constraint luna_catalog_source_pack_identity_check check (
    supplier_product_id ~ '^[0-9]{1,30}$'
    and supplier_variant_id ~ '^[0-9]{1,30}$'
    and product_identity_hash ~ '^sha256:[0-9a-f]{64}$'
    and (authoritative_fact_package_hash is null or authoritative_fact_package_hash ~ '^sha256:[0-9a-f]{64}$')
    and authorization_evidence_hash ~ '^[0-9a-f]{64}$'
    and source_pack_hash ~ '^[0-9a-f]{64}$'
  );

comment on column public.luna_catalog_authorized_source_packs.authoritative_fact_package_hash is
  'Nullable while source evidence is pending dossier completion; never populated with a placeholder.';
