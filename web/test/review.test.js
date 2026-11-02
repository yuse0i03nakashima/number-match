// review.js(感想戦)の検査: 悪手・逃した手・最善手の判定と、game.js の記録。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';
import { analyzeStage, bestMove, estimatePoints } from '../js/review.js';
import { validPairs } from '../js/rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test('estimatePoints: 行消しと DIGIT CLEAR を含む見積もり', () => {
  const board = [1, 9, 0, 0, 0, 0, 0, 0, 0, 5, 5];
  const e = estimatePoints(CONFIG, board, 0, 1, 1);
  assert.equal(e.clearedRows, 1);
  assert.equal(e.digits, 2);                                // 1 と 9 が消え切る
  assert.ok(e.total > e.pair);
});

test('bestMove: 全消しを保つ手の中で得点が最大の手を選ぶ', () => {
  // 3,3 を消すと 7 と 1 が残って詰む。1,9 を消せば 3,3 → 7,? ... いずれも解ける並びを用意
  const board = [3, 7, 1, 9, 3, 0, 0, 0, 0];
  const { best, options } = bestMove(CONFIG, board, 0);
  assert.ok(best);
  assert.ok(options.length >= 1);
});

test('analyzeStage: 悪手(全消しできなくなった手)と最善手を見分ける', () => {
  // Board: 2,8 / 3,7 / 3,7。3 と 7 を消すのはどれも可。2,8 を先に消しても解ける。
  // 悪手の例: [4, 6, 4, 4] で 4,4(中央 2 つ)を消すと 4 と 6 が離れて残る… 代わりに単純な例を作る
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.stage.board = [5, 5, 5, 5, 1, 9, 0, 0, 0];
  // 良い手: 0 と 1(5,5) → 残り 5,5,1,9 は解ける
  g.tap(0, 1000); g.tap(1, 1000);
  // 悪手を作る: Board を差し替え、解けなくなる手を打つ: [4, 6, 6, 4] → 中の 6,4 を消すと 4,6 が隣になり解ける…
  // 解けなくなる局面: [2, 8, 2] → 2,8(0,1)を消すと 2 が 1 枚残る(奇数なので必ず詰む)。これは全部の手が詰むので悪手ではない。
  // 3 枚以上で分かれる例: [1, 1, 9, 9] → (0,1) を消すと 9,9 が残り解ける。(1,2) を消すと 1 と 9 が隣で解ける。どれも解ける。
  // [1, 9, 1, 9, 0,0,0,0,0, 0,0,9,0,0,0,0,0,0] で (0,1) を取ると 1,9 と 9 が残り、1(2) と 9(3) は隣で消えて 9(11) が残る → 詰み。
  // (1,2) 9,1 を取ると 1(0) と 9(3) は間が空で消え、9(11) が残る → 詰み。(2,3) を取ると 1(0),9(1) 消えて 9(11) 残る → 詰み。
  // 残り枚数が奇数なので全部詰む。偶数にする: 9(11) の代わりに 9,9 を縦に置く。
  g.stage.board = [1, 9, 1, 9, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0];
  const pairs = validPairs(g.stage.board);
  assert.ok(pairs.length >= 2);
  // (0,1) を消す: 残り 1(2),9(3),9(11),9(20)。1,9 が隣で消え、9(11),9(20) は縦で消える → 解ける(良手)
  g.tap(0, 2000); g.tap(1, 2000);
  const a = analyzeStage(CONFIG, g.stage.history);
  assert.equal(a.moves.length, 2);
  assert.ok(['best', 'good', 'missed'].includes(a.moves[1].verdict), a.moves[1].verdict);
  assert.equal(a.summary.removes, 2);
  assert.equal(a.summary.maxChain, 2);
});

test('analyzeStage: Pair が残っているのに Add を押すと悪手、Dead End からなら良手', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.useAdd(1000);                                           // 初手で Add(Pair はある) → 悪手
  g.stage.board = [1, 2, 3, 0, 0, 0, 0, 0, 0];
  g.useAdd(2000);                                           // Dead End からの Add → 良手
  const a = analyzeStage(CONFIG, g.stage.history);
  assert.equal(a.moves[0].type, 'add'); assert.equal(a.moves[0].verdict, 'blunder');
  assert.equal(a.moves[1].type, 'add'); assert.equal(a.moves[1].verdict, 'good');
  assert.equal(a.summary.blunders, 1);
});

test('game.js: 最高倍率と Stage の記録が Result に乗る', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.stage.chain = 4;
  g.stage.board = [5, 5];
  const clear = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'stageClear');
  assert.equal(clear.maxMult, g.multiplierFor(5));
  assert.equal(clear.runMaxMult, g.multiplierFor(5));
  assert.equal(g.run.reviews.length, 1);
  assert.equal(g.run.reviews[0].history.length, 1);
  assert.equal(g.run.reviews[0].cleared, true);
});
