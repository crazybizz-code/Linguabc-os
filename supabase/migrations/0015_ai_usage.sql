-- =====================================================================
-- AI usage accounting: every AI request records the model, tokens and the
-- provider-reported cost, so owners can see what drafting costs.
-- =====================================================================
alter table public.ai_requests
  add column model             text,
  add column prompt_tokens     int,
  add column completion_tokens int,
  add column cost_usd          numeric(10,6),
  add column ok                boolean;

-- claim_ai_request now returns the request id so the server can record usage.
drop function public.claim_ai_request(uuid, text);
create function public.claim_ai_request(p_center uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not (app.is_staff(p_center) or app.has_role(p_center, '{mentor}')) then perform app.forbid(); end if;
  if (select count(*) from public.ai_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'AI limit reached: 20 requests per hour. Try again a little later.';
  end if;
  if (select count(*) from public.ai_requests where center_id = p_center and created_at > now() - interval '1 day') >= 200 then
    raise exception 'AI limit reached for your centre today (200 requests).';
  end if;
  insert into public.ai_requests (center_id, user_id, kind) values (p_center, auth.uid(), p_kind) returning id into v_id;
  return v_id;
end $$;

-- Record the outcome of one's own request (once).
create function public.finish_ai_request(p_id bigint, p_model text, p_prompt int, p_completion int, p_cost numeric, p_ok boolean)
returns void language sql security definer set search_path = '' as $$
  update public.ai_requests
     set model = left(p_model, 100), prompt_tokens = greatest(p_prompt, 0), completion_tokens = greatest(p_completion, 0),
         cost_usd = greatest(p_cost, 0), ok = p_ok
   where id = p_id and user_id = auth.uid() and ok is null;
$$;

revoke execute on function public.claim_ai_request(uuid, text) from public, anon;
revoke execute on function public.finish_ai_request(bigint, text, int, int, numeric, boolean) from public, anon;
grant execute on function public.claim_ai_request(uuid, text) to authenticated;
grant execute on function public.finish_ai_request(bigint, text, int, int, numeric, boolean) to authenticated;
