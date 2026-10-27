/**
 * data/lotto_draws.json  →  data/lotto_data.js 변환 스크립트
 *
 * index.html 을 서버 없이(file://) 더블클릭으로 열 때는 브라우저가 JSON fetch 를 막기 때문에
 * 추첨 데이터를 <script> 로 읽을 수 있는 JS 파일로 한 번 더 만들어 둡니다.
 * 매주 lotto_draws.json 을 갱신한 뒤 아래 명령을 실행하세요.
 *
 *   node tools/build_data.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'data', 'lotto_draws.json');
const dst = path.join(root, 'data', 'lotto_data.js');

const json = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''));
// 용량을 줄이기 위해 [회차, 날짜, n1..n6, 보너스, 1등 1인 당첨금, 1등 당첨자 수, 총 판매액] 배열로 압축
const rows = json.draws
  .map(d => [d.draw_no, d.date, ...d.numbers, d.bonus, d.first_prize || 0, d.first_winners || 0, d.total_sales || 0])
  .sort((a, b) => a[0] - b[0]);

const out =
  '// 자동 생성 파일 — tools/build_data.js 로 다시 만드세요. 직접 수정하지 마세요.\n' +
  'window.LOTTO_DATA = ' +
  JSON.stringify({ meta: json.meta, rows }) +
  ';\n';

fs.writeFileSync(dst, out, 'utf8');
console.log(`OK: ${rows.length}회차 (최신 ${rows[rows.length - 1][0]}회, ${rows[rows.length - 1][1]}) → ${path.relative(root, dst)}`);
