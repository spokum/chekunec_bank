/* Чекунец Банк — слой доступа к данным.
   Два одинаковых по интерфейсу адаптера:
     • SupabaseApi — настоящий онлайн-банк (общая база, переводы между людьми)
     • DemoApi     — офлайн-демо в localStorage, если сервер не настроен      */
(function (global) {
  'use strict';

  /* ---------------- общие утилиты ---------------- */

  const TRANSLIT = {
    а:'A',б:'B',в:'V',г:'G',д:'D',е:'E',ё:'E',ж:'ZH',з:'Z',и:'I',й:'I',к:'K',л:'L',м:'M',
    н:'N',о:'O',п:'P',р:'R',с:'S',т:'T',у:'U',ф:'F',х:'KH',ц:'TS',ч:'CH',ш:'SH',щ:'SHCH',
    ъ:'',ы:'Y',ь:'',э:'E',ю:'IU',я:'IA',' ':' ','-':'-'
  };

  function translit(str) {
    return String(str || '').toLowerCase().split('')
      .map(ch => (ch in TRANSLIT ? TRANSLIT[ch] : /[a-z0-9 \-]/.test(ch) ? ch.toUpperCase() : ''))
      .join('').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  /** Телефон → строгий формат +7XXXXXXXXXX (или null). */
  function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
    else if (d.length === 10 && d[0] === '9') d = '7' + d;
    if (!/^7[3489]\d{9}$/.test(d)) return null;
    return '+' + d;
  }

  function prettyPhone(p) {
    const d = String(p || '').replace(/\D/g, '');
    if (d.length !== 11) return p || '';
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  }

  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Я]{2,}$/.test(String(v || '').trim()); }

  /** Контрольная цифра Луна — номер карты проходит настоящую проверку. */
  function luhnCheckDigit(num15) {
    let sum = 0, dbl = true;
    for (let i = num15.length - 1; i >= 0; i--) {
      let d = +num15[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      dbl = !dbl; sum += d;
    }
    return (10 - (sum % 10)) % 10;
  }

  const BIN = '4200'; // «БИН» Чекунец Банка

  function genCardNumber() {
    let body = BIN;
    while (body.length < 15) body += Math.floor(Math.random() * 10);
    return body + luhnCheckDigit(body);
  }

  function genAccount() {
    let a = '40817810';
    while (a.length < 20) a += Math.floor(Math.random() * 10);
    return a;
  }

  function genExpiry(years) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + (years || 5));
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(2);
  }

  function genCvv() { return String(Math.floor(Math.random() * 900) + 100); }

  function uid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async function hashPin(phone, pin) {
    const data = new TextEncoder().encode('chekunec:' + phone + ':' + pin);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function newCardFor(first, last) {
    return {
      card_number: genCardNumber(),
      card_holder: translit(first) + ' ' + translit(last),
      card_exp: genExpiry(5),
      card_cvv: genCvv(),
      account_number: genAccount()
    };
  }

  const WELCOME_BONUS = 500;
  const CREDIT_PLANS = [
    { days: 1,  rate: 5,  label: '1 день' },
    { days: 3,  rate: 10, label: '3 дня' },
    { days: 7,  rate: 18, label: '7 дней' },
    { days: 30, rate: 35, label: '30 дней' }
  ];
  const PENALTY_RATE = 25; // штраф при просрочке, % от остатка долга

  /* ---------------- адаптер: Supabase (онлайн) ---------------- */

  class SupabaseApi {
    constructor(url, key) {
      this.url = String(url).replace(/\/+$/, '');
      this.key = key;
      this.mode = 'online';
    }

    async rpc(fn, args) {
      let res;
      try {
        res = await fetch(this.url + '/rest/v1/rpc/' + fn, {
          method: 'POST',
          headers: {
            'apikey': this.key,
            'Authorization': 'Bearer ' + this.key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(args || {})
        });
      } catch (e) {
        throw new Error('Нет связи с сервером банка. Проверьте интернет.');
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
      if (!res.ok) {
        const msg = (data && (data.message || data.hint || data.error)) || ('Ошибка сервера (' + res.status + ')');
        throw new Error(String(msg).replace(/^ERR:\s*/, ''));
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    }

    ping() { return this.rpc('cb_ping', {}); }

    async register(f) {
      const pin_hash = await hashPin(f.phone, f.pin);
      const card = newCardFor(f.first, f.last);
      return this.rpc('cb_register', {
        p_first: f.first, p_last: f.last, p_phone: f.phone, p_email: f.email,
        p_pin: pin_hash, p_card: card.card_number, p_holder: card.card_holder,
        p_exp: card.card_exp, p_cvv: card.card_cvv, p_account: card.account_number,
        p_bonus: WELCOME_BONUS
      });
    }

    async login(phone, pin) {
      return this.rpc('cb_login', { p_phone: phone, p_pin: await hashPin(phone, pin) });
    }

    state(token) { return this.rpc('cb_state', { p_token: token }); }
    find(token, q) { return this.rpc('cb_find', { p_token: token, p_query: q }); }
    transfer(token, q, amount, note) {
      return this.rpc('cb_transfer', { p_token: token, p_query: q, p_amount: amount, p_note: note || '' });
    }
    game(token, g) {
      return this.rpc('cb_game', { p_token: token, p_game: g.game, p_stake: g.stake, p_payout: g.payout, p_title: g.title });
    }
    creditTake(token, amount, days) { return this.rpc('cb_credit_take', { p_token: token, p_amount: amount, p_days: days }); }
    creditPay(token, id, amount) { return this.rpc('cb_credit_pay', { p_token: token, p_credit: id, p_amount: amount }); }
    dailyBonus(token) { return this.rpc('cb_daily_bonus', { p_token: token }); }
    updateProfile(token, patch) { return this.rpc('cb_update_profile', { p_token: token, p_patch: patch }); }
    async changePin(token, oldPin, newPin, phone) {
      return this.rpc('cb_change_pin', {
        p_token: token, p_old: await hashPin(phone, oldPin), p_new: await hashPin(phone, newPin)
      });
    }
    top(token) { return this.rpc('cb_top', { p_token: token }); }
    logout(token) { return this.rpc('cb_logout', { p_token: token }); }
    remove(token) { return this.rpc('cb_delete_account', { p_token: token }); }
  }

  /* ---------------- адаптер: демо (localStorage) ---------------- */

  const LS = 'chekunec_bank_demo_v1';

  class DemoApi {
    constructor() { this.mode = 'demo'; }

    db() {
      try { return JSON.parse(localStorage.getItem(LS)) || { users: [], tx: [], credits: [] }; }
      catch (_) { return { users: [], tx: [], credits: [] }; }
    }
    save(db) { localStorage.setItem(LS, JSON.stringify(db)); }
    byToken(db, token) {
      const u = db.users.find(x => x.token === token);
      if (!u) throw new Error('Сессия истекла, войдите заново');
      return u;
    }
    push(db, user, amount, category, title, meta) {
      user.balance = Math.round((user.balance + amount) * 100) / 100;
      db.tx.push({
        id: uid(), user_id: user.id, ts: new Date().toISOString(), amount,
        category, title, balance_after: user.balance, meta: meta || {}
      });
    }

    async register(f) {
      const db = this.db();
      if (db.users.some(u => u.phone === f.phone)) throw new Error('Такой телефон уже зарегистрирован');
      let card = newCardFor(f.first, f.last);
      while (db.users.some(u => u.card_number === card.card_number)) card = newCardFor(f.first, f.last);
      const user = {
        id: uid(), token: uid(), first_name: f.first, last_name: f.last,
        phone: f.phone, email: f.email, pin_hash: await hashPin(f.phone, f.pin),
        balance: 0, created_at: new Date().toISOString(), last_bonus: null,
        settings: { theme: 'dark', hide_balance: false, sound: true, notify: true, public: true },
        ...card
      };
      db.users.push(user);
      this.push(db, user, WELCOME_BONUS, 'bonus', 'Приветственный бонус');
      this.save(db);
      return { token: user.token, user: this.pub(user) };
    }

    async login(phone, pin) {
      const db = this.db();
      const u = db.users.find(x => x.phone === phone);
      if (!u) throw new Error('Клиент с таким номером не найден');
      if (u.pin_hash !== await hashPin(phone, pin)) throw new Error('Неверный PIN-код');
      u.token = uid(); this.save(db);
      return { token: u.token, user: this.pub(u) };
    }

    pub(u) {
      const { pin_hash, token, ...rest } = u;
      return rest;
    }

    /** Просрочка: списываем остаток долга + штраф, баланс может уйти в минус. */
    processOverdue(db, user) {
      const now = Date.now();
      let hit = 0;
      db.credits.filter(c => c.user_id === user.id && c.status === 'active')
        .forEach(c => {
          if (new Date(c.due_at).getTime() > now) return;
          const rest = Math.round((c.total - c.paid) * 100) / 100;
          const penalty = Math.round(rest * PENALTY_RATE) / 100;
          c.status = 'overdue'; c.paid = c.total; c.closed_at = new Date().toISOString();
          c.penalty = penalty;
          this.push(db, user, -rest, 'credit', 'Принудительное списание по кредиту', { credit: c.id });
          this.push(db, user, -penalty, 'penalty', 'Штраф за просрочку (' + PENALTY_RATE + '%)', { credit: c.id });
          hit++;
        });
      return hit;
    }

    async state(token) {
      const db = this.db();
      const u = this.byToken(db, token);
      const overdue = this.processOverdue(db, u);
      this.save(db);
      return {
        user: this.pub(u),
        transactions: db.tx.filter(t => t.user_id === u.id).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200),
        credits: db.credits.filter(c => c.user_id === u.id).sort((a, b) => b.taken_at.localeCompare(a.taken_at)),
        overdue_applied: overdue,
        clients: db.users.length
      };
    }

    lookup(db, q) {
      const digits = String(q || '').replace(/\D/g, '');
      const phone = normalizePhone(q);
      return db.users.find(u => (phone && u.phone === phone) ||
        (digits.length === 16 && u.card_number === digits) ||
        (digits.length === 20 && u.account_number === digits));
    }

    async find(token, q) {
      const db = this.db(); const me = this.byToken(db, token);
      const t = this.lookup(db, q);
      if (!t) throw new Error('Клиент Чекунец Банка не найден');
      if (t.id === me.id) throw new Error('Это ваш собственный счёт');
      return { name: t.first_name + ' ' + t.last_name[0] + '.', phone: prettyPhone(t.phone) };
    }

    async transfer(token, q, amount, note) {
      const db = this.db(); const me = this.byToken(db, token);
      this.processOverdue(db, me);
      amount = Math.round(Number(amount) * 100) / 100;
      if (!(amount > 0)) throw new Error('Некорректная сумма');
      const to = this.lookup(db, q);
      if (!to) throw new Error('Клиент Чекунец Банка не найден');
      if (to.id === me.id) throw new Error('Нельзя перевести самому себе');
      if (me.balance < amount) throw new Error('Недостаточно чекурублей на счёте');
      const other = db.users.find(u => u.id === to.id);
      this.push(db, me, -amount, 'transfer_out', 'Перевод — ' + other.first_name + ' ' + other.last_name,
        { to: other.phone, note: note || '' });
      this.push(db, other, amount, 'transfer_in', 'Перевод от ' + me.first_name + ' ' + me.last_name,
        { from: me.phone, note: note || '' });
      this.save(db);
      return { ok: true, balance: me.balance, to: other.first_name + ' ' + other.last_name };
    }

    async game(token, g) {
      const db = this.db(); const u = this.byToken(db, token);
      const stake = Math.max(0, Math.round(Number(g.stake) * 100) / 100);
      const payout = Math.max(0, Math.round(Number(g.payout) * 100) / 100);
      if (stake > 0 && u.balance < stake) throw new Error('Недостаточно чекурублей для ставки');
      const delta = Math.round((payout - stake) * 100) / 100;
      this.push(db, u, delta, stake > 0 ? 'game_bet' : 'game_win', g.title, { game: g.game, stake, payout });
      this.save(db);
      return { balance: u.balance, delta };
    }

    async creditTake(token, amount, days) {
      const db = this.db(); const u = this.byToken(db, token);
      this.processOverdue(db, u);
      const plan = CREDIT_PLANS.find(p => p.days === days);
      if (!plan) throw new Error('Неизвестная программа кредитования');
      amount = Math.round(Number(amount) * 100) / 100;
      if (!(amount >= 100 && amount <= 50000)) throw new Error('Сумма кредита: от 100 до 50 000 ₡');
      const active = db.credits.filter(c => c.user_id === u.id && c.status === 'active');
      if (active.length >= 3) throw new Error('Нельзя иметь больше трёх активных кредитов');
      const total = Math.round(amount * (1 + plan.rate / 100) * 100) / 100;
      const c = {
        id: uid(), user_id: u.id, amount, rate: plan.rate, days: plan.days, total, paid: 0,
        taken_at: new Date().toISOString(),
        due_at: new Date(Date.now() + plan.days * 864e5).toISOString(),
        status: 'active'
      };
      db.credits.push(c);
      this.push(db, u, amount, 'credit', 'Кредит на ' + plan.label, { credit: c.id });
      this.save(db);
      return { credit: c, balance: u.balance };
    }

    async creditPay(token, id, amount) {
      const db = this.db(); const u = this.byToken(db, token);
      const c = db.credits.find(x => x.id === id && x.user_id === u.id);
      if (!c || c.status !== 'active') throw new Error('Кредит не найден или уже закрыт');
      amount = Math.round(Number(amount) * 100) / 100;
      const rest = Math.round((c.total - c.paid) * 100) / 100;
      if (!(amount > 0)) throw new Error('Некорректная сумма');
      if (amount > rest) amount = rest;
      if (u.balance < amount) throw new Error('Недостаточно чекурублей');
      c.paid = Math.round((c.paid + amount) * 100) / 100;
      if (c.paid >= c.total - 0.001) { c.status = 'closed'; c.closed_at = new Date().toISOString(); }
      this.push(db, u, -amount, 'credit_pay', c.status === 'closed' ? 'Кредит погашен полностью' : 'Платёж по кредиту', { credit: c.id });
      this.save(db);
      return { credit: c, balance: u.balance };
    }

    async dailyBonus(token) {
      const db = this.db(); const u = this.byToken(db, token);
      const today = new Date().toISOString().slice(0, 10);
      if (u.last_bonus === today) throw new Error('Бонус сегодня уже получен');
      u.last_bonus = today;
      const sum = 50;
      this.push(db, u, sum, 'bonus', 'Ежедневный бонус клиента');
      this.save(db);
      return { amount: sum, balance: u.balance };
    }

    async updateProfile(token, patch) {
      const db = this.db(); const u = this.byToken(db, token);
      if (patch.email) u.email = patch.email;
      if (patch.phone) {
        if (db.users.some(x => x.phone === patch.phone && x.id !== u.id)) throw new Error('Этот телефон уже занят');
        u.phone = patch.phone;
      }
      if (patch.settings) u.settings = { ...u.settings, ...patch.settings };
      this.save(db);
      return { user: this.pub(u) };
    }

    async changePin(token, oldPin, newPin, phone) {
      const db = this.db(); const u = this.byToken(db, token);
      if (u.pin_hash !== await hashPin(u.phone, oldPin)) throw new Error('Текущий PIN неверен');
      u.pin_hash = await hashPin(u.phone, newPin);
      this.save(db);
      return { ok: true };
    }

    async top(token) {
      const db = this.db(); this.byToken(db, token);
      return db.users.filter(u => !u.settings || u.settings.public !== false)
        .sort((a, b) => b.balance - a.balance).slice(0, 10)
        .map(u => ({ name: u.first_name + ' ' + u.last_name[0] + '.', balance: u.balance }));
    }

    async logout(token) {
      const db = this.db();
      const u = db.users.find(x => x.token === token);
      if (u) { u.token = null; this.save(db); }
      return { ok: true };
    }

    async remove(token) {
      const db = this.db(); const u = this.byToken(db, token);
      db.users = db.users.filter(x => x.id !== u.id);
      db.tx = db.tx.filter(t => t.user_id !== u.id);
      db.credits = db.credits.filter(c => c.user_id !== u.id);
      this.save(db);
      return { ok: true };
    }
  }

  /* ---------------- выбор адаптера ---------------- */

  function readOverride() {
    try { return JSON.parse(localStorage.getItem('cb_server')) || null; } catch (_) { return null; }
  }
  function writeOverride(cfg) {
    if (cfg) localStorage.setItem('cb_server', JSON.stringify(cfg));
    else localStorage.removeItem('cb_server');
  }
  function createApi() {
    const ov = readOverride();
    const cfg = (ov && ov.url && ov.anonKey) ? ov : (global.CB_CONFIG || {});
    if (cfg.url && cfg.anonKey) return new SupabaseApi(cfg.url, cfg.anonKey);
    return new DemoApi();
  }

  global.CB = {
    createApi, readOverride, writeOverride,
    SupabaseApi, DemoApi,
    utils: { translit, normalizePhone, prettyPhone, isEmail, luhnCheckDigit, uid },
    consts: { WELCOME_BONUS, CREDIT_PLANS, PENALTY_RATE }
  };
})(window);
