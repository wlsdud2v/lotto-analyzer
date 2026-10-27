/**
 * 1등 당첨금 통계와 다음 회차 예상 1등 당첨금.
 *
 * 예상 방법 (과거 데이터로 검증: 최근 2년 1등 총액 오차 중앙값 약 2%)
 *  1) 예상 판매액 = 직전 4회 판매액 평균
 *  2) 1등 배분 비율 = 최근 104회 중 '이월 없는 회차'의 (1등 총 당첨금 ÷ 판매액) 중앙값  ≈ 24%
 *     (판매액의 50%가 당첨금, 4·5등 고정 금액을 뺀 나머지의 75%가 1등 몫이라 이론값도 약 24%)
 *  3) 예상 1등 총 당첨금 = 예상 판매액 × 배분 비율 + 이월금(직전 회차에 1등이 없었다면 그 몫)
 *  4) 1인당 = 총 당첨금 ÷ 당첨자 수 (최근 52주 평균 당첨자 수 기준, 당첨자 수별 표도 제공)
 */
const LottoJackpot = (() => {

  const median = arr => {
    const a = [...arr].sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : 0;
  };

  const hasMoney = d => d && d.winners != null && d.sales > 0;


  function estimate(draws) {
    const n = draws.length;
    if (n < 10) return null;
    const last4 = draws.slice(-4).filter(hasMoney);
    if (last4.length < 4) return null;

    const sales = last4.reduce((s, d) => s + d.sales, 0) / last4.length;

    const ratios = [];
    for (let i = Math.max(1, n - 104); i < n; i++) {
      const d = draws[i], p = draws[i - 1];
      if (hasMoney(d) && hasMoney(p) && d.winners > 0 && p.winners > 0) ratios.push(d.prize * d.winners / d.sales);
    }
    if (ratios.length < 10) return null;
    const ratio = median(ratios);

    // 이월금: 최근 회차부터 1등이 없던 회차들의 몫을 더함
    let carry = 0, carryRounds = 0;
    for (let i = n - 1; i >= 0 && hasMoney(draws[i]) && draws[i].winners === 0; i--) {
      carry += draws[i].sales * ratio;
      carryRounds++;
    }

    const pool = sales * ratio + carry;
    const recent = draws.slice(-52).filter(hasMoney);
    const avgWinners = recent.reduce((s, d) => s + d.winners, 0) / recent.length;
    const minW = Math.min(...recent.map(d => d.winners)), maxW = Math.max(...recent.map(d => d.winners));
    const scenarios = [1, 5, 10, 15, 20, 30].map(w => ({ winners: w, each: pool / w }));

    const lastDraw = draws[n - 1];
    return {
      round: lastDraw.no + 1,
      sales, ratio, carry, carryRounds, pool,
      avgWinners, minW, maxW,
      perPerson: pool / Math.max(1, Math.round(avgWinners)),
      roundedWinners: Math.max(1, Math.round(avgWinners)),
      scenarios,
    };
  }


  /** 역대 1등 통계 */
  function history(draws) {
    const list = draws.filter(hasMoney);
    const won = list.filter(d => d.winners > 0);
    if (!won.length) return null;
    const max = won.reduce((a, b) => (b.prize > a.prize ? b : a));
    const min = won.reduce((a, b) => (b.prize < a.prize ? b : a));
    const recent = list.slice(-52).filter(d => d.winners > 0);
    const byYear = {};
    for (const d of won) {
      const y = d.date.slice(0, 4);
      (byYear[y] = byYear[y] || []).push(d);
    }
    const years = Object.keys(byYear).sort().map(y => ({
      year: y,
      avg: byYear[y].reduce((s, d) => s + d.prize, 0) / byYear[y].length,
      winners: byYear[y].reduce((s, d) => s + d.winners, 0) / byYear[y].length,
      rounds: byYear[y].length,
    }));
    return {
      list, max, min,
      recentAvg: recent.reduce((s, d) => s + d.prize, 0) / recent.length,
      recentWinners: recent.reduce((s, d) => s + d.winners, 0) / recent.length,
      rollovers: list.filter(d => d.winners === 0),
      years,
    };
  }


  /** 1억 이상은 '억', 그 아래는 '만' 단위 */
  function eok(n, digits = 1) {
    if (n >= 1e8) return (n / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: n >= 1e10 ? 0 : digits }) + '억';
    return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
  }


  // ───────────── 동행복권 발표값 (1등 예상 총 당첨금) ─────────────

  const LIVE = {
    amt: 'https://www.dhlottery.co.kr/lt645/selectRnk1ExpcAmt.do',
    ths: 'https://www.dhlottery.co.kr/lt645/selectThsLt645Info.do',
  };
  const MIRROR = 'https://wlsdud2v.github.io/lotto-analyzer/data/jackpot.json';
  const kst = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14) || '00'}+09:00`;


  /**
   * 앱: 동행복권에서 직접(실시간) → 웹: 같은 사이트 data/jackpot.json (매시간 갱신) → 사이트 사본.
   * 실패하면 null (화면은 자체 추정으로 대체).
   */
  async function loadOfficial() {
    const getText = typeof LottoUpdater !== 'undefined' ? LottoUpdater.getText : null;
    if (window.AndroidBridge && window.AndroidBridge.fetchText && getText) {
      try {
        const amt = JSON.parse(await getText(`${LIVE.amt}?_=${Date.now()}`)).data.result;
        const ths = JSON.parse(await getText(`${LIVE.ths}?_=${Date.now()}`)).data.result;
        const d = ths.ltRflYmd;
        return {
          round: +ths.ltEpsd, live: true,
          draw_date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          close_at: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${String(ths.ltRflHh).padStart(2, '0')}:${String(ths.ltRflMm).padStart(2, '0')}:00+09:00`,
          expected_first_total: +amt.rnk1ExpcAmt, accumulated_sales: +amt.acmlRvnAmt, as_of: kst(String(amt.giveDt)),
        };
      } catch (e) { /* 사본으로 */ }
    }
    const tryJson = async url => {
      try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
    };
    let j = location.protocol.startsWith('http') ? await tryJson(`data/jackpot.json?_=${Date.now()}`) : null;
    if (!j) j = await tryJson(`${MIRROR}?_=${Date.now()}`);
    return j && j.expected_first_total > 0 ? { ...j, live: false } : null;
  }


  return { estimate, history, eok, loadOfficial };
})();
