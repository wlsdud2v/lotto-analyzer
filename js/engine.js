/**
 * 통계 계산 + 추천 엔진.
 *
 * 주의: 로또는 매 회 독립 시행이라 어떤 번호든 실제 당첨 확률은 같습니다(번호당 6/45, 조합당 1/8,145,060).
 * 이 엔진의 "추천 확률"은 과거 출현 패턴(빈도·최근 흐름·미출현 기간)으로 가중치를 준 뒤
 * 추천 생성기가 그 번호를 고를 확률을 뜻합니다.
 */
const LottoEngine = (() => {

  const N = 45;
  const PICK = 6;
  const THEORY_RATE = PICK / N;           // 0.1333…
  const TOTAL_COMBOS = 8145060;


  // ───────────────────────── 난수 ─────────────────────────

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }


  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }


  // ───────────────────────── 통계 ─────────────────────────

  /**
   * @param {Array} draws  분석 대상 회차 (오름차순)
   * @param {number} recentN 최근 흐름 기준 회차 수
   */
  function computeStats(draws, recentN) {
    const total = draws.length;
    const latestNo = draws[total - 1].no;
    const recentFrom = Math.max(0, total - recentN);
    const nums = [];
    for (let n = 1; n <= N; n++) nums[n] = { n, count: 0, bonus: 0, recent: 0, lastNo: null, maxGap: 0, _prev: draws[0].no - 1 };

    const co = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(0));
    const sums = [];

    draws.forEach((d, i) => {
      for (const n of d.nums) {
        const s = nums[n];
        s.count++;
        if (i >= recentFrom) s.recent++;
        s.maxGap = Math.max(s.maxGap, d.no - s._prev - 1);
        s._prev = d.no;
        s.lastNo = d.no;
      }
      nums[d.bonus] && nums[d.bonus].bonus++;
      for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) { co[d.nums[a]][d.nums[b]]++; co[d.nums[b]][d.nums[a]]++; }
      sums.push(d.nums.reduce((x, y) => x + y, 0));
    });

    const expected = total * THEORY_RATE;
    const expectedRecent = Math.min(recentN, total) * THEORY_RATE;
    for (let n = 1; n <= N; n++) {
      const s = nums[n];
      s.rate = s.count / total;                       // 회당 출현률(역대)
      s.ratio = s.count / expected;                    // 이론 대비 (1.0 = 평균)
      s.recentRatio = s.recent / expectedRecent;
      s.gap = s.lastNo == null ? total : latestNo - s.lastNo;   // 최근 몇 회 연속 미출현
      delete s._prev;
    }

    sums.sort((a, b) => a - b);
    const q = p => sums[Math.floor((sums.length - 1) * p)];
    return { total, latestNo, recentN: Math.min(recentN, total), expected, nums, co, sumP10: q(0.1), sumP90: q(0.9), sumAvg: sums.reduce((a, b) => a + b, 0) / sums.length };
  }


  // ───────────────────────── 가중치 ─────────────────────────

  function normalize(arr) {
    const vals = arr.slice(1);
    const min = Math.min(...vals), max = Math.max(...vals);
    return arr.map((v, i) => (i === 0 ? 0 : max === min ? 0.5 : (v - min) / (max - min)));
  }


  const STRATEGIES = {
    balanced: { label: '균형형', desc: '역대 빈도 40% · 최근 흐름 35% · 미출현 기간 25%' },
    hot:      { label: '핫 넘버', desc: '역대·최근에 자주 나온 번호 위주' },
    cold:     { label: '콜드 넘버', desc: '오래 안 나왔거나 덜 나온 번호 위주' },
    random:   { label: '완전 랜덤', desc: '통계 가중치 없이 균등 추첨 (필터만 적용)' },
  };


  /**
   * 번호별 선택 가중치 (index 1..45). 고정·제외 번호는 0.
   * opts: { strategy, fixed:[], excluded:[], companion:boolean }
   */
  function buildWeights(stats, opts) {
    const f = normalize(stats.nums.map(s => (s ? s.count : 0)));
    const r = normalize(stats.nums.map(s => (s ? s.recent : 0)));
    const g = normalize(stats.nums.map(s => (s ? Math.min(s.gap, 30) : 0)));   // 30회 이상은 동일 취급

    const w = new Array(N + 1).fill(0);
    for (let n = 1; n <= N; n++) {
      let score;
      switch (opts.strategy) {
        case 'hot':    score = 0.55 * f[n] + 0.45 * r[n]; break;
        case 'cold':   score = 0.6 * g[n] + 0.4 * (1 - f[n]); break;
        case 'random': score = 0.5; break;
        default:       score = 0.4 * f[n] + 0.35 * r[n] + 0.25 * g[n];
      }
      w[n] = 0.25 + score;          // 어떤 번호도 확률 0이 되지 않도록 바닥값
    }

    // 선호 번호와 과거에 함께 많이 나온 번호 가산
    if (opts.companion && opts.fixed.length && opts.strategy !== 'random') {
      const c = new Array(N + 1).fill(0);
      for (let n = 1; n <= N; n++) for (const p of opts.fixed) c[n] += stats.co[p][n];
      const cn = normalize(c);
      for (let n = 1; n <= N; n++) w[n] *= 1 + 0.8 * cn[n];
    }

    for (const n of opts.fixed) w[n] = 0;
    for (const n of opts.excluded) w[n] = 0;
    return w;
  }


  // ───────────────────────── 조합 필터 ─────────────────────────

  function describe(set) {
    const sum = set.reduce((a, b) => a + b, 0);
    const odd = set.filter(n => n % 2).length;
    const high = set.filter(n => n >= 23).length;
    let run = 1, maxRun = 1;
    for (let i = 1; i < set.length; i++) { run = set[i] === set[i - 1] + 1 ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
    const decades = new Set(set.map(n => Math.min(4, Math.floor((n - 1) / 10)))).size;
    return { sum, odd, even: 6 - odd, high, low: 6 - high, maxRun, decades };
  }


  function passFilters(set, filters, pastKeys) {
    const d = describe(set);
    if (filters.sum && (d.sum < filters.sumMin || d.sum > filters.sumMax)) return false;
    if (filters.oddEven && (d.odd === 0 || d.odd === 6)) return false;
    if (filters.highLow && (d.high === 0 || d.high === 6)) return false;
    if (filters.noRun && d.maxRun >= 3) return false;
    if (filters.spread && d.decades < 3) return false;
    if (pastKeys.has(set.join(','))) return false;          // 역대 1등 조합과 동일한 조합 제외
    return true;
  }


  // ───────────────────────── 생성 ─────────────────────────

  function weightedPick(weights, rng) {
    let total = 0;
    for (let n = 1; n <= N; n++) total += weights[n];
    if (total <= 0) return -1;
    let r = rng() * total;
    for (let n = 1; n <= N; n++) { r -= weights[n]; if (r <= 0 && weights[n] > 0) return n; }
    for (let n = N; n >= 1; n--) if (weights[n] > 0) return n;
    return -1;
  }


  function drawOne(weights, fixed, rng) {
    const w = weights.slice();
    const set = fixed.slice();
    while (set.length < PICK) {
      const n = weightedPick(w, rng);
      if (n < 0) return null;
      set.push(n);
      w[n] = 0;
    }
    return set.sort((a, b) => a - b);
  }


  /** 필터를 통과하는 한 세트. 필터 조건이 너무 빡빡하면 relaxed=true 로 필터 없이 반환 */
  function generateSet(weights, fixed, filters, pastKeys, rng, maxTry = 4000) {
    let last = null;
    for (let i = 0; i < maxTry; i++) {
      const s = drawOne(weights, fixed, rng);
      if (!s) return null;
      last = s;
      if (passFilters(s, filters, pastKeys)) return { set: s, relaxed: false };
    }
    return { set: last, relaxed: true };
  }


  function generate(count, weights, fixed, filters, pastKeys, rng) {
    const out = [];
    const seen = new Set();
    for (let guard = 0; out.length < count && guard < count * 30; guard++) {
      const r = generateSet(weights, fixed, filters, pastKeys, rng);
      if (!r) break;
      const key = r.set.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }


  /** 몬테카를로로 "추천 생성기가 이 번호를 포함할 확률" 추정 (고정 번호 = 100%) */
  function inclusionProbability(weights, fixed, filters, pastKeys, samples = 6000) {
    const hits = new Array(N + 1).fill(0);
    const rng = mulberry32(12345);
    let ok = 0;
    for (let i = 0; i < samples; i++) {
      const r = generateSet(weights, fixed, filters, pastKeys, rng, 200);
      if (!r) break;
      ok++;
      for (const n of r.set) hits[n]++;
    }
    return hits.map(h => (ok ? h / ok : 0));
  }


  // ───────────────────────── 과거 대조 ─────────────────────────

  function rankOf(set, draw) {
    const m = set.filter(n => draw.nums.includes(n)).length;
    if (m === 6) return 1;
    if (m === 5 && set.includes(draw.bonus)) return 2;
    if (m === 5) return 3;
    if (m === 4) return 4;
    if (m === 3) return 5;
    return 0;
  }


  /** 이 조합을 과거 모든 회차에 대입했을 때 등수별 횟수 + 당첨 회차 목록 */
  function backtest(set, draws) {
    const ranks = [0, 0, 0, 0, 0, 0];
    const wins = [];
    for (const d of draws) {
      const r = rankOf(set, d);
      if (r) { ranks[r]++; wins.push({ no: d.no, date: d.date, rank: r, nums: d.nums, bonus: d.bonus }); }
    }
    return { ranks, wins: wins.sort((a, b) => a.rank - b.rank || b.no - a.no) };
  }


  return {
    N, PICK, THEORY_RATE, TOTAL_COMBOS, STRATEGIES,
    mulberry32, hashString, computeStats, buildWeights, describe,
    generate, inclusionProbability, backtest,
  };
})();
