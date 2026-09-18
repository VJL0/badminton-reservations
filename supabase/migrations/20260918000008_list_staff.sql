-- Admin-only roster of staff accounts, with emails (which live in auth.users, unreachable by clients).
create function public.list_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_staff(true);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', s.user_id, 'email', u.email, 'role', s.role,
             'created_at', s.created_at, 'last_sign_in_at', u.last_sign_in_at)
           order by s.created_at)
      from public.staff s
      join auth.users u on u.id = s.user_id), '[]'::jsonb);
end $$;

revoke all on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;
