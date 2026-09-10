-- ============================================================
--  ЧЕКУНЕЦ БАНК — серверная часть (Supabase / PostgreSQL)
--  Выполните этот файл целиком в Supabase → SQL Editor → Run.
--  Повторный запуск безопасен: всё пересоздаётся идемпотентно.
--
--  Модель безопасности: таблицы закрыты RLS без единой политики,
--  поэтому анонимный ключ НЕ имеет прямого доступа к данным.
--  Клиент работает только через функции SECURITY DEFINER ниже,
--  каждая из которых требует токен сессии (кроме входа/регистрации).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- таблицы ----------

create table if not exists cb_users (
  id           uuid primary key default gen_random_uuid(),
  first_name   text not null,
  last_name    text not null,
  phone        text not null unique,
  email        text not null,
  pin_hash     text not null,
  card_number  text not null unique,
  card_holder  text not null,
  card_exp     text not null,
  card_cvv     text not null,
  account_number text not null unique,
  balance      numeric(14,2) not null default 0,
  settings     jsonb not null default '{"theme":"dark","hide_balance":false,"sound":true,"notify":true,"public":true}'::jsonb,
  last_bonus   date,
  created_at   timestamptz not null default now()
);

create table if not exists cb_sessions (
  token      uuid primary key default gen_random_uuid(),
  user_id    uuid not null references cb_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create table if not exists cb_tx (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references cb_users(id) on delete cascade,
  ts            timestamptz not null default now(),
  amount        numeric(14,2) not null,
  category      text not null,
  title         text not null,
  balance_after numeric(14,2) not null,
  meta          jsonb not null default '{}'::jsonb
);

create table if not exists cb_credits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references cb_users(id) on delete cascade,
  amount     numeric(14,2) not null,
  rate       int not null,
  days       int not null,
  total      numeric(14,2) not null,
  paid       numeric(14,2) not null default 0,
  penalty    numeric(14,2) not null default 0,
  status     text not null default 'active',
  taken_at   timestamptz not null default now(),
  due_at     timestamptz not null,
  closed_at  timestamptz
);

create index if not exists cb_tx_user_ts on cb_tx(user_id, ts desc);
create index if not exists cb_credits_user on cb_credits(user_id);
create index if not exists cb_sessions_user on cb_sessions(user_id);

alter table cb_users    enable row level security;
alter table cb_sessions enable row level security;
alter table cb_tx       enable row level security;
alter table cb_credits  enable row level security;
-- политик намеренно нет: снаружи таблицы недоступны

-- ---------- служебные функции ----------

create or replace function cb_pub(u cb_users) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', u.id, 'first_name', u.first_name, 'last_name', u.last_name,
    'phone', u.phone, 'email', u.email, 'card_number', u.card_number,
    'card_holder', u.card_holder, 'card_exp', u.card_exp, 'card_cvv', u.card_cvv,
    'account_number', u.account_number, 'balance', u.balance,
    'settings', u.settings, 'created_at', u.created_at, 'last_bonus', u.last_bonus);
$$;

create or replace function cb_auth(p_token text) returns cb_users
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  select cu.* into u from cb_users cu
    join cb_sessions s on s.user_id = cu.id
   where s.token = nullif(p_token,'')::uuid;
  if not found then raise exception 'Сессия истекла, войдите заново'; end if;
  update cb_sessions set last_seen = now() where token = p_token::uuid;
  return u;
end $$;

-- Зачисление/списание с записью в историю. Возвращает новый баланс.
create or replace function cb_post(p_user uuid, p_amount numeric, p_cat text, p_title text, p_meta jsonb)
returns numeric
language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  update cb_users set balance = balance + round(p_amount,2) where id = p_user returning balance into bal;
  insert into cb_tx(user_id, amount, category, title, balance_after, meta)
    values (p_user, round(p_amount,2), p_cat, p_title, bal, coalesce(p_meta,'{}'::jsonb));
  return bal;
end $$;

-- Просроченные кредиты: списываем остаток долга и штраф, баланс уходит в минус.
create or replace function cb_process_overdue(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c cb_credits; rest numeric; fine numeric; n int := 0;
begin
  for c in select * from cb_credits
            where user_id = p_user and status = 'active' and due_at <= now()
            for update loop
    rest := round(c.total - c.paid, 2);
    fine := round(rest * 0.25, 2);
    update cb_credits set status = 'overdue', paid = total, penalty = fine, closed_at = now() where id = c.id;
    perform cb_post(p_user, -rest, 'credit', 'Принудительное списание по кредиту', jsonb_build_object('credit', c.id));
    perform cb_post(p_user, -fine, 'penalty', 'Штраф за просрочку (25%)', jsonb_build_object('credit', c.id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- публичные RPC ----------

create or replace function cb_ping() returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'bank', 'Чекунец Банк', 'clients', (select count(*) from cb_users));
$$;

create or replace function cb_register(
  p_first text, p_last text, p_phone text, p_email text, p_pin text,
  p_card text, p_holder text, p_exp text, p_cvv text, p_account text, p_bonus numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; tok uuid;
begin
  if p_phone !~ '^\+7[3489][0-9]{9}$' then raise exception 'Некорректный номер телефона'; end if;
  if p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then raise exception 'Некорректная почта'; end if;
  if length(coalesce(p_pin,'')) < 16 then raise exception 'Некорректный PIN-код'; end if;
  if exists(select 1 from cb_users where phone = p_phone) then
    raise exception 'Клиент с таким телефоном уже зарегистрирован';
  end if;

  insert into cb_users(first_name,last_name,phone,email,pin_hash,card_number,card_holder,card_exp,card_cvv,account_number)
    values (left(p_first,30), left(p_last,30), p_phone, left(p_email,120), p_pin,
            p_card, p_holder, p_exp, p_cvv, p_account)
    returning * into u;

  perform cb_post(u.id, greatest(p_bonus,0), 'bonus', 'Приветственный бонус', '{}'::jsonb);
  insert into cb_sessions(user_id) values (u.id) returning token into tok;
  select * into u from cb_users where id = u.id;
  return jsonb_build_object('token', tok, 'user', cb_pub(u));
exception when unique_violation then
  raise exception 'Не удалось выпустить карту, попробуйте ещё раз';
end $$;

create or replace function cb_login(p_phone text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; tok uuid;
begin
  select * into u from cb_users where phone = p_phone;
  if not found then raise exception 'Клиент с таким номером не найден'; end if;
  if u.pin_hash <> p_pin then raise exception 'Неверный PIN-код'; end if;
  insert into cb_sessions(user_id) values (u.id) returning token into tok;
  return jsonb_build_object('token', tok, 'user', cb_pub(u));
end $$;

create or replace function cb_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; n int;
begin
  u := cb_auth(p_token);
  n := cb_process_overdue(u.id);
  select * into u from cb_users where id = u.id;
  return jsonb_build_object(
    'user', cb_pub(u),
    'overdue_applied', n,
    'clients', (select count(*) from cb_users),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object('id',t.id,'ts',t.ts,'amount',t.amount,'category',t.category,
                                          'title',t.title,'balance_after',t.balance_after,'meta',t.meta)
                       order by t.ts desc)
      from (select * from cb_tx where user_id = u.id order by ts desc limit 200) t), '[]'::jsonb),
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'rate',c.rate,'days',c.days,'total',c.total,
                                          'paid',c.paid,'penalty',c.penalty,'status',c.status,
                                          'taken_at',c.taken_at,'due_at',c.due_at) order by c.taken_at desc)
      from cb_credits c where c.user_id = u.id), '[]'::jsonb));
end $$;

-- Поиск получателя по телефону / номеру карты / номеру счёта
create or replace function cb_lookup(p_query text) returns cb_users
language plpgsql security definer set search_path = public as $$
declare d text; u cb_users;
begin
  d := regexp_replace(coalesce(p_query,''), '\D', '', 'g');
  if length(d) = 11 and left(d,1) in ('7','8') then d := '7' || substr(d,2);
  elsif length(d) = 10 then d := '7' || d;
  end if;
  select * into u from cb_users
   where phone = '+' || d or card_number = d or account_number = d
   limit 1;
  return u;
end $$;

create or replace function cb_find(p_token text, p_query text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me cb_users; t cb_users;
begin
  me := cb_auth(p_token);
  t := cb_lookup(p_query);
  if t.id is null then raise exception 'Клиент Чекунец Банка не найден'; end if;
  if t.id = me.id then raise exception 'Это ваш собственный счёт'; end if;
  return jsonb_build_object('name', t.first_name || ' ' || left(t.last_name,1) || '.',
                            'phone', overlay(t.phone placing '***' from 6 for 3));
end $$;

create or replace function cb_transfer(p_token text, p_query text, p_amount numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me cb_users; t cb_users; amt numeric; bal numeric;
begin
  me := cb_auth(p_token);
  perform cb_process_overdue(me.id);
  amt := round(coalesce(p_amount,0), 2);
  if amt <= 0 then raise exception 'Некорректная сумма перевода'; end if;
  if amt > 1000000 then raise exception 'Слишком крупная сумма'; end if;

  t := cb_lookup(p_query);
  if t.id is null then raise exception 'Клиент Чекунец Банка не найден'; end if;
  if t.id = me.id then raise exception 'Нельзя перевести самому себе'; end if;

  -- блокируем строки в стабильном порядке, чтобы исключить гонки и взаимоблокировки
  perform 1 from cb_users where id in (me.id, t.id) order by id for update;

  select balance into bal from cb_users where id = me.id;
  if bal < amt then raise exception 'Недостаточно чекурублей на счёте'; end if;

  bal := cb_post(me.id, -amt, 'transfer_out', 'Перевод — ' || t.first_name || ' ' || t.last_name,
                 jsonb_build_object('to', t.phone, 'note', left(coalesce(p_note,''),60)));
  perform cb_post(t.id, amt, 'transfer_in', 'Перевод от ' || me.first_name || ' ' || me.last_name,
                 jsonb_build_object('from', me.phone, 'note', left(coalesce(p_note,''),60)));

  return jsonb_build_object('ok', true, 'balance', bal, 'to', t.first_name || ' ' || t.last_name);
end $$;

create or replace function cb_game(p_token text, p_game text, p_stake numeric, p_payout numeric, p_title text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; st numeric; po numeric; bal numeric;
begin
  u := cb_auth(p_token);
  st := round(greatest(coalesce(p_stake,0),0), 2);
  po := round(greatest(coalesce(p_payout,0),0), 2);
  if st > 100000 then raise exception 'Слишком большая ставка'; end if;
  if po > greatest(st * 20, 200) then raise exception 'Некорректный результат игры'; end if;
  perform 1 from cb_users where id = u.id for update;
  select balance into bal from cb_users where id = u.id;
  if st > 0 and bal < st then raise exception 'Недостаточно чекурублей для ставки'; end if;
  bal := cb_post(u.id, po - st, case when st > 0 then 'game_bet' else 'game_win' end, left(p_title,80),
                 jsonb_build_object('game', p_game, 'stake', st, 'payout', po));
  return jsonb_build_object('balance', bal, 'delta', po - st);
end $$;

create or replace function cb_credit_take(p_token text, p_amount numeric, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; amt numeric; rate int; tot numeric; c cb_credits; bal numeric;
begin
  u := cb_auth(p_token);
  perform cb_process_overdue(u.id);
  amt := round(coalesce(p_amount,0), 2);
  if amt < 100 or amt > 50000 then raise exception 'Сумма кредита: от 100 до 50 000 ₡'; end if;
  rate := case p_days when 1 then 5 when 3 then 10 when 7 then 18 when 30 then 35 else null end;
  if rate is null then raise exception 'Неизвестная программа кредитования'; end if;
  if (select count(*) from cb_credits where user_id = u.id and status = 'active') >= 3 then
    raise exception 'Нельзя иметь больше трёх активных кредитов';
  end if;
  tot := round(amt * (1 + rate::numeric/100), 2);
  insert into cb_credits(user_id, amount, rate, days, total, due_at)
    values (u.id, amt, rate, p_days, tot, now() + (p_days || ' days')::interval)
    returning * into c;
  bal := cb_post(u.id, amt, 'credit', 'Кредит на ' || p_days || ' дн.', jsonb_build_object('credit', c.id));
  return jsonb_build_object('balance', bal, 'credit', to_jsonb(c));
end $$;

create or replace function cb_credit_pay(p_token text, p_credit text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; c cb_credits; amt numeric; rest numeric; bal numeric;
begin
  u := cb_auth(p_token);
  select * into c from cb_credits where id = p_credit::uuid and user_id = u.id for update;
  if not found or c.status <> 'active' then raise exception 'Кредит не найден или уже закрыт'; end if;
  rest := round(c.total - c.paid, 2);
  amt := least(round(coalesce(p_amount,0), 2), rest);
  if amt <= 0 then raise exception 'Некорректная сумма платежа'; end if;
  select balance into bal from cb_users where id = u.id for update;
  if bal < amt then raise exception 'Недостаточно чекурублей'; end if;
  update cb_credits set paid = paid + amt,
         status = case when paid + amt >= total - 0.001 then 'closed' else 'active' end,
         closed_at = case when paid + amt >= total - 0.001 then now() else null end
   where id = c.id returning * into c;
  bal := cb_post(u.id, -amt, 'credit_pay',
                 case when c.status = 'closed' then 'Кредит погашен полностью' else 'Платёж по кредиту' end,
                 jsonb_build_object('credit', c.id));
  return jsonb_build_object('balance', bal, 'credit', to_jsonb(c));
end $$;

create or replace function cb_daily_bonus(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; bal numeric; sum_ numeric := 50;
begin
  u := cb_auth(p_token);
  if u.last_bonus = current_date then raise exception 'Бонус сегодня уже получен'; end if;
  update cb_users set last_bonus = current_date where id = u.id;
  bal := cb_post(u.id, sum_, 'bonus', 'Ежедневный бонус клиента', '{}'::jsonb);
  return jsonb_build_object('amount', sum_, 'balance', bal);
end $$;

create or replace function cb_update_profile(p_token text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; ph text; em text;
begin
  u := cb_auth(p_token);
  em := p_patch->>'email';
  ph := p_patch->>'phone';
  if em is not null then
    if em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then raise exception 'Некорректная почта'; end if;
    update cb_users set email = left(em,120) where id = u.id;
  end if;
  if ph is not null then
    if ph !~ '^\+7[3489][0-9]{9}$' then raise exception 'Некорректный номер телефона'; end if;
    if exists(select 1 from cb_users where phone = ph and id <> u.id) then raise exception 'Этот телефон уже занят'; end if;
    update cb_users set phone = ph where id = u.id;
  end if;
  if p_patch ? 'settings' then
    update cb_users set settings = settings || (p_patch->'settings') where id = u.id;
  end if;
  select * into u from cb_users where id = u.id;
  return jsonb_build_object('user', cb_pub(u));
end $$;

create or replace function cb_change_pin(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_auth(p_token);
  if u.pin_hash <> p_old then raise exception 'Текущий PIN неверен'; end if;
  if length(coalesce(p_new,'')) < 16 then raise exception 'Некорректный новый PIN'; end if;
  update cb_users set pin_hash = p_new where id = u.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function cb_top(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', first_name || ' ' || left(last_name,1) || '.', 'balance', balance)
                     order by balance desc)
    from (select first_name, last_name, balance from cb_users
           where coalesce(settings->>'public','true') <> 'false'
           order by balance desc limit 10) x), '[]'::jsonb);
end $$;

create or replace function cb_logout(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from cb_sessions where token = nullif(p_token,'')::uuid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function cb_delete_account(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_auth(p_token);
  delete from cb_users where id = u.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- права ----------

revoke all on all tables in schema public from anon, authenticated;

grant execute on function
  cb_ping(), cb_register(text,text,text,text,text,text,text,text,text,text,numeric),
  cb_login(text,text), cb_state(text), cb_find(text,text),
  cb_transfer(text,text,numeric,text), cb_game(text,text,numeric,numeric,text),
  cb_credit_take(text,numeric,int), cb_credit_pay(text,text,numeric),
  cb_daily_bonus(text), cb_update_profile(text,jsonb), cb_change_pin(text,text,text),
  cb_top(text), cb_logout(text), cb_delete_account(text)
to anon, authenticated;

-- внутренние функции недоступны снаружи
revoke execute on function cb_auth(text), cb_post(uuid,numeric,text,text,jsonb),
  cb_process_overdue(uuid), cb_lookup(text) from anon, authenticated, public;
