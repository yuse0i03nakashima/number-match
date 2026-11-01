// ゲームの進行(ルールの上に乗る層)。
//   rules.js   … Board の純粋な操作(Haskell と同じ)
//   scoring.js … 道の種類・速さによる Bonus(JavaScript だけ)
//   game.js    … Run・Stage・Chain・FEVER・Heart・Score・保存   ← このファイル
//   main.js    … 画面・演出・音とのつなぎ
//
// 設計: 各操作(tap / useAdd / useHint / tick …)は状態を更新し、「起きたこと」をイベントの配列で返す。
// 演出や音はイベントを見て動くので、ゲームの判断と見せ方が分かれる。
//
// 詰み(消せる Pair がない)の扱い: ゲームは自分からは教えない。
//   Add を押す     … 詰みなら「仕方ない」ので Chain を半分残す。Pair が残っていたのに押すと途切れる。
//   Hint を押す    … 詰みなら「まだあると思い込んでいた」ので、途切れたうえに減点。
//   Add が尽きたら … ADD ボタンは GIVE UP になる。押せば Heart −1 で Stage 得点の半分は残る。
//                    それに気づかず Hint を押すと Heart −1、Stage 得点を全部失い、さらに減点。
//
// 時間: tap と tick は現在時刻(ミリ秒)を受け取る。Chain は時間で減り(ゲージ)、FEVER は時間で終わる。

import { validPairs, removePair, collapseRows, isCleared, matches, connected, rows } from './rules.js';
import { pathInfo, difficultyBonus, speedTier } from './scoring.js';
import { chooseAddition } from './solver.js';

const RANKS = ['C', 'B', 'A', 'S'];
const rankIndex = (r) => RANKS.indexOf(r);

export class Game {
  constructor(stages, config, storage = globalThis.localStorage) {
    this.stages = stages;
    this.cfg = config;
    this.storage = storage;
    this.progress = { maxStage: 0, stars: {}, ranks: {}, attempts: {}, bestScore: 0, runs: 0 };
    this.run = null;   // 進行中の Run(無ければ null)
    this.load();
  }

  // ---------- 保存 ----------
  load() {
    try {
      const raw = this.storage?.getItem(this.cfg.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.progress) this.progress = { ...this.progress, ...data.progress };
      if (data.run) this.run = data.run;
    } catch { /* 壊れていたら初期状態で始める */ }
  }
  save() {
    try {
      this.storage?.setItem(this.cfg.storageKey, JSON.stringify({ progress: this.progress, run: this.run }));
    } catch { /* 保存できない環境では無視 */ }
  }

  // ---------- 参照 ----------
  get stage() { return this.run?.stage ?? null; }
  get stageDef() { return this.run ? this.stages[this.run.stageIndex] : null; }
  multiplierFor(chain) {
    const c = this.cfg.chain;
    return Math.min(c.max, 1 + c.step * chain);
  }
  get multiplier() { return this.multiplierFor(this.stage?.chain ?? 0); }
  get heat() {  // 0〜1。演出の熱さ
    const c = this.cfg.chain;
    return (this.multiplier - 1) / (c.max - 1);
  }
  get isStuck() { return !!this.stage && validPairs(this.stage.board).length === 0; }
  get inFever() { return !!this.stage?.fever; }
  /** FEVER の残り(0〜1)。FEVER 中でなければ 0。 */
  feverRatio(now) {
    const f = this.stage?.fever;
    if (!f) return 0;
    return Math.max(0, Math.min(1, (f.until - now) / this.cfg.fever.durationMs));
  }
  /** Chain ゲージ(0〜1)。1 で満タン、0 で次の減少。Chain が無いときは 0、FEVER 中は 1。 */
  gaugeRatio(now) {
    const st = this.stage, c = this.cfg.chain;
    if (!st || st.chain <= 0 || st.lastRemoveAt === null) return 0;
    if (st.fever) return 1;
    const t = now - st.lastRemoveAt;
    if (t < c.decayGraceMs) return 1 - t / c.decayGraceMs;
    return 1 - ((t - c.decayGraceMs) % c.decayStepMs) / c.decayStepMs;
  }
  worldOf(stageIndex) { return Math.floor(stageIndex / this.cfg.worldSize); }
  worldStart(stageIndex) { return this.worldOf(stageIndex) * this.cfg.worldSize; }
  get unlockedWorlds() { return this.worldOf(Math.min(this.progress.maxStage, this.stages.length - 1)) + 1; }
  get totalStars() { return Object.values(this.progress.stars).reduce((a, b) => a + b, 0); }
  /** Rank ごとの個数 { S: n, A: n, B: n, C: n }。 */
  get rankCounts() {
    const out = { S: 0, A: 0, B: 0, C: 0 };
    for (const r of Object.values(this.progress.ranks)) if (r in out) out[r] += 1;
    return out;
  }

  // ---------- Run と Stage ----------
  newRun(stageIndex = 0) {
    this.run = { stageIndex, score: 0, lives: this.cfg.lives.start, stage: null };
    this.progress.runs += 1;
    return this.startStage();
  }

  startStage() {
    const def = this.stageDef;
    const attempt = this.progress.attempts[def.stage] ?? 0;
    const variant = def.boards[attempt % def.boards.length];
    this.run.stage = {
      board: variant.cells.slice(),
      addsLeft: def.adds,
      addsUsed: 0,
      chain: 0,
      stageScore: 0,
      selected: null,
      hintPair: null,
      lastRemoveAt: null,    // 前の消去の時刻(速さ Bonus と Chain ゲージ用)
      decayed: 0,            // 前の消去から Chain が減った回数
      fever: null,           // FEVER 中なら { until }
      status: 'play',        // play | clear | failed | runOver | complete
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex: this.run.stageIndex }];
  }

  /** 中断から戻ったとき。離れていた時間で Chain が減ったり速さ Bonus が付いたりしないようにする。 */
  resume(now) {
    const st = this.stage;
    if (!st || st.status !== 'play') return;
    if (st.fever) st.fever.until = now + this.cfg.fever.durationMs * 0.5;
    st.lastRemoveAt = st.chain > 0 ? now : null;
    st.decayed = 0;
    this.save();
  }

  // ---------- 時間 ----------
  /** 定期的に呼ぶ。Chain の減少と FEVER の終わりを進める。 */
  tick(now) {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    const events = [];
    if (st.fever && now >= st.fever.until) {
      st.fever = null;
      st.chain = Math.floor(st.chain * cfg.fever.endChainRatio);
      st.lastRemoveAt = st.chain > 0 ? now : null;
      st.decayed = 0;
      events.push({ type: 'feverEnd', chain: st.chain, mult: this.multiplier });
    }
    if (!st.fever && st.chain > 0 && st.lastRemoveAt !== null) {
      const t = now - st.lastRemoveAt - cfg.chain.decayGraceMs;
      if (t > 0) {
        const steps = Math.floor(t / cfg.chain.decayStepMs) + 1 - st.decayed;
        if (steps > 0) {
          const before = st.chain;
          st.chain = Math.max(0, st.chain - steps);
          st.decayed += steps;
          events.push({ type: 'chainDecay', from: before, chain: st.chain, mult: this.multiplier, heat: this.heat });
          if (st.chain === 0) st.lastRemoveAt = null;
        }
      }
    }
    if (events.length) this.save();
    return events;
  }

  // ---------- 操作 ----------
  tap(pos, now = Date.now()) {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    const b = st.board;
    if (b[pos] === 0) {
      if (st.selected === null) return [];
      const prev = st.selected; st.selected = null;
      return [{ type: 'deselect', pos: prev }];
    }
    if (st.selected === null) {
      st.selected = pos;
      return [{ type: 'select', pos }];
    }
    if (st.selected === pos) {
      st.selected = null;
      return [{ type: 'deselect', pos }];
    }
    const i = Math.min(st.selected, pos), j = Math.max(st.selected, pos);
    if (matches(b[i], b[j]) && connected(b, i, j)) return this.remove(i, j, now);
    // Pair にならない: 選択を移す(本家と同じ)
    const prev = st.selected; st.selected = pos;
    return [{ type: 'invalid', from: prev, to: pos }, { type: 'select', pos }];
  }

  remove(i, j, now) {
    const st = this.stage, b = st.board, cfg = this.cfg;
    const before = removePair(i, j, b);
    const clearedRows = rows(before).map((r, k) => (r.every((c) => c === 0) ? k : -1)).filter((k) => k >= 0);
    const after = collapseRows(before);

    // 難しい道・速さの Bonus
    const info = pathInfo(b, i, j);
    const diff = difficultyBonus(cfg.score, info);
    const elapsed = st.lastRemoveAt === null ? Infinity : now - st.lastRemoveAt;
    const speed = speedTier(cfg.speed, elapsed);
    st.lastRemoveAt = now;
    st.decayed = 0;

    st.chain += 1;
    const mult = this.multiplier;
    const feverMult = st.fever ? cfg.fever.pointMult : 1;
    const pairPoints = Math.round((cfg.score.pairBase + diff.bonus) * mult * speed.mult * feverMult);
    const rowPoints = Math.round(cfg.score.rowClear * clearedRows.length * clearedRows.length * mult * feverMult);
    const points = pairPoints + rowPoints;
    st.stageScore += points;
    this.run.score += points;
    st.selected = null;
    st.hintPair = null;
    st.board = after;

    const events = [{
      type: 'remove', i, j, a: b[i], b: b[j], points, pairPoints, rowPoints,
      chain: st.chain, mult, heat: this.heat, clearedRows, boardBefore: before, board: after,
      path: info, bonus: diff.bonus, labels: diff.labels, speed: speed.tier, speedMult: speed.mult, elapsed,
      fever: !!st.fever,
    }];
    // 倍率が上限に達したら FEVER 開始
    if (!st.fever && mult >= cfg.chain.max) {
      st.fever = { until: now + cfg.fever.durationMs };
      events.push({ type: 'feverStart', until: st.fever.until, durationMs: cfg.fever.durationMs });
    }
    events.push(...this.afterBoardChange());
    this.save();
    return events;
  }

  // Board が変わった後の判定: Clear だけを見る。詰みはプレイヤーが Add / Hint を押したときに分かる。
  afterBoardChange() {
    if (isCleared(this.stage.board)) return this.stageClear();
    return [];
  }

  useAdd(now = Date.now()) {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    if (st.addsLeft <= 0) return this.giveUp();          // ボタンは GIVE UP になっている
    const stuck = this.isStuck;
    const oldLength = st.board.length;
    const chainBefore = st.chain;
    // 足す数字は残っている数字そのもの(本家と同じ)。並びは「Add なしで全消しできる」と確かめられたものを選ぶ
    const added = chooseAddition(st.board);
    st.board = added.board;
    st.addsLeft -= 1;
    st.addsUsed += 1;
    // 詰んでからの Add は仕方ないので控えめ(Chain を一部残す)。Pair が残っていたのに押すと途切れる
    st.chain = stuck ? Math.floor(st.chain * cfg.stuck.addKeepRatio) : 0;
    st.selected = null;
    st.hintPair = null;
    st.lastRemoveAt = st.chain > 0 ? now : null;
    st.decayed = 0;
    const events = [{
      type: 'add', oldLength, newLength: st.board.length, addsLeft: st.addsLeft, board: st.board,
      arrangement: added.arrangement, solvable: added.checked && added.arrangement !== 'fallback',
      stuckBefore: stuck, chainBefore, chainAfter: st.chain,
      multBefore: this.multiplierFor(chainBefore), multAfter: this.multiplier,
    }];
    this.save();
    return events;
  }

  useHint() {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    const pairs = validPairs(st.board);
    const brokeChain = st.chain > 0;
    st.chain = 0;
    st.selected = null;
    st.lastRemoveAt = null;
    st.decayed = 0;
    if (pairs.length === 0) {
      if (st.addsLeft <= 0) {
        // 気づかずに Hint: Stage 得点を全部失い、さらに減点して失敗
        const extra = Math.min(this.run.score - st.stageScore, cfg.score.blindHintPenalty);
        this.run.score -= Math.max(0, extra);
        const events = [{ type: 'noHint', penalty: st.stageScore + Math.max(0, extra), brokeChain, addsLeft: 0, blind: true }];
        events.push(...this.stageFailed('blindHint', 0));
        this.save();
        return events;
      }
      // まだあると思っていた: 途切れたうえに減点
      const penalty = Math.min(st.stageScore, cfg.score.hintWhenStuck);
      st.stageScore -= penalty;
      this.run.score -= penalty;
      this.save();
      return [{ type: 'noHint', penalty, brokeChain, addsLeft: st.addsLeft, blind: false }];
    }
    st.hintPair = pairs[Math.floor(Math.random() * pairs.length)];
    this.save();
    return [{ type: 'hint', pair: st.hintPair, brokeChain }];
  }

  // GIVE UP = 分かったうえでの失敗。Stage 得点の半分は残る
  giveUp() {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    const events = this.stageFailed('giveUp', this.cfg.score.giveUpKeepRatio);
    this.save();
    return events;
  }

  // ---------- 結果 ----------
  rankFor(stageScore) {
    const r = this.cfg.rank, def = this.stageDef;
    const ratio = stageScore / (def.cellsCount * r.perCell);
    return ratio >= r.S ? 'S' : ratio >= r.A ? 'A' : ratio >= r.B ? 'B' : 'C';
  }

  stageClear() {
    const st = this.stage, def = this.stageDef, cfg = this.cfg;
    const perfect = st.addsUsed === 0;
    const stars = perfect ? 3 : st.addsUsed === 1 ? 2 : 1;
    const clearBonus = cfg.score.stageClear;
    const perfectBonus = perfect ? cfg.score.perfect : 0;
    const savedBonus = st.addsLeft * cfg.score.addSaved;
    const lifeGain = perfect && this.run.lives < cfg.lives.max ? cfg.lives.perfectRecover : 0;
    this.run.lives = Math.min(cfg.lives.max, this.run.lives + lifeGain);
    const bonusTotal = clearBonus + perfectBonus + savedBonus;
    this.run.score += bonusTotal;
    st.stageScore += bonusTotal;
    st.fever = null;
    st.status = 'clear';
    const rank = this.rankFor(st.stageScore);

    this.progress.stars[def.stage] = Math.max(this.progress.stars[def.stage] ?? 0, stars);
    const prevRank = this.progress.ranks[def.stage];
    if (!prevRank || rankIndex(rank) > rankIndex(prevRank)) this.progress.ranks[def.stage] = rank;
    this.progress.maxStage = Math.max(this.progress.maxStage, this.run.stageIndex + 1);
    this.progress.bestScore = Math.max(this.progress.bestScore, this.run.score);
    this.save();
    return [{
      type: 'stageClear', stage: def.stage, stars, rank, perfect, clearBonus, perfectBonus, savedBonus, lifeGain,
      stageScore: st.stageScore, playScore: st.stageScore - bonusTotal, score: this.run.score,
      addsUsed: st.addsUsed, addsLeft: st.addsLeft,
      isLast: this.run.stageIndex + 1 >= this.stages.length,
    }];
  }

  nextStage() {
    if (!this.run || this.stage.status !== 'clear') return [];
    if (this.run.stageIndex + 1 >= this.stages.length) {
      this.stage.status = 'complete';
      this.save();
      return [{ type: 'complete', score: this.run.score, best: this.progress.bestScore }];
    }
    this.run.stageIndex += 1;
    return this.startStage();
  }

  /** 失敗。keepRatio は Stage 得点のうち残す割合(GIVE UP なら半分、気づかずの Hint なら 0)。 */
  stageFailed(reason, keepRatio = 0) {
    const st = this.stage, def = this.stageDef;
    this.run.lives -= 1;
    const kept = Math.floor(st.stageScore * keepRatio);
    const lost = st.stageScore - kept;
    this.run.score -= lost;
    this.progress.attempts[def.stage] = (this.progress.attempts[def.stage] ?? 0) + 1;
    st.stageScore = 0;
    st.fever = null;
    if (this.run.lives <= 0) {
      st.status = 'runOver';
      this.progress.bestScore = Math.max(this.progress.bestScore, this.run.score);
      this.save();
      return [{ type: 'runOver', reason, score: this.run.score, best: this.progress.bestScore, lost, kept,
                resumeStage: this.worldStart(this.run.stageIndex), stage: def.stage }];
    }
    st.status = 'failed';
    this.save();
    return [{ type: 'stageFailed', reason, lives: this.run.lives, lost, kept, stage: def.stage }];
  }

  retryStage() {
    if (!this.run || this.stage.status !== 'failed') return [];
    return this.startStage();
  }

  // Run 終了後: 今の World のはじめから新しい Run
  restartFromWorld() {
    const idx = this.run ? this.worldStart(this.run.stageIndex) : 0;
    return this.newRun(idx);
  }

  abandonRun() {
    this.run = null;
    this.save();
  }
}
