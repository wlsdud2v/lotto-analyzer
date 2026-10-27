/**
 * 최신 로또 당첨 번호를 받아 data 폴더의 파일들에 추가합니다.
 *   - data/lotto_draws.json, data/lotto_draws.csv 에 빠진 회차를 추가
 *   - data/lotto_data.js 재생성 (build_data.js)
 *
 * 사용:  node tools/update_data.js        (Node.js 18 이상)
 * 출처:  https://github.com/smok95/lotto (동행복권 결과를 매주 반영하는 공개 저장소)
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/smok95/lotto/main/results';
const root = path.resolve(__dirname, '..');
const jsonPath = path.join(root, 'data', 'lotto_draws.json');
const csvPath = path.join(root, 'data', 'lotto_draws.csv');


async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url} 받기 실패: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}


/** smok95 형식 → lotto_draws.json 형식 */
function convert(d) {
  const first = (d.divisions && d.divisions[0]) || {};
  return {
    draw_no: d.draw_no,
    date: String(d.date).slice(0, 10),
    numbers: [...d.numbers].map(Number).sort((a, b) => a - b),
    bonus: d.bonus_no,
    first_prize: first.winners ? first.prize : 0,
    first_winners: first.winners || 0,
    total_sales: d.total_sales_amount || 0,
  };
}


function isValid(d) {
  return d.draw_no > 0 && d.numbers.length === 6 && new Set(d.numbers).size === 6 &&
    d.numbers.every(n => n >= 1 && n <= 45) && d.bonus >= 1 && d.bonus <= 45 && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
}


function toCsvRow(d) {
  return [d.draw_no, d.date, ...d.numbers, d.bonus, d.first_winners ? d.first_prize : '', d.first_winners, d.total_sales].join(',');
}


async function main() {
  const db = JSON.parse(fs.readFileSync(jsonPath, 'utf8').replace(/^﻿/, ''));
  const have = db.draws.reduce((m, d) => Math.max(m, d.draw_no), 0);

  const latest = await getJson(`${BASE}/latest.json`);
  console.log(`보유 ${have}회 / 최신 ${latest.draw_no}회 (${String(latest.date).slice(0, 10)})`);
  if (latest.draw_no <= have) {
    console.log('이미 최신입니다.');
    return;
  }

  // 빠진 회차가 많으면 전체 파일 한 번, 적으면 회차별로 받기
  let fetched;
  const missing = latest.draw_no - have;
  if (missing > 30) {
    const all = await getJson(`${BASE}/all.json`);
    fetched = all.filter(d => d.draw_no > have);
  } else {
    fetched = [];
    for (let no = have + 1; no < latest.draw_no; no++) fetched.push(await getJson(`${BASE}/${no}.json`));
    fetched.push(latest);
  }

  const added = fetched.map(convert).filter(isValid).sort((a, b) => a.draw_no - b.draw_no);
  if (!added.length) throw new Error('받은 데이터에 유효한 회차가 없습니다');

  // JSON
  db.draws.push(...added);
  db.draws.sort((a, b) => a.draw_no - b.draw_no);
  const last = db.draws[db.draws.length - 1];
  db.meta = { ...db.meta, latest_draw: last.draw_no, latest_date: last.date, count: db.draws.length, generated_at: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(jsonPath, JSON.stringify(db), 'utf8');

  // CSV (UTF-8 BOM, CRLF 유지)
  let csv = fs.readFileSync(csvPath, 'utf8');
  if (!/\r?\n$/.test(csv)) csv += '\r\n';
  csv += added.map(toCsvRow).join('\r\n') + '\r\n';
  fs.writeFileSync(csvPath, csv, 'utf8');

  console.log(`추가: ${added.map(d => `${d.draw_no}회 [${d.numbers.join(',')} + ${d.bonus}]`).join(' / ')}`);

  // 더블클릭 실행용 lotto_data.js 재생성
  require('./build_data.js');
}


main().catch(e => {
  console.error('업데이트 실패:', e.message);
  process.exit(1);
});
