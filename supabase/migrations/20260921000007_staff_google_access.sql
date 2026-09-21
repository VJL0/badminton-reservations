-- Staff sign in with Google (through Supabase Auth). Google only proves who someone is; it never grants access.
-- Access is a row in app.staff, and a row gets there in exactly one way: an admin authorized that email, and a
-- Google identity whose email Google has verified showed up with it. Any Google account (Gmail or a Workspace
-- domain such as temple.edu) can try; only the authorized ones become staff. Every staff-only function keeps
-- checking app.staff itself (app._require_staff), so revoking a row ends access on the very next call.
--
-- Passwords are retired with this migration: nothing in the app signs anyone in with one any more.

------------------------------------------------------------------ authorized emails

create table app.staff_authorizations (
  email      text primary key check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  role       app.staff_role not null,
  authorized_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set on the first verified Google sign-in with that email: from then on the person is tied to that login.
  user_id    uuid unique references auth.users (id) on delete set null,
  linked_at  timestamptz
);
alter table app.staff_authorizations enable row level security;
revoke all on app.staff_authorizations from anon, authenticated;
create policy "no direct client access" on app.staff_authorizations
  for all to anon, authenticated using (false) with check (false);

-- Everyone who is staff today keeps their access: their email is authorized and already linked. They sign in with
-- Google from now on (Supabase links the Google identity to the existing account by its verified email).
insert into app.staff_authorizations (email, role, user_id, linked_at)
select lower(btrim(u.email)), s.role, s.user_id, now()
  from app.staff s join auth.users u on u.id = s.user_id
 where u.email is not null
on conflict (email) do nothing;

-- Retire the old credentials: no usable password, no open sessions, and none of the flags the password flow used.
with staff_users as (select user_id from app.staff), signed_out as (
  delete from auth.sessions where user_id in (select user_id from staff_users)
)
update auth.users u
   set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
  from staff_users where u.id = staff_users.user_id;

update auth.users set raw_app_meta_data = raw_app_meta_data - 'must_change_password'
 where raw_app_meta_data ? 'must_change_password';

------------------------------------------------------------------ linking a Google login to its authorization

-- The email Google vouches for on this login, or null. Only a Google identity whose email Google itself marked
-- verified counts, and never an anonymous player.
create function app._verified_google_email(p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select lower(btrim(i.identity_data ->> 'email'))
    from auth.identities i
    join auth.users u on u.id = i.user_id
   where i.user_id = p_uid
     and i.provider = 'google'
     and not u.is_anonymous
     and i.identity_data ->> 'email_verified' = 'true'
     and nullif(btrim(i.identity_data ->> 'email'), '') is not null
   limit 1
$$;

-- Give this login the role its email was authorized for. Null when there is nothing to grant. Safe to repeat.
-- An authorization already tied to another login is never handed to a second one.
create function app._link_staff(p_uid uuid) returns app.staff_role
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := app._verified_google_email(p_uid);
  v_auth  app.staff_authorizations;
begin
  if v_email is null then return null; end if;
  select * into v_auth from app.staff_authorizations where email = v_email for update;
  if not found or (v_auth.user_id is not null and v_auth.user_id <> p_uid) then return null; end if;

  insert into app.staff (user_id, role) values (p_uid, v_auth.role)
  on conflict (user_id) do update set role = excluded.role;
  update app.staff_authorizations set user_id = p_uid, linked_at = coalesce(linked_at, now()) where email = v_email;
  return v_auth.role;
end $$;

-- The app calls this for a signed-in (non-anonymous) person who has no role yet: right after Google sign-in, and
-- again whenever they come back, so an admin authorizing someone after their first sign-in takes effect without
-- another round trip. Returns their role, or null.
create function api.claim_staff_access() returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app._require_user();
begin
  return coalesce(app._link_staff(v_uid)::text, app._staff_role()::text);
end $$;

------------------------------------------------------------------ admins manage the list

create function api.list_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app._require_staff(true);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'email', a.email, 'role', a.role, 'user_id', a.user_id,
             'created_at', a.created_at, 'last_sign_in_at', u.last_sign_in_at)
           order by a.created_at, a.email)
      from app.staff_authorizations a
      left join auth.users u on u.id = a.user_id), '[]'::jsonb);
end $$;

-- Authorize an email for a role, or change the role of one already authorized. If that person has already signed in
-- with Google, they are linked at once; otherwise the first sign-in does it.
create function api.authorize_staff(p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_uid   uuid;
begin
  perform app._require_staff(true);
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' or char_length(v_email) > 254 then raise exception 'invalid_email'; end if;
  if p_role not in ('ADMIN', 'OPERATOR') then raise exception 'invalid_role'; end if;
  if app._verified_google_email(v_me) = v_email then raise exception 'cannot_change_self'; end if;

  insert into app.staff_authorizations (email, role, authorized_by) values (v_email, p_role::app.staff_role, v_me)
  on conflict (email) do update set role = excluded.role;

  -- Someone already tied to this email changes role now; someone who has signed in before is linked now.
  update app.staff set role = p_role::app.staff_role
   where user_id = (select user_id from app.staff_authorizations where email = v_email);
  select i.user_id into v_uid from auth.identities i
   where i.provider = 'google' and lower(btrim(i.identity_data ->> 'email')) = v_email limit 1;
  if v_uid is not null then perform app._link_staff(v_uid); end if;
end $$;

-- Take staff access away: the authorization and, if they had signed in, their role. Effective on their next call.
create function api.revoke_staff(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_auth  app.staff_authorizations;
begin
  perform app._require_staff(true);
  select * into v_auth from app.staff_authorizations where email = v_email for update;
  if not found then raise exception 'staff_not_found'; end if;
  if v_auth.user_id = auth.uid() then raise exception 'cannot_change_self'; end if;

  delete from app.staff where user_id = v_auth.user_id;
  delete from app.staff_authorizations where email = v_email;
end $$;

------------------------------------------------------------------ the player's own name

-- What the QR landing page asks to skip the name form for a returning player. Null when none is saved yet.
create function api.get_display_name() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app._require_user();
begin
  return (select display_name from app.profiles where id = v_uid);
end $$;

------------------------------------------------------------------ grants

grant execute on function
  api.claim_staff_access(),
  api.get_display_name()
to authenticated;
-- Admin-only: the role is checked inside as well.
grant execute on function
  api.list_staff(),
  api.authorize_staff(text, text),
  api.revoke_staff(text)
to authenticated;
