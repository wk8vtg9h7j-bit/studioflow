-- Private coaching MVP. This schema is intentionally unapplied until preview QA.
alter table public.studios add column if not exists private_only boolean not null default false;
alter table public.studios add column if not exists cover_image_url text;
alter table public.customers add column if not exists preferred_studio_id uuid references public.studios(id) on delete set null;
insert into public.studios (name,slug,timezone,brand_color,active,private_only)
select 'An Thuong Pilates','an-thuong-pilates','Asia/Ho_Chi_Minh','#354A40',true,true
where not exists (select 1 from public.studios where slug='an-thuong-pilates');
create table if not exists public.private_coaching (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id) on delete cascade,
 studio_id uuid not null references public.studios(id),
 instructor_id uuid references public.instructors(id) on delete set null,
 goals text not null default '',
 program text not null default '',
 updated_at timestamptz not null default now(),
 unique(customer_id,studio_id)
);
create table if not exists public.private_coaching_reviews (
 id uuid primary key default gen_random_uuid(),
 coaching_id uuid not null references public.private_coaching(id) on delete cascade,
 week_start date not null,
 notes text not null default '',
 progress text not null default '',
 created_at timestamptz not null default now(),
 unique(coaching_id,week_start)
);
create table if not exists public.private_coaching_photos (
 id uuid primary key default gen_random_uuid(),
 coaching_id uuid not null references public.private_coaching(id) on delete cascade,
 object_path text not null,
 caption text not null default '',
 taken_at timestamptz not null default now()
);
alter table public.private_coaching enable row level security;
alter table public.private_coaching_reviews enable row level security;
alter table public.private_coaching_photos enable row level security;
-- Sensitive personal coaching material is accessed only after server-side identity / assignment checks.
revoke all on public.private_coaching, public.private_coaching_reviews, public.private_coaching_photos from anon,authenticated;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('coaching-progress','coaching-progress',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('studio-gallery','studio-gallery',true,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Enforce private-only studios on scheduled class sessions at the database layer.
create or replace function public.check_private_only_studio_session()
returns trigger language plpgsql set search_path = '' as $$
begin
 if exists (select 1 from public.studios where id=new.studio_id and private_only)
    and not exists (select 1 from public.class_types where id=new.class_type_id and pool='private') then
  raise exception 'This studio only permits private sessions';
 end if;
 return new;
end;
$$;
drop trigger if exists enforce_private_only_session on public.sessions;
create trigger enforce_private_only_session
before insert or update of studio_id,class_type_id on public.sessions
for each row execute function public.check_private_only_studio_session();
create table if not exists public.studio_photos (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id) on delete cascade,
 object_path text not null,
 caption text not null default '',
 created_at timestamptz not null default now()
);
alter table public.studio_photos enable row level security;
revoke all on public.studio_photos from anon,authenticated;
create index if not exists studio_photos_studio_idx on public.studio_photos(studio_id,created_at desc);
