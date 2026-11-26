// DAILY CHALLENGE: その日の日付(朝 resetHour 時切り替え)から、全員に同じ 1 面を生成する。
// 通信不要で家族どうし同じ盤面のスコアを比べられる。生成した盤面はパリティ条件と全消し手順(solve)を確認済み。

import { parityOk, validPairs } from './rules.js';
import { solve } from './solver.js';

/** 日付鍵 YYYY-MM-DD を 32bit シードに変換(FNV-1a 風)。 */
export function seedFromDateKey(dateKey) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

function nextSeed(s) {
  return (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
}

function randomBoard(seed, n) {
  const cells = [];
  let s = seed & 0x7fffffff;
  for (let i = 0; i < n; i++) {
    s = nextSeed(s);
    cells.push(((s >>> 16) % 9) + 1);
  }
  return cells;
}

/**
 * 日付鍵 dateKey('YYYY-MM-DD') に対応する日替わりステージ定義を生成する。
 * マス数は日付に応じて 36〜46 の偶数。必ず追加なしで全消しできる盤面だけを採る。
 */
export function makeDailyStage(dateKey, { budget = 2500 } = {}) {
  const baseSeed = seedFromDateKey('THE-TEN-DAILY-' + dateKey);
  const cellsCount = 36 + 2 * (baseSeed % 6);   // 36, 38, 40, 42, 44, 46
  const stageNum = (baseSeed % 30) + 1;
  let s = baseSeed & 0x7fffffff;
  for (let tries = 0; tries < 2000; tries++) {
    const b = randomBoard(s, cellsCount);
    if (parityOk(b) && validPairs(b).length >= 10 && solve(b, budget)) {
      return {
        dateKey,
        stage: stageNum,
        cellsCount,
        adds: 2,
        extra: false,
        par: 0,
        daily: true,
        boards: [{ seed: s, cells: b }],
      };
    }
    s = nextSeed(s);
  }
  // 万が一のフォールバック(必ず全消しできる対称盤面)
  const fallback = [];
  for (let i = 0; i < cellsCount / 2; i++) { const d = (i % 9) + 1; fallback.push(d, 10 - d); }
  return { dateKey, stage: stageNum, cellsCount, adds: 2, extra: false, par: 0, daily: true, boards: [{ seed: baseSeed, cells: fallback }] };
}

/** 家族や友だちに共有するための結果テキスト。 */
export function formatDailyShare({ dateKey, score, rank, stars, moves, maxMult, perfect }) {
  const starStr = '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars));
  return [
    `THE TEN DAILY ${dateKey}`,
    `Score: ${score.toLocaleString('en-US')}  Rank ${rank} ${starStr}${perfect ? ' PERFECT' : ''}`,
    `Moves: ${moves}  Max Chain: ×${maxMult.toFixed(1)}`,
  ].join('\n');
}
