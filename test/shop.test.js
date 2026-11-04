// Coin・ショップ・Stage ごとの最高得点の検査。
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

test('Coin: Stage Clear で Stage の得点が貯まり、Best Score や Stage Best とは別に保存される', () => {
  const storage = memoryStorage();
  const g = new Game(stages, CONFIG, storage);
  g.newRun(0);
  g.stage.board = [5, 5];
  const ev = g.tap(0, 1000).concat(g.tap(1, 1000)).find((e) => e.type === 'stageClear');
  assert.equal(ev.coinsGained, ev.stageScore);
  assert.equal(g.coins, ev.stageScore);
  assert.equal(ev.stageBestUpdated, true);
  assert.equal(g.progress.stageBest[1], ev.stageScore);
  const g2 = new Game(stages, CONFIG, storage);
  assert.equal(g2.coins, ev.stageScore);
  assert.equal(g2.progress.stageBest[1], ev.stageScore);
  // Coin を減らしても Best Score と Stage Best は変わらない
  g2.addCoins(-100);
  assert.equal(g2.coins, ev.stageScore - 100);
  assert.equal(g2.progress.bestScore, ev.stageScore);
  assert.equal(g2.progress.stageBest[1], ev.stageScore);
});

test('ショップ: 残り 0 のときだけ買え、Coin が足りなければ買えない。買った分は温存 Bonus に数えない', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  const p = CONFIG.shop.normal;
  assert.deepEqual(g.shopItems().map((e) => [e.item, e.can]), [['hint', false], ['add', false], ['heart', false]]);   // 残りがあるので買えない
  g.stage.addsLeft = 0; g.stage.hintsLeft = 0; g.run.lives = 2;
  assert.equal(g.buy('add')[0].type, 'noCoins');
  g.coins = p.add + p.hint + p.heart;
  const b1 = g.buy('add')[0];
  assert.equal(b1.type, 'buy'); assert.equal(g.stage.addsLeft, 1); assert.equal(g.stage.addsBought, 1);
  assert.equal(g.buy('hint')[0].type, 'buy'); assert.equal(g.stage.hintsLeft, 1);
  assert.equal(g.buy('heart')[0].type, 'buy'); assert.equal(g.run.lives, 3);
  assert.equal(g.coins, 0);
  assert.equal(g.buy('heart')[0].type, 'noCoins');
  // 買った Add と Hint を使わずに Clear: 温存 Bonus は 0、Perfect(Add 未使用)は保つ
  g.stage.board = [5, 5];
  const ev = g.tap(0, 1000).concat(g.tap(1, 1000)).find((e) => e.type === 'stageClear');
  assert.equal(ev.addsSaved, 0); assert.equal(ev.hintsSaved, 0);
  assert.equal(ev.savedBonus, 0); assert.equal(ev.hintBonus, 0);
  assert.equal(ev.perfect, true);
  assert.equal(g.run.savedAdds, 0);
});

test('ショップ: CLASSIC は値段が別で Heart は買えない', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.setMode('classic');
  g.newRun(0);
  g.stage.addsLeft = 0;
  g.coins = CONFIG.shop.classic.add;
  assert.equal(g.shopItems().some((e) => e.item === 'heart'), false);
  assert.equal(g.buy('add')[0].price, CONFIG.shop.classic.add);
  assert.equal(g.buy('heart')[0].type, 'noShop');
});
