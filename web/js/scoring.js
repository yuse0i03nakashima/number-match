// 得点のための補助(JavaScript だけにある。ルールの正否には関わらない)。
//   pathInfo         … Pair がどの道でつながっているか(種類と、間の空マスの数)
//   difficultyMult   … その道に応じた倍率とラベル
//   speedTier        … 前の消去からの時間に応じた倍率とラベル
//   sightLines       … 選んだマスから見える先(描画の補助。斜めの道を見やすくする)

import { WIDTH, rowOf, colOf, cellAt, validPairs, rows } from './rules.js';

// 道の候補。step は添字の進み方(rules.js の connected と同じ)。
const PATHS = [
  { step: 1, kind: 'line' },
  { step: WIDTH, kind: 'vertical' },
  { step: WIDTH + 1, kind: 'diagonal' },
  { step: WIDTH - 1, kind: 'diagonal' },
];

/**
 * i と j (i < j) をつなぐ道。複数あるときは間の空マスが少ない道を選ぶ。
 * 返り値: { kind: 'adjacent' | 'line' | 'wrap' | 'vertical' | 'diagonal', gap }
 *   adjacent … 読み順で隣(同じ行)。gap は 0
 *   line     … 同じ行で、間が空マス
 *   wrap     … 行の右端から次の行の左端へ続く(行をまたぐ読み順)
 * つながっていなければ null。
 */
export function pathInfo(board, i, j) {
  const dr = rowOf(j) - rowOf(i);
  const dc = colOf(j) - colOf(i);
  let best = null;
  for (const { step, kind } of PATHS) {
    if ((j - i) % step !== 0) continue;
    if (kind === 'vertical' && dc !== 0) continue;
    if (step === WIDTH + 1 && dc !== dr) continue;
    if (step === WIDTH - 1 && dc !== -dr) continue;
    let gap = 0, ok = true;
    for (let p = i + step; p < j; p += step) {
      if (cellAt(board, p) !== 0) { ok = false; break; }
      gap += 1;
    }
    if (!ok) continue;
    let k = kind;
    if (step === 1) k = dr !== 0 ? 'wrap' : gap === 0 ? 'adjacent' : 'line';
    if (best === null || gap < best.gap) best = { kind: k, gap };
  }
  return best;
}

/**
 * 道の種類と間の空マスから、Pair の得点に掛ける倍率とラベル(演出用)を決める。
 *   横の隣どうし ×1.0、縦 ×1.2、またぎ ×1.5、斜め ×1.5。
 *   間の空マス 1 つごとに +0.25(斜めは +0.5)。
 */
export function difficultyMult(diffCfg, info) {
  if (!info) return { mult: 1, labels: [] };
  let mult = 1;
  const labels = [];
  if (info.kind === 'vertical') { mult = diffCfg.vertical; labels.push('VERTICAL'); }
  if (info.kind === 'wrap') { mult = diffCfg.wrap; labels.push('WRAP'); }
  if (info.kind === 'diagonal') { mult = diffCfg.diagonal; labels.push(info.gap > 0 ? 'DIAGONAL SNIPE' : 'DIAGONAL'); }
  if (info.gap > 0) {
    mult += info.gap * (info.kind === 'diagonal' ? diffCfg.diagonalGapPerCell : diffCfg.gapPerCell);
    if (info.kind !== 'diagonal') labels.unshift(info.gap >= 3 ? 'LONG SHOT' : 'OPENED');   // 他を消して初めて通った道
  }
  return { mult: Math.round(mult * 100) / 100, labels };
}

/** 前の消去からの経過ミリ秒 → { tier: 'fast' | 'quick' | null, mult }。 */
export function speedTier(speedCfg, elapsedMs) {
  if (elapsedMs < speedCfg.fastMs) return { tier: 'fast', mult: speedCfg.fastMult };
  if (elapsedMs < speedCfg.quickMs) return { tier: 'quick', mult: speedCfg.quickMult };
  return { tier: null, mult: 1 };
}

/**
 * 選んだマス pos から、縦・斜めの 6 方向と読み順(前後)に目を走らせ、
 * 途中の空マス(ray)と最初にぶつかる数字(reach)を返す。
 * 相手が合うかどうかは見ない(ルール上つながる候補を全部示すだけで、答えは教えない)。
 */
export function sightLines(board, pos) {
  const ray = [], reach = [];
  const nrows = Math.ceil(board.length / WIDTH);
  const r0 = rowOf(pos), c0 = colOf(pos);
  for (const [dr, dc] of [[1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < nrows && c >= 0 && c < WIDTH) {
      const p = r * WIDTH + c;
      if (p >= board.length) break;
      if (board[p] === 0) ray.push(p); else { reach.push(p); break; }
      r += dr; c += dc;
    }
  }
  // 読み順(横。行末から次の行の先頭へ続く)
  for (const step of [1, -1]) {
    for (let p = pos + step; p >= 0 && p < board.length; p += step) {
      if (board[p] === 0) ray.push(p); else { reach.push(p); break; }
    }
  }
  return { ray, reach };
}

/**
 * 盤面の計画を助ける予告情報(ルール正否には関わらない)。
 *   digitCounts   … 1〜9 ごとの残数
 *   finishingDigits … 残り 1〜2 個で、今ある Pair 1 手で DIGIT CLEAR できる数字の Set
 *   almostRows    … あと 1 手で丸ごと消せる行インデックスの Set
 */
export function boardInsights(board) {
  const digitCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  for (const c of board) if (c >= 1 && c <= 9) digitCounts[c] += 1;
  const pairs = validPairs(board);
  const finishingDigits = new Set();
  for (const [i, j] of pairs) {
    const a = board[i], b = board[j];
    if (a === b) {
      if (digitCounts[a] <= 2) finishingDigits.add(a);
    } else {
      if (digitCounts[a] === 1) finishingDigits.add(a);
      if (digitCounts[b] === 1) finishingDigits.add(b);
    }
  }
  const rowList = rows(board);
  const rowNonZero = rowList.map((r) => r.filter((c) => c !== 0).length);
  const almostRows = new Set();
  for (const [i, j] of pairs) {
    const ri = rowOf(i), rj = rowOf(j);
    if (ri === rj) {
      if (rowNonZero[ri] === 2) almostRows.add(ri);
    } else {
      if (rowNonZero[ri] === 1) almostRows.add(ri);
      if (rowNonZero[rj] === 1) almostRows.add(rj);
    }
  }
  return { digitCounts, finishingDigits, almostRows };
}
