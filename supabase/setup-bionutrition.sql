-- ═══════════════════════════════════════════════════════════════
--  Bio Nutrition — Payment Vouchers Portal
--  Full database setup — run this ONCE in:
--  Supabase Dashboard  >  SQL Editor  >  New query  >  Run
-- ═══════════════════════════════════════════════════════════════

-- ┌───────────────────────────────────────────────────────────┐
-- │ 0) The approver (the only account allowed to WRITE).        │
-- │    If you change your email in script-5.js, change it here  │
-- │    too. You may list more than one email, comma-separated.  │
-- └───────────────────────────────────────────────────────────┘
-- Approver email: admin@bionutritionmedical.com

-- 1) Vouchers table ───────────────────────────────────────────
create table if not exists public.requests (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz default now(),

  doc_type            text,                 -- 'disb' = payment voucher
  req_no              text,                 -- PV-0001
  req_date            date,
  name                text,                 -- name of the person who prepared the voucher
  department          text,
  project             text,
  beneficiary         text,                 -- beneficiary / supplier
  amount              numeric,

  supplier_invoices   text,                 -- JSON: supplier invoices
  client_invoices     text,                 -- client invoice numbers (cost center)
  client_inv_json     text,                 -- JSON: cost-center details

  created_by          text,
  signed_by           text,                 -- voucher preparer signature
  signed_at           text,
  accounts_signed_by  text,                 -- accounts approval
  accounts_signed_at  text,

  attachments_count   int  default 0,
  attachments_data    text,                 -- JSON: attachment paths in storage
  request_pdf         text,                 -- voucher PDF path
  transfer_image      text,                 -- transfer proof
  transfer_seen       boolean default false,
  comments_data       text,                 -- JSON: comments
  cancelled           boolean default false,

  -- Cancellation / refund columns (unused now — kept for compatibility)
  customer_no         text,
  mobile              text,
  invoice_ref         text,
  allocation          text,
  full_invoice        boolean,
  refund_method       text,
  refund_account      text,
  refund_json         text,
  notes               text
);

create index if not exists requests_created_at_idx on public.requests (created_at desc);
create index if not exists requests_doc_type_idx  on public.requests (doc_type);

-- 2) Enable RLS ───────────────────────────────────────────────
alter table public.requests enable row level security;

-- Clean up any old policies with the same names (safe to re-run)
drop policy if exists requests_select_all       on public.requests;
drop policy if exists requests_write_accountant on public.requests;

-- (a) READ: any signed-in partner can see every voucher (full transparency)
create policy requests_select_all
  on public.requests for select
  to authenticated
  using ( true );

-- (b) WRITE (insert/update/delete): approver only — you
create policy requests_write_accountant
  on public.requests for all
  to authenticated
  using      ( (auth.jwt() ->> 'email') in ('admin@bionutritionmedical.com') )
  with check ( (auth.jwt() ->> 'email') in ('admin@bionutritionmedical.com') );

-- 3) Attachments storage (private bucket, accessed via signed URLs) ──
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

drop policy if exists ra_read_all        on storage.objects;
drop policy if exists ra_write_accountant on storage.objects;

-- (a) Read / download attachments: any signed-in partner
create policy ra_read_all
  on storage.objects for select
  to authenticated
  using ( bucket_id = 'request-attachments' );

-- (b) Upload / update / delete attachments: approver only — you
create policy ra_write_accountant
  on storage.objects for all
  to authenticated
  using      ( bucket_id = 'request-attachments' and (auth.jwt() ->> 'email') in ('admin@bionutritionmedical.com') )
  with check ( bucket_id = 'request-attachments' and (auth.jwt() ->> 'email') in ('admin@bionutritionmedical.com') );

-- ═══════════════════════════════════════════════════════════════
--  Done. Next, create the user accounts in:
--  Authentication > Users > Add user  (Email + Password, enable Auto Confirm)
--     admin@bionutritionmedical.com    (you — full access)
--     partner@bionutritionmedical.com  (the 3 partners — shared, view only)
-- ═══════════════════════════════════════════════════════════════
