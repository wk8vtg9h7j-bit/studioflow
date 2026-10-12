-- Bulk credit balances for instructor customer cards.
-- Preserves the authoritative existing credit_balance calculation.
create or replace function public.instructor_customer_balances(p_customer_ids uuid[])
returns table(customer_id uuid, regular_balance integer, private_balance integer)
language sql stable security invoker set search_path = public
as $$
 select ids.customer_id,
        public.credit_balance(ids.customer_id, 'regular') as regular_balance,
        public.credit_balance(ids.customer_id, 'private') as private_balance
 from (select distinct unnest(p_customer_ids) as customer_id) ids
 where ids.customer_id is not null;
$$;
revoke all on function public.instructor_customer_balances(uuid[]) from public, anon, authenticated;
grant execute on function public.instructor_customer_balances(uuid[]) to service_role;
