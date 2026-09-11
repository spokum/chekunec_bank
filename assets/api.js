(function (global) {
  'use strict';

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

  function maskPhone(p) {
    const d = String(p || '').replace(/\D/g, '');
    if (d.length !== 11) return '';
    return '+7 (' + d.slice(1, 4) + ') ***-**-' + d.slice(9);
  }

  function luhnCheckDigit(num15) {
    let sum = 0, dbl = true;
    for (let i = num15.length - 1; i >= 0; i--) {
      let d = +num15[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      dbl = !dbl; sum += d;
    }
    return (10 - (sum % 10)) % 10;
  }

  const BIN = '4200';

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
  const PENALTY_RATE = 25;
  const CREDIT_PLANS = [
    { days: 1,  rate: 5,  label: '1 день' },
    { days: 3,  rate: 10, label: '3 дня' },
    { days: 7,  rate: 18, label: '7 дней' },
    { days: 30, rate: 35, label: '30 дней' }
  ];
  const DEPOSIT_PLANS = [
    { days: 1,  rate: 2,  label: '1 день' },
    { days: 3,  rate: 5,  label: '3 дня' },
    { days: 7,  rate: 9,  label: '7 дней' },
    { days: 30, rate: 20, label: '30 дней' }
  ];
  const DEPOSIT_MIN = 500;
  const CREDIT_LIMIT = 50000;
  const CREDIT_LIMIT_VIP = 150000;

  const OWNER = { first: 'Сергей', last: 'Крюков' };

  const ROLES = {
    client: { label: 'Клиент', mark: '' },
    developer: { label: 'Разработчик', mark: 'разработчик' },
    admin: { label: 'Администратор', mark: 'админ' }
  };

  const SKINS = {
    chekushka: { name: 'Чекушка', css: 'linear-gradient(135deg,#17301f 0%,#4a7c4e 60%,#9dc08b 100%)' },
    goldbank:  { name: 'Золото банка', css: 'linear-gradient(135deg,#3b2f10 0%,#9c7c2a 55%,#e0c979 100%)' },
    base:     { name: 'Классическая', css: 'linear-gradient(135deg,#232a3d 0%,#3b4a72 100%)' },
    graphite: { name: 'Графит', css: 'linear-gradient(135deg,#1b1e26 0%,#3c424f 100%)' },
    azure:    { name: 'Лазурь', css: 'linear-gradient(135deg,#1c3350 0%,#4a7ba8 100%)' },
    sand:     { name: 'Песок', css: 'linear-gradient(135deg,#3a3226 0%,#a68f68 100%)' },
    emerald:  { name: 'Изумруд', css: 'linear-gradient(135deg,#16332b 0%,#3f7a63 100%)' },
    platinum: { name: 'Платина', css: 'linear-gradient(135deg,#2d3138 0%,#8d95a3 100%)' }
  };

  const AVATAR_COLORS = {
    indigo: { name: 'Индиго', css: '#5c6bc0' },
    teal:   { name: 'Бирюзовый', css: '#4e9a8a' },
    slate:  { name: 'Графитовый', css: '#5a6474' },
    plum:   { name: 'Сливовый', css: '#7a5c78' },
    clay:   { name: 'Терракота', css: '#a1705a' },
    moss:   { name: 'Мох', css: '#6a7d54' }
  };

  const SHOP = [
    { id: 'skin_graphite', kind: 'skin', value: 'graphite', price: 2500, group: 'Оформление карты',
      name: 'Оформление «Графит»', desc: 'Тёмно-серая карта' },
    { id: 'skin_azure', kind: 'skin', value: 'azure', price: 3000, group: 'Оформление карты',
      name: 'Оформление «Лазурь»', desc: 'Спокойная синяя карта' },
    { id: 'skin_emerald', kind: 'skin', value: 'emerald', price: 3500, group: 'Оформление карты',
      name: 'Оформление «Изумруд»', desc: 'Глубокий зелёный' },
    { id: 'skin_sand', kind: 'skin', value: 'sand', price: 4000, group: 'Оформление карты',
      name: 'Оформление «Песок»', desc: 'Тёплый бежевый' },
    { id: 'skin_chekushka', kind: 'skin', value: 'chekushka', price: 6000, group: 'Оформление карты',
      name: 'Оформление «Чекушка»', desc: 'Бутылочное стекло — фирменный стиль банка' },
    { id: 'skin_platinum', kind: 'skin', value: 'platinum', price: 9000, group: 'Оформление карты',
      name: 'Оформление «Платина»', desc: 'Премиальная карта банка' },

    { id: 'title_lucky', kind: 'title', value: 'Везунчик', price: 1500, group: 'Титулы',
      name: 'Титул «Везунчик»', desc: 'Подпись у имени в профиле и рейтинге' },
    { id: 'title_chekushkin', kind: 'title', value: 'Чекушкин', price: 2500, group: 'Титулы',
      name: 'Титул «Чекушкин»', desc: 'Для своих' },
    { id: 'title_vip', kind: 'title', value: 'VIP-клиент', price: 4000, group: 'Титулы',
      name: 'Титул «VIP-клиент»', desc: 'Подпись у имени' },
    { id: 'title_magnat', kind: 'title', value: 'Магнат', price: 12000, group: 'Титулы',
      name: 'Титул «Магнат»', desc: 'Для очень богатых' },
    { id: 'title_legend', kind: 'title', value: 'Легенда банка', price: 25000, group: 'Титулы',
      name: 'Титул «Легенда банка»', desc: 'Самый редкий титул' },

    { id: 'case', kind: 'case', price: 1000, group: 'Ящики и удача',
      name: 'Ящик чекушек', desc: 'Открывается сразу: от пустого до крупного выигрыша и редкого оформления' },
    { id: 'avatar', kind: 'avatar', price: 700, group: 'Внешний вид',
      name: 'Цвет значка', desc: 'Свой цвет инициалов в шапке и профиле' },
    { id: 'engraving', kind: 'engraving', price: 5000, group: 'Внешний вид',
      name: 'Гравировка на карте', desc: 'Своя строка латиницей на лицевой стороне' },
    { id: 'reissue', kind: 'reissue', price: 3000, group: 'Внешний вид',
      name: 'Перевыпуск карты', desc: 'Новый номер карты и срок действия' },

    { id: 'insurance', kind: 'consumable', price: 1200, group: 'Банковские услуги',
      name: 'Страховка от просрочки', desc: 'Один раз отменяет штраф 25 процентов' },
    { id: 'holidays', kind: 'holidays', price: 2000, group: 'Банковские услуги',
      name: 'Кредитные каникулы', desc: 'Продлевают срок любого кредита на 3 дня' },
    { id: 'bonus_boost', kind: 'boost', price: 1800, group: 'Банковские услуги',
      name: 'Двойной бонус, 7 дней', desc: 'Бонус дня 100 вместо 50' },
    { id: 'limit_up', kind: 'perk', price: 15000, group: 'Банковские услуги',
      name: 'Повышенный кредитный лимит', desc: 'Кредиты до 150 000 навсегда' },
    { id: 'cashback', kind: 'cashback', price: 20000, group: 'Банковские услуги',
      name: 'Кэшбек с проигрышей', desc: 'Банк возвращает 5 процентов от проигранного в играх' },
    { id: 'autopay', kind: 'autopay', price: 8000, group: 'Банковские услуги',
      name: 'Автопогашение кредита', desc: 'В день возврата банк сам спишет долг без штрафа, если деньги на счёте' },
    { id: 'deposit_plus', kind: 'deposit_plus', price: 12000, group: 'Банковские услуги',
      name: 'Повышенная ставка по вкладам', desc: 'Плюс 3 процента к любому вкладу навсегда' }
  ];

  const SHOP_GROUPS = ['Ящики и удача', 'Оформление карты', 'Внешний вид', 'Титулы', 'Банковские услуги'];


  class RemoteApi {
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
        throw new Error(String(msg));
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

    shopBuy(token, item) { return this.rpc('cb_shop_buy', { p_token: token, p_item: item }); }
    shopEquip(token, kind, value) { return this.rpc('cb_shop_equip', { p_token: token, p_kind: kind, p_value: value }); }
    caseOpen(token) { return this.rpc('cb_case_open', { p_token: token }); }
    engrave(token, text) { return this.rpc('cb_engrave', { p_token: token, p_text: text }); }
    reissue(token) { return this.rpc('cb_reissue', { p_token: token }); }
    creditExtend(token, id) { return this.rpc('cb_credit_extend', { p_token: token, p_credit: id }); }
    depositOpen(token, amount, days) { return this.rpc('cb_deposit_open', { p_token: token, p_amount: amount, p_days: days }); }
    depositClose(token, id) { return this.rpc('cb_deposit_close', { p_token: token, p_deposit: id }); }

    adminStats(token) { return this.rpc('cb_admin_stats', { p_token: token }); }
    adminUsers(token, q) { return this.rpc('cb_admin_users', { p_token: token, p_query: q || '' }); }
    adminIssue(token, target, amount, reason) {
      return this.rpc('cb_admin_issue', { p_token: token, p_query: target, p_amount: amount, p_reason: reason || '' });
    }
    adminRole(token, target, role) { return this.rpc('cb_admin_role', { p_token: token, p_query: target, p_role: role }); }
    adminBlock(token, target, blocked, reason) {
      return this.rpc('cb_admin_block', { p_token: token, p_query: target, p_blocked: blocked, p_reason: reason || '' });
    }
    adminFeed(token) { return this.rpc('cb_admin_feed', { p_token: token }); }
  }

  const LS = 'chekunec_bank_local_v2';

  class LocalApi {
    constructor() { this.mode = 'demo'; }

    db() {
      try {
        const db = JSON.parse(localStorage.getItem(LS)) || {};
        return { users: db.users || [], tx: db.tx || [], credits: db.credits || [], deposits: db.deposits || [] };
      } catch (_) { return { users: [], tx: [], credits: [], deposits: [] }; }
    }
    save(db) { localStorage.setItem(LS, JSON.stringify(db)); }

    byToken(db, token) {
      const u = db.users.find(x => x.token === token);
      if (!u) throw new Error('Сессия истекла, войдите заново');
      if (u.blocked) throw new Error('Счёт заблокирован. ' + (u.blocked_reason || ''));
      return u;
    }

    push(db, user, amount, category, title, meta) {
      user.balance = Math.round((user.balance + amount) * 100) / 100;
      db.tx.push({
        id: uid(), user_id: user.id, ts: new Date().toISOString(), amount,
        category, title, balance_after: user.balance, meta: meta || {}
      });
    }

    pub(u) {
      const { pin_hash, token, ...rest } = u;
      return rest;
    }

    async register(f) {
      const db = this.db();
      if (db.users.some(u => u.phone === f.phone)) throw new Error('Такой телефон уже зарегистрирован');
      let card = newCardFor(f.first, f.last);
      while (db.users.some(u => u.card_number === card.card_number)) card = newCardFor(f.first, f.last);
      const owner = f.first === OWNER.first && f.last === OWNER.last && !db.users.some(u => u.role === 'admin');
      const user = {
        id: uid(), token: uid(), first_name: f.first, last_name: f.last,
        phone: f.phone, email: f.email || '', pin_hash: await hashPin(f.phone, f.pin),
        balance: 0, created_at: new Date().toISOString(), last_bonus: null,
        role: owner ? 'admin' : 'client', blocked: false, blocked_reason: '',
        inventory: { skins: ['base'], titles: [], insurance: 0, bonus_boost_until: null, limit_up: false,
                     avatar: false, engraving: false, cases: 0, holidays: 0, cashback: false,
                     autopay: false, deposit_plus: false },
        equipped: { skin: 'base', title: '', avatar: '' },
        engraving: '',
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
      if (u.blocked) throw new Error('Счёт заблокирован. ' + (u.blocked_reason || ''));
      u.token = uid(); this.save(db);
      return { token: u.token, user: this.pub(u) };
    }

    processOverdue(db, user) {
      const now = Date.now();
      let hit = 0;
      db.credits.filter(c => c.user_id === user.id && c.status === 'active').forEach(c => {
        if (new Date(c.due_at).getTime() > now) return;
        const rest = Math.round((c.total - c.paid) * 100) / 100;
        const autopaid = user.inventory.autopay && user.balance >= rest;
        const insured = !autopaid && (user.inventory.insurance || 0) > 0;
        const penalty = (autopaid || insured) ? 0 : Math.round(rest * PENALTY_RATE) / 100;
        if (insured) user.inventory.insurance--;
        c.status = 'overdue'; c.paid = c.total; c.closed_at = new Date().toISOString(); c.penalty = penalty;
        this.push(db, user, -rest, 'credit', 'Принудительное списание по кредиту', { credit: c.id });
        if (penalty) this.push(db, user, -penalty, 'penalty', 'Штраф за просрочку (' + PENALTY_RATE + '%)', { credit: c.id });
        else this.push(db, user, 0, 'shop', autopaid ? 'Автопогашение: без штрафа' : 'Страховка отменила штраф', { credit: c.id });
        hit++;
      });
      return hit;
    }

    processDeposits(db, user) {
      const now = Date.now();
      let n = 0;
      db.deposits.filter(d => d.user_id === user.id && d.status === 'active').forEach(d => {
        if (new Date(d.due_at).getTime() > now) return;
        d.status = 'closed';
        d.closed_at = new Date().toISOString();
        this.push(db, user, d.total, 'deposit', 'Вклад закрыт с доходом ' + Math.round((d.total - d.amount) * 100) / 100,
          { deposit: d.id });
        n++;
      });
      return n;
    }

    async state(token) {
      const db = this.db();
      const u = this.byToken(db, token);
      const overdue = this.processOverdue(db, u);
      const matured = this.processDeposits(db, u);
      this.save(db);
      return {
        user: this.pub(u),
        transactions: db.tx.filter(t => t.user_id === u.id).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200),
        credits: db.credits.filter(c => c.user_id === u.id).sort((a, b) => b.taken_at.localeCompare(a.taken_at)),
        deposits: db.deposits.filter(d => d.user_id === u.id).sort((a, b) => b.opened_at.localeCompare(a.opened_at)),
        overdue_applied: overdue,
        deposits_matured: matured,
        clients: db.users.length
      };
    }

    lookup(db, q) {
      const digits = String(q || '').replace(/\D/g, '');
      const phone = normalizePhone(q);
      const text = String(q || '').trim().toLowerCase();
      return db.users.find(u => (phone && u.phone === phone) ||
        (digits.length === 16 && u.card_number === digits) ||
        (digits.length === 20 && u.account_number === digits) ||
        (text.length > 2 && (u.first_name + ' ' + u.last_name).toLowerCase() === text));
    }

    async find(token, q) {
      const db = this.db(); const me = this.byToken(db, token);
      const t = this.lookup(db, q);
      if (!t) throw new Error('Клиент Чекунец Банка не найден');
      if (t.id === me.id) throw new Error('Это ваш собственный счёт');
      return { name: t.first_name + ' ' + t.last_name[0] + '.', phone: maskPhone(t.phone) };
    }

    async transfer(token, q, amount, note) {
      const db = this.db(); const me = this.byToken(db, token);
      this.processOverdue(db, me);
      amount = Math.round(Number(amount) * 100) / 100;
      if (!(amount > 0)) throw new Error('Некорректная сумма');
      const to = this.lookup(db, q);
      if (!to) throw new Error('Клиент Чекунец Банка не найден');
      if (to.id === me.id) throw new Error('Нельзя перевести самому себе');
      if (to.blocked) throw new Error('Счёт получателя заблокирован');
      if (me.balance < amount) throw new Error('Недостаточно чекурублей на счёте');
      this.push(db, me, -amount, 'transfer_out', 'Перевод — ' + to.first_name + ' ' + to.last_name,
        { to: maskPhone(to.phone), note: note || '' });
      this.push(db, to, amount, 'transfer_in', 'Перевод от ' + me.first_name + ' ' + me.last_name,
        { from: maskPhone(me.phone), note: note || '' });
      this.save(db);
      return { ok: true, balance: me.balance, to: to.first_name + ' ' + to.last_name };
    }

    async game(token, g) {
      const db = this.db(); const u = this.byToken(db, token);
      const stake = Math.max(0, Math.round(Number(g.stake) * 100) / 100);
      const payout = Math.max(0, Math.round(Number(g.payout) * 100) / 100);
      if (stake > 0 && u.balance < stake) throw new Error('Недостаточно чекурублей для ставки');
      const delta = Math.round((payout - stake) * 100) / 100;
      this.push(db, u, delta, stake > 0 ? 'game_bet' : 'game_win', g.title, { game: g.game, stake, payout });
      let cashback = 0;
      if (u.inventory.cashback && delta < 0) {
        cashback = Math.round(-delta * 5) / 100;
        this.push(db, u, cashback, 'cashback', 'Кэшбек с проигрыша', { game: g.game });
      }
      this.save(db);
      return { balance: u.balance, delta, cashback };
    }

    async creditTake(token, amount, days) {
      const db = this.db(); const u = this.byToken(db, token);
      this.processOverdue(db, u);
      const plan = CREDIT_PLANS.find(p => p.days === days);
      if (!plan) throw new Error('Неизвестная программа кредитования');
      const limit = u.inventory.limit_up ? CREDIT_LIMIT_VIP : CREDIT_LIMIT;
      amount = Math.round(Number(amount) * 100) / 100;
      if (!(amount >= 100 && amount <= limit)) throw new Error('Сумма кредита: от 100 до ' + limit + ' чекурублей');
      const active = db.credits.filter(c => c.user_id === u.id && c.status === 'active');
      if (active.length >= 3) throw new Error('Нельзя иметь больше трёх активных кредитов');
      const total = Math.round(amount * (1 + plan.rate / 100) * 100) / 100;
      const c = {
        id: uid(), user_id: u.id, amount, rate: plan.rate, days: plan.days, total, paid: 0, penalty: 0,
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
      const boosted = u.inventory.bonus_boost_until && new Date(u.inventory.bonus_boost_until) > new Date();
      const sum = boosted ? 100 : 50;
      this.push(db, u, sum, 'bonus', boosted ? 'Ежедневный бонус ×2' : 'Ежедневный бонус клиента');
      this.save(db);
      return { amount: sum, balance: u.balance };
    }

    async updateProfile(token, patch) {
      const db = this.db(); const u = this.byToken(db, token);
      if (patch.email !== undefined) u.email = patch.email;
      if (patch.phone) {
        if (db.users.some(x => x.phone === patch.phone && x.id !== u.id)) throw new Error('Этот телефон уже занят');
        u.phone = patch.phone;
      }
      if (patch.settings) u.settings = { ...u.settings, ...patch.settings };
      this.save(db);
      return { user: this.pub(u) };
    }

    async changePin(token, oldPin, newPin) {
      const db = this.db(); const u = this.byToken(db, token);
      if (u.pin_hash !== await hashPin(u.phone, oldPin)) throw new Error('Текущий PIN неверен');
      u.pin_hash = await hashPin(u.phone, newPin);
      this.save(db);
      return { ok: true };
    }

    async top(token) {
      const db = this.db(); this.byToken(db, token);
      return db.users.filter(u => !u.blocked && (!u.settings || u.settings.public !== false))
        .sort((a, b) => b.balance - a.balance).slice(0, 10)
        .map(u => ({ name: u.first_name + ' ' + u.last_name[0] + '.', balance: u.balance, title: u.equipped.title || '', role: u.role }));
    }

    async shopBuy(token, itemId) {
      const db = this.db(); const u = this.byToken(db, token);
      const item = SHOP.find(i => i.id === itemId);
      if (!item) throw new Error('Товар не найден');
      const inv = u.inventory;
      if (item.kind === 'skin' && inv.skins.includes(item.value)) throw new Error('Скин уже куплен');
      if (item.kind === 'title' && inv.titles.includes(item.value)) throw new Error('Титул уже куплен');
      if (item.kind === 'perk' && inv.limit_up) throw new Error('Лимит уже повышен');
      if (item.kind === 'cashback' && inv.cashback) throw new Error('Кэшбек уже подключён');
      if (item.kind === 'autopay' && inv.autopay) throw new Error('Автопогашение уже подключено');
      if (item.kind === 'deposit_plus' && inv.deposit_plus) throw new Error('Повышенная ставка уже подключена');
      if (item.kind === 'engraving' && inv.engraving) throw new Error('Гравировка уже куплена');
      if (item.kind === 'avatar' && inv.avatar) throw new Error('Уже куплено');
      if (u.balance < item.price) throw new Error('Недостаточно чекурублей');
      if (item.kind === 'skin') inv.skins.push(item.value);
      if (item.kind === 'title') inv.titles.push(item.value);
      if (item.kind === 'perk') inv.limit_up = true;
      if (item.kind === 'cashback') inv.cashback = true;
      if (item.kind === 'autopay') inv.autopay = true;
      if (item.kind === 'deposit_plus') inv.deposit_plus = true;
      if (item.kind === 'engraving') inv.engraving = true;
      if (item.kind === 'consumable') inv.insurance = (inv.insurance || 0) + 1;
      if (item.kind === 'holidays') inv.holidays = (inv.holidays || 0) + 1;
      if (item.kind === 'case') inv.cases = (inv.cases || 0) + 1;
      if (item.kind === 'reissue') {
        let card = newCardFor(u.first_name, u.last_name);
        while (db.users.some(x => x.card_number === card.card_number)) card = newCardFor(u.first_name, u.last_name);
        u.card_number = card.card_number; u.card_exp = card.card_exp; u.card_cvv = card.card_cvv;
      }
      if (item.kind === 'boost') {
        const base = inv.bonus_boost_until && new Date(inv.bonus_boost_until) > new Date()
          ? new Date(inv.bonus_boost_until).getTime() : Date.now();
        inv.bonus_boost_until = new Date(base + 7 * 864e5).toISOString();
      }
      this.push(db, u, -item.price, 'shop', 'Покупка: ' + item.name, { item: item.id });
      this.save(db);
      return { balance: u.balance, user: this.pub(u) };
    }

    async caseOpen(token) {
      const db = this.db(); const u = this.byToken(db, token);
      if (!(u.inventory.cases > 0)) throw new Error('Ящиков нет — купите в магазине');
      u.inventory.cases--;
      const roll = Math.random() * 100;
      let prize;
      if (roll < 1 && !u.inventory.skins.includes('goldbank')) prize = { skin: 'goldbank', amount: 0 };
      else if (roll < 21) prize = { amount: 0 };
      else if (roll < 46) prize = { amount: 200 };
      else if (roll < 66) prize = { amount: 500 };
      else if (roll < 81) prize = { amount: 1000 };
      else if (roll < 91) prize = { amount: 2500 };
      else if (roll < 98) prize = { amount: 5000 };
      else prize = { amount: 10000 };
      if (prize.skin) u.inventory.skins.push(prize.skin);
      const title = prize.skin ? 'Ящик чекушек: оформление «Золото банка»'
        : prize.amount ? 'Ящик чекушек: выигрыш' : 'Ящик чекушек: пусто';
      this.push(db, u, prize.amount || 0, 'case', title, {});
      this.save(db);
      return { prize, balance: u.balance, user: this.pub(u) };
    }

    async engrave(token, text) {
      const db = this.db(); const u = this.byToken(db, token);
      if (!u.inventory.engraving) throw new Error('Гравировка не куплена');
      const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9 .\-]/g, '').slice(0, 16).trim();
      u.engraving = clean;
      this.save(db);
      return { user: this.pub(u) };
    }

    async reissue(token) {
      const db = this.db(); const u = this.byToken(db, token);
      let card = newCardFor(u.first_name, u.last_name);
      while (db.users.some(x => x.card_number === card.card_number)) card = newCardFor(u.first_name, u.last_name);
      u.card_number = card.card_number; u.card_exp = card.card_exp; u.card_cvv = card.card_cvv;
      this.save(db);
      return { user: this.pub(u) };
    }

    async depositOpen(token, amount, days) {
      const db = this.db(); const u = this.byToken(db, token);
      const plan = DEPOSIT_PLANS.find(p => p.days === days);
      if (!plan) throw new Error('Неизвестная программа вклада');
      amount = Math.round(Number(amount) * 100) / 100;
      if (!(amount >= DEPOSIT_MIN)) throw new Error('Минимальный вклад: ' + DEPOSIT_MIN + ' чекурублей');
      if (u.balance < amount) throw new Error('Недостаточно чекурублей');
      if (db.deposits.filter(d => d.user_id === u.id && d.status === 'active').length >= 5) {
        throw new Error('Больше пяти вкладов сразу открыть нельзя');
      }
      const rate = plan.rate + (u.inventory.deposit_plus ? 3 : 0);
      const d = {
        id: uid(), user_id: u.id, amount, rate, days: plan.days,
        total: Math.round(amount * (1 + rate / 100) * 100) / 100,
        opened_at: new Date().toISOString(),
        due_at: new Date(Date.now() + plan.days * 864e5).toISOString(),
        status: 'active'
      };
      db.deposits.push(d);
      this.push(db, u, -amount, 'deposit', 'Открыт вклад на ' + plan.label, { deposit: d.id });
      this.save(db);
      return { deposit: d, balance: u.balance };
    }

    async depositClose(token, id) {
      const db = this.db(); const u = this.byToken(db, token);
      const d = db.deposits.find(x => x.id === id && x.user_id === u.id);
      if (!d || d.status !== 'active') throw new Error('Вклад не найден или уже закрыт');
      const matured = new Date(d.due_at).getTime() <= Date.now();
      const back = matured ? d.total : d.amount;
      d.status = matured ? 'closed' : 'early';
      d.closed_at = new Date().toISOString();
      this.push(db, u, back, 'deposit', matured ? 'Вклад закрыт с доходом' : 'Вклад закрыт досрочно, без процентов',
        { deposit: d.id });
      this.save(db);
      return { deposit: d, balance: u.balance, early: !matured };
    }

    async creditExtend(token, id) {
      const db = this.db(); const u = this.byToken(db, token);
      if (!(u.inventory.holidays > 0)) throw new Error('Кредитных каникул нет — купите в магазине');
      const c = db.credits.find(x => x.id === id && x.user_id === u.id);
      if (!c || c.status !== 'active') throw new Error('Кредит не найден или уже закрыт');
      u.inventory.holidays--;
      c.due_at = new Date(new Date(c.due_at).getTime() + 3 * 864e5).toISOString();
      c.days += 3;
      this.push(db, u, 0, 'credit', 'Кредитные каникулы: срок продлён на 3 дня', { credit: c.id });
      this.save(db);
      return { credit: c };
    }

    async shopEquip(token, kind, value) {
      const db = this.db(); const u = this.byToken(db, token);
      const inv = u.inventory;
      if (kind === 'skin' && value !== 'base' && !inv.skins.includes(value)) throw new Error('Скин не куплен');
      if (kind === 'title' && value && !inv.titles.includes(value)) throw new Error('Титул не куплен');
      if (kind === 'avatar' && value && !inv.avatar) throw new Error('Цвет значка не куплен');
      u.equipped[kind] = value;
      this.save(db);
      return { user: this.pub(u) };
    }

    admin(db, token, allowDev) {
      const u = this.byToken(db, token);
      if (u.role !== 'admin' && !(allowDev && u.role === 'developer')) throw new Error('Недостаточно прав');
      return u;
    }

    async adminStats(token) {
      const db = this.db(); this.admin(db, token, true);
      const sum = arr => Math.round(arr.reduce((s, x) => s + x, 0) * 100) / 100;
      const day = 864e5, now = Date.now();
      const games = db.tx.filter(t => t.category.startsWith('game'));
      const regs = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now - i * day).toISOString().slice(0, 10);
        regs.push({ day: d, count: db.users.filter(u => u.created_at.slice(0, 10) === d).length });
      }
      return {
        clients: db.users.length,
        blocked: db.users.filter(u => u.blocked).length,
        admins: db.users.filter(u => u.role === 'admin').length,
        developers: db.users.filter(u => u.role === 'developer').length,
        money: sum(db.users.map(u => u.balance)),
        debtors: db.users.filter(u => u.balance < 0).length,
        tx_count: db.tx.length,
        turnover_24h: sum(db.tx.filter(t => now - new Date(t.ts) < day).map(t => Math.abs(t.amount))),
        transfers: db.tx.filter(t => t.category === 'transfer_out').length,
        transfers_sum: sum(db.tx.filter(t => t.category === 'transfer_out').map(t => -t.amount)),
        credits_active: db.credits.filter(c => c.status === 'active').length,
        credits_overdue: db.credits.filter(c => c.status === 'overdue').length,
        credits_sum: sum(db.credits.map(c => c.amount)),
        games_count: games.length,
        games_profit: -sum(games.map(t => t.amount)),
        shop_sum: sum(db.tx.filter(t => t.category === 'shop').map(t => -t.amount)),
        issued: sum(db.tx.filter(t => t.category === 'emission').map(t => t.amount)),
        registrations: regs,
        top: db.users.slice().sort((a, b) => b.balance - a.balance).slice(0, 5)
          .map(u => ({ name: u.first_name + ' ' + u.last_name, balance: u.balance }))
      };
    }

    async adminUsers(token, q) {
      const db = this.db(); this.admin(db, token, true);
      const s = String(q || '').trim().toLowerCase();
      return db.users
        .filter(u => !s || (u.first_name + ' ' + u.last_name).toLowerCase().includes(s) ||
          u.phone.includes(s.replace(/\D/g, '')) || u.card_number.includes(s.replace(/\D/g, '')) ||
          u.email.toLowerCase().includes(s))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 100)
        .map(u => ({
          id: u.id, first_name: u.first_name, last_name: u.last_name, phone: u.phone, email: u.email,
          card_number: u.card_number, balance: u.balance, role: u.role, blocked: u.blocked,
          blocked_reason: u.blocked_reason, created_at: u.created_at,
          tx_count: db.tx.filter(t => t.user_id === u.id).length,
          credits: db.credits.filter(c => c.user_id === u.id && c.status === 'active').length,
          title: u.equipped.title || ''
        }));
    }

    async adminIssue(token, target, amount, reason) {
      const db = this.db(); const me = this.admin(db, token);
      const t = this.lookup(db, target);
      if (!t) throw new Error('Клиент не найден');
      amount = Math.round(Number(amount) * 100) / 100;
      if (!amount) throw new Error('Некорректная сумма');
      this.push(db, t, amount, 'emission',
        (amount > 0 ? 'Начисление от банка' : 'Списание банком') + (reason ? ': ' + reason : ''),
        { by: me.phone });
      this.save(db);
      return { balance: t.balance, name: t.first_name + ' ' + t.last_name };
    }

    async adminRole(token, target, role) {
      const db = this.db(); const me = this.admin(db, token);
      if (!ROLES[role]) throw new Error('Неизвестная роль');
      const t = this.lookup(db, target);
      if (!t) throw new Error('Клиент не найден');
      if (t.id === me.id) throw new Error('Нельзя изменить собственную роль');
      t.role = role;
      this.save(db);
      return { name: t.first_name + ' ' + t.last_name, role };
    }

    async adminBlock(token, target, blocked, reason) {
      const db = this.db(); const me = this.admin(db, token);
      const t = this.lookup(db, target);
      if (!t) throw new Error('Клиент не найден');
      if (t.id === me.id) throw new Error('Нельзя заблокировать самого себя');
      if (t.role === 'admin') throw new Error('Нельзя заблокировать администратора');
      t.blocked = !!blocked;
      t.blocked_reason = blocked ? (reason || 'Нарушение правил банка') : '';
      if (blocked) t.token = null;
      this.save(db);
      return { name: t.first_name + ' ' + t.last_name, blocked: t.blocked };
    }

    async adminFeed(token) {
      const db = this.db(); this.admin(db, token, true);
      const names = {};
      db.users.forEach(u => names[u.id] = u.first_name + ' ' + u.last_name);
      return db.tx.slice().sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 40)
        .map(t => ({ ts: t.ts, who: names[t.user_id] || '—', title: t.title, amount: t.amount, category: t.category }));
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
      db.deposits = db.deposits.filter(d => d.user_id !== u.id);
      this.save(db);
      return { ok: true };
    }
  }

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
    if (cfg.url && cfg.anonKey) return new RemoteApi(cfg.url, cfg.anonKey);
    return new LocalApi();
  }

  global.CB = {
    createApi, readOverride, writeOverride, RemoteApi, LocalApi,
    utils: { translit, normalizePhone, prettyPhone, maskPhone, isEmail, luhnCheckDigit, uid },
    consts: { WELCOME_BONUS, CREDIT_PLANS, PENALTY_RATE, CREDIT_LIMIT, CREDIT_LIMIT_VIP,
              SHOP, SHOP_GROUPS, SKINS, AVATAR_COLORS, ROLES, OWNER, DEPOSIT_PLANS, DEPOSIT_MIN }
  };
})(window);
