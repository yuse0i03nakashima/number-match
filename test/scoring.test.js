// scoring.js の検査。道の種類と間の空マス、ボーナス、速さ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathInfo, difficultyBonus, speedTier } from '../js/scoring.js';
import { CONFIG } from '../js/config.js';

const S = CONFIG.score;

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
  // 0 と 10 は読み順(間 9 マス)でもつながるが、斜め(間 0)を選ぶ
  const diag2 = [4,0,0,0,0,0,0,0,0, 0,0,6,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0];
  assert.deepEqual(pathInfo(diag2, 0, 20), { kind: 'diagonal', gap: 1 });
});

test('difficultyBonus: 間の空マス・またぎ・斜めで加点、ラベルが付く', () => {
  assert.deepEqual(difficultyBonus(S, { kind: 'adjacent', gap: 0 }), { bonus: 0, labels: [] });
  assert.deepEqual(difficultyBonus(S, { kind: 'line', gap: 2 }), { bonus: 2 * S.gapPerCell, labels: ['OPENED'] });
  assert.deepEqual(difficultyBonus(S, { kind: 'line', gap: 3 }), { bonus: 3 * S.gapPerCell, labels: ['LONG SHOT'] });
  assert.deepEqual(difficultyBonus(S, { kind: 'wrap', gap: 0 }), { bonus: S.wrap, labels: ['WRAP'] });
  assert.deepEqual(difficultyBonus(S, { kind: 'diagonal', gap: 1 }), { bonus: S.gapPerCell + S.diagonal + S.diagonalGapPerCell, labels: ['OPENED', 'DIAGONAL SNIPE'] });
  assert.deepEqual(difficultyBonus(S, { kind: 'vertical', gap: 0 }), { bonus: S.vertical, labels: [] });
});

test('speedTier: 速いほど倍率が高い', () => {
  assert.deepEqual(speedTier(CONFIG.speed, 500), { tier: 'fast', mult: CONFIG.speed.fastMult });
  assert.deepEqual(speedTier(CONFIG.speed, 1500), { tier: 'quick', mult: CONFIG.speed.quickMult });
  assert.deepEqual(speedTier(CONFIG.speed, 5000), { tier: null, mult: 1 });
  assert.deepEqual(speedTier(CONFIG.speed, Infinity), { tier: null, mult: 1 });
});

test('difficultyBonus: 離れた斜めは空マスごとにさらに加点', () => {
  assert.deepEqual(difficultyBonus(S, { kind: 'diagonal', gap: 0 }), { bonus: S.diagonal, labels: ['DIAGONAL'] });
  assert.deepEqual(difficultyBonus(S, { kind: 'diagonal', gap: 2 }),
    { bonus: 2 * S.gapPerCell + S.diagonal + 2 * S.diagonalGapPerCell, labels: ['OPENED', 'DIAGONAL SNIPE'] });
});
