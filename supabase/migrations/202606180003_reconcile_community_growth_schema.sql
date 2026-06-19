-- Reconcile IMNOVA OS community growth schema.
-- Safe and non-destructive: this migration only creates missing objects,
-- adds missing columns/constraints/indexes/policies, and reloads PostgREST.

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
    raise exception 'public.subscribers.id must be uuid before reconciling community growth schema';
  end if;
end $$;

create table if not exists public.community_levels (
  key text primary key,
  label text not null,
  min_points integer not null default 0,
  description text null,
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
  source_table text null,
  source_id uuid null,
  idempotency_key text null,
  description text null,
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
  referral_code text null,
  last_activity_at timestamptz null,
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
  description text null,
  discount_type text not null default 'percent',
  discount_value numeric(10,2) not null default 0,
  points_cost integer not null default 0,
  required_level_key text null references public.community_levels(key),
  code text null,
  starts_at timestamptz null,
  ends_at timestamptz null,
  max_redemptions integer null,
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
  redemption_code text null,
  status text not null default 'reserved',
  created_at timestamptz not null default now(),
  redeemed_at timestamptz null
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
  summary text null,
  status text not null,
  product_id uuid null references public.products(id) on delete set null,
  idea_lab_item_id uuid null references public.idea_lab_items(id) on delete set null,
  trend_signal_id uuid null references public.trend_radar_signals(id) on delete set null,
  source text not null default 'admin',
  is_public boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  published_at timestamptz null,
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

alter table public.communication_preferences
  add column if not exists frequency_preference text not null default 'important_only';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_referral_codes_subscriber_unique'
      and conrelid = 'public.community_referral_codes'::regclass
  ) then
    alter table public.community_referral_codes
      add constraint community_referral_codes_subscriber_unique unique (subscriber_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_referral_codes_code_unique'
      and conrelid = 'public.community_referral_codes'::regclass
  ) then
    alter table public.community_referral_codes
      add constraint community_referral_codes_code_unique unique (code);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_referral_codes_code_format'
      and conrelid = 'public.community_referral_codes'::regclass
  ) then
    alter table public.community_referral_codes
      add constraint community_referral_codes_code_format
        check (code ~ '^[A-Z0-9]{6,16}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_referrals_status_check'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_status_check
        check (status in ('registered', 'qualified', 'rewarded', 'cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_referrals_unique_pair'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_unique_pair
        unique (referrer_subscriber_id, referred_subscriber_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_referrals_no_self_referral'
      and conrelid = 'public.community_referrals'::regclass
  ) then
    alter table public.community_referrals
      add constraint community_referrals_no_self_referral
        check (referrer_subscriber_id <> referred_subscriber_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
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
    select 1
    from pg_constraint
    where conname = 'community_vip_rewards_discount_type_check'
      and conrelid = 'public.community_vip_rewards'::regclass
  ) then
    alter table public.community_vip_rewards
      add constraint community_vip_rewards_discount_type_check
        check (discount_type in ('percent', 'fixed', 'free_shipping', 'gift'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_reward_redemptions_status_check'
      and conrelid = 'public.community_reward_redemptions'::regclass
  ) then
    alter table public.community_reward_redemptions
      add constraint community_reward_redemptions_status_check
        check (status in ('reserved', 'redeemed', 'expired', 'cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'community_reward_redemptions_unique_reward_subscriber'
      and conrelid = 'public.community_reward_redemptions'::regclass
  ) then
    alter table public.community_reward_redemptions
      add constraint community_reward_redemptions_unique_reward_subscriber
        unique (reward_id, subscriber_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
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

  if not exists (
    select 1
    from pg_constraint
    where conname = 'communication_preferences_frequency_check'
      and conrelid = 'public.communication_preferences'::regclass
  ) then
    alter table public.communication_preferences
      add constraint communication_preferences_frequency_check
        check (frequency_preference in (
          'important_only',
          'weekly',
          'twice_monthly'
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

alter table public.community_levels enable row level security;
alter table public.community_referral_codes enable row level security;
alter table public.community_referrals enable row level security;
alter table public.community_points_ledger enable row level security;
alter table public.community_member_status enable row level security;
alter table public.community_vip_rewards enable row level security;
alter table public.community_reward_redemptions enable row level security;
alter table public.transparency_wall_items enable row level security;

drop policy if exists "public read active community levels" on public.community_levels;
create policy "public read active community levels"
  on public.community_levels
  for select
  using (is_active = true);

drop policy if exists "admin manage community levels" on public.community_levels;
create policy "admin manage community levels"
  on public.community_levels
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public read active vip rewards" on public.community_vip_rewards;
create policy "public read active vip rewards"
  on public.community_vip_rewards
  for select
  using (is_active = true);

drop policy if exists "public read transparency wall" on public.transparency_wall_items;
create policy "public read transparency wall"
  on public.transparency_wall_items
  for select
  using (is_public = true and is_active = true);

drop policy if exists "admin manage referral codes" on public.community_referral_codes;
create policy "admin manage referral codes"
  on public.community_referral_codes
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage referrals" on public.community_referrals;
create policy "admin manage referrals"
  on public.community_referrals
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage points ledger" on public.community_points_ledger;
create policy "admin manage points ledger"
  on public.community_points_ledger
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage member status" on public.community_member_status;
create policy "admin manage member status"
  on public.community_member_status
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage vip rewards" on public.community_vip_rewards;
create policy "admin manage vip rewards"
  on public.community_vip_rewards
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage reward redemptions" on public.community_reward_redemptions;
create policy "admin manage reward redemptions"
  on public.community_reward_redemptions
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage transparency wall" on public.transparency_wall_items;
create policy "admin manage transparency wall"
  on public.transparency_wall_items
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.community_levels to anon, authenticated;
grant select on public.community_vip_rewards to anon, authenticated;
grant select on public.transparency_wall_items to anon, authenticated;
grant insert, update, delete on public.community_levels to authenticated;
grant insert, update, delete on public.community_vip_rewards to authenticated;
grant insert, update, delete on public.transparency_wall_items to authenticated;
grant select, insert, update, delete on public.community_referral_codes to authenticated;
grant select, insert, update, delete on public.community_referrals to authenticated;
grant select, insert, update, delete on public.community_points_ledger to authenticated;
grant select, insert, update, delete on public.community_member_status to authenticated;
grant select, insert, update, delete on public.community_reward_redemptions to authenticated;

notify pgrst, 'reload schema';
