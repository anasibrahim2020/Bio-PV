-- ═══════════════════════════════════════════════════════════════
--  Bio Nutrition — Push Notification Subscriptions
--  One row per subscribed browser/device. Written by the app when a
--  user enables notifications; read by the push-notify Edge Function
--  (via the service_role key, which bypasses RLS) to send pushes.
--  Run this ONCE in:  Supabase Dashboard > SQL Editor > New query > Run
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id           bigint generated always as identity primary key,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_email   text not null,
  role         text,                 -- 'accountant' | 'viewer' — who to notify, not a security boundary
  user_agent   text,
  created_at   timestamptz default now()
);

create index if not exists push_subs_email_idx on public.push_subscriptions (user_email);

-- Row Level Security ────────────────────────────────────────────
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_select_own on public.push_subscriptions;
drop policy if exists push_subs_insert_own on public.push_subscriptions;
drop policy if exists push_subs_update_own on public.push_subscriptions;
drop policy if exists push_subs_delete_own on public.push_subscriptions;

-- A user may only see / add / change / remove THEIR OWN subscription rows.
-- (The Edge Function reads every row via the service_role key, which
--  bypasses RLS entirely — no "select all" policy is needed here.)
create policy push_subs_select_own
  on public.push_subscriptions for select
  to authenticated
  using ( user_email = (auth.jwt() ->> 'email') );

create policy push_subs_insert_own
  on public.push_subscriptions for insert
  to authenticated
  with check ( user_email = (auth.jwt() ->> 'email') );

create policy push_subs_update_own
  on public.push_subscriptions for update
  to authenticated
  using      ( user_email = (auth.jwt() ->> 'email') )
  with check ( user_email = (auth.jwt() ->> 'email') );

create policy push_subs_delete_own
  on public.push_subscriptions for delete
  to authenticated
  using ( user_email = (auth.jwt() ->> 'email') );

-- ═══════════════════════════════════════════════════════════════
--  Done. Next: create the push-notify Edge Function, add its 3
--  secrets, then wire the 2 Database Webhooks — see SETUP-BioNutrition.md
-- ═══════════════════════════════════════════════════════════════
