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
    raise exception 'public.subscribers.id must be uuid before creating subscriber_area_interests';
  end if;
end $$;

create table if not exists public.community_interest_areas (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.community_interest_areas
  (key, label, description, is_active, display_order)
values
  (
    'bienestar_salud_natural',
    'Bienestar y Salud Natural',
    'Vida saludable, productos naturales y nutricion funcional para el dia a dia.',
    true,
    10
  ),
  (
    'fitness_rendimiento_recuperacion',
    'Fitness, Rendimiento y Recuperacion',
    'Energia, hidratacion, proteina y recuperacion para una vida activa.',
    true,
    20
  ),
  (
    'salud_funcionalidad_especifica',
    'Salud y Funcionalidad Especifica',
    'Digestion, defensas, descanso, enfoque, estres y soporte funcional.',
    true,
    30
  ),
  (
    'cuidado_belleza_natural',
    'Cuidado Personal y Belleza Natural',
    'Colageno, piel, cabello y cuidado natural con enfoque funcional.',
    true,
    40
  ),
  (
    'bienestar_animal_mascotas',
    'Bienestar Animal y Cuidado de Mascotas',
    'Productos, bienestar y cuidado funcional para mascotas y animales.',
    true,
    50
  )
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  display_order = excluded.display_order;

create table if not exists public.subscriber_area_interests (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  area_id uuid not null references public.community_interest_areas(id) on delete restrict,
  source text not null default 'community_popup',
  created_at timestamptz not null default now(),
  unique(subscriber_id, area_id)
);

create index if not exists subscriber_area_interests_subscriber_id_idx
  on public.subscriber_area_interests(subscriber_id);

create index if not exists subscriber_area_interests_area_id_idx
  on public.subscriber_area_interests(area_id);

alter table public.community_interest_areas enable row level security;
alter table public.subscriber_area_interests enable row level security;

drop policy if exists "public read active community interest areas"
  on public.community_interest_areas;

create policy "public read active community interest areas"
  on public.community_interest_areas
  for select
  using (is_active = true);

do $$
begin
  if to_regprocedure('public.is_admin()') is not null then
    execute 'drop policy if exists "admin manage community interest areas" on public.community_interest_areas';

    execute 'create policy "admin manage community interest areas"
      on public.community_interest_areas
      for all
      using (public.is_admin())
      with check (public.is_admin())';

    execute 'drop policy if exists "admin manage subscriber area interests" on public.subscriber_area_interests';

    execute 'create policy "admin manage subscriber area interests"
      on public.subscriber_area_interests
      for all
      using (public.is_admin())
      with check (public.is_admin())';
  end if;
end $$;
