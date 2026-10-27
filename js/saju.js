/**
 * 사주팔자 계산 (브라우저·Node 공용)
 *
 *  - 년주: 입춘(태양 황경 315°) 기준으로 해가 바뀜
 *  - 월주: 12절(입춘·경칩·청명·입하·망종·소서·입추·백로·한로·입동·대설·소한) 기준
 *          절기 시각은 태양 겉보기 황경을 VSOP87 로 계산해 구함 (공식 절기 시각과 1분 안팎)
 *  - 일주: 율리우스일 기준 60갑자 (1949-10-01 = 甲子)
 *  - 시주: 자시(23:00~01:00)부터 2시간 단위, 일간에 따라 시간 천간 결정
 *  - 출생 시각은 한국 표준시(과거 서머타임·UTC+8:30 시기 자동 반영)를 받아
 *    출생지 경도로 평균 태양시 보정(선택)
 *  - 대운: 양년 남자·음년 여자는 순행, 반대는 역행 / 다음(이전) 절까지 일수 ÷ 3 = 대운수
 */
(function (root) {

  const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
  const STEMS_H = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
  const BRANCHES_H = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
  const ELEMENTS = ['목', '화', '토', '금', '수'];
  const ELEMENTS_H = ['木', '火', '土', '金', '水'];
  const STEM_EL = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
  const BRANCH_EL = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
  const BRANCH_MAIN_STEM = [9, 5, 0, 1, 4, 2, 3, 5, 6, 7, 4, 8];   // 지지 본기 (子癸 丑己 寅甲 …)
  const HOUR_RANGES = ['23:00~01:00', '01:00~03:00', '03:00~05:00', '05:00~07:00', '07:00~09:00', '09:00~11:00',
    '11:00~13:00', '13:00~15:00', '15:00~17:00', '17:00~19:00', '19:00~21:00', '21:00~23:00'];

  const CITIES = [
    { id: 'seoul', name: '서울', lon: 126.98 }, { id: 'incheon', name: '인천', lon: 126.70 },
    { id: 'daejeon', name: '대전', lon: 127.38 }, { id: 'daegu', name: '대구', lon: 128.60 },
    { id: 'busan', name: '부산', lon: 129.08 }, { id: 'ulsan', name: '울산', lon: 129.31 },
    { id: 'gwangju', name: '광주', lon: 126.85 }, { id: 'jeonju', name: '전주', lon: 127.15 },
    { id: 'cheongju', name: '청주', lon: 127.49 }, { id: 'gangneung', name: '강릉', lon: 128.90 },
    { id: 'jeju', name: '제주', lon: 126.53 }, { id: 'none', name: '보정 안 함 (표준시 그대로)', lon: null },
  ];


  // ───────────────────────── 천문: 태양 황경 · 절기 ─────────────────────────

  const DEG = Math.PI / 180;
  const jdOf = ms => ms / 86400000 + 2440587.5;
  const msOfJd = jd => (jd - 2440587.5) * 86400000;


  // VSOP87 지구 일심 황경 주요 항 (Meeus 『Astronomical Algorithms』 표 32.A) — [A, B, C] : A·cos(B + C·τ)
  const VSOP_L = [
    [[175347046, 0, 0], [3341656, 4.6692568, 6283.07585], [34894, 4.6261, 12566.1517], [3497, 2.7441, 5753.3849], [3418, 2.8289, 3.5231],
      [3136, 3.6277, 77713.7715], [2676, 4.4181, 7860.4194], [2343, 6.1352, 3930.2097], [1324, 0.7425, 11506.7698], [1273, 2.0371, 529.691],
      [1199, 1.1096, 1577.3435], [990, 5.233, 5884.927], [902, 2.045, 26.298], [857, 3.508, 398.149], [780, 1.179, 5223.694],
      [753, 2.533, 5507.553], [505, 4.583, 18849.228], [492, 4.205, 775.523], [357, 2.92, 0.067], [317, 5.849, 11790.629],
      [284, 1.899, 796.298], [271, 0.315, 10977.079], [243, 0.345, 5486.778], [206, 4.806, 2544.314], [205, 1.869, 5573.143],
      [202, 2.458, 6069.777], [156, 0.833, 213.299], [132, 3.411, 2942.463], [126, 1.083, 20.775], [115, 0.645, 0.98],
      [103, 0.636, 4694.003], [102, 0.976, 15720.839], [102, 4.267, 7.114], [99, 6.21, 2146.17], [98, 0.68, 155.42],
      [86, 5.98, 161000.69], [85, 1.3, 6275.96], [85, 3.67, 71430.7], [80, 1.81, 17260.15], [79, 3.04, 12036.46],
      [75, 1.76, 5088.63], [74, 3.5, 3154.69], [74, 4.68, 801.82], [70, 0.83, 9437.76], [62, 3.98, 8827.39],
      [61, 1.82, 7084.9], [57, 2.78, 6286.6], [56, 4.39, 14143.5], [56, 3.47, 6279.55], [52, 0.19, 12139.55],
      [52, 1.33, 1748.02], [51, 0.28, 5856.48], [49, 0.49, 1194.45], [41, 5.37, 8429.24], [41, 2.4, 19651.05],
      [39, 6.17, 10447.39], [37, 6.04, 10213.29], [37, 2.57, 1059.38], [36, 1.71, 2352.87], [36, 1.78, 6812.77],
      [33, 0.59, 17789.85], [30, 0.44, 83996.85], [30, 2.74, 1349.87], [25, 3.16, 4690.48]],
    [[628331966747, 0, 0], [206059, 2.678235, 6283.07585], [4303, 2.6351, 12566.1517], [425, 1.59, 3.523], [119, 5.796, 26.298],
      [109, 2.966, 1577.344], [93, 2.59, 18849.23], [72, 1.14, 529.69], [68, 1.87, 398.15], [67, 4.41, 5507.55],
      [59, 2.89, 5223.69], [56, 2.17, 155.42], [45, 0.4, 796.3], [36, 0.47, 775.52], [29, 2.65, 7.11],
      [21, 5.34, 0.98], [19, 1.85, 5486.78], [19, 4.97, 213.3], [17, 2.99, 6275.96], [16, 0.03, 2544.31],
      [16, 1.43, 2146.17], [15, 1.21, 10977.08], [12, 2.83, 1748.02], [12, 3.26, 5088.63], [12, 5.27, 1194.45],
      [12, 2.08, 4694], [11, 0.77, 553.57], [10, 1.3, 6286.6], [10, 4.24, 1349.87], [9, 2.7, 242.73],
      [9, 5.64, 951.72], [8, 5.3, 2352.87], [6, 2.65, 9437.76], [6, 4.67, 4690.48]],
    [[52919, 0, 0], [8720, 1.0721, 6283.0758], [309, 0.867, 12566.152], [27, 0.05, 3.52], [16, 5.19, 26.3],
      [16, 3.68, 155.42], [10, 0.76, 18849.23], [9, 2.06, 77713.77], [7, 0.83, 775.52], [5, 4.66, 1577.34],
      [4, 1.03, 7.11], [4, 3.44, 5573.14], [3, 5.14, 796.3], [3, 6.05, 5507.55], [3, 1.19, 242.73],
      [3, 6.12, 529.69], [3, 0.31, 398.15], [3, 2.28, 553.57], [2, 4.38, 5223.69], [2, 3.75, 0.98]],
    [[289, 5.844, 6283.076], [35, 0, 0], [17, 5.49, 12566.15], [3, 5.2, 155.42], [1, 4.72, 3.52], [1, 5.3, 18849.23], [1, 5.97, 242.73]],
    [[114, 3.142, 0], [8, 4.13, 6283.08], [1, 3.84, 12566.15]],
    [[1, 3.14, 0]],
  ];

  /** ΔT(지구 자전 보정, 초) — 연도별 대략값 선형 보간 */
  const DELTA_T = [[1900, -3], [1910, 10], [1920, 21], [1930, 24], [1940, 24], [1950, 29], [1960, 33], [1970, 40], [1980, 51], [1990, 57], [2000, 64], [2010, 66], [2020, 69], [2030, 72], [2050, 80]];
  function deltaT(year) {
    if (year <= DELTA_T[0][0]) return DELTA_T[0][1];
    for (let i = 1; i < DELTA_T.length; i++) {
      const [y1, v1] = DELTA_T[i - 1], [y2, v2] = DELTA_T[i];
      if (year <= y2) return v1 + (v2 - v1) * (year - y1) / (y2 - y1);
    }
    return DELTA_T[DELTA_T.length - 1][1];
  }


  /** 태양 겉보기 황경 (도) — VSOP87 + 장동 + 광행차 (오차 약 1분 이내) */
  function sunLongitude(ms) {
    const year = 1970 + ms / 31557600000;
    const jde = jdOf(ms) + deltaT(year) / 86400;
    const tau = (jde - 2451545.0) / 365250;
    let L = 0;
    for (let k = 0; k < VSOP_L.length; k++) {
      let sum = 0;
      for (const [A, B, C] of VSOP_L[k]) sum += A * Math.cos(B + C * tau);
      L += sum * Math.pow(tau, k);
    }
    L = L / 1e8;                                         // 라디안
    let lam = L / DEG + 180;                             // 지구 → 태양
    const T = tau * 10;
    lam -= 0.09033 / 3600;                               // FK5 보정
    const omega = (125.04452 - 1934.136261 * T) * DEG;
    const Ls = (280.4665 + 36000.7698 * T) * DEG, Lm = (218.3165 + 481267.8813 * T) * DEG;
    const dpsi = -17.2 * Math.sin(omega) - 1.32 * Math.sin(2 * Ls) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * omega);
    lam += dpsi / 3600;                                  // 장동
    lam -= 20.4898 / 3600;                               // 광행차
    return ((lam % 360) + 360) % 360;
  }

  const angDiff = (a, b) => ((a - b + 540) % 360) - 180;   // a-b 를 -180~180 으로


  /** 태양 황경이 target 도가 되는 시각 (guess 근처) */
  function solveLongitude(target, guessMs) {
    let t = guessMs;
    for (let i = 0; i < 30; i++) {
      const d = angDiff(target, sunLongitude(t));
      t += d / 0.98564736 * 86400000;
      if (Math.abs(d) < 1e-7) break;
    }
    return t;
  }


  /** 12절(황경 15°+30°k) 중 ms 직후(dir=+1) 또는 직전(dir=-1) 절의 시각 */
  function adjacentTerm(ms, dir) {
    const lam = sunLongitude(ms);
    const k = dir > 0 ? Math.floor((lam - 15) / 30) + 1 : Math.floor((lam - 15) / 30);
    let target = ((15 + 30 * k) % 360 + 360) % 360;
    let t = solveLongitude(target, ms + dir * 15 * 86400000);
    if (dir > 0 && t <= ms) t = solveLongitude((target + 30) % 360, t + 30 * 86400000);
    if (dir < 0 && t > ms) t = solveLongitude((target + 330) % 360, t - 30 * 86400000);
    return { ms: t, lon: ((Math.round(sunLongitude(t)) % 360) + 360) % 360 };
  }

  const TERM_NAMES = { 315: '입춘', 345: '경칩', 15: '청명', 45: '입하', 75: '망종', 105: '소서', 135: '입추', 165: '백로', 195: '한로', 225: '입동', 255: '대설', 285: '소한' };


  // ───────────────────────── 시간 ─────────────────────────

  /** 한국 표준시 기준 해당 순간의 UTC 와의 차이(분) — 과거 서머타임 포함 (Intl 시간대 데이터) */
  function seoulOffsetMin(ms) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const g = k => +p.find(x => x.type === k).value;
    return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - ms) / 60000);
  }


  /** 한국 벽시계 시각(당시 공식 시각) → UTC 밀리초 */
  function seoulWallToUtc(y, m, d, h, mi) {
    const wall = Date.UTC(y, m - 1, d, h, mi);
    let t = wall - 9 * 3600000;
    for (let i = 0; i < 4; i++) t = wall - seoulOffsetMin(t) * 60000;
    return t;
  }


  function jdn(y, m, d) {
    const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }


  const pillar = idx60 => ({ idx: idx60, s: idx60 % 10, b: idx60 % 12 });
  const sixty = (s, b) => { for (let k = 0; k < 60; k++) if (k % 10 === s && k % 12 === b) return k; return 0; };


  // ───────────────────────── 십신 ─────────────────────────

  const TEN_GODS = ['비견', '겁재', '식신', '상관', '편재', '정재', '편관', '정관', '편인', '정인'];

  function tenGod(dayStem, otherStem) {
    const de = STEM_EL[dayStem], oe = STEM_EL[otherStem];
    const same = dayStem % 2 === otherStem % 2;
    const rel = (oe - de + 5) % 5;     // 0 같음, 1 내가 생함, 2 내가 극함, 3 나를 극함, 4 나를 생함
    return TEN_GODS[rel * 2 + (same ? 0 : 1)];
  }


  // ───────────────────────── 계산 ─────────────────────────

  /**
   * @param input { gender: 'M'|'F', y, m, d, h, mi, timeUnknown, city, zasi: 'early'|'late' }
   *   zasi 'early' = 23시에 날짜를 바꿈(기본), 'late' = 야자시(23~24시는 당일, 시간 천간은 다음날 기준)
   */
  function compute(input) {
    const { gender, y, m, d } = input;
    const unknown = !!input.timeUnknown;
    const h = unknown ? 12 : input.h, mi = unknown ? 0 : input.mi;
    const utc = seoulWallToUtc(y, m, d, h, mi);
    const city = CITIES.find(c => c.id === input.city) || CITIES[0];

    // 출생지 평균 태양시 (보정 안 함이면 벽시계 그대로)
    const offsetMin = seoulOffsetMin(utc);
    const localMs = city.lon == null ? utc + offsetMin * 60000 : utc + city.lon * 4 * 60000;
    const L = new Date(localMs);
    const ly = L.getUTCFullYear(), lm = L.getUTCMonth() + 1, ld = L.getUTCDate(), lh = L.getUTCHours(), lmi = L.getUTCMinutes();

    // 년주: 입춘 기준
    const lam = sunLongitude(utc);
    const kstY = new Date(utc + 9 * 3600000).getUTCFullYear();
    const lichun = solveLongitude(315, Date.UTC(kstY, 1, 4));
    const sajuYear = utc < lichun ? kstY - 1 : kstY;
    const yearP = pillar(((sajuYear - 4) % 60 + 60) % 60);

    // 월주: 절기 기준 (寅월 = 황경 315°~345°)
    const monthIdx = Math.floor((((lam - 315) % 360) + 360) % 360 / 30);   // 0 = 寅
    const monthB = (monthIdx + 2) % 12;
    const monthS = (yearP.s * 2 + 2 + monthIdx) % 10;
    const monthP = pillar(sixty(monthS, monthB));

    // 일주·시주
    let dayJdn = jdn(ly, lm, ld);
    const lateNight = !unknown && lh >= 23;
    if (lateNight && input.zasi !== 'late') dayJdn += 1;
    const dayP = pillar(((dayJdn + 49) % 60 + 60) % 60);
    let hourP = null;
    if (!unknown) {
      const hb = Math.floor((lh * 60 + lmi + 60) / 120) % 12;
      const stemBase = lateNight && input.zasi === 'late' ? (dayP.s + 1) % 10 : dayP.s;
      hourP = pillar(sixty((stemBase * 2 + hb) % 10, hb));
    }

    const pillars = { hour: hourP, day: dayP, month: monthP, year: yearP };
    const dm = dayP.s;

    // 오행 분포 (천간 + 지지 본 오행)
    const counts = [0, 0, 0, 0, 0];
    for (const p of Object.values(pillars)) {
      if (!p) continue;
      counts[STEM_EL[p.s]]++;
      counts[BRANCH_EL[p.b]]++;
    }

    // 신강·신약 (간단 판정: 나를 돕는 인성·비겁 vs 나머지, 월지는 가중 2배)
    const dmEl = STEM_EL[dm];
    let help = 0, drain = 0;
    const weigh = (el, w) => { const rel = (el - dmEl + 5) % 5; if (rel === 0 || rel === 4) help += w; else drain += w; };
    for (const [k, p] of Object.entries(pillars)) {
      if (!p) continue;
      if (k !== 'day') weigh(STEM_EL[p.s], 1);
      weigh(BRANCH_EL[p.b], k === 'month' ? 2 : 1);
    }
    const strong = help >= drain;

    // 행운 오행: 신약이면 나를 돕는 오행(인성 → 비겁), 신강이면 기운을 빼는 오행(식상 → 재성) 중 덜 가진 것
    const cand = strong ? [(dmEl + 1) % 5, (dmEl + 2) % 5] : [(dmEl + 4) % 5, dmEl];
    const lucky = counts[cand[0]] <= counts[cand[1]] ? cand[0] : cand[1];

    // 대운
    const yang = yearP.s % 2 === 0;
    const forward = (gender === 'M' && yang) || (gender === 'F' && !yang);
    const term = adjacentTerm(utc, forward ? 1 : -1);
    const days = Math.abs(term.ms - utc) / 86400000;
    const startAge = Math.max(1, Math.round(days / 3));
    const daewoon = [];
    for (let i = 1; i <= 8; i++) {
      const idx = ((monthP.idx + (forward ? i : -i)) % 60 + 60) % 60;
      daewoon.push({ age: startAge + (i - 1) * 10, ...pillar(idx) });
    }

    return {
      input: { ...input, h, mi },
      utc, offsetMin, city,
      local: { y: ly, m: lm, d: ld, h: lh, mi: lmi },
      sajuYear, pillars, dayMaster: dm, counts, strong, lucky,
      animal: ANIMALS[yearP.b],
      daewoon: { forward, startAge, list: daewoon, term: { name: TERM_NAMES[term.lon] || '', ms: term.ms, days } },
    };
  }


  // ───────────────────────── 해설 ─────────────────────────

  const DAY_MASTER_TEXT = [
    '곧게 뻗은 큰 나무(甲木)입니다. 곧고 정의로우며 앞장서는 리더 기질이 있고, 한번 정한 목표는 끝까지 밀고 나갑니다. 다만 굽힐 줄 모르는 고집이 약점이 될 수 있습니다.',
    '부드러운 풀과 꽃(乙木)입니다. 유연하고 적응력이 뛰어나 어디서든 뿌리를 내립니다. 섬세하고 사교적이며, 겉은 부드럽지만 속은 질긴 생명력이 있습니다.',
    '하늘의 태양(丙火)입니다. 밝고 열정적이며 숨김이 없어 주변을 환하게 만듭니다. 표현력과 추진력이 좋지만 성급함은 조심하는 것이 좋습니다.',
    '등불과 촛불(丁火)입니다. 따뜻하고 섬세하며 한 사람 한 사람을 깊이 챙깁니다. 집중력과 통찰력이 뛰어나고, 조용하지만 오래 타는 열정을 지녔습니다.',
    '넓은 산과 큰 땅(戊土)입니다. 듬직하고 믿음직스러워 사람들이 기대게 되는 사람입니다. 포용력과 끈기가 강점이고, 변화에는 다소 느릴 수 있습니다.',
    '기름진 논밭(己土)입니다. 현실적이고 꼼꼼하며 무엇이든 길러 내는 재주가 있습니다. 배려심이 깊고 실속을 챙기지만, 걱정이 많은 편일 수 있습니다.',
    '단단한 바위와 무쇠(庚金)입니다. 결단력과 의리가 있고 맺고 끊음이 분명합니다. 강한 실행력이 장점이며, 말과 행동이 지나치게 날카롭지 않도록 다듬으면 좋습니다.',
    '빛나는 보석(辛金)입니다. 세련되고 감각적이며 자존심과 완벽주의 성향이 있습니다. 섬세한 안목이 강점이고, 작은 상처에도 예민할 수 있습니다.',
    '큰 바다와 강(壬水)입니다. 생각이 깊고 포부가 크며 지혜롭습니다. 자유롭고 융통성이 있어 큰 흐름을 읽는 데 강하지만, 방향을 자주 바꿀 수 있습니다.',
    '이슬과 빗물(癸水)입니다. 조용하고 총명하며 직관이 뛰어납니다. 상대를 촉촉하게 적시는 배려가 있고, 겉으로 드러내지 않는 깊은 생각을 품고 있습니다.',
  ];

  const ELEMENT_LUCK = [
    { color: '초록·청색', nums: '3, 8', dir: '동쪽', season: '봄', tip: '나무와 식물 가까이, 아침 산책' },
    { color: '빨강·주황', nums: '2, 7', dir: '남쪽', season: '여름', tip: '햇볕 쬐기, 활발한 운동' },
    { color: '노랑·갈색', nums: '5, 10', dir: '중앙', season: '환절기', tip: '규칙적인 식사, 흙 밟기' },
    { color: '흰색·금색', nums: '4, 9', dir: '서쪽', season: '가을', tip: '정리 정돈, 금속 소품' },
    { color: '검정·남색', nums: '1, 6', dir: '북쪽', season: '겨울', tip: '충분한 수분, 물가 산책' },
  ];

  const TEN_GOD_TEXT = {
    비견: '나와 같은 기운 — 자립심·동료', 겁재: '나와 경쟁하는 기운 — 승부욕·추진력',
    식신: '내가 만드는 여유 — 재능·먹을 복', 상관: '내가 드러내는 재주 — 표현력·창의',
    편재: '움직이는 재물 — 사업·투자 감각', 정재: '꾸준한 재물 — 성실·관리',
    편관: '나를 단련하는 힘 — 도전·카리스마', 정관: '나를 바르게 하는 힘 — 명예·책임',
    편인: '독특한 배움 — 직관·전문성', 정인: '나를 돕는 배움 — 학문·어머니의 덕',
  };


  // ───────────────────────── 오늘의 운세 (일진) ─────────────────────────

  const CLASH = [[0, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11]];
  const HARMONY = [[0, 1], [2, 11], [3, 10], [4, 9], [5, 8], [6, 7]];
  const pairIn = (list, a, b) => list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  const DAILY = {
    비견: { score: 3, total: '나와 같은 기운이 들어오는 날. 혼자보다 함께할 때 힘이 납니다.', money: '나누면 돌아오는 날이니 큰 지출은 미루세요.', people: '동료·친구와의 협력이 잘 풀립니다.', health: '무리한 경쟁은 피로를 부릅니다.' },
    겁재: { score: 2, total: '경쟁심이 커지는 날. 승부욕은 좋지만 고집은 조금 내려놓으세요.', money: '충동구매와 보증은 조심하세요.', people: '사소한 말다툼이 커질 수 있어요.', health: '과식과 과음에 주의하세요.' },
    식신: { score: 4, total: '여유와 즐거움이 찾아오는 날. 하고 싶던 일을 시작하기 좋아요.', money: '작은 행운과 맛있는 먹을 복이 있어요.', people: '웃음이 많은 자리가 생깁니다.', health: '컨디션이 좋은 날, 가볍게 몸을 움직여 보세요.' },
    상관: { score: 3, total: '재치와 표현력이 빛나는 날. 아이디어를 꺼내 보세요.', money: '말로 버는 복이 있지만 말로 잃을 수도 있어요.', people: '윗사람에게 직언은 조심스럽게.', health: '목과 호흡기를 챙기세요.' },
    편재: { score: 4, total: '움직이는 만큼 기회가 생기는 날. 활동적으로 지내세요.', money: '뜻밖의 수입이나 좋은 정보가 들어올 수 있어요.', people: '새로운 사람과의 인연이 이익이 됩니다.', health: '바쁜 일정 속 휴식을 챙기세요.' },
    정재: { score: 4, total: '차근차근 쌓이는 날. 계획대로 하면 결실을 봅니다.', money: '알뜰하게 관리하면 재물이 모입니다.', people: '가족과 가까운 사람에게 신경 써 주세요.', health: '규칙적인 생활이 보약입니다.' },
    편관: { score: 2, total: '부담과 압박이 느껴지는 날. 한 걸음 물러서면 길이 보입니다.', money: '급한 결정은 손해로 이어질 수 있어요.', people: '강하게 나오는 상대에게는 부드럽게 대하세요.', health: '스트레스와 두통에 주의하세요.' },
    정관: { score: 4, total: '인정받고 질서가 잡히는 날. 맡은 일을 반듯하게 해내세요.', money: '안정적인 흐름, 무리한 투자는 피하세요.', people: '윗사람의 도움과 칭찬이 있어요.', health: '바른 자세와 충분한 수면을.' },
    편인: { score: 3, total: '직감이 날카로운 날. 혼자 생각할 시간이 도움이 됩니다.', money: '계약서는 한 번 더 확인하세요.', people: '오해가 생기기 쉬우니 말은 분명하게.', health: '불규칙한 식사를 조심하세요.' },
    정인: { score: 5, total: '도움과 배움이 찾아오는 날. 귀인을 만날 수 있어요.', money: '문서운이 좋아 계약·신청에 유리해요.', people: '어른과 스승의 조언이 큰 힘이 됩니다.', health: '마음이 편안해 회복이 빠른 날입니다.' },
  };


  /** 오늘의 운세: 오늘 일진과 내 일간·일지의 관계 */
  function daily(saju, ms) {
    const now = new Date(ms + 9 * 3600000);
    const t = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
    const today = pillar(((jdn(t.y, t.m, t.d) + 49) % 60 + 60) % 60);
    const god = tenGod(saju.dayMaster, today.s);
    const base = DAILY[god];
    const myB = saju.pillars.day.b;
    let score = base.score, note = '';
    if (pairIn(CLASH, myB, today.b)) { score -= 1; note = `오늘의 ${BRANCHES[today.b]}(${BRANCHES_H[today.b]})가 내 일지 ${BRANCHES[myB]}(${BRANCHES_H[myB]})와 부딪히는 날(충)이라 변화와 이동이 많을 수 있어요. 중요한 결정은 하루 미뤄 보세요.`; }
    else if (pairIn(HARMONY, myB, today.b)) { score += 1; note = `오늘의 ${BRANCHES[today.b]}(${BRANCHES_H[today.b]})가 내 일지 ${BRANCHES[myB]}(${BRANCHES_H[myB]})와 손잡는 날(합)이라 일이 순조롭게 맞물립니다.`; }
    const todayEl = STEM_EL[today.s];
    if (todayEl === saju.lucky) { score += 1; note += (note ? ' ' : '') + `오늘은 나에게 필요한 ${ELEMENTS[todayEl]}(${ELEMENTS_H[todayEl]}) 기운이 들어오는 날이에요.`; }
    score = Math.max(1, Math.min(5, score));
    return { date: t, pillar: today, god, score, note, ...base };
  }


  /** 이번 주 사주 행운 번호 (출생 정보 + 회차로 고정) — 하도 수: 수1·6 화2·7 목3·8 금4·9 토5·0 */
  function luckyNumbers(E, saju, round) {
    const HADO = [3, 2, 5, 4, 1];     // 오행별 끝자리 (목3 화2 토5 금4 수1) + 5
    const lastDigitEl = n => { const r = n % 10; for (let e = 0; e < 5; e++) if (r === HADO[e] || r === (HADO[e] + 5) % 10) return e; return 2; };
    const luck = saju.lucky, support = (luck + 4) % 5;
    const w = new Array(46).fill(0);
    for (let n = 1; n <= 45; n++) {
      const el = lastDigitEl(n);
      w[n] = el === luck ? 3 : el === support ? 2 : 1;
    }
    const i = saju.input;
    const seed = E.hashString(`saju|${i.gender}|${i.y}-${i.m}-${i.d}|${i.timeUnknown ? 'x' : i.h + ':' + i.mi}|${round}`);
    const nofilter = { sum: false, sumMin: 21, sumMax: 255, oddEven: false, highLow: false, noRun: false, spread: false };
    return E.generate(1, w, [], nofilter, new Set(), E.mulberry32(seed))[0].set;
  }


  const api = {
    STEMS, STEMS_H, BRANCHES, BRANCHES_H, ELEMENTS, ELEMENTS_H, STEM_EL, BRANCH_EL, BRANCH_MAIN_STEM, ANIMALS, CITIES, HOUR_RANGES,
    DAY_MASTER_TEXT, ELEMENT_LUCK, TEN_GOD_TEXT,
    sunLongitude, solveLongitude, adjacentTerm, seoulWallToUtc, seoulOffsetMin, jdn, tenGod, compute, daily, luckyNumbers,
  };
  root.LottoSaju = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
