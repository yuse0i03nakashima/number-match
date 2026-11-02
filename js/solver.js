// 全消し手順を探す(generator/src/NumberMatch/Solver.hs の移植)。
// ゲーム中は Add の並びを選ぶために使う: 候補の並びごとに「Add なしで全消しできるか」を調べ、できる並びを採用する。
//
// 深さ優先探索。行が消える手を先に試し、同じ Board は二度調べない。budget は調べてよい状態の数。

import { validPairs, removePair, collapseRows, isCleared, addNumbers, numbers } from './rules.js';

/**
 * budget 状態以内に全消し手順が見つかれば手順([[i, j], ...])、見つからなければ null。
 * allow(board, i, j, after) を渡すと、false を返す手は使わない(お題の達成可能性の確認に使う)。
 */
export function solve(board, budget = 3000, allow = null) {
  const seen = new Set();
  let left = budget;
  const go = (b) => {
    if (isCleared(b)) return [];
    if (left <= 0) return null;
    const key = b.join(',');
    if (seen.has(key)) return null;
    seen.add(key); left -= 1;
    const pairs = validPairs(b);
    if (pairs.length === 0) return null;
    // 消した後の Board が短くなる(行が消える)手を先に
    const ordered = pairs
      .map(([i, j]) => ({ i, j, next: collapseRows(removePair(i, j, b)) }))
      .filter((m) => !allow || allow(b, m.i, m.j, m.next))
      .sort((x, y) => x.next.length - y.next.length || x.i - y.i || x.j - y.j);
    for (const m of ordered) {
      const rest = go(m.next);
      if (rest) return [[m.i, m.j], ...rest];
    }
    return null;
  };
  return go(board);
}

/**
 * Add の並びを選ぶ。残っている数字をどの順で末尾に足すかの候補を作り、
 * 全消しできると確かめられた最初の候補を返す。どれも確かめられなければ本家どおり読み順。
 * 返り値: { board, arrangement: 'order' | 'reversed' | 'shuffled' | 'fallback', checked: boolean }
 */
export function chooseAddition(board, { budget = 1500, tries = 4, maxCells = 90, rand = Math.random } = {}) {
  const base = addNumbers(board);                       // 読み順(本家と同じ)
  if (base.length > maxCells) return { board: base, arrangement: 'order', checked: false };
  const rest = numbers(board);
  const head = base.slice(0, base.length - rest.length);
  const candidates = [
    { arrangement: 'order', tail: rest },
    { arrangement: 'reversed', tail: rest.slice().reverse() },
  ];
  for (let k = 0; k < tries; k++) {
    const t = rest.slice();
    for (let a = t.length - 1; a > 0; a--) { const b = Math.floor(rand() * (a + 1)); [t[a], t[b]] = [t[b], t[a]]; }
    candidates.push({ arrangement: 'shuffled', tail: t });
  }
  for (const c of candidates) {
    const b = head.concat(c.tail);
    if (solve(b, budget)) return { board: b, arrangement: c.arrangement, checked: true };
  }
  return { board: base, arrangement: 'fallback', checked: true };
}
