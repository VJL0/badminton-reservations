-- Google sign-in proves who someone is; app.staff decides what they may do. These tests pin how the two meet:
-- an admin authorizes an email, and only a Google identity with that email, verified by Google, is linked to it.
begin;
select plan(32);

create schema tests;
create function tests.uid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function tests.call(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
-- A login whose Google identity carries this email. `verified` = what Google says about it.
create function tests.google_user(n int, p_email text, verified boolean default true) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at) values (tests.uid(n), null, now());
  insert into auth.identities (provider_id, user_id, provider, identity_data)
  values ('g-' || n, tests.uid(n), 'google', jsonb_build_object('sub', 'g-' || n, 'email', p_email, 'email_verified', verified));
end $$;
create function tests.role_of(n int) returns text language sql as $$ select role::text from app.staff where user_id = tests.uid(n) $$;

-- 1 admin (Google, already staff), 2 operator, 3 anonymous player
select tests.google_user(1, 'boss@temple.edu');
select tests.google_user(2, 'op@gmail.com');
insert into auth.users (id, is_anonymous) values (tests.uid(3), true);
insert into app.staff (user_id, role) values (tests.uid(1), 'ADMIN'), (tests.uid(2), 'OPERATOR');
insert into app.staff_authorizations (email, role, user_id, linked_at) values
  ('boss@temple.edu', 'ADMIN', tests.uid(1), now()), ('op@gmail.com', 'OPERATOR', tests.uid(2), now());

-- ---------- only admins manage the list
select throws_ok($$ select tests.call(tests.uid(2), $q$select api.authorize_staff('new@temple.edu', 'OPERATOR')$q$) $$, 'not_staff', 'an operator cannot authorize anyone');
select throws_ok($$ select tests.call(tests.uid(3), $q$select api.authorize_staff('new@temple.edu', 'OPERATOR')$q$) $$, 'not_staff', 'a player cannot');
select throws_ok($$ select tests.call(tests.uid(2), $q$select api.revoke_staff('boss@temple.edu')$q$) $$, 'not_staff', 'an operator cannot revoke');
select throws_ok($$ select tests.call(tests.uid(2), $q$select api.list_staff()$q$) $$, 'not_staff', 'or read the roster');
select throws_ok($$ select tests.call(tests.uid(1), $q$select api.authorize_staff('not-an-email', 'OPERATOR')$q$) $$, 'invalid_email', 'an address must look like one');
select throws_ok($$ select tests.call(tests.uid(1), $q$select api.authorize_staff('a@b.edu', 'OWNER')$q$) $$, 'invalid_role', 'and the role must exist');
select throws_ok($$ select tests.call(tests.uid(1), $q$select api.authorize_staff('boss@temple.edu', 'OPERATOR')$q$) $$, 'cannot_change_self', 'an admin cannot demote themselves');
select throws_ok($$ select tests.call(tests.uid(1), $q$select api.revoke_staff('boss@temple.edu')$q$) $$, 'cannot_change_self', 'or remove themselves');
select throws_ok($$ select tests.call(tests.uid(1), $q$select api.revoke_staff('nobody@temple.edu')$q$) $$, 'staff_not_found', 'revoking someone unknown says so');

-- ---------- authorized before the first sign-in (any domain: Workspace or Gmail)
select tests.call(tests.uid(1), $$select api.authorize_staff('  Ana@Temple.edu ', 'OPERATOR')$$);
select is((select email from app.staff_authorizations where email like 'ana@%'), 'ana@temple.edu', 'the email is stored trimmed and lower case');
select tests.call(tests.uid(1), $$select api.authorize_staff('sam@gmail.com', 'ADMIN')$$);
select tests.google_user(10, 'ANA@temple.edu');
select is(tests.call(tests.uid(10), 'select api.current_staff_role()'), null, 'signing in with Google grants nothing by itself');
select is(tests.call(tests.uid(10), 'select api.claim_staff_access()'), 'OPERATOR', 'the first verified sign-in claims the authorized role');
select is(tests.role_of(10), 'OPERATOR', 'it is now a real staff row');
select is((select user_id from app.staff_authorizations where email = 'ana@temple.edu'), tests.uid(10), 'tied to that login');
select is(tests.call(tests.uid(10), 'select api.claim_staff_access()'), 'OPERATOR', 'claiming again changes nothing');
select is((select count(*)::int from app.staff where user_id = tests.uid(10)), 1, 'and adds no second row');
select lives_ok($$ select tests.call(tests.uid(10), $q$select api.get_snapshot('NOPE')$q$) $$, 'staff can use the app');

-- ---------- what does not count
select tests.google_user(11, 'sam@gmail.com', false);
select is(tests.call(tests.uid(11), 'select api.claim_staff_access()'), null, 'an email Google has not verified is refused');
insert into auth.users (id, email, email_confirmed_at) values (tests.uid(12), 'sam@gmail.com', now());
insert into auth.identities (provider_id, user_id, provider, identity_data)
values ('e-12', tests.uid(12), 'email', '{"email":"sam@gmail.com","email_verified":true}');
select is(tests.call(tests.uid(12), 'select api.claim_staff_access()'), null, 'a matching email from any other provider is refused');
select is(tests.call(tests.uid(3), 'select api.claim_staff_access()'), null, 'an anonymous player never claims access');
select is((select count(*)::int from app.staff where user_id in (tests.uid(11), tests.uid(12), tests.uid(3))), 0, 'and none of them became staff');
select tests.google_user(13, 'stranger@temple.edu');
select is(tests.call(tests.uid(13), 'select api.claim_staff_access()'), null, 'a Workspace account nobody authorized gets nothing');

-- ---------- a linked authorization is not handed to a second login
insert into auth.users (id) values (tests.uid(14));
insert into auth.identities (provider_id, user_id, provider, identity_data)
values ('g-14', tests.uid(14), 'google', '{"email":"ana@temple.edu","email_verified":true}');
select is(tests.call(tests.uid(14), 'select api.claim_staff_access()'), null, 'another login with the same email cannot take over a linked authorization');

-- ---------- authorized after someone already signed in: linked at once
select is(tests.call(tests.uid(11), 'select api.claim_staff_access()'), null, 'still nothing for the unverified one');
select tests.google_user(15, 'late@temple.edu');
select tests.call(tests.uid(1), $$select api.authorize_staff('late@temple.edu', 'OPERATOR')$$);
select is(tests.role_of(15), 'OPERATOR', 'someone who signed in earlier is linked as soon as they are authorized');

-- ---------- role changes and revoking
select tests.call(tests.uid(1), $$select api.authorize_staff('late@temple.edu', 'ADMIN')$$);
select is(tests.role_of(15), 'ADMIN', 'authorizing again changes the role of a linked person');
select is(tests.call(tests.uid(15), 'select api.current_staff_role()'), 'ADMIN', 'and it takes effect at once');
select tests.call(tests.uid(1), $$select api.revoke_staff('late@temple.edu')$$);
select is(tests.role_of(15), null, 'revoking ends their staff access');
select is(tests.call(tests.uid(15), 'select api.current_staff_role()'), null, 'on their very next call');
select is(tests.call(tests.uid(15), 'select api.claim_staff_access()'), null, 'and signing in again does not bring it back');

-- ---------- the roster
select is(jsonb_array_length(tests.call(tests.uid(1), 'select api.list_staff()')::jsonb), 4, 'the roster lists linked and pending people');
select is((select e ->> 'user_id' from jsonb_array_elements(tests.call(tests.uid(1), 'select api.list_staff()')::jsonb) e where e ->> 'email' = 'sam@gmail.com'), null,
          'a pending authorization has no login yet');

select * from finish();
rollback;
