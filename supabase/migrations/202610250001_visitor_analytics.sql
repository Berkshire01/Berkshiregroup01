-- Berkshire Group 01 visitor analytics.
-- Apply this migration in the Supabase SQL Editor before deploying visitor-relay.

create extension if not exists pgcrypto;

create table if not exists public.visitor_analytics (
  id uuid primary key default gen_random_uuid(),
  visited_at timestamptz not null default now(),
  page_path text not null check (char_length(page_path) between 1 and 300),
  referrer_host text null check (referrer_host is null or char_length(referrer_host) <= 253),
  referrer_path text null check (referrer_path is null or char_length(referrer_path) <= 300),
  source text not null default 'direct' check (char_length(source) between 1 and 253)
);

create index if not exists visitor_analytics_visited_at_idx
  on public.visitor_analytics (visited_at desc);

create index if not exists visitor_analytics_source_idx
  on public.visitor_analytics (source);

alter table public.visitor_analytics enable row level security;

revoke all on table public.visitor_analytics from anon, authenticated;
grant select, insert, update, delete on table public.visitor_analytics to service_role;
