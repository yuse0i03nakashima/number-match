// HARD モード(World 6 制覇で開放): Add 1・Heart 2・Hint 2、得点 2 倍・Coin 3 倍、World の始めに GAMBIT を 1 枚選ぶ
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';
import { GAMBITS, hardConfig, pickGambits } from '../js/gambit.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const hardGame = (defs = stages) => { const g = new Game(defs, CONFIG, mem()); g.slots.normal.progress.maxStage = CONFIG.hard.unlockStage; g.setMode('hard'); return g; };

test('HARD は NORMAL で 30 Stage を Clear するまで開放されず、setMode も無視される', () => {
  const g = new Game(stages, CONFIG, mem());
  assert.equal(g.hardUnlocked, false);
  g.setMode('hard');
  assert.equal(g.mode, 'normal');
  g.slots.normal.progress.maxStage = CONFIG.hard.unlockStage;
  assert.equal(g.hardUnlocked, true);
  g.setMode('hard');
  assert.equal(g.mode, 'hard');
  assert.equal(g.cfg.score.pairBase, CONFIG.score.pairBase * CONFIG.hard.pointMult);   // cfg は HARD 用に組み替わる
  g.setMode('normal');
  assert.equal(g.cfg, CONFIG);
});

test('HARD の Run: Heart 2・Add 1・Hint 2、World の始めに GAMBIT が 3 枚(重複なし)出る', () => {
  const g = hardGame();
  const evs = g.newRun(0);
  assert.equal(g.run.lives, CONFIG.hard.rules.lives.start);
  assert.equal(g.stage.addsLeft, CONFIG.hard.addsPerStage);
  assert.equal(g.stage.hintsLeft, CONFIG.hard.rules.hint.perStage);
  const offer = evs.find((e) => e.type === 'gambit');
  assert.ok(offer);
  assert.equal(offer.options.length, CONFIG.hard.gambitOffer);
  assert.equal(new Set(offer.options.map((o) => o.id)).size, offer.options.length);
  assert.ok(g.pendingGambit);
});

test('HARD の Clear: Coin は Stage 得点 × coinMult', () => {
  const g = hardGame([{ stage: 1, cellsCount: 2, adds: 2, boards: [{ cells: [1, 9] }] }]);
  g.newRun(0);
  const t0 = 1_000_000;
  g.tap(0, t0);
  const out = g.tap(1, t0);
  const clear = out.find((e) => e.type === 'stageClear');
  assert.ok(clear, 'Board を全部消すと Clear');
  assert.equal(clear.hard, true);
  assert.equal(clear.coinMult, CONFIG.hard.coinMult);
  assert.equal(clear.coinsGained, Math.floor(clear.stageScore * CONFIG.hard.coinMult));
  assert.equal(g.coins, clear.coinsGained);
});

test('HARD: GLASS を選んだ Run のあとに newRun しても Heart は既定値(2)で始まる', () => {
  const g = hardGame();
  g.newRun(0);
  g.run.gambitOffer = ['glass', 'blaze', 'rush'];
  g.chooseGambit('glass', 1_000_000);
  assert.equal(g.run.lives, 1);
  g.newRun(0);
  assert.equal(g.run.lives, CONFIG.hard.rules.lives.start);
});

test('GAMBIT: BLAZE は FEVER 2 倍・Hint 0。選ぶと今の Stage に効き、2 枚目は選べず、次の World で外れる', () => {
  const g = hardGame();
  g.newRun(0);
  g.run.gambitOffer = ['blaze', 'glass', 'rush'];
  const [ev] = g.chooseGambit('blaze', 1_000_000);
  assert.equal(ev.type, 'gambitChosen');
  assert.equal(ev.gambit.id, 'blaze');
  assert.equal(g.gambit.name, 'BLAZE');
  assert.equal(g.stage.hintsLeft, 0);
  assert.notEqual(g.stage.quest?.type, 'noHint');   // Hint 0 なので「Hint を使わずに」のお題は出し直す
  assert.equal(g.cfg.fever.durationMs, CONFIG.fever.durationMs * 2);
  assert.equal(g.cfg.hard.pointMult, CONFIG.hard.pointMult);
  assert.equal(g.chooseGambit('glass').length, 0);
  assert.equal(g.pendingGambit, null);
  // 次の World の最初の Stage では札が外れ、新しい 3 枚が出る
  g.run.stageIndex = CONFIG.worldSize;
  const evs = g.startStage();
  assert.equal(g.run.gambit, null);
  assert.ok(evs.find((e) => e.type === 'gambit'));
  assert.equal(g.cfg.fever.durationMs, CONFIG.fever.durationMs);
});

test('hardConfig / pickGambits: GLASS は Heart 1・Coin 2 倍、BLIND は得点 1.5 倍、同じ種なら同じ 3 枚', () => {
  const glass = hardConfig(CONFIG, 'glass');
  assert.equal(glass.lives.max, 1);
  assert.equal(glass.hard.coinMult, CONFIG.hard.coinMult * 2);
  const blind = hardConfig(CONFIG, 'blind');
  assert.equal(blind.score.pairBase, CONFIG.score.pairBase * CONFIG.hard.pointMult * 1.5);
  assert.equal(blind.hint.perStage, 0);
  assert.equal(hardConfig(CONFIG).slot.linesFor, CONFIG.slot.linesFor);   // 関数はそのまま
  assert.deepEqual(pickGambits(7, 3), pickGambits(7, 3));
  assert.equal(new Set(pickGambits(7, 3)).size, 3);
  assert.ok(GAMBITS.every((x) => x.id && x.name && x.up && x.down && typeof x.patch === 'function'));
});
