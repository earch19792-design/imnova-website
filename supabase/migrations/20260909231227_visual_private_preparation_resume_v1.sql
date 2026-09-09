begin;
create or replace function public.seller_os_put_ipad_outbox_v1(p_account_key text,p_actor_user_id uuid,p_intent jsonb,p_hash text,p_binding jsonb)
returns public.seller_os_ipad_outbox_v1 language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row public.seller_os_ipad_outbox_v1;
begin
 insert into public.seller_os_ipad_outbox_v1(account_key,actor_user_id,item_id,kind,idempotency_key,payload_hash,intent,binding,state,reason_code)
 values(p_account_key,p_actor_user_id,p_intent->>'itemId',p_intent->>'kind',p_intent->>'idempotencyKey',p_hash,p_intent,p_binding,
 case when p_intent->>'kind'='IMAGE_DRAFT' and p_intent #>> '{requestedChanges,prepareReview}'='true' then 'DRAFT'
 when p_intent->>'kind' in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') then 'OWNER_APPROVAL_REQUIRED' else 'DRAFT' end,
 case when p_intent->>'kind'='IMAGE_DRAFT' and p_intent #>> '{requestedChanges,prepareReview}'='true' then 'PRIVATE_PREPARATION_REQUIRED'
 when p_intent->>'kind' in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') then 'OWNER_VISUAL_REVIEW_REQUIRED' else 'DRAFT_IS_NOT_WRITE_AUTHORITY' end)
 on conflict(account_key,actor_user_id,idempotency_key) do nothing;
 select * into strict v_row from public.seller_os_ipad_outbox_v1 where account_key=p_account_key and actor_user_id=p_actor_user_id and idempotency_key=p_intent->>'idempotencyKey';
 if v_row.payload_hash is distinct from p_hash then raise exception 'OUTBOX_IDEMPOTENCY_PAYLOAD_CONFLICT';end if;
 if v_row.state in ('DRAFT','OWNER_APPROVAL_REQUIRED') and public.seller_os_visual_outbox_owner_ready_v1(v_row) then
   update public.seller_os_ipad_outbox_v1 set state='APPROVED_FOR_EBAY_SYNC',reason_code='REVALIDATION_REQUIRED'
    where id=v_row.id returning * into v_row;
 end if;
 return v_row;
end $$;
create or replace function public.seller_os_claim_ipad_outbox_v1(p_account_key text)
returns setof public.seller_os_ipad_outbox_v1 language sql security invoker set search_path=public,pg_temp as $$
 with candidate as (
 select id from public.seller_os_ipad_outbox_v1 where account_key=p_account_key
 and ((state='DRAFT' and kind='IMAGE_DRAFT' and intent #>> '{requestedChanges,prepareReview}'='true')
   or (state in ('APPROVED_FOR_EBAY_SYNC','PENDING_EBAY_SYNC','REVALIDATING','SYNCING','OFFICIAL_READBACK_REQUIRED','UNKNOWN_COMMIT','LEASED')
     and (dispatch_count>0 or public.seller_os_visual_outbox_owner_ready_v1(seller_os_ipad_outbox_v1))))
 and next_attempt_at<=now() and (lease_until is null or lease_until<now())
 order by next_attempt_at,received_at,id for update skip locked limit 1
 ) update public.seller_os_ipad_outbox_v1 o set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 from candidate c where o.id=c.id returning o.*;
$$;
-- This claim resumes private draft preparation only; the executor still stops
-- at OWNER_APPROVAL_REQUIRED before consulting quota or eBay.
notify pgrst,'reload schema';
commit;
