-- Restrict private instructors by location, including calls through booking RPCs.
create or replace function public.allowed_private_studio_instructor(p_studio uuid,p_instructor uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
 select exists (
   select 1 from public.studios s
   join public.instructors i on i.id=p_instructor
   where s.id=p_studio and i.active and
   ((s.slug='an-thuong-pilates' and i.display_name in ('Ruby','Violet'))
   or (s.slug in ('downtown-pilates','hideaway-pilates') and i.display_name='Ruby'))
 );
$$;
revoke all on function public.allowed_private_studio_instructor(uuid,uuid) from public,anon,authenticated;
create or replace function public.enforce_private_studio_teacher()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
 if not public.allowed_private_studio_instructor(new.studio_id,new.instructor_id) then
  raise exception 'This instructor is not available for private classes at this studio';
 end if;
 return new;
end;
$$;
drop trigger if exists trg_private_slot_allowed_teacher on public.private_slots;
create trigger trg_private_slot_allowed_teacher before insert or update of studio_id,instructor_id on public.private_slots
for each row execute function public.enforce_private_studio_teacher();
drop trigger if exists trg_private_request_allowed_teacher on public.private_requests;
create trigger trg_private_request_allowed_teacher before insert or update of studio_id,instructor_id on public.private_requests
for each row execute function public.enforce_private_studio_teacher();
update public.instructors set active=true where display_name='Violet';