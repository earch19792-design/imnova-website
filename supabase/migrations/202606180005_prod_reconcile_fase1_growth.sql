-- IMNOVA OS Fase 1 production reconciliation.
-- Safe, idempotent, non-destructive schema migration.
-- Do not use this as a replacement for a production backup/review window.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscribers'
      and column_name = 'id'
      and udt_name = 'uuid'
  ) then
    raise exception 'public.subscribers.id must be uuid before applying Fase 1 reconciliation';
  end if;
end $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    coalesce(auth.role() = 'service_role', false)
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.communication_preferences
  add column if not exists frequency_preference text not null default 'important_only',
  add column if not exists consent_version text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'communication_preferences_frequency_check'
      and conrelid = 'public.communication_preferences'::regclass
  ) then
    alter table public.communication_preferences
      add constraint communication_preferences_frequency_check
        check (
          frequency_preference in (
            'important_only',
            'weekly',
            'twice_monthly'
          )
        );
  end if;
end $$;

alter table public.product_states
  add column if not exists progress integer not null default 0,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true;

alter table public.products
  add column if not exists visible boolean not null default true,
  add column if not exists is_public boolean not null default true,
  add column if not exists is_active boolean not null default true;

create table if not exists public.community_levels (
  key text primary key,
  label text not null,
  min_points integer not null default 0,
  description text,
  benefits text[] not null default '{}',
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.community_levels
  add column if not exists label text not null default 'Miembro',
  add column if not exists min_points integer not null default 0,
  add column if not exists description text,
  add column if not exists benefits text[] not null default '{}',
  add column if not exists display_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

insert into public.community_levels
  (key, label, min_points, description, benefits, display_order, is_active)
values
  ('miembro', 'Miembro', 0, 'Persona registrada en la comunidad IMNOVA.', array['Votar ideas', 'Recibir avances relevantes'], 10, true),
  ('colaborador', 'Colaborador', 50, 'Miembro que participa con votos, encuestas o referidos.', array['Prioridad en encuestas', 'Acceso temprano a oportunidades'], 20, true),
  ('validador', 'Validador', 150, 'Miembro con participacion consistente en validaciones.', array['Invitaciones a pruebas', 'Beneficios especiales'], 30, true),
  ('embajador', 'Embajador', 350, 'Miembro que ayuda a crecer la comunidad y recomienda IMNOVA.', array['Beneficios por referidos', 'Acceso anticipado'], 40, true),
  ('vip', 'VIP', 700, 'Miembro de alta participacion con acceso preferente.', array['Descuentos VIP', 'Sorteos exclusivos', 'Prioridad en lanzamientos'], 50, true)
on conflict (key) do update set
  label = excluded.label,
  min_points = excluded.min_points,
  description = excluded.description,
  benefits = excluded.benefits,
  display_order = excluded.display_order,
  is_active = excluded.is_active;

create table if not exists public.community_referral_codes (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.community_referral_codes
  add column if not exists subscriber_id uuid,
  add column if not exists code text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.community_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  referred_subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  referral_code text not null,
  source text not null default 'community_popup',
  status text not null default 'registered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.community_referrals
  add column if not exists referrer_subscriber_id uuid,
  add column if not exists referred_subscriber_id uuid,
  add column if not exists referral_code text,
  add column if not exists source text not null default 'community_popup',
  add column if not exists status text not null default 'registered',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.community_points_ledger (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  event_type text not null,
  points integer not null,
  source text not null default 'system',
  source_table text,
  source_id uuid,
  idempotency_key text,
  description text,
  created_at timestamptz not null default now()
);

alter table public.community_points_ledger
  add column if not exists subscriber_id uuid,
  add column if not exists event_type text,
  add column if not exists points integer,
  add column if not exists source text not null default 'system',
  add column if not exists source_table text,
  add column if not exists source_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists description text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.community_member_status (
  subscriber_id uuid primary key references public.subscribers(id) on delete cascade,
  points_total integer not null default 0,
  level_key text not null default 'miembro' references public.community_levels(key),
  is_vip boolean not null default false,
  referral_code text,
  last_activity_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.community_member_status
  add column if not exists points_total integer not null default 0,
  add column if not exists level_key text not null default 'miembro',
  add column if not exists is_vip boolean not null default false,
  add column if not exists referral_code text,
  add column if not exists last_activity_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.community_vip_rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  discount_type text not null default 'percent',
  discount_value numeric(10,2) not null default 0,
  points_cost integer not null default 0,
  required_level_key text references public.community_levels(key),
  code text,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.community_vip_rewards
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists discount_type text not null default 'percent',
  add column if not exists discount_value numeric(10,2) not null default 0,
  add column if not exists points_cost integer not null default 0,
  add column if not exists required_level_key text,
  add column if not exists code text,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists max_redemptions integer,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.community_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.community_vip_rewards(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  points_spent integer not null default 0,
  redemption_code text,
  status text not null default 'reserved',
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);

alter table public.community_reward_redemptions
  add column if not exists reward_id uuid,
  add column if not exists subscriber_id uuid,
  add column if not exists points_spent integer not null default 0,
  add column if not exists redemption_code text,
  add column if not exists status text not null default 'reserved',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists redeemed_at timestamptz;

create table if not exists public.transparency_wall_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  status text not null,
  product_id uuid references public.products(id) on delete set null,
  idea_lab_item_id uuid references public.idea_lab_items(id) on delete set null,
  trend_signal_id uuid references public.trend_radar_signals(id) on delete set null,
  source text not null default 'admin',
  is_public boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transparency_wall_items
  add column if not exists title text,
  add column if not exists summary text,
  add column if not exists status text,
  add column if not exists product_id uuid,
  add column if not exists idea_lab_item_id uuid,
  add column if not exists trend_signal_id uuid,
  add column if not exists source text not null default 'admin',
  add column if not exists is_public boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists display_order integer not null default 0,
  add column if not exists published_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referral_codes_subscriber_unique'
      and conrelid = 'public.community_referral_codes'::regclass
  ) then
    alter table public.community_referral_codes
      add constraint community_referral_codes_subscriber_unique unique (subscriber_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referral_codes_code_unique'
      and conrelid = 'public.community_referral_codes'::regclass
  ) then
    alter table public.community_referral_codes
      add constraint community_referral_codes_code_unique unique (code);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referral_codes_code_format'
      and conrelid = 'public.community_referral_codes'::regclass
  ) then
    alter table public.community_referral_codes
      add constraint community_referral_codes_code_format
      check (code ~ '^[A-Z0-9]{6,16}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referrals_status_check'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_status_check
      check (status in ('registered', 'qualified', 'rewarded', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referrals_unique_pair'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_unique_pair
      unique (referrer_subscriber_id, referred_subscriber_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referrals_no_self_referral'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_no_self_referral
      check (referrer_subscriber_id <> referred_subscriber_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_points_event_type_check'
      and conrelid = 'public.community_points_ledger'::regclass
  ) then
    alter table public.community_points_ledger
      add constraint community_points_event_type_check
      check (event_type in (
        'join',
        'vote',
        'survey_response',
        'referral',
        'purchase',
        'repurchase',
        'manual_adjustment',
        'reward_redemption'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_vip_rewards_discount_type_check'
      and conrelid = 'public.community_vip_rewards'::regclass
  ) then
    alter table public.community_vip_rewards
      add constraint community_vip_rewards_discount_type_check
      check (discount_type in ('percent', 'fixed', 'free_shipping', 'gift'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_reward_redemptions_status_check'
      and conrelid = 'public.community_reward_redemptions'::regclass
  ) then
    alter table public.community_reward_redemptions
      add constraint community_reward_redemptions_status_check
      check (status in ('reserved', 'redeemed', 'expired', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_reward_redemptions_unique_reward_subscriber'
      and conrelid = 'public.community_reward_redemptions'::regclass
  ) then
    alter table public.community_reward_redemptions
      add constraint community_reward_redemptions_unique_reward_subscriber
      unique (reward_id, subscriber_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transparency_wall_items_status_check'
      and conrelid = 'public.transparency_wall_items'::regclass
  ) then
    alter table public.transparency_wall_items
      add constraint transparency_wall_items_status_check
      check (status in (
        'idea_proposed',
        'idea_in_validation',
        'product_in_development',
        'product_launched'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referral_codes_subscriber_id_fkey'
      and conrelid = 'public.community_referral_codes'::regclass
  ) then
    alter table public.community_referral_codes
      add constraint community_referral_codes_subscriber_id_fkey
      foreign key (subscriber_id) references public.subscribers(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referrals_referrer_subscriber_id_fkey'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_referrer_subscriber_id_fkey
      foreign key (referrer_subscriber_id) references public.subscribers(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_referrals_referred_subscriber_id_fkey'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_referred_subscriber_id_fkey
      foreign key (referred_subscriber_id) references public.subscribers(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_points_ledger_subscriber_id_fkey'
      and conrelid = 'public.community_points_ledger'::regclass
  ) then
    alter table public.community_points_ledger
      add constraint community_points_ledger_subscriber_id_fkey
      foreign key (subscriber_id) references public.subscribers(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_member_status_subscriber_id_fkey'
      and conrelid = 'public.community_member_status'::regclass
  ) then
    alter table public.community_member_status
      add constraint community_member_status_subscriber_id_fkey
      foreign key (subscriber_id) references public.subscribers(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_member_status_level_key_fkey'
      and conrelid = 'public.community_member_status'::regclass
  ) then
    alter table public.community_member_status
      add constraint community_member_status_level_key_fkey
      foreign key (level_key) references public.community_levels(key)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_vip_rewards_required_level_key_fkey'
      and conrelid = 'public.community_vip_rewards'::regclass
  ) then
    alter table public.community_vip_rewards
      add constraint community_vip_rewards_required_level_key_fkey
      foreign key (required_level_key) references public.community_levels(key)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_reward_redemptions_reward_id_fkey'
      and conrelid = 'public.community_reward_redemptions'::regclass
  ) then
    alter table public.community_reward_redemptions
      add constraint community_reward_redemptions_reward_id_fkey
      foreign key (reward_id) references public.community_vip_rewards(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'community_reward_redemptions_subscriber_id_fkey'
      and conrelid = 'public.community_reward_redemptions'::regclass
  ) then
    alter table public.community_reward_redemptions
      add constraint community_reward_redemptions_subscriber_id_fkey
      foreign key (subscriber_id) references public.subscribers(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transparency_wall_items_product_id_fkey'
      and conrelid = 'public.transparency_wall_items'::regclass
  ) then
    alter table public.transparency_wall_items
      add constraint transparency_wall_items_product_id_fkey
      foreign key (product_id) references public.products(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transparency_wall_items_idea_lab_item_id_fkey'
      and conrelid = 'public.transparency_wall_items'::regclass
  ) then
    alter table public.transparency_wall_items
      add constraint transparency_wall_items_idea_lab_item_id_fkey
      foreign key (idea_lab_item_id) references public.idea_lab_items(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transparency_wall_items_trend_signal_id_fkey'
      and conrelid = 'public.transparency_wall_items'::regclass
  ) then
    alter table public.transparency_wall_items
      add constraint transparency_wall_items_trend_signal_id_fkey
      foreign key (trend_signal_id) references public.trend_radar_signals(id)
      on delete set null not valid;
  end if;
end $$;

create index if not exists community_referral_codes_active_idx
  on public.community_referral_codes(is_active);

create index if not exists community_referrals_referrer_idx
  on public.community_referrals(referrer_subscriber_id, created_at desc);

create index if not exists community_referrals_referred_idx
  on public.community_referrals(referred_subscriber_id);

create unique index if not exists community_points_ledger_idempotency_idx
  on public.community_points_ledger(idempotency_key)
  where idempotency_key is not null;

create index if not exists community_points_ledger_subscriber_idx
  on public.community_points_ledger(subscriber_id, created_at desc);

create index if not exists community_member_status_level_idx
  on public.community_member_status(level_key, points_total desc);

create index if not exists community_vip_rewards_active_idx
  on public.community_vip_rewards(is_active, starts_at, ends_at);

create index if not exists community_reward_redemptions_subscriber_idx
  on public.community_reward_redemptions(subscriber_id, created_at desc);

create index if not exists transparency_wall_items_public_idx
  on public.transparency_wall_items(is_public, is_active, display_order, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_community_referral_codes_updated_at'
      and tgrelid = 'public.community_referral_codes'::regclass
  ) then
    create trigger set_community_referral_codes_updated_at
      before update on public.community_referral_codes
      for each row
      execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_community_referrals_updated_at'
      and tgrelid = 'public.community_referrals'::regclass
  ) then
    create trigger set_community_referrals_updated_at
      before update on public.community_referrals
      for each row
      execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_community_vip_rewards_updated_at'
      and tgrelid = 'public.community_vip_rewards'::regclass
  ) then
    create trigger set_community_vip_rewards_updated_at
      before update on public.community_vip_rewards
      for each row
      execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_transparency_wall_items_updated_at'
      and tgrelid = 'public.transparency_wall_items'::regclass
  ) then
    create trigger set_transparency_wall_items_updated_at
      before update on public.transparency_wall_items
      for each row
      execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.generate_referral_code(
  p_subscriber_id uuid,
  p_name text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_name text;
  prefix text;
  suffix text;
begin
  clean_name := upper(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g'));
  prefix := coalesce(nullif(left(clean_name, 4), ''), 'IMNV');
  suffix := upper(left(md5(coalesce(p_subscriber_id::text, gen_random_uuid()::text)), 8));

  return left(prefix || suffix, 12);
end;
$$;

create or replace function public.sync_community_member_status(
  p_subscriber_id uuid
)
returns public.community_member_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points_total integer;
  v_level_key text;
  v_referral_code text;
  v_status public.community_member_status;
begin
  if p_subscriber_id is null then
    raise exception 'subscriber_id is required';
  end if;

  select coalesce(sum(points), 0)::integer
  into v_points_total
  from public.community_points_ledger
  where subscriber_id = p_subscriber_id;

  select key
  into v_level_key
  from public.community_levels
  where is_active = true
    and min_points <= v_points_total
  order by min_points desc, display_order desc
  limit 1;

  v_level_key := coalesce(v_level_key, 'miembro');

  select code
  into v_referral_code
  from public.community_referral_codes
  where subscriber_id = p_subscriber_id
    and is_active = true
  order by created_at asc
  limit 1;

  insert into public.community_member_status (
    subscriber_id,
    points_total,
    level_key,
    is_vip,
    referral_code,
    last_activity_at,
    updated_at
  )
  values (
    p_subscriber_id,
    v_points_total,
    v_level_key,
    v_level_key = 'vip',
    v_referral_code,
    now(),
    now()
  )
  on conflict (subscriber_id) do update set
    points_total = excluded.points_total,
    level_key = excluded.level_key,
    is_vip = excluded.is_vip,
    referral_code = excluded.referral_code,
    last_activity_at = excluded.last_activity_at,
    updated_at = now()
  returning * into v_status;

  return v_status;
end;
$$;

create or replace function public.ensure_community_member_status(
  p_subscriber_id uuid,
  p_name text default null
)
returns public.community_member_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_status public.community_member_status;
begin
  if p_subscriber_id is null then
    raise exception 'subscriber_id is required';
  end if;

  v_code := public.generate_referral_code(p_subscriber_id, p_name);

  insert into public.community_referral_codes (
    subscriber_id,
    code,
    is_active,
    updated_at
  )
  values (
    p_subscriber_id,
    v_code,
    true,
    now()
  )
  on conflict (subscriber_id) do update set
    is_active = true,
    updated_at = now();

  v_status := public.sync_community_member_status(p_subscriber_id);
  return v_status;
end;
$$;

create or replace function public.award_community_points(
  p_subscriber_id uuid,
  p_event_type text,
  p_points integer,
  p_source text default 'system',
  p_source_table text default null,
  p_source_id uuid default null,
  p_idempotency_key text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points_id uuid;
begin
  if p_subscriber_id is null then
    raise exception 'subscriber_id is required';
  end if;

  if p_points is null then
    raise exception 'points is required';
  end if;

  if p_idempotency_key is not null then
    select id
    into v_points_id
    from public.community_points_ledger
    where idempotency_key = p_idempotency_key
    limit 1;

    if v_points_id is not null then
      perform public.sync_community_member_status(p_subscriber_id);
      return v_points_id;
    end if;
  end if;

  insert into public.community_points_ledger (
    subscriber_id,
    event_type,
    points,
    source,
    source_table,
    source_id,
    idempotency_key,
    description
  )
  values (
    p_subscriber_id,
    p_event_type,
    p_points,
    coalesce(p_source, 'system'),
    p_source_table,
    p_source_id,
    p_idempotency_key,
    p_description
  )
  on conflict (idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into v_points_id;

  if v_points_id is null and p_idempotency_key is not null then
    select id
    into v_points_id
    from public.community_points_ledger
    where idempotency_key = p_idempotency_key
    limit 1;
  end if;

  perform public.sync_community_member_status(p_subscriber_id);

  return v_points_id;
end;
$$;

alter table public.subscriber_interests
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriber_interests_subscriber_id_fkey'
      and conrelid = 'public.subscriber_interests'::regclass
  ) then
    alter table public.subscriber_interests
      add constraint subscriber_interests_subscriber_id_fkey
      foreign key (subscriber_id) references public.subscribers(id)
      on delete cascade not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriber_interests_subniche_id_fkey'
      and conrelid = 'public.subscriber_interests'::regclass
  ) then
    alter table public.subscriber_interests
      add constraint subscriber_interests_subniche_id_fkey
      foreign key (subniche_id) references public.strategic_subniches(id)
      on delete restrict not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'subscriber_interests_unique_subscriber_subniche_idx'
  ) then
    if not exists (
      select 1
      from public.subscriber_interests
      where subscriber_id is not null
        and subniche_id is not null
      group by subscriber_id, subniche_id
      having count(*) > 1
    ) then
      create unique index subscriber_interests_unique_subscriber_subniche_idx
        on public.subscriber_interests(subscriber_id, subniche_id)
        where subscriber_id is not null and subniche_id is not null;
    else
      raise notice 'subscriber_interests has duplicate subscriber/subniche pairs; unique index was not created';
    end if;
  end if;
end $$;

create index if not exists subscriber_interests_subscriber_id_idx
  on public.subscriber_interests(subscriber_id);

create index if not exists subscriber_interests_subniche_id_idx
  on public.subscriber_interests(subniche_id);

create index if not exists subscriber_interests_created_at_idx
  on public.subscriber_interests(created_at desc);

create index if not exists subscriber_interests_source_idx
  on public.subscriber_interests(source);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_subscriber_interests_updated_at'
      and tgrelid = 'public.subscriber_interests'::regclass
  ) then
    create trigger set_subscriber_interests_updated_at
      before update on public.subscriber_interests
      for each row
      execute function public.set_updated_at();
  end if;
end $$;

alter table public.community_levels enable row level security;
alter table public.community_referral_codes enable row level security;
alter table public.community_referrals enable row level security;
alter table public.community_points_ledger enable row level security;
alter table public.community_member_status enable row level security;
alter table public.community_vip_rewards enable row level security;
alter table public.community_reward_redemptions enable row level security;
alter table public.transparency_wall_items enable row level security;
alter table public.subscriber_interests enable row level security;
alter table public.product_subniches enable row level security;

do $$
declare
  policy_to_harden record;
begin
  for policy_to_harden in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriber_interests'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and ('public' = any(roles) or 'anon' = any(roles))
  loop
    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'subscriber_interests'
        and policyname = policy_to_harden.policyname
        and cmd = 'INSERT'
    ) then
      execute format(
        'alter policy %I on public.subscriber_interests to authenticated with check (public.is_admin())',
        policy_to_harden.policyname
      );
    elsif exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'subscriber_interests'
        and policyname = policy_to_harden.policyname
        and cmd = 'UPDATE'
    ) then
      execute format(
        'alter policy %I on public.subscriber_interests to authenticated using (public.is_admin()) with check (public.is_admin())',
        policy_to_harden.policyname
      );
    else
      execute format(
        'alter policy %I on public.subscriber_interests to authenticated using (public.is_admin())',
        policy_to_harden.policyname
      );
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_levels'
      and policyname = 'public read active community levels'
  ) then
    create policy "public read active community levels"
      on public.community_levels
      for select
      using (is_active = true);
  else
    alter policy "public read active community levels"
      on public.community_levels
      using (is_active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_levels'
      and policyname = 'admin manage community levels'
  ) then
    create policy "admin manage community levels"
      on public.community_levels
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage community levels"
      on public.community_levels
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_referral_codes'
      and policyname = 'admin manage referral codes'
  ) then
    create policy "admin manage referral codes"
      on public.community_referral_codes
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage referral codes"
      on public.community_referral_codes
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_referrals'
      and policyname = 'admin manage referrals'
  ) then
    create policy "admin manage referrals"
      on public.community_referrals
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage referrals"
      on public.community_referrals
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_points_ledger'
      and policyname = 'admin manage points ledger'
  ) then
    create policy "admin manage points ledger"
      on public.community_points_ledger
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage points ledger"
      on public.community_points_ledger
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_member_status'
      and policyname = 'admin manage member status'
  ) then
    create policy "admin manage member status"
      on public.community_member_status
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage member status"
      on public.community_member_status
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_vip_rewards'
      and policyname = 'admin manage vip rewards'
  ) then
    create policy "admin manage vip rewards"
      on public.community_vip_rewards
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage vip rewards"
      on public.community_vip_rewards
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'community_reward_redemptions'
      and policyname = 'admin manage reward redemptions'
  ) then
    create policy "admin manage reward redemptions"
      on public.community_reward_redemptions
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage reward redemptions"
      on public.community_reward_redemptions
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'transparency_wall_items'
      and policyname = 'public read transparency wall'
  ) then
    create policy "public read transparency wall"
      on public.transparency_wall_items
      for select
      using (is_public = true and is_active = true);
  else
    alter policy "public read transparency wall"
      on public.transparency_wall_items
      using (is_public = true and is_active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'transparency_wall_items'
      and policyname = 'admin manage transparency wall'
  ) then
    create policy "admin manage transparency wall"
      on public.transparency_wall_items
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage transparency wall"
      on public.transparency_wall_items
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriber_interests'
      and policyname = 'admin manage subscriber interests'
  ) then
    create policy "admin manage subscriber interests"
      on public.subscriber_interests
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage subscriber interests"
      on public.subscriber_interests
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'product_subniches'
      and policyname = 'public read product subniches'
  ) then
    create policy "public read product subniches"
      on public.product_subniches
      for select
      using (true);
  else
    alter policy "public read product subniches"
      on public.product_subniches
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'product_subniches'
      and policyname = 'admin manage product subniches'
  ) then
    create policy "admin manage product subniches"
      on public.product_subniches
      for all
      using (public.is_admin())
      with check (public.is_admin());
  else
    alter policy "admin manage product subniches"
      on public.product_subniches
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

grant select on public.community_levels to anon, authenticated;
grant select on public.transparency_wall_items to anon, authenticated;
grant select on public.product_subniches to anon, authenticated;

grant select, insert, update, delete
  on public.community_levels,
     public.community_referral_codes,
     public.community_referrals,
     public.community_points_ledger,
     public.community_member_status,
     public.community_vip_rewards,
     public.community_reward_redemptions,
     public.transparency_wall_items,
     public.subscriber_interests,
     public.product_subniches
  to authenticated;

grant all
  on public.community_levels,
     public.community_referral_codes,
     public.community_referrals,
     public.community_points_ledger,
     public.community_member_status,
     public.community_vip_rewards,
     public.community_reward_redemptions,
     public.transparency_wall_items,
     public.subscriber_interests,
     public.product_subniches
  to service_role;

grant execute on function public.generate_referral_code(uuid, text) to service_role;
grant execute on function public.ensure_community_member_status(uuid, text) to service_role;
grant execute on function public.award_community_points(uuid, text, integer, text, text, uuid, text, text) to service_role;
grant execute on function public.sync_community_member_status(uuid) to service_role;

notify pgrst, 'reload schema';
