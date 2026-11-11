// LINE TEN(試作)の Board 作り。
//   足し算だけのルールでは、数字の合計が 10 の倍数でない Board は Add を何度しても全消しできない
//   (Add は残りの合計を 2 倍にするだけなので、5 の倍数でない合計は永久に 10 の倍数にならない)。
//   THE TEN の stages.json は Pair のルール用なので、ここで Stage 番号を種にして作り直し、全消しできる手順があるものだけを使う。
//   本来は Haskell の生成器(generator/)の仕事。モードを採用したらそちらへ移し、ここは消す。
import { validGroups, removeCells, collapseRows, isCleared } from './rules.js';

// 数字の出やすさ: 8 と 9 は相手が 2 と 1 しか無いので少なめ、1〜3 は多め
const WEIGHTS = { 1: 3, 2: 3, 3: 3, 4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1 };

/** 線形合同法の乱数(0 以上 1 未満)。同じ種なら同じ列。 */
export function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function pickDigit(rnd) {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (const [d, w] of Object.entries(WEIGHTS)) { r -= w; if (r < 0) return Number(d); }
  return 9;
}

/** 足し算だけの LINE ルールで、budget 状態以内に全消しできるか。true / false / null(予算切れ)。 */
export function solveLine(board, budget = 4000, maxGroup = 4) {
  const seen = new Set();
  let left = budget;
  const go = (b) => {
    if (isCleared(b)) return true;
    if (left <= 0) return null;
    const key = b.join(',');
    if (seen.has(key)) return false;
    seen.add(key); left -= 1;
    const groups = validGroups(b, maxGroup);
    if (!groups.length) return false;
    const ordered = groups.map((g) => ({ g, next: collapseRows(removeCells(g, b)) })).sort((x, y) => x.next.length - y.next.length);
    let unknown = false;
    for (const m of ordered) {
      const r = go(m.next);
      if (r === true) return true;
      if (r === null) unknown = true;
    }
    return unknown ? null : false;
  };
  return go(board);
}

/**
 * cells 個の数字の Board を作る。合計を 10 の倍数にそろえ、全消しの手順が見つかるものを返す。
 * 見つからなければ最後の候補(合計は 10 の倍数)を返し、solvable: false を付ける。
 */
export function makeLineBoard(cells, seed, { tries = 40, budget = 4000, maxGroup = 4 } = {}) {
  const rnd = lcg(seed);
  let last = null;
  for (let t = 0; t < tries; t++) {
    const b = [];
    for (let k = 0; k < cells; k++) b.push(pickDigit(rnd));
    // 合計を 10 の倍数に: 末尾の数字を 1〜9 の範囲で調整し、無理なら 2 つを直す
    let rem = b.reduce((a, c) => a + c, 0) % 10;
    for (let k = b.length - 1; k >= 0 && rem !== 0; k--) {
      const want = b[k] - rem;                        // この桁を want にすると合計が 10 の倍数
      if (want >= 1 && want <= 9) { b[k] = want; rem = 0; break; }
      const want2 = b[k] + (10 - rem);
      if (want2 >= 1 && want2 <= 9) { b[k] = want2; rem = 0; break; }
    }
    if (rem !== 0) continue;
    last = b;
    if (solveLine(b, budget, maxGroup) === true) return { cells: b, solvable: true, tries: t + 1 };
  }
  return { cells: last ?? new Array(cells).fill(5), solvable: false, tries };
}
