// 感想戦。1 Stage の手の記録(game.js の history)を読み、各手を評価する。
//
// 評価の考え方:
//   * 悪手(✖): その手で「Add なしでは全消しできない Board」になった。別の手なら全消しできたのに。
//              ペアが残っているのに Add を押して Chain を途切れさせた手も悪手。
//   * 逃した(△): もっと高い得点の手があった(行消し・DIGIT CLEAR・難しい道)。差が大きいときだけ。
//   * 最善(★): その時点で取れる手の中で、全消しを保ったまま得点が最大の手だった。
//   * 良手(○): それ以外。
//
// 得点の見積もりは game.js と同じ式(基礎点 × 難しさ倍率 × Chain 倍率。Speed は人の速さなので除く)。
// 全消しできるかは solver.js の深さ優先探索(予算つき)で調べる。見つからなければ「できない」と扱うので、
// 大きな Board では厳しめの判定になることがある。

import { validPairs, removePair, collapseRows, rows, numbers } from './rules.js';
import { pathInfo, difficultyMult } from './scoring.js';
import { solve } from './solver.js';

/** 1 手の得点の見積もり(Speed と FEVER を除く)。row と digit も含める。 */
export function estimatePoints(cfg, board, i, j, chainAfter) {
  const mult = Math.min(cfg.chain.max, 1 + cfg.chain.step * chainAfter);
  const diff = difficultyMult(cfg.difficulty, pathInfo(board, i, j));
  const before = removePair(i, j, board);
  const clearedRows = rows(before).filter((r) => r.every((c) => c === 0)).length;
  const after = collapseRows(before);
  const left = new Set(numbers(after));
  const digits = [...new Set([board[i], board[j]])].filter((d) => !left.has(d)).length;
  const pair = Math.round(cfg.score.pairBase * diff.mult * mult);
  const row = Math.round(cfg.score.rowClear * clearedRows * clearedRows * mult);
  const digit = Math.round(cfg.score.digitClear * digits * mult);
  return { total: pair + row + digit, pair, row, digit, clearedRows, digits, after, labels: diff.labels };
}

/**
 * ある局面で取れる手を全部評価し、全消しを保つ手の中で得点最大のものを返す。
 * 返り値: { best, options } 。best は null のこともある(どの手でも全消しできない)。
 */
export function bestMove(cfg, board, chainBefore, budget = 1200) {
  const options = validPairs(board).map(([i, j]) => {
    const est = estimatePoints(cfg, board, i, j, chainBefore + 1);
    const solvable = est.after.every((c) => c === 0) || solve(est.after, budget) !== null;
    return { i, j, points: est.total, est, solvable };
  });
  const alive = options.filter((o) => o.solvable);
  const pool = alive.length ? alive : options;
  const best = pool.reduce((b, o) => (b === null || o.points > b.points ? o : b), null);
  return { best, options, anySolvable: alive.length > 0 };
}

/** 1 Stage の記録を評価する。history は game.js が積んだ配列。 */
export function analyzeStage(cfg, history, { budget = 1200 } = {}) {
  const moves = [];
  let missed = 0, blunders = 0, bestCount = 0, maxChain = 0;
  for (const [k, h] of history.entries()) {
    if (h.type === 'remove') {
      maxChain = Math.max(maxChain, h.chain);
      const { best, options, anySolvable } = bestMove(cfg, h.board, h.chainBefore, budget);
      const mine = options.find((o) => o.i === h.i && o.j === h.j) ?? null;
      let verdict = 'good', text = '';
      if (mine && !mine.solvable && anySolvable) {
        verdict = 'blunder'; blunders += 1;
        text = `この手で Add なしの全消しができなくなった。${best ? `${best.i + 1}番目と ${best.j + 1}番目(${h.board[best.i]} と ${h.board[best.j]})なら続けられた` : ''}`;
      } else if (best && mine && best.points >= mine.points + 100 && best.points >= mine.points * 1.5) {
        verdict = 'missed'; missed += best.points - mine.points;
        const why = best.est.clearedRows ? '行が消えた' : best.est.digits ? 'DIGIT CLEAR になった' : best.est.labels[0] ?? '難しい道';
        text = `${h.board[best.i]} と ${h.board[best.j]} なら +${best.points}(${why})。選んだ手は +${mine.points}`;
      } else if (best && mine && mine.i === best.i && mine.j === best.j) {
        verdict = 'best'; bestCount += 1;
        text = h.clearedRows?.length ? '行消しを含む最善手' : '得点が最大の手';
      } else {
        text = mine ? `+${mine.points}。全消しを保っている` : '';
      }
      moves.push({ index: k, type: 'remove', verdict, text, board: h.board, i: h.i, j: h.j, points: h.points, chain: h.chain, mult: h.mult,
        best: best && !(mine && mine.i === best.i && mine.j === best.j) ? { i: best.i, j: best.j, points: best.points } : null });
    } else if (h.type === 'add') {
      const verdict = h.stuckBefore ? 'good' : 'blunder';
      if (!h.stuckBefore) blunders += 1;
      moves.push({ index: k, type: 'add', verdict, board: h.board, points: 0, chain: h.chainAfter, mult: 0,
        text: h.stuckBefore ? 'Dead End からの Add。Chain は半分残った' : `消せる Pair が ${validPairs(h.board).length} 組あったのに Add。Chain ×${h.multBefore.toFixed(1)} が途切れた` });
    } else if (h.type === 'hint') {
      moves.push({ index: k, type: 'hint', verdict: h.stuck ? 'blunder' : 'note', board: h.board, points: 0, chain: h.chain, mult: 0,
        text: h.stuck ? `${h.tier.toUpperCase()} を押したが Pair は無かった(Chain 半分、−${cfg.score.hintWhenStuck})` : `${h.tier.toUpperCase()} を使った` });
      if (h.stuck) blunders += 1;
    }
  }
  const removes = moves.filter((m) => m.type === 'remove').length;
  return {
    moves,
    summary: {
      removes, bestCount, blunders, missed,
      maxChain, maxMult: Math.min(cfg.chain.max, 1 + cfg.chain.step * maxChain),
      rowsCleared: history.filter((h) => h.type === 'remove').reduce((a, h) => a + (h.clearedRows?.length ?? 0), 0),
      digitClears: history.filter((h) => h.type === 'remove').reduce((a, h) => a + (h.digitsCleared?.length ?? 0), 0),
    },
  };
}
