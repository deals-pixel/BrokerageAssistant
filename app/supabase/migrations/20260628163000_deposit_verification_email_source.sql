alter table public.deal_deposit_verifications
  add column if not exists source_inbound_email_id uuid references public.inbound_emails(id) on delete set null,
  add column if not exists source_email text,
  add column if not exists source_name text,
  add column if not exists source_received_at timestamptz;
