alter table public.products
add column if not exists lifestyle_images jsonb not null default '[]'::jsonb;

comment on column public.products.lifestyle_images is
  'Public lifestyle image URLs for product usage sections. Expected array with up to 3 image URLs.';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'lifestyle_image'
  ) then
    execute $sql$
      update public.products
      set lifestyle_images = jsonb_build_array(lifestyle_image)
      where jsonb_array_length(lifestyle_images) = 0
        and lifestyle_image is not null
        and btrim(lifestyle_image) <> ''
    $sql$;
  end if;
end $$;

update public.products
set lifestyle_images = '[
  "/images/products/usage/mash-coffee/mash-coffee-hielo-leche.webp",
  "/images/products/usage/mash-coffee/mash-coffee-oficina-enfoque.webp",
  "/images/products/usage/mash-coffee/mash-coffee-estudio-energia.webp"
]'::jsonb
where slug = 'mash-coffee';

update public.products
set lifestyle_images = '[
  "/images/products/usage/mash-nutri-pan/pan-proteinico-tostadas.webp",
  "/images/products/usage/mash-nutri-pan/pan-proteinico-sandwich.webp",
  "/images/products/usage/mash-nutri-pan/pan-proteinico-cocina.webp"
]'::jsonb
where slug = 'mash-nutri-pan';

update public.products
set lifestyle_images = '[
  "/images/products/usage/mash-nutri-pancake/pancake-desayuno-frutas.webp",
  "/images/products/usage/mash-nutri-pancake/pancake-rutina-saludable.webp",
  "/images/products/usage/mash-nutri-pancake/pancake-beneficios.webp"
]'::jsonb
where slug = 'mash-nutri-pancake';

update public.products
set lifestyle_images = '[
  "/images/products/usage/mash-coffee/mash-coffee-6-pack-mercado.webp"
]'::jsonb
where slug = 'mash-coffee-6pack';

update public.products
set lifestyle_images = '[
  "/images/products/usage/mash-coffee/mash-coffee-12-pack-mercado.webp"
]'::jsonb
where slug = 'mash-coffee-12pack';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_lifestyle_images_array'
  ) then
    alter table public.products
    add constraint products_lifestyle_images_array
    check (
      jsonb_typeof(lifestyle_images) = 'array'
      and jsonb_array_length(lifestyle_images) <= 3
    );
  end if;
end $$;
