/**
 * 로또 선생 — 네 명의 가상 인물이 매주 번호를 뽑고 운세를 말합니다. (브라우저·Node 공용)
 *
 *  청룡 선생: 균형형      백호 선생: 완전 랜덤
 *  주작 선생: 핫 넘버     거북 선생: 콜드 넘버
 *
 * 규칙
 *  - N회 번호는 N회 추첨 '전'까지의 당첨 데이터만 사용 (미래 데이터 없음 → 적중률이 공정)
 *  - 난수 씨앗 = 선생 + 회차 로 고정 → 같은 회차에는 누가 언제 계산해도 같은 번호·같은 운세
 *  - 추천 엔진은 LottoEngine (js/engine.js) 을 그대로 사용
 */
(function (root) {

  const TEACHERS = [
    { id: 'cheongryong', photo: 'img/teachers/cheongryong.svg', name: '청룡 선생', hanja: '龍', color: '#1d8a7a', strategy: 'balanced', style: '균형형',
      desc: '빈도·최근 흐름·미출현 기간을 고루 따지고, 합계·홀짝·고저 균형까지 맞춥니다.' },
    { id: 'baekho', photo: 'img/teachers/baekho.svg', name: '백호 선생', hanja: '虎', color: '#7d8590', strategy: 'random', style: '완전 랜덤',
      desc: '통계는 믿지 않습니다. 오직 순수한 운으로 뽑습니다.' },
    { id: 'jujak', photo: 'img/teachers/jujak.svg', name: '주작 선생', hanja: '雀', color: '#d2402a', strategy: 'hot', style: '핫 넘버',
      desc: '요즘 잘 나오는 번호의 기세에 올라탑니다.' },
    { id: 'geobuk', photo: 'img/teachers/geobuk.svg', name: '거북 선생', hanja: '龜', color: '#34495e', strategy: 'cold', style: '콜드 넘버',
      desc: '오래 쉬고 있는 번호가 돌아올 때를 끈기 있게 기다립니다.' },
  ];

  const NO_FILTERS = { sum: false, sumMin: 21, sumMax: 255, oddEven: false, highLow: false, noRun: false, spread: false };


  /**
   * round 회차에 teacher 가 고르는 번호 6개.
   * @param E        LottoEngine
   * @param history  round 이전 회차들 (오름차순)
   */
  function pick(E, history, round, teacher) {
    const rng = E.mulberry32(E.hashString(`lotto-teacher|${teacher.id}|${round}`));
    if (!history.length) {
      const w = new Array(46).fill(1); w[0] = 0;
      return E.generate(1, w, [], NO_FILTERS, new Set(), rng)[0].set;
    }
    const stats = E.computeStats(history, 20);
    const w = E.buildWeights(stats, { strategy: teacher.strategy, fixed: [], excluded: [], companion: false });
    let filters = NO_FILTERS, pastKeys = new Set();
    if (teacher.strategy === 'balanced') {
      filters = { sum: true, sumMin: stats.sumP10, sumMax: stats.sumP90, oddEven: true, highLow: true, noRun: true, spread: false };
      pastKeys = new Set(history.map(d => d.nums.join(',')));
    }
    return E.generate(1, w, [], filters, pastKeys, rng)[0].set;
  }


  /** 내 번호 vs 실제 당첨: 일치 개수와 등수 */
  function grade(nums, draw) {
    const m = nums.filter(n => draw.nums.includes(n)).length;
    const b = nums.includes(draw.bonus);
    const rank = m === 6 ? 1 : m === 5 && b ? 2 : m === 5 ? 3 : m === 4 ? 4 : m === 3 ? 5 : 0;
    return { m, b, rank };
  }


  // ───────────────────────── 운세 ─────────────────────────

  const LINES = {
    cheongryong: {
      last: [
        '지난주 {prev}회는 {m}개만 맞았으니, 하늘의 뜻이 아직 무르익지 않았느니라.',
        '지난주 {prev}회는 {m}개가 맞았도다. 균형의 길은 서두르지 않는 법이니라.',
        '지난주 {prev}회에서 {rankText}을 거두었노라. 치우침 없는 길이 옳았음이니라.',
      ],
      luck: [
        '이번 주 내 기운은 구름에 가렸으니, 내 말은 반쯤만 믿거라.',
        '동쪽 바람이 잔잔하니 크게 바라지는 말거라.',
        '음과 양이 고르게 맞물리는 주로다.',
        '푸른 기운이 차오르니, 이번 주는 내 균형을 믿어 보거라.',
        '천지의 균형이 내 손에 있도다. 이번 주는 의심하지 말거라.',
      ],
      num: '그중 {n}번이 가장 고요히 빛나는구나.',
    },
    baekho: {
      last: [
        '지난주 {prev}회? {m}개 맞았지! 하하, 운이란 원래 그런 거야.',
        '지난주 {prev}회는 {m}개. 나쁘지 않잖아? 통계 따위 없이 이 정도라고!',
        '지난주 {prev}회에서 {rankText}! 봤지? 운은 계산하는 게 아니야!',
      ],
      luck: [
        '이번 주 내 운은… 솔직히 바닥이야. 그래도 주사위는 굴려야지!',
        '흐음, 이번 주는 그럭저럭. 어차피 다 운이니까!',
        '나쁘지 않은 냄새가 나. 발톱이 근질근질한걸?',
        '오늘 아침 호랑이 꿈을 꿨어. 아, 나구나. 아무튼 길몽이야!',
        '이번 주는 느낌이 왔다! 내 감을 믿어, 무조건이야!',
      ],
      num: '{n}번? 그냥 끌렸어. 이유는 묻지 마!',
    },
    jujak: {
      last: [
        '지난주 {prev}회는 {m}개… 불씨가 잠깐 꺼졌을 뿐이야!',
        '지난주 {prev}회 {m}개 적중! 불길이 점점 거세지고 있어!',
        '지난주 {prev}회 {rankText}! 역시 뜨거운 번호는 배신하지 않아!',
      ],
      luck: [
        '이번 주는 날개가 좀 무겁네. 기대는 살짝 낮춰 줘.',
        '불꽃이 은은하게 타오르는 주야. 조금만 믿어 봐.',
        '기세가 오르고 있어! 뜨거운 번호들이 날 부르고 있다고!',
        '온몸이 불타오른다! 이번 주는 내 차례야!',
        '남쪽 하늘이 붉게 물들었어! 이번 주는 나를 따라와!',
      ],
      num: '특히 {n}번이 지금 제일 뜨거워!',
    },
    geobuk: {
      last: [
        '지난주 {prev}회는 {m}개라네… 괜찮네, 기다림은 내 전문이니.',
        '음… 지난주 {prev}회는 {m}개였지. 천천히 다가가고 있다네.',
        '허허, 지난주 {prev}회에 {rankText}이라니. 기다린 보람이 있구먼.',
      ],
      luck: [
        '이번 주는 등껍질 속에서 쉬고 싶은 기분이라네. 너무 믿지는 말게.',
        '물살이 느리게 흐르는 주일세. 서두를 것 없지.',
        '오래 잠든 번호들이 하나둘 기지개를 켜는구먼.',
        '음… 이번 주는 감이 좋다네. 백 년에 몇 번 없는 느낌이야.',
        '천 년을 기다린 때가 왔구먼. 이번만큼은 내 말을 믿게나.',
      ],
      num: '{n}번이 오래 기다렸으니 이제 나올 때가 됐다네.',
    },
  };

  const RANK_TEXT = { 1: '1등', 2: '2등', 3: '3등', 4: '4등', 5: '5등' };


  /**
   * 운세: 별점(1~5) + 말풍선 대사. 선생·회차로 고정.
   * @param last  직전 회차 결과 { prev, m, rank } 또는 null
   */
  function fortune(E, teacher, round, nums, last) {
    const rng = E.mulberry32(E.hashString(`lotto-fortune|${teacher.id}|${round}`));
    const r = rng();
    const stars = r < 0.12 ? 1 : r < 0.37 ? 2 : r < 0.67 ? 3 : r < 0.9 ? 4 : 5;
    const L = LINES[teacher.id];
    const parts = [];
    if (last) {
      const t = last.rank ? L.last[2] : last.m >= 2 ? L.last[1] : L.last[0];
      parts.push(t.replace('{prev}', last.prev).replace('{m}', last.m).replace('{rankText}', RANK_TEXT[last.rank] || ''));
    }
    parts.push(L.luck[stars - 1]);
    const n = nums[Math.floor(rng() * nums.length)];
    parts.push(L.num.replace('{n}', n));
    return { stars, text: parts.join(' ') };
  }


  /**
   * fromRound ~ toRound 회차의 네 선생 번호 계산.
   * draws: 1회부터 연속인 당첨 기록 (오름차순). toRound 는 최대 draws.length + 1 (다음 회차).
   */
  function computeRange(E, draws, fromRound, toRound) {
    const picks = {};
    for (let r = fromRound; r <= toRound; r++) {
      const history = draws.slice(0, r - 1);
      picks[r] = {};
      for (const t of TEACHERS) picks[r][t.id] = pick(E, history, r, t);
    }
    return picks;
  }


  /** round 회차 운세 (직전 회차 결과 반영) */
  function fortunesFor(E, draws, picks, round) {
    const out = {};
    const prevDraw = draws[round - 2];
    for (const t of TEACHERS) {
      const nums = picks[round] && picks[round][t.id];
      if (!nums) continue;
      let last = null;
      const prevPick = picks[round - 1] && picks[round - 1][t.id];
      if (prevDraw && prevPick) {
        const g = grade(prevPick, prevDraw);
        last = { prev: round - 1, m: g.m, rank: g.rank };
      }
      out[t.id] = fortune(E, t, round, nums, last);
    }
    return out;
  }


  const api = { TEACHERS, pick, grade, fortune, computeRange, fortunesFor };
  root.LottoTeachers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
