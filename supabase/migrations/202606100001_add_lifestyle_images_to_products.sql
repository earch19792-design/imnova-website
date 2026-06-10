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
  "/images/lifestyle/mash-coffee-01.webp",
  "/images/lifestyle/mash-coffee-02.webp",
  "/images/lifestyle/mash-coffee-03.webp"
]'::jsonb
where slug = 'mash-coffee';

update public.products
set lifestyle_images = '[
  "/images/lifestyle/mash-nutra-01.webp",
  "/images/lifestyle/mash-nutra-02.webp",
  "/images/lifestyle/mash-nutra-03.webp"
]'::jsonb
where slug = 'mash-nutri-pan';

update public.products
set lifestyle_images = '[
  "/images/lifestyle/mash-pancake-01.webp",
  "/images/lifestyle/mash-pancake-02.webp",
  "/images/lifestyle/mash-pancake-03.webp"
]'::jsonb
where slug = 'mash-nutri-pancake';

update public.products
set lifestyle_images = '[
  "/images/lifestyle/mash-6pack.webp"
]'::jsonb
where slug = 'mash-coffee-6pack';

update public.products
set lifestyle_images = '[
  "/images/lifestyle/mash-12pack.webp"
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
