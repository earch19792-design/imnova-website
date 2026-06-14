create extension if not exists pgcrypto;

create table if not exists public.trend_radar_signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  title text not null,
  summary text not null,
  niche_id uuid null references public.strategic_niches(id) on delete set null,
  subniche_id uuid null references public.strategic_subniches(id) on delete set null,
  area_id uuid null references public.community_interest_areas(id) on delete set null,
  signal_strength integer not null default 1,
  opportunity_type text not null,
  evidence_url text null,
  evidence_note text null,
  suggested_product text null,
  risk_level text not null default 'medium',
  recommendation text null,
  status text not null default 'new',
  reviewed_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trend_radar_signals_signal_strength_check
    check (signal_strength between 1 and 5),
  constraint trend_radar_signals_status_check
    check (status in ('new', 'under_review', 'candidate', 'dismissed', 'converted_to_idea')),
  constraint trend_radar_signals_opportunity_type_check
    check (opportunity_type in ('producto_emergente', 'categoria_en_crecimiento', 'problema_repetido', 'ingrediente_tendencia', 'demanda_sin_producto', 'producto_con_alta_intencion')),
  constraint trend_radar_signals_risk_level_check
    check (risk_level in ('low', 'medium', 'high'))
);

create index if not exists trend_radar_signals_status_idx
  on public.trend_radar_signals(status);

create index if not exists trend_radar_signals_source_idx
  on public.trend_radar_signals(source);

create index if not exists trend_radar_signals_opportunity_type_idx
  on public.trend_radar_signals(opportunity_type);

create index if not exists trend_radar_signals_signal_strength_idx
  on public.trend_radar_signals(signal_strength);

create index if not exists trend_radar_signals_created_at_idx
  on public.trend_radar_signals(created_at desc);

create index if not exists trend_radar_signals_niche_subniche_idx
  on public.trend_radar_signals(niche_id, subniche_id);

create index if not exists trend_radar_signals_area_id_idx
  on public.trend_radar_signals(area_id);

alter table public.trend_radar_signals enable row level security;

drop policy if exists "admin manage trend radar signals"
  on public.trend_radar_signals;

create policy "admin manage trend radar signals"
  on public.trend_radar_signals
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.trend_radar_signals to authenticated;

notify pgrst, 'reload schema';
