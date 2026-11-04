// 必殺技(SNIPE SHOT / LINE BREAK)と、Coin を使った Stage の最高得点の扱い。
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

test('SNIPE SHOT: 位置に関係なく Pair を消し、Coin を払う。Pair でなければ選び直し', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.coins = CONFIG.skill.normal.snipe;
  g.stage.board = [3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 7];   // 3 と 7 は離れていて普通は消せない
  assert.equal(g.armSkill('snipe')[0].type, 'skillArmed');
  assert.equal(g.tap(0, 1000)[0].type, 'select');
  const bad = g.tap(1, 1000);
  assert.equal(bad[0].type, 'invalid');                      // 3 と 1 は Pair ではない → 選び直し
  const evs = g.tap(17, 1100);                               // 1(選び直し後) と 7 も Pair ではない → 7 を選び直す
  assert.equal(evs[0].type, 'invalid');
  const ok = g.tap(0, 1200);                                 // 7 と 3 は Pair → 位置に関係なく消える
  assert.equal(ok[0].type, 'skillSnipe');
  assert.ok(ok.some((e) => e.type === 'remove' && e.skill === 'snipe'));
  assert.equal(g.coins, 0);
  assert.equal(g.stage.board[0], 0); assert.equal(g.stage.board[17], 0);
  assert.equal(g.stage.skill, null);
  assert.equal(g.stage.coinUsed, true);
});

test('LINE BREAK: タップした行を丸ごと消し、Line の得点が入る。空マスのタップで取りやめ', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.coins = CONFIG.skill.normal.line;
  g.stage.chain = 4;                                         // 倍率 ×5
  const board = g.stage.board.slice();
  assert.equal(g.armSkill('line')[0].type, 'skillArmed');
  const evs = g.tap(9 + 3, 1000);                            // 2 行目
  const ev = evs.find((e) => e.type === 'skillLine');
  assert.equal(ev.row, 1);
  assert.equal(ev.points, CONFIG.score.rowClear * 5);
  assert.equal(g.stage.board.length, board.length - 9);      // 行が消えて縮む
  assert.equal(g.coins, 0);
  // Coin が足りないと構えられない
  assert.equal(g.armSkill('line')[0].type, 'noCoins');
  // 取りやめ
  g.coins = CONFIG.skill.normal.line;
  g.armSkill('line');
  g.stage.board[0] = 0;
  assert.equal(g.tap(0, 2000)[0].type, 'skillCancel');
  assert.equal(g.coins, CONFIG.skill.normal.line);
});

test('Coin を使った Stage は Stage ごとの最高得点を更新しない', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.coins = CONFIG.skill.normal.snipe;
  g.stage.board = [5, 5];
  g.armSkill('snipe');
  const ev = g.tap(0, 1000).concat(g.tap(1, 1000)).find((e) => e.type === 'stageClear');
  assert.equal(ev.coinUsed, true);
  assert.equal(ev.stageBestUpdated, false);
  assert.equal(g.progress.stageBest[1], undefined);
});
