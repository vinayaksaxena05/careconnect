-- Triage ML decision support: store every model prediction alongside the
-- clinician's final ESI so the two are always distinguishable and auditable.
-- The FastAPI backend uses the service_role key and enforces auth itself; RLS
-- policies below mirror the other patient-owned tables for defence in depth.

create table if not exists public.triage_predictions (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  -- optional link to the emergency this assessment belongs to
  emergency_id uuid references public.emergency_requests (emergency_id) on delete set null,

  -- what the model said (never overwritten by the human decision)
  model_name text not null,
  model_version text not null,
  model_type text not null default 'ml' check (model_type in ('ml', 'heuristic')),
  predicted_esi smallint not null check (predicted_esi between 1 and 5),
  prediction_probabilities jsonb not null,
  confidence numeric(5, 4),
  explanation jsonb,

  -- the inputs the prediction was made from (reproducibility / audit)
  input_features jsonb not null,

  -- the human decision (mandatory review; may equal or override the model)
  human_final_esi smallint check (human_final_esi between 1 and 5),
  was_overridden boolean not null default false,
  override_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,

  requires_human_review boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_triage_predictions_user on public.triage_predictions (user_id);
create index if not exists idx_triage_predictions_emergency on public.triage_predictions (emergency_id);
create index if not exists idx_triage_predictions_created on public.triage_predictions (created_at desc);

alter table public.triage_predictions enable row level security;

create policy "triage_predictions_select_own" on public.triage_predictions for
select
  using (auth.uid () = user_id);

create policy "triage_predictions_insert_own" on public.triage_predictions for insert
with
  check (auth.uid () = user_id);

create policy "triage_predictions_update_own" on public.triage_predictions
for update
  using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);
