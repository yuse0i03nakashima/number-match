// scoring.js の検査。道の種類と間の空マス、難しさ倍率、速さ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathInfo, difficultyMult, speedTier } from '../js/scoring.js';
import { CONFIG } from '../js/config.js';

const D = CONFIG.difficulty;

test('pathInfo: 隣どうし・同じ行で間が空・行をまたぐ', () => {
  //            0 1 2 3 4 5 6 7 8   9 ...
  const board = [1,9,0,0,3,0,0,0,2, 8,0,0,0,0,0,0,0,0];
  assert.deepEqual(pathInfo(board, 0, 1), { kind: 'adjacent', gap: 0 });
  assert.deepEqual(pathInfo(board, 1, 4), { kind: 'line', gap: 2 });
  assert.deepEqual(pathInfo(board, 8, 9), { kind: 'wrap', gap: 0 });
  assert.deepEqual(pathInfo(board, 4, 8), { kind: 'line', gap: 3 });
  assert.equal(pathInfo(board, 0, 4), null);   // 間に 9 がある
  const wrapGap = [0,0,0,0,3,0,0,0,0, 7,0,0,0,0,0,0,0,0];
  assert.deepEqual(pathInfo(wrapGap, 4, 9), { kind: 'wrap', gap: 4 });
});

test('pathInfo: 縦・斜め。複数の道があれば空マスの少ないほう', () => {
  const vertical = [5,0,0,0,0,0,0,0,0, 5,0,0,0,0,0,0,0,0];
  assert.deepEqual(pathInfo(vertical, 0, 9), { kind: 'vertical', gap: 0 });
  const diag = [4,0,0,0,0,0,0,0,0, 0,6,0,0,0,0,0,0,0];
  assert.deepEqual(pathInfo(diag, 0, 10), { kind: 'diagonal', gap: 0 });
  const diag2 = [4,0,0,0,0,0,0,0,0, 0,0,6,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0];
  assert.deepEqual(pathInfo(diag2, 0, 20), { kind: 'diagonal', gap: 1 });
});

test('difficultyMult: 横の隣どうしは ×1.0、縦・またぎ・斜めは倍率、空マスで加算', () => {
  assert.deepEqual(difficultyMult(D, { kind: 'adjacent', gap: 0 }), { mult: 1, labels: [] });
  assert.deepEqual(difficultyMult(D, { kind: 'line', gap: 2 }), { mult: 1 + 2 * D.gapPerCell, labels: ['OPENED'] });
  assert.deepEqual(difficultyMult(D, { kind: 'line', gap: 3 }), { mult: 1 + 3 * D.gapPerCell, labels: ['LONG SHOT'] });
  assert.deepEqual(difficultyMult(D, { kind: 'wrap', gap: 0 }), { mult: D.wrap, labels: ['WRAP'] });
  assert.deepEqual(difficultyMult(D, { kind: 'vertical', gap: 0 }), { mult: D.vertical, labels: ['VERTICAL'] });
  assert.deepEqual(difficultyMult(D, { kind: 'diagonal', gap: 0 }), { mult: D.diagonal, labels: ['DIAGONAL'] });
  assert.deepEqual(difficultyMult(D, { kind: 'diagonal', gap: 3 }), { mult: D.diagonal + 3 * D.diagonalGapPerCell, labels: ['DIAGONAL SNIPE'] });
  assert.deepEqual(difficultyMult(D, null), { mult: 1, labels: [] });
});

test('speedTier: 速いほど倍率が高い', () => {
  assert.deepEqual(speedTier(CONFIG.speed, 500), { tier: 'fast', mult: CONFIG.speed.fastMult });
  assert.deepEqual(speedTier(CONFIG.speed, 1500), { tier: 'quick', mult: CONFIG.speed.quickMult });
  assert.deepEqual(speedTier(CONFIG.speed, 5000), { tier: null, mult: 1 });
  assert.deepEqual(speedTier(CONFIG.speed, Infinity), { tier: null, mult: 1 });
});

test('sightLines: 縦・斜め・読み順に目を走らせ、空マスは ray、最初の数字は reach', async () => {
  const { sightLines } = await import('../js/scoring.js');
  // 3 行。中央(pos 13)から見る。右上 (5) は空、その先 (…) は盤外。左上 (3) は 7。
  const board = [
    1, 2, 3, 7, 5, 0, 7, 8, 9,
    1, 2, 3, 0, 5, 0, 7, 8, 9,
    1, 2, 3, 4, 0, 6, 7, 8, 9,
  ];
  const s = sightLines(board, 13);
  assert.ok(s.reach.includes(4));      // 真上
  assert.ok(s.ray.includes(22));       // 真下は空 → ray(その先は盤外)
  assert.ok(s.reach.includes(3));      // 左上の 7
  assert.ok(s.ray.includes(5) && !s.reach.includes(5));   // 右上は空、その先は盤外
  assert.ok(s.ray.includes(12) && s.reach.includes(11));  // 読み順で左: 空を越えて 3
  assert.ok(s.ray.includes(14) && s.reach.includes(15));              // 右隣は空、その先の 7
  assert.ok(s.reach.includes(23) && s.reach.includes(21));            // 右下 6、左下 4
});
