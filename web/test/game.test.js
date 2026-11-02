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
import { pathInfo, difficultyMult } from '../js/scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}
const fresh = () => new Game(stages, CONFIG, memoryStorage());
const C = CONFIG;

test('stages.json: 30 Stage、各 3 Board、マス数は偶数で 2 ずつ増える、par 0', () => {
  assert.equal(stages.length, 30);
  for (const [k, s] of stages.entries()) {
    assert.equal(s.boards.length, 3, `stage ${s.stage}`);
    assert.equal(s.par, 0);
    assert.equal(s.cellsCount, 26 + 2 * k);
    for (const b of s.boards) assert.equal(b.cells.length, s.cellsCount);
  }
});

test('選択 → Pair を消す → 得点 = 基礎点 × 難しさ倍率 × Chain 倍率', () => {
  const g = fresh();
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  const diff = difficultyMult(C.difficulty, pathInfo(g.stage.board, i, j)).mult;
  assert.deepEqual(g.tap(i, 1000).map((e) => e.type), ['select']);
  const evs = g.tap(j, 1000);
  assert.equal(evs[0].type, 'remove');
  assert.equal(evs[0].chain, 1);
  assert.equal(evs[0].mult, 1 + C.chain.step);
  assert.equal(evs[0].speed, null);
  assert.equal(evs[0].pairPoints, Math.round(C.score.pairBase * diff * (1 + C.chain.step)));
  assert.equal(g.run.score, evs[0].points);
});

test('速さ Bonus: 前の消去から 1 秒以内は FAST', () => {
  const g = fresh();
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i, 1000); g.tap(j, 1000);
  const [k, l] = validPairs(g.stage.board)[0];
  const ev = g.tap(k, 1500).concat(g.tap(l, 1500)).find((e) => e.type === 'remove');
  assert.equal(ev.speed, 'fast');
  assert.equal(ev.pairPoints, Math.round(C.score.pairBase * ev.diffMult * ev.mult * C.speed.fastMult));
});

test('倍率: Chain 1 回ごとに +1.0、9 回で上限 ×10 → FEVER', () => {
  const g = fresh();
  assert.equal(g.multiplierFor(0), 1);
  assert.equal(g.multiplierFor(4), 5);
  assert.equal(g.multiplierFor(9), C.chain.max);
  g.newRun(0);
  g.stage.board = [5, 5, 1, 9, 2, 8];
  g.stage.chain = 8;
  const evs = g.tap(0, 5000).concat(g.tap(1, 5000));
  assert.ok(evs.some((e) => e.type === 'feverStart'));
  assert.equal(g.inFever, true);
  const ev = g.tap(2, 5100).concat(g.tap(3, 5100)).find((e) => e.type === 'remove');
  assert.equal(ev.fever, true);
  assert.equal(ev.pairPoints, Math.round(C.score.pairBase * ev.diffMult * C.chain.max * C.speed.fastMult * C.fever.pointMult));
  assert.equal(g.tick(5000 + 9000).length, 0);                   // FEVER 中は減らない
  assert.equal(g.tick(5000 + C.fever.durationMs + 1).length, 0); // 1 回消したので extendMs だけ延びている
  const end = g.tick(5000 + C.fever.durationMs + C.fever.extendMs + 1);
  assert.equal(end[0].type, 'feverEnd');
  assert.equal(g.stage.chain, Math.floor(10 * C.fever.endChainRatio));
});

test('Chain ゲージ: 猶予のあと時間で減る', () => {
  const g = fresh();
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i, 10000); g.tap(j, 10000);
  g.stage.chain = 5;
  assert.equal(g.tick(10000 + C.chain.decayGraceMs - 1).length, 0);
  assert.equal(g.tick(10000 + C.chain.decayGraceMs + 1)[0].type, 'chainDecay');
  assert.equal(g.stage.chain, 4);
  g.tick(10000 + C.chain.decayGraceMs + C.chain.decayStepMs * 10);
  assert.equal(g.stage.chain, 0);
});

test('Hint の段階: 倍率で HINT / FLASH / SCOPE、FEVER 中は SCOPE', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.chain = 0; assert.equal(g.hintTier, 'hint');
  g.stage.chain = 3; assert.equal(g.hintTier, 'flash');          // ×4.0
  g.stage.chain = 7; assert.equal(g.hintTier, 'scope');          // ×8.0
  g.stage.chain = 0; g.stage.fever = { until: 1e12 }; assert.equal(g.hintTier, 'scope');
});

test('HINT(低倍率): 使用回数 1、示された Pair は得点半分で Chain は維持', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.chain = 1;
  const h = g.useHint(1000);
  assert.equal(h[0].type, 'hint'); assert.equal(h[0].tier, 'hint');
  assert.equal(g.stage.hintsLeft, C.hint.perStage - 1);
  assert.equal(g.stage.chain, 1);                                 // 途切れない
  const [i, j] = h[0].pair;
  const ev = g.tap(i, 2000).concat(g.tap(j, 2000)).find((e) => e.type === 'remove');
  assert.equal(ev.hinted, true);
  assert.equal(ev.chain, 1);                                      // 増えない
  assert.equal(ev.pairPoints, Math.round(C.score.pairBase * ev.diffMult * g.multiplierFor(1) * ev.speedMult * C.score.hintedPairRatio));
  // 使用上限
  g.stage.hintsLeft = 0;
  assert.equal(g.useHint(3000)[0].type, 'noHints');
});

test('FLASH(中倍率): 全 Pair を返し、ゲージが半分、時間で終わる', () => {
  const g = fresh();
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i, 1000); g.tap(j, 1000);
  g.stage.chain = 4;
  const f = g.useHint(2000);
  assert.equal(f[0].type, 'flash');
  assert.deepEqual(f[0].pairs, validPairs(g.stage.board));
  assert.ok(Math.abs(g.gaugeRatio(2000) - C.hint.flashGaugeRatio) < 0.01);
  assert.equal(g.stage.chain, 4);
  assert.equal(g.tick(2000 + C.hint.flashMs + 1)[0].type, 'flashEnd');
});

test('SCOPE(高倍率): 相手のいるタイル。成功で全て獲得・Chain 維持、外すと −3 → 半分、無視で半分', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.board = [1, 9, 0, 0, 0, 0, 0, 0, 0, 5, 5, 2, 8, 0, 0, 0, 0, 0];
  g.stage.chain = 7;                                              // ×8.0
  const sc = g.useHint(1000);
  assert.equal(sc[0].type, 'scope');
  assert.equal(sc[0].remaining, validPairs(g.stage.board).length);
  const tile = sc[0].tile;
  const partner = validPairs(g.stage.board).find(([a, b]) => a === tile || b === tile);
  const other = partner[0] === tile ? partner[1] : partner[0];
  // 外す: tile と、Pair にならない別のタイル
  const wrong = [0, 1, 9, 10, 11, 12].find((p) => p !== tile && p !== other && !validPairs(g.stage.board).some(([a, b]) => (a === tile && b === p) || (a === p && b === tile)));
  g.tap(tile, 1100);
  const miss = g.tap(wrong, 1200);
  assert.ok(miss.some((e) => e.type === 'scopeMiss' && e.misses === 1));
  assert.equal(g.stage.chain, 7 - C.hint.scopeMissChain);
  // 成功
  g.stage.selected = null;
  g.tap(tile, 1300);
  const ok = g.tap(other, 1400).find((e) => e.type === 'remove');
  assert.equal(ok.scoped, true);
  assert.equal(ok.chain, 7 - C.hint.scopeMissChain);              // 維持
  assert.equal(ok.speed, null);                                   // Speed なし
  assert.equal(g.stage.scope, null);
  // 無視: 別の Pair を消すと半分
  const g2 = fresh();
  g2.newRun(0);
  g2.stage.board = [1, 9, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 0, 0];
  g2.stage.chain = 8;
  const sc2 = g2.useHint(1000);
  const t2 = sc2[0].tile;
  const otherPair = validPairs(g2.stage.board).find(([a, b]) => a !== t2 && b !== t2);
  const ev2 = g2.tap(otherPair[0], 1100).concat(g2.tap(otherPair[1], 1200));
  const rm2 = ev2.find((e) => e.type === 'remove');
  assert.equal(rm2.scopeBroken, true);
  assert.ok(ev2.some((e) => e.type === 'scopeEnd' && e.reason === 'ignored'));
  assert.equal(g2.stage.chain, Math.floor(8 * C.hint.scopeBreakRatio) + 1);   // 半分にしてから +1
});

test('FEVER 中の Hint は使用回数ではなく FEVER 時間で払う', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.fever = { until: 20000 };
  const before = g.stage.hintsLeft;
  const sc = g.useHint(10000);
  assert.equal(sc[0].type, 'scope');
  assert.equal(g.stage.hintsLeft, before);
  assert.equal(g.stage.fever.until, 20000 - C.fever.hintTimeCostMs);
});

test('Dead End: Hint は使用回数 1 と Chain 半分と減点。Add 無しなら重い失敗。Add は Chain 半分', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.chain = 6; g.stage.stageScore = 500; g.run.score = 500;
  g.stage.board = [1, 2, 3];
  const h = g.useHint(1000);
  assert.equal(h[0].type, 'noHint'); assert.equal(h[0].blind, false);
  assert.equal(g.stage.chain, Math.floor(6 * C.hint.stuckKeepRatio));
  assert.equal(g.stage.hintsLeft, C.hint.perStage - 1);
  assert.equal(g.run.score, 500 - C.score.hintWhenStuck);
  g.stage.chain = 6;
  const a = g.useAdd(2000);
  assert.equal(a[0].stuckBefore, true);
  assert.equal(a[0].chainAfter, Math.floor(6 * C.stuck.addKeepRatio));
  const g2 = fresh();
  g2.newRun(0);
  g2.stage.board = [1, 2, 3]; g2.stage.addsLeft = 0; g2.run.score = 2000; g2.stage.stageScore = 800;
  const evs2 = g2.useHint(1000);
  assert.deepEqual(evs2.map((e) => e.type), ['noHint', 'stageFailed']);
  assert.equal(evs2[1].reason, 'blindHint');
  assert.equal(g2.run.score, 2000 - 800 - C.score.blindHintPenalty);
});

test('Add: Pair が残っているのに押すと Chain が途切れる。Add が尽きたら GIVE UP(半分残る)', () => {
  const g = fresh();
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i); g.tap(j);
  const evs = g.useAdd();
  assert.equal(evs[0].type, 'add'); assert.equal(evs[0].chainAfter, 0);
  assert.equal(g.stage.addsLeft, stages[0].adds - 1);
  g.stage.addsLeft = 0; g.run.score = 2000; g.stage.stageScore = 800;
  const gu = g.useAdd();
  assert.equal(gu[0].type, 'stageFailed'); assert.equal(gu[0].reason, 'giveUp'); assert.equal(gu[0].kept, 400);
});

function playGreedy(g) {
  let guard = 2000;
  while (g.stage.status === 'play' && guard-- > 0) {
    const pairs = validPairs(g.stage.board);
    if (pairs.length === 0) { g.useAdd(); continue; }
    const [i, j] = pairs[0];
    g.tap(i); g.tap(j);
  }
}

test('貪欲プレイで Stage を終えると clear か failed になる。Clear なら Hint 温存 Bonus が付く', () => {
  const g = fresh();
  g.newRun(0);
  playGreedy(g);
  assert.ok(['clear', 'failed', 'runOver'].includes(g.stage.status), g.stage.status);
  if (g.stage.status === 'clear') {
    assert.ok(isCleared(g.stage.board));
    assert.ok(['S', 'A', 'B', 'C'].includes(g.progress.ranks[1]));
  }
});

test('Perfect Clear: Heart 回復・Star 3・温存 Bonus(Add と Hint)・Rank', () => {
  const g = fresh();
  g.newRun(0);
  g.run.lives = 1;
  g.stage.board = [5, 5];
  const clear = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'stageClear');
  assert.ok(clear);
  assert.equal(clear.perfect, true); assert.equal(clear.stars, 3); assert.equal(clear.lifeGain, 1);
  assert.equal(clear.savedBonus, stages[0].adds * C.score.addSaved);
  assert.equal(clear.hintBonus, C.hint.perStage * C.score.hintSaved);
  assert.equal(g.progress.ranks[1], clear.rank);
});

test('GIVE UP → Heart 減少 → 3 回で Run 終了、再開地点は World のはじめ', () => {
  const g = fresh();
  g.newRun(6);
  g.giveUp(); assert.equal(g.run.lives, 2); g.retryStage();
  g.giveUp(); g.retryStage();
  const e3 = g.giveUp();
  assert.equal(e3[0].type, 'runOver'); assert.equal(e3[0].resumeStage, 5);
});

test('保存と復元: resume で時間の影響を消す', () => {
  const storage = memoryStorage();
  const g = new Game(stages, CONFIG, storage);
  g.newRun(0);
  const [i, j] = validPairs(g.stage.board)[0];
  g.tap(i, 1000); g.tap(j, 1000);
  const g2 = new Game(stages, CONFIG, storage);
  assert.deepEqual(g2.stage.board, g.stage.board);
  g2.resume(999999);
  assert.equal(g2.tick(999999 + 100).length, 0);
});

test('行消しは倍率が掛かる', () => {
  const g = fresh();
  g.newRun(0);
  g.stage.chain = 4;
  g.stage.board = [1, 9, 0, 0, 0, 0, 0, 0, 0, 5, 5];
  const ev = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'remove');
  assert.equal(ev.clearedRows.length, 1);
  assert.equal(ev.rowPoints, Math.round(C.score.rowClear * 1 * g.multiplierFor(5)));
});
