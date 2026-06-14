-- ============================================================================
-- StudioFlow — payroll resolution + computation
-- Salary per class is driven by the confirmed number of students (attendance).
-- ============================================================================

-- Resolve the most specific active pay rule for a session.
-- Specificity score: instructor match (4) + class_type match (2) + studio match (1),
-- then `priority`, then most recently created.
create or replace function resolve_pay_rule(p_session_id uuid)
returns pay_rules language plpgsql stable security definer set search_path = public as $$
declare
  v_session sessions%rowtype;
  v_rule    pay_rules%rowtype;
begin
  select * into v_session from sessions where id = p_session_id;
  if not found then return null; end if;

  select * into v_rule
  from pay_rules r
  where r.active
    and (r.instructor_id is null or r.instructor_id = v_session.instructor_id)
    and (r.studio_id     is null or r.studio_id     = v_session.studio_id)
    and (r.class_type_id is null or r.class_type_id = v_session.class_type_id)
  order by
    (case when r.instructor_id is not null then 4 else 0 end
     + case when r.class_type_id is not null then 2 else 0 end
     + case when r.studio_id is not null then 1 else 0 end) desc,
    r.priority desc,
    r.created_at desc
  limit 1;

  return v_rule;
end $$;

-- Compute the pay amount for a rule given an attendance count.
create or replace function compute_pay(p_rule pay_rules, p_attendance int)
returns numeric language plpgsql immutable as $$
declare
  v_amount numeric(10,2) := 0;
  v_tier   jsonb;
begin
  if p_rule is null then return 0; end if;

  case p_rule.model
    when 'flat' then
      v_amount := p_rule.base_amount;
    when 'per_head' then
      v_amount := p_rule.per_head_amount * p_attendance;
    when 'base_plus_per_head' then
      v_amount := p_rule.base_amount + p_rule.per_head_amount * p_attendance;
    when 'tiered' then
      -- pick the tier whose [min,max] bracket contains the attendance
      for v_tier in select * from jsonb_array_elements(p_rule.tiers) loop
        if p_attendance >= coalesce((v_tier->>'min')::int, 0)
           and p_attendance <= coalesce((v_tier->>'max')::int, 2147483647) then
          v_amount := (v_tier->>'amount')::numeric;
          exit;
        end if;
      end loop;
  end case;

  return round(coalesce(v_amount, 0), 2);
end $$;

-- Count students considered "present" for pay: checked-in or still booked.
create or replace function session_attendance(p_session_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from bookings
  where session_id = p_session_id
    and status in ('booked', 'attended');
$$;

-- Create/refresh the payroll row for a session and (re)compute its amount.
-- If p_attendance is null, attendance is derived from the booking roster.
create or replace function recalc_payroll(p_session_id uuid, p_attendance int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session    sessions%rowtype;
  v_rule       pay_rules%rowtype;
  v_attendance int;
  v_amount     numeric(10,2);
  v_row        session_payroll%rowtype;
begin
  select * into v_session from sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.instructor_id is null then
    raise exception 'Session has no instructor assigned';
  end if;

  v_attendance := coalesce(p_attendance, session_attendance(p_session_id));
  v_rule := resolve_pay_rule(p_session_id);
  v_amount := compute_pay(v_rule, v_attendance);

  insert into session_payroll (session_id, instructor_id, pay_rule_id, attendance_count, computed_amount, currency)
  values (p_session_id, v_session.instructor_id, v_rule.id, v_attendance, v_amount, coalesce(v_rule.currency, 'VND'))
  on conflict (session_id, instructor_id) do update set
    pay_rule_id      = excluded.pay_rule_id,
    attendance_count = excluded.attendance_count,
    computed_amount  = excluded.computed_amount,
    currency         = excluded.currency,
    -- keep confirmations sticky unless still pending
    status = case when session_payroll.status = 'pending' then 'pending' else session_payroll.status end
  returning * into v_row;

  return to_jsonb(v_row);
end $$;

-- Instructor confirms their class salary, optionally correcting attendance.
create or replace function confirm_payroll(p_payroll_id uuid, p_attendance int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row    session_payroll%rowtype;
  v_rule   pay_rules%rowtype;
  v_att    int;
  v_amount numeric(10,2);
begin
  select * into v_row from session_payroll where id = p_payroll_id for update;
  if not found then raise exception 'Payroll record not found'; end if;
  if v_row.instructor_id <> my_instructor_id() and not is_admin() then
    raise exception 'Not authorised';
  end if;

  v_att := coalesce(p_attendance, v_row.attendance_count);
  v_rule := resolve_pay_rule(v_row.session_id);
  v_amount := compute_pay(v_rule, v_att);

  update session_payroll set
    attendance_count = v_att,
    pay_rule_id = v_rule.id,
    computed_amount = v_amount,
    status = 'instructor_confirmed',
    instructor_confirmed_at = now()
  where id = p_payroll_id
  returning * into v_row;

  return to_jsonb(v_row);
end $$;
