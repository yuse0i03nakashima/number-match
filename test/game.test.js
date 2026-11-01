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
import { pathInfo, difficultyBonus } from '../js/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));

// localStorage の代わり(メモリ上)
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}
const fresh = () => new Game(stages, CONFIG, memoryStorage());

test('stages.json: 30 ステージ、各 3 ボード、マス数は偶数で 2 ずつ増える、par 0', () => {
  assert.equal(stages.length, 30);
  for (const [k, s] of stages.entries()) {
    assert.equal(s.boards.length, 3, `stage ${s.stage}`);
    assert.equal(s.par, 0);
    assert.equal(s.cellsCount, 26 + 2 * k);
    for (const b of s.boards) {
      assert.equal(b.cells.length, s.cellsCount);
      assert.ok(b.cells.every((c) => c >= 1 && c <= 9));
    }
  }
});

test('選択 → ペアを消す → 得点(基礎点+道のボーナス)×倍率、チェーン', () => {
  const g = fresh();
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  const expectedBonus = difficultyBonus(CONFIG.score, pathInfo(g.stage.board, i, j)).bonus;
  assert.deepEqual(g.tap(i, 1000).map((e) => e.type), ['select']);
  const evs = g.tap(j, 1000);
  assert.equal(evs[0].type, 'remove');
  assert.equal(evs[0].chain, 1);
  assert.equal(evs[0].mult, 1 + CONFIG.chain.step);
  assert.equal(evs[0].speed, null);            // 最初の消去に速さボーナスは無い
  assert.equal(evs[0].pairPoints, Math.round((CONFIG.score.pairBase + expectedBonus) * (1 + CONFIG.chain.step)));
  assert.equal(g.run.score, evs[0].points);
  assert.equal(g.stage.selected, null);
});

test('速さボーナス: 前の消去から 1 秒以内は FAST、倍率が掛かる', () => {
  const g = fresh();
  g.newRun(0);
  let t = 1000;
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i, t); g.tap(j, t);
  const [k, l] = validPairs(g.stage.board)[0];
  t += 500;
  const ev = g.tap(k, t).concat(g.tap(l, t)).find((e) => e.type === 'remove');
  assert.equal(ev.speed, 'fast');
  assert.equal(ev.speedMult, CONFIG.speed.fastMult);
  const bonus = difficultyBonus(CONFIG.score, ev.path).bonus;
  assert.equal(ev.pairPoints, Math.round((CONFIG.score.pairBase + bonus) * ev.mult * CONFIG.speed.fastMult));
});

test('倍率は上限で止まる', () => {
  const g = fresh();
  assert.equal(g.multiplierFor(0), 1);
  assert.equal(g.multiplierFor(1000), CONFIG.chain.max);
});

test('ペアにならない 2 つ: invalid と選択の移動', () => {
  const g = fresh();
  g.newRun(0);
  const b = g.stage.board;
  let p = -1;
  for (let k = 0; k + 1 < b.length; k++) if (!(b[k] === b[k + 1] || b[k] + b[k + 1] === 10)) { p = k; break; }
  assert.ok(p >= 0);
  g.tap(p);
  const evs = g.tap(p + 1);
  assert.deepEqual(evs.map((e) => e.type), ['invalid', 'select']);
  assert.equal(g.stage.selected, p + 1);
});

test('Add: ペアが残っているのに押すとチェーンが途切れる', () => {
  const g = fresh();
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i); g.tap(j);
  assert.equal(g.stage.chain, 1);
  const before = g.stage.board.length;
  const evs = g.useAdd();
  assert.equal(evs[0].type, 'add');
  assert.equal(evs[0].stuckBefore, false);
  assert.equal(evs[0].chainAfter, 0);
  assert.ok(g.stage.board.length > before);
  assert.equal(g.stage.addsLeft, stages[0].adds - 1);
  assert.equal(g.stage.addsUsed, 1);
});

test('詰み: ゲームは教えない。Add は控えめ(チェーン半分)、Hint は途切れて減点', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.chain = 6;
  g.stage.stageScore = 500; g.run.score = 500;
  g.stage.board = [1, 2, 3];          // ペアが無い
  // 消去後の判定は詰みを知らせない(stuck イベントなし)
  assert.equal(g.afterBoardChange().length, 0);
  // Hint: 途切れて減点
  const h = g.useHint();
  assert.equal(h[0].type, 'noHint');
  assert.equal(h[0].penalty, CONFIG.score.hintWhenStuck);
  assert.equal(g.stage.chain, 0);
  assert.equal(g.run.score, 500 - CONFIG.score.hintWhenStuck);
  // Add: 詰みなのでチェーンの半分が残る
  g.stage.chain = 6;
  const a = g.useAdd();
  assert.equal(a[0].stuckBefore, true);
  assert.equal(a[0].chainAfter, Math.floor(6 * CONFIG.stuck.addKeepRatio));
});

test('詰み + Add 無し: Hint か Add を押した時点で失敗', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.board = [1, 2, 3];
  g.stage.addsLeft = 0;
  const evs = g.useAdd();
  assert.equal(evs[0].type, 'stageFailed');
  assert.equal(evs[0].reason, 'stuck');
  const g2 = fresh();
  g2.newRun(0);
  g2.stage.board = [1, 2, 3];
  g2.stage.addsLeft = 0;
  const evs2 = g2.useHint();
  assert.deepEqual(evs2.map((e) => e.type), ['noHint', 'stageFailed']);
});

test('Hint: ペアがあれば 1 つ返し、チェーンが途切れる', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.chain = 3;
  const evs = g.useHint();
  assert.equal(evs[0].type, 'hint');
  assert.equal(evs[0].brokeChain, true);
  assert.equal(g.stage.chain, 0);
  const [i, j] = evs[0].pair;
  const remove = g.tap(i).concat(g.tap(j));
  assert.ok(remove.some((e) => e.type === 'remove'));
});

// 常に先頭のペアを消す「貪欲」なプレイ。詰まったら Add、Add も無ければ Add を押して失敗になる。
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
  const g = fresh();
  g.newRun(0);
  playGreedy(g);
  assert.ok(['clear', 'failed', 'runOver'].includes(g.stage.status), g.stage.status);
  if (g.stage.status === 'clear') {
    assert.ok(isCleared(g.stage.board));
    assert.ok(g.progress.stars[1] >= 1);
    assert.equal(g.progress.maxStage, 1);
  }
});

test('あきらめる → ハート減少 → 3 回でラン終了、再開地点はワールドのはじめ', () => {
  const g = fresh();
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

test('パーフェクトクリアでハート回復・スター 3', () => {
  const g = fresh();
  g.newRun(0);
  g.run.lives = 1;
  g.stage.board = [5, 5];
  const evs = g.tap(0).concat(g.tap(1));
  const clear = evs.find((e) => e.type === 'stageClear');
  assert.ok(clear);
  assert.equal(clear.perfect, true);
  assert.equal(clear.stars, 3);
  assert.equal(clear.lifeGain, 1);
  assert.equal(g.run.lives, 2);
  const next = g.nextStage();
  assert.equal(next[0].type, 'stageStart');
  assert.equal(g.run.stageIndex, 1);
});

test('行消しは倍率が掛かる', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.chain = 4;                                        // 倍率 1 + 0.5×5 = 3.5(消したあとの値)
  g.stage.board = [1, 9, 0, 0, 0, 0, 0, 0, 0, 5, 5];        // 1 行目を消すと行が消える
  const ev = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'remove');
  assert.equal(ev.clearedRows.length, 1);
  assert.equal(ev.rowPoints, Math.round(CONFIG.score.rowClear * 1 * g.multiplierFor(5)));
});
