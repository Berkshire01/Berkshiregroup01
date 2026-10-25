-- Berkshire Group 01 employment applications.
-- Apply this migration in the NEW Supabase project's SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.employment_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new'
    check (status in ('new','in_review','interview','hired','rejected','withdrawn')),
  notification_status text not null default 'not_configured',
  payload jsonb not null,
  front_storage_path text not null,
  back_storage_path text not null
);

alter table public.employment_applications enable row level security;
revoke all on table public.employment_applications from anon, authenticated;
grant select, insert, update, delete on table public.employment_applications to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employment-id-documents',
  'employment-id-documents',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are added for anon/authenticated.
-- Edge Functions use service_role to upload and create short-lived signed URLs.
