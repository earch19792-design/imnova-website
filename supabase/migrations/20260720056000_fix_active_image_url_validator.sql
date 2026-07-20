create or replace function public.is_exact_six_ebay_revision_urls(p_urls jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_urls) = 'array'
    and jsonb_array_length(p_urls) = 6
    and (select count(distinct value) from jsonb_array_elements_text(p_urls)) = 6
    and not exists (
      select 1 from jsonb_array_elements_text(p_urls) image(value)
      where image.value !~ '^https://[^[:space:][:cntrl:]]+$'
        or char_length(image.value) > 492
    )
    and coalesce((
      select sum(char_length(value)) from jsonb_array_elements_text(p_urls)
    ), 0) <= 3975;
$$;

comment on function public.is_exact_six_ebay_revision_urls(jsonb) is
  'Validates six distinct HTTPS image URLs with explicit PostgreSQL-safe length bounds.';
