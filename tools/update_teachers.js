/**
 * 로또 선생 번호·운세를 data/teachers.json 에 저장합니다.
 *  - 1회부터 '다음 회차'(최신 + 1)까지, 빠진 회차만 새로 계산 (이미 저장된 번호는 절대 바꾸지 않음)
 *  - 운세는 최근 12주 + 다음 회차를 저장
 *
 * 사용: node tools/update_teachers.js      (data/lotto_draws.json 을 먼저 갱신한 뒤)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'data', 'teachers.json');

// 브라우저용 엔진·선생 모듈을 그대로 불러와 같은 계산을 보장
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'engine.js'), 'utf8') + '\n;globalThis.LottoEngine = LottoEngine;', ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'teachers.js'), 'utf8'), ctx);
const E = ctx.LottoEngine, T = ctx.LottoTeachers;

const db = JSON.parse(fs.readFileSync(path.join(root, 'data', 'lotto_draws.json'), 'utf8').replace(/^﻿/, ''));
const draws = db.draws
  .map(d => ({ no: d.draw_no, date: d.date, nums: [...d.numbers].sort((a, b) => a - b), bonus: d.bonus }))
  .sort((a, b) => a.no - b.no);
draws.forEach((d, i) => { if (d.no !== i + 1) throw new Error(`회차가 연속이 아닙니다: ${i + 1} 자리에 ${d.no}`); });

const latest = draws.length;
const next = latest + 1;

let data = { picks: {}, fortunes: {} };
try { data = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { /* 처음 생성 */ }

// 빠진 회차만 계산
const t0 = Date.now();
let added = 0;
for (let r = 1; r <= next; r++) {
  if (data.picks[r] && T.TEACHERS.every(t => data.picks[r][t.id])) continue;
  Object.assign(data.picks, T.computeRange(E, draws, r, r));
  added++;
}

// 운세: 최근 12주 + 다음 회차
const fortunes = {};
for (let r = Math.max(2, next - 12); r <= next; r++) {
  fortunes[r] = (data.fortunes && data.fortunes[r]) || T.fortunesFor(E, draws, data.picks, r);
}

const out = {
  about: '로또 선생 — 각 회차 번호는 그 회차 추첨 전까지의 데이터만으로, 선생·회차로 고정된 난수 씨앗을 써서 만듭니다. 한번 저장된 번호는 바뀌지 않습니다.',
  teachers: T.TEACHERS.map(({ id, name, hanja, color, strategy, style, desc }) => ({ id, name, hanja, color, strategy, style, desc })),
  latest_draw: latest,
  next_round: next,
  next_date: (() => { const [y, m, d] = draws[latest - 1].date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10); })(),
  updated_at: added ? new Date().toISOString() : (data.updated_at || new Date().toISOString()),
  fortunes,
  picks: data.picks,
};

// 회차마다 한 줄씩 (저장소 diff 를 읽기 쉽게)
fs.writeFileSync(outPath, JSON.stringify(out).replace(/,"(\d+)":\{"cheongryong"/g, ',\n"$1":{"cheongryong"'), 'utf8');
console.log(`로또 선생: ${added}개 회차 새로 계산 (${Date.now() - t0}ms) · 다음 ${next}회 → ` +
  T.TEACHERS.map(t => `${t.name} [${out.picks[next][t.id].join(',')}]`).join(' / '));
