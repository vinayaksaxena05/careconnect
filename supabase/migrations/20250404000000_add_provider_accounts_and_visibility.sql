-- New migration: Add provider accounts, visibility fields, and routing
-- Run after the main schema migration

-- Step 1: Add provider_id to healthcare_providers for direct login
alter table public.healthcare_providers
add column if not exists provider_user_id uuid references auth.users (id) on delete set null;

alter table public.healthcare_providers
add column if not exists email text;

alter table public.healthcare_providers
add column if not exists phone text;

alter table public.healthcare_providers
add column if not exists address text;

-- Step 2: Add visibility/expiration fields for auto-removal after 2 hours
alter table public.service_requests
add column if not exists visible_until timestamptz;

alter table public.emergency_requests
add column if not exists visible_until timestamptz;

-- Step 3: Add route tracking for ambulance paths
alter table public.service_requests
add column if not exists route_points jsonb default '[]'::jsonb;

-- Step 4: Add status for when request is closed by payment
alter table public.service_requests
add column if not exists closed_at timestamptz;

-- Step 5: Create index on visible_until for cleanup queries
create index if not exists idx_requests_visible_until on public.service_requests (visible_until);
create index if not exists idx_emergency_visible_until on public.emergency_requests (visible_until);

-- Step 6: Update RLS policies for provider users
create policy "providers_select_own" on public.healthcare_providers for
select
  using (auth.uid () = provider_user_id or provider_user_id is null);

create policy "providers_update_own" on public.healthcare_providers for update using (auth.uid () = provider_user_id)
with
  check (auth.uid () = provider_user_id);

-- Step 7: Service requests - providers can see their assigned requests
create policy "requests_select_provider" on public.service_requests for
select
  using (
    exists (
      select
        1
      from
        public.healthcare_providers hp
      where
        hp.provider_id = service_requests.provider_id
        and hp.provider_user_id = auth.uid ()
    )
  );

create policy "requests_update_provider" on public.service_requests for update using (
  exists (
    select
      1
    from
      public.healthcare_providers hp
    where
      hp.provider_id = service_requests.provider_id
      and hp.provider_user_id = auth.uid ()
  )
)
with
  check (
    exists (
      select
        1
      from
        public.healthcare_providers hp
      where
        hp.provider_id = service_requests.provider_id
        and hp.provider_user_id = auth.uid ()
    )
  );

-- Done
