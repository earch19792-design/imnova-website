create extension if not exists pgcrypto;

create table if not exists public.idea_lab_items (
  id uuid primary key default gen_random_uuid(),
  trend_radar_signal_id uuid null references public.trend_radar_signals(id) on delete set null,
  title text not null,
  summary text not null,
  suggested_product text null,
  recommendation text null,
  source text null,
  evidence_url text null,
  evidence_note text null,
  niche_id uuid null references public.strategic_niches(id) on delete set null,
  subniche_id uuid null references public.strategic_subniches(id) on delete set null,
  area_id uuid null references public.community_interest_areas(id) on delete set null,
  signal_strength integer null,
  risk_level text null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint idea_lab_items_status_check
    check (status in ('draft', 'under_review', 'ready_for_validation', 'dismissed', 'converted_to_product'))
);

alter table public.idea_lab_items enable row level security;

drop policy if exists "admin manage idea lab items"
  on public.idea_lab_items;

create policy "admin manage idea lab items"
  on public.idea_lab_items
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.idea_lab_items
  to authenticated;

alter table public.trend_radar_signals
  add column if not exists converted_idea_id uuid null references public.idea_lab_items(id) on delete set null;

create index if not exists idea_lab_items_trend_radar_signal_id_idx
  on public.idea_lab_items(trend_radar_signal_id);

create index if not exists idea_lab_items_status_idx
  on public.idea_lab_items(status);

create index if not exists idea_lab_items_created_at_idx
  on public.idea_lab_items(created_at desc);

create index if not exists trend_radar_signals_converted_idea_id_idx
  on public.trend_radar_signals(converted_idea_id);

notify pgrst, 'reload schema';
