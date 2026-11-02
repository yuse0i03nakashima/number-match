// quest.js(お題)と、World で残した Add の投資の検査。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';
import { makeQuest, updateQuest } from '../js/quest.js';
import { solve } from '../js/solver.js';

const here = dirname(fileURLToPath(import.meta.url));
const stages = JSON.parse(readFileSync(join(here, '..', 'levels', 'stages.json'), 'utf8'));
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test('makeQuest: 全 Stage の最初の Board に対して、お題が 1 つ決まり、同じ Stage では同じお題', () => {
  for (const def of stages) {
    const q1 = makeQuest(CONFIG, def.stage, def.boards[0].cells);
    const q2 = makeQuest(CONFIG, def.stage, def.boards[0].cells);
    assert.ok(['digitFirst', 'chain', 'diagonal', 'noHint'].includes(q1.type));
    assert.deepEqual(q1, q2);
  }
});

test('makeQuest: digitFirst は、その数字を最初に消し切る全消し手順があるときだけ出す', () => {
  // 1,9 / 5,5。5 を先に消し切ることも 1 を先に消し切ることもできる
  const board = [1, 9, 5, 5, 0, 0, 0, 0, 0];
  const q = makeQuest(CONFIG, 0, board);               // stage 0 → ORDER の先頭 digitFirst
  assert.equal(q.type, 'digitFirst');
  // 制約つき探索: 1 を最初に消し切る手順(1,9 を先に取る)がある
  const allow = (b, i, j, after) => !after.includes(1) || [b[i], b[j]].every((d) => d === 1 || after.includes(d));
  assert.ok(solve(board, 500, allow));
});

test('updateQuest: digitFirst は別の数字が先に消え切ると失敗、対象なら達成', () => {
  const q = { type: 'digitFirst', digit: 3, target: 1, progress: 0, done: false };
  let r = updateQuest(q, { type: 'remove', chain: 1, chainBefore: 0, digitsCleared: [], path: null, otherDigitClearedBefore: false });
  assert.equal(r.changed, false);
  r = updateQuest(q, { type: 'remove', chain: 2, chainBefore: 1, digitsCleared: [3, 7], path: null, otherDigitClearedBefore: false });
  assert.equal(r.done, true);
  const q2 = { type: 'digitFirst', digit: 3, target: 1, progress: 0, done: false };
  r = updateQuest(q2, { type: 'remove', chain: 1, chainBefore: 0, digitsCleared: [5], path: null, otherDigitClearedBefore: false });
  assert.equal(r.failed, true);
});

test('updateQuest: chain は Chain が伸びた手を数え、途切れると数え直し', () => {
  const q = { type: 'chain', target: 3, progress: 0, done: false };
  updateQuest(q, { type: 'remove', chain: 1, chainBefore: 0, digitsCleared: [], path: null });
  updateQuest(q, { type: 'remove', chain: 1, chainBefore: 1, digitsCleared: [], path: null });   // Hint で消した(伸びない)
  assert.equal(q.progress, 1);
  updateQuest(q, { type: 'break' });
  assert.equal(q.progress, 0);
  updateQuest(q, { type: 'remove', chain: 1, chainBefore: 0, digitsCleared: [], path: null });
  updateQuest(q, { type: 'remove', chain: 2, chainBefore: 1, digitsCleared: [], path: null });
  const r = updateQuest(q, { type: 'remove', chain: 3, chainBefore: 2, digitsCleared: [], path: null });
  assert.equal(r.done, true);
});

test('game.js: お題を達成すると Clear の Bonus に加わり、未達成なら加わらない', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.stage.quest = { type: 'noHint', target: 1, progress: 0, done: false, text: 'x' };
  g.stage.board = [5, 5];
  const ev = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'stageClear');
  assert.equal(ev.questBonus, CONFIG.quest.bonus);
  assert.equal(ev.quest.done, true);

  const g2 = new Game(stages, CONFIG, memoryStorage());
  g2.newRun(0);
  g2.stage.quest = { type: 'noHint', target: 1, progress: 0, done: false, text: 'x' };
  g2.stage.board = [5, 5, 1, 9];
  g2.useHint(1000);
  assert.equal(g2.stage.quest.failed, true);
  g2.stage.board = [5, 5];
  const ev2 = g2.tap(0, 2000).concat(g2.tap(1, 2000)).find((e) => e.type === 'stageClear');
  assert.equal(ev2.questBonus, 0);
});

test('game.js: World で残した Add が、次の World の開始 Chain と Heart になる', () => {
  const g = new Game(stages, CONFIG, memoryStorage());
  g.newRun(0);
  g.run.lives = 1;
  let last;
  for (let k = 0; k < CONFIG.worldSize; k++) {
    if (k === CONFIG.worldSize - 1) g.run.lives = 1;         // 最後の Stage の前に Heart を減らしておく
    g.stage.board = [5, 5];
    last = g.tap(0, 1000 * k + 1).concat(g.tap(1, 1000 * k + 1)).find((e) => e.type === 'stageClear');
    if (!last.worldEnd) g.nextStage();
  }
  assert.equal(last.worldEnd, true);
  const saved = last.savedAdds;
  assert.ok(saved >= CONFIG.worldSize * 2);                   // 各 Stage 2〜3 回を全部残した
  assert.equal(last.investChain, Math.min(CONFIG.invest.chainCap, saved * CONFIG.invest.chainPerAdd));
  // Heart: 上限 3 で残り 2。Perfect の回復 1 が先に入り、投資の分は残り 1
  assert.equal(last.investHearts, Math.min(1, Math.floor(saved / CONFIG.invest.addsPerHeart)));
  assert.equal(g.run.lives, CONFIG.lives.max);
  const start = g.nextStage();
  const ss = start.find((e) => e.type === 'stageStart');
  assert.equal(ss.invest, last.investChain);
  assert.equal(g.stage.chain, Math.max(last.chain, last.investChain));
  assert.equal(g.run.savedAdds, 0);                           // 次の World の数え直し
});
