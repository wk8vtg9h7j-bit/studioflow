-- Keep checkout/payment audit history and private request/slot records when a customer is deleted.
-- Detached records retain their immutable transaction and session details.
alter table public.class_checkouts alter column customer_id drop not null;
alter table public.class_checkouts drop constraint if exists class_checkouts_customer_id_fkey;
alter table public.class_checkouts add constraint class_checkouts_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.private_requests alter column customer_id drop not null;
alter table public.private_requests drop constraint if exists private_requests_customer_id_fkey;
alter table public.private_requests add constraint private_requests_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.private_slots drop constraint if exists private_slots_reserved_for_customer_id_fkey;
alter table public.private_slots add constraint private_slots_reserved_for_customer_id_fkey foreign key (reserved_for_customer_id) references public.customers(id) on delete set null;