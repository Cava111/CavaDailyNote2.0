-- Cava full safe-data sync migration
-- Run after 001_messages_sync.sql. Safe to run more than once.

begin;

alter table public.cava_messages
    add column if not exists related_entity_type text,
    add column if not exists related_sync_id uuid;

alter table public.cava_messages
    drop constraint if exists cava_messages_type_check;

create index if not exists cava_messages_related_sync_idx
    on public.cava_messages (user_id, related_entity_type, related_sync_id)
    where related_sync_id is not null;

create table if not exists public.cava_records (
    user_id uuid not null references auth.users(id) on delete cascade,
    entity_type text not null check (entity_type in (
        'api_proxy',
        'ai_character',
        'transaction',
        'transaction_template',
        'currency',
        'schedule',
        'diary',
        'memory',
        'app_config'
    )),
    id uuid not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    primary key (user_id, entity_type, id)
);

create index if not exists cava_records_user_updated_idx
    on public.cava_records (user_id, updated_at);

create index if not exists cava_records_user_entity_updated_idx
    on public.cava_records (user_id, entity_type, updated_at);

alter table public.cava_records enable row level security;

revoke all on table public.cava_records from anon;
revoke all on table public.cava_records from authenticated;
grant select, insert, update on table public.cava_records to authenticated;
grant all on table public.cava_records to service_role;

drop policy if exists "cava_records_select_own" on public.cava_records;
create policy "cava_records_select_own"
    on public.cava_records
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "cava_records_insert_own" on public.cava_records;
create policy "cava_records_insert_own"
    on public.cava_records
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "cava_records_update_own" on public.cava_records;
create policy "cava_records_update_own"
    on public.cava_records
    for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

comment on table public.cava_records is
    'Local-first Cava non-binary records. Frontend strips Base64 media and secret fields before upload.';

commit;
