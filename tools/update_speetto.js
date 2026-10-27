/**
 * 스피또 발행 현황(판매점 입고율·등위별 잔여 수량)을 받아 data/speetto.json 에 저장합니다.
 * 출처: 동행복권 '즉석식 복권 > 발행내역' 페이지가 쓰는 공개 데이터
 *       https://www.dhlottery.co.kr/st/selectPblcnDsctn.do?gdsType=SP2000 ...
 *
 * 사용: node tools/update_speetto.js     (Node.js 18 이상)
 * 내용이 바뀌었을 때만 파일을 다시 씁니다.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'data', 'speetto.json');
const GAMES = ['SP1000', 'SP2000', 'SP500'];
const url = t => `https://www.dhlottery.co.kr/st/selectPblcnDsctn.do?gdsType=${t}&gdsPrice=&gdsStatus=&pageNum=1&recordCountPerPage=8`;


async function getJson(u) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(u, {
        signal: AbortSignal.timeout(20000),
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.dhlottery.co.kr/st/pblcnDsctn',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim().startsWith('{')) throw new Error('JSON 이 아닌 응답 (접속 대기/차단 페이지일 수 있음)');
      return JSON.parse(text);
    } catch (e) {
      if (attempt >= 3) throw new Error(`${u} 받기 실패: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}


/** "8매/24매" → { left: 8, total: 24 } */
function parseQty(s) {
  const m = String(s || '').replace(/,/g, '').match(/(\d+)\s*매\s*\/\s*(\d+)\s*매/);
  return m ? { left: +m[1], total: +m[2] } : null;
}


function slim(x) {
  return {
    game: x.stGmTypeCd,
    name: x.stGmTypeNm,
    round: x.stEpsd,
    status: x.ntslStatus,
    shipRate: x.stSpmtRt,               // 판매점 입고율(출고율) %
    price: x.stNtslAmt,
    rank1: parseQty(x.stRnk1Rt),
    rank2: parseQty(x.stRnk2Rt),
    rank3: parseQty(x.stRnk3Rt),
    prize1: x.rnk1Atm,
    saleEnd: x.stNtslEndDt,
    payEnd: x.stGiveEndDt,
    dataDate: x.dataChgDt ? '20' + x.dataChgDt : null,   // "26-10-23" → "2026-10-23"
  };
}


async function main() {
  const games = {};
  for (const g of GAMES) {
    const j = await getJson(url(g));
    const list = (j.data && j.data.list) || [];
    if (!list.length) throw new Error(`${g}: 목록이 비어 있음`);
    games[g] = list.map(slim).sort((a, b) => b.round - a.round);
  }

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { /* 처음 */ }
  if (prev && JSON.stringify(prev.games) === JSON.stringify(games)) {
    console.log('스피또 현황 변경 없음');
    return;
  }
  const out = { source: 'https://www.dhlottery.co.kr/st/pblcnDsctn', fetched_at: new Date().toISOString(), games };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');
  for (const g of GAMES) {
    const on = games[g].filter(x => x.status === '판매중');
    console.log(`${g}: ` + on.map(x => `${x.round}회 입고율 ${x.shipRate}% · 1등 잔여 ${x.rank1 ? x.rank1.left + '/' + x.rank1.total : '-'}`).join(' | '));
  }
}


main().catch(e => {
  console.error('스피또 현황 갱신 실패:', e.message);
  process.exit(1);
});
