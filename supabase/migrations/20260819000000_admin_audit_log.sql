-- Audit trail for admin-side data mutations (generic table editor, role changes).
-- The FastAPI backend uses the service_role key and enforces authorization
-- itself, so this table is written to explicitly by the API rather than by
-- a DB trigger.

create table if not exists public.admin_audit_log (
  audit_id uuid primary key default gen_random_uuid (),
  created_at timestamptz not null default now(),
  admin_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  table_name text not null,
  row_pk text not null,
  before jsonb,
  after jsonb
);

create index if not exists idx_admin_audit_log_created on public.admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_log_table on public.admin_audit_log (table_name, row_pk);

alter table public.admin_audit_log enable row level security;

-- No client-facing policies: only the service-role backend reads/writes this table.
