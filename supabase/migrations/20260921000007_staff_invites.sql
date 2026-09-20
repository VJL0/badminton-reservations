-- Staff are invited by email and choose their own password. The shared default password used to create and reset
-- accounts was published in the repository, so it is retired here: an account that still carries the
-- must_change_password flag never changed it, and gets an unusable password and no sessions until its owner
-- sets a new one through "Forgot password" on the sign-in page. The flag itself is gone from everyone.

with stale as (
  select id from auth.users where raw_app_meta_data ->> 'must_change_password' = 'true'
), signed_out as (
  delete from auth.sessions where user_id in (select id from stale)
)
update auth.users u
   set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
  from stale where u.id = stale.id;

update auth.users set raw_app_meta_data = raw_app_meta_data - 'must_change_password'
 where raw_app_meta_data ? 'must_change_password';

-- Called by the server right after Supabase Auth has invited someone (service role only): the invite creates the
-- login, this gives it a place on the staff.
create function api.grant_staff(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('ADMIN', 'OPERATOR') then raise exception 'invalid_role'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'user_not_found'; end if;
  insert into app.staff (user_id, role) values (p_user_id, p_role::app.staff_role)
  on conflict (user_id) do nothing;
end $$;

grant execute on function api.grant_staff(uuid, text) to service_role;
