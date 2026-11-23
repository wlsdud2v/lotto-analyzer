/**
 * 최신 당첨 번호 자동 업데이트.
 * 출처: https://github.com/smok95/lotto (동행복권 결과를 매주 반영하는 공개 저장소)
 *
 * - 마지막 보유 회차 + 7일(토) 21:00(KST)이 지났을 때만 확인하고, 30분 안에는 다시 확인하지 않습니다.
 * - 안드로이드 앱에서는 네이티브(AndroidBridge.fetchText)로 받고, 브라우저에서는 fetch 를 씁니다.
 */
const LottoUpdater = (() => {

  const BASE = 'https://raw.githubusercontent.com/smok95/lotto/main/results';
  const CHECK_KEY = 'lotto.lastCheck.v1';
  const THROTTLE_MS = 30 * 60 * 1000;
  const pending = {};
  let seq = 0;


  // 네이티브 요청 완료 콜백 (MainActivity 가 호출)
  window.__lottoNativeDone = (id, ok, body) => {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    ok ? p.resolve(body) : p.reject(new Error(body));
  };


  function getText(url) {
    if (window.AndroidBridge && window.AndroidBridge.fetchText) {
      return new Promise((resolve, reject) => {
        const id = String(++seq);
        pending[id] = { resolve, reject };
        window.AndroidBridge.fetchText(url, id);
        setTimeout(() => { if (pending[id]) { delete pending[id]; reject(new Error('시간 초과')); } }, 30000);
      });
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    return fetch(url, { cache: 'no-store', signal: ctl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .finally(() => clearTimeout(t));
  }

  const getJson = url => getText(url).then(t => JSON.parse(t));


  const hasMoney = d => d.winners != null && d.sales > 0;

  const toDraw = d => {
    const draw = {
      no: +d.draw_no,
      date: String(d.date).slice(0, 10),
      nums: d.numbers.map(Number).sort((a, b) => a - b),
      bonus: +d.bonus_no,
    };
    // 추첨 직후에는 원본에 당첨금·판매액이 아직 없을 수 있음 → 0으로 채우지 않고 '정보 없음'으로 둠
    const first = d.divisions && d.divisions[0];
    if (first && first.winners != null && +d.total_sales_amount > 0) {
      draw.prize = first.winners ? +first.prize : 0;
      draw.winners = +first.winners || 0;
      draw.sales = +d.total_sales_amount;
    }
    return draw;
  };


  /** 다음 추첨(마지막 회차 +7일 토요일 21:00 KST = 12:00 UTC)이 지났는가 */
  function isDue(draws) {
    const [y, m, d] = draws[draws.length - 1].date.split('-').map(Number);
    return Date.now() >= Date.UTC(y, m - 1, d + 7, 12, 0);
  }


  /**
   * 새 회차 추가 + 최근 회차 중 당첨금 정보가 빠진 회차 다시 받기.
   * @returns {Promise<{status:'not-due'|'throttled'|'up-to-date'|'updated', added?:Array, latestNo?:number}>}
   */
  async function check(draws, { force = false } = {}) {
    const missing = draws.slice(-6).filter(d => !hasMoney(d)).map(d => d.no);
    if (!force) {
      if (!isDue(draws) && !missing.length) return { status: 'not-due' };
      let last = 0;
      try { last = +localStorage.getItem(CHECK_KEY) || 0; } catch (e) { /* 무시 */ }
      if (Date.now() - last < THROTTLE_MS) return { status: 'throttled' };
    }
    try { localStorage.setItem(CHECK_KEY, String(Date.now())); } catch (e) { /* 무시 */ }

    const have = draws[draws.length - 1].no;
    const latest = await getJson(`${BASE}/latest.json`);

    let list = [];
    if (latest.draw_no > have) {
      if (latest.draw_no - have > 30) {
        list = (await getJson(`${BASE}/all.json`)).filter(d => d.draw_no > have);
      } else {
        for (let no = have + 1; no < latest.draw_no; no++) list.push(await getJson(`${BASE}/${no}.json`));
        list.push(latest);
      }
    }
    const fresh = list.map(toDraw);

    // 당첨금 정보 보충 (원본에도 아직 없으면 건너뜀 — 30분 뒤 다시 시도)
    const repaired = [];
    for (const no of missing) {
      try {
        const d = toDraw(no === latest.draw_no ? latest : await getJson(`${BASE}/${no}.json`));
        if (hasMoney(d)) repaired.push(d);
      } catch (e) { /* 다음에 다시 */ }
    }

    if (!fresh.length && !repaired.length) return { status: 'up-to-date', latestNo: latest.draw_no };
    return { status: 'updated', added: [...repaired, ...fresh], latestNo: latest.draw_no };
  }


  return { check, getText };
})();
