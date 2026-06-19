-- Community organic growth foundation for IMNOVA OS.
-- Safe, non-destructive migration. It creates referral, points, levels,
-- VIP rewards and transparency wall tables without changing existing data.

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
    raise exception 'public.subscribers.id must be uuid before creating community growth tables';
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

insert into public.community_levels
  (key, label, min_points, description, benefits, display_order, is_active)
values
  (
    'miembro',
    'Miembro',
    0,
    'Persona registrada en la comunidad IMNOVA.',
    array['Votar ideas', 'Recibir avances relevantes'],
    10,
    true
  ),
  (
    'colaborador',
    'Colaborador',
    50,
    'Miembro que participa con votos, encuestas o referidos.',
    array['Prioridad en encuestas', 'Acceso temprano a oportunidades'],
    20,
    true
  ),
  (
    'validador',
    'Validador',
    150,
    'Miembro con participacion consistente en validaciones.',
    array['Invitaciones a pruebas', 'Beneficios especiales'],
    30,
    true
  ),
  (
    'embajador',
    'Embajador',
    350,
    'Miembro que ayuda a crecer la comunidad y recomienda IMNOVA.',
    array['Beneficios por referidos', 'Acceso anticipado'],
    40,
    true
  ),
  (
    'vip',
    'VIP',
    700,
    'Miembro de alta participacion con acceso preferente.',
    array['Descuentos VIP', 'Sorteos exclusivos', 'Prioridad en lanzamientos'],
    50,
    true
  )
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
  updated_at timestamptz not null default now(),
  constraint community_referral_codes_subscriber_unique unique (subscriber_id),
  constraint community_referral_codes_code_unique unique (code),
  constraint community_referral_codes_code_format
    check (code ~ '^[A-Z0-9]{6,16}$')
);

create index if not exists community_referral_codes_active_idx
  on public.community_referral_codes(is_active);

create table if not exists public.community_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  referred_subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  referral_code text not null,
  source text not null default 'community_popup',
  status text not null default 'registered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_referrals_status_check
    check (status in ('registered', 'qualified', 'rewarded', 'cancelled')),
  constraint community_referrals_unique_pair
    unique (referrer_subscriber_id, referred_subscriber_id),
  constraint community_referrals_no_self_referral
    check (referrer_subscriber_id <> referred_subscriber_id)
);

create index if not exists community_referrals_referrer_idx
  on public.community_referrals(referrer_subscriber_id, created_at desc);

create index if not exists community_referrals_referred_idx
  on public.community_referrals(referred_subscriber_id);

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
  created_at timestamptz not null default now(),
  constraint community_points_event_type_check
    check (event_type in (
      'join',
      'vote',
      'survey_response',
      'referral',
      'purchase',
      'repurchase',
      'manual_adjustment',
      'reward_redemption'
    ))
);

create unique index if not exists community_points_ledger_idempotency_idx
  on public.community_points_ledger(idempotency_key);

create index if not exists community_points_ledger_subscriber_idx
  on public.community_points_ledger(subscriber_id, created_at desc);

create table if not exists public.community_member_status (
  subscriber_id uuid primary key references public.subscribers(id) on delete cascade,
  points_total integer not null default 0,
  level_key text not null default 'miembro' references public.community_levels(key),
  is_vip boolean not null default false,
  referral_code text null,
  last_activity_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists community_member_status_level_idx
  on public.community_member_status(level_key, points_total desc);

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
  updated_at timestamptz not null default now(),
  constraint community_vip_rewards_discount_type_check
    check (discount_type in ('percent', 'fixed', 'free_shipping', 'gift'))
);

create index if not exists community_vip_rewards_active_idx
  on public.community_vip_rewards(is_active, starts_at, ends_at);

create table if not exists public.community_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.community_vip_rewards(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  points_spent integer not null default 0,
  redemption_code text null,
  status text not null default 'reserved',
  created_at timestamptz not null default now(),
  redeemed_at timestamptz null,
  constraint community_reward_redemptions_status_check
    check (status in ('reserved', 'redeemed', 'expired', 'cancelled')),
  constraint community_reward_redemptions_unique_reward_subscriber
    unique (reward_id, subscriber_id)
);

create index if not exists community_reward_redemptions_subscriber_idx
  on public.community_reward_redemptions(subscriber_id, created_at desc);

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
  updated_at timestamptz not null default now(),
  constraint transparency_wall_items_status_check
    check (status in (
      'idea_proposed',
      'idea_in_validation',
      'product_in_development',
      'product_launched'
    ))
);

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
