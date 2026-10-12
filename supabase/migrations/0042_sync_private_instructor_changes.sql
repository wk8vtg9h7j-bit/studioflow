-- Preserve the private appointment relationship when admin reassigns an
-- already booked private class. The slot and historical request must follow the
-- new assigned instructor, while the actual customer booking stays unchanged.
create or replace function public.sync_private_booking_instructor()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.instructor_id is not distinct from old.instructor_id then
  return new;
 end if;
 if exists(select 1 from public.private_slots
           where booked_session_id=new.id and status='booked') then
  if new.instructor_id is null then
   raise exception 'A booked private appointment must have an instructor';
  end if;
  update public.private_slots set instructor_id=new.instructor_id
  where booked_session_id=new.id and status='booked';
  update public.private_requests r set instructor_id=new.instructor_id
  from public.private_slots p
  where p.booked_session_id=new.id and r.slot_id=p.id and r.status='booked';
 end if;
 return new;
end $$;
drop trigger if exists trg_sync_private_booking_instructor on public.sessions;
create trigger trg_sync_private_booking_instructor
after update of instructor_id on public.sessions
for each row execute function public.sync_private_booking_instructor();
