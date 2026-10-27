/**
 * 타로 카드(메이저 아르카나 22장) 해석과 번호 매핑.
 *
 * 카드 → 번호 규칙
 *  - 카드의 수: 마법사 1 … 세계 21, 바보 22 (바보는 0 대신 22)
 *    정방향 → 카드의 수를 포함 번호로, 카드의 수 + 22 를 강하게 가중
 *    역방향 → 카드의 수를 제외 번호로, 카드의 수 + 22 는 약하게
 *  - 카드의 기운(mode): hot / cold / balanced / random → 추천 엔진의 가중치 방식
 *  - 카드의 성향(tags): 작은 수, 큰 수, 홀수, 짝수, 짝꿍 번호, 지난 회차 제외/부활, 번호대 분산, 조화
 *    역방향이면 기운과 성향이 반대로 뒤집힘 (핫↔콜드, 작은 수↔큰 수, 홀↔짝, 제외↔부활)
 */
const LottoTarot = (() => {

  const CARDS = [
    { id: 0,  rn: '0',     name: '바보',           en: 'The Fool',           sym: '✦', kw: '새로운 시작 · 자유 · 모험',
      up: '계산보다 직감을 따를 때입니다. 두려움 없이 첫발을 내딛으면 길이 열립니다.',
      rev: '무모함과 준비 부족을 뜻합니다. 충동적인 선택을 한 번 더 살펴보세요.',
      msg: '정해진 공식 없이 운의 흐름에 맡겨 보세요.', mode: 'random', tags: [] },
    { id: 1,  rn: 'I',     name: '마법사',         en: 'The Magician',       sym: '∞', kw: '의지 · 창조 · 실현',
      up: '필요한 도구는 이미 손에 있습니다. 원하는 것을 분명히 하면 현실이 됩니다.',
      rev: '재능이 흩어지고 계획이 어긋납니다. 겉만 화려한 것에 속지 마세요.',
      msg: '카드의 수와 자주 함께 나온 번호들이 힘을 모읍니다.', mode: 'hot', tags: ['pair'] },
    { id: 2,  rn: 'II',    name: '여사제',         en: 'The High Priestess', sym: '☾', kw: '직관 · 비밀 · 내면의 지혜',
      up: '드러나지 않은 곳에 답이 있습니다. 조용히 내면의 목소리를 들어 보세요.',
      rev: '감춰진 정보나 무시한 직감이 있습니다. 서두르지 마세요.',
      msg: '오랫동안 모습을 감춘 번호에 주목하세요.', mode: 'cold', tags: [] },
    { id: 3,  rn: 'III',   name: '여황제',         en: 'The Empress',        sym: '❀', kw: '풍요 · 결실 · 성장',
      up: '뿌린 씨앗이 무르익는 때입니다. 넉넉함과 풍요가 찾아옵니다.',
      rev: '성장이 잠시 멈추거나 넘쳐흐릅니다. 돌봄이 부족했던 곳을 살피세요.',
      msg: '자주 열매 맺은 번호들이 다시 풍성하게 나옵니다.', mode: 'hot', tags: ['even'] },
    { id: 4,  rn: 'IV',    name: '황제',           en: 'The Emperor',        sym: '♔', kw: '안정 · 질서 · 기반',
      up: '단단한 기반 위에 체계를 세울 때입니다. 원칙이 곧 힘이 됩니다.',
      rev: '지나친 통제와 경직을 뜻합니다. 힘을 조금 빼 보세요.',
      msg: '작고 단단한 번호(1~22)에서 기반을 다지세요.', mode: 'balanced', tags: ['low'] },
    { id: 5,  rn: 'V',     name: '교황',           en: 'The Hierophant',     sym: '✠', kw: '전통 · 가르침 · 신뢰',
      up: '검증된 길을 따르는 것이 지혜로운 때입니다.',
      rev: '익숙한 관습에서 벗어나 나만의 방식을 찾고 싶어집니다.',
      msg: '오랜 통계가 말하는 균형을 믿으세요.', mode: 'balanced', tags: [] },
    { id: 6,  rn: 'VI',    name: '연인',           en: 'The Lovers',         sym: '♡', kw: '사랑 · 조화 · 선택',
      up: '마음이 통하는 인연, 그리고 중요한 선택의 순간입니다.',
      rev: '엇갈린 마음과 불균형을 뜻합니다. 진짜 원하는 것을 다시 물어보세요.',
      msg: '함께 자주 나온 짝꿍 번호들이 서로를 부릅니다.', mode: 'balanced', tags: ['pair'] },
    { id: 7,  rn: 'VII',   name: '전차',           en: 'The Chariot',        sym: '➹', kw: '전진 · 승리 · 추진력',
      up: '흔들림 없이 밀고 나가면 승리합니다.',
      rev: '방향을 잃고 힘이 흩어집니다. 고삐를 다시 잡으세요.',
      msg: '최근 기세가 오른 번호에 올라타세요.', mode: 'hot', tags: [] },
    { id: 8,  rn: 'VIII',  name: '힘',             en: 'Strength',           sym: '❂', kw: '용기 · 인내 · 부드러운 힘',
      up: '부드러움이 거친 것을 다스립니다. 인내가 큰 힘이 됩니다.',
      rev: '자신감이 떨어지고 감정이 앞섭니다. 스스로를 다독이세요.',
      msg: '큰 번호(23~45)에 담대하게 걸어 보세요.', mode: 'balanced', tags: ['high'] },
    { id: 9,  rn: 'IX',    name: '은둔자',         en: 'The Hermit',         sym: '✧', kw: '성찰 · 고독 · 탐구',
      up: '홀로 등불을 들고 진리를 찾는 시간입니다.',
      rev: '지나친 고립을 뜻합니다. 바깥으로 한 걸음 나와 보세요.',
      msg: '오래 쉬고 있던 번호가 돌아올 차례입니다.', mode: 'cold', tags: [] },
    { id: 10, rn: 'X',     name: '운명의 수레바퀴', en: 'Wheel of Fortune',   sym: '✺', kw: '운명 · 전환점 · 행운',
      up: '바퀴가 돌아 행운의 차례가 옵니다.',
      rev: '흐름이 잠시 멈추고 예기치 못한 변수가 생깁니다.',
      msg: '통계를 내려놓고 순수한 운에 맡기세요.', mode: 'random', tags: [] },
    { id: 11, rn: 'XI',    name: '정의',           en: 'Justice',            sym: '⚖', kw: '균형 · 공정 · 판단',
      up: '모든 것이 공정하게 제자리를 찾습니다.',
      rev: '한쪽으로 치우친 판단을 뜻합니다. 양쪽을 다시 저울질하세요.',
      msg: '홀짝과 높낮이가 고르게 어우러진 조합입니다.', mode: 'balanced', tags: ['harmony'] },
    { id: 12, rn: 'XII',   name: '매달린 사람',     en: 'The Hanged Man',     sym: '⧗', kw: '관점 전환 · 기다림 · 내려놓음',
      up: '멈춰서 거꾸로 바라볼 때 새로운 답이 보입니다.',
      rev: '헛된 기다림과 미뤄 둔 결정을 뜻합니다.',
      msg: '남들이 외면한 번호를 거꾸로 바라보세요.', mode: 'cold', tags: [] },
    { id: 13, rn: 'XIII',  name: '죽음',           en: 'Death',              sym: '⌛', kw: '끝과 시작 · 변화 · 정리',
      up: '하나가 끝나야 새것이 시작됩니다. 미련 없이 정리하세요.',
      rev: '변화를 거부하고 지난 것에 미련이 남습니다.',
      msg: '지난 회차 번호는 보내고 새 번호를 맞이하세요.', mode: 'balanced', tags: ['fresh'] },
    { id: 14, rn: 'XIV',   name: '절제',           en: 'Temperance',         sym: '☯', kw: '조화 · 절제 · 중용',
      up: '서로 다른 것을 알맞게 섞어 조화를 이룹니다.',
      rev: '과함과 모자람 사이에서 균형을 잃었습니다.',
      msg: '작은 수와 큰 수, 홀과 짝을 고르게 섞으세요.', mode: 'balanced', tags: ['harmony'] },
    { id: 15, rn: 'XV',    name: '악마',           en: 'The Devil',          sym: '♆', kw: '집착 · 유혹 · 욕망',
      up: '강한 끌림과 집착이 있습니다. 무엇에 묶여 있는지 돌아보세요.',
      rev: '속박에서 벗어나 자유로워집니다.',
      msg: '자꾸만 나오는 번호의 유혹을 따라가 보세요.', mode: 'hot', tags: ['odd'] },
    { id: 16, rn: 'XVI',   name: '탑',             en: 'The Tower',          sym: '⚡', kw: '급변 · 붕괴 · 깨달음',
      up: '예상 밖의 변화가 낡은 틀을 무너뜨립니다.',
      rev: '피할 수 없는 변화를 미루고 있습니다.',
      msg: '예측을 뒤엎는 의외의 조합입니다.', mode: 'random', tags: ['fresh'] },
    { id: 17, rn: 'XVII',  name: '별',             en: 'The Star',           sym: '★', kw: '희망 · 영감 · 치유',
      up: '어둠 뒤에 희망의 별이 뜹니다. 믿음을 잃지 마세요.',
      rev: '낙담하고 믿음이 흔들립니다. 작은 빛부터 찾아보세요.',
      msg: '고르게 빛나는 균형 잡힌 번호들입니다.', mode: 'balanced', tags: ['spread'] },
    { id: 18, rn: 'XVIII', name: '달',             en: 'The Moon',           sym: '☽', kw: '불안 · 환상 · 무의식',
      up: '모든 것이 불확실합니다. 직감을 믿되 경계를 늦추지 마세요.',
      rev: '혼란이 걷히고 진실이 드러납니다.',
      msg: '달빛 아래 숨어 있던 홀수 번호입니다.', mode: 'cold', tags: ['odd'] },
    { id: 19, rn: 'XIX',   name: '태양',           en: 'The Sun',            sym: '☀', kw: '성공 · 기쁨 · 활력',
      up: '밝은 햇살처럼 모든 일이 환하게 풀립니다.',
      rev: '잠시 구름이 끼었을 뿐입니다. 지나친 낙관은 경계하세요.',
      msg: '가장 밝게 빛나는 인기 번호입니다.', mode: 'hot', tags: [] },
    { id: 20, rn: 'XX',    name: '심판',           en: 'Judgement',          sym: '♫', kw: '부활 · 결단 · 부름',
      up: '다시 일어설 때입니다. 마음속 부름에 응답하세요.',
      rev: '자기 의심으로 결단을 미루고 있습니다.',
      msg: '지난 회차의 번호가 다시 살아납니다.', mode: 'hot', tags: ['repeat'] },
    { id: 21, rn: 'XXI',   name: '세계',           en: 'The World',          sym: '◎', kw: '완성 · 통합 · 성취',
      up: '하나의 여정이 완성되고 모든 것이 하나가 됩니다.',
      rev: '마지막 한 걸음이 남았습니다. 마무리를 서두르지 마세요.',
      msg: '1번대부터 40번대까지 고루 아우르는 조합입니다.', mode: 'balanced', tags: ['spread'] },
  ];

  const MODE_LABEL = { hot: '핫 넘버', cold: '콜드 넘버', balanced: '균형', random: '순수한 운' };
  const TAG_LABEL = {
    low: '작은 수(1~22)', high: '큰 수(23~45)', odd: '홀수', even: '짝수', pair: '짝꿍 번호',
    fresh: '지난 회차 번호 제외', repeat: '지난 회차 번호 부활', spread: '번호대 분산', harmony: '홀짝·고저 조화',
  };
  const MODE_FLIP = { hot: 'cold', cold: 'hot', balanced: 'balanced', random: 'random' };
  const TAG_FLIP = { low: 'high', high: 'low', odd: 'even', even: 'odd', fresh: 'repeat', repeat: 'fresh' };

  const SPREADS = {
    1: ['오늘의 카드'],
    3: ['과거', '현재', '미래'],
  };

  const REVERSED_RATE = 0.3;


  /** 카드의 수 (바보는 22) 와 보조 수 (+22, 바보는 44) */
  const primaryOf = card => (card.id === 0 ? 22 : card.id);
  const secondaryOf = card => primaryOf(card) + 22;


  function randomInt(max) {
    const a = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return a[0] % max;
  }


  /** 22장을 섞어 [{card, reversed}] 반환 */
  function shuffle() {
    const deck = CARDS.map(card => ({ card, reversed: randomInt(1000) < REVERSED_RATE * 1000 }));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }


  /** 정/역방향이 반영된 기운과 성향 */
  function effective(pick) {
    const { card, reversed } = pick;
    return {
      mode: reversed ? MODE_FLIP[card.mode] : card.mode,
      tags: card.tags.map(t => (reversed && TAG_FLIP[t]) || t),
    };
  }


  function meanNormalize(w) {
    let sum = 0, cnt = 0;
    for (let n = 1; n <= 45; n++) { sum += w[n]; cnt++; }
    const m = sum / cnt || 1;
    return w.map((v, i) => (i === 0 ? 0 : v / m));
  }


  /**
   * 고른 카드들로 번호 가중치·포함·제외·필터를 만든다.
   * @param {Array<{card, reversed}>} picks
   * @param stats   LottoEngine.computeStats 결과
   * @param lastDraw 가장 최근 회차 { nums }
   */
  function reading(picks, stats, lastDraw) {
    const fixed = [], excluded = [];
    for (const p of picks) (p.reversed ? excluded : fixed).push(primaryOf(p.card));

    const effects = picks.map(effective);
    const allTags = new Set(effects.flatMap(e => e.tags));

    // 카드별 가중치를 평균 1로 맞춘 뒤 평균
    const combined = new Array(46).fill(0);
    picks.forEach((p, i) => {
      const { mode, tags } = effects[i];
      let w = LottoEngine.buildWeights(stats, { strategy: mode, fixed: [], excluded: [], companion: false });
      w = w.map((v, n) => {
        if (n === 0) return 0;
        let f = 1;
        if (tags.includes('low') && n <= 22) f *= 1.7;
        if (tags.includes('high') && n >= 23) f *= 1.7;
        if (tags.includes('odd') && n % 2 === 1) f *= 1.6;
        if (tags.includes('even') && n % 2 === 0) f *= 1.6;
        return v * f;
      });
      const sec = secondaryOf(p.card);
      w[sec] *= p.reversed ? 0.4 : 2.2;
      w = meanNormalize(w);
      for (let n = 1; n <= 45; n++) combined[n] += w[n] / picks.length;
    });

    // 짝꿍 번호: 포함 번호와 과거에 함께 많이 나온 번호
    if (allTags.has('pair') && fixed.length) {
      const c = new Array(46).fill(0);
      for (let n = 1; n <= 45; n++) for (const f of fixed) c[n] += stats.co[f][n];
      const max = Math.max(...c.slice(1)), min = Math.min(...c.slice(1));
      for (let n = 1; n <= 45; n++) combined[n] *= 1 + 1.2 * (max === min ? 0 : (c[n] - min) / (max - min));
    }

    // 지난 회차 번호 제외 / 부활
    const last = lastDraw ? lastDraw.nums : [];
    if (allTags.has('fresh')) for (const n of last) if (!fixed.includes(n) && !excluded.includes(n)) excluded.push(n);
    if (allTags.has('repeat')) for (const n of last) combined[n] *= 2.5;

    for (const n of fixed) combined[n] = 0;
    for (const n of excluded) combined[n] = 0;

    const filterPatch = {};
    if (allTags.has('spread')) filterPatch.spread = true;
    if (allTags.has('harmony')) { filterPatch.oddEven = true; filterPatch.highLow = true; filterPatch.spread = true; }

    const details = picks.map((p, i) => {
      const e = effects[i];
      const parts = [];
      parts.push(p.reversed ? `${primaryOf(p.card)}번 제외` : `${primaryOf(p.card)}번 포함`);
      parts.push(p.reversed ? `${secondaryOf(p.card)}번 약하게` : `${secondaryOf(p.card)}번 가중`);
      parts.push(`${MODE_LABEL[e.mode]} 기운`);
      for (const t of e.tags) parts.push(TAG_LABEL[t]);
      return parts;
    });

    return {
      fixed: [...new Set(fixed)].sort((a, b) => a - b),
      excluded: [...new Set(excluded)].sort((a, b) => a - b),
      weights: combined,
      filterPatch,
      details,
    };
  }


  return { CARDS, SPREADS, shuffle, reading, primaryOf, secondaryOf };
})();
