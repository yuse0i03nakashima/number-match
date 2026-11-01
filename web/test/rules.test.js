// Haskell 側が書き出したテストベクタ(vectors.json)と rules.js の結果が一致するか。
// 実行: node --test web/test   (リポジトリのルートで)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validPairs, removePair, collapseRows, addNumbers, connected, matches, parityOk } from '../js/rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, 'vectors.json'), 'utf8'));

test('matches: 同じ数字または合計 10', () => {
  assert.equal(matches(3, 3), true);
  assert.equal(matches(4, 6), true);
  assert.equal(matches(2, 3), false);
});

test('connected: 行をまたぐ偽の斜めは弾く', () => {
  const board = [0,0,0,0,0,0,0,0,3, 0,0,0,1,0,0,0,0,0, 7,0,0,0,0,0,0,0,0];
  assert.equal(connected(board, 8, 18), false);
  assert.equal(connected(board, 8, 12), true); // 読み順で間が空
});

test('parityOk: 基本', () => {
  assert.equal(parityOk([1, 9, 5, 5]), true);
  assert.equal(parityOk([1, 9, 5]), false);
});

test(`vectors.json の ${vectors.length} 件すべてで Haskell と一致`, () => {
  for (const [k, v] of vectors.entries()) {
    assert.deepEqual(validPairs(v.cells), v.pairs, `vector ${k}: validPairs`);
    if (v.afterRemoveFirst !== null) {
      const [i, j] = v.pairs[0];
      assert.deepEqual(collapseRows(removePair(i, j, v.cells)), v.afterRemoveFirst, `vector ${k}: remove+collapse`);
    }
    assert.deepEqual(addNumbers(v.cells), v.afterAdd, `vector ${k}: addNumbers`);
  }
});
