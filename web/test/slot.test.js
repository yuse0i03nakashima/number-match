// slot.js(スロット)の検査: 役の判定、引き込み、役なしの回に揃わないこと、BONUS の持ち越し、払い戻し率。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Slot, evalLine, evaluate, STRIPS, simulate, LINES_FOR_BET } from '../js/slot.js';
import { CONFIG } from '../js/config.js';

const P = CONFIG.slot.payout;
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

test('evalLine: 役の判定', () => {
  assert.deepEqual(evalLine('T', 'T', 'T', P), { role: 'big', pay: P.big });
  assert.deepEqual(evalLine('S', 'S', 'S', P), { role: 'reg', pay: P.reg });
  assert.deepEqual(evalLine('7', '7', '7', P), { role: 'same', pay: 7 * P.samePerDigit, digit: 7 });
  assert.deepEqual(evalLine('1', '4', '5', P), { role: 'ten', pay: P.ten });
  assert.deepEqual(evalLine('3', 'S', '7', P), { role: 'pairStar', pay: P.pairStar });
  assert.equal(evalLine('1', '2', '3', P), null);
  assert.equal(evalLine('S', 'S', '7', P), null);
  assert.deepEqual(evalLine('5', '5', 'S', P), { role: 'pairStar', pay: P.pairStar });   // 5 と 5 も足して 10 の Pair
});

test('evaluate: 賭け枚数で有効ラインが変わり、払い戻しは一番高い 1 本だけ', () => {
  // 全リールを 5 が中段に来る位置にすると中段で 5,5,… は 15 で役なし。上段・下段は帯しだい
  const pos = STRIPS.map((s) => s.indexOf('T'));              // 中段に T を並べる
  const r1 = evaluate(pos, LINES_FOR_BET[1], P);
  assert.equal(r1.best.role, 'big');
  assert.equal(r1.total, P.big);
  const r5 = evaluate(pos, LINES_FOR_BET[5], P);
  assert.equal(r5.total, P.big);                             // 他のラインが揃っても足さない
});

test('Slot: 役なしの回は、最後のリールで何も揃わない位置を選ぶ', () => {
  const rng = lcg(42);
  const slot = new Slot({ ...CONFIG.slot, table: {} }, rng);  // 役は絶対に出ない
  slot.setBet(5);
  for (let i = 0; i < 300; i++) {
    const r = slot.start(1e9);
    assert.ok(r.ok);
    assert.equal(slot.flag, null);
    for (let k = 0; k < 3; k++) {
      const res = slot.stop(k, Math.floor(rng() * 21));
      if (res.result) assert.equal(res.result.win, 0, `役なしなのに揃った: ${JSON.stringify(res.result.wins)}`);
    }
  }
});

test('Slot: 役ありの回は、引き込み範囲で押せば揃い、範囲外ならこぼす。BONUS の役はこぼしても持ち越す', () => {
  const cfg = { ...CONFIG.slot, table: { big: 1 } };          // 必ず BIG
  const slot = new Slot(cfg, lcg(7));
  slot.setBet(1);                                             // 中段だけ
  const tPos = STRIPS.map((s) => s.indexOf('T'));
  // 1 回目: T の 3 コマ手前で押す → 引き込みで揃う
  let r = slot.start(100);
  assert.ok(r.ok && slot.flag.role === 'big');
  let res;
  for (let k = 0; k < 3; k++) res = slot.stop(k, (tPos[k] - 3 + 21) % 21);
  assert.equal(res.result.win, P.big);
  assert.equal(res.result.bonusStart, 'big');
  assert.equal(slot.bonus.kind, 'big');
  // BONUS 中は BONUS 用の表で抽選される(table に big は無いので small roles だけ)
  r = slot.start(100);
  assert.ok(!slot.flag || slot.flag.role !== 'big');
  for (let k = 0; k < 3; k++) res = slot.stop(k, 0);
  assert.equal(slot.bonus.left, cfg.bonus.big.games - 1);
  // 持ち越しの検査: 通常時に BIG を引いて、わざと範囲外で押す
  const slot2 = new Slot(cfg, lcg(9));
  slot2.setBet(1);
  slot2.start(100);
  for (let k = 0; k < 3; k++) res = slot2.stop(k, (tPos[k] + 3) % 21);   // T の 3 コマ先 → 18 コマ手前なので届かない
  assert.equal(res.result.win, 0);
  assert.equal(res.result.missed, true);
  const r2 = slot2.start(100);
  assert.equal(r2.carried, true);
  assert.equal(slot2.flag.role, 'big');
});

test('simulate: 払い戻し率はおおむね 0.8〜1.0(目押しなし・完璧の両方)', () => {
  for (const press of ['random', 'perfect']) {
    const r = simulate(CONFIG.slot, 6000, press, lcg(2024));
    assert.ok(r.rtp > 1.3 && r.rtp < 2.0, `${press}: ${r.rtp}`);   // 2026-11-12 から勝ちやすい設定(目安 1.6)。config.js の slot のコメント参照
  }
});

test('Slot: 賭け枚数は任意で、有効ラインは枚数で決まる', () => {
  const slot = new Slot(CONFIG.slot, lcg(3));
  slot.setBet(1); assert.equal(slot.lines, 1);
  slot.setBet(4); assert.equal(slot.lines, 3);
  slot.setBet(777); assert.equal(slot.lines, 5); assert.equal(slot.bet, 777);
  slot.setBet(0); assert.equal(slot.bet, 777);               // 1 未満は無視
  assert.equal(slot.start(500).ok, false);                   // 残高不足
});

test('Slot: toJSON / restore で記録と BONUS が戻る', () => {
  const slot = new Slot(CONFIG.slot, lcg(1));
  slot.stats.spins = 12; slot.stats.bigs = 1; slot.bonus = { kind: 'reg', left: 5 }; slot.setBet(3);
  const slot2 = new Slot(CONFIG.slot, lcg(1));
  slot2.restore(JSON.parse(JSON.stringify(slot.toJSON())));
  assert.equal(slot2.stats.spins, 12);
  assert.deepEqual(slot2.bonus, { kind: 'reg', left: 5 });
  assert.equal(slot2.bet, 3);
});
