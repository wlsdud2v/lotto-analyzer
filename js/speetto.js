/**
 * 스피또(즉석식 복권) 시뮬레이터 + 발행 현황.
 *
 * 당첨 구조: 동행복권 공식 안내(기본 발행 단위 기준)
 *   스피또1000  500만 매 · 1,000원 · 환급률 60%
 *   스피또2000  500만 매 · 2,000원 · 환급률 60.25%
 *   스피또500   400만 매 ·   500원 · 환급률 56%
 * 시뮬레이터의 카드 그림·게임 방식은 화면용으로 단순화한 것이며 실제 복권과 다릅니다.
 */
const LottoSpeetto = (() => {

  const GAMES = {
    SP1000: {
      name: '스피또1000', price: 1000, issue: 5000000, style: 'lucky',
      ranks: [
        { rank: 1, prize: 500000000, count: 1 },
        { rank: 2, prize: 20000000, count: 5 },
        { rank: 3, prize: 10000, count: 27500 },
        { rank: 4, prize: 5000, count: 125000 },
        { rank: 5, prize: 1000, count: 1500000 },
      ],
      decoys: [2000, 3000, 50000, 100000, 1000000, 100000000],
    },
    SP2000: {
      name: '스피또2000', price: 2000, issue: 5000000, style: 'match3',
      ranks: [
        { rank: 1, prize: 1000000000, count: 1 },
        { rank: 2, prize: 100000000, count: 3 },
        { rank: 3, prize: 10000000, count: 25 },
        { rank: 4, prize: 20000, count: 13750 },
        { rank: 5, prize: 4000, count: 350000 },
        { rank: 6, prize: 2000, count: 1400000 },
      ],
      decoys: [10000, 50000, 1000000],
    },
    SP500: {
      name: '스피또500', price: 500, issue: 4000000, style: 'match3',
      ranks: [
        { rank: 1, prize: 200000000, count: 1 },
        { rank: 2, prize: 1000000, count: 20 },
        { rank: 3, prize: 5000, count: 60000 },
        { rank: 4, prize: 500, count: 1200000 },
      ],
      decoys: [1000, 10000, 100000],
    },
  };

  for (const g of Object.values(GAMES)) {
    g.ranks.forEach(r => { r.p = r.count / g.issue; });
    g.winP = g.ranks.reduce((s, r) => s + r.p, 0);
    g.payout = g.ranks.reduce((s, r) => s + r.prize * r.count, 0) / (g.issue * g.price);
  }

  const LIVE_URL = t => `https://www.dhlottery.co.kr/st/selectPblcnDsctn.do?gdsType=${t}&gdsPrice=&gdsStatus=&pageNum=1&recordCountPerPage=8`;
  const MIRROR_URL = 'https://raw.githubusercontent.com/wlsdud2v/lotto-analyzer/main/data/speetto.json';


  // ───────────────────────── 난수 / 표기 ─────────────────────────

  function rand() {
    const a = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return a[0] / 4294967296;
  }

  const randInt = n => Math.floor(rand() * n);

  function won(n) {
    if (n >= 100000000) return (n / 100000000).toLocaleString('ko-KR') + '억';
    if (n >= 10000) return (n / 10000).toLocaleString('ko-KR') + '만';
    if (n >= 1000) return (n / 1000).toLocaleString('ko-KR') + '천';
    return n.toLocaleString('ko-KR');
  }

  const wonFull = n => n.toLocaleString('ko-KR') + '원';


  // ───────────────────────── 추첨 ─────────────────────────

  /** 한 장의 결과: 당첨 등위 객체 또는 null */
  function drawOutcome(game, u = rand()) {
    let acc = 0;
    for (const r of game.ranks) {
      acc += r.p;
      if (u < acc) return r;
    }
    return null;
  }


  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }


  /** 화면에 그릴 카드 내용 생성 (결과와 일치하도록) */
  function makeTicket(gameId, eg) {
    const game = GAMES[gameId];
    const win = drawOutcome(eg || game);
    const amounts = [...new Set([...game.ranks.map(r => r.prize), ...game.decoys])];

    if (game.style === 'match3') {
      // 같은 금액 3개면 당첨: 9칸
      const cells = [];
      const pool = amounts.filter(a => !win || a !== win.prize);
      if (win) cells.push(win.prize, win.prize, win.prize);
      const used = {};
      while (cells.length < 9) {
        const a = pool[randInt(pool.length)];
        if ((used[a] || 0) >= 2) continue;
        used[a] = (used[a] || 0) + 1;
        cells.push(a);
      }
      return { gameId, win, style: 'match3', cells: shuffle(cells).map(a => ({ amount: a, hit: win && a === win.prize })) };
    }

    // 행운숫자: 행운숫자 2개, 나의 숫자 6개 (각각 아래에 금액)
    const lucky = [];
    while (lucky.length < 2) { const n = 1 + randInt(30); if (!lucky.includes(n)) lucky.push(n); }
    const mine = [];
    const usedNums = new Set(lucky);
    const hitIdx = win ? randInt(6) : -1;
    for (let i = 0; i < 6; i++) {
      if (i === hitIdx) {
        mine.push({ num: lucky[randInt(2)], amount: win.prize, hit: true });
      } else {
        let n;
        do { n = 1 + randInt(30); } while (usedNums.has(n));
        usedNums.add(n);
        const decoyPool = amounts.filter(a => !win || a !== win.prize);
        mine.push({ num: n, amount: decoyPool[randInt(decoyPool.length)], hit: false });
      }
    }
    return { gameId, win, style: 'lucky', lucky, mine };
  }


  /** N장 한 번에 */
  function bulk(gameId, n, eg) {
    const game = eg || GAMES[gameId];
    const counts = {};
    let prize = 0, best = 0;
    for (let i = 0; i < n; i++) {
      const r = drawOutcome(game);
      if (r) {
        counts[r.rank] = (counts[r.rank] || 0) + 1;
        prize += r.prize;
        if (r.prize > best) best = r.prize;
      }
    }
    return { gameId, n, cost: n * game.price, prize, best, counts, eg: game };
  }


  function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }


  /** 1등이 나올 때까지 산다면 (기하분포 + 나머지 등위는 정규 근사) */
  function untilFirst(gameId, eg) {
    const game = eg || GAMES[gameId];
    const top = game.ranks[0];
    const n = Math.max(1, Math.ceil(Math.log(1 - rand()) / Math.log(1 - top.p)));
    const counts = { [top.rank]: 1 };
    let prize = top.prize;
    for (const r of game.ranks.slice(1)) {
      const q = r.p / (1 - top.p), m = (n - 1) * q;
      const c = Math.max(0, Math.round(m + Math.sqrt(m * (1 - q)) * gaussian()));
      counts[r.rank] = c;
      prize += c * r.prize;
    }
    return { gameId, n, cost: n * game.price, prize, best: top.prize, counts, untilFirst: true, eg: game };
  }


  // ───────────────────────── 잔여 반영 확률 ─────────────────────────

  /**
   * 현재 회차의 입고율·잔여로 '지금 1장 살 때' 등위별 확률을 추정.
   *  - 발행 매수 = 1등 발행 매수 × 기본 발행 단위(1등 1매당 500만/400만 매)
   *  - 판매 추정 = 3등(매수가 가장 많은 공개 등위)의 당첨 비율, 입고율을 넘지 않게
   *  - 남은 복권 = 발행 매수 × (1 − 판매 추정)   (최소 2%)
   *  - 확률 = 등위별 잔여 ÷ 남은 복권   (잔여 당첨권이 남은 복권에 고르게 섞여 있다고 가정)
   *  4등 이하는 공개되지 않아 공식 확률을 그대로 씀.
   */
  function liveModel(gameId, round) {
    const g = GAMES[gameId];
    const sets = round.rank1 && round.rank1.total ? round.rank1.total / g.ranks[0].count : 1;
    const N = sets * g.issue;
    const ship = Math.min(1, Math.max(0, (round.shipRate || 0) / 100));
    const r3 = round.rank3;
    let sold = r3 && r3.total ? (r3.total - r3.left) / r3.total : ship;
    sold = Math.max(0, Math.min(sold, ship));
    const R = Math.max(N * (1 - sold), N * 0.02);
    const probs = {};
    [round.rank1, round.rank2, round.rank3].forEach((q, i) => { if (q) probs[i + 1] = q.left / R; });
    return { gameId, round: round.round, N, sets, ship, sold, R, probs };
  }


  /** 확률을 바꾼 게임 객체 (probs 가 없으면 공식 구조) */
  function effective(gameId, probs) {
    const g = GAMES[gameId];
    const ranks = g.ranks.map(r => ({ ...r, p: probs && probs[r.rank] != null ? probs[r.rank] : r.p }));
    const winP = ranks.reduce((t, r) => t + r.p, 0);
    const payout = ranks.reduce((t, r) => t + r.p * r.prize, 0) / g.price;
    return { ...g, ranks, winP, payout, live: !!probs };
  }


  /** 큰 금액 짧게: 92억, 1.5억, 3,200만 */
  function shortWon(n) {
    if (!isFinite(n)) return '∞';
    if (n >= 1e12) return (Math.round(n / 1e11) / 10).toLocaleString('ko-KR') + '조';
    if (n >= 1e8) return (n >= 1e9 ? Math.round(n / 1e8) : Math.round(n / 1e7) / 10).toLocaleString('ko-KR') + '억';
    if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
    return Math.round(n).toLocaleString('ko-KR');
  }


  // ───────────────────────── 발행 현황 ─────────────────────────

  function parseQty(s) {
    const m = String(s || '').replace(/,/g, '').match(/(\d+)\s*매\s*\/\s*(\d+)\s*매/);
    return m ? { left: +m[1], total: +m[2] } : null;
  }


  function slim(x) {
    return {
      game: x.stGmTypeCd, name: x.stGmTypeNm, round: x.stEpsd, status: x.ntslStatus,
      shipRate: x.stSpmtRt, price: x.stNtslAmt,
      rank1: parseQty(x.stRnk1Rt), rank2: parseQty(x.stRnk2Rt), rank3: parseQty(x.stRnk3Rt),
      prize1: x.rnk1Atm, saleEnd: x.stNtslEndDt, payEnd: x.stGiveEndDt,
      dataDate: x.dataChgDt ? '20' + x.dataChgDt : null,
    };
  }


  /**
   * 앱: 동행복권에서 직접(실시간) → 실패 시 GitHub 사본
   * 웹: 같은 사이트의 data/speetto.json → GitHub 사본
   */
  async function loadStatus() {
    const getText = LottoUpdater.getText;
    if (window.AndroidBridge && window.AndroidBridge.fetchText) {
      try {
        const games = {};
        for (const g of Object.keys(GAMES)) {
          const j = JSON.parse(await getText(LIVE_URL(g)));
          games[g] = j.data.list.map(slim).sort((a, b) => b.round - a.round);
        }
        return { games, fetched_at: new Date().toISOString(), live: true };
      } catch (e) { /* 사본으로 */ }
    }
    if (location.protocol.startsWith('http')) {
      try {
        const r = await fetch('data/speetto.json', { cache: 'no-cache' });
        if (r.ok) return { ...(await r.json()), live: false };
      } catch (e) { /* 다음 */ }
    }
    return { ...JSON.parse(await getText(MIRROR_URL)), live: false };
  }


  return { GAMES, won, wonFull, shortWon, makeTicket, bulk, untilFirst, loadStatus, liveModel, effective };
})();
