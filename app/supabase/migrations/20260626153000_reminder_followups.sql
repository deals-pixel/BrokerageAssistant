alter table public.reminder_emails
  add column if not exists requested_documents jsonb not null default '[]'::jsonb,
  add column if not exists followup_enabled boolean not null default false,
  add column if not exists next_followup_at timestamptz,
  add column if not exists max_followups integer not null default 0,
  add column if not exists followup_count integer not null default 0,
  add column if not exists followup_delay_business_days integer not null default 2,
  add column if not exists escalate_after_days integer not null default 7,
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid references public.profiles(id),
  add column if not exists last_followup_at timestamptz;

create index if not exists reminder_emails_next_followup_idx
  on public.reminder_emails (next_followup_at)
  where followup_enabled = true and paused_at is null;
