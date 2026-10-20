create or replace view public.public_profiles
with (security_barrier = true)
as
select id, username, display_name, bio
from public.profiles;

revoke select on table public.profiles from public, anon;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Users can read their own profile" on public.profiles
for select using ((select auth.uid()) = id);

revoke all on table public.public_profiles from public, anon, authenticated;
grant select (username, display_name, bio) on table public.public_profiles to anon;
grant select (id, username, display_name, bio) on table public.public_profiles to authenticated;

notify pgrst, 'reload schema';
