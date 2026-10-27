/**
 * 추첨 데이터 로딩/파싱.
 * 모든 입력(내장 JS, JSON, CSV)을 아래 형태의 배열로 통일합니다 (회차 오름차순).
 *   { no: 1247, date: '2026-10-24', nums: [8,14,21,22,42,45], bonus: 24 }
 */
const LottoData = (() => {

  /** 1등 당첨금 정보 (없으면 null) */
  const money = (prize, winners, sales) => (winners == null && prize == null ? {} : { prize: +prize || 0, winners: +winners || 0, sales: +sales || 0 });


  function fromRows(rows) {
    return rows.map(r => ({ no: +r[0], date: r[1], nums: r.slice(2, 8).map(Number).sort((a, b) => a - b), bonus: +r[8], ...money(r[9], r[10], r[11]) }));
  }


  function fromJson(obj) {
    if (obj.rows) return fromRows(obj.rows);
    const list = Array.isArray(obj) ? obj : obj.draws;
    if (!Array.isArray(list)) throw new Error('JSON 형식을 알 수 없습니다 (draws 배열 필요)');
    return list.map(d => ({
      no: +(d.draw_no ?? d.no ?? d.drwNo),
      date: String(d.date ?? d.drwNoDate ?? '').slice(0, 10),
      nums: (d.numbers ?? d.nums ?? [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6]).map(Number).sort((a, b) => a - b),
      bonus: +(d.bonus ?? d.bonus_no ?? d.bnusNo ?? 0),
      ...money(
        d.first_prize ?? d.prize ?? (d.divisions && d.divisions[0] ? d.divisions[0].prize : d.firstWinamnt),
        d.first_winners ?? d.winners ?? (d.divisions && d.divisions[0] ? d.divisions[0].winners : d.firstPrzwnerCo),
        d.total_sales ?? d.sales ?? d.total_sales_amount ?? d.totSellamnt),
    }));
  }


  /** 헤더: 회차,추첨일,번호1..번호6,보너스,... */
  function fromCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const out = [];
    for (const line of lines) {
      const c = line.split(',').map(s => s.trim());
      if (!/^\d+$/.test(c[0])) continue;   // 헤더 등 건너뜀
      out.push({ no: +c[0], date: c[1], nums: c.slice(2, 8).map(Number).sort((a, b) => a - b), bonus: +c[8], ...(c.length > 9 ? money(c[9], c[10], c[11]) : {}) });
    }
    return out;
  }


  function validate(draws) {
    const byNo = new Map();     // 같은 회차가 겹치면 뒤의 것으로
    for (const d of draws) {
      if (d.no > 0 && d.nums.length === 6 && new Set(d.nums).size === 6 && d.nums.every(n => n >= 1 && n <= 45)) byNo.set(d.no, d);
    }
    const ok = [...byNo.values()];
    if (!ok.length) throw new Error('유효한 회차 데이터가 없습니다');
    ok.sort((a, b) => a.no - b.no);
    return ok;
  }


  // 사용자가 직접 불러온 최신 데이터는 브라우저(앱)에 보관해 다음 실행 때도 사용
  const STORE_KEY = 'lotto.userData.v1';

  function readStored() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      return s && Array.isArray(s.rows) ? { draws: validate(fromRows(s.rows)), source: s.source + ' (저장됨)' } : null;
    } catch (e) { return null; }
  }

  function writeStored(draws, source) {
    try {
      const rows = draws.map(d => [d.no, d.date, ...d.nums, d.bonus, d.prize || 0, d.winners || 0, d.sales || 0]);
      localStorage.setItem(STORE_KEY, JSON.stringify({ source, rows }));
    } catch (e) { /* 저장 공간 부족 등 — 이번 실행에서만 사용 */ }
  }

  const latestNo = r => (r ? r.draws[r.draws.length - 1].no : 0);


  /** 후보: http 로 열렸으면 lotto_draws.json, 내장 lotto_data.js, 직접 불러와 저장된 데이터 → 가장 최신 회차를 사용 */
  async function loadDefault() {
    const candidates = [];
    if (location.protocol.startsWith('http')) {
      try {
        const res = await fetch('data/lotto_draws.json', { cache: 'no-cache' });
        if (res.ok) candidates.push({ draws: validate(fromJson(await res.json())), source: 'data/lotto_draws.json' });
      } catch (e) { /* 다른 후보 사용 */ }
    }
    if (window.LOTTO_DATA) {
      try { candidates.push({ draws: validate(fromJson(window.LOTTO_DATA)), source: '내장 데이터' }); } catch (e) { /* 무시 */ }
    }
    const stored = readStored();
    if (stored) candidates.push(stored);
    if (!candidates.length) throw new Error('데이터 파일을 찾을 수 없습니다. 상단의 "데이터 불러오기"로 JSON/CSV 파일을 선택하세요.');
    const best = candidates.reduce((a, b) => (latestNo(b) > latestNo(a) ? b : a));
    // 예전에 저장된 데이터에는 당첨금 정보가 없을 수 있어 다른 후보에서 채움
    const money = new Map();
    for (const c of candidates) for (const d of c.draws) if (d.winners != null && !money.has(d.no)) money.set(d.no, d);
    for (const d of best.draws) {
      if (d.winners == null && money.has(d.no)) { const m = money.get(d.no); d.prize = m.prize; d.winners = m.winners; d.sales = m.sales; }
    }
    return best;
  }


  async function loadFile(file) {
    const text = (await file.text()).replace(/^﻿/, '');
    // 안드로이드 파일 선택기는 확장자가 없는 이름을 줄 수 있어 내용으로 형식을 판별
    const isJson = /^\s*[\[{]/.test(text);
    const draws = validate(isJson ? fromJson(JSON.parse(text)) : fromCsv(text));
    const source = file.name || (isJson ? 'JSON 파일' : 'CSV 파일');
    writeStored(draws, source);
    return { draws, source };
  }


  /** 자동 업데이트로 받은 회차를 합치고 저장 */
  function merge(draws, added, source) {
    const merged = validate([...draws, ...added]);
    writeStored(merged, source);
    return { draws: merged, source };
  }


  return { loadDefault, loadFile, merge };
})();
