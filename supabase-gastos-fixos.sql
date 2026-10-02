create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 80),
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'Contas',
  payment text not null default 'Boleto',
  due_day smallint not null default 10 check (due_day between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists public.fixed_expense_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fixed_expense_id uuid not null,
  month text not null,
  status text not null default 'processing'
    check (status in ('processing', 'paid')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, fixed_expense_id, month),
  foreign key (user_id, fixed_expense_id)
    references public.fixed_expenses(user_id, id) on delete cascade,
  check (
    length(month) = 7
    and month ~ '^[0-9]{4}-(0[1-9]|1[0-2])'
  )
);

alter table public.fixed_expenses enable row level security;
alter table public.fixed_expense_payments enable row level security;

drop policy if exists "Users manage their own fixed expenses"
  on public.fixed_expenses;

create policy "Users manage their own fixed expenses"
  on public.fixed_expenses for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own fixed expense payments"
  on public.fixed_expense_payments;

create policy "Users manage their own fixed expense payments"
  on public.fixed_expense_payments for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete
  on public.fixed_expenses to authenticated;

grant select, insert, update, delete
  on public.fixed_expense_payments to authenticated;

create or replace function public.pay_fixed_expense(
  p_fixed_expense_id uuid,
  p_month text
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as '
with fixed as (
  select id, user_id, description, amount, category, payment, due_day
  from public.fixed_expenses
  where id = p_fixed_expense_id
    and user_id = auth.uid()
    and length(p_month) = 7
    and p_month ~ ''^[0-9]{4}-(0[1-9]|1[0-2])''
),
reservation as (
  insert into public.fixed_expense_payments (
    user_id, fixed_expense_id, month, status
  )
  select user_id, id, p_month, ''processing''
  from fixed
  returning id
),
new_transaction as (
  insert into public.transactions (
    user_id, type, description, amount, date, category, payment
  )
  select
    f.user_id,
    ''expense'',
    f.description,
    f.amount,
    to_date(p_month || ''-01'', ''YYYY-MM-DD'')
      + least(
          f.due_day,
          extract(
            day from (
              to_date(p_month || ''-01'', ''YYYY-MM-DD'')
              + interval ''1 month - 1 day''
            )
          )::integer
        ) - 1,
    f.category,
    f.payment
  from fixed f
  cross join reservation r
  returning *
),
mark_paid as (
  update public.fixed_expense_payments p
  set status = ''paid'',
      transaction_id = t.id
  from reservation r
  cross join new_transaction t
  where p.id = r.id
  returning p.transaction_id
)
select to_jsonb(t)
from mark_paid m
join public.transactions t on t.id = m.transaction_id;
';

revoke all
  on function public.pay_fixed_expense(uuid, text)
  from public;

grant execute
  on function public.pay_fixed_expense(uuid, text)
  to authenticated;
