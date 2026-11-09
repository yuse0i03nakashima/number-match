import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeCode, normalizeCode, pickBoard, makeSetup, stageDefFrom, CODE_CHARS, CODE_LEN } from '../js/vs.js';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';

const stages = JSON.parse(readFileSync(new URL('../levels/stages.json', import.meta.url), 'utf8'));

test('合言葉は 4 文字で、見間違えやすい文字を含まない', () => {
  for (let i = 0; i < 200; i++) {
    const c = makeCode();
    assert.equal(c.length, CODE_LEN);
    for (const ch of c) assert.ok(CODE_CHARS.includes(ch));
    assert.ok(!/[IO01]/.test(c));
  }
  assert.equal(normalizeCode(' ab-cd '), 'ABCD');
  assert.equal(normalizeCode('a1b0c'), 'ABC');
  assert.equal(normalizeCode('abcdefg'), 'ABCD');
});

test('host が選んだ Board は、受け取った側で同じ cells の Stage になる', () => {
  const pick = pickBoard(stages, 2, CONFIG.worldSize, () => 0.7);
  assert.equal(Math.floor(pick.stageIndex / CONFIG.worldSize), 2);
  const setup = makeSetup(pick, { timeLimitMs: 180000, world: 2 });
  const def = stageDefFrom(setup);
  assert.deepEqual(def.boards[0].cells, pick.variant.cells);
  assert.equal(def.adds, pick.def.adds);
  // 両端末で同じ面データから Game を作ると、同じ Board で始まる
  const cfg = { ...CONFIG, vsMode: true };
  const a = new Game([def], cfg, null), b = new Game([stageDefFrom(setup)], cfg, null);
  a.newRun(0); b.newRun(0);
  assert.deepEqual(a.stage.board, b.stage.board);
  assert.equal(a.stage.addsLeft, pick.def.adds);
});

test('World の番号が範囲の外でも最後の World に収まる', () => {
  const pick = pickBoard(stages, 99, CONFIG.worldSize, () => 0.99);
  assert.ok(pick.stageIndex < stages.length);
  assert.ok(pick.def.boards.length >= 1);
});
