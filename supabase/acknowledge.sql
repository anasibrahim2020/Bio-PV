-- ═══════════════════════════════════════════════════════════════
--  Bio Nutrition — Partner Acknowledgements
--  Each partner confirms ("acknowledges") they saw a voucher's transfer.
--  Run this ONCE in:  Supabase Dashboard > SQL Editor > New query > Run
-- ═══════════════════════════════════════════════════════════════

-- 1) Acknowledgements table (separate from `requests` so partners can
--    record their own acknowledgement WITHOUT being able to edit vouchers)
create table if not exists public.voucher_acks (
  id            bigint generated always as identity primary key,
  request_id    bigint not null references public.requests(id) on delete cascade,
  partner_email text   not null,
  partner_name  text,
  acked_at      timestamptz default now(),
  unique (request_id, partner_email)     -- one acknowledgement per partner per voucher
);

create index if not exists voucher_acks_request_idx on public.voucher_acks (request_id);

-- 2) Row Level Security
alter table public.voucher_acks enable row level security;

drop policy if exists acks_select_all  on public.voucher_acks;
drop policy if exists acks_insert_own  on public.voucher_acks;
drop policy if exists acks_delete_own  on public.voucher_acks;

-- (a) READ: every signed-in user sees all acknowledgements (full transparency)
create policy acks_select_all
  on public.voucher_acks for select
  to authenticated
  using ( true );

-- (b) INSERT: a user may acknowledge ONLY as themselves (their own email) —
--     they cannot acknowledge on behalf of another partner
create policy acks_insert_own
  on public.voucher_acks for insert
  to authenticated
  with check ( partner_email = (auth.jwt() ->> 'email') );

-- (c) DELETE: a user may remove ONLY their own acknowledgement (un-acknowledge)
create policy acks_delete_own
  on public.voucher_acks for delete
  to authenticated
  using ( partner_email = (auth.jwt() ->> 'email') );

-- ═══════════════════════════════════════════════════════════════
--  Done. Partners: hassan, abaza, ahmednabel  (each @bionutritionmedical.com)
--  Admin (Anas) still writes vouchers; partners only read + acknowledge.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
--  Voucher comments (public thread — anyone signed in writes, everyone reads)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.voucher_comments (
  id           bigint generated always as identity primary key,
  request_id   bigint not null references public.requests(id) on delete cascade,
  author_email text   not null,
  author_name  text,
  author_role  text,
  body         text   not null,
  created_at   timestamptz default now()
);
create index if not exists voucher_comments_request_idx on public.voucher_comments (request_id, created_at);

alter table public.voucher_comments enable row level security;

drop policy if exists cmt_select_all  on public.voucher_comments;
drop policy if exists cmt_insert_own   on public.voucher_comments;
drop policy if exists cmt_update_own    on public.voucher_comments;
drop policy if exists cmt_delete_own     on public.voucher_comments;

-- READ: everyone signed in sees every comment
create policy cmt_select_all on public.voucher_comments for select to authenticated using ( true );
-- WRITE: a user may add / edit / delete ONLY their own comments (their email)
create policy cmt_insert_own on public.voucher_comments for insert to authenticated with check ( author_email = (auth.jwt() ->> 'email') );
create policy cmt_update_own on public.voucher_comments for update to authenticated using ( author_email = (auth.jwt() ->> 'email') ) with check ( author_email = (auth.jwt() ->> 'email') );
create policy cmt_delete_own on public.voucher_comments for delete to authenticated using ( author_email = (auth.jwt() ->> 'email') );
