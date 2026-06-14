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
    raise exception 'public.subscribers.id must be uuid before creating community_idea_votes';
  end if;
end $$;

create table if not exists public.community_idea_votes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid null references public.products(id) on delete set null,
  idea_key text null,
  idea_title text not null,
  subscriber_id uuid null references public.subscribers(id) on delete set null,
  email text null,
  phone text null,
  vote_type text not null,
  source text not null default 'idea_active',
  strategic_niche_id uuid null references public.strategic_niches(id) on delete set null,
  subniche_id uuid null references public.strategic_subniches(id) on delete set null,
  area_id uuid null references public.community_interest_areas(id) on delete set null,
  dedupe_key text not null,
  user_agent text null,
  ip_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_idea_votes_vote_type_check
    check (vote_type in ('interested', 'not_interested', 'would_buy', 'wants_trial')),
  constraint community_idea_votes_target_check
    check (product_id is not null or nullif(trim(idea_key), '') is not null)
);

create unique index if not exists community_idea_votes_dedupe_key_idx
  on public.community_idea_votes(dedupe_key);

create index if not exists community_idea_votes_product_id_idx
  on public.community_idea_votes(product_id);

create index if not exists community_idea_votes_idea_key_idx
  on public.community_idea_votes(idea_key);

create index if not exists community_idea_votes_vote_type_idx
  on public.community_idea_votes(vote_type);

create index if not exists community_idea_votes_created_at_idx
  on public.community_idea_votes(created_at desc);

create index if not exists community_idea_votes_niche_subniche_idx
  on public.community_idea_votes(strategic_niche_id, subniche_id);

alter table public.community_idea_votes enable row level security;

drop policy if exists "admin manage community idea votes"
  on public.community_idea_votes;

create policy "admin manage community idea votes"
  on public.community_idea_votes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.community_idea_votes to authenticated;

notify pgrst, 'reload schema';
