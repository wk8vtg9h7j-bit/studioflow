-- Separate, instructor-managed private appointments. All writes are authenticated
-- RPCs so availability, approvals and credit-consuming bookings are atomic.
create table if not exists public.private_slots (
 id uuid primary key default gen_random_uuid(),
 instructor_id uuid not null references public.instructors(id),
 studio_id uuid not null references public.studios(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'open' check (status in ('open','booked','closed')),
 reserved_for_customer_id uuid references public.customers(id),
 booked_session_id uuid unique references public.sessions(id),
 created_at timestamptz not null default now(),
 constraint private_slot_times check (ends_at > starts_at)
);
create index if not exists idx_private_slots_instructor_time on public.private_slots(instructor_id,starts_at);
create index if not exists idx_private_slots_day_studio on public.private_slots(studio_id,starts_at);

create table if not exists public.private_requests (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id),
 instructor_id uuid not null references public.instructors(id),
 studio_id uuid not null references public.studios(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 note text,
 status text not null default 'pending' check (status in ('pending','approved','declined','booked','cancelled')),
 slot_id uuid unique references public.private_slots(id),
 responded_at timestamptz,
 created_at timestamptz not null default now(),
 constraint private_request_times check (ends_at > starts_at)
);
create index if not exists idx_private_requests_instructor_status on public.private_requests(instructor_id,status,starts_at);
create index if not exists idx_private_requests_customer on public.private_requests(customer_id,starts_at desc);
create unique index if not exists idx_private_requests_one_live_request
 on public.private_requests(customer_id,instructor_id,starts_at)
 where status in ('pending','approved');

alter table public.private_slots enable row level security;
alter table public.private_requests enable row level security;
revoke all on public.private_slots from anon, authenticated;
revoke all on public.private_requests from anon, authenticated;
grant select on public.private_slots, public.private_requests to authenticated;
create policy "Private slots visible to assigned instructor or eligible member"
on public.private_slots for select to authenticated using (
 public.is_admin()
 or instructor_id=public.my_instructor_id()
 or (status='open' and (reserved_for_customer_id is null or reserved_for_customer_id=public.my_customer_id()))
);
create policy "Private requests visible only to relevant users"
on public.private_requests for select to authenticated using (
 public.is_admin() or instructor_id=public.my_instructor_id() or customer_id=public.my_customer_id()
);

-- Valid request times: 50-minute sessions starting every full hour,
-- 07:00 through 20:00 Vietnam time, at least 2 hours ahead, at most 28 days.
create or replace function public.validate_private_time(p_start timestamptz)
returns void language plpgsql set search_path=public as $$
declare v_local timestamp;
begin
 if p_start is null or p_start < now()+interval '2 hours' or p_start > now()+interval '28 days' then
  raise exception 'Choose a time between 2 hours and 28 days from now';
 end if;
 v_local := p_start at time zone 'Asia/Ho_Chi_Minh';
 if extract(minute from v_local) <> 0 or extract(second from v_local) <> 0
    or extract(hour from v_local) < 7 or extract(hour from v_local) > 20 then
  raise exception 'Private sessions begin on the hour between 07:00 and 20:00';
 end if;
end $$;

create or replace function public.private_instructor_is_free(
 p_instructor uuid, p_start timestamptz, p_end timestamptz, p_exclude_slot uuid default null
) returns boolean language sql stable set search_path=public as $$
 select not exists (
  select 1 from public.sessions s
  where s.instructor_id=p_instructor and s.status='scheduled'
   and s.starts_at < p_end and s.ends_at > p_start
   and not (coalesce(s.filler_seats,0)>=s.capacity and not exists
    (select 1 from public.bookings b where b.session_id=s.id and b.status in ('booked','attended')))
 ) and not exists (
  select 1 from public.private_slots p
  where p.instructor_id=p_instructor and p.status='open'
   and (p_exclude_slot is null or p.id<>p_exclude_slot)
   and p.starts_at < p_end and p.ends_at > p_start
 );
$$;

create or replace function public.private_publish_slot(p_studio uuid,p_start timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_instructor uuid; v_id uuid; v_end timestamptz:=p_start+interval '50 minutes';
begin
 v_instructor:=public.my_instructor_id();
 if v_instructor is null then raise exception 'Only instructors can publish private times'; end if;
 perform public.validate_private_time(p_start);
 if not exists(select 1 from public.studios where id=p_studio and active)
 then raise exception 'Studio not available'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_instructor::text,0));
 if not public.private_instructor_is_free(v_instructor,p_start,v_end,null)
 then raise exception 'This time overlaps an existing class or open private slot'; end if;
 insert into public.private_slots(instructor_id,studio_id,starts_at,ends_at)
 values(v_instructor,p_studio,p_start,v_end) returning id into v_id;
 return v_id;
end $$;

create or replace function public.private_close_slot(p_slot uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_slot public.private_slots%rowtype;
begin
 select * into v_slot from public.private_slots where id=p_slot for update;
 if not found or v_slot.instructor_id is distinct from public.my_instructor_id()
 then raise exception 'Private slot not found'; end if;
 if v_slot.status<>'open' then raise exception 'This slot is not open'; end if;
 update public.private_slots set status='closed' where id=p_slot;
 update public.private_requests set status='declined', responded_at=now()
 where slot_id=p_slot and status='approved';
end $$;

create or replace function public.private_submit_request(
 p_instructor uuid,p_studio uuid,p_start timestamptz,p_note text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_customer uuid; v_id uuid; v_end timestamptz:=p_start+interval '50 minutes';
begin
 v_customer:=public.ensure_customer();
 if v_customer is null then raise exception 'Customer account required'; end if;
 perform public.validate_private_time(p_start);
 if length(coalesce(p_note,''))>300 then raise exception 'Note is too long'; end if;
 if not exists(select 1 from public.instructors where id=p_instructor and active)
  or not exists(select 1 from public.studios where id=p_studio and active)
 then raise exception 'Instructor or studio unavailable'; end if;
 if (select count(*) from public.private_requests
     where customer_id=v_customer and status='pending')>=5 then
  raise exception 'Please resolve your existing requests first (maximum 5 pending)';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_instructor::text,0));
 if not public.private_instructor_is_free(p_instructor,p_start,v_end,null)
 then raise exception 'This time is already booked or offered. Choose another time'; end if;
 insert into public.private_requests(customer_id,instructor_id,studio_id,starts_at,ends_at,note)
 values(v_customer,p_instructor,p_studio,p_start,v_end,nullif(trim(coalesce(p_note,'')),''))
 returning id into v_id;
 return v_id;
end $$;

create or replace function public.private_respond_request(p_request uuid,p_accept boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_request public.private_requests%rowtype; v_slot uuid;
begin
 select * into v_request from public.private_requests where id=p_request for update;
 if not found or v_request.instructor_id is distinct from public.my_instructor_id()
 then raise exception 'Request not found'; end if;
 if v_request.status<>'pending' then raise exception 'Request already handled'; end if;
 if not p_accept then
  update public.private_requests set status='declined',responded_at=now() where id=p_request;
  return null;
 end if;
 perform public.validate_private_time(v_request.starts_at);
 perform pg_advisory_xact_lock(hashtextextended(v_request.instructor_id::text,0));
 if not public.private_instructor_is_free(v_request.instructor_id,v_request.starts_at,v_request.ends_at,null)
 then raise exception 'This time is no longer available'; end if;
 insert into public.private_slots(instructor_id,studio_id,starts_at,ends_at,reserved_for_customer_id)
 values(v_request.instructor_id,v_request.studio_id,v_request.starts_at,v_request.ends_at,v_request.customer_id)
 returning id into v_slot;
 update public.private_requests
 set slot_id=v_slot,status='approved',responded_at=now() where id=p_request;
 return v_slot;
end $$;

create or replace function public.private_cancel_request(p_request uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_request public.private_requests%rowtype;
begin
 select * into v_request from public.private_requests where id=p_request for update;
 if not found or v_request.customer_id is distinct from public.my_customer_id()
 then raise exception 'Request not found'; end if;
 if v_request.status not in ('pending','approved') then
  raise exception 'This request can no longer be cancelled';
 end if;
 if v_request.slot_id is not null then
  update public.private_slots set status='closed'
  where id=v_request.slot_id and status='open';
 end if;
 update public.private_requests set status='cancelled',responded_at=now() where id=p_request;
end $$;

-- Direct booking of published availability and confirmation of approved requests
-- consumes a private credit through the existing atomic book_session RPC.
-- Any booking failure rolls back the class, the slot and the charge together.
create or replace function public.private_book_slot(p_slot uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_slot public.private_slots%rowtype;
 v_customer uuid;
 v_type uuid;
 v_session uuid;
begin
 v_customer:=public.ensure_customer();
 select * into v_slot from public.private_slots where id=p_slot for update;
 if not found or v_slot.status<>'open' then raise exception 'Time is no longer available'; end if;
 if v_slot.reserved_for_customer_id is not null
   and v_slot.reserved_for_customer_id<>v_customer then
  raise exception 'This private time is reserved for another customer';
 end if;
 perform public.validate_private_time(v_slot.starts_at);
 perform pg_advisory_xact_lock(hashtextextended(v_slot.instructor_id::text,0));
 if not public.private_instructor_is_free(
   v_slot.instructor_id,v_slot.starts_at,v_slot.ends_at,v_slot.id
 ) then raise exception 'Instructor is no longer available at this time'; end if;
 select id into v_type from public.class_types
 where pool='private' and active order by created_at,id limit 1;
 if v_type is null then raise exception 'Private Pilates class type not configured'; end if;
 insert into public.sessions(
  studio_id,class_type_id,instructor_id,title,starts_at,ends_at,capacity,status,notes
 ) values (
  v_slot.studio_id,v_type,v_slot.instructor_id,'Private Pilates',v_slot.starts_at,
  v_slot.ends_at,1,'scheduled','Reserved through the private appointment calendar'
 ) returning id into v_session;
 -- Internal invocation retains the signed-in customer's auth.uid() for
 -- ensure_customer() and the correct credit pool.
 perform public.book_session(v_session,1);
 update public.private_slots set status='booked',booked_session_id=v_session where id=v_slot.id;
 update public.private_requests set status='booked',responded_at=now()
 where slot_id=v_slot.id and status='approved';
 return v_session;
end $$;

revoke all on function public.validate_private_time(timestamptz) from public,anon,authenticated;
revoke all on function public.private_instructor_is_free(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.private_publish_slot(uuid,timestamptz) from public,anon;
revoke all on function public.private_close_slot(uuid) from public,anon;
revoke all on function public.private_submit_request(uuid,uuid,timestamptz,text) from public,anon;
revoke all on function public.private_respond_request(uuid,boolean) from public,anon;
revoke all on function public.private_cancel_request(uuid) from public,anon;
revoke all on function public.private_book_slot(uuid) from public,anon;
grant execute on function public.validate_private_time(timestamptz) to authenticated;
grant execute on function public.private_instructor_is_free(uuid,timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.private_publish_slot(uuid,timestamptz) to authenticated;
grant execute on function public.private_close_slot(uuid) to authenticated;
grant execute on function public.private_submit_request(uuid,uuid,timestamptz,text) to authenticated;
grant execute on function public.private_respond_request(uuid,boolean) to authenticated;
grant execute on function public.private_cancel_request(uuid) to authenticated;
grant execute on function public.private_book_slot(uuid) to authenticated;

-- Keep pending payroll tied to the teacher actually assigned; never silently
-- transfer a confirmed/approved/paid payroll record to somebody else.
create or replace function public.guard_instructor_reassignment_payroll()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.instructor_id is distinct from old.instructor_id then
  if exists(select 1 from public.session_payroll
   where session_id=old.id and status<>'pending') then
   raise exception 'Payroll has been confirmed for this class. Reconcile payroll before reassigning.';
  end if;
  delete from public.session_payroll where session_id=old.id and status='pending';
 end if;
 return new;
end $$;
drop trigger if exists trg_guard_instructor_reassignment_payroll on public.sessions;
create trigger trg_guard_instructor_reassignment_payroll
before update of instructor_id on public.sessions
for each row execute function public.guard_instructor_reassignment_payroll();
