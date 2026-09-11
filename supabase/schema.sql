create extension if not exists pgcrypto;

create table if not exists cb_users (
  id             uuid primary key default gen_random_uuid(),
  first_name     text not null,
  last_name      text not null,
  phone          text not null unique,
  email          text not null,
  pin_hash       text not null,
  card_number    text not null unique,
  card_holder    text not null,
  card_exp       text not null,
  card_cvv       text not null,
  account_number text not null unique,
  balance        numeric(14,2) not null default 0,
  role           text not null default 'client',
  blocked        boolean not null default false,
  blocked_reason text not null default '',
  inventory      jsonb not null default '{"skins":["base"],"titles":[],"insurance":0,"bonus_boost_until":null,"limit_up":false,"avatar":false,"engraving":false,"cases":0,"holidays":0,"cashback":false,"autopay":false,"deposit_plus":false}'::jsonb,
  engraving      text not null default '',
  equipped       jsonb not null default '{"skin":"base","title":"","avatar":""}'::jsonb,
  settings       jsonb not null default '{"theme":"dark","hide_balance":false,"sound":true,"notify":true,"public":true}'::jsonb,
  last_bonus     date,
  created_at     timestamptz not null default now()
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
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references cb_users(id) on delete cascade,
  amount    numeric(14,2) not null,
  rate      int not null,
  days      int not null,
  total     numeric(14,2) not null,
  paid      numeric(14,2) not null default 0,
  penalty   numeric(14,2) not null default 0,
  status    text not null default 'active',
  taken_at  timestamptz not null default now(),
  due_at    timestamptz not null,
  closed_at timestamptz
);

create table if not exists cb_deposits (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references cb_users(id) on delete cascade,
  amount    numeric(14,2) not null,
  rate      int not null,
  days      int not null,
  total     numeric(14,2) not null,
  status    text not null default 'active',
  opened_at timestamptz not null default now(),
  due_at    timestamptz not null,
  closed_at timestamptz
);

create table if not exists cb_shop_items (
  id    text primary key,
  kind  text not null,
  value text not null default '',
  price numeric(14,2) not null
);

insert into cb_shop_items(id, kind, value, price) values
  ('skin_graphite','skin','graphite',2500),
  ('skin_azure','skin','azure',3000),
  ('skin_emerald','skin','emerald',3500),
  ('skin_sand','skin','sand',4000),
  ('skin_chekushka','skin','chekushka',6000),
  ('skin_platinum','skin','platinum',9000),
  ('title_lucky','title','Везунчик',1500),
  ('title_chekushkin','title','Чекушкин',2500),
  ('title_vip','title','VIP-клиент',4000),
  ('title_magnat','title','Магнат',12000),
  ('title_legend','title','Легенда банка',25000),
  ('case','case','',1000),
  ('avatar','avatar','',700),
  ('engraving','engraving','',5000),
  ('reissue','reissue','',3000),
  ('insurance','consumable','',1200),
  ('holidays','holidays','',2000),
  ('bonus_boost','boost','',1800),
  ('limit_up','perk','',15000),
  ('cashback','cashback','',20000),
  ('autopay','autopay','',8000),
  ('deposit_plus','deposit_plus','',12000)
on conflict (id) do update set kind = excluded.kind, value = excluded.value, price = excluded.price;

delete from cb_shop_items where id in ('skin_neon','skin_ice','skin_blood','skin_dark','skin_gold','emoji');

alter table cb_users add column if not exists engraving text not null default '';

update cb_users set inventory = inventory ||
  jsonb_build_object('engraving', coalesce((inventory->>'engraving')::boolean, false),
                     'cases', coalesce((inventory->>'cases')::int, 0),
                     'holidays', coalesce((inventory->>'holidays')::int, 0),
                     'cashback', coalesce((inventory->>'cashback')::boolean, false))
 where not (inventory ? 'cases');

update cb_users set inventory = inventory ||
  jsonb_build_object('autopay', coalesce((inventory->>'autopay')::boolean, false),
                     'deposit_plus', coalesce((inventory->>'deposit_plus')::boolean, false))
 where not (inventory ? 'autopay');

alter table cb_users alter column email set default '';

update cb_users
   set inventory = (inventory - 'emoji') || jsonb_build_object('avatar', coalesce(inventory->>'emoji','') <> '')
 where inventory ? 'emoji';

update cb_users
   set equipped = (equipped - 'emoji') || '{"avatar":""}'::jsonb
 where equipped ? 'emoji';

create index if not exists cb_tx_user_ts on cb_tx(user_id, ts desc);
create index if not exists cb_tx_ts on cb_tx(ts desc);
create index if not exists cb_credits_user on cb_credits(user_id);
create index if not exists cb_deposits_user on cb_deposits(user_id);
create index if not exists cb_sessions_user on cb_sessions(user_id);

alter table cb_users      enable row level security;
alter table cb_sessions   enable row level security;
alter table cb_tx         enable row level security;
alter table cb_credits    enable row level security;
alter table cb_deposits   enable row level security;
alter table cb_shop_items enable row level security;

create or replace function cb_pub(u cb_users) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', u.id, 'first_name', u.first_name, 'last_name', u.last_name,
    'phone', u.phone, 'email', u.email, 'card_number', u.card_number,
    'card_holder', u.card_holder, 'card_exp', u.card_exp, 'card_cvv', u.card_cvv,
    'account_number', u.account_number, 'balance', u.balance, 'role', u.role, 'engraving', u.engraving,
    'blocked', u.blocked, 'inventory', u.inventory, 'equipped', u.equipped,
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
  if u.blocked then raise exception 'Счёт заблокирован. %', u.blocked_reason; end if;
  update cb_sessions set last_seen = now() where token = p_token::uuid;
  return u;
end $$;

create or replace function cb_staff(p_token text, p_allow_dev boolean) returns cb_users
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_auth(p_token);
  if u.role = 'admin' then return u; end if;
  if p_allow_dev and u.role = 'developer' then return u; end if;
  raise exception 'Недостаточно прав';
end $$;

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

create or replace function cb_process_overdue(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c cb_credits; rest numeric; fine numeric; ins int; autop boolean; n int := 0;
begin
  for c in select * from cb_credits
            where user_id = p_user and status = 'active' and due_at <= now() for update loop
    rest := round(c.total - c.paid, 2);
    select coalesce((inventory->>'insurance')::int, 0),
           coalesce((inventory->>'autopay')::boolean, false) and balance >= rest
      into ins, autop from cb_users where id = p_user;
    if autop then
      fine := 0;
    elsif ins > 0 then
      fine := 0;
      update cb_users set inventory = jsonb_set(inventory, '{insurance}', to_jsonb(ins - 1)) where id = p_user;
    else
      fine := round(rest * 0.25, 2);
    end if;
    update cb_credits set status = 'overdue', paid = total, penalty = fine, closed_at = now() where id = c.id;
    perform cb_post(p_user, -rest, 'credit', 'Принудительное списание по кредиту', jsonb_build_object('credit', c.id));
    if fine > 0 then
      perform cb_post(p_user, -fine, 'penalty', 'Штраф за просрочку (25%)', jsonb_build_object('credit', c.id));
    else
      perform cb_post(p_user, 0, 'shop',
        case when autop then 'Автопогашение: без штрафа' else 'Страховка отменила штраф' end,
        jsonb_build_object('credit', c.id));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function cb_ping() returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'bank', 'Чекунец Банк', 'clients', (select count(*) from cb_users));
$$;

create or replace function cb_register(
  p_first text, p_last text, p_phone text, p_email text, p_pin text,
  p_card text, p_holder text, p_exp text, p_cvv text, p_account text, p_bonus numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; tok uuid; r text := 'client';
begin
  if p_phone !~ '^\+7[3489][0-9]{9}$' then raise exception 'Некорректный номер телефона'; end if;
  if coalesce(p_email,'') <> '' and p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Некорректная почта';
  end if;
  if length(coalesce(p_pin,'')) < 16 then raise exception 'Некорректный PIN-код'; end if;
  if exists(select 1 from cb_users where phone = p_phone) then
    raise exception 'Клиент с таким телефоном уже зарегистрирован';
  end if;

  if p_first = 'Сергей' and p_last = 'Крюков'
     and not exists(select 1 from cb_users where role = 'admin') then
    r := 'admin';
  end if;

  insert into cb_users(first_name,last_name,phone,email,pin_hash,card_number,card_holder,card_exp,card_cvv,account_number,role)
    values (left(p_first,30), left(p_last,30), p_phone, left(coalesce(p_email,''),120), p_pin,
            p_card, p_holder, p_exp, p_cvv, p_account, r)
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
  if u.blocked then raise exception 'Счёт заблокирован. %', u.blocked_reason; end if;
  insert into cb_sessions(user_id) values (u.id) returning token into tok;
  return jsonb_build_object('token', tok, 'user', cb_pub(u));
end $$;

create or replace function cb_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; n int; d int;
begin
  u := cb_auth(p_token);
  n := cb_process_overdue(u.id);
  d := cb_process_deposits(u.id);
  select * into u from cb_users where id = u.id;
  return jsonb_build_object(
    'user', cb_pub(u),
    'overdue_applied', n,
    'deposits_matured', d,
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object('id',x.id,'amount',x.amount,'rate',x.rate,'days',x.days,'total',x.total,
                                          'status',x.status,'opened_at',x.opened_at,'due_at',x.due_at)
                       order by x.opened_at desc)
      from cb_deposits x where x.user_id = u.id), '[]'::jsonb),
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

create or replace function cb_lookup(p_query text) returns cb_users
language plpgsql security definer set search_path = public as $$
declare d text; q text; u cb_users;
begin
  q := lower(btrim(coalesce(p_query,'')));
  d := regexp_replace(coalesce(p_query,''), '\D', '', 'g');
  if length(d) = 11 and left(d,1) in ('7','8') then d := '7' || substr(d,2);
  elsif length(d) = 10 then d := '7' || d;
  end if;
  select * into u from cb_users
   where (length(d) > 0 and (phone = '+' || d or card_number = d or account_number = d))
      or (length(q) > 2 and lower(first_name || ' ' || last_name) = q)
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
  if t.blocked then raise exception 'Счёт получателя заблокирован'; end if;
  return jsonb_build_object('name', t.first_name || ' ' || left(t.last_name,1) || '.',
                            'phone', cb_mask(t.phone));
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
  if t.blocked then raise exception 'Счёт получателя заблокирован'; end if;

  perform 1 from cb_users where id in (me.id, t.id) order by id for update;

  select balance into bal from cb_users where id = me.id;
  if bal < amt then raise exception 'Недостаточно чекурублей на счёте'; end if;

  bal := cb_post(me.id, -amt, 'transfer_out', 'Перевод — ' || t.first_name || ' ' || t.last_name,
                 jsonb_build_object('to', cb_mask(t.phone), 'note', left(coalesce(p_note,''),60)));
  perform cb_post(t.id, amt, 'transfer_in', 'Перевод от ' || me.first_name || ' ' || me.last_name,
                 jsonb_build_object('from', cb_mask(me.phone), 'note', left(coalesce(p_note,''),60)));

  return jsonb_build_object('ok', true, 'balance', bal, 'to', t.first_name || ' ' || t.last_name);
end $$;

create or replace function cb_game(p_token text, p_game text, p_stake numeric, p_payout numeric, p_title text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; st numeric; po numeric; bal numeric; cb numeric := 0;
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
  if po < st and coalesce((u.inventory->>'cashback')::boolean, false) then
    cb := round((st - po) * 0.05, 2);
    bal := cb_post(u.id, cb, 'cashback', 'Кэшбек с проигрыша', jsonb_build_object('game', p_game));
  end if;
  return jsonb_build_object('balance', bal, 'delta', po - st, 'cashback', cb);
end $$;

create or replace function cb_credit_take(p_token text, p_amount numeric, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; amt numeric; rate int; tot numeric; lim numeric; c cb_credits; bal numeric;
begin
  u := cb_auth(p_token);
  perform cb_process_overdue(u.id);
  select case when coalesce((inventory->>'limit_up')::boolean, false) then 150000 else 50000 end
    into lim from cb_users where id = u.id;
  amt := round(coalesce(p_amount,0), 2);
  if amt < 100 or amt > lim then raise exception 'Сумма кредита: от 100 до % чекурублей', lim; end if;
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
declare u cb_users; bal numeric; sum_ numeric; boosted boolean;
begin
  u := cb_auth(p_token);
  if u.last_bonus = current_date then raise exception 'Бонус сегодня уже получен'; end if;
  boosted := coalesce((u.inventory->>'bonus_boost_until')::timestamptz > now(), false);
  sum_ := case when boosted then 100 else 50 end;
  update cb_users set last_bonus = current_date where id = u.id;
  bal := cb_post(u.id, sum_, 'bonus',
                 case when boosted then 'Ежедневный бонус ×2' else 'Ежедневный бонус клиента' end, '{}'::jsonb);
  return jsonb_build_object('amount', sum_, 'balance', bal);
end $$;

create or replace function cb_shop_buy(p_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; it cb_shop_items; invn jsonb; bal numeric; base timestamptz;
begin
  u := cb_auth(p_token);
  select * into it from cb_shop_items where id = p_item;
  if not found then raise exception 'Товар не найден'; end if;
  perform 1 from cb_users where id = u.id for update;
  select balance, inventory into bal, invn from cb_users where id = u.id;

  if it.kind = 'skin' and invn->'skins' ? it.value then raise exception 'Скин уже куплен'; end if;
  if it.kind = 'title' and invn->'titles' ? it.value then raise exception 'Титул уже куплен'; end if;
  if it.kind = 'perk' and coalesce((invn->>'limit_up')::boolean,false) then raise exception 'Лимит уже повышен'; end if;
  if it.kind = 'avatar' and coalesce((invn->>'avatar')::boolean,false) then raise exception 'Уже куплено'; end if;
  if it.kind = 'cashback' and coalesce((invn->>'cashback')::boolean,false) then raise exception 'Кэшбек уже подключён'; end if;
  if it.kind = 'autopay' and coalesce((invn->>'autopay')::boolean,false) then raise exception 'Автопогашение уже подключено'; end if;
  if it.kind = 'deposit_plus' and coalesce((invn->>'deposit_plus')::boolean,false) then raise exception 'Повышенная ставка уже подключена'; end if;
  if it.kind = 'engraving' and coalesce((invn->>'engraving')::boolean,false) then raise exception 'Гравировка уже куплена'; end if;
  if bal < it.price then raise exception 'Недостаточно чекурублей'; end if;

  if it.kind = 'skin' then
    invn := jsonb_set(invn, '{skins}', (invn->'skins') || to_jsonb(it.value));
  elsif it.kind = 'title' then
    invn := jsonb_set(invn, '{titles}', (invn->'titles') || to_jsonb(it.value));
  elsif it.kind = 'perk' then
    invn := jsonb_set(invn, '{limit_up}', 'true'::jsonb);
  elsif it.kind = 'consumable' then
    invn := jsonb_set(invn, '{insurance}', to_jsonb(coalesce((invn->>'insurance')::int,0) + 1));
  elsif it.kind = 'avatar' then
    invn := jsonb_set(invn, '{avatar}', 'true'::jsonb);
  elsif it.kind = 'cashback' then
    invn := jsonb_set(invn, '{cashback}', 'true'::jsonb);
  elsif it.kind = 'autopay' then
    invn := jsonb_set(invn, '{autopay}', 'true'::jsonb);
  elsif it.kind = 'deposit_plus' then
    invn := jsonb_set(invn, '{deposit_plus}', 'true'::jsonb);
  elsif it.kind = 'engraving' then
    invn := jsonb_set(invn, '{engraving}', 'true'::jsonb);
  elsif it.kind = 'case' then
    invn := jsonb_set(invn, '{cases}', to_jsonb(coalesce((invn->>'cases')::int,0) + 1));
  elsif it.kind = 'holidays' then
    invn := jsonb_set(invn, '{holidays}', to_jsonb(coalesce((invn->>'holidays')::int,0) + 1));
  elsif it.kind = 'reissue' then
    perform cb_new_card(u.id);
  elsif it.kind = 'boost' then
    base := greatest(coalesce((invn->>'bonus_boost_until')::timestamptz, now()), now());
    invn := jsonb_set(invn, '{bonus_boost_until}', to_jsonb((base + interval '7 days')));
  end if;

  update cb_users set inventory = invn where id = u.id;
  bal := cb_post(u.id, -it.price, 'shop', 'Покупка: ' || it.id, jsonb_build_object('item', it.id));
  select * into u from cb_users where id = u.id;
  return jsonb_build_object('balance', bal, 'user', cb_pub(u));
end $$;

create or replace function cb_shop_equip(p_token text, p_kind text, p_value text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_auth(p_token);
  if p_kind = 'skin' then
    if p_value <> 'base' and not (u.inventory->'skins' ? p_value) then raise exception 'Скин не куплен'; end if;
  elsif p_kind = 'title' then
    if p_value <> '' and not (u.inventory->'titles' ? p_value) then raise exception 'Титул не куплен'; end if;
  elsif p_kind = 'avatar' then
    if p_value <> '' and not coalesce((u.inventory->>'avatar')::boolean, false) then
      raise exception 'Цвет значка не куплен';
    end if;
  else
    raise exception 'Неизвестный предмет';
  end if;
  update cb_users set equipped = jsonb_set(equipped, array[p_kind], to_jsonb(p_value)) where id = u.id;
  select * into u from cb_users where id = u.id;
  return jsonb_build_object('user', cb_pub(u));
end $$;

create or replace function cb_update_profile(p_token text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; ph text; em text;
begin
  u := cb_auth(p_token);
  em := p_patch->>'email';
  ph := p_patch->>'phone';
  if em is not null then
    if em <> '' and em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then raise exception 'Некорректная почта'; end if;
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
    select jsonb_agg(jsonb_build_object('name', first_name || ' ' || left(last_name,1) || '.',
                                        'balance', balance, 'title', coalesce(equipped->>'title',''), 'role', role)
                     order by balance desc)
    from (select first_name, last_name, balance, equipped, role from cb_users
           where not blocked and coalesce(settings->>'public','true') <> 'false'
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

create or replace function cb_admin_stats(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_staff(p_token, true);
  return jsonb_build_object(
    'clients', (select count(*) from cb_users),
    'blocked', (select count(*) from cb_users where blocked),
    'admins', (select count(*) from cb_users where role = 'admin'),
    'developers', (select count(*) from cb_users where role = 'developer'),
    'debtors', (select count(*) from cb_users where balance < 0),
    'money', (select coalesce(sum(balance),0) from cb_users),
    'tx_count', (select count(*) from cb_tx),
    'turnover_24h', (select coalesce(sum(abs(amount)),0) from cb_tx where ts > now() - interval '24 hours'),
    'transfers', (select count(*) from cb_tx where category = 'transfer_out'),
    'transfers_sum', (select coalesce(-sum(amount),0) from cb_tx where category = 'transfer_out'),
    'issued', (select coalesce(sum(amount),0) from cb_tx where category = 'emission'),
    'shop_sum', (select coalesce(-sum(amount),0) from cb_tx where category = 'shop'),
    'credits_active', (select count(*) from cb_credits where status = 'active'),
    'credits_overdue', (select count(*) from cb_credits where status = 'overdue'),
    'credits_sum', (select coalesce(sum(amount),0) from cb_credits),
    'games_count', (select count(*) from cb_tx where category like 'game%'),
    'games_profit', (select coalesce(-sum(amount),0) from cb_tx where category like 'game%'),
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'count',
               (select count(*) from cb_users where created_at::date = d::date)) order by d)
      from generate_series(current_date - 6, current_date, interval '1 day') d), '[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name', first_name || ' ' || last_name, 'balance', balance) order by balance desc)
      from (select first_name, last_name, balance from cb_users order by balance desc limit 5) t), '[]'::jsonb));
end $$;

create or replace function cb_admin_users(p_token text, p_query text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; q text; d text;
begin
  u := cb_staff(p_token, true);
  q := lower(btrim(coalesce(p_query,'')));
  d := regexp_replace(coalesce(p_query,''), '\D', '', 'g');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'first_name', x.first_name, 'last_name', x.last_name, 'phone', x.phone,
      'email', x.email, 'card_number', x.card_number, 'balance', x.balance, 'role', x.role,
      'blocked', x.blocked, 'blocked_reason', x.blocked_reason, 'created_at', x.created_at,
      'title', coalesce(x.equipped->>'title',''),
      'tx_count', (select count(*) from cb_tx t where t.user_id = x.id),
      'credits', (select count(*) from cb_credits c where c.user_id = x.id and c.status = 'active'))
      order by x.created_at desc)
    from (select * from cb_users
           where q = ''
              or lower(first_name || ' ' || last_name) like '%' || q || '%'
              or lower(email) like '%' || q || '%'
              or (length(d) > 2 and (phone like '%' || d || '%' or card_number like '%' || d || '%'))
           order by created_at desc limit 100) x), '[]'::jsonb);
end $$;

create or replace function cb_admin_issue(p_token text, p_query text, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me cb_users; t cb_users; amt numeric; bal numeric;
begin
  me := cb_staff(p_token, false);
  t := cb_lookup(p_query);
  if t.id is null then raise exception 'Клиент не найден'; end if;
  amt := round(coalesce(p_amount,0), 2);
  if amt = 0 then raise exception 'Некорректная сумма'; end if;
  if abs(amt) > 10000000 then raise exception 'Слишком крупная сумма'; end if;
  bal := cb_post(t.id, amt,
    'emission',
    case when amt > 0 then 'Начисление от банка' else 'Списание банком' end ||
    case when coalesce(p_reason,'') <> '' then ': ' || left(p_reason,60) else '' end,
    jsonb_build_object('by', cb_mask(me.phone)));
  return jsonb_build_object('balance', bal, 'name', t.first_name || ' ' || t.last_name);
end $$;

create or replace function cb_admin_role(p_token text, p_query text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me cb_users; t cb_users;
begin
  me := cb_staff(p_token, false);
  if p_role not in ('client','developer','admin') then raise exception 'Неизвестная роль'; end if;
  t := cb_lookup(p_query);
  if t.id is null then raise exception 'Клиент не найден'; end if;
  if t.id = me.id then raise exception 'Нельзя изменить собственную роль'; end if;
  update cb_users set role = p_role where id = t.id;
  return jsonb_build_object('name', t.first_name || ' ' || t.last_name, 'role', p_role);
end $$;

create or replace function cb_admin_block(p_token text, p_query text, p_blocked boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me cb_users; t cb_users;
begin
  me := cb_staff(p_token, false);
  t := cb_lookup(p_query);
  if t.id is null then raise exception 'Клиент не найден'; end if;
  if t.id = me.id then raise exception 'Нельзя заблокировать самого себя'; end if;
  if t.role = 'admin' then raise exception 'Нельзя заблокировать администратора'; end if;
  update cb_users set blocked = p_blocked,
         blocked_reason = case when p_blocked then coalesce(nullif(left(p_reason,60),''), 'Нарушение правил банка') else '' end
   where id = t.id;
  if p_blocked then delete from cb_sessions where user_id = t.id; end if;
  return jsonb_build_object('name', t.first_name || ' ' || t.last_name, 'blocked', p_blocked);
end $$;

create or replace function cb_admin_feed(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_staff(p_token, true);
  return coalesce((
    select jsonb_agg(jsonb_build_object('ts', t.ts, 'who', x.first_name || ' ' || x.last_name,
                                        'title', t.title, 'amount', t.amount, 'category', t.category)
                     order by t.ts desc)
    from (select * from cb_tx order by ts desc limit 40) t
    join cb_users x on x.id = t.user_id), '[]'::jsonb);
end $$;

create or replace function cb_mask(p_phone text) returns text
language sql immutable as $$
  select case when length(regexp_replace(coalesce(p_phone,''), '\D', '', 'g')) = 11
    then '+7 (' || substr(regexp_replace(p_phone, '\D', '', 'g'), 2, 3) || ') ***-**-' ||
         right(regexp_replace(p_phone, '\D', '', 'g'), 2)
    else '' end;
$$;

create or replace function cb_process_deposits(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare d cb_deposits; n int := 0;
begin
  for d in select * from cb_deposits
            where user_id = p_user and status = 'active' and due_at <= now() for update loop
    update cb_deposits set status = 'closed', closed_at = now() where id = d.id;
    perform cb_post(p_user, d.total, 'deposit',
      'Вклад закрыт с доходом ' || round(d.total - d.amount, 2), jsonb_build_object('deposit', d.id));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function cb_deposit_open(p_token text, p_amount numeric, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; amt numeric; rate int; bal numeric; d cb_deposits;
begin
  u := cb_auth(p_token);
  rate := case p_days when 1 then 2 when 3 then 5 when 7 then 9 when 30 then 20 else null end;
  if rate is null then raise exception 'Неизвестная программа вклада'; end if;
  if coalesce((u.inventory->>'deposit_plus')::boolean, false) then rate := rate + 3; end if;
  amt := round(coalesce(p_amount,0), 2);
  if amt < 500 then raise exception 'Минимальный вклад: 500 чекурублей'; end if;
  if (select count(*) from cb_deposits where user_id = u.id and status = 'active') >= 5 then
    raise exception 'Больше пяти вкладов сразу открыть нельзя';
  end if;
  perform 1 from cb_users where id = u.id for update;
  select balance into bal from cb_users where id = u.id;
  if bal < amt then raise exception 'Недостаточно чекурублей'; end if;
  insert into cb_deposits(user_id, amount, rate, days, total, due_at)
    values (u.id, amt, rate, p_days, round(amt * (1 + rate::numeric/100), 2), now() + (p_days || ' days')::interval)
    returning * into d;
  bal := cb_post(u.id, -amt, 'deposit', 'Открыт вклад на ' || p_days || ' дн.', jsonb_build_object('deposit', d.id));
  return jsonb_build_object('balance', bal, 'deposit', to_jsonb(d));
end $$;

create or replace function cb_deposit_close(p_token text, p_deposit text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; d cb_deposits; matured boolean; back numeric; bal numeric;
begin
  u := cb_auth(p_token);
  select * into d from cb_deposits where id = p_deposit::uuid and user_id = u.id for update;
  if not found or d.status <> 'active' then raise exception 'Вклад не найден или уже закрыт'; end if;
  matured := d.due_at <= now();
  back := case when matured then d.total else d.amount end;
  update cb_deposits set status = case when matured then 'closed' else 'early' end, closed_at = now()
   where id = d.id returning * into d;
  bal := cb_post(u.id, back, 'deposit',
    case when matured then 'Вклад закрыт с доходом' else 'Вклад закрыт досрочно, без процентов' end,
    jsonb_build_object('deposit', d.id));
  return jsonb_build_object('balance', bal, 'deposit', to_jsonb(d), 'early', not matured);
end $$;

create or replace function cb_new_card(p_user uuid) returns cb_users
language plpgsql security definer set search_path = public as $$
declare body text; sum_ int; d int; dbl boolean; num text; u cb_users; tries int := 0;
begin
  loop
    tries := tries + 1;
    body := '4200';
    while length(body) < 15 loop body := body || floor(random()*10)::int::text; end loop;
    sum_ := 0; dbl := true;
    for i in reverse 15..1 loop
      d := substr(body, i, 1)::int;
      if dbl then d := d * 2; if d > 9 then d := d - 9; end if; end if;
      dbl := not dbl;
      sum_ := sum_ + d;
    end loop;
    num := body || ((10 - (sum_ % 10)) % 10)::text;
    exit when not exists(select 1 from cb_users where card_number = num) or tries > 20;
  end loop;
  update cb_users
     set card_number = num,
         card_cvv = lpad(floor(random()*900 + 100)::int::text, 3, '0'),
         card_exp = to_char(now() + interval '5 years', 'MM/YY')
   where id = p_user
   returning * into u;
  return u;
end $$;

create or replace function cb_reissue(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users;
begin
  u := cb_auth(p_token);
  u := cb_new_card(u.id);
  return jsonb_build_object('user', cb_pub(u));
end $$;

create or replace function cb_engrave(p_token text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; clean text;
begin
  u := cb_auth(p_token);
  if not coalesce((u.inventory->>'engraving')::boolean, false) then raise exception 'Гравировка не куплена'; end if;
  clean := btrim(left(regexp_replace(upper(coalesce(p_text,'')), '[^A-Z0-9 .-]', '', 'g'), 16));
  update cb_users set engraving = clean where id = u.id;
  select * into u from cb_users where id = u.id;
  return jsonb_build_object('user', cb_pub(u));
end $$;

create or replace function cb_case_open(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; invn jsonb; cases int; roll numeric; amt numeric := 0; skin text := null; bal numeric; title text;
begin
  u := cb_auth(p_token);
  perform 1 from cb_users where id = u.id for update;
  select inventory into invn from cb_users where id = u.id;
  cases := coalesce((invn->>'cases')::int, 0);
  if cases < 1 then raise exception 'Ящиков нет — купите в магазине'; end if;
  invn := jsonb_set(invn, '{cases}', to_jsonb(cases - 1));

  roll := random() * 100;
  if roll < 1 and not (invn->'skins' ? 'goldbank') then
    skin := 'goldbank';
    invn := jsonb_set(invn, '{skins}', (invn->'skins') || to_jsonb('goldbank'::text));
  elsif roll < 21 then amt := 0;
  elsif roll < 46 then amt := 200;
  elsif roll < 66 then amt := 500;
  elsif roll < 81 then amt := 1000;
  elsif roll < 91 then amt := 2500;
  elsif roll < 98 then amt := 5000;
  else amt := 10000;
  end if;

  update cb_users set inventory = invn where id = u.id;
  title := case when skin is not null then 'Ящик чекушек: оформление «Золото банка»'
                when amt > 0 then 'Ящик чекушек: выигрыш'
                else 'Ящик чекушек: пусто' end;
  bal := cb_post(u.id, amt, 'case', title, jsonb_build_object('skin', skin, 'amount', amt));
  select * into u from cb_users where id = u.id;
  return jsonb_build_object('balance', bal, 'user', cb_pub(u),
                            'prize', jsonb_build_object('amount', amt, 'skin', skin));
end $$;

create or replace function cb_credit_extend(p_token text, p_credit text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u cb_users; c cb_credits; invn jsonb; hol int;
begin
  u := cb_auth(p_token);
  perform 1 from cb_users where id = u.id for update;
  select inventory into invn from cb_users where id = u.id;
  hol := coalesce((invn->>'holidays')::int, 0);
  if hol < 1 then raise exception 'Кредитных каникул нет — купите в магазине'; end if;
  select * into c from cb_credits where id = p_credit::uuid and user_id = u.id for update;
  if not found or c.status <> 'active' then raise exception 'Кредит не найден или уже закрыт'; end if;
  update cb_users set inventory = jsonb_set(invn, '{holidays}', to_jsonb(hol - 1)) where id = u.id;
  update cb_credits set due_at = due_at + interval '3 days', days = days + 3 where id = c.id returning * into c;
  perform cb_post(u.id, 0, 'credit', 'Кредитные каникулы: срок продлён на 3 дня', jsonb_build_object('credit', c.id));
  return jsonb_build_object('credit', to_jsonb(c));
end $$;

revoke all on all tables in schema public from anon, authenticated;

grant execute on function
  cb_ping(), cb_register(text,text,text,text,text,text,text,text,text,text,numeric),
  cb_login(text,text), cb_state(text), cb_find(text,text),
  cb_transfer(text,text,numeric,text), cb_game(text,text,numeric,numeric,text),
  cb_credit_take(text,numeric,int), cb_credit_pay(text,text,numeric),
  cb_daily_bonus(text), cb_update_profile(text,jsonb), cb_change_pin(text,text,text),
  cb_top(text), cb_logout(text), cb_delete_account(text),
  cb_shop_buy(text,text), cb_shop_equip(text,text,text),
  cb_case_open(text), cb_engrave(text,text), cb_reissue(text), cb_credit_extend(text,text),
  cb_deposit_open(text,numeric,int), cb_deposit_close(text,text),
  cb_admin_stats(text), cb_admin_users(text,text), cb_admin_issue(text,text,numeric,text),
  cb_admin_role(text,text,text), cb_admin_block(text,text,boolean,text), cb_admin_feed(text)
to anon, authenticated;

revoke execute on function cb_auth(text), cb_staff(text,boolean), cb_post(uuid,numeric,text,text,jsonb),
  cb_process_overdue(uuid), cb_process_deposits(uuid), cb_lookup(text), cb_new_card(uuid)
  from anon, authenticated, public;
