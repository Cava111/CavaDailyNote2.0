-- Cava Pre-MCP / Messages Sync MVP
-- Safe to paste as one block into Supabase SQL Editor.

create table if not exists public.cava_messages (
    user_id uuid not null references auth.users(id) on delete cascade,
    id uuid not null,
    timestamp_ms bigint not null,
    role text not null check (role in ('user', 'assistant')),
    content text not null default '',
    type text not null check (type in ('text', 'emoji_pack')),
    sender_sync_id uuid,
    sender_name text,
    response_group_id text,
    source text not null default 'cava_app',
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    primary key (user_id, id)
);

create index if not exists cava_messages_user_updated_idx
    on public.cava_messages (user_id, updated_at);

create index if not exists cava_messages_user_timestamp_idx
    on public.cava_messages (user_id, timestamp_ms);

alter table public.cava_messages enable row level security;

revoke all on table public.cava_messages from anon;
revoke all on table public.cava_messages from authenticated;
grant select, insert, update on table public.cava_messages to authenticated;
grant all on table public.cava_messages to service_role;

drop policy if exists "cava_messages_select_own" on public.cava_messages;
create policy "cava_messages_select_own"
    on public.cava_messages
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "cava_messages_insert_own" on public.cava_messages;
create policy "cava_messages_insert_own"
    on public.cava_messages
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "cava_messages_update_own" on public.cava_messages;
create policy "cava_messages_update_own"
    on public.cava_messages
    for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

comment on table public.cava_messages is
    'Local-first Cava chat messages. deleted_at rows are sync tombstones and must not be returned by future MCP tools.';

