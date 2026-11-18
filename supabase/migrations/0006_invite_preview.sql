-- =====================================================================
-- LinguABC OS — invitation preview for /join
--
-- Lets the join page show "You're invited to <centre> as <role>" before
-- the person has an account. Reveals only the centre name, the role and
-- the name the centre typed — and only to someone holding the secret
-- 12-character code.
-- =====================================================================

create function public.invite_preview(p_code text)
returns table (center_name text, role public.member_role, full_name text, email text)
language sql stable security definer set search_path = '' as $$
  select c.name, m.role, m.full_name, m.email
  from public.memberships m
  join public.centers c on c.id = m.center_id
  where m.invite_code = upper(trim(p_code)) and m.status = 'invited'
    and length(trim(p_code)) >= 12;
$$;

revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
