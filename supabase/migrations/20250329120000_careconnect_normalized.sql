-- CareConnect normalized schema (1NF–BCNF per healthcare normalization doc)
-- Run in Supabase SQL Editor or via CLI. Requires auth.users (Supabase Auth).

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.healthcare_providers (
  provider_id uuid primary key default gen_random_uuid (),
  name text not null,
  specialization text not null,
  license_number text not null,
  verified boolean not null default false
);

create table if not exists public.service_types (
  service_id uuid primary key default gen_random_uuid (),
  service_name text not null,
  base_price numeric(12, 2) not null,
  duration_minutes integer not null default 30
);

create table if not exists public.provider_availability (
  availability_id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references public.healthcare_providers (provider_id) on delete cascade,
  date date not null,
  time_slot text not null,
  is_available boolean not null default true,
  constraint uq_provider_slot unique (provider_id, date, time_slot)
);

create table if not exists public.service_requests (
  request_id uuid primary key default gen_random_uuid (),
  request_time timestamptz not null default now(),
  status text not null default 'requested',
  location text not null,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  provider_id uuid references public.healthcare_providers (provider_id) on delete set null,
  service_id uuid not null references public.service_types (service_id) on delete restrict,
  updated_at timestamptz not null default now(),
  location_lat double precision,
  location_lng double precision,
  eta_minutes integer,
  dispatch_lat double precision,
  dispatch_lng double precision
);

create table if not exists public.medical_records (
  record_id uuid primary key default gen_random_uuid (),
  diagnosis text not null,
  notes text,
  record_date date not null default (current_date),
  user_id uuid not null references public.profiles (user_id) on delete cascade
);

create table if not exists public.emergency_requests (
  emergency_id uuid primary key default gen_random_uuid (),
  severity text not null check (
    severity in ('low', 'medium', 'high', 'critical')
  ),
  status text not null default 'open',
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  location text,
  notes text,
  location_lat double precision,
  location_lng double precision,
  response_eta_minutes integer
);

create table if not exists public.payments (
  payment_id uuid primary key default gen_random_uuid (),
  amount numeric(12, 2) not null,
  method text not null,
  status text not null default 'pending',
  request_id uuid not null references public.service_requests (request_id) on delete cascade,
  constraint uq_payment_per_request unique (request_id)
);

create table if not exists public.prescriptions (
  prescription_id uuid primary key default gen_random_uuid (),
  medicines text not null,
  dosage text not null,
  request_id uuid not null references public.service_requests (request_id) on delete cascade,
  constraint uq_prescription_per_request unique (request_id)
);

create table if not exists public.rating_feedback (
  feedback_id uuid primary key default gen_random_uuid (),
  rating smallint not null check (
    rating >= 1
    and rating <= 5
  ),
  comments text,
  request_id uuid not null references public.service_requests (request_id) on delete cascade,
  constraint uq_feedback_per_request unique (request_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_service_requests_user on public.service_requests (user_id);

create index if not exists idx_service_requests_provider on public.service_requests (provider_id);

create index if not exists idx_emergency_user on public.emergency_requests (user_id);

create index if not exists idx_medical_user on public.medical_records (user_id);

create index if not exists idx_availability_provider_date on public.provider_availability (provider_id, date);

-- ---------------------------------------------------------------------------
-- Auto-create profile on signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'CareConnect user')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users for each row
execute function public.handle_new_user ();

-- ---------------------------------------------------------------------------
-- Row Level Security (patient privacy)
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

alter table public.healthcare_providers enable row level security;

alter table public.service_types enable row level security;

alter table public.provider_availability enable row level security;

alter table public.service_requests enable row level security;

alter table public.medical_records enable row level security;

alter table public.emergency_requests enable row level security;

alter table public.payments enable row level security;

alter table public.prescriptions enable row level security;

alter table public.rating_feedback enable row level security;

-- Profiles: users manage own row
create policy "profiles_select_own" on public.profiles for select using (auth.uid () = user_id);

create policy "profiles_update_own" on public.profiles
for update
using (auth.uid () = user_id)
with check (auth.uid () = user_id);

create policy "profiles_insert_own" on public.profiles for insert
with
  check (auth.uid () = user_id);

-- Providers & catalogue: readable by authenticated users
create policy "providers_read" on public.healthcare_providers for
select
  to authenticated using (true);

create policy "services_read" on public.service_types for
select
  to authenticated using (true);

create policy "availability_read" on public.provider_availability for
select
  to authenticated using (true);

-- Service requests
create policy "requests_select_own" on public.service_requests for
select
  using (auth.uid () = user_id);

create policy "requests_insert_own" on public.service_requests for insert
with
  check (auth.uid () = user_id);

create policy "requests_update_own" on public.service_requests for update using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);

-- Medical & emergency: own rows only
create policy "records_select_own" on public.medical_records for
select
  using (auth.uid () = user_id);

create policy "records_insert_own" on public.medical_records for insert
with
  check (auth.uid () = user_id);

create policy "emergency_select_own" on public.emergency_requests for
select
  using (auth.uid () = user_id);

create policy "emergency_insert_own" on public.emergency_requests for insert
with
  check (auth.uid () = user_id);

create policy "emergency_update_own" on public.emergency_requests for update using (auth.uid () = user_id)
with
  check (auth.uid () = user_id);

-- Payments / prescriptions / feedback: via request ownership
create policy "payments_select_own" on public.payments for
select
  using (
    exists (
      select
        1
      from
        public.service_requests sr
      where
        sr.request_id = payments.request_id
        and sr.user_id = auth.uid ()
    )
  );

create policy "payments_insert_own" on public.payments for insert
with
  check (
    exists (
      select
        1
      from
        public.service_requests sr
      where
        sr.request_id = payments.request_id
        and sr.user_id = auth.uid ()
    )
  );

create policy "prescriptions_select_own" on public.prescriptions for
select
  using (
    exists (
      select
        1
      from
        public.service_requests sr
      where
        sr.request_id = prescriptions.request_id
        and sr.user_id = auth.uid ()
    )
  );

create policy "feedback_select_own" on public.rating_feedback for
select
  using (
    exists (
      select
        1
      from
        public.service_requests sr
      where
        sr.request_id = rating_feedback.request_id
        and sr.user_id = auth.uid ()
    )
  );

create policy "feedback_insert_own" on public.rating_feedback for insert
with
  check (
    exists (
      select
        1
      from
        public.service_requests sr
      where
        sr.request_id = rating_feedback.request_id
        and sr.user_id = auth.uid ()
    )
  );

create policy "feedback_update_own" on public.rating_feedback for update using (
  exists (
    select
      1
    from
      public.service_requests sr
    where
      sr.request_id = rating_feedback.request_id
      and sr.user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select
        1
      from
        public.service_requests sr
      where
        sr.request_id = rating_feedback.request_id
        and sr.user_id = auth.uid ()
    )
  );

-- Realtime: optional — enable replication for live tracking (run if needed)
-- alter publication supabase_realtime add table public.service_requests;
-- alter publication supabase_realtime add table public.emergency_requests;

-- ---------------------------------------------------------------------------
-- Seed demo data (providers & services only; safe to re-run with delete)
-- ---------------------------------------------------------------------------

insert into
  public.service_types (service_name, base_price, duration_minutes)
 select
  v.service_name,
  v.base_price,
  v.duration_minutes
from
  (
    values
      ('Ambulance — emergency response', 2499.00::numeric, 45),
      ('Home nursing visit', 899.00::numeric, 60),
      ('Doctor teleconsult', 399.00::numeric, 30),
      ('First responder / paramedic', 1799.00::numeric, 50)
  ) as v(service_name, base_price, duration_minutes)
where
  not exists (
    select
      1
    from
      public.service_types s
    where
      s.service_name = v.service_name
  );

insert into
  public.healthcare_providers (name, specialization, license_number, verified)
 select
  v.name,
  v.specialization,
  v.license_number,
  v.verified
from
  (
    values
      ('Apollo Rapid Response Unit', 'Emergency Medicine', 'TN-EMT-1001', true),
      ('Dr. Meera Krishnan', 'General Practice', 'TN-MED-7782', true),
      ('CityCare Paramedics', 'Paramedicine', 'TN-PAR-5520', true)
  ) as v(name, specialization, license_number, verified)
where
  not exists (
    select
      1
    from
      public.healthcare_providers p
    where
      p.license_number = v.license_number
  );

-- Link availability for next few days (static slots)
insert into
  public.provider_availability (provider_id, date, time_slot, is_available)
select
  p.provider_id,
  d::date,
  slot,
  true
from
  public.healthcare_providers p
  cross join (
    select
      generate_series (
        current_date,
        current_date + 3,
        '1 day'::interval
      )::date as d
  ) days
  cross join (
    values
      ('09:00–10:00'),
      ('10:00–11:00'),
      ('14:00–15:00'),
      ('16:00–17:00')
  ) as slots (slot)
where
  p.verified = true
on conflict (provider_id, date, time_slot) do nothing;
