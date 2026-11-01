// solver.js: 全消し手順の探索と、Add の並びの選択。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { solve, chooseAddition } from '../js/solver.js';
import { removePair, collapseRows, isCleared, numbers } from '../js/rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));

test('solve: 面データの Board は全消しでき、手順を再生すると空になる', () => {
  for (const s of stages.slice(0, 5)) {
    const sol = solve(s.boards[0].cells, 4000);
    assert.ok(sol, `stage ${s.stage}`);
    let b = s.boards[0].cells;
    for (const [i, j] of sol) b = collapseRows(removePair(i, j, b));
    assert.ok(isCleared(b));
  }
});

test('solve: 奇数マスの Board は解けない', () => {
  assert.equal(solve([1, 2, 3], 1000), null);
});

test('chooseAddition: 足す数字は残っている数字と同じ集合で、全消しできる並びが選ばれる', () => {
  // 読み順では詰むが、並べ替えれば解ける Board
  const board = [1, 2, 3, 0, 0, 0, 0, 0, 0];
  const r = chooseAddition(board, { rand: () => 0.3 });
  assert.deepEqual(numbers(r.board).slice(0, 3), [1, 2, 3]);
  assert.deepEqual(numbers(r.board).slice(3).sort(), [1, 2, 3]);
  assert.equal(r.checked, true);
  assert.ok(solve(r.board, 3000) !== null);
});

test('chooseAddition: 大きい Board は確かめずに読み順(遅くならないように)', () => {
  const board = Array.from({ length: 100 }, (_, k) => (k % 9) + 1);
  const r = chooseAddition(board, { maxCells: 90 });
  assert.equal(r.checked, false);
  assert.equal(r.arrangement, 'order');
});
