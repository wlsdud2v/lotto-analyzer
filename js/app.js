/**
 * 화면 로직: 상태 관리, 렌더링, 이벤트.
 */
(() => {
  const E = LottoEngine;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  const state = {
    allDraws: [],
    source: '',
    range: 0,            // 0 = 전체
    recentN: 20,
    trendN: 30,          // 패턴 추세 그래프 기간
    stats: null,
    pastKeys: new Set(),
    pref: new Map(),     // n -> 'fix' | 'exc'
    strategy: 'balanced',
    prob: null,          // 번호별 추천 확률 (index 1..45)
    sumTouched: false,
    results: [],
    checkSel: [],
    sort: { key: 'n', asc: true },
    app: 'lotto',
    tc: { loading: false, data: null, period: 0, histN: 15, list: [] },
    pr: { sort: { key: 'no', asc: false }, n: 20 },
    official: null,
    fortune: { saju: null, list: [] },
    tarot: { spread: 3, deck: [], picks: [], reading: null, results: [], revealing: false },
    machine: { m: null, history: [], drawn: [] },
    sp: { game: 'SP2000', ticket: null, session: { n: 0, cost: 0, prize: 0 }, bulkN: 100, statusLoaded: false, status: null, mode: 'base', round: null },
  };

  const MAX_FIX = 5;
  const SAVE_KEY = 'lotto.saved.v1';


  // ───────────────────────── 유틸 ─────────────────────────

  const dec = n => (n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5);
  const ball = (n, cls = '') => `<span class="ball d${dec(n)} ${cls}">${n}</span>`;
  const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
  const fmt = n => n.toLocaleString('ko-KR');
  const ic = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const STRAT_ICON = { balanced: 'scale', hot: 'flame', cold: 'snow', random: 'dice' };

  function addDays(dateStr, days) {
    const [y, m, dd] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, dd + days));
    return d.toISOString().slice(0, 10);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; } catch (e) { return []; }
  }

  function storeSaved(list) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)); } catch (e) { /* 저장소 사용 불가 */ }
  }

  const scopeDraws = () => (state.range ? state.allDraws.slice(-state.range) : state.allDraws);
  const fixedNums = () => [...state.pref].filter(([, v]) => v === 'fix').map(([n]) => n).sort((a, b) => a - b);
  const excludedNums = () => [...state.pref].filter(([, v]) => v === 'exc').map(([n]) => n).sort((a, b) => a - b);


  function readFilters() {
    let min = +$('#fSumMin').value || 21, max = +$('#fSumMax').value || 255;
    if (min > max) [min, max] = [max, min];
    return {
      sum: $('#fSum').checked, sumMin: min, sumMax: max,
      oddEven: $('#fOddEven').checked,
      highLow: $('#fHighLow').checked,
      noRun: $('#fRun').checked,
      spread: $('#fSpread').checked,
    };
  }


  function currentOpts() {
    return { strategy: state.strategy, fixed: fixedNums(), excluded: excludedNums(), companion: $('#companion').checked };
  }


  // ───────────────────────── 데이터 반영 ─────────────────────────

  function setData({ draws, source }) {
    state.allDraws = draws;
    state.source = source;
    state.pastKeys = new Set(draws.map(d => d.nums.join(',')));
    state.results = [];
    renderHeader();
    refreshStats();
    renderResults();
    renderSaved();
    renderCheck();
    renderJackpot();
    renderPrizeTab();
    if (state.tc.data && state.tc.data.next_round < draws[draws.length - 1].no + 1) state.tc.data = null;
    if (typeof state.app !== 'undefined') onViewChanged();
  }


  function renderHeader() {
    const all = state.allDraws;
    const first = all[0], last = all[all.length - 1];
    $('#dataInfo').textContent = `${first.no}회 ~ ${last.no}회 (${fmt(all.length)}회차) · ${state.source}`;
    $('#latest').innerHTML = `
      <div class="lt-head"><h2>${last.no}회 당첨 번호</h2><span>${last.date}</span></div>
      <div class="balls">${last.nums.map(n => ball(n)).join('')}<span class="plus">+</span>${ball(last.bonus)}</div>
      <span class="bonus-lbl">+ 보너스</span>`;
  }


  function refreshStats() {
    const draws = scopeDraws();
    state.stats = E.computeStats(draws, state.recentN);
    const s = state.stats;
    $('#rangeHint').textContent = `지금 분석: ${draws[0].no}회 ~ ${draws[draws.length - 1].no}회 (${fmt(draws.length)}회차)`;
    const rs = $('#rangeSel'), rc = $('#recentSel');
    const label = `${rs.options[rs.selectedIndex].text}`;
    $$('.range-label').forEach(el => { el.textContent = label; });
    rc.title = rc.options[rc.selectedIndex].text;

    // 합계 필터 기본값 = 분석 범위 내 당첨번호 합계의 하위 10% ~ 상위 10%
    if (!state.sumTouched) {
      $('#fSumMin').value = s.sumP10;
      $('#fSumMax').value = s.sumP90;
    }
    renderStatsTab();
    scheduleProb();
  }


  // ───────────────────────── 추천 확률 ─────────────────────────

  function computeProb() {
    const opts = currentOpts();
    const w = E.buildWeights(state.stats, opts);
    state.prob = E.inclusionProbability(w, opts.fixed, readFilters(), state.pastKeys);
    renderTopProb();
    renderStatsTable();
  }

  const scheduleProb = debounce(computeProb, 120);


  function renderTopProb() {
    const p = state.prob;
    const fixed = new Set(fixedNums());
    const list = [];
    for (let n = 1; n <= 45; n++) if (!fixed.has(n)) list.push({ n, p: p[n] });
    list.sort((a, b) => b.p - a.p);
    const max = list[0] ? list[0].p : 1;
    const free = 45 - fixed.size - excludedNums().length;
    const base = (6 - fixed.size) / free;
    const fixedNote = `<p class="hint" style="grid-column:1/-1">추천 생성기가 그 번호를 고를 확률 · 무작위 기준 ${pct(base, 1)}${fixed.size ? ` · 넣을 번호 ${[...fixed].join(', ')} 제외` : ''}</p>`;
    $('#topProb').innerHTML = fixedNote + list.slice(0, 10).map(x => `
      <div class="tp">${ball(x.n, 'sm')}<div class="bar"><i style="width:${(x.p / max) * 100}%"></i></div><span class="v">${pct(x.p)}</span></div>`).join('');
  }


  // ───────────────────────── 선호 번호 ─────────────────────────

  function buildPicker(el, onClick) {
    el.innerHTML = Array.from({ length: 45 }, (_, i) => `<button class="pick" data-n="${i + 1}">${i + 1}</button>`).join('');
    el.addEventListener('click', e => {
      const b = e.target.closest('.pick');
      if (b) onClick(+b.dataset.n);
    });
  }


  function onPrefClick(n) {
    const cur = state.pref.get(n);
    if (!cur) {
      if (fixedNums().length >= MAX_FIX) { toast(`넣을 번호는 ${MAX_FIX}개까지예요. ${n}번은 빼기로 바꿨어요.`); state.pref.set(n, 'exc'); }
      else state.pref.set(n, 'fix');
    } else if (cur === 'fix') state.pref.set(n, 'exc');
    else state.pref.delete(n);

    if (45 - excludedNums().length - fixedNums().length < 6 - fixedNums().length) {
      state.pref.delete(n);
      toast('뺄 번호가 너무 많아 6개를 채울 수 없어요.');
    }
    renderPref();
    scheduleProb();
  }


  function renderPref() {
    $$('#prefPicker .pick').forEach(b => {
      const v = state.pref.get(+b.dataset.n);
      b.className = 'pick' + (v ? ' ' + v : '');
    });
    const f = fixedNums(), x = excludedNums();
    $('#prefSummary').innerHTML = (!f.length && !x.length)
      ? ''
      : `${f.length ? `<span class="ptag"><i class="pick-dot fix"></i>${f.join(', ')}</span>` : ''}
         ${x.length ? `<span class="ptag"><i class="pick-dot exc"></i>${x.join(', ')}</span>` : ''}
         <button class="btn ghost sm" id="prefClear">${ic('refresh')}지우기</button>`;
    const badge = [f.length ? `넣기 ${f.length}` : '', x.length ? `빼기 ${x.length}` : ''].filter(Boolean).join(' · ');
    $('#prefBadge').textContent = badge;
    const clr = $('#prefClear');
    if (clr) clr.onclick = () => { state.pref.clear(); renderPref(); scheduleProb(); };
  }


  function renderStrategies() {
    $('#strategies').innerHTML = Object.entries(E.STRATEGIES).map(([k, v]) =>
      `<button class="strat ${k === state.strategy ? 'active' : ''}" data-k="${k}" aria-pressed="${k === state.strategy}">${ic(STRAT_ICON[k] || 'spark')}${v.label}</button>`).join('');
    $('#info-strategy').innerHTML = '<dl class="strat-info">' + Object.entries(E.STRATEGIES).map(([k, v]) =>
      `<dt>${ic(STRAT_ICON[k] || 'spark')}${v.label}</dt><dd>${v.desc}</dd>`).join('') + '</dl>';
  }


  // ───────────────────────── 추천 생성 ─────────────────────────

  function generate() {
    const opts = currentOpts();
    const filters = readFilters();
    const count = Math.max(1, Math.min(10, +$('#setCount').value || 5));
    $('#setCount').value = count;

    const weekly = $('#weekly').checked;
    const nextNo = state.allDraws[state.allDraws.length - 1].no + 1;
    let seed;
    if (weekly) {
      seed = E.hashString([nextNo, state.range, state.recentN, opts.strategy, opts.fixed, opts.excluded, opts.companion, JSON.stringify(filters), count].join('|'));
    } else {
      const a = new Uint32Array(1);
      (window.crypto || window.msCrypto).getRandomValues(a);
      seed = a[0];
    }
    const rng = E.mulberry32(seed);
    const w = E.buildWeights(state.stats, opts);
    const sets = E.generate(count, w, opts.fixed, filters, state.pastKeys, rng);

    state.results = sets.map(r => ({ nums: r.set, relaxed: r.relaxed, fixed: opts.fixed, strategy: opts.strategy }));
    const label = E.STRATEGIES[opts.strategy].label;
    $('#genInfo').textContent = `${nextNo}회 · ${label}`;
    renderResults();
  }


  function setMeta(nums) {
    const d = E.describe(nums);
    const bt = E.backtest(nums, state.allDraws);
    const r = bt.ranks;
    const parts = [];
    for (let k = 1; k <= 5; k++) if (r[k]) parts.push(`${k}등 ${r[k]}회`);
    const hist = parts.length ? `<span class="hit">과거 대입 ${parts.join(' · ')}</span>` : '<span>과거 대입 당첨 없음</span>';
    return `<span>합계 <b>${d.sum}</b></span><span>홀:짝 <b>${d.odd}:${d.even}</b></span><span>저:고 <b>${d.low}:${d.high}</b></span><span>${hist}</span>`;
  }


  function setRow(item, i, actions) {
    const fixed = new Set(item.fixed || []);
    return `
      <div class="set">
        <div class="set-main">
          <span class="idx">${String.fromCharCode(65 + i)}</span>
          <div class="balls">${item.nums.map(n => ball(n, fixed.has(n) ? 'fixed' : '')).join('')}</div>
        </div>
        <div class="acts">${actions}<button class="act icon-only" data-act="meta" aria-label="자세히" aria-expanded="false">${ic('dots')}</button></div>
        <div class="meta">${setMeta(item.nums)}${item.relaxed ? '<span class="warn">조건을 모두 만족하는 조합이 없어 일부 조건을 완화했어요</span>' : ''}${item.bonus ? `<span>보너스 <b>${item.bonus}</b></span><span>나온 순서 ${item.order.join(' → ')}</span>` : ''}${item.at ? `<span>${item.at} 저장</span>` : ''}</div>
      </div>`;
  }


  function setActions(i) {
    const share = window.AndroidBridge ? `<button class="act" data-act="share" data-i="${i}">${ic('share')}공유</button>` : '';
    return `<button class="act" data-act="copy" data-i="${i}">${ic('copy')}복사</button>${share}<button class="act" data-act="save" data-i="${i}">${ic('star')}저장</button>`;
  }


  function renderResults() {
    const el = $('#results');
    if (!state.results.length) { el.innerHTML = `<p class="empty">${ic('spark')}위의 <b>번호 받기</b>를 누르세요</p>`; return; }
    el.innerHTML = state.results.map((r, i) => setRow(r, i, setActions(i))).join('');
  }


  // ───────────────────────── 프로그램 전환 ─────────────────────────

  const APP_TITLES = { lotto: '로또 번호 분석기', speetto: '스피또', fortune: '운세' };
  const APP_IDS = Object.keys(APP_TITLES);
  const appFromHash = () => { const h = location.hash.replace('#', ''); return APP_IDS.includes(h) && h !== 'lotto' ? h : null; };


  function setApp(id, user) {
    state.app = id;
    $$('.app-btn').forEach(b => {
      const on = b.dataset.app === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.app').forEach(a => a.classList.toggle('active', a.id === 'app-' + id));
    document.body.dataset.app = id;
    $$('[data-for]').forEach(el => { el.hidden = el.dataset.for !== id; });
    $('#appTitle').textContent = APP_TITLES[id];
    document.title = APP_TITLES[id];
    if (user) {
      try { localStorage.setItem('lotto.app', id); } catch (e) { /* 무시 */ }
      try { history.replaceState(null, '', id === 'lotto' ? location.pathname + location.search : '#' + id); } catch (e) { /* 무시 */ }
      window.scrollTo({ top: 0 });
    }
    onViewChanged();
  }


  /** 프로그램(lotto/speetto/fortune) 안에서 지금 보이는 화면 id */
  function activeTab(appId) {
    const p = document.querySelector(`#app-${appId} .panel.active`);
    return p ? p.id.replace(/^tab-/, '') : null;
  }


  /** 프로그램 안 화면 전환 */
  function showTab(app, id) {
    if (!app.querySelector('#tab-' + id)) return;
    app.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === id));
    app.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + id));
    onViewChanged();
    try { localStorage.setItem('lotto.tab.' + app.id, id); } catch (e) { /* 무시 */ }
  }


  /** 보이는 화면이 바뀔 때: 추첨기 애니메이션, 스피또 데이터·긁기 판 */
  function onViewChanged() {
    const lottoTab = activeTab('lotto');
    if (state.machine.m) state.machine.m.setVisible(state.app === 'lotto' && lottoTab === 'machine');
    if (state.app === 'speetto') onSpeettoShown();
    if (state.app === 'lotto' && (lottoTab === 'teachers' || lottoTab === 'recommend')) onTeachersShown();
    if (state.app === 'fortune') renderToday();
  }


  // ───────────────────────── 운세 · 사주팔자 ─────────────────────────

  const SJ = () => LottoSaju;
  const SAJU_KEY = 'lotto.saju.v1';


  function initFortune() {
    if (typeof LottoSaju === 'undefined') return;
    $('#sjCity').innerHTML = SJ().CITIES.map(c => `<option value="${c.id}">${c.name}${c.lon != null ? ` (동경 ${c.lon}°)` : ''}</option>`).join('');
    $('#sjDate').max = new Date().toISOString().slice(0, 10);
    $('#sjGender').addEventListener('click', e => {
      const b = e.target.closest('button[data-g]');
      if (!b) return;
      $$('#sjGender button').forEach(x => x.classList.toggle('active', x === b));
    });
    $('#sjTimeUnknown').addEventListener('change', e => { $('#sjTime').disabled = e.target.checked; });
    $('#sjForm').addEventListener('submit', e => {
      e.preventDefault();
      const input = readSajuForm();
      if (!input) { toast('생년월일을 입력해 주세요.'); return; }
      try {
        if ($('#sjRemember').checked) localStorage.setItem(SAJU_KEY, JSON.stringify(input));
        else localStorage.removeItem(SAJU_KEY);
      } catch (err) { /* 저장 불가 — 이번에만 사용 */ }
      runSaju(input, true);
    });
    $('#todayResult').addEventListener('click', e => {
      const go = e.target.closest('[data-goto-saju]');
      if (go) { document.querySelector('#app-fortune .tab[data-tab="saju"]').click(); return; }
    });
    // 기억해 둔 정보 복원
    try {
      const saved = JSON.parse(localStorage.getItem(SAJU_KEY));
      if (saved && saved.y) { fillSajuForm(saved); runSaju(saved, false); }
    } catch (err) { /* 없음 */ }
  }


  function readSajuForm() {
    const date = $('#sjDate').value;
    if (!date) return null;
    const [y, m, d] = date.split('-').map(Number);
    const unknown = $('#sjTimeUnknown').checked;
    const [h, mi] = ($('#sjTime').value || '12:00').split(':').map(Number);
    return {
      gender: $('#sjGender button.active').dataset.g, y, m, d,
      h: unknown ? 12 : h, mi: unknown ? 0 : mi, timeUnknown: unknown,
      city: $('#sjCity').value, zasi: $('#sjZasi').value,
    };
  }


  function fillSajuForm(i) {
    $$('#sjGender button').forEach(x => x.classList.toggle('active', x.dataset.g === i.gender));
    $('#sjDate').value = `${i.y}-${String(i.m).padStart(2, '0')}-${String(i.d).padStart(2, '0')}`;
    $('#sjTime').value = `${String(i.h).padStart(2, '0')}:${String(i.mi).padStart(2, '0')}`;
    $('#sjTimeUnknown').checked = !!i.timeUnknown;
    $('#sjTime').disabled = !!i.timeUnknown;
    $('#sjCity').value = i.city || 'seoul';
    $('#sjZasi').value = i.zasi || 'early';
  }


  function runSaju(input, scroll) {
    const r = SJ().compute(input);
    state.fortune.saju = r;
    renderSaju(r);
    renderToday();
    if (scroll) $('#sjResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }


  const gzH = p => SJ().STEMS_H[p.s] + SJ().BRANCHES_H[p.b];
  const gzK = p => SJ().STEMS[p.s] + SJ().BRANCHES[p.b];


  function renderSaju(r) {
    const S = SJ();
    const P = r.pillars, dm = r.dayMaster;
    const i = r.input;
    const pad = n => String(n).padStart(2, '0');
    const tzNote = r.offsetMin !== 540 ? ` · 당시 표준시 UTC+${Math.floor(r.offsetMin / 60)}${r.offsetMin % 60 ? ':' + pad(r.offsetMin % 60) : ''}${r.offsetMin >= 600 || r.offsetMin === 570 ? ' (서머타임)' : ''}` : '';
    const corrected = i.timeUnknown ? '' : r.city.lon != null ? ` → ${r.city.name} 태양시 ${pad(r.local.h)}:${pad(r.local.mi)}` : '';
    const age = new Date().getFullYear() - i.y + 1;

    const col = (key, label) => {
      const p = P[key];
      if (!p) {
        return `<div class="sj-col"><div class="ph">${label}</div><div class="god">&nbsp;</div>
          <div class="sj-ch empty"><div class="h">?</div><div class="k">시간 모름</div></div>
          <div class="sj-ch empty"><div class="h">?</div><div class="k">&nbsp;</div></div><div class="god">&nbsp;</div></div>`;
      }
      const se = S.STEM_EL[p.s], be = S.BRANCH_EL[p.b];
      const me = key === 'day';
      return `<div class="sj-col"><div class="ph">${label}</div>
        <div class="god ${me ? 'me' : ''}">${me ? '나 (일간)' : S.tenGod(dm, p.s)}</div>
        <div class="sj-ch el-${se} ${me ? 'me' : ''}"><div class="h">${S.STEMS_H[p.s]}</div><div class="k">${S.STEMS[p.s]} · ${S.ELEMENTS[se]}</div></div>
        <div class="sj-ch el-${be}"><div class="h">${S.BRANCHES_H[p.b]}</div><div class="k">${S.BRANCHES[p.b]} · ${S.ELEMENTS[be]}</div></div>
        <div class="god">${S.tenGod(dm, S.BRANCH_MAIN_STEM[p.b])}${key === 'hour' ? `<div class="sj-time">${S.HOUR_RANGES[p.b]}</div>` : ''}</div></div>`;
    };

    const total = r.counts.reduce((a, b) => a + b, 0);
    const elRows = r.counts.map((c, e) => `<div class="row el-${e}"><b>${S.ELEMENTS[e]} ${S.ELEMENTS_H[e]}</b>
      <div class="bar"><i style="width:${total ? c / total * 100 : 0}%"></i></div><span class="n">${c}개</span></div>`).join('');
    const missing = r.counts.map((c, e) => (c ? null : S.ELEMENTS[e])).filter(Boolean);

    const dmEl = S.STEM_EL[dm];
    const lk = S.ELEMENT_LUCK[r.lucky];

    // 원국에 나온 십신
    const gods = new Set();
    for (const [k, p] of Object.entries(P)) {
      if (!p) continue;
      if (k !== 'day') gods.add(S.tenGod(dm, p.s));
      gods.add(S.tenGod(dm, S.BRANCH_MAIN_STEM[p.b]));
    }

    const dwNow = r.daewoon.list.findIndex((d, k, arr) => age >= d.age && (k === arr.length - 1 || age < arr[k + 1].age));

    $('#sjResult').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>사주팔자 원국</h2><span class="hint">${r.sajuYear}년 ${r.animal}띠 · ${gzK(P.year)}년 ${gzK(P.month)}월 ${gzK(P.day)}일${P.hour ? ' ' + gzK(P.hour) + '시' : ''}</span></div>
        <p class="sj-meta">양력 <b>${i.y}년 ${i.m}월 ${i.d}일 ${i.timeUnknown ? '(시간 모름)' : pad(i.h) + ':' + pad(i.mi)}</b> · ${i.gender === 'M' ? '남자' : '여자'}${tzNote}${corrected}${!i.timeUnknown && i.zasi === 'late' ? ' · 야자시 적용' : ''}</p>
        <div class="sj-table">${col('hour', '시주')}${col('day', '일주')}${col('month', '월주')}${col('year', '년주')}</div>
      </div>

      <div class="sj-grid2">
        <div class="card sj-dm el-${dmEl}">
          <h2>나의 일간</h2>
          <h3><span class="h">${S.STEMS_H[dm]}${S.ELEMENTS_H[dmEl]}</span> ${S.STEMS[dm]}${S.ELEMENTS[dmEl]}</h3>
          <p>${S.DAY_MASTER_TEXT[dm]}</p>
          <div><span class="sj-tag">${r.strong ? '신강 — 기운이 강한 편' : '신약 — 기운이 약한 편'}</span><span class="sj-tag">${r.animal}띠</span></div>
          <div class="sj-lucky el-${r.lucky}">
            <div><span>행운의 오행</span><b>${S.ELEMENTS[r.lucky]}(${S.ELEMENTS_H[r.lucky]})</b></div>
            <div><span>행운의 색</span>${lk.color}</div>
            <div><span>행운의 숫자</span>${lk.nums}</div>
            <div><span>행운의 방향</span>${lk.dir}</div>
            <div style="grid-column:1/-1"><span>도움 되는 습관</span>${lk.tip}</div>
          </div>
        </div>
        <div class="card">
          <h2>오행 분포</h2>
          <div class="sj-el">${elRows}</div>
          <p class="note">${missing.length ? `<b>${missing.join('·')}</b> 기운이 없어 보완하면 좋습니다. ` : '다섯 기운이 모두 들어 있습니다. '}${r.strong ? '나를 돕는 기운이 많아 힘을 밖으로 쓰는 것이 좋습니다.' : '나를 돕는 기운이 적어 도움을 받는 것이 좋습니다.'} (간단 판정)</p>
          <h2 style="margin-top:16px">원국의 십신</h2>
          <div class="sj-gods">${[...gods].map(g => `<div><b>${g}</b>${S.TEN_GOD_TEXT[g]}</div>`).join('')}</div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>대운 (10년 운의 흐름)</h2><span class="hint">${r.daewoon.forward ? '순행' : '역행'} · ${r.daewoon.startAge}세 시작 (${r.daewoon.term.name}까지 ${r.daewoon.term.days.toFixed(1)}일 ÷ 3)</span></div>
        <div class="sj-dw">${r.daewoon.list.map((d, k) => `<div class="c ${k === dwNow ? 'now' : ''}">
          <div class="age">${d.age}세~</div><div class="h"><span class="el-${S.STEM_EL[d.s]}" style="color:var(--c)">${S.STEMS_H[d.s]}</span><span class="el-${S.BRANCH_EL[d.b]}" style="color:var(--c)">${S.BRANCHES_H[d.b]}</span></div>
          <div class="g">${S.tenGod(dm, d.s)}</div></div>`).join('')}</div>
        <p class="note">테두리 표시는 올해 나이(${age}세, 세는나이) 기준 현재 대운입니다. 절기 시각은 천문 계산(VSOP87)으로 구해 공식 발표와 1분 안팎으로 맞습니다.</p>
      </div>`;
  }


  function renderToday() {
    const el = $('#todayResult');
    if (!el) return;
    const r = state.fortune.saju;
    if (!r) {
      el.innerHTML = `<div class="card"><p class="empty">먼저 <b>사주팔자</b> 탭에서 생년월일시를 입력해 주세요.<br><br><button class="btn primary" data-goto-saju>사주 입력하러 가기</button></p></div>`;
      return;
    }
    const S = SJ();
    const t = S.daily(r, Date.now());
    const lk = S.ELEMENT_LUCK[r.lucky];
    const stars = '★'.repeat(t.score) + '☆'.repeat(5 - t.score);
    let numsHtml = '';
    state.fortune.list = [];
    if (state.allDraws.length && typeof LottoEngine !== 'undefined') {
      const round = state.allDraws[state.allDraws.length - 1].no + 1;
      const nums = S.luckyNumbers(LottoEngine, r, round);
      state.fortune.list = [{ nums, fixed: [] }];
      numsHtml = `<div class="card" style="margin-top:16px">
        <div class="card-head"><h2>이번 주 사주 행운 번호 — ${round}회</h2><span class="hint">행운의 오행(${S.ELEMENTS[r.lucky]})에 맞는 번호에 가중치 · 이번 주 동안 고정</span></div>
        <div class="set-list">${setRow(state.fortune.list[0], 0, setActions(0))}</div>
        <p class="note">하도(河圖)의 오행 수(수 1·6, 화 2·7, 목 3·8, 금 4·9, 토 5·10)로 끝자리가 행운의 오행에 해당하는 번호를 더 자주 고릅니다. 재미로 즐겨 주세요.</p>
      </div>`;
    }
    el.innerHTML = `<div class="card">
        <div class="card-head"><h2>오늘의 운세</h2><span class="hint">${t.date.y}년 ${t.date.m}월 ${t.date.d}일 · ${S.STEMS[r.dayMaster]}${S.ELEMENTS[S.STEM_EL[r.dayMaster]]} 일간 기준</span></div>
        <div class="td-head">
          <div class="td-day"><span class="el-${S.STEM_EL[t.pillar.s]}" style="color:var(--c)">${S.STEMS_H[t.pillar.s]}</span><span class="el-${S.BRANCH_EL[t.pillar.b]}" style="color:var(--c)">${S.BRANCHES_H[t.pillar.b]}</span></div>
          <div><div class="hint" style="margin:0">오늘 일진 ${gzK(t.pillar)}일 · 나에게 <b>${t.god}</b>의 날</div><div class="td-stars">${stars}</div></div>
        </div>
        <div class="td-total">${t.total}</div>
        <div class="td-items">
          <div><b>재물운</b>${t.money}</div><div><b>대인운</b>${t.people}</div><div><b>건강운</b>${t.health}</div>
        </div>
        ${t.note ? `<div class="td-note">${t.note}</div>` : ''}
        <p class="note">오늘의 행운 — 색: ${lk.color} · 숫자: ${lk.nums} · 방향: ${lk.dir}</p>
      </div>${numsHtml}`;
  }


  // ───────────────────────── 1등 당첨금 ─────────────────────────

  const J = () => LottoJackpot;


  /** 판매 마감 시각: 동행복권 발표값이 있으면 그 시각, 없으면 마지막 회차 + 7일 토요일 20:00 (KST) */
  function nextDrawTime() {
    const o = state.official;
    if (o && o.close_at && o.round === state.allDraws[state.allDraws.length - 1].no + 1) return Date.parse(o.close_at);
    const last = state.allDraws[state.allDraws.length - 1];
    const [y, m, d] = last.date.split('-').map(Number);
    return Date.UTC(y, m - 1, d + 7, 11, 0);      // 20:00 KST = 11:00 UTC
  }


  /** 동행복권 1등 예상 총 당첨금 불러오기 (10분마다 다시) */
  async function refreshOfficial() {
    if (typeof LottoJackpot === 'undefined') return;
    const o = await LottoJackpot.loadOfficial();
    if (o) { state.official = o; if (state.allDraws.length) renderJackpot(); }
  }


  function updateCountdown() {
    const el = $('#jpCount');
    if (!el || !state.allDraws.length) return;
    const ms = nextDrawTime() - Date.now();
    if (ms <= 0) { el.textContent = '판매 마감'; return; }
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, mi = Math.floor(ms / 6e4) % 60;
    el.textContent = `마감 ${d ? d + '일 ' + h + '시간' : h ? h + '시간 ' + mi + '분' : mi + '분'} 전`;
  }


  function renderJackpot() {
    const box = $('#jackpot');
    const e = typeof LottoJackpot !== 'undefined' && J().estimate(state.allDraws);
    if (!e) { box.hidden = true; return; }
    box.hidden = false;
    const last = state.allDraws[state.allDraws.length - 1];
    const o = state.official && state.official.round === e.round ? state.official : null;
    const nd = addDays(last.date, 7).split('-');
    $('#jpRound').textContent = `${e.round}회 · ${+nd[1]}월 ${+nd[2]}일 추첨`;
    $('#jpScen').innerHTML = e.scenarios.map(x => `<div class="${x.winners === e.roundedWinners ? 'on' : ''}">1등 ${x.winners}명이면<b>${J().eok(x.each)}원</b></div>`).join('');
    const finalNote = `마감 예상 = 직전 4회 평균 판매액 ${J().eok(e.sales, 0)}원 × 1등 배분율 ${(e.ratio * 100).toFixed(1)}%${e.carry ? ' + 이월금' : ''}. 최근 1년 1등 당첨자는 회차당 ${e.minW}~${e.maxW}명이었습니다.`;

    if (o) {
      // 동행복권 발표값 그대로
      const asOf = new Date(o.as_of);
      const t = `${asOf.getMonth() + 1}월 ${asOf.getDate()}일 ${String(asOf.getHours()).padStart(2, '0')}:${String(asOf.getMinutes()).padStart(2, '0')}`;
      $('#jpTitle').textContent = '1등 예상 총 당첨금';
      $('#jpPre').textContent = '';
      $('#jpAmount').textContent = o.expected_first_total.toLocaleString('ko-KR');
      $('#jpSub').innerHTML = `동행복권 발표 · ${t} 기준 (누적 판매액 <b>${J().eok(o.accumulated_sales, 0)}원</b>)${o.live ? ' · 실시간' : ''}<br>판매가 이어지는 동안 계속 늘어납니다 · 세전`;
      $('#jpScenTitle').innerHTML = `판매 마감 시 예상 약 <b>${J().eok(e.pool, 0)}원</b> 기준 1인당`;
      $('#jpNote').textContent = finalNote;
    } else {
      // 발표값을 못 받으면 자체 추정
      $('#jpTitle').textContent = '1등 예상 당첨금';
      $('#jpPre').textContent = '1인당 약';
      $('#jpAmount').textContent = J().eok(e.perPerson);
      $('#jpSub').innerHTML = `판매 마감 시 1등 총 당첨금 약 <b>${J().eok(e.pool, 0)}원</b> ÷ 최근 1년 평균 당첨자 <b>${e.roundedWinners}명</b> 기준 · 세전`
        + (e.carry ? ` · <b>이월금 약 ${J().eok(e.carry, 0)}원 포함</b>` : '');
      $('#jpScenTitle').innerHTML = '당첨자 수에 따라 1인당';
      $('#jpNote').textContent = finalNote + ' 동행복권 발표값을 불러오지 못해 자체 추정으로 표시 중입니다.';
    }
    updateCountdown();
  }


  /** 단일 계열 막대 차트 (SVG + 마우스 툴팁) */
  function barChart(el, items, { labelEvery = 1, ariaLabel = '' } = {}) {
    const W = 900, H = 230, L = 46, R = 8, T = 12, B = 26;
    // 깔끔한 눈금 (1·2·2.5·5 × 10^k)
    const top = Math.max(...items.map(x => x.value)) || 1;
    const raw = top / 4, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const tick = [1, 2, 2.5, 5, 10].map(m => m * pow).find(v => v >= raw);
    const ticks = Math.ceil(top / tick);
    const max = tick * ticks;
    const step = (W - L - R) / items.length;
    const bw = Math.max(2, step * 0.72);
    const y = v => T + (H - T - B) * (1 - v / max);
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const v = tick * i;
      grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v ? J().eok(v, 0) : '0'}</text>`;
    }
    const bars = items.map((it, i) => {
      const x = L + i * step + (step - bw) / 2;
      const h = Math.max(0, y(0) - y(it.value));
      const r = Math.min(4, bw / 2, h);
      const yt = y(it.value);
      // 위쪽만 둥근 막대 (바닥에 붙음)
      const path = h > 0 ? `M${x},${y(0)}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${y(0)}Z` : '';
      const lab = i % labelEvery === 0 ? `<text class="ax" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${it.label}</text>` : '';
      return `<path class="bar" d="${path}"/><rect class="hit-area" data-i="${i}" x="${L + i * step}" y="${T}" width="${step}" height="${H - T - B}"/>${lab}`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ariaLabel}">${grid}${bars}</svg><div class="viz-tip"></div>`;
    const tip = el.querySelector('.viz-tip');
    el.querySelector('svg').addEventListener('pointermove', ev => {
      const hit = ev.target.closest('.hit-area');
      el.querySelectorAll('.bar.hover').forEach(b => b.classList.remove('hover'));
      if (!hit) { tip.classList.remove('show'); return; }
      const it = items[+hit.dataset.i];
      hit.previousElementSibling.classList.add('hover');
      const box = el.getBoundingClientRect();
      tip.innerHTML = it.tip;
      tip.style.left = Math.min(Math.max(ev.clientX - box.left, 70), box.width - 70) + 'px';
      tip.style.top = (ev.clientY - box.top) + 'px';
      tip.classList.add('show');
    });
    el.querySelector('svg').addEventListener('pointerleave', () => {
      tip.classList.remove('show');
      el.querySelectorAll('.bar.hover').forEach(b => b.classList.remove('hover'));
    });
  }


  function renderPrizeTab() {
    if (typeof LottoJackpot === 'undefined') return;
    const h = J().history(state.allDraws);
    if (!h) { $('#prKpis').innerHTML = '<p class="empty">이 데이터에는 당첨금 정보가 없습니다.</p>'; return; }
    const E = J().eok;
    $('#prKpis').innerHTML = `
      <div class="kpi"><div class="k">역대 최고 1인 당첨금</div><div class="v">${E(h.max.prize)}원</div><div class="s">${h.max.no}회 (${h.max.date}) · ${h.max.winners}명</div></div>
      <div class="kpi"><div class="k">역대 최저 1인 당첨금</div><div class="v">${E(h.min.prize)}원</div><div class="s">${h.min.no}회 (${h.min.date}) · ${h.min.winners}명</div></div>
      <div class="kpi"><div class="k">최근 52주 평균 1인 당첨금</div><div class="v">${E(h.recentAvg)}원</div><div class="s">회차당 평균 1등 ${h.recentWinners.toFixed(1)}명</div></div>
      <div class="kpi"><div class="k">1등 없이 이월된 회차</div><div class="v">${h.rollovers.length}회</div><div class="s">${h.rollovers.length ? '최근 ' + h.rollovers.slice(-3).map(d => d.no + '회').join(', ') : '-'}</div></div>`;

    barChart($('#prYears'), h.years.map(y => ({
      label: "'" + y.year.slice(2), value: y.avg,
      tip: `<b>${y.year}년</b> 평균 1인 <b>${E(y.avg)}원</b> · 1등 평균 ${y.winners.toFixed(1)}명 · ${y.rounds}회`,
    })), { ariaLabel: '연도별 평균 1등 1인 당첨금' });

    const recent = state.allDraws.slice(-52);
    barChart($('#prRecent'), recent.map(d => ({
      label: String(d.no), value: d.winners ? d.prize : 0,
      tip: d.winners ? `<b>${d.no}회</b> (${d.date}) 1인 <b>${E(d.prize)}원</b> · ${d.winners}명` : `<b>${d.no}회</b> 1등 없음 (이월)`,
    })), { labelEvery: 6, ariaLabel: '최근 52회 1등 1인 당첨금' });

    renderPrizeTable();
  }


  const PR_COLS = [
    { key: 'no', label: '회차' }, { key: 'date', label: '추첨일' }, { key: 'prize', label: '1인 당첨금' },
    { key: 'winners', label: '당첨자' }, { key: 'pool', label: '1등 총액' }, { key: 'sales', label: '총 판매액' },
  ];


  function renderPrizeTable() {
    const rows = state.allDraws.filter(d => d.winners != null).map(d => ({ ...d, pool: d.prize * d.winners }));
    const { key, asc } = state.pr.sort;
    rows.sort((a, b) => (key === 'date' ? a.no - b.no : (a[key] - b[key]) || (a.no - b.no)) * (asc ? 1 : -1));
    const n = Math.min(state.pr.n, rows.length);
    const E = J().eok;
    $('#prTable').innerHTML = `<thead><tr>${PR_COLS.map(c => `<th data-k="${c.key}" class="${c.key === key ? 'sorted' + (asc ? ' asc' : '') : ''}">${c.label}</th>`).join('')}</tr></thead><tbody>` +
      rows.slice(0, n).map(d => `<tr>
        <td>${d.no}회</td><td>${d.date}</td>
        ${d.winners ? `<td title="${fmt(d.prize)}원"><b>${E(d.prize)}원</b></td><td>${d.winners}명</td><td>${E(d.pool, 0)}원</td>` : '<td class="roll">이월</td><td class="roll">0명</td><td class="roll">-</td>'}
        <td>${d.sales ? E(d.sales, 0) + '원' : '-'}</td></tr>`).join('') + '</tbody>';
    $('#prMore').hidden = n >= rows.length;
  }


  // ───────────────────────── 로또 선생 ─────────────────────────

  const TC_MIRROR = 'https://raw.githubusercontent.com/wlsdud2v/lotto-analyzer/main/data/teachers.json';
  const RANK_NAME = ['', '1등', '2등', '3등', '4등', '5등'];


  async function onTeachersShown() {
    const tc = state.tc;
    if (!state.allDraws.length) return;
    const latest = state.allDraws[state.allDraws.length - 1].no;
    if (tc.data && tc.data.next_round >= latest + 1) return;
    if (tc.loading) return;
    tc.loading = true;
    try {
      tc.data = await loadTeacherData();
      renderTeachers();
    } catch (e) {
      $('#tcPickInfo').textContent = '선생 번호를 불러오지 못했어요. 잠시 후 다시 열어 주세요.';
      $('#tcInfo').textContent = '불러오지 못했어요.';
    } finally {
      tc.loading = false;
    }
  }


  /**
   * 저장소의 data/teachers.json 을 읽고, 이 기기가 가진 당첨 데이터가 더 최신이면
   * 빠진 회차만 같은 규칙으로 직접 계산해 채운다 (결과는 저장소 계산과 동일).
   */
  async function loadTeacherData() {
    const T = LottoTeachers;
    let data = null, source = '저장소';
    if (location.protocol.startsWith('http')) {
      try { const r = await fetch('data/teachers.json', { cache: 'no-cache' }); if (r.ok) data = await r.json(); } catch (e) { /* 다음 */ }
    }
    if (!data) {
      try { data = JSON.parse(await LottoUpdater.getText(TC_MIRROR)); } catch (e) { /* 직접 계산 */ }
    }
    const draws = state.allDraws;
    const contiguous = draws.every((d, i) => d.no === i + 1);
    const latest = draws[draws.length - 1].no;
    const next = latest + 1;
    if (!data) {
      if (!contiguous) throw new Error('데이터 없음');
      data = { teachers: T.TEACHERS, picks: {}, fortunes: {} };
      Object.assign(data.picks, T.computeRange(LottoEngine, draws, Math.max(1, next - 52), next));
      source = '이 기기에서 계산 (최근 52주)';
    }
    if (contiguous) {
      for (let r = (data.next_round || 1); r <= next; r++) {
        if (!data.picks[r]) { Object.assign(data.picks, T.computeRange(LottoEngine, draws, r, r)); source = '저장소 + 이 기기에서 최신 회차 계산'; }
      }
    }
    if (!data.fortunes[next]) data.fortunes[next] = T.fortunesFor(LottoEngine, draws, data.picks, next);
    data.next_round = next;
    data.source = source;
    return data;
  }


  /** 선생별 성적 (periodWeeks 0 = 전체) */
  function teacherStats(id, periodWeeks) {
    const draws = state.allDraws;
    const picks = state.tc.data.picks;
    const from = periodWeeks ? Math.max(0, draws.length - periodWeeks) : 0;
    const st = { n: 0, sum: 0, ranks: [0, 0, 0, 0, 0, 0], best: null };
    for (let i = from; i < draws.length; i++) {
      const d = draws[i], p = picks[d.no] && picks[d.no][id];
      if (!p) continue;
      const g = LottoTeachers.grade(p, d);
      st.n++; st.sum += g.m; st.ranks[g.rank]++;
      if (g.rank && (!st.best || g.rank < st.best.rank || (g.rank === st.best.rank && d.no > st.best.no))) st.best = { rank: g.rank, no: d.no };
    }
    st.avg = st.n ? st.sum / st.n : 0;
    st.wins = st.n - st.ranks[0];
    st.rate = st.n ? st.wins / st.n : 0;
    return st;
  }


  function renderTeachers() {
    const data = state.tc.data;
    const next = data.next_round;
    const lastDraw = state.allDraws[state.allDraws.length - 1];
    const nextDate = addDays(lastDraw.date, 7);
    $('#tcTitle').textContent = `이번 주 로또 선생 — ${next}회`;
    $('#tcInfo').textContent = `${nextDate} 추첨`;
    $('#tcInfo').title = data.source;

    const all = LottoTeachers.TEACHERS.map(t => ({ t, st: teacherStats(t.id, 0) }));
    const bestRate = Math.max(...all.map(x => x.st.rate));
    state.tc.list = [];
    $('#tcGrid').innerHTML = all.map(({ t, st }, i) => {
      const nums = data.picks[next][t.id];
      const f = data.fortunes[next][t.id];
      state.tc.list.push({ nums, fixed: [] });
      const prev = data.picks[lastDraw.no] && data.picks[lastDraw.no][t.id];
      const pg = prev ? LottoTeachers.grade(prev, lastDraw) : null;
      const stars = '★'.repeat(f.stars) + '☆'.repeat(5 - f.stars);
      return `<div class="tc-card ${st.rate === bestRate ? 'best' : ''}" style="--tc:${t.color}">
        <div class="tc-top">
          <img class="tc-ava" src="${t.photo}" alt="${t.name}" width="64" height="64">
          <div class="tc-name"><b>${t.name}</b></div>
          <div class="tc-stars" title="이번 주 스스로 본 운세">${stars}<small>이번 주 운세</small></div>
        </div>
        <div class="tc-bubble">${f.text}</div>
        <div class="balls">${nums.map(n => ball(n)).join('')}</div>
        <div class="tc-mini">
          <span>적중률 <b>${(st.rate * 100).toFixed(2)}%</b></span>
          <span>평균 <b>${st.avg.toFixed(2)}개</b></span>
          ${pg ? `<span>지난주 <b>${pg.m}개</b>${pg.rank ? ` (${RANK_NAME[pg.rank]})` : ''}</span>` : ''}
        </div>
        <div class="tc-acts acts">${setActions(i)}</div>
      </div>`;
    }).join('');
    renderTcPick(all, bestRate, next, nextDate);
    renderTcRank();
    renderTcHist();
  }


  /** 추천 화면 위쪽: 네 선생의 이번 주 번호 (간단히) */
  function renderTcPick(all, bestRate, next, nextDate) {
    const data = state.tc.data;
    $('#tcPickInfo').textContent = `${next}회 · ${nextDate} 추첨 · 이번 주 고정 번호`;
    $('#tcPickList').innerHTML = all.map(({ t, st }, i) => {
      const nums = data.picks[next][t.id];
      const f = data.fortunes[next][t.id];
      const stars = '★'.repeat(f.stars) + '☆'.repeat(5 - f.stars);
      return `<div class="set tc-row ${st.rate === bestRate ? 'best' : ''}" style="--tc:${t.color}">
        <div class="tc-row-head">
          <img class="tc-ava sm" src="${t.photo}" alt="" width="40" height="40">
          <b>${t.name}</b>${st.rate === bestRate ? '<span class="tc-badge">적중률 1위</span>' : ''}
          <span class="tc-stars" title="이번 주 운세 ${f.stars}/5" aria-label="이번 주 운세 별 ${f.stars}개"><span class="st-full">${stars}</span><span class="st-short" hidden>★${f.stars}</span></span>
        </div>
        <div class="set-main"><div class="balls">${nums.map(n => ball(n)).join('')}</div></div>
        <div class="acts">${setActions(i)}</div>
      </div>`;
    }).join('');
  }


  function renderTcRank() {
    const rows = LottoTeachers.TEACHERS.map(t => ({ t, st: teacherStats(t.id, state.tc.period) }))
      .sort((a, b) => b.st.rate - a.st.rate || b.st.avg - a.st.avg);
    $('#tcRank').innerHTML = `<thead><tr><th class="l">순위</th><th class="l">선생</th><th>회차 수</th><th>평균 일치</th><th>적중률</th>
        <th>5등</th><th>4등</th><th>3등</th><th>2등</th><th>1등</th><th class="l">최고 성적</th></tr></thead><tbody>` +
      rows.map((x, i) => `<tr>
        <td class="l">${i + 1}</td>
        <td class="l"><span class="tc-who"><img class="tc-dot" src="${x.t.photo}" alt="">${x.t.name}</span></td>
        <td>${fmt(x.st.n)}</td><td>${x.st.avg.toFixed(3)}</td><td><b>${(x.st.rate * 100).toFixed(2)}%</b></td>
        ${[5, 4, 3, 2, 1].map(k => `<td>${x.st.ranks[k] || '-'}</td>`).join('')}
        <td class="l">${x.st.best ? `${x.st.best.no}회 ${RANK_NAME[x.st.best.rank]}` : '-'}</td></tr>`).join('') + '</tbody>';
  }


  function renderTcHist() {
    const draws = state.allDraws, picks = state.tc.data.picks;
    const n = Math.min(state.tc.histN, draws.length);
    const T = LottoTeachers.TEACHERS;
    let html = `<thead><tr><th class="l">회차</th><th class="l">당첨 번호</th>${T.map(t => `<th class="l"><span class="tc-who"><img class="tc-dot" src="${t.photo}" alt="">${t.name.replace(' 선생', '')}</span></th>`).join('')}</tr></thead><tbody>`;
    for (let i = draws.length - 1; i >= draws.length - n; i--) {
      const d = draws[i];
      html += `<tr><td class="l">${d.no}회</td><td class="l"><div class="balls">${d.nums.map(x => ball(x, 'sm')).join('')}</div></td>`;
      for (const t of T) {
        const p = picks[d.no] && picks[d.no][t.id];
        if (!p) { html += '<td class="l">-</td>'; continue; }
        const g = LottoTeachers.grade(p, d);
        html += `<td class="l ${g.rank ? 'hit' : ''}"><span class="m">${g.m}</span>개${g.rank ? `<span class="rk">${RANK_NAME[g.rank]}</span>` : ''}
          <span class="pk">${p.map(x => d.nums.includes(x) ? `<b>${x}</b>` : x).join(' ')}</span></td>`;
      }
      html += '</tr>';
    }
    $('#tcHist').innerHTML = html + '</tbody>';
    $('#tcMore').hidden = n >= draws.length;
  }


  // ───────────────────────── 물리 추첨기 ─────────────────────────

  const ORDINAL = ['첫 번째', '두 번째', '세 번째', '네 번째', '다섯 번째', '여섯 번째', '보너스'];


  function renderTray() {
    const d = state.machine.drawn;
    const cell = i => (d[i] != null ? ball(d[i]) : '<span class="slot-b"></span>');
    $('#tray').innerHTML = [0, 1, 2, 3, 4, 5].map(cell).join('') + '<span class="plus">+</span>' + cell(6);
  }


  function setMachineStatus(text, live) {
    const el = $('#machineStatus');
    el.textContent = text;
    el.classList.toggle('live', !!live);
  }


  function renderMachineHistory() {
    const h = state.machine.history;
    $('#machineHistory').innerHTML = h.length
      ? h.map((x, i) => setRow(x, i, setActions(i))).join('')
      : '<p class="empty">아직 추첨하지 않았습니다.</p>';
  }


  function initMachine() {
    const canvas = $('#drumCanvas');
    if (!canvas || typeof LottoDrum === 'undefined') return;
    const mc = state.machine;
    mc.m = new LottoDrum.LottoMachine(canvas, {
      onPhase: p => {
        const k = mc.drawn.length;
        if (p === 'mix') setMachineStatus(k ? `공을 다시 섞는 중… (${ORDINAL[k]} 공 준비)` : '송풍기 가동 — 공을 섞는 중…', true);
        if (p === 'capture') setMachineStatus(`배출구 열림 — ${ORDINAL[k]} 공을 뽑습니다`, true);
      },
      onCapture: (n, i) => setMachineStatus(`${ORDINAL[i]} 공이 관을 타고 나옵니다…`, true),
      onBall: (n, i) => {
        mc.drawn[i] = n;
        renderTray();
        setMachineStatus(i === 6 ? `보너스 번호 ${n}` : `${ORDINAL[i]} 번호 ${n}`, true);
      },
      onDone: drawn => {
        const main = drawn.slice(0, 6).sort((a, b) => a - b);
        mc.history.unshift({ nums: main, bonus: drawn[6], order: drawn.slice(0, 6), fixed: [] });
        mc.history.length = Math.min(mc.history.length, 20);
        renderMachineHistory();
        setMachineStatus('추첨 완료', false);
        $('#drawBtn').disabled = false;
        $('#drawBtn').textContent = '다시 추첨';
        $('#trayHint').textContent = '아래 기록에서 저장할 수 있어요';
      },
    });
    renderTray();

    $('#drawBtn').addEventListener('click', () => {
      if (mc.m.running) return;
      mc.drawn = [];
      renderTray();
      $('#trayHint').textContent = '나온 순서대로 놓입니다';
      $('#drawBtn').disabled = true;
      $('#drawBtn').textContent = '추첨 중…';
      mc.m.start();
      // 모바일: 추첨기가 화면 밖이면 보이도록 스크롤
      const stage = document.querySelector('.machine-stage');
      const rect = stage.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#airSel').addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $$('#airSel button').forEach(x => x.classList.toggle('active', x === b));
      mc.m.setAirLevel(+b.dataset.v);
    });
    $('#speedSel').addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $$('#speedSel button').forEach(x => x.classList.toggle('active', x === b));
      mc.m.setSpeed(+b.dataset.v);
    });
  }


  // ───────────────────────── 스피또 ─────────────────────────

  const SP = () => LottoSpeetto;
  const spGame = () => SP().GAMES[state.sp.game];
  const sellingRounds = gameId => ((state.sp.status && state.sp.status.games[gameId]) || [])
    .filter(x => x.status === '판매중').sort((a, b) => b.round - a.round);


  /** 현재 선택(공식 구조 / 잔여 반영)에 맞는 게임 확률 */
  function spEffective() {
    const sp = state.sp;
    if (sp.mode === 'live') {
      const r = sellingRounds(sp.game).find(x => x.round === sp.round);
      if (r) return { eg: SP().effective(sp.game, SP().liveModel(sp.game, r).probs), model: SP().liveModel(sp.game, r) };
    }
    return { eg: SP().effective(sp.game, null), model: null };
  }


  /** 입고율이 있는 가장 최근 회차를 기본으로 */
  function defaultRound(gameId) {
    const list = sellingRounds(gameId);
    const r = list.find(x => x.shipRate > 0) || list[0];
    return r ? r.round : null;
  }


  function renderSpMode() {
    const sp = state.sp;
    $$('#spModeSel button').forEach(x => x.classList.toggle('active', x.dataset.m === sp.mode));
    const sel = $('#spRoundSel');
    const list = sellingRounds(sp.game);
    sel.hidden = sp.mode !== 'live';
    if (sp.mode === 'live') {
      if (!list.some(x => x.round === sp.round)) sp.round = defaultRound(sp.game);
      sel.innerHTML = list.map(x => `<option value="${x.round}" ${x.round === sp.round ? 'selected' : ''}>${x.round}회 · 입고율 ${x.shipRate}%</option>`).join('');
    }
    const info = $('#spModeInfo');
    const { eg, model } = spEffective();
    if (sp.mode === 'live' && !model) {
      info.innerHTML = sp.status ? '판매 중인 회차가 없어 공식 당첨 구조를 씁니다.' : '발행 현황을 불러오는 중…';
    } else if (model) {
      info.innerHTML = `${model.round}회 · 판매 추정 <b>${Math.round(model.sold * 100)}%</b> · 남은 복권 약 <b>${SP().shortWon(model.R)}장</b> → `
        + eg.ranks.slice(0, 3).map(k => `${k.rank}등 1/${fmt(Math.round(1 / k.p))}`).join(' · ')
        + ` · 환급률 ${(eg.payout * 100).toFixed(1)}%`;
    } else {
      info.textContent = '동행복권 공식 당첨 구조(발행 단위 기준)의 확률로 뽑습니다.';
    }
  }


  function initSpeetto() {
    if (typeof LottoSpeetto === 'undefined') return;
    $('#spGameSel').addEventListener('click', e => {
      const b = e.target.closest('button[data-g]');
      if (!b) return;
      finalizeTicket();
      state.sp.game = b.dataset.g;
      state.sp.ticket = null;
      state.sp.round = defaultRound(state.sp.game);
      $$('#spGameSel button').forEach(x => x.classList.toggle('active', x === b));
      renderTicket();
      onSpModelChanged();
    });
    $('#spModeSel').addEventListener('click', e => {
      const b = e.target.closest('button[data-m]');
      if (!b) return;
      state.sp.mode = b.dataset.m;
      if (state.sp.mode === 'live' && !state.sp.status) loadSpStatus(false);
      onSpModelChanged();
    });
    $('#spRoundSel').addEventListener('change', e => { state.sp.round = +e.target.value; onSpModelChanged(); });
    $('#spBuy').addEventListener('click', buyTicket);
    $('#spReveal').addEventListener('click', () => revealTicket());
    $('#spBulkN').addEventListener('click', e => {
      const b = e.target.closest('button[data-n]');
      if (!b) return;
      state.sp.bulkN = +b.dataset.n;
      $$('#spBulkN button').forEach(x => x.classList.toggle('active', x === b));
    });
    $('#spBulkGo').addEventListener('click', () => renderBulk(SP().bulk(state.sp.game, state.sp.bulkN, spEffective().eg)));
    $('#spUntil').addEventListener('click', () => renderBulk(SP().untilFirst(state.sp.game, spEffective().eg)));
    $('#spRefresh').addEventListener('click', () => loadSpStatus(true));
    renderTicket();
    renderSession();
    renderSpMode();
    renderSpStructure();
  }


  function onSpModelChanged() {
    renderSpMode();
    renderSpStructure();
    $('#spBulkResult').innerHTML = '';
  }


  function onSpeettoShown() {
    if (!state.sp.statusLoaded) loadSpStatus(false);
    // 숨겨져 있던 동안 크기가 0이었던 긁기 판을 다시 맞춤
    const t = state.sp.ticket;
    if (t && !t.revealed) setupScratch();
  }


  // ── 발행 현황

  async function loadSpStatus(manual) {
    state.sp.statusLoaded = true;
    $('#spStatusInfo').textContent = '불러오는 중…';
    try {
      const st = await SP().loadStatus();
      renderSpStatus(st);
      if (manual) toast('스피또 현황을 새로 불러왔습니다.');
    } catch (err) {
      state.sp.statusLoaded = false;
      $('#spStatusInfo').textContent = '현황을 불러오지 못했습니다';
      $('#spStatus').innerHTML = '<p class="sp-empty">인터넷 연결을 확인한 뒤 새로고침을 눌러 주세요.</p>';
    }
  }


  function renderSpStatus(st) {
    state.sp.status = st;
    if (state.sp.round == null) state.sp.round = defaultRound(state.sp.game);
    const games = SP().GAMES;
    let dataDate = '';
    $('#spStatus').innerHTML = Object.keys(games).map(g => {
      const list = (st.games[g] || []).filter(x => x.status === '판매중').sort((a, b) => b.round - a.round);
      const prizes = games[g].ranks;
      const rounds = list.map(x => {
        if (x.dataDate && x.dataDate > dataDate) dataDate = x.dataDate;
        const model = SP().liveModel(g, x);
        const price = games[g].price;
        const rows = [x.rank1, x.rank2, x.rank3].map((q, i) => {
          if (!q) return '';
          const wonN = q.total - q.left;
          const p = model.probs[i + 1];
          const need = q.left > 0 && p > 0
            ? `당첨까지 평균 <b>${SP().shortWon(price / p)}원</b> · 1/${fmt(Math.round(1 / p))}`
            : '남은 당첨권 없음';
          return `<tr><td>${i + 1}등</td><td>${SP().won(prizes[i].prize)}원</td>
            <td class="${q.left === q.total ? 'left-all' : ''}">잔여 ${fmt(q.left)}/${fmt(q.total)}</td>
            <td class="${wonN ? 'won' : ''}">당첨 ${fmt(wonN)}</td></tr>
            <tr class="need"><td colspan="4">${need}</td></tr>`;
        }).join('');
        return `<div class="sp-round">
          <div class="rh"><b>${x.round}회</b><span class="end">판매 ~${x.saleEnd || '-'}</span></div>
          <div class="sp-bar"><i style="width:${Math.min(100, x.shipRate || 0)}%"></i></div>
          <div class="sp-rate"><span>입고율 <b>${x.shipRate}%</b> · 판매 추정 ${Math.round(model.sold * 100)}%</span><span>남은 약 ${SP().shortWon(model.R)}장</span></div>
          <table class="sp-ranks">${rows}</table>
        </div>`;
      }).join('');
      return `<div class="sp-game"><h3>${games[g].name}<small>${list.length}개 회차 판매 중</small></h3>${rounds || '<p class="sp-empty">판매 중인 회차가 없습니다.</p>'}</div>`;
    }).join('');
    const fetched = st.fetched_at ? new Date(st.fetched_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    $('#spStatusInfo').textContent = `${st.live ? '동행복권 실시간' : '자동 수집본'} · 기준일 ${dataDate || '-'}${fetched ? ` · ${fetched} 수집` : ''}`;
    renderSpMode();
    renderSpStructure();
  }


  // ── 긁는 복권

  function buyTicket() {
    finalizeTicket();
    const t = SP().makeTicket(state.sp.game, spEffective().eg);
    t.revealed = false;
    t.counted = false;
    state.sp.ticket = t;
    state.sp.session.n++;
    state.sp.session.cost += spGame().price;
    renderTicket();
    renderSession();
  }


  /** 긁지 않은 채 다음 장을 사거나 게임을 바꾸면 결과만 집계 */
  function finalizeTicket() {
    const t = state.sp.ticket;
    if (t && !t.counted) {
      t.counted = true;
      if (t.win) state.sp.session.prize += t.win.prize;
      renderSession();
    }
  }


  function ticketBody(t) {
    const W = SP().won;
    if (t.style === 'match3') {
      return `<div class="rule">같은 금액이 3개 나오면 그 금액 당첨</div>
        <div class="grid9">${t.cells.map(c => `<div class="cell" data-hit="${c.hit ? 1 : 0}">${W(c.amount)}원</div>`).join('')}</div>`;
    }
    return `<div class="rule">행운숫자와 같은 숫자가 있으면 그 아래 금액 당첨</div>
      <div class="lucky">${t.lucky.map(n => `<span>${n}</span>`).join('')}</div>
      <div class="mine">${t.mine.map(m => `<div data-hit="${m.hit ? 1 : 0}"><b>${m.num}</b><small>${W(m.amount)}원</small></div>`).join('')}</div>`;
  }


  function renderTicket() {
    const g = spGame(), t = state.sp.ticket;
    const body = t ? ticketBody(t) : `<div class="rule" style="padding-top:60px">아래 <b>1장 사서 긁기</b>를 누르세요</div>`;
    $('#ticketWrap').innerHTML = `
      <div class="ticket ${state.sp.game}">
        <div class="th"><b>${g.name}</b><span>시뮬레이션 · 1장 ${g.price.toLocaleString('ko-KR')}원</span></div>
        <div class="play">${body}${t ? '<canvas class="scratch" aria-label="긁는 부분"></canvas>' : ''}</div>
        <div class="verdict" id="spVerdict">${t ? '손가락이나 마우스로 긁어 보세요' : ''}</div>
      </div>`;
    $('#spReveal').disabled = !t || t.revealed;
    if (t) setupScratch();
  }


  function setupScratch() {
    const cv = document.querySelector('#ticketWrap canvas.scratch');
    if (!cv) return;
    const play = cv.parentElement;
    const w = play.clientWidth, h = play.clientHeight;
    if (!w || !h) return;                       // 탭이 숨겨진 상태 — 보일 때 다시 호출됨
    if (cv.dataset.ready === `${w}x${h}`) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.dataset.ready = `${w}x${h}`;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, cv.width, cv.height);
    grad.addColorStop(0, '#b9bdc4'); grad.addColorStop(.5, '#e6e8ec'); grad.addColorStop(1, '#a9aeb6');
    g.fillStyle = grad;
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(80,85,95,.35)';
    g.font = `700 ${Math.round(13 * dpr)}px "Noto Sans KR", sans-serif`;
    g.textAlign = 'center';
    for (let y = 26 * dpr; y < cv.height; y += 34 * dpr) {
      for (let x = (y / dpr / 34) % 2 ? 40 * dpr : 90 * dpr; x < cv.width; x += 120 * dpr) g.fillText('긁어 보세요', x, y);
    }

    let down = false, moves = 0, last = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }; };
    const scratch = p => {
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = 34 * dpr;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo((last || p).x, (last || p).y);
      g.lineTo(p.x, p.y);
      g.stroke();
      last = p;
      if (++moves % 10 === 0 && clearedRatio(g, cv) > 0.55) revealTicket();
    };
    cv.addEventListener('pointerdown', e => { down = true; last = null; cv.setPointerCapture(e.pointerId); scratch(pos(e)); });
    cv.addEventListener('pointermove', e => { if (down) scratch(pos(e)); });
    const up = () => { down = false; last = null; if (clearedRatio(g, cv) > 0.55) revealTicket(); };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }


  function clearedRatio(g, cv) {
    const step = 12;
    const data = g.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0, total = 0;
    for (let y = 0; y < cv.height; y += step) {
      for (let x = 0; x < cv.width; x += step) {
        total++;
        if (data[(y * cv.width + x) * 4 + 3] < 40) clear++;
      }
    }
    return total ? clear / total : 0;
  }


  function revealTicket() {
    const t = state.sp.ticket;
    if (!t || t.revealed) return;
    t.revealed = true;
    const cv = document.querySelector('#ticketWrap canvas.scratch');
    if (cv) cv.classList.add('gone');
    document.querySelectorAll('#ticketWrap [data-hit="1"]').forEach(el => el.classList.add('hit'));
    const v = $('#spVerdict');
    if (t.win) {
      v.className = 'verdict';
      v.textContent = `🎉 ${t.win.rank}등 ${SP().wonFull(t.win.prize)} 당첨!`;
    } else {
      v.className = 'verdict lose';
      v.textContent = '아쉽게도 낙첨입니다';
    }
    $('#spReveal').disabled = true;
    finalizeTicket();
  }


  function renderSession() {
    const s = state.sp.session;
    const net = s.prize - s.cost;
    $('#spSession').innerHTML = `
      <div><div class="k">산 복권</div><div class="v">${fmt(s.n)}장</div></div>
      <div><div class="k">쓴 돈</div><div class="v">${fmt(s.cost)}원</div></div>
      <div><div class="k">당첨금</div><div class="v">${fmt(s.prize)}원</div></div>
      <div><div class="k">손익</div><div class="v ${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${net > 0 ? '+' : ''}${fmt(net)}원</div></div>`;
  }


  // ── 대량 시뮬레이션

  function renderBulk(r) {
    const g = r.eg || SP().GAMES[r.gameId];
    const net = r.prize - r.cost;
    const rate = r.cost ? r.prize / r.cost : 0;
    const rows = g.ranks.map(k => {
      const c = r.counts[k.rank] || 0;
      const exp = r.untilFirst ? (k.rank === 1 ? 1 : (r.n - 1) * k.p / (1 - g.ranks[0].p)) : r.n * k.p;
      return `<tr><td>${k.rank}등</td><td>${SP().won(k.prize)}원</td><td><b>${fmt(c)}</b></td><td>${exp < 10 ? exp.toFixed(2) : fmt(Math.round(exp))}</td></tr>`;
    }).join('');
    $('#spBulkResult').innerHTML = `
      ${r.untilFirst ? `<p class="hint" style="margin:0 0 10px">1등이 <b>${fmt(r.n)}장째</b>에 나왔습니다 (2등 이하 매수는 통계적 근사).</p>` : ''}
      ${!r.untilFirst && r.n * g.ranks[0].p < 1 ? `<p class="hint" style="margin:0 0 10px">이론 환급률 ${(g.payout * 100).toFixed(1)}%에는 1·2등 고액 당첨금이 포함되어 있어, 대부분의 시뮬레이션에서는 실제 환급률이 이론값보다 낮게 나옵니다.</p>` : ''}
      <div class="sp-sum">
        <div><div class="k">${g.name} ${fmt(r.n)}장 구매</div><div class="v">${fmt(r.cost)}원</div></div>
        <div><div class="k">당첨금 합계</div><div class="v">${fmt(r.prize)}원</div></div>
        <div><div class="k">손익</div><div class="v" style="color:${net < 0 ? 'var(--fix)' : 'var(--ok)'}">${net > 0 ? '+' : ''}${fmt(net)}원</div></div>
        <div><div class="k">환급률 (${g.live ? '잔여 반영 ' : '이론 '}${(g.payout * 100).toFixed(1)}%)</div><div class="v">${(rate * 100).toFixed(1)}%</div></div>
      </div>
      <div class="table-wrap"><table class="sp-table">
        <thead><tr><th>등위</th><th>당첨금</th><th>당첨 매수</th><th>기대 매수</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }


  function renderSpStructure() {
    const g = spGame();
    const { eg, model } = spEffective();
    const odds = p => `1/${fmt(Math.round(1 / p * 10) / 10)}`;
    const rows = g.ranks.map((k, i) => {
      const lp = eg.ranks[i].p;
      return `<tr><td>${k.rank}등</td><td>${SP().wonFull(k.prize)}</td><td>${odds(k.p)}</td>
        ${model ? `<td class="${Math.abs(lp - k.p) / k.p > 0.005 ? 'live' : ''}">${odds(lp)}</td>` : ''}
        <td>${SP().shortWon(g.price / lp)}원</td></tr>`;
    }).join('');
    $('#spStructure').innerHTML = `
      <h3>${g.name} 당첨 구조 (${fmt(g.issue)}매 발행 기준)${model ? ` · ${model.round}회 잔여 반영` : ''}</h3>
      <div class="table-wrap"><table class="sp-table">
        <thead><tr><th>등위</th><th>당첨금</th><th>공식 확률</th>${model ? '<th>현재 추정</th>' : ''}<th>평균 필요 금액</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="note">아무 등위나 당첨될 확률 1/${(1 / eg.winP).toFixed(1)} · ${model ? '잔여 반영' : '이론'} 환급률 ${(eg.payout * 100).toFixed(2)}% — 평균적으로 산 금액의 ${Math.round((1 - eg.payout) * 100)}%는 돌아오지 않습니다.
      ${model ? '4등 이하는 잔여가 공개되지 않아 공식 확률을 씁니다.' : ''}</p>`;
  }


  // ───────────────────────── 타로 추천 ─────────────────────────

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));


  function cardHTML(p, flipped) {
    const c = p.card;
    return `
      <div class="tcard ${p.reversed ? 'rev' : ''} ${flipped ? 'flipped' : ''}">
        <div class="inner">
          <div class="back"></div>
          <div class="face"><div class="art">
            <span class="rn">${c.rn}</span>
            <span class="sym">${c.sym}</span>
            <span class="nmb"><span class="nm">${esc(c.name)}</span><span class="en">${esc(c.en)}</span></span>
          </div></div>
        </div>
      </div>`;
  }


  function startTarot() {
    const t = state.tarot;
    t.deck = LottoTarot.shuffle();
    t.picks = [];
    t.results = [];
    t.reading = null;
    t.revealing = false;
    $('#tarotReadingCard').hidden = true;
    $('#tarotNumbersCard').hidden = true;
    $('#tarotGuide').textContent = `마음속으로 이번 주의 소망을 떠올리며 카드 ${t.spread}장을 고르세요`;
    renderTarotSlots();
    $('#tarotDeck').classList.remove('done');
    $('#tarotDeck').innerHTML = t.deck.map((p, i) => `
      <button class="dcard" data-i="${i}" style="animation-delay:${i * 22}ms" aria-label="${i + 1}번째 카드 고르기">
        <div class="tcard"><div class="inner"><div class="back"></div></div></div>
      </button>`).join('');
  }


  function renderTarotSlots() {
    const t = state.tarot;
    const labels = LottoTarot.SPREADS[t.spread];
    $('#tarotSlots').innerHTML = labels.map((label, i) => {
      const p = t.picks[i];
      return `<div class="slot" data-slot="${i}"><div class="pos">${label}</div>
        ${p ? cardHTML(p, false) : '<div class="ph">카드를 고르세요</div>'}
        <div class="cap"></div></div>`;
    }).join('');
  }


  function onTarotPick(i, btn) {
    const t = state.tarot;
    if (t.revealing || t.picks.length >= t.spread || btn.classList.contains('picked')) return;
    btn.classList.add('picked');
    t.picks.push(t.deck[i]);
    renderTarotSlots();
    const left = t.spread - t.picks.length;
    $('#tarotGuide').textContent = left ? `${left}장 더 고르세요` : '카드를 펼칩니다…';
    if (!left) {
      t.revealing = true;
      $('#tarotDeck').classList.add('done');
      setTimeout(revealTarot, 450);
    }
  }


  function revealTarot() {
    const t = state.tarot;
    const slots = $$('#tarotSlots .slot');
    slots.forEach((slot, i) => setTimeout(() => {
      slot.querySelector('.tcard').classList.add('flipped');
      const p = t.picks[i];
      slot.querySelector('.cap').innerHTML = `<b>${esc(p.card.name)}</b><span class="ori ${p.reversed ? 'rev' : ''}">${p.reversed ? '역방향' : '정방향'}</span>`;
    }, i * 550));
    setTimeout(() => {
      t.revealing = false;
      $('#tarotGuide').textContent = '카드가 펼쳐졌습니다. 아래에서 해석과 번호를 확인하세요';
      showTarotReading();
    }, slots.length * 550 + 500);
  }


  function showTarotReading() {
    const t = state.tarot;
    if (!state.stats) return;
    const lastDraw = state.allDraws[state.allDraws.length - 1];
    t.reading = LottoTarot.reading(t.picks, state.stats, lastDraw);
    const labels = LottoTarot.SPREADS[t.spread];

    $('#tarotReading').innerHTML = t.picks.map((p, i) => {
      const c = p.card;
      const chips = t.reading.details[i].map((txt, k) =>
        `<span class="chip ${k === 0 ? (p.reversed ? 'out' : 'in') : ''}">${esc(txt)}</span>`).join('');
      return `<div class="ritem">
        <div class="pos">${labels[i]}</div>
        <h3>${esc(c.name)}<small>${c.rn} · ${p.reversed ? '역방향' : '정방향'}</small></h3>
        <div class="kw">${esc(c.kw)}</div>
        <p>${esc(p.reversed ? c.rev : c.up)}</p>
        <p class="msg">${esc(c.msg)}${p.reversed ? ' (역방향이라 기운이 반대로 작용합니다)' : ''}</p>
        <div class="chips">${chips}</div>
      </div>`;
    }).join('');
    $('#tarotReadingCard').hidden = false;
    generateTarot(false);
    $('#tarotReadingCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }


  function generateTarot(randomSeed) {
    const t = state.tarot;
    const r = t.reading;
    if (!r) return;
    const count = Math.max(1, Math.min(10, +$('#tarotCount').value || 3));
    $('#tarotCount').value = count;
    const filters = { ...readFilters(), ...r.filterPatch };
    const nextNo = state.allDraws[state.allDraws.length - 1].no + 1;

    let seed;
    if (randomSeed) {
      const a = new Uint32Array(1);
      (window.crypto || window.msCrypto).getRandomValues(a);
      seed = a[0];
    } else {
      // 이번 주에 같은 카드(같은 방향)를 뽑으면 같은 번호
      seed = E.hashString(['tarot', nextNo, t.picks.map(p => p.card.id + (p.reversed ? 'r' : 'u')).join('-'), count, JSON.stringify(filters)].join('|'));
    }
    const sets = E.generate(count, r.weights, r.fixed, filters, state.pastKeys, E.mulberry32(seed));
    t.results = sets.map(s => ({ nums: s.set, relaxed: s.relaxed, fixed: r.fixed }));

    const parts = [];
    if (r.fixed.length) parts.push(`포함 <b>${r.fixed.join(', ')}</b>`);
    if (r.excluded.length) parts.push(`제외 <b>${r.excluded.join(', ')}</b>`);
    const fx = [];
    if (r.filterPatch.spread) fx.push('번호대 분산');
    if (r.filterPatch.oddEven) fx.push('홀짝·고저 쏠림 제외');
    if (fx.length) parts.push(`카드 필터: ${fx.join(', ')}`);
    $('#tarotSummary').innerHTML = `${nextNo}회 · ${parts.join(' · ')}${randomSeed ? ' · 새로 섞은 조합' : ''}`;

    $('#tarotResults').innerHTML = t.results.length
      ? t.results.map((x, i) => setRow(x, i, setActions(i))).join('')
      : '<p class="empty">조건을 만족하는 조합을 만들지 못했습니다. 필터를 완화해 보세요.</p>';
    $('#tarotNumbersCard').hidden = false;
  }


  function renderSaved() {
    const list = loadSaved();
    $('#clearSaved').style.display = list.length ? '' : 'none';
    $('#saved').innerHTML = list.length
      ? list.map((r, i) => setRow(r, i, `<button class="act" data-act="check-saved" data-i="${i}">${ic('search')}맞춰보기</button><button class="act" data-act="copy-saved" data-i="${i}">${ic('copy')}복사</button><button class="act icon-only" data-act="del" data-i="${i}" aria-label="삭제">${ic('trash')}</button>`)).join('')
      : `<p class="empty">${ic('star')}추천 번호의 <b>저장</b>을 누르면 여기에 모입니다</p>`;
  }


  function copyNums(nums) {
    const text = nums.join(', ');
    if (window.AndroidBridge) {            // 안드로이드 앱(WebView)에서는 네이티브 클립보드 사용
      window.AndroidBridge.copy(text);
      toast(`복사했습니다: ${text}`);
      return;
    }
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast(`복사했습니다: ${text}`))
      .catch(() => toast(text));
  }


  // ───────────────────────── 통계 탭 ─────────────────────────

  function renderStatsTab() {
    const s = state.stats;
    const arr = s.nums.slice(1);
    const draws = scopeDraws();
    const top = [...arr].sort((a, b) => b.count - a.count).slice(0, 3);
    const cold = [...arr].sort((a, b) => b.gap - a.gap).slice(0, 3);
    const hotRecent = [...arr].sort((a, b) => b.recent - a.recent).slice(0, 3);

    $('#kpis').innerHTML = `
      <div class="kpi"><div class="k">${ic('trophy')}많이 나옴</div><div class="v">${top.map(x => ball(x.n, 'sm')).join('')}</div><div class="s">${top.map(x => `${x.count}회`).join(' · ')}</div></div>
      <div class="kpi"><div class="k">${ic('flame')}요즘 강세</div><div class="v">${hotRecent.map(x => ball(x.n, 'sm')).join('')}</div><div class="s">최근 ${s.recentN}회 중 ${hotRecent.map(x => `${x.recent}회`).join(' · ')}</div></div>
      <div class="kpi"><div class="k">${ic('snow')}오래 쉼</div><div class="v">${cold.map(x => ball(x.n, 'sm')).join('')}</div><div class="s">${cold.map(x => `${x.gap}회째`).join(' · ')}</div></div>`;

    // 히트맵
    const ratios = arr.map(x => x.ratio);
    const lo = Math.min(...ratios), hi = Math.max(...ratios);
    $('#heat').innerHTML = arr.map(x => {
      const t = hi === lo ? 0.5 : (x.ratio - lo) / (hi - lo);
      const mix = Math.round(5 + t * 75);
      const ink = mix > 50 ? '#fff' : 'var(--text)';
      return `<div class="hcell" style="background:color-mix(in srgb, var(--accent-btn) ${mix}%, var(--surface));color:${ink}" title="${x.n}번: ${x.count}회 (이론 대비 ${pct(x.ratio, 0)})">
        <div class="n">${x.n}</div><div class="r">${pct(x.rate)}</div></div>`;
    }).join('');

    renderChart();
    renderStatsTable();
    renderPatterns();
  }


  function renderChart() {
    const s = state.stats;
    const arr = s.nums.slice(1);
    const W = 900, H = 240, L = 34, R = 8, T = 10, B = 26;
    const max = Math.max(...arr.map(x => x.count), s.expected) * 1.08;
    const bw = (W - L - R) / 45;
    const y = v => T + (H - T - B) * (1 - v / max);
    const colors = ['', 'var(--b1)', 'var(--b2)', 'var(--b3)', 'var(--b4)', 'var(--b5)'];

    const ticks = 4;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const v = Math.round((max / ticks) * i);
      grid += `<text class="ax" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    }
    const bars = arr.map((x, i) => {
      const bx = L + i * bw + bw * 0.15;
      return `<rect x="${bx}" y="${y(x.count)}" width="${bw * 0.7}" height="${y(0) - y(x.count)}" rx="2" fill="${colors[dec(x.n)]}"><title>${x.n}번: ${x.count}회</title></rect>
              <text class="ax" x="${bx + bw * 0.35}" y="${H - 10}" text-anchor="middle">${x.n}</text>`;
    }).join('');
    const ey = y(s.expected);
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="번호별 출현 횟수 막대 그래프">
      ${grid}${bars}
      <line class="exp" x1="${L}" x2="${W - R}" y1="${ey}" y2="${ey}"/>
      <text class="ax" x="${W - R}" y="${ey - 4}" text-anchor="end">기대 ${s.expected.toFixed(1)}</text></svg>`;
  }


  const COLS = [
    { key: 'n', label: '번호' },
    { key: 'count', label: '출현 횟수' },
    { key: 'rate', label: '출현률' },
    { key: 'ratio', label: '이론 대비' },
    { key: 'recent', label: '최근 N회' },
    { key: 'gap', label: '연속 미출현' },
    { key: 'maxGap', label: '최장 미출현' },
    { key: 'bonus', label: '보너스' },
    { key: 'prob', label: '추천 확률' },
  ];


  function renderStatsTable() {
    const s = state.stats;
    if (!s) return;
    const p = state.prob || [];
    const rows = s.nums.slice(1).map(x => ({ ...x, prob: p[x.n] ?? 0 }));
    const { key, asc } = state.sort;
    rows.sort((a, b) => (a[key] - b[key]) * (asc ? 1 : -1) || a.n - b.n);

    const head = COLS.map(c => `<th data-k="${c.key}" class="${c.key === key ? 'sorted' + (asc ? ' asc' : '') : ''}">${c.key === 'recent' ? `최근 ${s.recentN}회` : c.label}</th>`).join('');
    const body = rows.map(x => {
      const diff = x.ratio - 1;
      const cls = diff > 0.05 ? 'up' : diff < -0.05 ? 'down' : '';
      return `<tr>
        <td>${ball(x.n, 'sm')}</td>
        <td>${x.count}</td>
        <td>${pct(x.rate, 2)}</td>
        <td class="${cls}">${pct(x.ratio, 0)}</td>
        <td>${x.recent}</td>
        <td>${x.gap ? x.gap + '회' : '<b>직전 출현</b>'}</td>
        <td>${x.maxGap}회</td>
        <td>${x.bonus}</td>
        <td><b>${state.prob ? pct(x.prob, 1) : '…'}</b></td>
      </tr>`;
    }).join('');
    $('#statsTable').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  }


  // ───────────────────────── 당첨 번호 패턴 ─────────────────────────

  /** 무작위로 6개를 뽑을 때의 이론 확률 (미리 계산한 값) */
  const THEORY = {
    odd:   [0.00916, 0.07436, 0.22722, 0.33485, 0.25113, 0.09089, 0.01239],  // 홀수(23개) k개 = 높은 수(23~45) k개
    run:   [0.47125, 0.40393, 0.1122, 0.01261],                              // 연속 쌍 0·1·2·3+
    carry: [0.40056, 0.42413, 0.15147, 0.02384],                             // 이월 0·1·2·3+
    dec:   [0.0306, 0.32965, 0.51688, 0.12277],                              // 구간 수 2이하·3·4·5
  };
  const DEC_SIZE = [10, 10, 10, 10, 5];
  const END_SIZE = [4, 5, 5, 5, 5, 5, 4, 4, 4, 4];
  const DEC_LBL = ['1~10', '11~20', '21~30', '31~40', '41~45'];

  /** 회차별 모양 (전체 회차 기준, 이월은 바로 앞 회차와 비교) */
  function drawFeatures() {
    const all = state.allDraws;
    if (state._feat && state._feat.src === all) return state._feat.list;
    const list = all.map((d, i) => {
      const n = d.nums;
      let run = 0;
      for (let k = 1; k < 6; k++) if (n[k] - n[k - 1] === 1) run++;
      const prev = i > 0 && all[i - 1].no === d.no - 1 ? new Set(all[i - 1].nums) : null;
      const ends = new Array(10).fill(0);
      n.forEach(x => ends[x % 10]++);
      return {
        no: d.no,
        odd: n.filter(x => x % 2).length,
        high: n.filter(x => x >= 23).length,
        sum: n.reduce((a, b) => a + b, 0),
        run,
        carry: prev ? n.filter(x => prev.has(x)).length : null,
        decs: new Set(n.map(x => Math.min(4, Math.floor((x - 1) / 10)))).size,
        sameEnd: Math.max(...ends),
      };
    });
    state._feat = { src: all, list };
    return list;
  }

  const scopeFeatures = () => {
    const f = drawFeatures();
    return state.range ? f.slice(-state.range) : f;
  };

  /** 값별 비율 */
  function distOf(feats, key, buckets, map = v => v) {
    const cnt = new Array(buckets).fill(0);
    let tot = 0;
    feats.forEach(f => { if (f[key] == null) return; cnt[Math.min(buckets - 1, map(f[key]))]++; tot++; });
    return cnt.map(c => (tot ? c / tot : 0));
  }

  const rarity = p => (p >= 0.25 ? ['흔함', 'common'] : p >= 0.1 ? ['보통', 'mid'] : ['드묾', 'rare']);

  /**
   * 분포 막대 (HTML) — rows: [{ label, v(실제 비율), t(이론 비율|null), on(지난 회차) }]
   */
  function distBars(rows, note = '이론') {
    const max = Math.max(...rows.map(r => Math.max(r.v, r.t || 0)), 0.01);
    return `<div class="dist">${rows.map(r => `
      <div class="dist-row${r.on ? ' on' : ''}">
        <span class="dl">${r.label}</span>
        <span class="dt"><i style="width:${(r.v / max) * 100}%"></i>${r.t != null ? `<u style="left:${(r.t / max) * 100}%" title="${note} ${pct(r.t)}"></u>` : ''}</span>
        <span class="dv">${pct(r.v)}</span>
      </div>`).join('')}</div>
      <p class="hint dist-key">${rows.some(r => r.on) ? '<i class="key-on"></i> 지난 회 모양' : ''}${rows.some(r => r.t != null) ? `<u></u> ${note} 비율` : ''}</p>`;
  }

  /**
   * 회차별 추세 꺾은선 (SVG)
   * opt: { min, max, ref(기준선), refLbl, band:[lo,hi], ma(이동평균 회차 수), step(눈금 간격) }
   */
  function trendSvg(feats, key, opt) {
    const pts = feats.filter(f => f[key] != null);
    if (pts.length < 2) return '<p class="empty">회차가 부족합니다</p>';
    const W = 400, H = 196, L = 30, R = 12, T = 12, B = 32;
    const { min, max } = opt;
    const x = i => L + (W - L - R) * (i / (pts.length - 1));
    const y = v => T + (H - T - B) * (1 - (v - min) / (max - min));
    let g = '';
    for (let v = min; v <= max; v += opt.step) {
      g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    if (opt.band) g += `<rect class="band" x="${L}" width="${W - L - R}" y="${y(opt.band[1])}" height="${y(opt.band[0]) - y(opt.band[1])}"/>`;
    if (opt.ref != null) g += `<line class="exp" x1="${L}" x2="${W - R}" y1="${y(opt.ref)}" y2="${y(opt.ref)}"/>`;
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    let ma = '';
    if (opt.ma) {
      const m = pts.map((p, i) => {
        const w = pts.slice(Math.max(0, i - opt.ma + 1), i + 1);
        return w.reduce((a, b) => a + b[key], 0) / w.length;
      });
      ma = `<path class="ma" d="${m.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}"/>`;
    }
    const r = pts.length > 60 ? 1.8 : 3.2;
    const dots = pts.map((p, i) => `<circle class="${i === pts.length - 1 ? 'pt last' : 'pt'}" cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="${i === pts.length - 1 ? 5 : r}"><title>${p.no}회: ${p[key]}</title></circle>`).join('');
    const xl = `<text class="ax" x="${L}" y="${H - 6}">${pts[0].no}회</text><text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">${pts[pts.length - 1].no}회</text>`;
    return `<div class="chart pt-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 ${pts.length}회 ${opt.aria} 추세">${g}<path class="ln" d="${line}"/>${ma}${dots}${xl}</svg></div>`;
  }

  const avg = (arr, key) => {
    const v = arr.filter(f => f[key] != null);
    return v.length ? v.reduce((a, b) => a + b[key], 0) / v.length : 0;
  };

  const SPLIT_LBL = (k, a, b) => `${a} ${k} : ${b} ${6 - k}`;


  function renderPatterns() {
    if (!state.allDraws.length || !$('#ptLatest')) return;
    const sc = scopeFeatures();
    const all = drawFeatures();
    const last = all[all.length - 1];
    const N = Math.min(state.trendN, all.length);
    const tr = all.slice(-N);
    const s = state.stats;

    // 분포
    const dOdd = distOf(sc, 'odd', 7), dHigh = distOf(sc, 'high', 7);
    const dRun = distOf(sc, 'run', 4), dCarry = distOf(sc, 'carry', 4);
    const dDec = distOf(sc, 'decs', 4, v => Math.max(0, v - 2));
    const sumIn = sc.filter(f => f.sum >= s.sumP10 && f.sum <= s.sumP90).length / sc.length;
    const sumBucket = v => (v < 100 ? 0 : v < 120 ? 1 : v < 140 ? 2 : v < 160 ? 3 : v < 180 ? 4 : 5);
    const dSum = distOf(sc, 'sum', 6, sumBucket);

    // ── 지난 회차 모양 ──
    $('#ptLatestTitle').textContent = `${last.no}회 번호 모양`;
    const tile = (label, val, p, extra = '') => {
      const [w, c] = rarity(p);
      return `<div class="pt-tile"><div class="k">${label}</div><div class="v">${val}</div><div class="s"><span class="rt ${c}">${w}</span>${extra || `같은 모양 ${pct(p, 0)}`}</div></div>`;
    };
    $('#ptLatest').innerHTML = [
      tile('홀 : 짝', `${last.odd} : ${6 - last.odd}`, dOdd[last.odd]),
      tile('낮은 : 높은', `${6 - last.high} : ${last.high}`, dHigh[last.high]),
      tile('합계', last.sum, dSum[sumBucket(last.sum)], `${['100 미만', '100~119', '120~139', '140~159', '160~179', '180 이상'][sumBucket(last.sum)]} ${pct(dSum[sumBucket(last.sum)], 0)}`),
      tile('연속 번호', last.run ? `${last.run}쌍` : '없음', dRun[Math.min(3, last.run)]),
      last.carry != null ? tile('이월 번호', `${last.carry}개`, dCarry[Math.min(3, last.carry)]) : '',
      tile('번호 구간', `${last.decs}개 구간`, dDec[Math.max(0, last.decs - 2)]),
    ].join('');

    const recentTxt = `최근 ${N}회`;

    // ── 홀짝 ──
    const oddAvg = avg(tr, 'odd');
    $('#ptOddHint').innerHTML = `${recentTxt} 평균 홀수 <b>${oddAvg.toFixed(1)}개</b> (이론 3.1개)`;
    $('#ptOdd').innerHTML = trendSvg(tr, 'odd', { min: 0, max: 6, step: 1, ref: 3, aria: '홀수 개수' }) +
      `<h3 class="pt-sub">홀 : 짝 분포 <small>분석 기준 ${fmt(sc.length)}회</small></h3>` +
      distBars([6, 5, 4, 3, 2, 1, 0].map(k => ({ label: SPLIT_LBL(k, '홀', '짝'), v: dOdd[k], t: THEORY.odd[k], on: last.odd === k })));

    // ── 고저 ──
    const highAvg = avg(tr, 'high');
    $('#ptHighHint').innerHTML = `${recentTxt} 평균 높은 수 <b>${highAvg.toFixed(1)}개</b> (이론 3.1개)`;
    $('#ptHigh').innerHTML = trendSvg(tr, 'high', { min: 0, max: 6, step: 1, ref: 3, aria: '높은 수 개수' }) +
      `<h3 class="pt-sub">낮은 수 : 높은 수 분포 <small>분석 기준 ${fmt(sc.length)}회</small></h3>` +
      distBars([0, 1, 2, 3, 4, 5, 6].map(k => ({ label: `낮 ${6 - k} : 높 ${k}`, v: dHigh[k], t: THEORY.odd[k], on: last.high === k })));

    // ── 합계 ──
    const sumAvg = avg(tr, 'sum');
    const lo = Math.min(...tr.map(f => f.sum)), hi = Math.max(...tr.map(f => f.sum));
    $('#ptSumHint').innerHTML = `${recentTxt} 평균 <b>${sumAvg.toFixed(0)}</b> · 최저 ${lo} · 최고 ${hi}`;
    const sMin = Math.min(40, Math.floor(lo / 20) * 20), sMax = Math.max(240, Math.ceil(hi / 20) * 20);
    $('#ptSum').innerHTML = trendSvg(tr, 'sum', { min: sMin, max: sMax, step: 40, ref: 138, band: [s.sumP10, s.sumP90], ma: 5, aria: '번호 합계' }) +
      `<div class="pt-legend"><span><i class="lg-band"></i>80% 구간 ${s.sumP10}~${s.sumP90}</span><span><i class="lg-ma"></i>5회 평균</span><span><i class="lg-ref"></i>이론 평균 138</span></div>` +
      `<h3 class="pt-sub">합계 구간 분포 <small>분석 기준 ${fmt(sc.length)}회 · 평균 ${s.sumAvg.toFixed(1)}</small></h3>` +
      distBars(['100 미만', '100~119', '120~139', '140~159', '160~179', '180 이상'].map((label, k) => ({ label, v: dSum[k], t: null, on: sumBucket(last.sum) === k }))) +
      `<p class="hint">분석 기준 회차의 ${pct(sumIn, 0)}가 ${s.sumP10}~${s.sumP90} 사이였습니다.</p>`;

    // ── 연속 번호 ──
    const runRate = tr.filter(f => f.run > 0).length / tr.length;
    $('#ptRunHint').innerHTML = `${recentTxt} 중 <b>${tr.filter(f => f.run > 0).length}회(${pct(runRate, 0)})</b> 연속 번호 포함 (이론 52.9%)`;
    $('#ptRun').innerHTML = `<div class="pt-strip" aria-label="최근 회차 연속 번호">${tr.slice(-20).map(f => `<span class="${f.run ? 'y' : ''}" title="${f.no}회: 연속 ${f.run}쌍"><b>${f.run || '·'}</b><small>${f.no % 1000}</small></span>`).join('')}</div>
      <p class="hint">최근 ${Math.min(20, tr.length)}회 — 칸 숫자 = 연속 쌍 수, 아래는 회차 끝자리</p>` +
      `<h3 class="pt-sub">연속 쌍 개수 분포 <small>분석 기준 ${fmt(sc.length)}회</small></h3>` +
      distBars(['없음', '1쌍', '2쌍', '3쌍 이상'].map((label, k) => ({ label, v: dRun[k], t: THEORY.run[k], on: Math.min(3, last.run) === k })));

    // ── 이월 ──
    const trC = tr.filter(f => f.carry != null);
    const carryAvg = avg(trC, 'carry');
    $('#ptCarryHint').innerHTML = `${recentTxt} 평균 <b>${carryAvg.toFixed(2)}개</b> 이월 (이론 0.80개)`;
    $('#ptCarry').innerHTML = trendSvg(trC, 'carry', { min: 0, max: 4, step: 1, ref: 0.8, aria: '이월 번호 개수' }) +
      `<h3 class="pt-sub">이월 개수 분포 <small>분석 기준 ${fmt(sc.length)}회</small></h3>` +
      distBars(['0개', '1개', '2개', '3개 이상'].map((label, k) => ({ label, v: dCarry[k], t: THEORY.carry[k], on: last.carry != null && Math.min(3, last.carry) === k })));

    // ── 번호대 ──
    const trDraws = state.allDraws.slice(-N);
    const decCnt = [0, 0, 0, 0, 0];
    trDraws.forEach(d => d.nums.forEach(n => decCnt[Math.min(4, Math.floor((n - 1) / 10))]++));
    const decRows = decCnt.map((c, k) => ({ k, c, e: (N * 6 * DEC_SIZE[k]) / 45 }));
    const best = [...decRows].sort((a, b) => b.c / b.e - a.c / a.e);
    $('#ptDecHint').innerHTML = `${recentTxt} 강세 <b>${DEC_LBL[best[0].k]}</b> · 약세 <b>${DEC_LBL[best[4].k]}</b>`;
    const maxC = Math.max(...decRows.map(r => Math.max(r.c, r.e)));
    $('#ptDec').innerHTML = `<div class="dec-bars">${decRows.map(r => {
      const rr = r.c / r.e, cls = rr > 1.15 ? 'up' : rr < 0.85 ? 'down' : '';
      return `<div class="dec-row"><span class="dl"><i class="dd d${r.k + 1}"></i>${DEC_LBL[r.k]}</span>
        <span class="dt"><i class="d${r.k + 1}" style="width:${(r.c / maxC) * 100}%"></i><u style="left:${(r.e / maxC) * 100}%"></u></span>
        <span class="dv">${r.c}회 <small class="${cls}">${pct(rr, 0)}</small></span></div>`;
    }).join('')}</div><p class="hint dist-key"><u></u> ${recentTxt} 기대 횟수 · %는 기대 대비</p>` +
      `<h3 class="pt-sub">한 회차에 섞인 구간 수 <small>분석 기준 ${fmt(sc.length)}회</small></h3>` +
      distBars(['2개 이하', '3개', '4개', '5개 모두'].map((label, k) => ({ label, v: dDec[k], t: THEORY.dec[k], on: Math.max(0, last.decs - 2) === k })));

    // ── 끝수 ──
    const scDraws = scopeDraws();
    const endCnt = new Array(10).fill(0);
    scDraws.forEach(d => d.nums.forEach(n => endCnt[n % 10]++));
    const endRows = endCnt.map((c, k) => ({ k, c, ratio: c / ((scDraws.length * 6 * END_SIZE[k]) / 45) }));
    const eSorted = [...endRows].sort((a, b) => b.ratio - a.ratio);
    const sameEnd = sc.filter(f => f.sameEnd >= 2).length / sc.length;
    $('#ptEndHint').innerHTML = `강세 끝수 <b>${eSorted[0].k}</b> · 약세 끝수 <b>${eSorted[9].k}</b>`;
    const rs = endRows.map(r => r.ratio);
    const eLo = Math.min(0.85, Math.min(...rs) - 0.03), eHi = Math.max(1.15, Math.max(...rs) + 0.03);
    const eh = v => ((v - eLo) / (eHi - eLo)) * 100;
    $('#ptEnd').innerHTML = `<div class="end-grid">${endRows.map(r => {
      const cls = r.ratio > 1.05 ? 'up' : r.ratio < 0.95 ? 'down' : '';
      return `<div class="end-col" title="끝수 ${r.k}: ${r.c}회 (이론 대비 ${pct(r.ratio, 0)})"><span class="ev ${cls}">${Math.round(r.ratio * 100)}</span><span class="eb"><i class="${cls}" style="height:${eh(r.ratio)}%"></i><u style="bottom:${eh(1)}%"></u></span><b>${r.k}</b></div>`;
    }).join('')}</div>
      <p class="hint dist-key"><u></u> 이론 평균 = 100 · 위 숫자는 이론 대비 % · 분석 기준 ${fmt(scDraws.length)}회</p>
      <p class="pt-fact">같은 끝수가 2개 이상 들어간 회차 <b>${pct(sameEnd, 0)}</b>${last.sameEnd >= 2 ? ' · 지난 회 해당' : ''}</p>`;

    // ── 번호 쌍 ──
    const pairs = [];
    for (let a = 1; a <= 45; a++) for (let b = a + 1; b <= 45; b++) pairs.push([a, b, s.co[a][b]]);
    pairs.sort((p, q) => q[2] - p[2] || p[0] - q[0]);
    const expPair = s.total * 30 / 1980;
    $('#ptPairHint').innerHTML = `기대 횟수 약 <b>${expPair.toFixed(1)}회</b> · 분석 기준 ${fmt(s.total)}회`;
    $('#ptPair').innerHTML = `<ol class="pair-list">${pairs.slice(0, 10).map(([a, b, c], i) =>
      `<li><span class="rk">${i + 1}</span><span class="balls">${ball(a, 'sm')}${ball(b, 'sm')}</span><span class="pc"><b>${c}회</b><small>기대 대비 ${pct(c / expPair, 0)}</small></span></li>`).join('')}</ol>`;
  }



  // ───────────────────────── 내 번호 확인 ─────────────────────────

  function onCheckClick(n) {
    const i = state.checkSel.indexOf(n);
    if (i >= 0) state.checkSel.splice(i, 1);
    else if (state.checkSel.length < 6) state.checkSel.push(n);
    else { toast('6개까지 고를 수 있어요'); return; }
    renderCheck();
  }


  function renderCheck() {
    const sel = [...state.checkSel].sort((a, b) => a - b);
    $$('#checkPicker .pick').forEach(b => b.classList.toggle('on', sel.includes(+b.dataset.n)));
    $('#checkSel').innerHTML = [0, 1, 2, 3, 4, 5].map(i => (sel[i] != null ? ball(sel[i]) : `<span class="slot-e">${i + 1}</span>`)).join('');

    const out = $('#checkResult');
    if (sel.length < 6 || !state.allDraws.length) { out.innerHTML = ''; return; }

    const bt = E.backtest(sel, state.allDraws);
    const d = E.describe(sel);
    const labels = ['', '1등', '2등', '3등', '4등', '5등'];
    const sub = ['', '6개 일치', '5개+보너스', '5개 일치', '4개 일치', '3개 일치'];
    const total = bt.wins.length;
    const short = ['', '6개', '5+보너스', '5개', '4개', '3개'];
    out.innerHTML = `
      <p class="check-sum">${fmt(state.allDraws.length)}회 중 <b>${total}회</b> 당첨</p>
      <div class="ranks">${[1, 2, 3, 4, 5].map(k => `<div class="rank ${bt.ranks[k] ? 'has' : ''}" title="${sub[k]}"><div class="k">${labels[k]}<small>${short[k]}</small></div><div class="v">${bt.ranks[k]}</div></div>`).join('')}</div>
      <p class="hint">합계 ${d.sum} · 홀:짝 ${d.odd}:${d.even} · 저:고 ${d.low}:${d.high}</p>
      ${total ? `<details class="fold sub-fold"><summary>${ic('clock')}당첨된 회차 ${total}건<svg class="ic chev" aria-hidden="true"><use href="#i-down"/></svg></summary><div class="table-wrap"><table class="wins"><thead><tr><th>회차</th><th>날짜</th><th>등수</th><th>당첨번호</th></tr></thead><tbody>
        ${bt.wins.slice(0, 60).map(w => `<tr><td>${w.no}회</td><td>${w.date}</td><td><b>${labels[w.rank]}</b></td>
          <td><div class="balls">${w.nums.map(n => ball(n, 'sm ' + (sel.includes(n) ? 'match' : 'dim'))).join('')}<span class="plus">+</span>${ball(w.bonus, 'sm ' + (sel.includes(w.bonus) ? 'match' : 'dim'))}</div></td></tr>`).join('')}
      </tbody></table></div>${total > 60 ? `<p class="hint">최근 60건만 표시</p>` : ''}</details>` : ''}`;
  }


  // ───────────────────────── 이벤트 ─────────────────────────

  function bind() {
    initMachine();
    initSpeetto();
    initFortune();
    // 탭: 각 프로그램(로또 / 스피또) 안에서만 전환
    $$('.app .tab').forEach(t => t.addEventListener('click', () => showTab(t.closest('.app'), t.dataset.tab)));

    // 아래 메뉴 (모든 화면 공통): 로또 화면 전환 + 운세 프로그램
    $$('.bnav .bn').forEach(b => b.addEventListener('click', () => {
      const go = b.dataset.go;
      if (go === 'fortune') {
        if (state.app !== 'fortune') setApp('fortune', true); else window.scrollTo({ top: 0 });
        return;
      }
      if (state.app !== 'lotto') setApp('lotto', true);
      showTab($('#app-lotto'), go);
      window.scrollTo({ top: 0 });
    }));
    $$('.app').forEach(app => {
      try {
        if (app.id === 'app-lotto') return;      // 로또는 항상 첫 단계(추천)부터
        const saved = localStorage.getItem('lotto.tab.' + app.id);
        const t = saved && app.querySelector(`.tab[data-tab="${saved}"]`);
        if (t) t.click();
      } catch (e) { /* 무시 */ }
    });

    // 상위 프로그램 전환: 로또 번호 분석기 / 스피또 시뮬레이터
    $$('.app-btn').forEach(b => b.addEventListener('click', () => setApp(b.dataset.app, true)));
    window.addEventListener('hashchange', () => setApp(appFromHash() || 'lotto', false));
    let startApp = appFromHash();
    if (!startApp) { try { startApp = localStorage.getItem('lotto.app'); } catch (e) { /* 무시 */ } }
    setApp(APP_IDS.includes(startApp) ? startApp : 'lotto', false);

    $('#rangeSel').addEventListener('change', e => { state.range = +e.target.value; refreshStats(); });
    $('#recentSel').addEventListener('change', e => { state.recentN = +e.target.value; refreshStats(); });

    buildPicker($('#prefPicker'), onPrefClick);
    buildPicker($('#checkPicker'), onCheckClick);

    $('#strategies').addEventListener('click', e => {
      const b = e.target.closest('.strat');
      if (!b) return;
      state.strategy = b.dataset.k;
      renderStrategies();
      scheduleProb();
    });

    ['#fSum', '#fOddEven', '#fHighLow', '#fRun', '#fSpread', '#companion'].forEach(id => $(id).addEventListener('change', scheduleProb));
    ['#fSumMin', '#fSumMax'].forEach(id => $(id).addEventListener('input', () => { state.sumTouched = true; scheduleProb(); }));

    $('#genBtn').addEventListener('click', generate);

    const onSetAction = (getList, label) => e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const r = getList()[+b.dataset.i];
      if (!r) return;
      if (b.dataset.act === 'copy') copyNums(r.nums);
      if (b.dataset.act === 'share') {
        const nextNo = state.allDraws[state.allDraws.length - 1].no + 1;
        window.AndroidBridge.share(`[로또 ${nextNo}회 ${label()}]\n${r.nums.join(', ')}`);
      }
      if (b.dataset.act === 'save') {
        const list = loadSaved();
        if (list.some(x => x.nums.join() === r.nums.join())) { toast('이미 저장한 조합입니다.'); return; }
        list.unshift({ nums: r.nums, fixed: r.fixed, at: new Date().toLocaleDateString('ko-KR') });
        storeSaved(list.slice(0, 50));
        renderSaved();
        toast('저장했어요 · 아래 ‘내 번호’에서 볼 수 있어요');
      }
    };
    $('#results').addEventListener('click', onSetAction(() => state.results, () => '추천 번호'));
    $('#tarotResults').addEventListener('click', onSetAction(() => state.tarot.results,
      () => `타로 추천 번호 · ${state.tarot.picks.map(p => p.card.name + (p.reversed ? '(역)' : '')).join(' · ')}`));

    $('#spreadSel').addEventListener('click', e => {
      const b = e.target.closest('button[data-n]');
      if (!b || state.tarot.revealing) return;
      state.tarot.spread = +b.dataset.n;
      $$('#spreadSel button').forEach(x => x.classList.toggle('active', x === b));
      startTarot();
    });
    $('#shuffleBtn').addEventListener('click', () => { if (!state.tarot.revealing) startTarot(); });
    $('#tarotDeck').addEventListener('click', e => {
      const b = e.target.closest('.dcard');
      if (b) onTarotPick(+b.dataset.i, b);
    });
    $('#tarotReroll').addEventListener('click', () => generateTarot(true));
    $('#tcGrid').addEventListener('click', onSetAction(() => state.tc.list, () => '로또 선생 번호'));
    $('#tcPickList').addEventListener('click', onSetAction(() => state.tc.list, () => '로또 선생 번호'));
    $('#tcPeriod').addEventListener('click', e => {
      const b = e.target.closest('button[data-p]');
      if (!b) return;
      state.tc.period = +b.dataset.p;
      $$('#tcPeriod button').forEach(x => x.classList.toggle('active', x === b));
      renderTcRank();
    });
    $('#tcMore').addEventListener('click', () => { state.tc.histN += 15; renderTcHist(); });
    $('#prMore').addEventListener('click', () => { state.pr.n += 30; renderPrizeTable(); });
    $('#prTable').addEventListener('click', e => {
      const th = e.target.closest('th[data-k]');
      if (!th) return;
      const k = th.dataset.k;
      state.pr.sort = { key: k, asc: state.pr.sort.key === k ? !state.pr.sort.asc : false };
      renderPrizeTable();
    });
    setInterval(updateCountdown, 30000);
    refreshOfficial();
    setInterval(refreshOfficial, 10 * 60 * 1000);
    $('#machineHistory').addEventListener('click', onSetAction(() => state.machine.history, () => '물리 추첨기 번호'));
    $('#todayResult').addEventListener('click', onSetAction(() => state.fortune.list, () => '사주 행운 번호'));

    $('#saved').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const list = loadSaved();
      const i = +b.dataset.i;
      if (b.dataset.act === 'copy-saved') copyNums(list[i].nums);
      if (b.dataset.act === 'check-saved') {
        state.checkSel = [...list[i].nums];
        renderCheck();
        $('#checkCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (b.dataset.act === 'del') { list.splice(i, 1); storeSaved(list); renderSaved(); toast('지웠어요'); }
    });
    $('#clearSaved').addEventListener('click', () => {
      if (!confirm('저장한 번호를 모두 지울까요?')) return;
      storeSaved([]); renderSaved();
    });

    $('#statsTable').addEventListener('click', e => {
      const th = e.target.closest('th[data-k]');
      if (!th) return;
      const k = th.dataset.k;
      state.sort = { key: k, asc: state.sort.key === k ? !state.sort.asc : k === 'n' };
      renderStatsTable();
    });

    $('#trendSeg').addEventListener('click', e => {
      const b = e.target.closest('button[data-n]');
      if (!b) return;
      state.trendN = +b.dataset.n;
      $$('#trendSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderPatterns();
    });

    $('#checkReset').addEventListener('click', () => { state.checkSel = []; renderCheck(); });
    $('#updateBtn').addEventListener('click', () => runUpdate(true));

    $('#fileInput').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        setData(await LottoData.loadFile(f));
        toast(`${f.name}: ${state.allDraws.length}회차를 불러왔습니다.`);
      } catch (err) {
        toast('불러오기 실패: ' + err.message);
      }
      e.target.value = '';
    });
  }


  /** 최신 회차 확인. force=false 는 앱 시작 시 자동 확인(추첨 후에만, 30분 간격) */
  async function runUpdate(force) {
    if (!state.allDraws.length || typeof LottoUpdater === 'undefined') return;
    const btn = $('#updateBtn');
    const lbl = btn.querySelector('span') || btn;
    btn.disabled = true;
    lbl.textContent = '확인 중…';
    try {
      const res = await LottoUpdater.check(state.allDraws, { force });
      if (res.status === 'updated') {
        const before = state.allDraws[state.allDraws.length - 1].no;
        setData(LottoData.merge(state.allDraws, res.added, '자동 업데이트'));
        const after = state.allDraws[state.allDraws.length - 1];
        if (after.no > before) {
          toast(`새 당첨 번호 추가: ${after.no > before + 1 ? `${before + 1}~` : ''}${after.no}회 (${after.nums.join(', ')} + ${after.bonus})`);
        }
      } else if (force && res.status === 'up-to-date') {
        toast(`이미 최신입니다 (${res.latestNo}회)`);
      }
    } catch (err) {
      if (force) toast('업데이트 실패: 인터넷 연결을 확인하세요');
      console.warn('update failed', err);
    } finally {
      btn.disabled = false;
      lbl.textContent = '최신 회차 확인';
    }
  }


  async function init() {
    bind();
    renderStrategies();
    renderPref();
    startTarot();
    try {
      setData(await LottoData.loadDefault());
      if (state.fortune.saju) renderToday();
    } catch (err) {
      $('#dataInfo').textContent = err.message;
      return;
    }
    runUpdate(false);
  }

  init();
})();
