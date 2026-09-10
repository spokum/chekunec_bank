(function () {
  'use strict';

  const U = CB.utils, C = CB.consts;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  const S = { api: null, token: null, user: null, tx: [], credits: [], tab: 'home', clients: 0, busy: false };

  const money = v => {
    const n = Math.round(v * 100) / 100;
    return Number.isInteger(n)
      ? n.toLocaleString('ru-RU')
      : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const unit = v => {
    const n = Math.abs(Math.round(v * 100) / 100);
    if (!Number.isInteger(n)) return 'чекурубля';
    const t = n % 100, o = n % 10;
    if (t > 10 && t < 20) return 'чекурублей';
    if (o === 1) return 'чекурубль';
    if (o >= 2 && o <= 4) return 'чекурубля';
    return 'чекурублей';
  };
  const cur = v => money(v) + ' ' + unit(v);
  const num = v => (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v));
  const signed = v => (v > 0 ? '+' : '−') + cur(Math.abs(v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cardMask = n => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 ');
  const cardShort = n => '•••• ' + String(n || '').slice(-4);

  function when(iso) {
    const d = new Date(iso), now = new Date();
    const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Сегодня, ' + t;
    const y = new Date(now.getTime() - 864e5);
    if (d.toDateString() === y.toDateString()) return 'Вчера, ' + t;
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) + ', ' + t;
  }

  function left(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'просрочен';
    const h = Math.floor(ms / 36e5), d = Math.floor(h / 24);
    if (d >= 1) return d + ' дн. ' + (h % 24) + ' ч.';
    if (h >= 1) return h + ' ч. ' + Math.floor((ms % 36e5) / 6e4) + ' мин.';
    return Math.max(1, Math.floor(ms / 6e4)) + ' мин.';
  }

  function toast(text, kind) {
    const t = el('div', 'toast ' + (kind || ''), esc(text));
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => t.remove(), 3000);
  }
  const ok = m => toast(m, 'ok');
  const bad = m => toast(m, 'err');

  function modal(title, build, opts) {
    const root = $('#modal-root');
    const wrap = el('div', 'modal');
    const box = el('div', 'modal-box');
    const head = el('div', 'modal-head', `<h3>${esc(title)}</h3>`);
    const close = el('button', 'icon-btn', 'Закрыть');
    head.appendChild(close);
    box.appendChild(head);
    const body = el('div', '', '');
    body.style.display = 'grid'; body.style.gap = '13px';
    box.appendChild(body);
    wrap.appendChild(box);
    root.appendChild(wrap);
    const api = { close: () => wrap.remove(), body, box };
    close.onclick = api.close;
    wrap.onclick = e => { if (e.target === wrap && !(opts && opts.sticky)) api.close(); };
    build(body, api);
    return api;
  }

  function confirmBox(title, text, onYes, danger) {
    modal(title, (b, m) => {
      b.appendChild(el('p', 'muted', esc(text)));
      const btn = el('button', 'btn full ' + (danger ? 'danger' : 'primary'), 'Подтвердить');
      btn.onclick = () => { m.close(); onYes(); };
      const no = el('button', 'btn full ghost', 'Отмена');
      no.onclick = m.close;
      b.append(btn, no);
    });
  }

  async function run(fn) {
    try { return await fn(); }
    catch (e) {
      const msg = e.message || String(e);
      bad(msg);
      if (S.token && (/заблокирован/i.test(msg) || /Сессия истекла/i.test(msg))) logout();
    }
  }

  async function guard(fn) {
    if (S.busy) return run(fn);
    S.busy = true;
    try { return await run(fn); }
    finally { S.busy = false; }
  }

  function skinCss(u) {
    const id = (u.equipped && u.equipped.skin) || 'base';
    return (C.SKINS[id] || C.SKINS.base).css;
  }

  function cardHtml(u, opts) {
    const showCvv = opts && opts.cvv;
    return `
      <div class="bc-top">
        <div class="bc-brand">ЧЕКУНЕЦ<small>BANK · CHEKUNEC</small></div>
        <div class="bc-chip"></div>
      </div>
      <div class="bc-num">${cardMask(u.card_number)}</div>
      ${u.engraving ? `<div class="bc-engrave">${esc(u.engraving)}</div>` : ''}
      <div class="bc-bot">
        <div>
          <div class="bc-lbl">CARDHOLDER</div>
          <div class="bc-holder">${esc(u.card_holder)}</div>
        </div>
        <div style="text-align:center">
          <div class="bc-lbl">VALID THRU</div>
          <div class="bc-holder">${esc(u.card_exp)}</div>
        </div>
        ${showCvv ? `<div style="text-align:center"><div class="bc-lbl">CVV</div><div class="bc-holder">${esc(u.card_cvv)}</div></div>` : ''}
        <div class="bc-sys">Чк</div>
      </div>`;
  }

  function show(id) {
    $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
    window.scrollTo(0, 0);
  }

  function setErr(input, msg) {
    const field = input.closest('.field');
    const e = field && field.querySelector('.err');
    if (e) e.textContent = msg || '';
    input.classList.toggle('bad', !!msg);
    return !msg;
  }

  function bindPhoneMask(input) {
    input.addEventListener('input', () => {
      let d = input.value.replace(/\D/g, '');
      if (d.startsWith('8')) d = '7' + d.slice(1);
      if (!d.startsWith('7')) d = '7' + d;
      d = d.slice(0, 11);
      let out = '+7';
      if (d.length > 1) out += ' (' + d.slice(1, 4);
      if (d.length >= 5) out += ') ' + d.slice(4, 7);
      if (d.length >= 8) out += '-' + d.slice(7, 9);
      if (d.length >= 10) out += '-' + d.slice(9, 11);
      input.value = out;
    });
    input.addEventListener('focus', () => { if (!input.value) input.value = '+7 ('; });
  }

  function bindDigits(input, n) {
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, n); });
  }

  async function boot() {
    S.api = CB.createApi();
    const badge = $('#backend-badge');
    if (S.api.mode === 'online') {
      badge.textContent = 'Онлайн-режим: счета общие для всех';
      badge.classList.add('live');
    } else {
      badge.textContent = 'Автономный режим: счёт хранится в этом браузере';
    }

    bindPhoneMask($('#rg-phone')); bindPhoneMask($('#li-phone'));
    ['#rg-pin', '#rg-pin2', '#li-pin'].forEach(s => bindDigits($(s), 4));

    $$('[data-auth]').forEach(b => b.onclick = () => {
      $$('[data-auth]').forEach(x => x.classList.toggle('active', x === b));
      $('#form-login').classList.toggle('hidden', b.dataset.auth !== 'login');
      $('#form-register').classList.toggle('hidden', b.dataset.auth !== 'register');
    });

    $('#form-register').onsubmit = e => { e.preventDefault(); doRegister(); };
    $('#form-login').onsubmit = e => { e.preventDefault(); doLogin(); };
    $('#btn-server').onclick = serverModal;
    $('#btn-issued-go').onclick = () => enterApp();
    $('#btn-refresh').onclick = () => guard(async () => { await refresh(); render(); ok('Данные обновлены'); });
    $$('.tab').forEach(t => t.onclick = () => {
      S.tab = t.dataset.tab;
      $$('.tab').forEach(x => x.classList.toggle('active', x === t));
      render();
    });

    applyTheme(localStorage.getItem('cb_theme') || 'dark');

    const token = localStorage.getItem('cb_token');
    if (token) {
      S.token = token;
      try {
        await refresh();
        enterApp();
      } catch (e) {
        localStorage.removeItem('cb_token'); S.token = null;
        resetAuth();
      }
    } else {
      show('screen-auth');
    }
    setTimeout(() => $('#boot').classList.add('off'), 200);
  }

  async function refresh() {
    const st = await S.api.state(S.token);
    S.user = st.user;
    S.tx = st.transactions || [];
    S.credits = st.credits || [];
    S.clients = st.clients || 0;
    if (st.overdue_applied) bad('Кредит просрочен: долг и штраф списаны со счёта');
    if (S.user.settings && S.user.settings.theme) applyTheme(S.user.settings.theme);
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
    localStorage.setItem('cb_theme', t);
  }

  function doRegister() {
    guard(async () => {
      const first = $('#rg-first').value.trim(), last = $('#rg-last').value.trim();
      const phoneRaw = $('#rg-phone').value, email = $('#rg-email').value.trim();
      const pin = $('#rg-pin').value, pin2 = $('#rg-pin2').value;
      const phone = U.normalizePhone(phoneRaw);
      const nameRe = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\- ]{1,24}$/;

      let good = true;
      good = setErr($('#rg-first'), nameRe.test(first) ? '' : 'Введите имя (от 2 букв)') && good;
      good = setErr($('#rg-last'), nameRe.test(last) ? '' : 'Введите фамилию (от 2 букв)') && good;
      good = setErr($('#rg-phone'), phone ? '' : 'Номер должен быть российским: +7 и 10 цифр') && good;
      good = setErr($('#rg-email'), U.isEmail(email) ? '' : 'Проверьте адрес почты') && good;
      good = setErr($('#rg-pin'), /^\d{4}$/.test(pin) ? '' : 'PIN — ровно 4 цифры') && good;
      good = setErr($('#rg-pin2'), pin2 === pin && pin ? '' : 'PIN-коды не совпадают') && good;
      if (!$('#rg-agree').checked) { bad('Нужно согласиться с условиями'); good = false; }
      if (!good) return;

      const cap = s => s[0].toUpperCase() + s.slice(1).toLowerCase();
      const res = await S.api.register({ first: cap(first), last: cap(last), phone, email, pin });
      S.token = res.token;
      localStorage.setItem('cb_token', res.token);
      await refresh();
      showIssued();
    });
  }

  function doLogin() {
    guard(async () => {
      const phone = U.normalizePhone($('#li-phone').value), pin = $('#li-pin').value;
      let good = setErr($('#li-phone'), phone ? '' : 'Введите номер в формате +7…');
      good = setErr($('#li-pin'), /^\d{4}$/.test(pin) ? '' : 'PIN — 4 цифры') && good;
      if (!good) return;
      const res = await S.api.login(phone, pin);
      S.token = res.token;
      localStorage.setItem('cb_token', res.token);
      await refresh();
      $('#li-pin').value = '';
      enterApp();
      ok('Здравствуйте, ' + S.user.first_name + '!');
    });
  }

  function showIssued() {
    const u = S.user;
    $('#is-name').textContent = u.first_name + ' ' + u.last_name;
    $('#is-card').innerHTML = cardHtml(u, { cvv: true });
    $('#is-acc').textContent = u.account_number;
    $('#is-holder').textContent = u.card_holder;
    $('#is-exp').textContent = u.card_exp + ' · CVV ' + u.card_cvv;
    $('#is-bonus').textContent = cur(C.WELCOME_BONUS);
    show('screen-issued');
  }

  function serverModal() {
    modal('Сервер банка', (b, m) => {
      const ov = CB.readOverride() || {};
      b.appendChild(el('p', 'muted',
        'Адрес и ключ доступа к серверу Чекунец Банка. Пока они не заданы, банк работает автономно: ' +
        'счета хранятся только в этом браузере и переводы другим людям недоступны.'));
      const f1 = el('label', 'field', '<span>Адрес сервера</span><input id="sv-url" placeholder="https://..."><em class="err"></em>');
      const f2 = el('label', 'field', '<span>Ключ доступа</span><input id="sv-key" placeholder="ключ"><em class="err"></em>');
      b.append(f1, f2);
      f1.querySelector('input').value = (ov.url || window.CB_CONFIG.url || '');
      f2.querySelector('input').value = (ov.anonKey || '');
      const save = el('button', 'btn primary full', 'Проверить и подключить');
      save.onclick = async () => {
        const url = $('#sv-url').value.trim(), key = $('#sv-key').value.trim();
        if (!url || !key) return bad('Заполните оба поля');
        save.disabled = true; save.textContent = 'Проверяем…';
        try {
          await new CB.RemoteApi(url, key).ping();
          CB.writeOverride({ url, anonKey: key });
          ok('Сервер подключён, перезагружаем…');
          setTimeout(() => location.reload(), 700);
        } catch (e) {
          bad('Не вышло: ' + e.message);
          save.disabled = false; save.textContent = 'Проверить и подключить';
        }
      };
      const off = el('button', 'btn full ghost', 'Работать автономно');
      off.onclick = () => { CB.writeOverride(null); location.reload(); };
      b.append(save, off);
    });
  }

  function render() {
    const u = S.user;
    if (!u) return;
    $('#tb-avatar').textContent = avatarOf(u);
    $('#tb-avatar').style.setProperty('--av', avatarColor(u));
    $('#tb-name').innerHTML = '<span>' + esc(u.first_name + ' ' + u.last_name) + '</span>' + roleMark(u);
    $('#tb-sub').textContent = (u.equipped && u.equipped.title) ? u.equipped.title : U.prettyPhone(u.phone);
    $('.tab[data-tab="admin"]').classList.toggle('hidden', !isStaff(u));
    const mode = $('#tb-mode');
    mode.textContent = S.api.mode === 'online' ? 'online' : 'офлайн';
    mode.classList.toggle('live', S.api.mode === 'online');

    const v = $('#view');
    v.innerHTML = '';
    const views = { home: viewHome, history: viewHistory, games: viewGames, shop: viewShop,
                    credits: viewCredits, settings: viewSettings, profile: viewProfile, admin: viewAdmin };
    (views[S.tab] || viewHome)(v);
  }

  const hidden = () => !!(S.user.settings && S.user.settings.hide_balance);
  const isAdmin = u => u && u.role === 'admin';
  const isStaff = u => u && (u.role === 'admin' || u.role === 'developer');
  const avatarOf = u => (u.first_name[0] + u.last_name[0]).toUpperCase();
  const avatarColor = u => {
    const id = u && u.equipped && u.equipped.avatar;
    return (id && C.AVATAR_COLORS[id]) ? C.AVATAR_COLORS[id].css : '';
  };
  const roleMark = u => u && C.ROLES[u.role] && C.ROLES[u.role].mark
    ? ' <span class="tag">' + C.ROLES[u.role].mark + '</span>' : '';
  const inv = () => (S.user && S.user.inventory) || { skins: ['base'], titles: [], insurance: 0 };

  function viewHome(v) {
    const u = S.user;

    const card = el('div', 'bankcard', cardHtml(u));
    card.style.maxWidth = '100%';
    card.style.background = skinCss(u);
    card.onclick = () => cardModal();
    v.appendChild(card);

    const bal = el('div', 'card');
    const amount = hidden() ? '••••••' : money(u.balance) + ' <small>' + unit(u.balance) + '</small>';
    bal.innerHTML = `
      <div class="balance">
        <div class="sub">Баланс счёта · чекурубли</div>
        <div class="amount ${u.balance < 0 ? 'neg' : ''}">${amount}</div>
        <div class="sub mono">Счёт ${esc(u.account_number)}</div>
      </div>`;
    bal.querySelector('.amount').onclick = () => guard(async () => {
      await S.api.updateProfile(S.token, { settings: { hide_balance: !hidden() } });
      await refresh(); render();
    });
    v.appendChild(bal);

    const debt = S.credits.filter(c => c.status === 'active').reduce((s, c) => s + (c.total - c.paid), 0);
    if (debt > 0 || u.balance < 0) {
      const warn = el('div', 'card');
      warn.innerHTML = `<div class="kv"><span>${debt > 0 ? 'Задолженность по кредитам' : 'Минус на счёте'}</span>
        <b class="neg">${cur(debt > 0 ? debt : Math.abs(u.balance))}</b></div>`;
      v.appendChild(warn);
    }

    const acts = el('div', 'actions');
    [
      ['Перевести', transferModal],
      ['Бонус дня', dailyBonus],
      ['Рейтинг', topModal],
      ['История', () => goTab('history')],
      ['Заработать', () => goTab('games')],
      ['Магазин', () => goTab('shop')]
    ].forEach(([label, fn]) => {
      const b = el('button', 'act', `<span>${label}</span>`);
      b.onclick = fn;
      acts.appendChild(b);
    });
    v.appendChild(acts);

    v.appendChild(el('div', 'sec-title', 'Последние операции'));
    const list = el('div', 'card');
    const items = S.tx.slice(0, 5);
    if (!items.length) list.appendChild(el('div', 'empty', 'Операций пока нет'));
    else items.forEach(t => list.appendChild(txRow(t)));
    const more = el('button', 'btn full ghost mini', 'Вся история');
    more.style.marginTop = '10px';
    more.onclick = () => goTab('history');
    list.appendChild(more);
    v.appendChild(list);
  }

  function enterApp() {
    S.tab = 'home';
    $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'home'));
    show('screen-app');
    render();
  }

  function goTab(name) {
    S.tab = name;
    $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    render();
  }

  const TX_ICONS = {
    transfer_in: '+', transfer_out: '−', bonus: '★', game_bet: '×', game_win: '×',
    credit: 'К', credit_pay: 'П', penalty: '!', shop: 'М', emission: 'Б', case: 'Я', cashback: 'В'
  };

  function txRow(t) {
    const row = el('div', 'tx');
    row.innerHTML = `
      <div class="tx-ico">${TX_ICONS[t.category] || '•'}</div>
      <div class="tx-main">
        <div class="tx-t">${esc(t.title)}</div>
        <div class="tx-d">${when(t.ts)}${t.meta && t.meta.note ? ' · ' + esc(t.meta.note) : ''}</div>
      </div>
      <div class="tx-a ${t.amount > 0 ? 'pos' : t.amount < 0 ? 'neg' : 'muted'}">${num(t.amount) || '0'}</div>`;
    row.onclick = () => modal('Операция', b => {
      b.innerHTML = `
        <div class="kv"><span>Описание</span><b>${esc(t.title)}</b></div>
        <div class="kv"><span>Сумма</span><b class="${t.amount > 0 ? 'pos' : t.amount < 0 ? 'neg' : ''}">${t.amount ? signed(t.amount) : 'без движения по счёту'}</b></div>
        <div class="kv"><span>Дата</span><b>${new Date(t.ts).toLocaleString('ru-RU')}</b></div>
        <div class="kv"><span>Баланс после</span><b>${cur(t.balance_after)}</b></div>
        ${t.meta && t.meta.note ? `<div class="kv"><span>Сообщение</span><b>${esc(t.meta.note)}</b></div>` : ''}
        ${t.meta && t.meta.stake ? `<div class="kv"><span>Ставка</span><b>${cur(t.meta.stake)}</b></div>` : ''}
        <div class="kv"><span>Номер</span><b class="mono">${esc(String(t.id).slice(0, 8).toUpperCase())}</b></div>`;
    });
    return row;
  }

  function cardModal() {
    const u = S.user;
    modal('Карта Чекунец Банка', b => {
      const c = el('div', 'bankcard big', cardHtml(u, { cvv: true }));
      c.style.background = skinCss(u);
      b.appendChild(c);
      b.appendChild(el('div', 'card', `
        <div class="kv"><span>Номер карты</span><b class="mono">${cardMask(u.card_number)}</b></div>
        <div class="kv"><span>Держатель</span><b>${esc(u.card_holder)}</b></div>
        <div class="kv"><span>Срок действия</span><b>${esc(u.card_exp)}</b></div>
        <div class="kv"><span>CVV</span><b class="mono">${esc(u.card_cvv)}</b></div>
        <div class="kv"><span>Счёт</span><b class="mono">${esc(u.account_number)}</b></div>
        <div class="kv"><span>Платёжная система</span><b>Чекунец Pay</b></div>
        <div class="kv"><span>Валюта счёта</span><b>чекурубль</b></div>`));
      const copy = el('button', 'btn full', 'Скопировать номер карты');
      copy.onclick = () => {
        navigator.clipboard?.writeText(u.card_number).then(() => ok('Номер скопирован'), () => bad('Не удалось скопировать'));
      };
      b.appendChild(copy);
    });
  }

  function transferModal(prefill) {
    modal('Перевод клиенту банка', (b, m) => {
      b.appendChild(el('p', 'muted', 'Введите телефон получателя (+7…), либо номер его карты или счёта.'));
      const f1 = el('label', 'field', '<span>Получатель</span><input id="tr-to" placeholder="+7 (___) ___-__-__"><em class="err"></em>');
      const f2 = el('label', 'field', '<span>Сумма, чекурубли</span><input id="tr-sum" inputmode="decimal" placeholder="100"><em class="err"></em>');
      const f3 = el('label', 'field', '<span>Сообщение (необязательно)</span><input id="tr-note" maxlength="60" placeholder="за пиццу"></label>');
      b.append(f1, f2, f3);
      const found = el('div', 'muted', '');
      found.style.fontSize = '13px';
      b.appendChild(found);
      const to = f1.querySelector('input');
      if (prefill) to.value = prefill;

      let timer;
      to.addEventListener('input', () => {
        clearTimeout(timer);
        found.textContent = '';
        const q = to.value.trim();
        if (q.replace(/\D/g, '').length < 10) return;
        timer = setTimeout(async () => {
          try {
            const r = await S.api.find(S.token, q);
            found.innerHTML = 'Получатель: <b>' + esc(r.name) + '</b>';
          } catch (e) { found.textContent = e.message; }
        }, 400);
      });

      const quick = el('div', 'actions');
      [100, 500, 1000].forEach(s => {
        const q = el('button', 'act', `<span>${money(s)}</span>`);
        q.onclick = () => { f2.querySelector('input').value = s; };
        quick.appendChild(q);
      });
      b.appendChild(quick);

      const send = el('button', 'btn primary full', 'Перевести');
      send.onclick = () => guard(async () => {
        const q = to.value.trim();
        const sum = Number(String(f2.querySelector('input').value).replace(',', '.'));
        if (!q) return bad('Укажите получателя');
        if (!(sum > 0)) return bad('Некорректная сумма');
        if (sum > S.user.balance) return bad('Недостаточно чекурублей');
        send.disabled = true;
        try {
          const r = await S.api.transfer(S.token, q, sum, f3.querySelector('input').value.trim());
          m.close();
          await refresh(); render();
          ok('Переведено ' + cur(sum) + (r.to ? ' → ' + r.to : ''));
        } finally { send.disabled = false; }
      });
      b.appendChild(send);
    });
  }

  function dailyBonus() {
    guard(async () => {
      const r = await S.api.dailyBonus(S.token);
      await refresh(); render();
      ok('Бонус дня зачислен: ' + cur(r.amount));
    });
  }

  function topModal() {
    guard(async () => {
      const rows = await S.api.top(S.token);
      modal('Богатейшие клиенты', b => {
        const c = el('div', 'card');
        if (!rows.length) c.appendChild(el('div', 'empty', 'Пока пусто'));
        rows.forEach((r, i) => {
          const row = el('div', 'kv', `<span>${i + 1}. ${esc(r.name)}${r.title ? ' · ' + esc(r.title) : ''}</span><b>${cur(r.balance)}</b>`);
          c.appendChild(row);
        });
        b.appendChild(c);
      });
    });
  }

  function viewHistory(v) {
    const inSum = S.tx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const outSum = S.tx.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const stats = el('div', 'stat-row');
    stats.innerHTML = `
      <div class="stat"><b class="pos">${money(inSum)}</b><span>получено</span></div>
      <div class="stat"><b class="neg">${money(outSum)}</b><span>потрачено</span></div>
      <div class="stat"><b>${S.tx.length}</b><span>операций</span></div>`;
    v.appendChild(stats);

    const filters = [
      ['all', 'Все'], ['transfer', 'Переводы'], ['game', 'Игры'], ['credit', 'Кредиты'],
      ['shop', 'Покупки'], ['bonus', 'Бонусы']
    ];
    const seg = el('div', 'seg');
    seg.style.overflowX = 'auto';
    let active = viewHistory.filter || 'all';
    filters.forEach(([id, label]) => {
      const b = el('button', 'seg-btn' + (id === active ? ' active' : ''), label);
      b.onclick = () => { viewHistory.filter = id; render(); };
      seg.appendChild(b);
    });
    v.appendChild(seg);

    const search = el('label', 'field', '<input id="h-q" placeholder="Поиск по описанию…">');
    v.appendChild(search);

    const list = el('div', 'card');
    const draw = () => {
      list.innerHTML = '';
      const q = ($('#h-q').value || '').toLowerCase();
      const rows = S.tx.filter(t => {
        const okCat = active === 'all' ||
          (active === 'transfer' && t.category.startsWith('transfer')) ||
          (active === 'game' && t.category.startsWith('game')) ||
          (active === 'credit' && (t.category === 'credit' || t.category === 'credit_pay' || t.category === 'penalty')) ||
          (active === 'shop' && t.category === 'shop') ||
          (active === 'bonus' && (t.category === 'bonus' || t.category === 'emission'));
        return okCat && (!q || t.title.toLowerCase().includes(q));
      });
      if (!rows.length) list.appendChild(el('div', 'empty', 'Ничего не найдено'));
      else rows.forEach(t => list.appendChild(txRow(t)));
    };
    v.appendChild(list);
    search.querySelector('input').addEventListener('input', draw);
    draw();
  }

  const GAMES = [
    { id: 'clicker', name: 'Смена в банке', desc: 'Кликайте 10 секунд — получайте чекурубли. Без ставки.', risky: false, run: gameClicker },
    { id: 'quiz', name: 'Викторина', desc: '5 вопросов о деньгах. По 15 чекурублей за верный ответ.', risky: false, run: gameQuiz },
    { id: 'coin', name: 'Орёл или решка', desc: 'Ставка ×1.95 при угадывании.', risky: true, run: gameCoin },
    { id: 'dice', name: 'Кости против банка', desc: 'Ваши два кубика против банковских. Больше — ×2.', risky: true, run: gameDice },
    { id: 'wheel', name: 'Колесо фортуны', desc: 'Сектора от ×0 до ×10.', risky: true, run: gameWheel },
    { id: 'crash', name: 'Краш', desc: 'Множитель растёт — успейте забрать до обвала.', risky: true, run: gameCrash },
    { id: 'memory', name: 'Ревизия склада', desc: 'Запомните порядок ящиков и повторите. По 20 за раунд.', risky: false, run: gameMemory },
    { id: 'cups', name: 'Три стопки', desc: 'Под одной из трёх спрятана чекушка. Угадали — ×2.7.', risky: true, run: gameCups },
    { id: 'cellar', name: 'Погреб', desc: 'Открывайте полки с чекушками. Наткнулись на пустую — всё сгорает.', risky: true, run: gameCellar },
    { id: 'slots', name: 'Барабаны', desc: 'Три одинаковых знака — до ×20.', risky: true, run: gameSlots },
    { id: 'tower', name: 'Башня', desc: 'Пять этажей, на каждом одна дверь проигрышная. ×1.4 за этаж.', risky: true, run: gameTower },
    { id: 'hilo', name: 'Больше или меньше', desc: 'Угадывайте, какая карта следующая. Множитель копится.', risky: true, run: gameHiLo }
  ];

  const COOLDOWN = { clicker: 120e3, quiz: 300e3, memory: 180e3 };

  function cooldownLeft(id) {
    if (!COOLDOWN[id]) return 0;
    const last = +localStorage.getItem('cb_cd_' + id + '_' + S.user.id) || 0;
    return Math.max(0, last + COOLDOWN[id] - Date.now());
  }
  function markPlayed(id) { localStorage.setItem('cb_cd_' + id + '_' + S.user.id, Date.now()); }

  function viewGames(v) {
    const balCard = el('div', 'card');
    balCard.innerHTML = `<div class="balance"><div class="sub">Доступно для игры</div>
      <div class="amount">${hidden() ? '••••' : money(S.user.balance)} <small>${unit(S.user.balance)}</small></div></div>`;
    v.appendChild(balCard);

    const gTx = S.tx.filter(t => t.category.startsWith('game'));
    const won = gTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const lost = gTx.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const st = el('div', 'stat-row');
    st.innerHTML = `<div class="stat"><b>${gTx.length}</b><span>игр сыграно</span></div>
      <div class="stat"><b class="pos">${money(won)}</b><span>выиграно</span></div>
      <div class="stat"><b class="neg">${money(lost)}</b><span>проиграно</span></div>`;
    v.appendChild(st);

    v.appendChild(el('div', 'sec-title', 'Заработок без риска'));
    const g1 = el('div', 'grid2');
    GAMES.filter(g => !g.risky).forEach(g => g1.appendChild(gameTile(g)));
    v.appendChild(g1);

    v.appendChild(el('div', 'sec-title', 'Игры со ставкой'));
    const g2 = el('div', 'grid2');
    GAMES.filter(g => g.risky).forEach(g => g2.appendChild(gameTile(g)));
    v.appendChild(g2);

    v.appendChild(el('div', 'card', '<div class="empty">Ставка — риск: можно и приумножить, и потерять чекурубли. ' +
      'Играйте на то, что готовы потерять.</div>'));
  }

  function gameTile(g) {
    const cd = cooldownLeft(g.id);
    const t = el('button', 'game' + (g.risky ? ' risky' : ''),
      `<b>${g.name}</b><span>${esc(g.desc)}</span>` +
      (cd ? `<span class="muted">доступно через ${Math.ceil(cd / 6e4)} мин.</span>` : ''));
    t.onclick = () => {
      if (cooldownLeft(g.id)) return bad('Игра будет доступна через ' + Math.ceil(cooldownLeft(g.id) / 6e4) + ' мин.');
      g.run();
    };
    return t;
  }

  function settle(game, stake, payout, title) {
    return guard(async () => {
      await S.api.game(S.token, { game, stake, payout, title });
      await refresh();
      if (S.tab === 'games') render();
    });
  }

  function stakeField(b, max) {
    const f = el('label', 'field', '<span>Ставка, чекурубли</span><input inputmode="decimal" value="50"><em class="err"></em>');
    b.appendChild(f);
    const row = el('div', 'actions');
    [50, 100, 500].forEach(s => {
      const q = el('button', 'act', `<span>${money(s)}</span>`);
      q.onclick = () => f.querySelector('input').value = s;
      row.appendChild(q);
    });
    b.appendChild(row);
    return () => {
      const val = Number(String(f.querySelector('input').value).replace(',', '.'));
      if (!(val > 0)) throw new Error('Некорректная ставка');
      if (val > S.user.balance) throw new Error('Недостаточно чекурублей');
      if (max && val > max) throw new Error('Максимальная ставка: ' + cur(max));
      return Math.round(val * 100) / 100;
    };
  }

  function gameClicker() {
    modal('Смена в банке', (b, m) => {
      let clicks = 0, running = false, t = 10;
      const info = el('div', 'game-stage', `<div class="big-num">0</div><div class="muted">осталось 10 сек.</div>`);
      const btn = el('button', 'clicker', 'Работать');
      const start = el('button', 'btn primary full', 'Начать смену');
      b.append(info, el('div', 'game-stage'), start);
      b.querySelector('.game-stage:last-of-type').appendChild(btn);
      btn.disabled = true;
      const num = info.querySelector('.big-num'), sub = info.querySelector('.muted');

      btn.onclick = () => { if (running) { clicks++; num.textContent = clicks; } };
      start.onclick = () => {
        running = true; btn.disabled = false; start.disabled = true; start.textContent = 'Идёт смена…';
        const iv = setInterval(() => {
          t--; sub.textContent = 'осталось ' + t + ' сек.';
          if (t <= 0) {
            clearInterval(iv); running = false; btn.disabled = true;
            const earned = Math.round(Math.min(clicks, 120) * 0.6 * 100) / 100;
            markPlayed('clicker');
            settle('clicker', 0, earned, 'Смена в банке: ' + clicks + ' кликов').then(() => {
              m.close(); ok('Заработано ' + cur(earned));
            });
          }
        }, 1000);
      };
    }, { sticky: true });
  }

  const QUIZ = [
    ['Как называется валюта Чекунец Банка?', ['Чекурубль', 'Чекудоллар', 'Чекуевро'], 0],
    ['Что такое кредит?', ['Деньги в долг под процент', 'Подарок от банка', 'Налог'], 0],
    ['Сколько цифр в номере банковской карты чаще всего?', ['16', '12', '20'], 0],
    ['Что такое CVV?', ['Проверочный код карты', 'Срок действия', 'Имя владельца'], 0],
    ['Что произойдёт при просрочке кредита?', ['Долг спишут со счёта со штрафом', 'Долг простят', 'Ничего'], 0],
    ['Что такое инфляция?', ['Обесценивание денег', 'Рост зарплат', 'Вид кредита'], 0],
    ['Куда безопаснее хранить PIN-код?', ['В голове', 'На карте маркером', 'В заметке «pin»'], 0],
    ['Что такое депозит?', ['Вклад под проценты', 'Долг банку', 'Штраф'], 0]
  ];

  function gameQuiz() {
    const pack = [...QUIZ].sort(() => Math.random() - 0.5).slice(0, 5);
    let i = 0, right = 0;
    modal('Викторина', (b, m) => {
      const q = el('div', 'quiz-q', ''), opts = el('div', 'quiz-opts', ''), prog = el('div', 'muted', '');
      prog.style.textAlign = 'center';
      b.append(prog, q, opts);
      const draw = () => {
        if (i >= pack.length) {
          const earned = right * 15;
          markPlayed('quiz');
          settle('quiz', 0, earned, 'Викторина: ' + right + ' из ' + pack.length).then(() => {
            m.close(); ok('Верных ответов ' + right + '. Начислено ' + cur(earned));
          });
          return;
        }
        const [text, answers, correct] = pack[i];
        prog.textContent = 'Вопрос ' + (i + 1) + ' из ' + pack.length + ' · верных: ' + right;
        q.textContent = text;
        opts.innerHTML = '';
        answers.map((a, idx) => ({ a, idx })).sort(() => Math.random() - 0.5).forEach(({ a, idx }) => {
          const btn = el('button', 'btn full', esc(a));
          btn.onclick = () => {
            const good = idx === correct;
            btn.classList.add(good ? 'primary' : 'danger');
            if (good) right++;
            [...opts.children].forEach(c => c.disabled = true);
            setTimeout(() => { i++; draw(); }, 500);
          };
          opts.appendChild(btn);
        });
      };
      draw();
    }, { sticky: true });
  }

  function gameCoin() {
    modal('Орёл или решка', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', '<div class="big-num">—</div><div class="muted">Выберите сторону</div>');
      b.appendChild(stage);
      const row = el('div', 'grid2');
      [['Орёл', 0], ['Решка', 1]].forEach(([label, side]) => {
        const btn = el('button', 'btn primary', label);
        btn.onclick = () => {
          let stake;
          try { stake = getStake(); } catch (e) { return bad(e.message); }
          [...row.children].forEach(c => c.disabled = true);
          const res = Math.random() < 0.5 ? 0 : 1;
          const face = stage.querySelector('.big-num');
          let n = 0;
          const spin = setInterval(() => { face.textContent = (n++ % 2) ? 'О' : 'Р'; }, 90);
          setTimeout(() => {
            clearInterval(spin);
            const win = res === side;
            face.textContent = res === 0 ? 'Орёл' : 'Решка';
            stage.querySelector('.muted').innerHTML = win
              ? '<b class="pos">' + (res === 0 ? 'Орёл' : 'Решка') + ' — выигрыш!</b>'
              : '<b class="neg">' + (res === 0 ? 'Орёл' : 'Решка') + ' — мимо</b>';
            const payout = win ? Math.round(stake * 1.95 * 100) / 100 : 0;
            settle('coin', stake, payout, win ? 'Монетка: выигрыш' : 'Монетка: проигрыш').then(() => {
              setTimeout(() => { m.close(); win ? ok('Выигрыш ' + cur(payout)) : bad('Ставка проиграна'); }, 700);
            });
          }, 1100);
        };
        row.appendChild(btn);
      });
      b.appendChild(row);
    }, { sticky: true });
  }

  const die = n => `<span class="die">${n}</span>`;
  function gameDice() {
    modal('Кости против банка', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', `
        <div class="dice" id="d-me">${die('?') + die('?')}</div><div class="muted">вы</div>
        <div class="dice" id="d-bank">${die('?') + die('?')}</div><div class="muted">банк</div>
        <div id="d-res" class="muted">Победа — ×2, ничья — возврат ставки</div>`);
      b.appendChild(stage);
      const go = el('button', 'btn primary full', 'Бросить кости');
      go.onclick = () => {
        let stake;
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        go.disabled = true;
        const roll = () => [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
        const anim = setInterval(() => {
          stage.querySelector('#d-me').innerHTML = roll().map(die).join('');
          stage.querySelector('#d-bank').innerHTML = roll().map(die).join('');
        }, 90);
        setTimeout(() => {
          clearInterval(anim);
          const me = roll(), bank = roll();
          const ms = me[0] + me[1], bs = bank[0] + bank[1];
          stage.querySelector('#d-me').innerHTML = me.map(die).join('');
          stage.querySelector('#d-bank').innerHTML = bank.map(die).join('');
          let payout = 0, text;
          if (ms > bs) { payout = stake * 2; text = 'Вы выиграли: ' + ms + ' против ' + bs; }
          else if (ms === bs) { payout = stake; text = 'Ничья ' + ms + ':' + bs + ' — ставка возвращена'; }
          else { text = 'Банк сильнее: ' + bs + ' против ' + ms; }
          payout = Math.round(payout * 100) / 100;
          stage.querySelector('#d-res').innerHTML = `<b class="${payout > stake ? 'pos' : payout ? '' : 'neg'}">${text}</b>`;
          settle('dice', stake, payout, 'Кости ' + ms + ':' + bs).then(() => {
            setTimeout(() => { m.close(); payout > stake ? ok('Выигрыш ' + cur(payout)) : payout ? toast('Ничья') : bad('Ставка проиграна'); }, 900);
          });
        }, 1200);
      };
      b.appendChild(go);
    }, { sticky: true });
  }

  const SECTORS = [
    { m: 0, w: 26, color: '#8a4450' }, { m: 0.5, w: 20, color: '#5a6474' },
    { m: 1.5, w: 22, color: '#5c6bc0' }, { m: 2, w: 18, color: '#4e9a8a' },
    { m: 3, w: 9, color: '#3f7a63' }, { m: 5, w: 4, color: '#a68f68' },
    { m: 10, w: 1, color: '#7a5c78' }
  ];
  function pickSector() {
    const total = SECTORS.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const s of SECTORS) { if ((r -= s.w) <= 0) return s; }
    return SECTORS[0];
  }
  function gameWheel() {
    modal('Колесо фортуны', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', '');
      const wheel = el('div', 'wheel');
      const total = SECTORS.reduce((s, x) => s + x.w, 0);
      let acc = 0;
      wheel.style.background = 'conic-gradient(' + SECTORS.map(s => {
        const from = acc / total * 360; acc += s.w;
        return `${s.color} ${from}deg ${acc / total * 360}deg`;
      }).join(',') + ')';
      const label = el('div', 'muted', 'Шансы: ×0 · ×0.5 · ×1.5 · ×2 · ×3 · ×5 · ×10');
      stage.append(el('div', 'big-num', '|'), wheel, label);
      b.appendChild(stage);
      const go = el('button', 'btn primary full', 'Крутить');
      go.onclick = () => {
        let stake;
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        go.disabled = true;
        const s = pickSector();
        wheel.style.transform = 'rotate(' + (1440 + Math.random() * 360) + 'deg)';
        setTimeout(() => {
          const payout = Math.round(stake * s.m * 100) / 100;
          label.innerHTML = `<b class="${payout > stake ? 'pos' : 'neg'}">Выпало ×${s.m} → ${cur(payout)}</b>`;
          settle('wheel', stake, payout, 'Колесо фортуны ×' + s.m).then(() => {
            setTimeout(() => { m.close(); payout > stake ? ok('Выигрыш ' + cur(payout)) : bad('×' + s.m + ' — неудача'); }, 900);
          });
        }, 3700);
      };
      b.appendChild(go);
    }, { sticky: true });
  }

  function gameCrash() {
    modal('Краш', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', '<div class="big-num mult">1.00×</div><div class="muted">Заберите до обвала</div>');
      b.appendChild(stage);
      const go = el('button', 'btn primary full', 'Запустить');
      const take = el('button', 'btn full', 'Забрать');
      take.disabled = true;
      b.append(go, take);
      let stake = 0, mult = 1, iv = null, done = false;
      const num = stage.querySelector('.mult'), sub = stage.querySelector('.muted');

      const finish = (payout, text, good) => {
        if (done) return; done = true;
        clearInterval(iv); take.disabled = true;
        sub.innerHTML = `<b class="${good ? 'pos' : 'neg'}">${text}</b>`;
        settle('crash', stake, payout, 'Краш ×' + mult.toFixed(2)).then(() => {
          setTimeout(() => { m.close(); good ? ok('Забрано ' + cur(payout)) : bad('Обвал на ×' + mult.toFixed(2)); }, 900);
        });
      };

      go.onclick = () => {
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        go.disabled = true; take.disabled = false;
        const crashAt = Math.max(1, 0.96 / (1 - Math.random()));
        iv = setInterval(() => {
          mult = Math.round((mult + Math.max(0.01, mult * 0.035)) * 100) / 100;
          num.textContent = mult.toFixed(2) + '×';
          if (mult >= crashAt) {
            num.textContent = crashAt.toFixed(2) + '×';
            mult = crashAt;
            finish(0, 'Обвал на ×' + crashAt.toFixed(2), false);
          }
        }, 110);
      };
      take.onclick = () => finish(Math.round(stake * mult * 100) / 100, 'Забрано на ×' + mult.toFixed(2), true);
    }, { sticky: true });
  }

  function viewCredits(v) {
    const active = S.credits.filter(c => c.status === 'active');
    const debt = active.reduce((s, c) => s + (c.total - c.paid), 0);

    const head = el('div', 'card');
    head.innerHTML = `<div class="balance">
      <div class="sub">Текущая задолженность</div>
      <div class="amount ${debt ? 'neg' : ''}">${money(debt)} <small>${unit(debt)}</small></div>
      <div class="sub">${active.length ? 'Активных кредитов: ' + active.length : 'Кредитов нет — можно взять'}</div></div>`;
    v.appendChild(head);

    const take = el('button', 'btn primary full', 'Взять кредит');
    take.onclick = creditModal;
    v.appendChild(take);

    v.appendChild(el('div', 'card', `
      <div class="kv"><span>Сумма</span><b>от 100 до ${money(creditLimit())}</b></div>
      <div class="kv"><span>Ставка</span><b>${C.CREDIT_PLANS.map(p => p.rate + '% / ' + p.label).join(' · ')}</b></div>
      <div class="kv"><span>Максимум кредитов</span><b>3 активных</b></div>
      <div class="kv"><span>Просрочка</span><b class="neg">списание долга + штраф ${C.PENALTY_RATE}%</b></div>
      <div class="kv"><span>Страховки в запасе</span><b>${inv().insurance || 0}</b></div>
      <div class="kv"><span>Кредитные каникулы</span><b>${inv().holidays || 0}</b></div>
      <div class="empty" style="padding:8px 0 0;text-align:left">Если не погасить кредит до срока, банк спишет весь остаток и штраф со счёта — баланс может уйти в минус.</div>`));

    v.appendChild(el('div', 'sec-title', 'Мои кредиты'));
    if (!S.credits.length) { v.appendChild(el('div', 'card', '<div class="empty">Вы ещё не брали кредитов</div>')); return; }

    S.credits.forEach(c => {
      const rest = Math.round((c.total - c.paid) * 100) / 100;
      const pct = Math.min(100, Math.round(c.paid / c.total * 100));
      const overdue = c.status === 'overdue';
      const soon = c.status === 'active' && new Date(c.due_at).getTime() - Date.now() < 36e5;
      const box = el('div', 'credit' + (overdue ? ' overdue' : ''));
      box.innerHTML = `
        <div class="credit-head">
          <b>${cur(c.amount)} · ${c.days} дн. · ${c.rate}%</b>
          <span class="tag ${overdue ? 'bad' : c.status === 'closed' ? 'ok' : soon ? 'warn' : ''}">${
            overdue ? 'просрочен' : c.status === 'closed' ? 'погашен' : 'активен'}</span>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="kv"><span>К возврату</span><b>${cur(c.total)}</b></div>
        <div class="kv"><span>Погашено</span><b>${cur(c.paid)} (${pct}%)</b></div>
        ${c.status === 'active' ? `<div class="kv"><span>Осталось внести</span><b>${cur(rest)}</b></div>
        <div class="kv"><span>Срок</span><b>${new Date(c.due_at).toLocaleString('ru-RU')} · ${left(c.due_at)}</b></div>` : ''}
        ${overdue ? `<div class="kv"><span>Штраф</span><b class="neg">${cur(c.penalty || 0)}</b></div>` : ''}`;
      if (c.status === 'active') {
        const pay = el('button', 'btn primary mini full', 'Погасить');
        pay.onclick = () => payModal(c);
        box.appendChild(pay);
        if (inv().holidays > 0) {
          const ext = el('button', 'btn mini full', 'Каникулы: продлить на 3 дня');
          ext.onclick = () => confirmBox('Кредитные каникулы',
            'Срок вырастет на 3 дня, одни каникулы будут потрачены. Продолжить?',
            () => guard(async () => {
              await S.api.creditExtend(S.token, c.id);
              await refresh(); render();
              ok('Срок кредита продлён на 3 дня');
            }));
          box.appendChild(ext);
        }
      }
      v.appendChild(box);
    });
  }

  function creditLimit() { return inv().limit_up ? C.CREDIT_LIMIT_VIP : C.CREDIT_LIMIT; }

  function creditModal() {
    modal('Кредит в Чекунец Банке', (b, m) => {
      const f = el('label', 'field', '<span>Сумма, чекурубли</span><input inputmode="decimal" value="1000"><em class="err"></em>');
      b.appendChild(f);
      let plan = C.CREDIT_PLANS[1];
      const seg = el('div', 'seg');
      C.CREDIT_PLANS.forEach(p => {
        const btn = el('button', 'seg-btn' + (p === plan ? ' active' : ''), p.label + '<br><small>' + p.rate + '%</small>');
        btn.onclick = () => {
          plan = p;
          [...seg.children].forEach(x => x.classList.toggle('active', x === btn));
          calc();
        };
        seg.appendChild(btn);
      });
      b.appendChild(seg);
      const info = el('div', 'card', '');
      b.appendChild(info);
      const calc = () => {
        const sum = Number(String(f.querySelector('input').value).replace(',', '.')) || 0;
        const total = Math.round(sum * (1 + plan.rate / 100) * 100) / 100;
        info.innerHTML = `
          <div class="kv"><span>Получите на счёт</span><b>${cur(sum)}</b></div>
          <div class="kv"><span>Переплата</span><b>${cur(total - sum)}</b></div>
          <div class="kv"><span>Вернуть до</span><b>${new Date(Date.now() + plan.days * 864e5).toLocaleString('ru-RU')}</b></div>
          <div class="kv"><span>Итого к возврату</span><b>${cur(total)}</b></div>
          <div class="kv"><span>При просрочке спишем</span><b class="neg">${cur(Math.round(total * (1 + C.PENALTY_RATE / 100) * 100) / 100)}</b></div>`;
      };
      f.querySelector('input').addEventListener('input', calc);
      calc();
      const go = el('button', 'btn primary full', 'Оформить кредит');
      go.onclick = () => guard(async () => {
        const sum = Number(String(f.querySelector('input').value).replace(',', '.'));
        await S.api.creditTake(S.token, sum, plan.days);
        m.close(); await refresh(); render();
        ok('Кредит одобрен: ' + cur(sum) + ' зачислены на счёт');
      });
      b.appendChild(go);
    });
  }

  function payModal(c) {
    const rest = Math.round((c.total - c.paid) * 100) / 100;
    modal('Погашение кредита', (b, m) => {
      b.appendChild(el('div', 'card', `
        <div class="kv"><span>Остаток долга</span><b>${cur(rest)}</b></div>
        <div class="kv"><span>Срок</span><b>${left(c.due_at)}</b></div>
        <div class="kv"><span>Ваш баланс</span><b>${cur(S.user.balance)}</b></div>`));
      const f = el('label', 'field', `<span>Сумма платежа, чекурубли</span><input inputmode="decimal" value="${rest}"><em class="err"></em>`);
      b.appendChild(f);
      const all = el('button', 'btn full', 'Погасить полностью: ' + cur(rest));
      all.onclick = () => { f.querySelector('input').value = rest; pay(); };
      const go = el('button', 'btn primary full', 'Внести платёж');
      const pay = () => guard(async () => {
        const sum = Number(String(f.querySelector('input').value).replace(',', '.'));
        const r = await S.api.creditPay(S.token, c.id, sum);
        m.close(); await refresh(); render();
        ok(r.credit.status === 'closed' ? 'Кредит полностью погашен' : 'Платёж принят: ' + cur(sum));
      });
      go.onclick = pay;
      b.append(all, go);
    });
  }

  function switchRow(title, sub, checked, onChange) {
    const row = el('div', 'switch', `<div><b>${esc(title)}</b><small>${esc(sub)}</small></div>
      <label class="sw"><input type="checkbox" ${checked ? 'checked' : ''}><i></i></label>`);
    row.querySelector('input').onchange = e => onChange(e.target.checked);
    return row;
  }

  function viewSettings(v) {
    const s = S.user.settings || {};

    const look = el('div', 'card');
    look.appendChild(el('div', 'sec-title', 'Внешний вид'));
    look.appendChild(switchRow('Тёмная тема', 'Светлый или тёмный интерфейс', (s.theme || 'dark') !== 'light',
      val => saveSettings({ theme: val ? 'dark' : 'light' })));
    look.appendChild(switchRow('Скрывать баланс', 'Сумма на главной прячется за точками', !!s.hide_balance,
      val => saveSettings({ hide_balance: val })));
    v.appendChild(look);

    const beh = el('div', 'card');
    beh.appendChild(el('div', 'sec-title', 'Уведомления и приватность'));
    beh.appendChild(switchRow('Уведомления об операциях', 'Всплывающие сообщения о зачислениях', s.notify !== false,
      val => saveSettings({ notify: val })));
    beh.appendChild(switchRow('Звуки', 'Короткий сигнал при выигрыше', s.sound !== false,
      val => saveSettings({ sound: val })));
    beh.appendChild(switchRow('Показывать меня в рейтинге', 'Имя и баланс в топе клиентов', s.public !== false,
      val => saveSettings({ public: val })));
    v.appendChild(beh);

    const sec = el('div', 'card');
    sec.appendChild(el('div', 'sec-title', 'Безопасность'));
    const pinBtn = el('button', 'btn full', 'Сменить PIN-код');
    pinBtn.onclick = pinModal;
    const srv = el('button', 'btn full ghost', 'Сервер банка — ' + (S.api.mode === 'online' ? 'онлайн' : 'автономно'));
    srv.onclick = serverModal;
    const exp = el('button', 'btn full ghost', 'Выгрузить мои данные');
    exp.onclick = exportData;
    sec.append(pinBtn, srv, exp);
    v.appendChild(sec);

    const danger = el('div', 'card');
    danger.appendChild(el('div', 'sec-title', 'Опасная зона'));
    const out = el('button', 'btn full', 'Выйти из аккаунта');
    out.onclick = () => confirmBox('Выход', 'Выйти из личного кабинета на этом устройстве?', logout);
    const del = el('button', 'btn full danger', 'Удалить счёт навсегда');
    del.onclick = () => confirmBox('Удаление счёта',
      'Счёт, карта, история и кредиты будут удалены безвозвратно. Продолжить?',
      () => guard(async () => { await S.api.remove(S.token); logout(); }), true);
    danger.append(out, del);
    v.appendChild(danger);

    v.appendChild(el('div', 'empty', 'Чекунец Банк · версия 1.0 · валюта: чекурубль' +
      (S.clients ? '<br>клиентов в банке: ' + S.clients : '')));
  }

  function saveSettings(patch) {
    if (patch.theme) applyTheme(patch.theme);
    guard(async () => {
      await S.api.updateProfile(S.token, { settings: patch });
      await refresh(); render();
      ok('Настройки сохранены');
    });
  }

  function pinModal() {
    modal('Смена PIN-кода', (b, m) => {
      const f1 = el('label', 'field', '<span>Текущий PIN</span><input type="password" inputmode="numeric" maxlength="4"><em class="err"></em>');
      const f2 = el('label', 'field', '<span>Новый PIN</span><input type="password" inputmode="numeric" maxlength="4"><em class="err"></em>');
      const f3 = el('label', 'field', '<span>Повторите новый</span><input type="password" inputmode="numeric" maxlength="4"><em class="err"></em>');
      [f1, f2, f3].forEach(f => bindDigits(f.querySelector('input'), 4));
      b.append(f1, f2, f3);
      const go = el('button', 'btn primary full', 'Сменить PIN');
      go.onclick = () => guard(async () => {
        const [a, c, d] = [f1, f2, f3].map(f => f.querySelector('input').value);
        if (!/^\d{4}$/.test(c)) return bad('Новый PIN — 4 цифры');
        if (c !== d) return bad('Новые PIN-коды не совпадают');
        await S.api.changePin(S.token, a, c, S.user.phone);
        m.close(); ok('PIN-код изменён');
      });
      b.appendChild(go);
    });
  }

  function exportData() {
    const data = { user: S.user, transactions: S.tx, credits: S.credits, exported_at: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'chekunec-bank-' + S.user.phone.replace(/\D/g, '') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    ok('Файл выгружен');
  }

  function resetAuth() {
    $$('[data-auth]').forEach(x => x.classList.toggle('active', x.dataset.auth === 'login'));
    $('#form-login').classList.remove('hidden');
    $('#form-register').classList.add('hidden');
    $('#form-register').reset();
    $$('#form-register .err, #form-login .err').forEach(e => e.textContent = '');
    show('screen-auth');
  }

  function logout() {
    const t = S.token;
    localStorage.removeItem('cb_token');
    S.token = null; S.user = null; S.tx = []; S.credits = []; S.tab = 'home';
    S.api.logout(t).catch(() => {});
    $('#li-pin').value = '';
    resetAuth();
  }

  function viewProfile(v) {
    const u = S.user;
    const head = el('div', 'card');
    head.innerHTML = `
      <div style="display:grid;justify-items:center;gap:8px;padding:6px 0">
        <div class="avatar" style="width:70px;height:70px;border-radius:20px;font-size:22px;--av:${avatarColor(u) || 'var(--acc)'}">${esc(avatarOf(u))}</div>
        <b style="font-size:19px">${esc(u.first_name + ' ' + u.last_name)}${roleMark(u)}</b>
        <span class="muted">${esc(u.card_holder)}</span>
        ${u.equipped && u.equipped.title ? `<span class="tag ok">${esc(u.equipped.title)}</span>` : ''}
        <span class="chip">${C.ROLES[u.role] ? esc(C.ROLES[u.role].label) : 'Клиент'}</span>
        <span class="chip">Клиент с ${new Date(u.created_at).toLocaleDateString('ru-RU')}</span>
      </div>`;
    v.appendChild(head);

    const days = Math.max(1, Math.round((Date.now() - new Date(u.created_at)) / 864e5));
    const st = el('div', 'stat-row');
    st.innerHTML = `<div class="stat"><b>${days}</b><span>дней в банке</span></div>
      <div class="stat"><b>${S.tx.length}</b><span>операций</span></div>
      <div class="stat"><b>${S.credits.length}</b><span>кредитов</span></div>`;
    v.appendChild(st);

    v.appendChild(el('div', 'sec-title', 'Личные данные'));
    v.appendChild(el('div', 'card', `
      <div class="kv"><span>Имя</span><b>${esc(u.first_name)}</b></div>
      <div class="kv"><span>Фамилия</span><b>${esc(u.last_name)}</b></div>
      <div class="kv"><span>Латиницей</span><b>${esc(u.card_holder)}</b></div>
      <div class="kv"><span>Телефон</span><b class="mono">${esc(U.prettyPhone(u.phone))}</b></div>
      <div class="kv"><span>Почта</span><b>${esc(u.email)}</b></div>
      <div class="kv"><span>Статус</span><b>${C.ROLES[u.role] ? esc(C.ROLES[u.role].label) : 'Клиент'}</b></div>
      <div class="kv"><span>Титул</span><b>${u.equipped && u.equipped.title ? esc(u.equipped.title) : '—'}</b></div>`));

    v.appendChild(el('div', 'sec-title', 'Счёт и карта'));
    const cardBox = el('div', 'card', `
      <div class="kv"><span>Номер карты</span><b class="mono">${cardShort(u.card_number)}</b></div>
      <div class="kv"><span>Срок действия</span><b>${esc(u.card_exp)}</b></div>
      <div class="kv"><span>Номер счёта</span><b class="mono">${esc(u.account_number)}</b></div>
      <div class="kv"><span>Валюта</span><b>чекурубль</b></div>
      <div class="kv"><span>Баланс</span><b>${cur(u.balance)}</b></div>`);
    const openCard = el('button', 'btn full mini', 'Показать карту полностью');
    openCard.style.marginTop = '10px';
    openCard.onclick = cardModal;
    cardBox.appendChild(openCard);
    v.appendChild(cardBox);

    if (isStaff(u)) {
      const adm = el('button', 'btn primary full', isAdmin(u) ? 'Панель администратора' : 'Панель разработчика');
      adm.onclick = () => goTab('admin');
      v.appendChild(adm);
    }

    const edit = el('button', 'btn primary full', 'Изменить контакты');
    edit.onclick = editProfile;
    v.appendChild(edit);

    const share = el('button', 'btn full', 'Мои реквизиты для перевода');
    share.onclick = () => modal('Реквизиты для перевода', b => {
      b.appendChild(el('div', 'card', `
        <div class="kv"><span>Получатель</span><b>${esc(u.first_name + ' ' + u.last_name)}</b></div>
        <div class="kv"><span>Телефон</span><b class="mono">${esc(U.prettyPhone(u.phone))}</b></div>
        <div class="kv"><span>Карта</span><b class="mono">${cardMask(u.card_number)}</b></div>
        <div class="kv"><span>Банк</span><b>Чекунец Банк</b></div>`));
      const copy = el('button', 'btn primary full', 'Скопировать реквизиты');
      copy.onclick = () => navigator.clipboard?.writeText(
        `Чекунец Банк\n${u.first_name} ${u.last_name}\nТелефон: ${U.prettyPhone(u.phone)}\nКарта: ${cardMask(u.card_number)}`
      ).then(() => ok('Скопировано'), () => bad('Не удалось скопировать'));
      b.appendChild(copy);
    });
    v.appendChild(share);

    const out = el('button', 'btn full ghost', 'Выйти');
    out.onclick = () => confirmBox('Выход', 'Выйти из личного кабинета?', logout);
    v.appendChild(out);
  }

  function editProfile() {
    const u = S.user;
    modal('Изменение контактов', (b, m) => {
      const f1 = el('label', 'field', `<span>Почта</span><input type="email" value="${esc(u.email)}"><em class="err"></em>`);
      const f2 = el('label', 'field', `<span>Телефон</span><input type="tel" value="${esc(U.prettyPhone(u.phone))}"><em class="err"></em>`);
      bindPhoneMask(f2.querySelector('input'));
      b.append(f1, f2);
      b.appendChild(el('p', 'muted', 'Телефон используется для входа и получения переводов.'));
      const go = el('button', 'btn primary full', 'Сохранить');
      go.onclick = () => guard(async () => {
        const email = f1.querySelector('input').value.trim();
        const phone = U.normalizePhone(f2.querySelector('input').value);
        if (!U.isEmail(email)) return bad('Проверьте адрес почты');
        if (!phone) return bad('Телефон должен быть в формате +7…');
        await S.api.updateProfile(S.token, { email, phone });
        m.close(); await refresh(); render();
        ok('Данные обновлены');
      });
      b.appendChild(go);
    });
  }

  function gameMemory() {
    const CELLS = 9;
    let round = 1, earned = 0;
    modal('Ревизия склада', (b, m) => {
      const info = el('div', 'muted', '');
      info.style.textAlign = 'center';
      const grid = el('div', 'pad');
      const status = el('div', 'muted', 'Запоминайте порядок');
      status.style.textAlign = 'center';
      b.append(info, grid, status);
      const cells = [];
      for (let i = 0; i < CELLS; i++) {
        const c = el('button', 'pad-cell', String(i + 1));
        c.disabled = true;
        grid.appendChild(c);
        cells.push(c);
      }

      const finish = () => {
        markPlayed('memory');
        settle('memory', 0, earned, 'Ревизия склада: раундов ' + (round - 1)).then(() => {
          m.close();
          earned ? ok('Начислено ' + cur(earned)) : bad('Ни одного раунда');
        });
      };

      const play = () => {
        if (round > 5) return finish();
        info.textContent = 'Раунд ' + round + ' из 5 · заработано ' + money(earned);
        const seq = [];
        while (seq.length < round + 1) {
          const x = Math.floor(Math.random() * CELLS);
          if (seq[seq.length - 1] !== x) seq.push(x);
        }
        status.textContent = 'Запоминайте';
        cells.forEach(c => c.disabled = true);
        let i = 0;
        const show = setInterval(() => {
          if (i > 0) cells[seq[i - 1]].classList.remove('lit');
          if (i >= seq.length) {
            clearInterval(show);
            status.textContent = 'Повторите порядок';
            cells.forEach(c => c.disabled = false);
            let k = 0;
            cells.forEach((c, idx) => c.onclick = () => {
              c.classList.add('lit');
              setTimeout(() => c.classList.remove('lit'), 180);
              if (idx !== seq[k]) {
                cells.forEach(x => x.disabled = true);
                status.innerHTML = '<b class="neg">Ошибка в порядке</b>';
                setTimeout(finish, 700);
                return;
              }
              if (++k === seq.length) {
                earned += 20;
                round++;
                cells.forEach(x => x.disabled = true);
                status.innerHTML = '<b class="pos">Верно</b>';
                setTimeout(play, 700);
              }
            });
            return;
          }
          cells[seq[i]].classList.add('lit');
          i++;
        }, 620);
      };
      play();
    }, { sticky: true });
  }

  function gameCups() {
    modal('Три стопки', (b, m) => {
      const getStake = stakeField(b);
      const status = el('div', 'muted', 'Под одной из стопок чекушка');
      status.style.textAlign = 'center';
      b.appendChild(status);
      const row = el('div', 'grid3');
      const cups = [0, 1, 2].map(i => {
        const c = el('button', 'cup', 'Стопка ' + (i + 1));
        row.appendChild(c);
        return c;
      });
      b.appendChild(row);
      let played = false;
      cups.forEach((c, i) => c.onclick = () => {
        if (played) return;
        let stake;
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        played = true;
        const win = Math.floor(Math.random() * 3);
        cups.forEach((x, j) => {
          x.textContent = j === win ? 'Чекушка' : 'Пусто';
          x.classList.add(j === win ? 'good' : 'gone');
        });
        const payout = i === win ? Math.round(stake * 2.7 * 100) / 100 : 0;
        status.innerHTML = payout
          ? '<b class="pos">Угадали: ' + cur(payout) + '</b>'
          : '<b class="neg">Мимо</b>';
        settle('cups', stake, payout, payout ? 'Три стопки: выигрыш' : 'Три стопки: проигрыш').then(() => {
          setTimeout(() => { m.close(); payout ? ok('Выигрыш ' + cur(payout)) : bad('Ставка проиграна'); }, 900);
        });
      });
    }, { sticky: true });
  }

  function gameCellar() {
    const SIZE = 25, EMPTY = 5;
    modal('Погреб', (b, m) => {
      const getStake = stakeField(b);
      const info = el('div', 'muted', 'На 25 полок — 5 пустых. Забирайте вовремя.');
      info.style.textAlign = 'center';
      const grid = el('div', 'mines');
      b.append(info, grid);
      const take = el('button', 'btn full', 'Забрать');
      const start = el('button', 'btn primary full', 'Спуститься в погреб');
      b.append(start, take);
      take.disabled = true;

      let stake = 0, opened = 0, mult = 1, bad_ = [], over = false;
      const cells = [];
      for (let i = 0; i < SIZE; i++) {
        const c = el('button', 'mine', '');
        c.disabled = true;
        grid.appendChild(c);
        cells.push(c);
      }

      const multFor = k => {
        let p = 1;
        for (let i = 0; i < k; i++) p *= (SIZE - EMPTY - i) / (SIZE - i);
        return Math.min(20, Math.round(0.95 / p * 100) / 100);
      };

      const finish = (payout, text, good) => {
        if (over) return; over = true;
        cells.forEach((c, i) => {
          c.disabled = true;
          if (bad_.includes(i) && !c.classList.contains('open')) c.classList.add('boom');
        });
        take.disabled = true;
        info.innerHTML = '<b class="' + (good ? 'pos' : 'neg') + '">' + text + '</b>';
        settle('cellar', stake, payout, 'Погреб: открыто полок ' + opened).then(() => {
          setTimeout(() => { m.close(); good ? ok('Забрано ' + cur(payout)) : bad('Пустая полка'); }, 900);
        });
      };

      start.onclick = () => {
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        start.disabled = true; take.disabled = false;
        while (bad_.length < EMPTY) {
          const x = Math.floor(Math.random() * SIZE);
          if (!bad_.includes(x)) bad_.push(x);
        }
        cells.forEach((c, i) => {
          c.disabled = false;
          c.onclick = () => {
            if (over || c.classList.contains('open')) return;
            if (bad_.includes(i)) {
              c.classList.add('boom');
              return finish(0, 'Пустая полка на ' + (opened + 1) + '-м шаге', false);
            }
            c.classList.add('open');
            c.textContent = 'ЧК';
            opened++;
            mult = multFor(opened);
            info.textContent = 'Открыто ' + opened + ' · множитель ×' + mult.toFixed(2) +
              ' · к выдаче ' + money(Math.round(stake * mult * 100) / 100);
            if (mult >= 20) finish(Math.round(stake * 20 * 100) / 100, 'Максимум ×20', true);
          };
        });
      };

      take.onclick = () => {
        if (!opened) return bad('Откройте хотя бы одну полку');
        finish(Math.round(stake * mult * 100) / 100, 'Забрано на ×' + mult.toFixed(2), true);
      };
    }, { sticky: true });
  }

  const REELS = ['ЧК', 'БАР', '7', 'СТОП', 'КЛЮЧ'];
  function gameSlots() {
    modal('Барабаны', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', '');
      const row = el('div', 'reels');
      const cells = [0, 1, 2].map(() => {
        const c = el('div', 'reel', '—');
        row.appendChild(c);
        return c;
      });
      const label = el('div', 'muted', 'Три «7» — ×20, три «ЧК» — ×10, любые три — ×5, две — ×1.2');
      stage.append(row, label);
      b.appendChild(stage);
      const go = el('button', 'btn primary full', 'Крутить');
      go.onclick = () => {
        let stake;
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        go.disabled = true;
        const res = [0, 1, 2].map(() => REELS[Math.floor(Math.random() * REELS.length)]);
        let ticks = 0;
        const spin = setInterval(() => {
          cells.forEach(c => c.textContent = REELS[Math.floor(Math.random() * REELS.length)]);
          if (++ticks > 12) {
            clearInterval(spin);
            cells.forEach((c, i) => c.textContent = res[i]);
            const same = res[0] === res[1] && res[1] === res[2];
            const pair = res[0] === res[1] || res[1] === res[2] || res[0] === res[2];
            let k = 0;
            if (same) k = res[0] === '7' ? 20 : res[0] === 'ЧК' ? 10 : 5;
            else if (pair) k = 1.2;
            const payout = Math.round(stake * k * 100) / 100;
            label.innerHTML = k
              ? '<b class="' + (payout > stake ? 'pos' : '') + '">×' + k + ' — ' + cur(payout) + '</b>'
              : '<b class="neg">Ничего не выпало</b>';
            settle('slots', stake, payout, 'Барабаны ×' + k).then(() => {
              setTimeout(() => { m.close(); payout > stake ? ok('Выигрыш ' + cur(payout)) : bad('Ставка проиграна'); }, 1000);
            });
          }
        }, 90);
      };
      b.appendChild(go);
    }, { sticky: true });
  }

  function gameTower() {
    const FLOORS = 5;
    modal('Башня', (b, m) => {
      const getStake = stakeField(b);
      const info = el('div', 'muted', 'На каждом этаже одна дверь из трёх — проигрышная');
      info.style.textAlign = 'center';
      const box = el('div', 'tower');
      b.append(info, box);
      const start = el('button', 'btn primary full', 'Войти в башню');
      const take = el('button', 'btn full', 'Забрать');
      take.disabled = true;
      b.append(start, take);

      let stake = 0, floor = 0, mult = 1, over = false;
      const rows = [];
      for (let f = FLOORS - 1; f >= 0; f--) {
        const r = el('div', 'tower-row');
        r.dataset.floor = f;
        [0, 1, 2].map(d => {
          const btn = el('button', 'door', 'дверь');
          btn.disabled = true;
          btn.onclick = () => pick(f, d, btn, r);
          r.appendChild(btn);
        });
        box.appendChild(r);
        rows.push(r);
      }

      const arm = () => {
        rows.forEach(r => [...r.children].forEach(c => c.disabled = +r.dataset.floor !== floor || over));
      };

      const finish = (payout, text, good) => {
        if (over) return; over = true;
        arm();
        info.innerHTML = '<b class="' + (good ? 'pos' : 'neg') + '">' + text + '</b>';
        settle('tower', stake, payout, 'Башня: этажей ' + floor).then(() => {
          setTimeout(() => { m.close(); good ? ok('Забрано ' + cur(payout)) : bad('Не та дверь'); }, 900);
        });
      };

      function pick(f, d, btn, r) {
        if (over || f !== floor) return;
        const badDoor = Math.floor(Math.random() * 3);
        [...r.children].forEach((c, i) => {
          c.textContent = i === badDoor ? 'пусто' : 'чекушка';
          c.classList.add(i === badDoor ? 'gone' : 'good');
        });
        if (d === badDoor) return finish(0, 'Пустая дверь на ' + (floor + 1) + '-м этаже', false);
        floor++;
        mult = Math.round(Math.pow(1.4, floor) * 100) / 100;
        take.disabled = false;
        info.textContent = 'Этаж ' + floor + ' · множитель ×' + mult.toFixed(2) +
          ' · к выдаче ' + money(Math.round(stake * mult * 100) / 100);
        if (floor >= FLOORS) return finish(Math.round(stake * mult * 100) / 100, 'Вершина башни ×' + mult.toFixed(2), true);
        arm();
      }

      start.onclick = () => {
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        start.disabled = true;
        arm();
      };
      take.onclick = () => finish(Math.round(stake * mult * 100) / 100, 'Забрано на ×' + mult.toFixed(2), true);
    }, { sticky: true });
  }

  function gameHiLo() {
    modal('Больше или меньше', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', '');
      const card = el('div', 'hilo-card', '?');
      const info = el('div', 'muted', 'Карты от 1 до 13. Равенство возвращает ход.');
      stage.append(card, info);
      b.appendChild(stage);
      const row = el('div', 'grid2');
      const up = el('button', 'btn primary', 'Больше');
      const down = el('button', 'btn primary', 'Меньше');
      row.append(up, down);
      const start = el('button', 'btn primary full', 'Начать');
      const take = el('button', 'btn full', 'Забрать');
      take.disabled = true;
      b.append(start, row, take);
      up.disabled = down.disabled = true;

      let stake = 0, cur_ = 0, mult = 1, over = false, steps = 0;

      const finish = (payout, text, good) => {
        if (over) return; over = true;
        up.disabled = down.disabled = take.disabled = true;
        info.innerHTML = '<b class="' + (good ? 'pos' : 'neg') + '">' + text + '</b>';
        settle('hilo', stake, payout, 'Больше или меньше: ходов ' + steps).then(() => {
          setTimeout(() => { m.close(); good ? ok('Забрано ' + cur(payout)) : bad('Не угадали'); }, 900);
        });
      };

      const guess = high => {
        if (over) return;
        const next = 1 + Math.floor(Math.random() * 13);
        const good = high ? Math.max(0, 13 - cur_) : Math.max(0, cur_ - 1);
        card.textContent = next;
        if (next === cur_) {
          info.textContent = 'Равенство — ход не считается. Текущий множитель ×' + mult.toFixed(2);
          return;
        }
        const hit = high ? next > cur_ : next < cur_;
        if (!hit) return finish(0, 'Выпало ' + next + ' — мимо', false);
        steps++;
        mult = Math.min(20, Math.round(mult * (0.95 * 13 / good) * 100) / 100);
        cur_ = next;
        take.disabled = false;
        info.textContent = 'Множитель ×' + mult.toFixed(2) + ' · к выдаче ' +
          money(Math.round(stake * mult * 100) / 100);
        if (mult >= 20) finish(Math.round(stake * 20 * 100) / 100, 'Максимум ×20', true);
      };

      start.onclick = () => {
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        start.disabled = true;
        up.disabled = down.disabled = false;
        cur_ = 1 + Math.floor(Math.random() * 13);
        card.textContent = cur_;
        info.textContent = 'Что дальше — больше или меньше?';
      };
      up.onclick = () => guess(true);
      down.onclick = () => guess(false);
      take.onclick = () => finish(Math.round(stake * mult * 100) / 100, 'Забрано на ×' + mult.toFixed(2), true);
    }, { sticky: true });
  }

  function viewShop(v) {
    const u = S.user, i = inv();

    const bal = el('div', 'card');
    bal.innerHTML = `<div class="balance"><div class="sub">Доступно к тратам</div>
      <div class="amount ${u.balance < 0 ? 'neg' : ''}">${hidden() ? '••••' : money(u.balance)} <small>${unit(u.balance)}</small></div>
      <div class="sub">Заработать можно в разделе «Игры»</div></div>`;
    v.appendChild(bal);

    const preview = el('div', 'bankcard', cardHtml(u));
    preview.style.maxWidth = '100%';
    preview.style.background = skinCss(u);
    v.appendChild(preview);

    v.appendChild(el('div', 'sec-title', 'Моя карта'));
    const skins = el('div', 'skins');
    Object.entries(C.SKINS).forEach(([id, sk]) => {
      const owned = id === 'base' || (i.skins || []).includes(id);
      const on = ((u.equipped && u.equipped.skin) || 'base') === id;
      const item = C.SHOP.find(x => x.kind === 'skin' && x.value === id);
      const t = el('button', 'skin' + (on ? ' on' : ''),
        `<span class="skin-dot" style="background:${sk.css}"></span>
         <b>${esc(sk.name)}</b>
         <span class="muted">${owned ? (on ? 'на карте' : 'нажмите, чтобы надеть') : money(item ? item.price : 0)}</span>`);
      t.onclick = () => owned ? equip('skin', id) : buy(item.id);
      skins.appendChild(t);
    });
    v.appendChild(skins);

    v.appendChild(el('div', 'sec-title', 'Мои титулы'));
    const titles = el('div', 'card');
    const owned = i.titles || [];
    if (owned.length) {
      const none = el('button', 'btn full mini' + (!(u.equipped && u.equipped.title) ? ' primary' : ''), 'Без титула');
      none.onclick = () => equip('title', '');
      titles.appendChild(none);
      owned.forEach(t => {
        const b = el('button', 'btn full mini' + (u.equipped && u.equipped.title === t ? ' primary' : ''), esc(t));
        b.onclick = () => equip('title', t);
        titles.appendChild(b);
      });
    } else {
      titles.appendChild(el('div', 'empty', 'Титулы пока не куплены'));
    }
    v.appendChild(titles);

    if (i.avatar) {
      v.appendChild(el('div', 'sec-title', 'Мой значок'));
      const row = el('div', 'av-row');
      Object.entries(C.AVATAR_COLORS).forEach(([id, c]) => {
        const b = el('button', 'av-btn' + (u.equipped && u.equipped.avatar === id ? ' on' : ''),
          esc((u.first_name[0] + u.last_name[0]).toUpperCase()));
        b.style.background = c.css;
        b.title = c.name;
        b.onclick = () => equip('avatar', id);
        row.appendChild(b);
      });
      const off = el('button', 'av-btn' + (!(u.equipped && u.equipped.avatar) ? ' on' : ''), 'Сброс');
      off.style.background = 'var(--panel2)';
      off.style.color = 'var(--muted)';
      off.onclick = () => equip('avatar', '');
      row.appendChild(off);
      v.appendChild(row);
    }

    v.appendChild(el('div', 'sec-title', 'Витрина'));
    const boostLeft = i.bonus_boost_until && new Date(i.bonus_boost_until) > new Date()
      ? left(i.bonus_boost_until) : null;

    if (i.cases > 0) {
      const box = el('div', 'card highlight');
      box.innerHTML = `<div class="kv"><span>Нераспечатанных ящиков</span><b>${i.cases}</b></div>`;
      const open = el('button', 'btn primary full', 'Открыть ящик чекушек');
      open.onclick = openCase;
      box.appendChild(open);
      v.appendChild(box);
    }

    C.SHOP_GROUPS.forEach(group => {
      const items = C.SHOP.filter(it => it.group === group);
      if (!items.length) return;
      v.appendChild(el('div', 'sec-title', group));
      items.forEach(it => {
        const has =
          (it.kind === 'skin' && (i.skins || []).includes(it.value)) ||
          (it.kind === 'title' && (i.titles || []).includes(it.value)) ||
          (it.kind === 'perk' && i.limit_up) ||
          (it.kind === 'cashback' && i.cashback) ||
          (it.kind === 'engraving' && i.engraving) ||
          (it.kind === 'avatar' && i.avatar);
        const extra =
          it.id === 'insurance' && i.insurance ? 'в запасе: ' + i.insurance :
          it.id === 'holidays' && i.holidays ? 'в запасе: ' + i.holidays :
          it.id === 'case' && i.cases ? 'не открыто: ' + i.cases :
          it.id === 'bonus_boost' && boostLeft ? 'активен ещё ' + boostLeft :
          it.id === 'engraving' && u.engraving ? 'на карте: ' + u.engraving : '';
        const box = el('div', 'good');
        box.innerHTML = `<div class="good-main"><b>${esc(it.name)}</b><span class="muted">${esc(it.desc)}</span>
          ${extra ? `<span class="muted">${esc(extra)}</span>` : ''}</div>`;
        const btn = el('button', 'btn mini ' + (has ? '' : 'primary'), has ? 'куплено' : money(it.price));
        btn.disabled = has;
        btn.onclick = () => buy(it.id);
        box.appendChild(btn);
        if (it.kind === 'engraving' && i.engraving) {
          const edit = el('button', 'btn mini primary', 'Изменить');
          edit.onclick = engraveModal;
          box.appendChild(edit);
        }
        v.appendChild(box);
      });
    });

    function buy(id) {
      const it = C.SHOP.find(x => x.id === id);
      confirmBox('Покупка', it.name + ' за ' + cur(it.price) + '. Списать со счёта?', () => guard(async () => {
        await S.api.shopBuy(S.token, id);
        await refresh();
        if (it.kind === 'engraving') engraveModal();
        else render();
        ok(it.kind === 'reissue' ? 'Карта перевыпущена' : 'Куплено: ' + it.name);
      }));
    }

    function openCase() {
      guard(async () => {
        const r = await S.api.caseOpen(S.token);
        await refresh();
        modal('Ящик чекушек', (mb, m) => {
          const stage = el('div', 'game-stage', '');
          const num_ = el('div', 'big-num', '...');
          const text = el('div', 'muted', 'Открываем');
          stage.append(num_, text);
          mb.appendChild(stage);
          let n = 0;
          const roll = setInterval(() => {
            num_.textContent = money([0, 200, 500, 1000, 2500, 5000, 10000][n++ % 7]);
            if (n > 10) {
              clearInterval(roll);
              if (r.prize.skin) {
                num_.textContent = 'Золото банка';
                text.innerHTML = '<b class="pos">Редкое оформление карты</b>';
              } else if (r.prize.amount) {
                num_.textContent = money(r.prize.amount);
                text.innerHTML = '<b class="pos">' + cur(r.prize.amount) + ' на счёт</b>';
              } else {
                num_.textContent = 'Пусто';
                text.innerHTML = '<b class="neg">В этот раз не повезло</b>';
              }
              render();
            }
          }, 130);
          const close = el('button', 'btn primary full', 'Забрать');
          close.onclick = () => { m.close(); render(); };
          mb.appendChild(close);
        });
      });
    }

    function engraveModal() {
      modal('Гравировка на карте', (mb, m) => {
        mb.appendChild(el('p', 'muted', 'До 16 символов латиницей, цифры, точка и дефис.'));
        const f = el('label', 'field', `<span>Надпись</span><input maxlength="16" value="${esc(u.engraving || '')}" placeholder="CHEKUSHKA CLUB"><em class="err"></em>`);
        mb.appendChild(f);
        const inp = f.querySelector('input');
        inp.addEventListener('input', () => {
          inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9 .\-]/g, '');
        });
        const go = el('button', 'btn primary full', 'Нанести');
        go.onclick = () => guard(async () => {
          await S.api.engrave(S.token, inp.value.trim());
          m.close(); await refresh(); render();
          ok('Гравировка обновлена');
        });
        const clear = el('button', 'btn full ghost', 'Убрать надпись');
        clear.onclick = () => guard(async () => {
          await S.api.engrave(S.token, '');
          m.close(); await refresh(); render();
        });
        mb.append(go, clear);
      });
    }

    function equip(kind, value) {
      guard(async () => {
        await S.api.shopEquip(S.token, kind, value);
        await refresh(); render();
      });
    }
  }

  function viewAdmin(v) {
    const me = S.user;
    if (!isStaff(me)) { v.appendChild(el('div', 'empty', 'Раздел доступен сотрудникам банка')); return; }

    const head = el('div', 'card');
    head.innerHTML = `<div class="balance">
      <div class="sub">${isAdmin(me) ? 'Панель администратора' : 'Панель разработчика'}</div>
      <div class="amount" style="font-size:22px">${esc(me.first_name + ' ' + me.last_name)}</div>
      <div class="sub">${isAdmin(me) ? 'полный доступ' : 'только просмотр аналитики и клиентов'}</div></div>`;
    v.appendChild(head);

    const seg = el('div', 'seg');
    let tab = viewAdmin.tab || 'stats';
    [['stats', 'Аналитика'], ['users', 'Люди'], ['feed', 'Лента']].forEach(([id, label]) => {
      const b = el('button', 'seg-btn' + (id === tab ? ' active' : ''), label);
      b.onclick = () => { viewAdmin.tab = id; render(); };
      seg.appendChild(b);
    });
    v.appendChild(seg);

    const box = el('div', '');
    box.style.display = 'grid'; box.style.gap = '14px';
    v.appendChild(box);
    box.appendChild(el('div', 'empty', 'Загружаем…'));

    if (tab === 'stats') adminStats(box);
    if (tab === 'users') adminUsers(box);
    if (tab === 'feed') adminFeed(box);
  }

  function adminStats(box) {
    run(async () => {
      const st = await S.api.adminStats(S.token);
      box.innerHTML = '';

      const tiles = (title, rows) => {
        const c = el('div', 'card');
        c.appendChild(el('div', 'sec-title', title));
        rows.forEach(([k, val, cls]) => c.appendChild(el('div', 'kv', `<span>${k}</span><b class="${cls || ''}">${val}</b>`)));
        box.appendChild(c);
      };

      const top = el('div', 'stat-row');
      top.innerHTML = `<div class="stat"><b>${st.clients}</b><span>клиентов</span></div>
        <div class="stat"><b>${money(st.money)}</b><span>в обороте</span></div>
        <div class="stat"><b>${st.tx_count}</b><span>операций</span></div>`;
      box.appendChild(top);

      const days = el('div', 'card');
      days.appendChild(el('div', 'sec-title', 'Регистрации за неделю'));
      const max = Math.max(1, ...st.registrations.map(r => r.count));
      const chart = el('div', 'chart');
      st.registrations.forEach(r => {
        const col = el('div', 'chart-col');
        col.innerHTML = `<b>${r.count}</b><i style="height:${Math.round(r.count / max * 90) + 4}px"></i>
          <span>${new Date(r.day).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span>`;
        chart.appendChild(col);
      });
      days.appendChild(chart);
      box.appendChild(days);

      tiles('Клиенты', [
        ['Всего', st.clients],
        ['Заблокированы', st.blocked, st.blocked ? 'neg' : ''],
        ['Администраторы', st.admins],
        ['Разработчики', st.developers],
        ['С минусом на счёте', st.debtors, st.debtors ? 'neg' : '']
      ]);

      tiles('Деньги', [
        ['Чекурублей на счетах', cur(st.money)],
        ['Оборот за 24 часа', cur(st.turnover_24h)],
        ['Переводов', st.transfers + ' на ' + cur(st.transfers_sum)],
        ['Выдано банком вручную', cur(st.issued)],
        ['Потрачено в магазине', cur(st.shop_sum)]
      ]);

      tiles('Кредиты и игры', [
        ['Активных кредитов', st.credits_active],
        ['Просроченных', st.credits_overdue, st.credits_overdue ? 'neg' : ''],
        ['Выдано кредитов', cur(st.credits_sum)],
        ['Сыграно игр', st.games_count],
        ['Итог казино', signed(st.games_profit), st.games_profit >= 0 ? 'pos' : 'neg']
      ]);

      const topC = el('div', 'card');
      topC.appendChild(el('div', 'sec-title', 'Богатейшие'));
      st.top.forEach((r, i) => topC.appendChild(el('div', 'kv', `<span>${i + 1}. ${esc(r.name)}</span><b>${cur(r.balance)}</b>`)));
      box.appendChild(topC);
    });
  }

  function adminUsers(box, query) {
    run(async () => {
      const rows = await S.api.adminUsers(S.token, query || '');
      box.innerHTML = '';

      if (isAdmin(S.user)) {
        const issue = el('button', 'btn primary full', 'Выдать чекурубли');
        issue.onclick = () => issueModal();
        box.appendChild(issue);
      }

      const search = el('label', 'field', `<input placeholder="Поиск: имя, телефон, карта, почта" value="${esc(query || '')}">`);
      const inp = search.querySelector('input');
      let timer;
      inp.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => adminUsers(box, inp.value.trim()), 400);
      });
      box.appendChild(search);

      box.appendChild(el('div', 'sec-title', 'Зарегистрированные — ' + rows.length));
      if (!rows.length) box.appendChild(el('div', 'card', '<div class="empty">Никого не найдено</div>'));

      rows.forEach(r => {
        const c = el('div', 'card person' + (r.blocked ? ' blocked' : ''));
        c.innerHTML = `
          <div class="person-head">
            <div class="avatar">${esc((r.first_name[0] + r.last_name[0]).toUpperCase())}</div>
            <div class="person-main">
              <b>${esc(r.first_name + ' ' + r.last_name)}${roleMark(r)}</b>
              <span class="muted mono">${esc(U.prettyPhone(r.phone))}</span>
            </div>
            <b class="${r.balance < 0 ? 'neg' : ''}">${cur(r.balance)}</b>
          </div>
          <div class="kv"><span>Почта</span><b>${esc(r.email)}</b></div>
          <div class="kv"><span>Карта</span><b class="mono">${cardMask(r.card_number)}</b></div>
          <div class="kv"><span>Регистрация</span><b>${new Date(r.created_at).toLocaleString('ru-RU')}</b></div>
          <div class="kv"><span>Операций · кредитов</span><b>${r.tx_count} · ${r.credits}</b></div>
          <div class="kv"><span>Статус</span><b class="${r.blocked ? 'neg' : ''}">${
            r.blocked ? 'заблокирован — ' + esc(r.blocked_reason || '') : (C.ROLES[r.role] ? C.ROLES[r.role].label : 'Клиент')}</b></div>`;

        if (isAdmin(S.user)) {
          const acts = el('div', 'grid2');
          acts.style.marginTop = '10px';

          const give = el('button', 'btn mini primary', 'Начислить');
          give.onclick = () => issueModal(r.phone);

          const role = el('button', 'btn mini', 'Статус');
          role.onclick = () => roleModal(r);

          const block = el('button', 'btn mini ' + (r.blocked ? '' : 'danger'), r.blocked ? 'Разблокировать' : 'Заблокировать');
          block.onclick = () => r.blocked ? doBlock(r, false, '') : blockModal(r);

          const send = el('button', 'btn mini', 'Перевести');
          send.onclick = () => transferModal(r.phone);

          acts.append(give, role, block, send);
          c.appendChild(acts);
        }
        box.appendChild(c);
      });

      function refreshList() { adminUsers(box, inp.value.trim()); }

      function issueModal(target) {
        modal('Выдача чекурублей', (b, m) => {
          b.appendChild(el('p', 'muted', 'Банк начислит сумму на счёт клиента. Отрицательная сумма спишет чекурубли.'));
          const f1 = el('label', 'field', `<span>Клиент (телефон, карта или ФИО)</span><input value="${esc(target ? U.prettyPhone(target) : '')}"><em class="err"></em>`);
          const f2 = el('label', 'field', '<span>Сумма, чекурубли</span><input inputmode="decimal" value="1000"><em class="err"></em>');
          const f3 = el('label', 'field', '<span>Причина</span><input maxlength="60" placeholder="промоакция"></label>');
          b.append(f1, f2, f3);
          const row = el('div', 'actions');
          [1000, 10000, -1000].forEach(x => {
            const q = el('button', 'act', `<span>${num(x)}</span>`);
            q.onclick = () => f2.querySelector('input').value = x;
            row.appendChild(q);
          });
          b.appendChild(row);
          const go = el('button', 'btn primary full', 'Провести');
          go.onclick = () => guard(async () => {
            const sum = Number(String(f2.querySelector('input').value).replace(',', '.'));
            const r2 = await S.api.adminIssue(S.token, f1.querySelector('input').value.trim(), sum, f3.querySelector('input').value.trim());
            m.close(); refreshList();
            ok(r2.name + ': ' + signed(sum) + ', теперь ' + cur(r2.balance));
          });
          b.appendChild(go);
        });
      }

      function roleModal(r) {
        modal('Статус клиента', (b, m) => {
          b.appendChild(el('p', 'muted', esc(r.first_name + ' ' + r.last_name) + ' — текущий статус: ' +
            (C.ROLES[r.role] ? C.ROLES[r.role].label : 'Клиент')));
          Object.entries(C.ROLES).forEach(([id, info]) => {
            const btn = el('button', 'btn full' + (id === r.role ? ' primary' : ''), info.label);
            btn.onclick = () => guard(async () => {
              await S.api.adminRole(S.token, r.phone, id);
              m.close(); refreshList();
              ok(r.first_name + ' теперь ' + info.label.toLowerCase());
            });
            b.appendChild(btn);
          });
        });
      }

      function blockModal(r) {
        modal('Блокировка счёта', (b, m) => {
          b.appendChild(el('p', 'muted', 'Клиент не сможет войти и получать переводы, пока блокировка не снята.'));
          const f = el('label', 'field', '<span>Причина</span><input maxlength="60" placeholder="мошенничество"></label>');
          b.appendChild(f);
          const go = el('button', 'btn danger full', 'Заблокировать');
          go.onclick = () => { m.close(); doBlock(r, true, f.querySelector('input').value.trim()); };
          b.appendChild(go);
        });
      }

      function doBlock(r, val, reason) {
        guard(async () => {
          await S.api.adminBlock(S.token, r.phone, val, reason);
          refreshList();
          ok(r.first_name + (val ? ' заблокирован' : ' разблокирован'));
        });
      }
    });
  }

  function adminFeed(box) {
    run(async () => {
      const rows = await S.api.adminFeed(S.token);
      box.innerHTML = '';
      box.appendChild(el('div', 'sec-title', 'Последние операции банка'));
      const c = el('div', 'card');
      if (!rows.length) c.appendChild(el('div', 'empty', 'Операций пока нет'));
      rows.forEach(t => {
        const row = el('div', 'tx');
        row.innerHTML = `<div class="tx-ico">${TX_ICONS[t.category] || '•'}</div>
          <div class="tx-main"><div class="tx-t">${esc(t.who)}</div><div class="tx-d">${esc(t.title)} · ${when(t.ts)}</div></div>
          <div class="tx-a ${t.amount > 0 ? 'pos' : t.amount < 0 ? 'neg' : 'muted'}">${num(t.amount) || '0'}</div>`;
        c.appendChild(row);
      });
      box.appendChild(c);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
