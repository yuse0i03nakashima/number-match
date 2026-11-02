// CLASSIC モードの検査: 倍率なし・FEVER なし・Heart なし・Dead End の通知・モードごとの記録。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}
const classic = () => { const g = new Game(stages, CONFIG, memoryStorage()); g.setMode('classic'); return g; };

test('CLASSIC: 倍率は常に ×1、Speed も付かず、9 連鎖しても FEVER にならない', () => {
  const g = classic();
  g.newRun(0);
  assert.equal(g.classic, true);
  g.stage.chain = 8;
  g.stage.board = [5, 5, 1, 9, 2, 8];
  const evs = g.tap(0, 1000).concat(g.tap(1, 1000));
  const ev = evs.find((e) => e.type === 'remove');
  assert.equal(ev.mult, 1);
  assert.equal(ev.speed, null);
  assert.equal(ev.pairPoints, CONFIG.score.pairBase);            // 横の隣どうし: 10 点ちょうど
  assert.ok(!evs.some((e) => e.type === 'feverStart'));
  assert.equal(g.multiplier, 1);
  assert.equal(g.hintTier, 'hint');
  // 離れた Pair(間に空マス)は小さな定額の加点
  const ev2 = g.tap(2, 1100).concat(g.tap(3, 1100)).find((e) => e.type === 'remove');
  assert.equal(ev2.pairPoints, CONFIG.score.pairBase);            // 1,9 は隣どうし
  g.stage.board = [2, 0, 0, 8, 0, 0, 0, 0, 0];
  const ev3 = g.tap(0, 1200).concat(g.tap(3, 1200)).find((e) => e.type === 'remove');
  assert.equal(ev3.pathBonus, CONFIG.classic.pathBonus);
  assert.equal(ev3.pairPoints, CONFIG.score.pairBase + CONFIG.classic.pathBonus);
});

test('CLASSIC: Add は 5 回。Dead End はすぐ知らせ、Add も無ければ Heart を減らさずに Stage 失敗', () => {
  const g = classic();
  g.newRun(0);
  assert.equal(g.stage.addsLeft, CONFIG.classic.addsPerStage);
  // 1,9 を消すと 2,3 だけ残って Dead End
  g.stage.board = [1, 9, 2, 3];
  const evs = g.tap(0, 1000).concat(g.tap(1, 1000));
  assert.ok(evs.some((e) => e.type === 'deadEnd'));
  assert.equal(g.stage.status, 'play');
  // Hint を押しても罰は無い
  const h = g.useHint(1100);
  assert.equal(h[0].type, 'noHint'); assert.equal(h[0].penalty, 0); assert.equal(g.stage.hintsLeft, CONFIG.hint.perStage);
  // Add が無い状態で Dead End になると失敗。Heart は減らない
  g.stage.addsLeft = 0;
  g.stage.board = [1, 9, 2, 3];
  const evs2 = g.tap(0, 1200).concat(g.tap(1, 1200));
  const fail = evs2.find((e) => e.type === 'stageFailed');
  assert.ok(fail);
  assert.equal(fail.classic, true);
  assert.equal(g.run.lives, CONFIG.lives.start);
});

test('CLASSIC: Perfect は Add も Hint も使わないこと。Heart は回復せず、World の終わりの投資は Add +N', () => {
  const g = classic();
  g.newRun(0);
  g.run.lives = 1;
  g.stage.board = [5, 5, 1, 9];
  g.useHint(900);
  g.stage.hintPair = null;
  let clear = g.tap(0, 1000).concat(g.tap(1, 1000), g.tap(2, 1100), g.tap(3, 1100)).find((e) => e.type === 'stageClear');
  assert.equal(clear.perfect, false);
  assert.equal(clear.stars, 2);
  assert.equal(g.run.lives, 1);
  // 残り 4 Stage を Perfect で進み、World の終わりに投資を受け取る
  for (let k = 1; k < CONFIG.worldSize; k++) {
    g.nextStage();
    g.stage.board = [5, 5];
    clear = g.tap(0, 2000 + k).concat(g.tap(1, 2000 + k)).find((e) => e.type === 'stageClear');
  }
  assert.equal(clear.worldEnd, true);
  assert.equal(clear.perfect, true);
  const expected = Math.min(CONFIG.classic.investAddsCap, Math.floor(clear.savedAdds / CONFIG.classic.investAddsPer));
  assert.equal(clear.investAdds, expected);
  assert.equal(clear.investChain, 0);
  g.nextStage();
  assert.equal(g.stage.addsLeft, CONFIG.classic.addsPerStage + expected);
  assert.equal(g.stage.addsTotal, CONFIG.classic.addsPerStage + expected);
});

test('モードごとに記録と Run が別。保存して読み直しても同じで、旧形式の保存は NORMAL に入る', () => {
  const storage = memoryStorage();
  const g = new Game(stages, CONFIG, storage);
  g.newRun(0);
  g.stage.board = [5, 5];
  g.tap(0, 1000); g.tap(1, 1000);
  const normalBest = g.progress.bestScore;
  assert.ok(normalBest > 0);
  g.setMode('classic');
  assert.equal(g.progress.bestScore, 0);
  assert.equal(g.run, null);
  g.newRun(0);
  assert.equal(g.classic, true);
  const g2 = new Game(stages, CONFIG, storage);
  assert.equal(g2.mode, 'classic');
  assert.ok(g2.run && g2.stage);
  g2.setMode('normal');
  assert.equal(g2.progress.bestScore, normalBest);
  assert.equal(g2.run.stage.status, 'clear');
  // 旧形式
  const old = memoryStorage();
  old.setItem(CONFIG.storageKey, JSON.stringify({ progress: { maxStage: 3, stars: { 1: 3 }, ranks: {}, attempts: {}, bestScore: 1234, runs: 2, relax: true }, run: null }));
  const g3 = new Game(stages, CONFIG, old);
  assert.equal(g3.mode, 'normal');
  assert.equal(g3.progress.bestScore, 1234);
  assert.equal(g3.progress.maxStage, 3);
  assert.equal('relax' in g3.progress, false);
});
