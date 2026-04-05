-- Role column for patient vs admin; service-role API can promote users.

alter table public.profiles
add column if not exists role text not null default 'user'
check (role in ('user', 'admin'));

comment on column public.profiles.role is 'user = patient portal; admin = master dashboard (enforced in API + trigger).';

-- Block self-service role escalation via PostgREST (service role / Node bypasses RLS but trigger still runs)
create or replace function public.profiles_role_guard ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid () is not null then
      new.role := 'user';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role is distinct from old.role then
    if auth.uid () is null then
      return new;
    end if;
    if exists (
      select
        1
      from
        public.profiles p
      where
        p.user_id = auth.uid ()
        and p.role = 'admin'
    ) then
      return new;
    end if;
    raise exception 'Only admins may change profile roles';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_role_guard on public.profiles;

create trigger trg_profiles_role_guard
before insert or update on public.profiles for each row
execute function public.profiles_role_guard ();
