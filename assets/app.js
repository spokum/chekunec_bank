/* Чекунец Банк — интерфейс личного кабинета */
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

  /* ---------------- форматирование ---------------- */

  const money = v => (Math.round(v * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = v => money(v) + ' ₡';
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

  /* ---------------- тосты / модалки ---------------- */

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
    const close = el('button', 'icon-btn', '✕');
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

  async function guard(fn) {
    if (S.busy) return;
    S.busy = true;
    try { return await fn(); }
    catch (e) { bad(e.message || String(e)); }
    finally { S.busy = false; }
  }

  /* ---------------- вёрстка карты ---------------- */

  function cardHtml(u, opts) {
    const showCvv = opts && opts.cvv;
    return `
      <div class="bc-top">
        <div class="bc-brand">ЧЕКУНЕЦ<small>BANK · CHEKUNEC</small></div>
        <div class="bc-chip"></div>
      </div>
      <div class="bc-num">${cardMask(u.card_number)}</div>
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

  /* ---------------- экраны ---------------- */

  function show(id) {
    $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
    window.scrollTo(0, 0);
  }

  /* ---------------- валидация форм ---------------- */

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

  /* ---------------- инициализация ---------------- */

  async function boot() {
    S.api = CB.createApi();
    const badge = $('#backend-badge');
    if (S.api.mode === 'online') {
      badge.textContent = '● Онлайн-режим: счета общие для всех';
      badge.classList.add('live');
    } else {
      badge.textContent = '◐ Демо-режим: данные только в этом браузере';
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

  /* ---------------- регистрация / вход ---------------- */

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
    modal('Подключение к серверу банка', (b, m) => {
      const ov = CB.readOverride() || {};
      b.appendChild(el('p', 'muted',
        'Впишите данные проекта Supabase — банк станет общим для всех устройств: переводы будут доходить до реальных клиентов. ' +
        'SQL-схема лежит в файле <b>supabase/schema.sql</b> репозитория.'));
      const f1 = el('label', 'field', '<span>Project URL</span><input id="sv-url" placeholder="https://xxxx.supabase.co"><em class="err"></em>');
      const f2 = el('label', 'field', '<span>anon public key</span><input id="sv-key" placeholder="eyJhbGciOi..."><em class="err"></em>');
      b.append(f1, f2);
      f1.querySelector('input').value = (ov.url || window.CB_CONFIG.url || '');
      f2.querySelector('input').value = (ov.anonKey || '');
      const save = el('button', 'btn primary full', 'Проверить и сохранить');
      save.onclick = async () => {
        const url = $('#sv-url').value.trim(), key = $('#sv-key').value.trim();
        if (!url || !key) return bad('Заполните оба поля');
        save.disabled = true; save.textContent = 'Проверяем…';
        try {
          await new CB.SupabaseApi(url, key).ping();
          CB.writeOverride({ url, anonKey: key });
          ok('Сервер подключён, перезагружаем…');
          setTimeout(() => location.reload(), 700);
        } catch (e) {
          bad('Не вышло: ' + e.message);
          save.disabled = false; save.textContent = 'Проверить и сохранить';
        }
      };
      const off = el('button', 'btn full ghost', 'Вернуться в демо-режим');
      off.onclick = () => { CB.writeOverride(null); location.reload(); };
      b.append(save, off);
    });
  }

  /* ================= РЕНДЕР ЛИЧНОГО КАБИНЕТА ================= */

  function render() {
    const u = S.user;
    if (!u) return;
    $('#tb-avatar').textContent = (u.first_name[0] + u.last_name[0]).toUpperCase();
    $('#tb-name').textContent = u.first_name + ' ' + u.last_name;
    $('#tb-sub').textContent = U.prettyPhone(u.phone);
    const mode = $('#tb-mode');
    mode.textContent = S.api.mode === 'online' ? 'online' : 'demo';
    mode.classList.toggle('live', S.api.mode === 'online');

    const v = $('#view');
    v.innerHTML = '';
    ({ home: viewHome, history: viewHistory, games: viewGames, credits: viewCredits, settings: viewSettings, profile: viewProfile }[S.tab])(v);
  }

  const hidden = () => !!(S.user.settings && S.user.settings.hide_balance);

  /* ---------------- ГЛАВНАЯ ---------------- */

  function viewHome(v) {
    const u = S.user;

    const card = el('div', 'bankcard', cardHtml(u));
    card.style.maxWidth = '100%';
    card.onclick = () => cardModal();
    v.appendChild(card);

    const bal = el('div', 'card');
    const amount = hidden() ? '••••••' : money(u.balance) + ' <small>₡</small>';
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
      ['💸', 'Перевести', transferModal],
      ['🎁', 'Бонус дня', dailyBonus],
      ['🏆', 'Рейтинг', topModal],
      ['🧾', 'История', () => goTab('history')],
      ['🎮', 'Заработать', () => goTab('games')],
      ['💳', 'Кредит', () => goTab('credits')]
    ].forEach(([ico, label, fn]) => {
      const b = el('button', 'act', `<i>${ico}</i><span>${label}</span>`);
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

  /** Открыть кабинет с чистой вкладкой «Главная». */
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
    transfer_in: '⬇️', transfer_out: '⬆️', bonus: '🎁', game_bet: '🎲', game_win: '🏅',
    credit: '💳', credit_pay: '✅', penalty: '⚠️'
  };

  function txRow(t) {
    const row = el('div', 'tx');
    row.innerHTML = `
      <div class="tx-ico">${TX_ICONS[t.category] || '•'}</div>
      <div class="tx-main">
        <div class="tx-t">${esc(t.title)}</div>
        <div class="tx-d">${when(t.ts)}${t.meta && t.meta.note ? ' · ' + esc(t.meta.note) : ''}</div>
      </div>
      <div class="tx-a ${t.amount >= 0 ? 'pos' : 'neg'}">${signed(t.amount)}</div>`;
    row.onclick = () => modal('Операция', b => {
      b.innerHTML = `
        <div class="kv"><span>Описание</span><b>${esc(t.title)}</b></div>
        <div class="kv"><span>Сумма</span><b class="${t.amount >= 0 ? 'pos' : 'neg'}">${signed(t.amount)}</b></div>
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
      b.appendChild(c);
      b.appendChild(el('div', 'card', `
        <div class="kv"><span>Номер карты</span><b class="mono">${cardMask(u.card_number)}</b></div>
        <div class="kv"><span>Держатель</span><b>${esc(u.card_holder)}</b></div>
        <div class="kv"><span>Срок действия</span><b>${esc(u.card_exp)}</b></div>
        <div class="kv"><span>CVV</span><b class="mono">${esc(u.card_cvv)}</b></div>
        <div class="kv"><span>Счёт</span><b class="mono">${esc(u.account_number)}</b></div>
        <div class="kv"><span>Платёжная система</span><b>Чекунец Pay</b></div>
        <div class="kv"><span>Валюта счёта</span><b>чекурубль ₡</b></div>`));
      const copy = el('button', 'btn full', 'Скопировать номер карты');
      copy.onclick = () => {
        navigator.clipboard?.writeText(u.card_number).then(() => ok('Номер скопирован'), () => bad('Не удалось скопировать'));
      };
      b.appendChild(copy);
    });
  }

  /* ---------------- ПЕРЕВОД ---------------- */

  function transferModal(prefill) {
    modal('Перевод клиенту банка', (b, m) => {
      b.appendChild(el('p', 'muted', 'Введите телефон получателя (+7…), либо номер его карты или счёта.'));
      const f1 = el('label', 'field', '<span>Получатель</span><input id="tr-to" placeholder="+7 (___) ___-__-__"><em class="err"></em>');
      const f2 = el('label', 'field', '<span>Сумма, ₡</span><input id="tr-sum" inputmode="decimal" placeholder="100"><em class="err"></em>');
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
            found.innerHTML = '✅ Получатель: <b>' + esc(r.name) + '</b>';
          } catch (e) { found.textContent = '❌ ' + e.message; }
        }, 400);
      });

      const quick = el('div', 'actions');
      [100, 500, 1000].forEach(s => {
        const q = el('button', 'act', `<span>${s} ₡</span>`);
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
          const row = el('div', 'kv', `<span>${i + 1}. ${esc(r.name)}</span><b>${cur(r.balance)}</b>`);
          c.appendChild(row);
        });
        b.appendChild(c);
      });
    });
  }

  /* ---------------- ИСТОРИЯ ---------------- */

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
      ['all', 'Все'], ['transfer', 'Переводы'], ['game', 'Игры'], ['credit', 'Кредиты'], ['bonus', 'Бонусы']
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
          (active === 'bonus' && t.category === 'bonus');
        return okCat && (!q || t.title.toLowerCase().includes(q));
      });
      if (!rows.length) list.appendChild(el('div', 'empty', 'Ничего не найдено'));
      else rows.forEach(t => list.appendChild(txRow(t)));
    };
    v.appendChild(list);
    search.querySelector('input').addEventListener('input', draw);
    draw();
  }

  /* ---------------- ИГРЫ ---------------- */

  const GAMES = [
    { id: 'clicker', ico: '👆', name: 'Смена в банке', desc: 'Кликай 10 секунд — получай чекурубли. Без ставки.', risky: false, run: gameClicker },
    { id: 'quiz', ico: '🧠', name: 'Викторина', desc: '5 вопросов о деньгах. По 15 ₡ за верный ответ.', risky: false, run: gameQuiz },
    { id: 'coin', ico: '🪙', name: 'Орёл или решка', desc: 'Ставка ×1.95 при угадывании.', risky: true, run: gameCoin },
    { id: 'dice', ico: '🎲', name: 'Кости против банка', desc: 'Твои 2 кубика против банка. Больше — ×2.', risky: true, run: gameDice },
    { id: 'wheel', ico: '🎡', name: 'Колесо фортуны', desc: 'Сектора от ×0 до ×10.', risky: true, run: gameWheel },
    { id: 'crash', ico: '🚀', name: 'Краш', desc: 'Множитель растёт — успей забрать до взрыва.', risky: true, run: gameCrash }
  ];

  const COOLDOWN = { clicker: 120e3, quiz: 300e3 };

  function cooldownLeft(id) {
    if (!COOLDOWN[id]) return 0;
    const last = +localStorage.getItem('cb_cd_' + id + '_' + S.user.id) || 0;
    return Math.max(0, last + COOLDOWN[id] - Date.now());
  }
  function markPlayed(id) { localStorage.setItem('cb_cd_' + id + '_' + S.user.id, Date.now()); }

  function viewGames(v) {
    const balCard = el('div', 'card');
    balCard.innerHTML = `<div class="balance"><div class="sub">Доступно для игры</div>
      <div class="amount">${hidden() ? '••••' : money(S.user.balance)} <small>₡</small></div></div>`;
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
      `<i>${g.ico}</i><b>${g.name}</b><span>${esc(g.desc)}</span>` +
      (cd ? `<span class="muted">⏳ через ${Math.ceil(cd / 6e4)} мин.</span>` : ''));
    t.onclick = () => {
      if (cooldownLeft(g.id)) return bad('Игра будет доступна через ' + Math.ceil(cooldownLeft(g.id) / 6e4) + ' мин.');
      g.run();
    };
    return t;
  }

  /** Записать результат игры на счёт. */
  function settle(game, stake, payout, title) {
    return guard(async () => {
      await S.api.game(S.token, { game, stake, payout, title });
      await refresh();
      if (S.tab === 'games') render();
    });
  }

  function stakeField(b, max) {
    const f = el('label', 'field', '<span>Ставка, ₡</span><input inputmode="decimal" value="50"><em class="err"></em>');
    b.appendChild(f);
    const row = el('div', 'actions');
    [50, 100, 500].forEach(s => {
      const q = el('button', 'act', `<span>${s} ₡</span>`);
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

  /* --- Кликер --- */
  function gameClicker() {
    modal('Смена в банке', (b, m) => {
      let clicks = 0, running = false, t = 10;
      const info = el('div', 'game-stage', `<div class="big-num">0</div><div class="muted">осталось 10 сек.</div>`);
      const btn = el('button', 'clicker', '💰');
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

  /* --- Викторина --- */
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

  /* --- Монетка --- */
  function gameCoin() {
    modal('Орёл или решка', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', '<div class="big-num">🪙</div><div class="muted">Выберите сторону</div>');
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
          const spin = setInterval(() => { face.textContent = (n++ % 2) ? '🪙' : '🌕'; }, 90);
          setTimeout(() => {
            clearInterval(spin);
            const win = res === side;
            face.textContent = res === 0 ? '🦅' : '🪙';
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

  /* --- Кости --- */
  const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  function gameDice() {
    modal('Кости против банка', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', `
        <div class="dice" id="d-me">🎲🎲</div><div class="muted">вы</div>
        <div class="dice" id="d-bank">🎲🎲</div><div class="muted">банк</div>
        <div id="d-res" class="muted">Победа — ×2, ничья — возврат ставки</div>`);
      b.appendChild(stage);
      const go = el('button', 'btn primary full', 'Бросить кости');
      go.onclick = () => {
        let stake;
        try { stake = getStake(); } catch (e) { return bad(e.message); }
        go.disabled = true;
        const roll = () => [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
        const anim = setInterval(() => {
          stage.querySelector('#d-me').textContent = roll().map(x => DICE[x - 1]).join('');
          stage.querySelector('#d-bank').textContent = roll().map(x => DICE[x - 1]).join('');
        }, 90);
        setTimeout(() => {
          clearInterval(anim);
          const me = roll(), bank = roll();
          const ms = me[0] + me[1], bs = bank[0] + bank[1];
          stage.querySelector('#d-me').textContent = me.map(x => DICE[x - 1]).join('');
          stage.querySelector('#d-bank').textContent = bank.map(x => DICE[x - 1]).join('');
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

  /* --- Колесо фортуны --- */
  const SECTORS = [
    { m: 0, w: 26, color: '#ff5470' }, { m: 0.5, w: 20, color: '#8e95b5' },
    { m: 1.5, w: 22, color: '#7c5cff' }, { m: 2, w: 18, color: '#22d07a' },
    { m: 3, w: 9, color: '#00e0a4' }, { m: 5, w: 4, color: '#ffb020' },
    { m: 10, w: 1, color: '#ff8ad4' }
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
      stage.append(el('div', 'big-num', '▼'), wheel, label);
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

  /* --- Краш --- */
  function gameCrash() {
    modal('Краш 🚀', (b, m) => {
      const getStake = stakeField(b);
      const stage = el('div', 'game-stage', '<div class="big-num mult">1.00×</div><div class="muted">Заберите до взрыва</div>');
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
          setTimeout(() => { m.close(); good ? ok('Забрано ' + cur(payout)) : bad('Взрыв на ×' + mult.toFixed(2)); }, 900);
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
            num.textContent = '💥 ' + crashAt.toFixed(2) + '×';
            mult = crashAt;
            finish(0, 'Взрыв на ×' + crashAt.toFixed(2), false);
          }
        }, 110);
      };
      take.onclick = () => finish(Math.round(stake * mult * 100) / 100, 'Забрано на ×' + mult.toFixed(2), true);
    }, { sticky: true });
  }

  /* ---------------- КРЕДИТЫ ---------------- */

  function viewCredits(v) {
    const active = S.credits.filter(c => c.status === 'active');
    const debt = active.reduce((s, c) => s + (c.total - c.paid), 0);

    const head = el('div', 'card');
    head.innerHTML = `<div class="balance">
      <div class="sub">Текущая задолженность</div>
      <div class="amount ${debt ? 'neg' : ''}">${money(debt)} <small>₡</small></div>
      <div class="sub">${active.length ? 'Активных кредитов: ' + active.length : 'Кредитов нет — можно взять'}</div></div>`;
    v.appendChild(head);

    const take = el('button', 'btn primary full', '💳 Взять кредит');
    take.onclick = creditModal;
    v.appendChild(take);

    v.appendChild(el('div', 'card', `
      <div class="kv"><span>Сумма</span><b>от 100 до 50 000 ₡</b></div>
      <div class="kv"><span>Ставка</span><b>${C.CREDIT_PLANS.map(p => p.rate + '% / ' + p.label).join(' · ')}</b></div>
      <div class="kv"><span>Максимум кредитов</span><b>3 активных</b></div>
      <div class="kv"><span>Просрочка</span><b class="neg">списание долга + штраф ${C.PENALTY_RATE}%</b></div>
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
      }
      v.appendChild(box);
    });
  }

  function creditModal() {
    modal('Кредит в Чекунец Банке', (b, m) => {
      const f = el('label', 'field', '<span>Сумма, ₡</span><input inputmode="decimal" value="1000"><em class="err"></em>');
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
      const f = el('label', 'field', `<span>Сумма платежа, ₡</span><input inputmode="decimal" value="${rest}"><em class="err"></em>`);
      b.appendChild(f);
      const all = el('button', 'btn full', 'Погасить полностью — ' + cur(rest));
      all.onclick = () => { f.querySelector('input').value = rest; pay(); };
      const go = el('button', 'btn primary full', 'Внести платёж');
      const pay = () => guard(async () => {
        const sum = Number(String(f.querySelector('input').value).replace(',', '.'));
        const r = await S.api.creditPay(S.token, c.id, sum);
        m.close(); await refresh(); render();
        ok(r.credit.status === 'closed' ? 'Кредит полностью погашен 🎉' : 'Платёж принят: ' + cur(sum));
      });
      go.onclick = pay;
      b.append(all, go);
    });
  }

  /* ---------------- НАСТРОЙКИ ---------------- */

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
    const pinBtn = el('button', 'btn full', '🔑 Сменить PIN-код');
    pinBtn.onclick = pinModal;
    const srv = el('button', 'btn full ghost', '⚙︎ Сервер банка (' + (S.api.mode === 'online' ? 'онлайн' : 'демо') + ')');
    srv.onclick = serverModal;
    const exp = el('button', 'btn full ghost', '⬇️ Выгрузить мои данные (JSON)');
    exp.onclick = exportData;
    sec.append(pinBtn, srv, exp);
    v.appendChild(sec);

    const danger = el('div', 'card');
    danger.appendChild(el('div', 'sec-title', 'Опасная зона'));
    const out = el('button', 'btn full', '🚪 Выйти из аккаунта');
    out.onclick = () => confirmBox('Выход', 'Выйти из личного кабинета на этом устройстве?', logout);
    const del = el('button', 'btn full danger', '🗑 Удалить счёт навсегда');
    del.onclick = () => confirmBox('Удаление счёта',
      'Счёт, карта, история и кредиты будут удалены безвозвратно. Продолжить?',
      () => guard(async () => { await S.api.remove(S.token); logout(); }), true);
    danger.append(out, del);
    v.appendChild(danger);

    v.appendChild(el('div', 'empty', 'Чекунец Банк · версия 1.0 · валюта: чекурубль ₡' +
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

  /** Вернуть экран входа в исходное состояние (вкладка «Вход»). */
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

  /* ---------------- ПРОФИЛЬ ---------------- */

  function viewProfile(v) {
    const u = S.user;
    const head = el('div', 'card');
    head.innerHTML = `
      <div style="display:grid;justify-items:center;gap:8px;padding:6px 0">
        <div class="avatar" style="width:72px;height:72px;border-radius:24px;font-size:26px">${esc((u.first_name[0] + u.last_name[0]).toUpperCase())}</div>
        <b style="font-size:19px">${esc(u.first_name + ' ' + u.last_name)}</b>
        <span class="muted">${esc(u.card_holder)}</span>
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
      <div class="kv"><span>Почта</span><b>${esc(u.email)}</b></div>`));

    v.appendChild(el('div', 'sec-title', 'Счёт и карта'));
    const cardBox = el('div', 'card', `
      <div class="kv"><span>Номер карты</span><b class="mono">${cardShort(u.card_number)}</b></div>
      <div class="kv"><span>Срок действия</span><b>${esc(u.card_exp)}</b></div>
      <div class="kv"><span>Номер счёта</span><b class="mono">${esc(u.account_number)}</b></div>
      <div class="kv"><span>Валюта</span><b>чекурубль ₡</b></div>
      <div class="kv"><span>Баланс</span><b>${cur(u.balance)}</b></div>`);
    const openCard = el('button', 'btn full mini', 'Показать карту полностью');
    openCard.style.marginTop = '10px';
    openCard.onclick = cardModal;
    cardBox.appendChild(openCard);
    v.appendChild(cardBox);

    const edit = el('button', 'btn primary full', '✏️ Изменить контакты');
    edit.onclick = editProfile;
    v.appendChild(edit);

    const share = el('button', 'btn full', '📨 Мои реквизиты для перевода');
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

  document.addEventListener('DOMContentLoaded', boot);
})();
