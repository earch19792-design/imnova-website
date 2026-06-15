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
    raise exception 'public.subscribers.id must be uuid before creating communication_preferences';
  end if;
end $$;

create table if not exists public.communication_preferences (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'email')),
  opted_in boolean not null default false,
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  source text not null default 'community_popup',
  consent_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscriber_id, channel)
);

create index if not exists communication_preferences_subscriber_id_idx
  on public.communication_preferences(subscriber_id);

create index if not exists communication_preferences_channel_opted_in_idx
  on public.communication_preferences(channel, opted_in);

alter table public.communication_preferences enable row level security;

do $$
begin
  if to_regprocedure('public.is_admin()') is not null then
    execute 'drop policy if exists "admin manage communication preferences" on public.communication_preferences';

    execute 'create policy "admin manage communication preferences"
      on public.communication_preferences
      for all
      using (public.is_admin())
      with check (public.is_admin())';
  end if;
end $$;

grant select, insert, update, delete on public.communication_preferences to authenticated;

notify pgrst, 'reload schema';
