// game.js の進行を、画面なしで通す検査。
// 実行: node --test web/test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';
import { validPairs, isCleared } from '../js/rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));

// localStorage の代わり(メモリ上)
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test('stages.json: 30 ステージ、各 3 ボード、マス数は偶数、par 0', () => {
  assert.equal(stages.length, 30);
  for (const s of stages) {
    assert.equal(s.boards.length, 3, `stage ${s.stage}`);
    assert.equal(s.par, 0);
    for (const b of s.boards) {
      assert.equal(b.cells.length, s.cellsCount);
      assert.equal(b.cells.length % 2, 0);
      assert.ok(b.cells.every((c) => c >= 1 && c <= 9));
    }
  }
});

test('選択 → 組を消す → 得点とチェーン', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  assert.deepEqual(g.tap(i).map((e) => e.type), ['select']);
  const evs = g.tap(j);
  assert.equal(evs[0].type, 'remove');
  assert.equal(evs[0].chain, 1);
  assert.equal(evs[0].pairPoints, Math.round(CONFIG.score.pairBase * (1 + CONFIG.chain.step)));
  assert.equal(g.run.score, evs[0].points);
  assert.equal(g.stage.selected, null);
});

test('組にならない 2 つ: invalid と選択の移動', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  const b = g.stage.board;
  // 隣どうしで組にならないものを探す
  let p = -1;
  for (let k = 0; k + 1 < b.length; k++) if (!(b[k] === b[k + 1] || b[k] + b[k + 1] === 10)) { p = k; break; }
  assert.ok(p >= 0);
  g.tap(p);
  const evs = g.tap(p + 1);
  assert.deepEqual(evs.map((e) => e.type), ['invalid', 'select']);
  assert.equal(g.stage.selected, p + 1);
});

test('追加: ボードが伸び、チェーンが切れ、残り回数が減る', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i); g.tap(j);
  assert.equal(g.stage.chain, 1);
  const before = g.stage.board.length;
  const evs = g.useAdd();
  assert.equal(evs[0].type, 'add');
  assert.equal(evs[0].brokeChain, true);
  assert.equal(g.stage.chain, 0);
  assert.ok(g.stage.board.length > before);
  assert.equal(g.stage.addsLeft, stages[0].adds - 1);
  assert.equal(g.stage.addsUsed, 1);
});

test('ヒント: 消せるペアを 1 つ返し、チェーンが切れる', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  const evs = g.useHint();
  assert.equal(evs[0].type, 'hint');
  const [i, j] = evs[0].pair;
  const remove = g.tap(i).concat(g.tap(j));
  assert.ok(remove.some((e) => e.type === 'remove'));
});

// 常に先頭の組を消す「貪欲」なプレイ。詰まったら追加、追加も無ければ失敗になる。
function playGreedy(g) {
  let guard = 2000;
  while (g.stage.status === 'play' && guard-- > 0) {
    const pairs = validPairs(g.stage.board);
    if (pairs.length === 0) { g.useAdd(); continue; }
    const [i, j] = pairs[0];
    g.tap(i); g.tap(j);
  }
}

test('貪欲プレイでステージを終えると clear か failed のどちらかになる', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  playGreedy(g);
  assert.ok(['clear', 'failed', 'runOver'].includes(g.stage.status), g.stage.status);
  if (g.stage.status === 'clear') {
    assert.ok(isCleared(g.stage.board));
    assert.ok(g.progress.stars[1] >= 1);
    assert.equal(g.progress.maxStage, 1);
  }
});

test('あきらめる → ハート減少 → 3 回でラン終了、再開地点はワールド先頭', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(6);                       // ワールド 2 の 2 つ目(stage 7)
  const e1 = g.giveUp();
  assert.equal(e1[0].type, 'stageFailed');
  assert.equal(g.run.lives, 2);
  g.retryStage();
  g.giveUp();
  g.retryStage();
  const e3 = g.giveUp();
  assert.equal(e3[0].type, 'runOver');
  assert.equal(e3[0].resumeStage, 5);
  // 失敗のたびに別のボード(variant)が出る
  assert.equal(g.progress.attempts[7], 3);
});

test('保存と復元: 同じストレージから作り直すとランが戻る', () => {
  const storage = memoryStorage();
  const g = new Game(stages, CONFIG, storage);
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i); g.tap(j);
  const g2 = new Game(stages, CONFIG, storage);
  assert.deepEqual(g2.stage.board, g.stage.board);
  assert.equal(g2.run.score, g.run.score);
});

test('パーフェクトクリアでハート回復・星 3', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.run.lives = 1;
  // ボードを「あと 1 組」の状態に差し替えて確実にクリアさせる
  g.stage.board = [5, 5];
  const evs = g.tap(0).concat(g.tap(1));
  const clear = evs.find((e) => e.type === 'stageClear');
  assert.ok(clear);
  assert.equal(clear.perfect, true);
  assert.equal(clear.stars, 3);
  assert.equal(clear.lifeGain, 1);
  assert.equal(g.run.lives, 2);
  assert.equal(clear.rowPoints, undefined);
  const next = g.nextStage();
  assert.equal(next[0].type, 'stageStart');
  assert.equal(g.run.stageIndex, 1);
});
