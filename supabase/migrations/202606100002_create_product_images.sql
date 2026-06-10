create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  image_type text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_image_type_check check (
    image_type in (
      'store_main',
      'store_gallery',
      'usage',
      'detail',
      'banner',
      'thumbnail'
    )
  ),
  constraint product_images_unique_product_type_url unique (
    product_id,
    image_type,
    image_url
  )
);

create index if not exists product_images_product_id_idx
  on public.product_images(product_id);

create index if not exists product_images_active_type_idx
  on public.product_images(product_id, image_type, is_active, sort_order);

alter table public.product_images
enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'product_images'
      and policyname = 'Public can read active product images'
  ) then
    create policy "Public can read active product images"
      on public.product_images
      for select
      using (is_active = true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'product_images'
      and policyname = 'Authenticated can manage product images'
  ) then
    create policy "Authenticated can manage product images"
      on public.product_images
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

insert into public.product_images (
  product_id,
  image_url,
  image_type,
  alt_text,
  sort_order,
  is_primary,
  is_active
)
select
  id,
  '/images/products/store/mash-coffee/mash-coffee-lata-250ml-frontal.webp',
  'store_main',
  'MASH Coffee+ lata 250ml vista frontal',
  10,
  true,
  true
from public.products
where slug = 'mash-coffee'
on conflict (product_id, image_type, image_url)
do update set
  alt_text = excluded.alt_text,
  sort_order = excluded.sort_order,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active;

insert into public.product_images (
  product_id,
  image_url,
  image_type,
  alt_text,
  sort_order,
  is_primary,
  is_active
)
select
  id,
  '/images/products/store/mash-coffee/mash-coffee-6-pack-frontal.webp',
  'store_main',
  'MASH Coffee+ 6 pack vista frontal',
  10,
  true,
  true
from public.products
where slug = 'mash-coffee-6pack'
on conflict (product_id, image_type, image_url)
do update set
  alt_text = excluded.alt_text,
  sort_order = excluded.sort_order,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active;

insert into public.product_images (
  product_id,
  image_url,
  image_type,
  alt_text,
  sort_order,
  is_primary,
  is_active
)
select
  id,
  '/images/products/store/mash-coffee/mash-coffee-12-pack-frontal.webp',
  'store_main',
  'MASH Coffee+ 12 pack vista frontal',
  10,
  true,
  true
from public.products
where slug = 'mash-coffee-12pack'
on conflict (product_id, image_type, image_url)
do update set
  alt_text = excluded.alt_text,
  sort_order = excluded.sort_order,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active;

insert into public.product_images (
  product_id,
  image_url,
  image_type,
  alt_text,
  sort_order,
  is_primary,
  is_active
)
select
  id,
  '/images/products/store/mash-nutri-pancake/mash-nutri-pancake-150g-frontal.webp',
  'store_main',
  'MASH NUTRI+ Pancake 150g vista frontal',
  10,
  true,
  true
from public.products
where slug = 'mash-nutri-pancake'
on conflict (product_id, image_type, image_url)
do update set
  alt_text = excluded.alt_text,
  sort_order = excluded.sort_order,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active;

insert into public.product_images (
  product_id,
  image_url,
  image_type,
  alt_text,
  sort_order,
  is_primary,
  is_active
)
select
  id,
  '/images/products/store/mash-nutri-pan/mash-nutra-pan-proteinico-200g-frontal.webp',
  'store_main',
  'MASH NUTRA+ pan proteico 200g vista frontal',
  10,
  true,
  true
from public.products
where slug = 'mash-nutri-pan'
on conflict (product_id, image_type, image_url)
do update set
  alt_text = excluded.alt_text,
  sort_order = excluded.sort_order,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active;

insert into public.product_images (
  product_id,
  image_url,
  image_type,
  alt_text,
  sort_order,
  is_primary,
  is_active
)
select
  products.id,
  images.image_url,
  images.image_type,
  images.alt_text,
  images.sort_order,
  false,
  true
from public.products
join (
  values
    ('mash-coffee', '/images/products/usage/mash-coffee/mash-coffee-hielo-leche.webp', 'usage', 'MASH Coffee+ servido frío con leche', 10),
    ('mash-coffee', '/images/products/usage/mash-coffee/mash-coffee-oficina-enfoque.webp', 'usage', 'MASH Coffee+ en rutina de oficina', 20),
    ('mash-coffee', '/images/products/usage/mash-coffee/mash-coffee-estudio-energia.webp', 'usage', 'MASH Coffee+ en momento de estudio', 30),
    ('mash-coffee-6pack', '/images/products/usage/mash-coffee/mash-coffee-6-pack-mercado.webp', 'usage', 'MASH Coffee+ 6 pack en mercado', 10),
    ('mash-coffee-12pack', '/images/products/usage/mash-coffee/mash-coffee-12-pack-mercado.webp', 'usage', 'MASH Coffee+ 12 pack en mercado', 10),
    ('mash-nutri-pancake', '/images/products/usage/mash-nutri-pancake/pancake-desayuno-frutas.webp', 'usage', 'MASH NUTRI+ Pancake en desayuno con frutas', 10),
    ('mash-nutri-pancake', '/images/products/usage/mash-nutri-pancake/pancake-rutina-saludable.webp', 'usage', 'MASH NUTRI+ Pancake en rutina saludable', 20),
    ('mash-nutri-pancake', '/images/products/usage/mash-nutri-pancake/pancake-beneficios.webp', 'usage', 'MASH NUTRI+ Pancake beneficios visuales', 30),
    ('mash-nutri-pan', '/images/products/usage/mash-nutri-pan/pan-proteinico-tostadas.webp', 'usage', 'MASH NUTRA+ pan proteico en tostadas', 10),
    ('mash-nutri-pan', '/images/products/usage/mash-nutri-pan/pan-proteinico-sandwich.webp', 'usage', 'MASH NUTRA+ pan proteico para sandwich', 20),
    ('mash-nutri-pan', '/images/products/usage/mash-nutri-pan/pan-proteinico-cocina.webp', 'usage', 'MASH NUTRA+ pan proteico en cocina', 30)
) as images(slug, image_url, image_type, alt_text, sort_order)
  on products.slug = images.slug
on conflict (product_id, image_type, image_url)
do update set
  alt_text = excluded.alt_text,
  sort_order = excluded.sort_order,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active;
