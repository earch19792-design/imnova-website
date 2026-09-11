-- Keep every historical row. Separate the CURRENT preparation slot from the
-- former one-package-per-opportunity slot; no marketplace operation is involved.
alter table public.ebay_listing_packages drop constraint if exists ebay_listing_packages_opportunity_id_key;
create unique index if not exists ebay_package_legacy_opportunity_slot_v1
 on public.ebay_listing_packages(opportunity_id)
 where coalesce(package_data#>>'{currentPublicationFactoryV1,version}','') <> 'SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1';
create unique index if not exists ebay_package_current_opportunity_slot_v1
 on public.ebay_listing_packages(account_key,opportunity_id)
 where package_data#>>'{currentPublicationFactoryV1,version}' = 'SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1';

create or replace view public.ebay_current_listing_packages_v1 with (security_invoker=true) as
 select k.* from public.ebay_listing_packages k where
 (k.package_data#>>'{currentPublicationFactoryV1,version}'='SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1'
  and k.package_data#>>'{currentPublicationFactoryV1,packageId}'=k.id::text
  and k.package_data#>>'{currentPublicationFactoryV1,accountKey}'=k.account_key
  and k.package_data#>>'{currentPublicationFactoryV1,authorityPolicy}'='CURRENT_ONLY'
  and k.package_data#>>'{currentPublicationFactoryV1,reuseLegacyPreparation}'='false'
  and nullif(k.package_data#>>'{currentPublicationFactoryV1,generation}','') is not null)
 or exists(select 1 from public.ebay_authorized_listing_publications p
  where p.listing_package_id=k.id and p.marketplace_account_key=k.account_key
   and p.sanitized_result#>>'{publicationPreparationV1,current,version}'='SELLER_OS_PACKAGE_PREVIEW_REVISION_V1'
   and p.sanitized_result#>>'{publicationPreparationV1,current,packageId}'=k.id::text
   and p.sanitized_result#>>'{publicationPreparationV1,current,publicationId}'=p.id::text);
revoke all on public.ebay_current_listing_packages_v1 from public,anon,authenticated;
grant select on public.ebay_current_listing_packages_v1 to service_role;

create or replace function public.begin_current_publication_package_v1(p_account_key text,p_opportunity_id uuid,p_candidate_key text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 o public.ebay_luna_opportunity_queue%rowtype;
 k public.ebay_listing_packages%rowtype;
 package_id uuid; generation uuid; histories jsonb; source_count integer;
begin
 if not public.is_seller_os_service_role_request_v1() or p_account_key is null or p_opportunity_id is null or p_candidate_key is null then
  raise exception 'CURRENT_FACTORY_SCOPE_REQUIRED'; end if;
 select * into o from public.ebay_luna_opportunity_queue where id=p_opportunity_id and candidate_key=p_candidate_key;
 if o.id is null or nullif(o.supplier_product_id,'') is null or nullif(o.supplier_variant_id,'') is null or nullif(o.supplier_sku,'') is null then
  raise exception 'CURRENT_FACTORY_EXACT_IDENTITY_REQUIRED'; end if;
 if not exists(select 1 from public.ebay_account_policy_profiles where account_key=p_account_key and marketplace_id='EBAY_US') then
  raise exception 'CURRENT_FACTORY_ACCOUNT_AUTHORITY_REQUIRED'; end if;
 select count(*) into source_count from public.market_radar_latest_variants
  where source_key='lunaportex' and supplier_product_id=o.supplier_product_id and supplier_variant_id=o.supplier_variant_id and sku=o.supplier_sku;
 if source_count<>1 or exists(select 1 from public.market_radar_latest_variants where source_key='lunaportex'
  and sku=o.supplier_sku and (supplier_product_id<>o.supplier_product_id or supplier_variant_id<>o.supplier_variant_id)) then
  raise exception 'CURRENT_FACTORY_CANONICAL_IDENTITY_AMBIGUOUS'; end if;
 perform pg_advisory_xact_lock(hashtextextended('current-publication:'||p_account_key||':'||o.supplier_product_id||':'||o.supplier_variant_id||':'||o.supplier_sku,0));
 -- All history participates in collision detection, never in preparation data.
 if exists(select 1 from public.ebay_active_listings a where a.account_key=p_account_key and a.listing_status='active'
  and (a.supplier_variant_id=o.supplier_variant_id or a.supplier_sku=o.supplier_sku or a.ebay_sku=o.supplier_sku)) then
  return jsonb_build_object('status','REAL_PRODUCT_OR_EBAY_BLOCKER','reason','EXACT_PRODUCT_ALREADY_LIVE','marketplaceWrites',0);
 end if;
 select * into k from public.ebay_current_listing_packages_v1 where account_key=p_account_key and opportunity_id=o.id;
 if k.id is not null then return jsonb_build_object('status','CURRENT_REUSED','package',to_jsonb(k),'packageCreated',false,'marketplaceWrites',0); end if;
 if exists(select 1 from public.ebay_authorized_listing_publications p join public.ebay_luna_opportunity_queue q on q.id=p.opportunity_id
  where p.marketplace_account_key=p_account_key and q.supplier_product_id=o.supplier_product_id
   and q.supplier_variant_id=o.supplier_variant_id and q.supplier_sku=o.supplier_sku) then
  return jsonb_build_object('status','REAL_PRODUCT_OR_EBAY_BLOCKER','reason','EXISTING_PUBLICATION_IDENTITY_RECONCILIATION_REQUIRED','marketplaceWrites',0);
 end if;
 -- Different opportunity keys for the same supplier identity must not create a
 -- second CURRENT package. Reconcile the identity rather than choosing latest.
 if exists(select 1 from public.ebay_current_listing_packages_v1 x join public.ebay_luna_opportunity_queue q on q.id=x.opportunity_id
  where x.account_key=p_account_key and q.supplier_product_id=o.supplier_product_id and q.supplier_variant_id=o.supplier_variant_id and q.supplier_sku=o.supplier_sku) then
  raise exception 'CURRENT_FACTORY_EXISTING_IDENTITY_SLOT_REQUIRES_RECONCILIATION'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('packageId',id,'use','AUDIT_LINEAGE_DEDUP_ONLY') order by id),'[]'::jsonb)
  into histories from public.ebay_listing_packages where account_key=p_account_key and opportunity_id=o.id;
 package_id:=gen_random_uuid();generation:=gen_random_uuid();
 insert into public.ebay_listing_packages(id,account_key,opportunity_id,candidate_key,status,package_data,readiness,created_by)
 values(package_id,p_account_key,o.id,o.candidate_key,'draft',jsonb_build_object(
  'currentPublicationFactoryV1',jsonb_build_object('version','SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1','packageId',package_id,
   'accountKey',p_account_key,'generation',generation,'productId',o.supplier_product_id,'variantId',o.supplier_variant_id,'supplierSku',o.supplier_sku,
   'createdAt',clock_timestamp(),'historicalReferences',histories,'reuseLegacyPreparation',false,'publicationAuthorized',false,
   'authorityPolicy','CURRENT_ONLY','status','WAITING_FOR_CURRENT_AUTHORITIES')),
  0,null) returning * into k;
 return jsonb_build_object('status','CURRENT_CREATED','package',to_jsonb(k),'packageCreated',true,'marketplaceWrites',0);
end;$$;
revoke all on function public.begin_current_publication_package_v1(text,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_current_publication_package_v1(text,uuid,text) to service_role;

-- A new, unpublished preparation is not a competing historical relist lineage.
-- Published CURRENT packages qualify only via the predecessor's certified link.
do $$ declare d text; old text; new text; begin
 select pg_get_functiondef('public.resolve_relist_supplier_handoff_v1(text,text,boolean)'::regprocedure) into d;
 old:='and o.supplier_sku=v_old.supplier_sku and o.market_radar_product_id=v_old.market_radar_product_id limit 2';
 new:='and o.supplier_sku=v_old.supplier_sku and o.market_radar_product_id=v_old.market_radar_product_id
 and (coalesce(k.package_data#>>''{currentPublicationFactoryV1,version}'','''')<>''SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1''
 or k.id::text=v_old.raw_payload#>>''{canonicalSupplierLineage,listingPackageId}'') limit 2';
 if position('currentPublicationFactoryV1' in d)=0 then
  if position(old in d)=0 then raise exception 'RELIST_CURRENT_FACTORY_PATCH_SHAPE_CHANGED'; end if;
  execute replace(d,old,new);
 end if;
end $$;
notify pgrst,'reload schema';
