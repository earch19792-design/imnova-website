-- PostgreSQL's POSIX regular-expression engine rejects interval bounds above
-- 255. The previous one-to-one-thousand interval therefore raised SQLSTATE 2201B
-- instead of returning a validation result. Keep the 1000-byte contract as an
-- explicit length predicate and use an unbounded, control-safe regex.

create or replace function public.is_mayel_phase_b_image_url_set_v1(
  p_urls jsonb,
  p_main_url text
)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_urls) = 'array'
    and jsonb_array_length(p_urls) between 1 and 24
    and p_main_url = p_urls ->> 0
    and (select count(distinct value)
      from jsonb_array_elements_text(p_urls)) = jsonb_array_length(p_urls)
    and not exists (
      select 1 from jsonb_array_elements_text(p_urls) image(value)
      where char_length(image.value) not between 1 and 1000
        or image.value !~ '^https://[^[:space:][:cntrl:]]+$'
    );
$$;

revoke all on function public.is_mayel_phase_b_image_url_set_v1(jsonb, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
