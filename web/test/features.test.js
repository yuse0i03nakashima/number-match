// 新機能の総合テスト: 残数バー/あと1手予告、特殊タイル(GOLD/導火線)、ROGUE積み上げGAMBIT、DAILY CHALLENGE、Customize
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game, placeSpecials, shiftSpecials } from '../js/game.js';
import { CONFIG } from '../js/config.js';
import { boardInsights } from '../js/scoring.js';
import { GAMBITS, composeConfig, pickGambits } from '../js/gambit.js';
import { makeDailyStage, formatDailyShare } from '../js/daily.js';
import { parityOk, isCleared, removePair, collapseRows } from '../js/rules.js';
import { solve } from '../js/solver.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('boardInsights: 1〜9の残数、あと1手でDIGIT CLEARできる数字、あと1手で消える行を検出する', () => {
  // 1行目: [3, 7, 0,0,0,0,0,0,0] (2マス残り・同一ペアで全消し→almostRow、3と7は残1なのでfinishingDigits)
  // 2行目: [5, 5, 2, 0,0,0,0,0,0] (3マス残り→almostRowではない、5は残2で同数ペアなのでfinishingDigits)
  const board = [3, 7, 0, 0, 0, 0, 0, 0, 0, 5, 5, 2, 0, 0, 0, 0, 0, 0];
  const ins = boardInsights(board);
  assert.equal(ins.digitCounts[3], 1);
  assert.equal(ins.digitCounts[5], 2);
  assert.equal(ins.digitCounts[9], 0);
  assert.ok(ins.finishingDigits.has(3));
  assert.ok(ins.finishingDigits.has(7));
  assert.ok(ins.finishingDigits.has(5));
  assert.ok(!ins.finishingDigits.has(2));
  assert.ok(ins.almostRows.has(0));
  assert.ok(!ins.almostRows.has(1));
});

test('特殊タイル: GOLD は得点×2 と即時 Coin、導火線はカウント内に消すとボーナス・超過で鎮火、行縮約で位置追従', () => {
  const g = new Game(stages, CONFIG, mem());
  g.newRun(0);
  const sp = g.stage.specials;
  assert.equal(Object.values(sp).filter((x) => x.type === 'gold').length, CONFIG.special.goldCount);
  assert.equal(Object.values(sp).filter((x) => x.type === 'fuse').length, CONFIG.special.fuseCount);

  // 明示盤面で GOLD と導火線の効果と行縮約シフトを検証
  g.stage.board = [1, 9, 0, 0, 0, 0, 0, 0, 0, 5, 5, 4, 6, 0, 0, 0, 0, 0];
  g.stage.specials = { 0: { type: 'gold' }, 1: { type: 'fuse', left: 3 }, 9: { type: 'gold' }, 11: { type: 'fuse', left: 1 } };
  const ev = g.tap(0, 1000).concat(g.tap(1, 1000)).find((e) => e.type === 'remove');
  assert.equal(ev.goldHits, 1);
  assert.equal(ev.goldMult, 2);
  assert.equal(ev.goldCoins, CONFIG.special.goldCoins);
  assert.equal(ev.fuseHits, 1);
  assert.ok(ev.fusePoints > 0);
  assert.equal(ev.fuseExpired, 1);   // pos 11 の導火線(left 1)が鎮火
  assert.equal(g.coins, CONFIG.special.goldCoins);
  // 0 行目が消えて 1 行目が 0 行目にシフト → pos 9 の GOLD が pos 0 に移動していること
  assert.deepEqual(g.stage.specials, { 0: { type: 'gold' } });
  // CLASSIC では配置されない
  assert.deepEqual(placeSpecials(CONFIG, 1, stages[0].boards[0].cells, { classic: true }), {});
  assert.deepEqual(shiftSpecials({ 10: { type: 'gold' }, 2: { type: 'gold' } }, [0]), { 1: { type: 'gold' } });
});

test('ROGUE モード: World ごとに GAMBIT が積み上がり、複数札のシナジーが合成される', () => {
  const g = new Game(stages, CONFIG, mem());
  g.setMode('rogue');
  assert.equal(g.rogue, true);
  const evs1 = g.newRun(0);
  assert.ok(evs1.find((e) => e.type === 'gambit'));
  g.run.gambitOffer = ['blaze', 'ignite', 'midas'];
  g.chooseGambit('blaze', 1000);
  assert.deepEqual(g.gambitList.map((x) => x.id), ['blaze']);
  assert.equal(g.cfg.fever.durationMs, CONFIG.fever.durationMs * 2);

  // 次の World でも前の札は外れず、新しい札が積み上がる
  g.run.stageIndex = CONFIG.worldSize;
  const evs2 = g.startStage(null, 2000);
  const offer2 = evs2.find((e) => e.type === 'gambit');
  assert.ok(offer2);
  assert.ok(!offer2.options.some((o) => o.id === 'blaze'));   // 所持済みは出ない
  g.run.gambitOffer = ['midas', 'sniper', 'drain'];
  g.chooseGambit('midas', 2000);
  assert.deepEqual(g.gambitList.map((x) => x.id), ['blaze', 'midas']);
  assert.equal(g.cfg.fever.durationMs, CONFIG.fever.durationMs * 2);
  assert.equal(g.cfg.special.goldCount, CONFIG.special.goldCount * 2);
  assert.equal(g.cfg.rogue.coinMult, CONFIG.rogue.coinMult * 1.5);

  // 新 GAMBIT を含む全 12 枚と composeConfig / pickGambits の検査
  assert.equal(GAMBITS.length, 12);
  const syn = composeConfig(CONFIG, ['ignite', 'drain', 'sniper']);
  assert.equal(syn.perks.lineExtraChain, 1);
  assert.equal(syn.perks.digitExtraChain, 2);
  assert.equal(syn.perks.adjacentMult, 0.6);
  assert.ok(!pickGambits(42, 3, ['blaze', 'glass']).includes('blaze'));
});

test('DAILY CHALLENGE: 日付から決定論的に全消し可能な盤面を生成し、結果保存とシェア文が作れる', () => {
  const d1 = makeDailyStage('2026-11-26');
  const d2 = makeDailyStage('2026-11-26');
  const d3 = makeDailyStage('2026-11-27');
  assert.deepEqual(d1.boards[0].cells, d2.boards[0].cells);
  assert.notDeepEqual(d1.boards[0].cells, d3.boards[0].cells);
  assert.equal(d1.cellsCount % 2, 0);
  assert.equal(parityOk(d1.boards[0].cells), true);
  // 解を再生して本当に全消しできるか検証
  const sol = solve(d1.boards[0].cells, 4000);
  assert.ok(sol && sol.length > 0);
  let b = d1.boards[0].cells.slice();
  for (const [i, j] of sol) b = collapseRows(removePair(i, j, b));
  assert.equal(isCleared(b), true);

  const g = new Game(stages, CONFIG, mem());
  const r1 = g.recordDailyResult('2026-11-26', { score: 5000, rank: 'A', stars: 3, moves: 18, maxMult: 8, perfect: true });
  assert.equal(r1.improved, true);
  const r2 = g.recordDailyResult('2026-11-26', { score: 4000, rank: 'B', stars: 2, moves: 20, maxMult: 5, perfect: false });
  assert.equal(r2.improved, false);
  assert.equal(g.dailyChallenge['2026-11-26'].bestScore, 5000);
  assert.equal(g.dailyChallenge['2026-11-26'].plays, 2);

  const share = formatDailyShare({ dateKey: '2026-11-26', score: 12450, rank: 'S', stars: 3, moves: 20, maxMult: 10, perfect: true });
  assert.match(share, /THE TEN DAILY 2026-11-26/);
  assert.match(share, /12,450/);
  assert.match(share, /Rank S ★★★ PERFECT/);
});

test('Customize: Coin でテーマ・音色を開放して装備でき、保存と復元で維持される', () => {
  const storage = mem();
  const g = new Game(stages, CONFIG, storage);
  assert.equal(g.buyCustomize('themes', 'cyber').ok, false);   // Coin 不足
  g.coins = 10000;
  const b1 = g.buyCustomize('themes', 'cyber');
  assert.equal(b1.ok, true); assert.equal(b1.bought, true);
  assert.equal(g.unlocks.theme, 'cyber');
  assert.equal(g.coins, 10000 - 3000);
  // 開放済みなら Coin を減らさず装備変更
  const b2 = g.buyCustomize('themes', 'midnight');
  assert.equal(b2.ok, true); assert.equal(b2.bought, false);
  assert.equal(g.coins, 7000);
  g.buyCustomize('sounds', 'bell');
  g.setColorPairs(true);
  const g2 = new Game(stages, CONFIG, storage);
  assert.equal(g2.unlocks.theme, 'midnight');
  assert.equal(g2.unlocks.sound, 'bell');
  assert.equal(g2.unlocks.colorPairs, true);
  assert.ok(g2.unlocks.themes.includes('cyber'));
});
