// Board を全部消しても止めずに続ける流れ: Chain と FEVER の持ち越し、World の終わりの判定。
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

test('ALL CLEAR: Chain と FEVER を次の Stage へ持ち越す。World の終わりだけ worldEnd', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.stage.chain = 6;
  g.stage.fever = { until: 99999 };
  g.stage.board = [5, 5];
  const clear = g.tap(0, 1000).concat(g.tap(1, 1000)).find((e) => e.type === 'stageClear');
  assert.equal(clear.worldEnd, false);                 // Stage 1 は World の途中
  assert.equal(clear.chain, 7);                        // 消した分 +1
  assert.equal(clear.fever, true);
  const next = g.nextStage(2000);
  assert.equal(next[0].type, 'stageStart');
  assert.equal(next[0].carried, true);
  assert.equal(g.stage.chain, 7);                      // 持ち越し
  assert.equal(g.stage.fever.until, 99999);
  assert.equal(g.stage.lastRemoveAt, 2000);            // ゲージは満タンから
  assert.equal(g.stage.stageScore, 0);                 // Stage の得点は Stage ごと
});

test('World の終わり(Stage 5)で worldEnd になる。失敗後の Retry は Chain 0 から', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(4);                                         // Stage 5
  g.stage.chain = 3;
  g.stage.board = [1, 9];
  const clear = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'stageClear');
  assert.equal(clear.worldEnd, true);
  const g2 = new Game(stages, CONFIG, memoryStorage());
  g2.newRun(0);
  g2.stage.chain = 5;
  g2.giveUp();
  g2.retryStage();
  assert.equal(g2.stage.chain, 0);
  assert.equal(g2.stage.fever, null);
});
