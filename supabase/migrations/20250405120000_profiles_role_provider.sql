-- Allow healthcare provider accounts (self-registration via API uses service role to set role).

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check check (
  role in ('user', 'admin', 'provider')
);

comment on column public.profiles.role is 'user = patient; admin = master dashboard; provider = linked healthcare_providers.provider_user_id';
