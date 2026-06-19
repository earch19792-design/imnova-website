-- Reconcile normalized subscriber subniche interests.
-- This table is intentionally separate from subscriber_area_interests:
-- - subscriber_area_interests stores broad public areas selected in the popup.
-- - subscriber_interests stores specific subniche signals used for demand,
--   Admin actions, surveys, segmented launches, and fine-grained analytics.

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
    raise exception 'public.subscribers.id must be uuid before creating subscriber_interests';
  end if;

  if to_regclass('public.strategic_subniches') is null then
    raise exception 'public.strategic_subniches must exist before creating subscriber_interests';
  end if;
end $$;

alter table public.strategic_niches
  add column if not exists public_name text,
  add column if not exists icon_key text,
  add column if not exists is_public boolean not null default true,
  add column if not exists priority_level integer not null default 0;

alter table public.strategic_subniches
  add column if not exists public_name text,
  add column if not exists icon_key text,
  add column if not exists is_public boolean not null default true,
  add column if not exists priority_level integer not null default 0;

update public.strategic_niches
set
  public_name = coalesce(public_name, name),
  icon_key = coalesce(icon_key, icon),
  is_public = coalesce(is_public, true)
where
  public_name is null
  or icon_key is null
  or is_public is null;

update public.strategic_subniches
set
  public_name = coalesce(public_name, name),
  icon_key = coalesce(icon_key, icon),
  is_public = coalesce(is_public, true)
where
  public_name is null
  or icon_key is null
  or is_public is null;

create table if not exists public.subscriber_interests (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  subniche_id uuid not null references public.strategic_subniches(id) on delete restrict,
  source text not null default 'community_popup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriber_interests_unique_subscriber_subniche
    unique (subscriber_id, subniche_id)
);

alter table public.subscriber_interests
  add column if not exists subscriber_id uuid,
  add column if not exists subniche_id uuid,
  add column if not exists source text not null default 'community_popup',
  add column if not exists created_at timestamptz not null default now(),
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

  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriber_interests_unique_subscriber_subniche'
      and conrelid = 'public.subscriber_interests'::regclass
  ) then
    alter table public.subscriber_interests
      add constraint subscriber_interests_unique_subscriber_subniche
      unique (subscriber_id, subniche_id);
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

drop trigger if exists set_subscriber_interests_updated_at
  on public.subscriber_interests;

create trigger set_subscriber_interests_updated_at
  before update on public.subscriber_interests
  for each row
  execute function public.set_updated_at();

alter table public.subscriber_interests enable row level security;

drop policy if exists "admin manage subscriber interests"
  on public.subscriber_interests;

create policy "admin manage subscriber interests"
  on public.subscriber_interests
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public read active public strategic niches"
  on public.strategic_niches;

create policy "public read active public strategic niches"
  on public.strategic_niches
  for select
  using (is_active = true and is_public = true);

drop policy if exists "public read active public strategic subniches"
  on public.strategic_subniches;

create policy "public read active public strategic subniches"
  on public.strategic_subniches
  for select
  using (is_active = true and is_public = true);

grant select
  on public.strategic_niches,
     public.strategic_subniches
  to anon, authenticated;

grant select, insert, update, delete
  on public.subscriber_interests
  to authenticated;

grant all
  on public.subscriber_interests
  to service_role;

notify pgrst, 'reload schema';
