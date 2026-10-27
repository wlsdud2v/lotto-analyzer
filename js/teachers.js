/**
 * 로또 선생 — 네 명의 가상 인물이 매주 번호를 뽑고 운세를 말합니다. (브라우저·Node 공용)
 *
 *  청룡 선생: 균형형      백호 선생: 완전 랜덤
 *  주작 선생: 핫 넘버     현무 선생: 콜드 넘버  (현무는 내부 id 'geobuk' 유지 — 번호 씨앗이 바뀌지 않게)
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
    { id: 'geobuk', photo: 'img/teachers/geobuk.svg', name: '현무 선생', hanja: '玄', color: '#34495e', strategy: 'cold', style: '콜드 넘버',
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
  // 대사 = [지난주 결과 또는 긴 공백] + [다른 선생 이야기 · 행운 팁 중 0~1개] + [이번 주 기운] + [마음에 드는 번호]
  // 같은 선생·같은 회차면 언제나 같은 대사 (고정 씨앗)

  const FORTUNE_VERSION = 2;

  const POOLS = {
    color: ['빨간색', '파란색', '노란색', '초록색', '흰색', '검은색', '보라색', '주황색', '금색', '은색', '하늘색', '분홍색'],
    dir: ['동쪽', '서쪽', '남쪽', '북쪽', '동남쪽', '북서쪽'],
    item: ['동전', '열쇠', '손수건', '볼펜', '머리끈', '초콜릿', '우산', '책갈피', '반지', '사탕', '메모지', '교통카드'],
    time: ['아침', '점심 무렵', '오후 3시쯤', '퇴근길', '저녁 7시쯤', '토요일 오전', '금요일 밤', '수요일 오후', '해 질 무렵'],
  };

  const LINES = {
    cheongryong: {
      low: [
        '지난주 {prev}회는 {m}개만 맞았으니, 하늘의 뜻이 아직 무르익지 않았느니라.',
        '지난주 {prev}회는 {m}개라. 물이 차야 배가 뜨는 법이니라.',
        '지난주 {prev}회는 {m}개로 그쳤도다. 허나 균형은 하루아침에 이루어지지 않느니라.',
        '{prev}회의 {m}개는 바람이 잠시 비껴간 것일 뿐이니라.',
      ],
      mid: [
        '지난주 {prev}회는 {m}개가 맞았도다. 균형의 길은 서두르지 않는 법이니라.',
        '지난주 {prev}회 {m}개라… 문턱까지 왔음이니라.',
        '지난주 {prev}회에서 {m}개를 짚었노라. 하늘이 문을 반쯤 열었도다.',
      ],
      win: [
        '지난주 {prev}회에서 {rankText}을 거두었노라. 치우침 없는 길이 옳았음이니라.',
        '{prev}회 {rankText}! 보았느냐, 이것이 조화의 힘이니라.',
        '지난주 {rankText}의 기쁨이 아직 구름 위에 머물러 있도다.',
      ],
      drought: [
        '벌써 {n}주째 당첨 소식이 없으나, 큰 강은 소리 없이 흐르는 법이니라.',
        '{n}주의 침묵은 폭풍 전의 고요이니라.',
        '{n}주를 참았으니 하늘도 이제 답을 하리라.',
      ],
      luck: [
        ['이번 주 내 기운은 구름에 가렸으니, 내 말은 반쯤만 믿거라.', '비늘에 이슬이 맺혔구나. 이번 주는 조용히 지켜보는 것도 지혜니라.', '하늘이 잿빛이로다. 욕심을 덜어 내거라.'],
        ['동쪽 바람이 잔잔하니 크게 바라지는 말거라.', '물결이 낮으니 작은 기쁨에 감사하거라.', '기운이 고르지 못하니 적게 걸고 크게 웃거라.'],
        ['음과 양이 고르게 맞물리는 주로다.', '하늘과 땅의 기운이 반반이로다. 마음을 고요히 하거라.', '평온한 물결 위에 작은 행운이 떠 있도다.'],
        ['푸른 기운이 차오르니, 이번 주는 내 균형을 믿어 보거라.', '구름이 걷히고 용의 눈이 맑아졌도다.', '동방의 기운이 내 편이로다. 이번 주는 기대해도 좋으니라.'],
        ['천지의 균형이 내 손에 있도다. 이번 주는 의심하지 말거라.', '여의주가 빛을 내는구나! 천 년에 한 번 오는 기운이니라.', '하늘의 문이 활짝 열렸노라. 이번 주만큼은 내 말을 따르거라.'],
      ],
      num: ['그중 {n}번이 가장 고요히 빛나는구나.', '{n}번에 맑은 기운이 머물러 있느니라.', '특히 {n}번을 눈여겨보거라. 조화의 중심이니라.'],
      tip: ['행운의 색은 {color}, 기운이 오는 방향은 {dir}이니라.', '{item} 하나를 곁에 두면 기운이 고르게 흐르리라.', '{time}에 마음을 정하거라.'],
      boast: ['지난주는 네 선생 중 내가 으뜸이었노라.', '지난주의 승자는 균형이었노라. 기억해 두거라.'],
      jab: ['지난주 {rival}이 앞섰으나, 한때의 바람일 뿐이니라.', '{rival}의 운이 잠시 좋았을 뿐, 균형은 결국 돌아오느니라.'],
    },
    baekho: {
      low: [
        '지난주 {prev}회? {m}개 맞았지! 하하, 운이란 원래 그런 거야.',
        '지난주 {prev}회는 {m}개. 괜찮아, 주사위는 또 굴리면 돼!',
        '{m}개라고? 하하, 지난주 일은 지난주에 두고 오자고!',
        '{prev}회는 {m}개… 뭐, 꽝도 추억이지!',
      ],
      mid: [
        '지난주 {prev}회는 {m}개. 나쁘지 않잖아? 통계 따위 없이 이 정도라고!',
        '{m}개면 감 좀 잡은 거지! 이번엔 한 칸 더!',
        '지난주 {m}개 맞췄어. 발톱이 슬슬 근질근질해!',
      ],
      win: [
        '지난주 {prev}회에서 {rankText}! 봤지? 운은 계산하는 게 아니야!',
        '하하! {rankText}이라니! 역시 내 감은 살아 있다고!',
        '{prev}회 {rankText} 축하해 줘! 이번에도 그냥 느낌대로 간다!',
      ],
      drought: [
        '{n}주째 꽝이라고? 상관없어, 운은 몰아서 오는 거야!',
        '{n}주 동안 쉬었으니 이제 터질 차례지!',
        '꽝이 {n}주 연속? 하하, 큰 거 한 방 모으는 중이야!',
      ],
      luck: [
        ['이번 주 내 운은… 솔직히 바닥이야. 그래도 주사위는 굴려야지!', '오늘 아침에 꼬리를 밟혔어. 불길하지만 뭐 어때!', '이번 주는 낮잠이나 자고 싶은 기분이야. 대충 골랐어!'],
        ['흐음, 이번 주는 그럭저럭. 어차피 다 운이니까!', '반반이야. 동전 던지기 같은 주라고!', '기운이 미지근해. 그래도 재미로 한 장!'],
        ['나쁘지 않은 냄새가 나. 발톱이 근질근질한걸?', '바람이 슬쩍 내 쪽으로 불어. 느낌 괜찮아!', '숲이 조용해. 이런 날 의외로 잘 맞는다니까!'],
        ['오늘 아침 호랑이 꿈을 꿨어. 아, 나구나. 아무튼 길몽이야!', '어흥! 기운이 넘쳐흘러! 이번 주는 좀 기대해 봐!', '줄무늬가 반짝반짝해. 이건 좋은 징조야!'],
        ['이번 주는 느낌이 왔다! 내 감을 믿어, 무조건이야!', '산이 울린다! 이번 주는 내가 왕이야!', '온 숲의 운이 나한테 모였어! 이번만큼은 따라와!'],
      ],
      num: ['{n}번? 그냥 끌렸어. 이유는 묻지 마!', '{n}번은 눈 감고 찍었는데 왠지 좋아!', '솔직히 {n}번이 제일 마음에 들어. 그게 다야!'],
      tip: ['행운의 색? 음… {color}! 방금 정했어!', '{item} 하나 챙겨 가. 이유는 없어, 그냥 느낌!', '{time}쯤 사면 좋을 것 같아. 감이야, 감!'],
      boast: ['지난주는 내가 최고였지! 계산하던 친구들 미안!', '지난주 1등은 나, 백호야! 운도 실력이라고!'],
      jab: ['{rival}이 지난주엔 좀 나았다고? 운빨이야, 운빨!', '{rival}? 하하, 다음 주엔 내가 이긴다!'],
    },
    jujak: {
      low: [
        '지난주 {prev}회는 {m}개… 불씨가 잠깐 꺼졌을 뿐이야!',
        '{m}개라니, 날개가 덜 풀렸었나 봐!',
        '지난주는 {m}개. 재가 남았다는 건 다시 탈 수 있다는 뜻이야!',
        '{prev}회는 {m}개였지만, 꺼진 불도 다시 보자고!',
      ],
      mid: [
        '지난주 {prev}회 {m}개 적중! 불길이 점점 거세지고 있어!',
        '{m}개! 불꽃이 튀기 시작했어!',
        '지난주 {m}개, 이 열기 그대로 이어 간다!',
      ],
      win: [
        '지난주 {prev}회 {rankText}! 역시 뜨거운 번호는 배신하지 않아!',
        '{rankText}! 내 불꽃이 하늘을 찔렀지!',
        '{prev}회 {rankText}의 열기가 아직 식지 않았어!',
      ],
      drought: [
        '{n}주째 조용하지만, 불사조는 재에서 다시 태어나는 법!',
        '{n}주 동안 불씨를 모았어. 이제 활활 탈 차례야!',
        '{n}주 연속 꽝? 그만큼 크게 타오를 거야!',
      ],
      luck: [
        ['이번 주는 날개가 좀 무겁네. 기대는 살짝 낮춰 줘.', '불씨가 젖었어… 이번 주는 조심스럽게.', '깃털이 몇 개 빠졌어. 무리하지 말자.'],
        ['불꽃이 은은하게 타오르는 주야. 조금만 믿어 봐.', '잔불 정도의 기운이야. 작게 즐기자!', '따뜻하긴 한데 뜨겁진 않아. 적당히!'],
        ['기세가 오르고 있어! 뜨거운 번호들이 날 부르고 있다고!', '날개가 가벼워졌어. 슬슬 날아오를 준비 완료!', '온도가 딱 좋아. 이번 주는 기대해도 돼!'],
        ['온몸이 불타오른다! 이번 주는 내 차례야!', '남쪽 바람이 내 날개를 밀어 주고 있어!', '불꽃이 춤을 춰! 이 기세 놓치지 마!'],
        ['남쪽 하늘이 붉게 물들었어! 이번 주는 나를 따라와!', '불사조가 날개를 활짝 폈다! 이번 주는 무조건 나야!', '태양보다 뜨거운 주야! 망설이지 마!'],
      ],
      num: ['특히 {n}번이 지금 제일 뜨거워!', '{n}번에서 불꽃이 튀고 있어!', '{n}번, 이 번호가 지금 제일 핫해!'],
      tip: ['행운의 색은 당연히 {color}! 열정을 담아서!', '{item} 하나 들고 가면 불운이 타 버릴 거야!', '{time}에 사! 그때가 제일 뜨거워!'],
      boast: ['지난주 네 명 중 내가 제일 뜨거웠지!', '지난주 최고의 불꽃은 바로 나였어!'],
      jab: ['{rival}이 지난주엔 앞섰지만, 금방 따라잡을 거야!', '{rival}? 이번 주는 내 불꽃이 더 셀걸!'],
    },
    geobuk: {
      low: [
        '지난주 {prev}회는 {m}개라네… 괜찮네, 기다림은 내 전문이니.',
        '{m}개였지. 허허, 천천히 가도 늦지 않는다네.',
        '지난주는 {m}개. 물살이 아직 내 쪽으로 오지 않았구먼.',
        '{prev}회는 {m}개… 북쪽 물은 늘 늦게 녹는 법이라네.',
      ],
      mid: [
        '음… 지난주 {prev}회는 {m}개였지. 천천히 다가가고 있다네.',
        '{m}개라… 한 걸음씩 다가가는 중이라네.',
        '지난주 {m}개면 나쁘지 않구먼. 끈기가 답이라네.',
      ],
      win: [
        '허허, 지난주 {prev}회에 {rankText}이라니. 기다린 보람이 있구먼.',
        '{rankText}! 느려도 결국 닿는다네.',
        '{prev}회 {rankText}… 백 년 만에 웃어 보는구먼.',
      ],
      drought: [
        '{n}주째 빈손이지만, 천 년을 산 나에겐 잠깐이라네.',
        '{n}주를 기다렸으니 이제 때가 무르익었구먼.',
        '{n}주 연속이라… 허허, 기다림도 수행이라네.',
      ],
      luck: [
        ['이번 주는 등껍질 속에서 쉬고 싶은 기분이라네. 너무 믿지는 말게.', '물이 차갑구먼. 이번 주는 몸을 웅크리겠네.', '흐린 연못 같은 주일세. 조심하게나.'],
        ['물살이 느리게 흐르는 주일세. 서두를 것 없지.', '잔잔한 물결이라네. 작은 것에 만족하게.', '구름이 조금 꼈구먼. 그래도 걱정할 건 없네.'],
        ['오래 잠든 번호들이 하나둘 기지개를 켜는구먼.', '북쪽 별이 은은하게 빛나는구먼. 나쁘지 않네.', '연못에 달이 떴구먼. 고요한 행운이 있겠어.'],
        ['음… 이번 주는 감이 좋다네. 백 년에 몇 번 없는 느낌이야.', '북쪽 하늘이 맑구먼. 이번 주는 기대해 보게.', '등껍질 무늬가 반짝이는구먼. 좋은 징조라네.'],
        ['천 년을 기다린 때가 왔구먼. 이번만큼은 내 말을 믿게나.', '북두칠성이 내 머리 위에 섰구먼! 이번 주는 따라오게.', '허허, 이런 기운은 오백 년 만이라네. 놓치지 말게.'],
      ],
      num: ['{n}번이 오래 기다렸으니 이제 나올 때가 됐다네.', '{n}번이 조용히 때를 기다리고 있구먼.', '{n}번… 이 번호에서 깊은 물소리가 들린다네.'],
      tip: ['행운의 색은 {color}이라네. 차분한 마음으로 고르게.', '{item} 하나 품고 가게. 마음이 느긋해질 걸세.', '{time}에 천천히 사게나. 서두르면 체한다네.'],
      boast: ['지난주는 이 늙은이가 제일 잘 맞혔구먼, 허허.', '느린 걸음이 지난주엔 결승선에 먼저 닿았다네.'],
      jab: ['{rival}이 지난주엔 빨랐지. 허나 경주는 끝까지 봐야 아는 법이라네.', '{rival}? 젊은 기운이 좋구먼. 나는 천천히 따라가겠네.'],
    },
  };

  const RANK_TEXT = { 1: '1등', 2: '2등', 3: '3등', 4: '4등', 5: '5등' };


  /**
   * 운세: 별점(1~5) + 말풍선 대사. 선생·회차로 고정.
   * @param ctx { last: {prev, m, rank} | null, drought: 연속 미당첨 주 수, rival: 이름 | null, boast: bool }
   */
  function fortune(E, teacher, round, nums, ctx) {
    const rng = E.mulberry32(E.hashString(`lotto-fortune|${teacher.id}|${round}`));
    const pickOne = arr => arr[Math.floor(rng() * arr.length)];
    const r = rng();
    const stars = r < 0.12 ? 1 : r < 0.37 ? 2 : r < 0.67 ? 3 : r < 0.9 ? 4 : 5;
    const L = LINES[teacher.id];
    const c = ctx || {};
    const fill = s => s
      .replace('{prev}', c.last ? c.last.prev : '')
      .replace('{m}', c.last ? c.last.m : '')
      .replace('{rankText}', c.last ? RANK_TEXT[c.last.rank] || '' : '')
      .replace('{n}', c.drought)
      .replace('{rival}', c.rival || '')
      .replace('{color}', pickOne(POOLS.color))
      .replace('{dir}', pickOne(POOLS.dir))
      .replace('{item}', pickOne(POOLS.item))
      .replace('{time}', pickOne(POOLS.time));

    const parts = [];
    // 1) 지난주 결과 (오래 못 맞혔으면 가끔 그 얘기)
    if (c.last) {
      const useDrought = !c.last.rank && c.drought >= 20 && rng() < 0.5;
      const pool = useDrought ? L.drought : c.last.rank ? L.win : c.last.m >= 2 ? L.mid : L.low;
      parts.push(fill(pickOne(pool)));
    }
    // 2) 다른 선생 이야기 또는 행운 팁 (0~1개)
    const extra = rng();
    if (c.boast && extra < 0.55) parts.push(fill(pickOne(L.boast)));
    else if (c.rival && extra < 0.5) parts.push(fill(pickOne(L.jab)));
    else if (extra < 0.6) parts.push(fill(pickOne(L.tip)));
    // 3) 이번 주 기운
    parts.push(fill(pickOne(L.luck[stars - 1])));
    // 4) 마음에 드는 번호
    const n = nums[Math.floor(rng() * nums.length)];
    parts.push(pickOne(L.num).replace('{n}', n));
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


  /** round 회차 운세 (직전 회차 결과·연속 미당첨·다른 선생 성적 반영) */
  function fortunesFor(E, draws, picks, round) {
    const out = {};
    const prevDraw = draws[round - 2];
    const lastGrades = {};
    if (prevDraw && picks[round - 1]) {
      for (const t of TEACHERS) if (picks[round - 1][t.id]) lastGrades[t.id] = grade(picks[round - 1][t.id], prevDraw);
    }
    const ms = Object.values(lastGrades).map(g => g.m);
    const best = ms.length ? Math.max(...ms) : -1;
    const leaders = TEACHERS.filter(t => lastGrades[t.id] && lastGrades[t.id].m === best);

    for (const t of TEACHERS) {
      const nums = picks[round] && picks[round][t.id];
      if (!nums) continue;
      const g = lastGrades[t.id];
      const ctx = { last: null, drought: 0, rival: null, boast: false };
      if (g) {
        ctx.last = { prev: round - 1, m: g.m, rank: g.rank };
        // 연속 미당첨 주 수
        for (let r = round - 1; r >= 1; r--) {
          const p = picks[r] && picks[r][t.id], d = draws[r - 1];
          if (!p || !d || grade(p, d).rank) break;
          ctx.drought++;
        }
        // 지난주 단독 1위면 자랑, 다른 선생이 단독 1위면 그 이름
        if (leaders.length === 1 && best > 0) {
          if (leaders[0].id === t.id) ctx.boast = true;
          else ctx.rival = leaders[0].name;
        }
      }
      out[t.id] = fortune(E, t, round, nums, ctx);
    }
    return out;
  }


  const api = { TEACHERS, FORTUNE_VERSION, pick, grade, fortune, computeRange, fortunesFor };
  root.LottoTeachers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
