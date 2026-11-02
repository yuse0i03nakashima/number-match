// お題(Quest)。Stage ごとに 1 つ出し、達成すると Bonus。
//
// 種類:
//   digitFirst … 「X を最初に消し切れ」。最初に Board から消え切る数字が X であること。
//                達成できるかは、制約つきの探索(X より先に他の数字が消え切る手を禁じて全消しを探す)で確かめる。
//   chain      … 「Chain を途切れさせずに N 回消せ」。Add・ゲージの減り・SCOPE の失敗で数え直し。全消しできる面なので必ず達成できる。
//   diagonal   … 「斜めで N 回消せ」。盤面しだい。初期 Board に斜めの Pair が N 組以上あるときだけ出す。
//   noHint     … 「Hint を使わずに Clear」。必ず達成できる。
//
// どの種類を出すかは Stage 番号から決める(同じ Stage なら同じお題)。達成できないと分かった種類は次の候補へ。

import { validPairs, removePair, collapseRows, numbers } from './rules.js';
import { pathInfo } from './scoring.js';
import { solve } from './solver.js';

const ORDER = ['digitFirst', 'chain', 'diagonal', 'noHint'];

/** Stage 番号と Board からお題を 1 つ決める。 */
export function makeQuest(cfg, stage, board, { budget = 1500, exclude = [] } = {}) {
  const start = (stage * 7) % ORDER.length;
  for (let k = 0; k < ORDER.length; k++) {
    const type = ORDER[(start + k) % ORDER.length];
    if (exclude.includes(type)) continue;
    const q = tryQuest(cfg, type, stage, board, budget);
    if (q) return q;
  }
  return { type: 'noHint', target: 1, progress: 0, done: false, text: 'Hint を使わずに Clear' };
}

function tryQuest(cfg, type, stage, board, budget) {
  const q = cfg.quest;
  if (type === 'digitFirst') {
    // 候補: Board にある数字のうち、枚数が 2 枚以上のもの。Stage 番号で選ぶ
    const count = {};
    for (const n of numbers(board)) count[n] = (count[n] ?? 0) + 1;
    const digits = Object.keys(count).map(Number).filter((d) => count[d] >= 2).sort((a, b) => a - b);
    if (!digits.length) return null;
    const pick = digits[(stage * 3) % digits.length];
    // X より先に別の数字が消え切る手を禁じて、全消しできるか
    const allow = (b, i, j, after) => {
      const left = new Set(numbers(after));
      if (!left.has(pick)) return true;                    // X が消え切ったあとは自由
      return [b[i], b[j]].every((d) => d === pick || left.has(d));
    };
    if (!solve(board, budget, allow)) return null;
    return { type, digit: pick, target: 1, progress: 0, done: false, text: `${pick} を最初に消し切れ` };
  }
  if (type === 'chain') {
    const pairs = Math.floor(numbers(board).length / 2);
    const target = Math.min(q.chainTarget, pairs);
    return { type, target, progress: 0, done: false, text: `Chain を途切れさせずに ${target} 回消せ` };
  }
  if (type === 'diagonal') {
    const diag = validPairs(board).filter(([i, j]) => pathInfo(board, i, j)?.kind === 'diagonal').length;
    if (diag < q.diagonalTarget) return null;
    return { type, target: q.diagonalTarget, progress: 0, done: false, text: `斜めで ${q.diagonalTarget} 回消せ` };
  }
  if (type === 'noHint') return { type, target: 1, progress: 0, done: false, text: 'Hint を使わずに Clear' };
  return null;
}

/**
 * 1 手のあとにお題の進み具合を更新する。返り値: { changed, done, failed }。
 * ev は game.js の remove イベントに相当する情報。
 */
export function updateQuest(quest, ev) {
  if (!quest || quest.done || quest.failed) return { changed: false, done: false, failed: false };
  let changed = false;
  if (quest.type === 'digitFirst' && ev.type === 'remove' && ev.digitsCleared.length) {
    if (ev.digitsCleared.includes(quest.digit) && !ev.otherDigitClearedBefore) { quest.progress = 1; quest.done = true; changed = true; }
    else { quest.failed = true; changed = true; }
  }
  if (quest.type === 'chain' && ev.type === 'remove' && ev.chain > ev.chainBefore) {
    // Chain が伸びた手だけ数える(Hint・SCOPE で消した手は Chain が伸びないので数えない)
    quest.progress += 1; changed = true;
    if (quest.progress >= quest.target) quest.done = true;
  }
  if (quest.type === 'chain' && ev.type === 'break' && quest.progress > 0) { quest.progress = 0; changed = true; }
  if (quest.type === 'diagonal' && ev.type === 'remove' && ev.path?.kind === 'diagonal') {
    quest.progress += 1; changed = true;
    if (quest.progress >= quest.target) quest.done = true;
  }
  if (quest.type === 'noHint' && ev.type === 'hint') { quest.failed = true; changed = true; }
  if (quest.type === 'noHint' && ev.type === 'clear' && !quest.failed) { quest.progress = 1; quest.done = true; changed = true; }
  return { changed, done: quest.done, failed: !!quest.failed };
}
