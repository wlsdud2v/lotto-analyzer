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
    stats: null,
    pastKeys: new Set(),
    pref: new Map(),     // n -> 'fix' | 'exc'
    strategy: 'balanced',
    prob: null,          // 번호별 추천 확률 (index 1..45)
    sumTouched: false,
    results: [],
    checkSel: [],
    sort: { key: 'n', asc: true },
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
  }


  function renderHeader() {
    const all = state.allDraws;
    const first = all[0], last = all[all.length - 1];
    $('#dataInfo').textContent = `${first.no}회 ~ ${last.no}회 (${fmt(all.length)}회차) · ${state.source}`;
    const nextDate = addDays(last.date, 7);
    $('#latest').innerHTML = `
      <div class="lbl"><b>${last.no}회 당첨번호</b>${last.date}</div>
      <div class="balls">${last.nums.map(n => ball(n, 'sm')).join('')}<span class="plus">+</span>${ball(last.bonus, 'sm')}</div>
      <div class="lbl"><b>다음 ${last.no + 1}회</b>${nextDate} 추첨</div>`;
  }


  function refreshStats() {
    const draws = scopeDraws();
    state.stats = E.computeStats(draws, state.recentN);
    const s = state.stats;
    $('#rangeHint').textContent = `분석 대상 ${draws[0].no}회 ~ ${draws[draws.length - 1].no}회 · 회차당 이론 기대 출현 ${s.expected.toFixed(1)}번`;

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
    const fixedNote = `<p class="hint" style="grid-column:1/-1">${fixed.size ? `포함 번호 ${[...fixed].join(', ')}는 100%로 고정되어 목록에서 뺐습니다. ` : ''}같은 조건에서 완전 무작위로 고를 때의 기준 확률은 번호당 ${pct(base, 1)}입니다.</p>`;
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
      if (fixedNums().length >= MAX_FIX) { toast(`포함 번호는 최대 ${MAX_FIX}개까지 고를 수 있어요. 한 번 더 누르면 제외로 바뀝니다.`); state.pref.set(n, 'exc'); }
      else state.pref.set(n, 'fix');
    } else if (cur === 'fix') state.pref.set(n, 'exc');
    else state.pref.delete(n);

    if (45 - excludedNums().length - fixedNums().length < 6 - fixedNums().length) {
      state.pref.delete(n);
      toast('제외 번호가 너무 많아 6개를 채울 수 없습니다.');
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
      ? '선택 없음 — 선호 번호 없이 추천합니다.'
      : `${f.length ? `<b class="tag fix">포함</b> ${f.join(', ')}` : ''} ${x.length ? `&nbsp;<b class="tag exc">제외</b> ${x.join(', ')}` : ''}
         &nbsp;<button class="btn ghost sm" id="prefClear">초기화</button>`;
    const clr = $('#prefClear');
    if (clr) clr.onclick = () => { state.pref.clear(); renderPref(); scheduleProb(); };
  }


  function renderStrategies() {
    $('#strategies').innerHTML = Object.entries(E.STRATEGIES).map(([k, v]) =>
      `<button class="strat ${k === state.strategy ? 'active' : ''}" data-k="${k}"><b>${v.label}</b><span>${v.desc}</span></button>`).join('');
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
    $('#genInfo').textContent = `${label}${opts.fixed.length ? ` · 포함 ${opts.fixed.join(',')}` : ''}${weekly ? ` · ${nextNo}회 고정` : ''}`;
    renderResults();
  }


  function setMeta(nums) {
    const d = E.describe(nums);
    const bt = E.backtest(nums, state.allDraws);
    const r = bt.ranks;
    const parts = [];
    for (let k = 1; k <= 5; k++) if (r[k]) parts.push(`${k}등 ${r[k]}회`);
    const hist = parts.length ? `<span class="hit">과거 대입: ${parts.join(' · ')}</span>` : '과거 대입: 3개 이상 일치 없음';
    return `<span>합계 <b>${d.sum}</b></span><span>홀:짝 <b>${d.odd}:${d.even}</b></span><span>저:고 <b>${d.low}:${d.high}</b></span><span>${hist}</span>`;
  }


  function setRow(item, i, actions) {
    const fixed = new Set(item.fixed || []);
    return `
      <div class="set">
        <span class="idx">${String.fromCharCode(65 + i)}</span>
        <div class="balls">${item.nums.map(n => ball(n, fixed.has(n) ? 'fixed' : '')).join('')}</div>
        <div class="acts">${actions}</div>
        <div class="meta">${setMeta(item.nums)}${item.relaxed ? '<span class="warn">필터 조건을 모두 만족하는 조합을 찾지 못해 일부 필터를 완화했습니다</span>' : ''}${item.bonus ? `<span>보너스 <b>${item.bonus}</b></span><span>나온 순서 ${item.order.join(' → ')}</span>` : ''}${item.at ? `<span>${item.at} 저장</span>` : ''}</div>
      </div>`;
  }


  function setActions(i) {
    const share = window.AndroidBridge ? `<button class="btn ghost sm" data-act="share" data-i="${i}">공유</button>` : '';
    return `<button class="btn ghost sm" data-act="copy" data-i="${i}">복사</button>${share}<button class="btn ghost sm" data-act="save" data-i="${i}">저장</button>`;
  }


  function renderResults() {
    const el = $('#results');
    if (!state.results.length) { el.innerHTML = '<p class="empty">설정을 고른 뒤 <b>추천 번호 생성</b>을 누르세요.</p>'; return; }
    el.innerHTML = state.results.map((r, i) => setRow(r, i, setActions(i))).join('');
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
        setMachineStatus(`추첨 완료 — ${main.join(', ')} + 보너스 ${drawn[6]}`, false);
        $('#drawBtn').disabled = false;
        $('#drawBtn').textContent = '다시 추첨';
        $('#trayHint').textContent = '나온 순서대로 놓였습니다. 아래 기록에서 정렬된 번호를 저장할 수 있어요';
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
      ? list.map((r, i) => setRow(r, i, `<button class="btn ghost sm" data-act="copy-saved" data-i="${i}">복사</button><button class="btn ghost sm" data-act="del" data-i="${i}">삭제</button>`)).join('')
      : '<p class="empty">마음에 드는 추천 조합을 저장해 두면 이 브라우저에 남아 있습니다.</p>';
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
      <div class="kpi"><div class="k">분석 회차</div><div class="v">${fmt(s.total)}회</div><div class="s">${draws[0].date} ~ ${draws[draws.length - 1].date}</div></div>
      <div class="kpi"><div class="k">최다 출현</div><div class="v">${top.map(x => ball(x.n, 'sm')).join('')}</div><div class="s">${top.map(x => `${x.n}번 ${x.count}회`).join(' · ')}</div></div>
      <div class="kpi"><div class="k">최근 ${s.recentN}회 강세</div><div class="v">${hotRecent.map(x => ball(x.n, 'sm')).join('')}</div><div class="s">${hotRecent.map(x => `${x.n}번 ${x.recent}회`).join(' · ')}</div></div>
      <div class="kpi"><div class="k">최장 미출현</div><div class="v">${cold.map(x => ball(x.n, 'sm')).join('')}</div><div class="s">${cold.map(x => `${x.n}번 ${x.gap}회째`).join(' · ')}</div></div>`;

    // 히트맵
    const ratios = arr.map(x => x.ratio);
    const lo = Math.min(...ratios), hi = Math.max(...ratios);
    $('#heat').innerHTML = arr.map(x => {
      const t = hi === lo ? 0.5 : (x.ratio - lo) / (hi - lo);
      const mix = Math.round(8 + t * 72);
      const ink = mix > 50 ? '#fff' : 'var(--text)';
      return `<div class="hcell" style="background:color-mix(in srgb, var(--accent) ${mix}%, var(--surface));color:${ink}" title="${x.n}번: ${x.count}회 (이론 대비 ${pct(x.ratio, 0)})">
        <div class="n">${x.n}</div><div class="r">${pct(x.rate)}</div></div>`;
    }).join('');

    renderChart();
    renderStatsTable();
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


  // ───────────────────────── 내 번호 확인 ─────────────────────────

  function onCheckClick(n) {
    const i = state.checkSel.indexOf(n);
    if (i >= 0) state.checkSel.splice(i, 1);
    else if (state.checkSel.length < 6) state.checkSel.push(n);
    else { toast('6개까지 고를 수 있습니다.'); return; }
    renderCheck();
  }


  function renderCheck() {
    const sel = [...state.checkSel].sort((a, b) => a - b);
    $$('#checkPicker .pick').forEach(b => b.classList.toggle('on', sel.includes(+b.dataset.n)));
    $('#checkSel').innerHTML = sel.length ? sel.map(n => ball(n)).join('') : '<span class="hint" style="margin:0">선택한 번호가 여기에 표시됩니다</span>';

    const out = $('#checkResult');
    if (sel.length < 6 || !state.allDraws.length) { out.innerHTML = ''; return; }

    const bt = E.backtest(sel, state.allDraws);
    const d = E.describe(sel);
    const labels = ['', '1등', '2등', '3등', '4등', '5등'];
    const sub = ['', '6개 일치', '5개+보너스', '5개 일치', '4개 일치', '3개 일치'];
    const total = bt.wins.length;
    out.innerHTML = `
      <p class="hint" style="margin-top:16px">합계 ${d.sum} · 홀:짝 ${d.odd}:${d.even} · 저:고 ${d.low}:${d.high} — 전체 ${fmt(state.allDraws.length)}회 중 ${total}회 당첨권(5등 이상)</p>
      <div class="ranks">${[1, 2, 3, 4, 5].map(k => `<div class="rank ${bt.ranks[k] ? 'has' : ''}"><div class="k">${labels[k]} · ${sub[k]}</div><div class="v">${bt.ranks[k]}</div></div>`).join('')}</div>
      ${total ? `<div class="table-wrap"><table class="wins"><thead><tr><th>회차</th><th>날짜</th><th>등수</th><th>당첨번호</th></tr></thead><tbody>
        ${bt.wins.slice(0, 60).map(w => `<tr><td>${w.no}회</td><td>${w.date}</td><td><b>${labels[w.rank]}</b></td>
          <td><div class="balls">${w.nums.map(n => ball(n, 'sm ' + (sel.includes(n) ? 'match' : 'dim'))).join('')}<span class="plus">+</span>${ball(w.bonus, 'sm ' + (sel.includes(w.bonus) ? 'match' : 'dim'))}</div></td></tr>`).join('')}
      </tbody></table></div>${total > 60 ? `<p class="hint">상위 60건만 표시했습니다.</p>` : ''}` : ''}`;
  }


  // ───────────────────────── 이벤트 ─────────────────────────

  function bind() {
    initMachine();
    initSpeetto();
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      $$('.tab').forEach(x => x.classList.toggle('active', x === t));
      $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
      if (state.machine.m) state.machine.m.setVisible(t.dataset.tab === 'machine');
      if (t.dataset.tab === 'speetto') onSpeettoShown();
      try { localStorage.setItem('lotto.tab', t.dataset.tab); } catch (e) { /* 무시 */ }
    }));
    try {
      const saved = localStorage.getItem('lotto.tab');
      if (saved) { const t = $(`.tab[data-tab="${saved}"]`); t && t.click(); }
    } catch (e) { /* 무시 */ }

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
        toast('저장했습니다. \'번호 추천\' 탭의 저장한 번호에서 볼 수 있어요.');
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
    $('#machineHistory').addEventListener('click', onSetAction(() => state.machine.history, () => '물리 추첨기 번호'));

    $('#saved').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const list = loadSaved();
      const i = +b.dataset.i;
      if (b.dataset.act === 'copy-saved') copyNums(list[i].nums);
      if (b.dataset.act === 'del') { list.splice(i, 1); storeSaved(list); renderSaved(); }
    });
    $('#clearSaved').addEventListener('click', () => { storeSaved([]); renderSaved(); });

    $('#statsTable').addEventListener('click', e => {
      const th = e.target.closest('th[data-k]');
      if (!th) return;
      const k = th.dataset.k;
      state.sort = { key: k, asc: state.sort.key === k ? !state.sort.asc : k === 'n' };
      renderStatsTable();
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
    btn.disabled = true;
    btn.textContent = '확인 중…';
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
      btn.textContent = '최신 회차 확인';
    }
  }


  async function init() {
    bind();
    renderStrategies();
    renderPref();
    startTarot();
    try {
      setData(await LottoData.loadDefault());
    } catch (err) {
      $('#dataInfo').textContent = err.message;
      return;
    }
    runUpdate(false);
  }

  init();
})();
