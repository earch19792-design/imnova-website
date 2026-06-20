-- Core product schema required before product extension migrations.
-- Safe for local/staging rebuilds and non-destructive in existing databases.

create extension if not exists pgcrypto;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant all on sequences to service_role;

alter default privileges in schema public
  grant execute on functions to service_role;

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

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  nombre text,
  telefono text,
  email text,
  nichos jsonb not null default '[]'::jsonb,
  objetivo_principal text,
  source text not null default 'community_popup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscribers_nichos_array check (jsonb_typeof(nichos) = 'array')
);

create unique index if not exists subscribers_email_unique_idx
  on public.subscribers(lower(email))
  where email is not null and btrim(email) <> '';

create unique index if not exists subscribers_phone_unique_idx
  on public.subscribers(telefono)
  where telefono is not null and btrim(telefono) <> '';

create index if not exists subscribers_created_at_idx
  on public.subscribers(created_at desc);

drop trigger if exists set_subscribers_updated_at on public.subscribers;
create trigger set_subscribers_updated_at
  before update on public.subscribers
  for each row
  execute function public.set_updated_at();

create table if not exists public.product_states (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  description text,
  progress integer not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_states_name_unique unique (name),
  constraint product_states_slug_unique unique (slug),
  constraint product_states_progress_range check (progress >= 0 and progress <= 100)
);

insert into public.product_states (
  name,
  slug,
  description,
  progress,
  sort_order,
  is_active
)
values
  ('Idea', 'idea', 'Producto o concepto en etapa inicial.', 5, 10, true),
  ('Validación', 'validacion', 'Producto en validación con comunidad o señales de mercado.', 20, 20, true),
  ('Priorizado', 'priorizado', 'Producto priorizado para desarrollo interno.', 35, 30, true),
  ('Testing', 'testing', 'Producto en pruebas o ajustes previos a producción.', 55, 40, true),
  ('Producción', 'produccion', 'Producto en preparación, fabricación o abastecimiento.', 75, 50, true),
  ('Comercialización', 'comercializacion', 'Producto en preparación comercial o canales.', 90, 60, true),
  ('Disponible', 'disponible', 'Producto disponible para compra.', 100, 70, true)
on conflict (name) do update set
  slug = excluded.slug,
  description = excluded.description,
  progress = excluded.progress,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text,
  name text not null,
  title text,
  category text,
  commercial_category text,
  status text,
  description text,
  short_description text,
  image_url text,
  image text,
  price numeric(12,2),
  currency text not null default 'USD',
  state_id uuid references public.product_states(id) on delete set null,
  direct_url text,
  amazon_url text,
  ebay_url text,
  tiktok_url text,
  launch_promo_enabled boolean not null default false,
  launch_discount_percent numeric(5,2),
  launch_promo_start_at timestamptz,
  launch_promo_end_at timestamptz,
  launch_promo_duration_days integer,
  usage_moment text,
  main_benefit text,
  how_to_use text,
  usage_description text,
  routine_suggestion jsonb not null default '[]'::jsonb,
  benefits jsonb not null default '[]'::jsonb,
  bullets jsonb not null default '[]'::jsonb,
  functional_claims jsonb not null default '[]'::jsonb,
  ingredients_summary text,
  lifestyle_image text,
  lifestyle_images jsonb not null default '[]'::jsonb,
  nicho text,
  subniche text,
  problema_resuelve text,
  expected_benefit text,
  survey_status text,
  survey_score integer,
  survey_votes integer not null default 0,
  social_interest_score integer,
  validation_status text,
  validation_decision text,
  validation_notes text,
  target_customer text,
  distribution_channels jsonb not null default '[]'::jsonb,
  commercial_notes text,
  featured boolean not null default false,
  visible boolean not null default true,
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_price_non_negative check (price is null or price >= 0),
  constraint products_survey_score_range check (survey_score is null or (survey_score >= 0 and survey_score <= 100)),
  constraint products_survey_votes_non_negative check (survey_votes >= 0),
  constraint products_social_interest_score_range check (social_interest_score is null or (social_interest_score >= 0 and social_interest_score <= 100)),
  constraint products_launch_discount_range check (launch_discount_percent is null or (launch_discount_percent >= 0 and launch_discount_percent <= 100)),
  constraint products_routine_suggestion_array check (jsonb_typeof(routine_suggestion) = 'array'),
  constraint products_benefits_array check (jsonb_typeof(benefits) = 'array'),
  constraint products_bullets_array check (jsonb_typeof(bullets) = 'array'),
  constraint products_functional_claims_array check (jsonb_typeof(functional_claims) = 'array'),
  constraint products_distribution_channels_array check (jsonb_typeof(distribution_channels) = 'array'),
  constraint products_lifestyle_images_base_array check (jsonb_typeof(lifestyle_images) = 'array')
);

create unique index if not exists products_slug_unique_idx
  on public.products(slug)
  where slug is not null and btrim(slug) <> '';

create index if not exists products_slug_idx
  on public.products(slug);

create index if not exists products_state_id_idx
  on public.products(state_id);

create index if not exists products_status_idx
  on public.products(status);

create index if not exists products_category_idx
  on public.products(category);

create index if not exists products_public_active_idx
  on public.products(is_public, is_active, state_id, created_at desc);

create index if not exists products_created_at_idx
  on public.products(created_at desc);

drop trigger if exists set_product_states_updated_at on public.product_states;
create trigger set_product_states_updated_at
  before update on public.product_states
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
  before update on public.products
  for each row
  execute function public.set_updated_at();

alter table public.product_states enable row level security;
alter table public.products enable row level security;
alter table public.subscribers enable row level security;

drop policy if exists "admin manage subscribers" on public.subscribers;
create policy "admin manage subscribers"
  on public.subscribers
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public read active product states" on public.product_states;
create policy "public read active product states"
  on public.product_states
  for select
  using (is_active = true);

drop policy if exists "admin manage product states" on public.product_states;
create policy "admin manage product states"
  on public.product_states
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public read public active products" on public.products;
create policy "public read public active products"
  on public.products
  for select
  using (is_public = true and is_active = true and visible = true);

drop policy if exists "admin manage products" on public.products;
create policy "admin manage products"
  on public.products
  for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace view public.public_products
with (security_invoker = true)
as
select
  id,
  slug,
  name,
  category,
  description,
  image_url,
  image,
  price,
  currency,
  state_id,
  direct_url,
  amazon_url,
  ebay_url,
  tiktok_url,
  launch_promo_enabled,
  launch_discount_percent,
  launch_promo_start_at,
  launch_promo_end_at,
  launch_promo_duration_days,
  usage_moment,
  main_benefit,
  how_to_use,
  usage_description,
  routine_suggestion,
  benefits,
  bullets,
  functional_claims,
  ingredients_summary,
  lifestyle_image,
  lifestyle_images,
  nicho,
  problema_resuelve,
  expected_benefit,
  survey_status,
  survey_score,
  survey_votes,
  social_interest_score,
  validation_status,
  validation_decision,
  created_at
from public.products
where is_public = true
  and is_active = true
  and visible = true;

grant select on public.product_states to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.public_products to anon, authenticated;
grant select, insert, update, delete on public.subscribers to authenticated;
grant insert, update, delete on public.product_states to authenticated;
grant insert, update, delete on public.products to authenticated;
grant all on all tables in schema public to service_role;
grant all on all routines in schema public to service_role;

notify pgrst, 'reload schema';
