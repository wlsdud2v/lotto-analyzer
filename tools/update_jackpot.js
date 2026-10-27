/**
 * 동행복권이 발표하는 '이번 회차 1등 예상 총 당첨금'을 data/jackpot.json 에 저장합니다.
 * 출처: www.dhlottery.co.kr 로또6/45 소개 페이지가 쓰는 공개 데이터
 *   /lt645/selectRnk1ExpcAmt.do   → 1등 예상 총 당첨금, 누적 판매액, 기준 시각
 *   /lt645/selectThsLt645Info.do  → 이번 회차, 추첨일, 판매 마감 시각
 * 판매가 이어지는 동안 값이 계속 늘어나므로 자주(매시간) 갱신합니다.
 *
 * 사용: node tools/update_jackpot.js     (Node.js 18 이상)
 */
const fs = require('fs');
const path = require('path');

const outPath = path.resolve(__dirname, '..', 'data', 'jackpot.json');
const BASE = 'https://www.dhlottery.co.kr';
const HEADERS = {
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://www.dhlottery.co.kr/lt645/intro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};


async function getJson(p) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${p}?_=${Date.now()}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim().startsWith('{')) throw new Error('JSON 이 아닌 응답 (접속 대기/차단 페이지일 수 있음)');
      return JSON.parse(text);
    } catch (e) {
      if (attempt >= 3) throw new Error(`${p} 받기 실패: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}


/** "20261027221030" → "2026-10-27T22:10:30+09:00" */
const kst = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14) || '00'}+09:00`;


async function main() {
  const amt = (await getJson('/lt645/selectRnk1ExpcAmt.do')).data.result;
  const ths = (await getJson('/lt645/selectThsLt645Info.do')).data.result;
  if (!amt || !ths || !(amt.rnk1ExpcAmt > 0)) throw new Error('예상 당첨금 데이터가 비어 있음');
  const d = ths.ltRflYmd;
  const out = {
    source: 'https://www.dhlottery.co.kr/lt645/intro',
    round: +ths.ltEpsd,
    draw_date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    close_at: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${String(ths.ltRflHh).padStart(2, '0')}:${String(ths.ltRflMm).padStart(2, '0')}:00+09:00`,
    expected_first_total: +amt.rnk1ExpcAmt,       // 1등 예상 총 당첨금
    accumulated_sales: +amt.acmlRvnAmt,           // 지금까지 누적 판매액
    as_of: kst(String(amt.giveDt)),               // 동행복권 기준 시각
    fetched_at: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');
  console.log(`${out.round}회 1등 예상 총 당첨금 ${out.expected_first_total.toLocaleString('ko-KR')}원 (누적 판매 ${out.accumulated_sales.toLocaleString('ko-KR')}원, ${out.as_of})`);
}


main().catch(e => {
  console.error('예상 당첨금 갱신 실패:', e.message);
  process.exit(1);
});
