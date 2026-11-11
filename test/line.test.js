// LINE TEN(試作): 一直線上で間が空マスの数字を 2〜4 個たどり、合計 10 で消す
import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, validGroups, isRun, removeCells, lineRuns } from '../js/rules.js';
import { groupInfo } from '../js/scoring.js';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';

const row = (...cells) => { const b = new Array(WIDTH * 3).fill(0); cells.forEach((c, k) => { b[k] = c; }); return b; };

test('横 1 列の 1 2 3 4 は 4 個の組だけが消せる(2 個・3 個の部分は 10 にならない)', () => {
  const b = row(1, 2, 3, 4);
  assert.deepEqual(validGroups(b), [[0, 1, 2, 3]]);
});

test('空マスを飛ばした 2 個・3 個、縦、斜め、読み順のまたぎを見つける。同じ数字の Pair は無い', () => {
  const b = new Array(WIDTH * 3).fill(0);
  b[0] = 6; b[2] = 4;                 // 横: 6 _ 4 → 10
  b[3] = 5; b[3 + WIDTH] = 5;          // 縦: 5 と 5 は足して 10 なので消せる(同じ数字だからではない)
  b[5] = 2; b[5 + WIDTH + 1] = 3; b[5 + 2 * (WIDTH + 1)] = 5;   // 右下斜め: 2 3 5 → 10
  b[8] = 7; b[WIDTH] = 3;              // 読み順: 行末の 7 と次の行頭の 3(間に数字が無い)
  b[2 * WIDTH] = 4; b[2 * WIDTH + 2] = 4;   // 横: 4 _ 4 は 8 なので消せない(同じ数字でも消せない)
  const g = validGroups(b).map((x) => x.join(','));
  assert.ok(g.includes('0,2'));
  assert.ok(g.includes([3, 3 + WIDTH].join(',')));
  assert.ok(g.includes([5, 5 + WIDTH + 1, 5 + 2 * (WIDTH + 1)].join(',')));
  assert.ok(g.includes([8, WIDTH].join(',')));
  assert.ok(!g.includes([2 * WIDTH, 2 * WIDTH + 2].join(',')));
});

test('isRun: 間の数字を飛ばした選択や一直線でない選択は認めない', () => {
  const b = row(1, 2, 7, 0, 0, 0, 0, 0, 0);
  assert.equal(isRun(b, [0, 1]), true);
  assert.equal(isRun(b, [0, 2]), false);        // 1 と 7 の間に 2 がある
  assert.equal(isRun(b, [0, 1, 2]), true);
  const c = new Array(WIDTH * 3).fill(0); c[0] = 1; c[5] = 9; c[WIDTH + 2] = 2;
  assert.equal(isRun(c, [0, WIDTH + 2]), false); // 桂馬の位置(読み順も 9 でふさがっている)
  assert.equal(isRun(c, [0, 5, WIDTH + 2]), true);    // 読み順なら 1 → 9 → 2 とたどれる(行末から次の行頭へ続く)
  assert.equal(lineRuns(row(1, 2, 3, 4, 5), 0).length, 3);   // 横に 2・3・4 個(maxLen 4)
  assert.deepEqual(removeCells([0, 2], row(1, 2, 3)), row(0, 2, 0));
});

test('groupInfo: 3 個の横並びは adjacent、間に空マスがあれば gap に数える', () => {
  assert.deepEqual(groupInfo(row(1, 2, 7), [0, 1, 2]), { kind: 'adjacent', gap: 0 });
  assert.deepEqual(groupInfo(row(1, 0, 2, 7), [0, 2, 3]), { kind: 'line', gap: 1 });
});

test('LINE モード: 4 個をたどると合計 10 の瞬間に消え、個数の倍率が掛かる。10 を超えると選び直し', () => {
  const stages = [{ stage: 1, cellsCount: 5, adds: 1, lineReady: true, boards: [{ cells: row(1, 2, 3, 4, 9) }] }];
  const g = new Game(stages, CONFIG, null);
  g.setMode('line');
  g.newRun(0);
  const t0 = 1_000_000;
  assert.equal(g.tap(0, t0)[0].type, 'select');
  assert.equal(g.tap(1, t0)[0].type, 'select');
  assert.equal(g.tap(2, t0)[0].type, 'select');
  const ev = g.tap(3, t0).find((e) => e.type === 'remove');
  assert.ok(ev);
  assert.deepEqual(ev.cells, [0, 1, 2, 3]);
  assert.equal(ev.sizeMult, CONFIG.line.sizeMult[4]);
  assert.ok(ev.labels.includes('QUAD'));
  assert.equal(g.stage.board.filter((c) => c !== 0).length, 1);   // 9 だけ残る
  // 9 のあとに別の面: 6 と 7 は 13 で選び直し
  const g2 = new Game([{ stage: 1, cellsCount: 2, adds: 1, lineReady: true, boards: [{ cells: row(6, 7) }] }], CONFIG, null);
  g2.setMode('line'); g2.newRun(0);
  g2.tap(0, t0);
  const evs = g2.tap(1, t0);
  assert.equal(evs[0].type, 'invalid');
  assert.deepEqual(evs[0].froms, [0]);
  assert.deepEqual(g2.stage.picks, [1]);
});
