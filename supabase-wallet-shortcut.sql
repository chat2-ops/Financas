-- Integração opcional com a automação Transação do app Atalhos (Apple Wallet).
-- Execute este arquivo uma vez no SQL Editor do Supabase.
create extension if not exists pgcrypto with schema extensions;

alter table public.transactions
  add column if not exists shortcut_request_id text;

create unique index if not exists transactions_wallet_shortcut_request_unique
  on public.transactions (user_id, shortcut_request_id)
  where shortcut_request_id is not null;

create table if not exists public.wallet_shortcut_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.wallet_shortcut_tokens enable row level security;
revoke all on table public.wallet_shortcut_tokens from public, anon, authenticated;

create or replace function public.register_wallet_shortcut_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para configurar o Atalho.';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Token inválido.';
  end if;

  insert into public.wallet_shortcut_tokens (user_id, token_hash, updated_at)
  values (auth.uid(), p_token_hash, now())
  on conflict (user_id) do update
    set token_hash = excluded.token_hash, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.revoke_wallet_shortcut_token()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para revogar o Atalho.';
  end if;
  delete from public.wallet_shortcut_tokens where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.record_wallet_purchase(
  p_token text,
  p_request_id text,
  p_amount numeric,
  p_merchant text,
  p_date date,
  p_card_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_transaction public.transactions%rowtype;
  v_inserted boolean := false;
  v_description text;
begin
  if p_token is null or length(p_token) < 40 then
    raise exception 'Acesso inválido.';
  end if;

  select user_id into v_user_id
  from public.wallet_shortcut_tokens
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  if v_user_id is null then
    raise exception 'Acesso inválido ou revogado.';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' then
    raise exception 'Identificador da compra inválido.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999 then
    raise exception 'Valor da compra inválido.';
  end if;
  if p_date is null then
    raise exception 'Data da compra inválida.';
  end if;

  v_description := left(coalesce(nullif(btrim(p_merchant), ''), 'Compra Apple Pay'), 80);

  insert into public.transactions (
    user_id, type, description, amount, date, category, payment, shortcut_request_id
  ) values (
    v_user_id, 'expense', v_description, round(p_amount, 2), p_date,
    'Outros', 'Crédito Apple Pay', p_request_id
  )
  on conflict (user_id, shortcut_request_id)
    where shortcut_request_id is not null
    do nothing
  returning * into v_transaction;

  v_inserted := found;
  if not v_inserted then
    select * into v_transaction
    from public.transactions
    where user_id = v_user_id and shortcut_request_id = p_request_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', not v_inserted,
    'transaction_id', v_transaction.id
  );
end;
$$;

revoke all on function public.register_wallet_shortcut_token(text) from public, anon;
grant execute on function public.register_wallet_shortcut_token(text) to authenticated;

revoke all on function public.revoke_wallet_shortcut_token() from public, anon;
grant execute on function public.revoke_wallet_shortcut_token() to authenticated;

revoke all on function public.record_wallet_purchase(text, text, numeric, text, date, text) from public, authenticated;
grant execute on function public.record_wallet_purchase(text, text, numeric, text, date, text) to anon;
