// 得点のための補助(JavaScript だけにある。ルールの正否には関わらない)。
//   pathInfo   … ペアがどの道でつながっているか(種類と、間の空マスの数)
//   difficultyBonus … その道に応じたボーナス点とラベル
//   speedTier  … 前の消去からの時間に応じた倍率とラベル

import { WIDTH, rowOf, colOf, cellAt } from './rules.js';

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

/** 道の種類と間の空マスから、基礎点に足すボーナスとラベル(演出用)を決める。 */
export function difficultyBonus(scoreCfg, info) {
  if (!info) return { bonus: 0, labels: [] };
  let bonus = 0;
  const labels = [];
  if (info.gap > 0) {
    bonus += info.gap * scoreCfg.gapPerCell;
    labels.push(info.gap >= 3 ? 'LONG SHOT' : 'OPENED');   // 他を消して初めて通った道
  }
  if (info.kind === 'wrap') { bonus += scoreCfg.wrap; labels.push('WRAP'); }
  if (info.kind === 'diagonal') {
    bonus += scoreCfg.diagonal;
    // 離れた斜めは見つけにくいので、空マスごとにさらに加点
    if (info.gap > 0) { bonus += info.gap * scoreCfg.diagonalGapPerCell; labels.push('DIAGONAL SNIPE'); }
    else labels.push('DIAGONAL');
  }
  if (info.kind === 'vertical') { bonus += scoreCfg.vertical; }
  return { bonus, labels };
}

/** 前の消去からの経過ミリ秒 → { tier: 'fast' | 'quick' | null, mult }。 */
export function speedTier(speedCfg, elapsedMs) {
  if (elapsedMs < speedCfg.fastMs) return { tier: 'fast', mult: speedCfg.fastMult };
  if (elapsedMs < speedCfg.quickMs) return { tier: 'quick', mult: speedCfg.quickMult };
  return { tier: null, mult: 1 };
}
