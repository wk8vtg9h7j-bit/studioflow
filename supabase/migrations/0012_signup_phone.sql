-- Store phone numbers supplied during public customer signup.
-- Existing accounts remain valid; phone is required by the signup UI/action for new accounts.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        user_role;
  v_customer_id uuid;
  v_phone       text;
  v_name        text;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer');
  v_phone := nullif(trim(new.raw_user_meta_data->>'phone'), '');
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email);

  insert into public.profiles (id, email, full_name, phone, role)
  values (new.id, new.email, v_name, v_phone, v_role)
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, profiles.full_name),
        phone = coalesce(excluded.phone, profiles.phone),
        updated_at = now();

  if v_role = 'customer'
     and not exists (select 1 from public.customers where profile_id = new.id)
  then
    insert into public.customers (
      profile_id,
      status,
      source,
      name,
      email,
      phone
    )
    values (
      new.id,
      'active',
      'signup',
      v_name,
      new.email,
      v_phone
    )
    returning id into v_customer_id;

    insert into public.credit_ledger (customer_id, delta, reason, expires_at)
    values (v_customer_id, 1, 'adjustment', now() + interval '30 days');
  end if;

  return new;
end
$$;

-- Keep any already-known profile phone values mirrored onto customer rows.
update public.customers c
set phone = p.phone,
    name = coalesce(c.name, p.full_name),
    email = coalesce(c.email, p.email),
    updated_at = now()
from public.profiles p
where c.profile_id = p.id
  and (
    (c.phone is null and p.phone is not null)
    or c.name is null
    or c.email is null
  );
