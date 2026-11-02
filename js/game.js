// ゲームの進行(ルールの上に乗る層)。
//   rules.js   … Board の純粋な操作(Haskell と同じ)
//   scoring.js … 道の種類・速さによる倍率(JavaScript だけ)
//   solver.js  … 全消し手順の探索(Add の並びを選ぶ)
//   game.js    … Run・Stage・Chain・FEVER・Hint・Heart・Score・保存   ← このファイル
//   main.js    … 画面・演出・音とのつなぎ
//
// 設計: 各操作(tap / useAdd / useHint / tick …)は状態を更新し、「起きたこと」をイベントの配列で返す。
// 演出や音はイベントを見て動くので、ゲームの判断と見せ方が分かれる。
//
// Dead End(消せる Pair がない)の扱い: ゲームは自分からは教えない。
//   Add を押す     … Dead End なら「仕方ない」ので Chain を半分残す。Pair が残っていたのに押すと途切れる。
//   Hint を押す    … Dead End なら「まだあると思い込んでいた」ので、Chain 半分と減点。
//   Add が尽きたら … ADD ボタンは GIVE UP になる。押せば Heart −1 で Stage 得点の半分は残る。
//                    それに気づかず Hint を押すと Heart −1、Stage 得点を全部失い、さらに減点。
//
// Hint は Chain 倍率で性格が変わる(3 段階。cfg.hint):
//   HINT  (低倍率) … Pair を 1 組示す。示された Pair は得点半分、Chain は維持(増えない)。
//   FLASH (中倍率) … 消せる Pair を全部一瞬だけ光らせる。ゲージが半分に減る。
//   SCOPE (高倍率・FEVER) … 相手のいるタイルを 1 枚光らせる。相手は自分で探す。
//                    外すと 1 回目 Chain −3、2 回目で Chain 半分。光ったタイルを使わず別の Pair を消しても Chain 半分。
//
// 時間: tap と tick は現在時刻(ミリ秒)を受け取る。Chain は時間で減り(ゲージ)、FEVER と FLASH は時間で終わる。

import { validPairs, removePair, collapseRows, isCleared, matches, connected, rows, numbers } from './rules.js';
import { pathInfo, difficultyMult, speedTier } from './scoring.js';
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
  get relax() { return !!this.progress.relax; }          // Relax モード: ゲージが減らず、Speed Bonus も無い
  setRelax(on) { this.progress.relax = !!on; this.save(); }
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
  /** いまの Hint の段階: 'hint' | 'flash' | 'scope'。 */
  get hintTier() {
    const h = this.cfg.hint, m = this.multiplier;
    if (this.inFever || m >= h.scopeFrom) return 'scope';
    if (m >= h.flashFrom) return 'flash';
    return 'hint';
  }
  feverRatio(now) {
    const f = this.stage?.fever;
    if (!f) return 0;
    return Math.max(0, Math.min(1, (f.until - now) / this.cfg.fever.durationMs));
  }
  /** Chain ゲージ(0〜1)。1 で満タン、0 で次の減少。Chain が無いときは 0、FEVER 中は 1。 */
  gaugeRatio(now) {
    const st = this.stage, c = this.cfg.chain;
    if (!st || st.chain <= 0 || st.lastRemoveAt === null) return 0;
    if (st.fever || this.relax) return 1;
    const t = now - st.lastRemoveAt;
    if (t < c.decayGraceMs) return 1 - t / c.decayGraceMs;
    return 1 - ((t - c.decayGraceMs) % c.decayStepMs) / c.decayStepMs;
  }
  worldOf(stageIndex) { return Math.floor(stageIndex / this.cfg.worldSize); }
  worldStart(stageIndex) { return this.worldOf(stageIndex) * this.cfg.worldSize; }
  get unlockedWorlds() { return this.worldOf(Math.min(this.progress.maxStage, this.stages.length - 1)) + 1; }
  get totalStars() { return Object.values(this.progress.stars).reduce((a, b) => a + b, 0); }
  get rankCounts() {
    const out = { S: 0, A: 0, B: 0, C: 0 };
    for (const r of Object.values(this.progress.ranks)) if (r in out) out[r] += 1;
    return out;
  }

  // ---------- Run と Stage ----------
  newRun(stageIndex = 0) {
    this.run = { stageIndex, score: 0, lives: this.cfg.lives.start, stage: null, maxChain: 0, reviews: [] };
    this.progress.runs += 1;
    return this.startStage();
  }

  startStage(carry = null, now = Date.now()) {
    const def = this.stageDef;
    const attempt = this.progress.attempts[def.stage] ?? 0;
    const variant = def.boards[attempt % def.boards.length];
    // carry があれば前の Stage の Chain・FEVER を持ち越す(Board を全部消して続けるとき)
    const chain = carry ? carry.chain : 0;
    const fever = carry && carry.fever ? { until: carry.fever.until } : null;
    this.run.stage = {
      board: variant.cells.slice(),
      addsLeft: def.adds,
      addsUsed: 0,
      hintsLeft: this.cfg.hint.perStage,
      hintsUsed: 0,
      chain,
      stageScore: 0,
      selected: null,
      hintPair: null,        // HINT で示した Pair(消すまで残る)
      flashUntil: null,      // FLASH の終わる時刻
      scope: null,           // SCOPE: { tile, misses }
      lastRemoveAt: chain > 0 ? now : null,   // 前の消去の時刻(速さ Bonus と Chain ゲージ用)
      decayed: 0,            // 前の消去から Chain が減った回数
      fever,                 // FEVER 中なら { until }
      status: 'play',        // play | clear | failed | runOver | complete
      history: [],           // 感想戦用の手の記録(review.js が読む)
      maxChain: chain,       // この Stage の最高 Chain
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex: this.run.stageIndex, carried: !!carry }];
  }

  /** 中断から戻ったとき。離れていた時間で Chain が減ったり速さ Bonus が付いたりしないようにする。 */
  resume(now) {
    const st = this.stage;
    if (!st || st.status !== 'play') return;
    if (st.fever) st.fever.until = now + this.cfg.fever.durationMs * 0.5;
    st.lastRemoveAt = st.chain > 0 ? now : null;
    st.decayed = 0;
    st.flashUntil = null;
    this.save();
  }

  // ---------- 時間 ----------
  tick(now) {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    const events = [];
    if (st.flashUntil !== null && now >= st.flashUntil) {
      st.flashUntil = null;
      events.push({ type: 'flashEnd' });
    }
    if (st.fever && now >= st.fever.until) {
      st.fever = null;
      st.chain = Math.floor(st.chain * cfg.fever.endChainRatio);
      st.lastRemoveAt = st.chain > 0 ? now : null;
      st.decayed = 0;
      events.push({ type: 'feverEnd', chain: st.chain, mult: this.multiplier });
    }
    if (!st.fever && !this.relax && st.chain > 0 && st.lastRemoveAt !== null) {
      const t = now - st.lastRemoveAt - cfg.chain.decayGraceMs;
      if (t > 0) {
        const steps = Math.floor(t / cfg.chain.decayStepMs) + 1 - st.decayed;
        if (steps > 0) {
          const before = st.chain;
          st.chain = Math.max(0, st.chain - steps);
          st.decayed += steps;
          events.push({ type: 'chainDecay', from: before, chain: st.chain, mult: this.multiplier, heat: this.heat });
          if (st.chain === 0) {
            st.lastRemoveAt = null;
            if (st.scope) { st.scope = null; events.push({ type: 'scopeEnd', reason: 'decay' }); }
          }
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
    const events = [{ type: 'invalid', from: prev, to: pos }, { type: 'select', pos }];
    // SCOPE の光ったタイルを含む見当違いは Chain を削る
    if (st.scope && (st.scope.tile === i || st.scope.tile === j)) events.push(...this.scopeMiss());
    return events;
  }

  scopeMiss() {
    const st = this.stage, h = this.cfg.hint;
    st.scope.misses += 1;
    const before = st.chain;
    if (st.scope.misses === 1) {
      st.chain = Math.max(0, st.chain - h.scopeMissChain);
      this.save();
      return [{ type: 'scopeMiss', misses: 1, from: before, chain: st.chain, mult: this.multiplier }];
    }
    st.chain = Math.floor(st.chain * h.scopeBreakRatio);
    st.scope = null;
    this.save();
    return [{ type: 'scopeMiss', misses: 2, from: before, chain: st.chain, mult: this.multiplier }, { type: 'scopeEnd', reason: 'miss' }];
  }

  remove(i, j, now) {
    const st = this.stage, b = st.board, cfg = this.cfg;
    const before = removePair(i, j, b);
    const clearedRows = rows(before).map((r, k) => (r.every((c) => c === 0) ? k : -1)).filter((k) => k >= 0);
    const after = collapseRows(before);
    const events = [];

    // Hint の約束の確認(得点の前に Chain を調整する)
    const hinted = !!st.hintPair && st.hintPair[0] === i && st.hintPair[1] === j;     // HINT で示された Pair
    let scoped = false, scopeBroken = false;
    if (st.scope) {
      if (st.scope.tile === i || st.scope.tile === j) scoped = true;
      else { scopeBroken = true; st.chain = Math.floor(st.chain * cfg.hint.scopeBreakRatio); }
      st.scope = null;
    }
    st.hintPair = null;

    // 難しい道・速さの倍率
    const info = pathInfo(b, i, j);
    const diff = difficultyMult(cfg.difficulty, info);
    const elapsed = st.lastRemoveAt === null ? Infinity : now - st.lastRemoveAt;
    const speed = scoped || this.relax ? { tier: null, mult: 1 } : speedTier(cfg.speed, elapsed);   // SCOPE の補助を受けた Pair と Relax モードに Speed は付かない
    st.lastRemoveAt = now;
    st.decayed = 0;

    // Chain: 補助を受けた Pair(HINT / SCOPE)は増えない。それ以外は +1
    const assisted = hinted || scoped;
    const chainBefore = st.chain;
    if (!assisted) st.chain += 1;
    st.maxChain = Math.max(st.maxChain ?? 0, st.chain);
    this.run.maxChain = Math.max(this.run.maxChain ?? 0, st.chain);
    const mult = this.multiplier;
    const feverMult = st.fever ? cfg.fever.pointMult : 1;
    const hintedRatio = hinted ? cfg.score.hintedPairRatio : 1;
    const pairPoints = Math.round(cfg.score.pairBase * diff.mult * mult * speed.mult * feverMult * hintedRatio);
    const rowPoints = Math.round(cfg.score.rowClear * clearedRows.length * clearedRows.length * mult * feverMult);
    // DIGIT CLEAR: この 1 手で Board から消え切った数字(残りが 0 になった数字)
    const left = new Set(numbers(after));
    const digitsCleared = [...new Set([b[i], b[j]])].filter((d) => !left.has(d)).sort();
    const digitPoints = Math.round(cfg.score.digitClear * digitsCleared.length * mult * feverMult);
    const points = pairPoints + rowPoints + digitPoints;
    st.stageScore += points;
    this.run.score += points;
    st.selected = null;
    st.board = after;
    st.history.push({ type: 'remove', board: b, i, j, points, chain: st.chain, chainBefore, mult, clearedRows, digitsCleared, hinted, scoped });

    const labels = [...diff.labels];
    if (scoped) labels.push('SCOPE');
    if (hinted) labels.push('HINTED');
    events.push({
      type: 'remove', i, j, a: b[i], b: b[j], points, pairPoints, rowPoints, digitPoints, digitsCleared,
      chain: st.chain, mult, heat: this.heat, clearedRows, boardBefore: before, board: after,
      path: info, diffMult: diff.mult, labels, speed: speed.tier, speedMult: speed.mult, elapsed,
      fever: !!st.fever, hinted, scoped, scopeBroken,
    });
    if (scopeBroken) events.push({ type: 'scopeEnd', reason: 'ignored', chain: st.chain, mult: this.multiplier });
    // 倍率が上限に達したら FEVER 開始
    if (!st.fever && mult >= cfg.chain.max) {
      st.fever = { until: now + cfg.fever.durationMs };
      events.push({ type: 'feverStart', until: st.fever.until, durationMs: cfg.fever.durationMs });
    }
    events.push(...this.afterBoardChange());
    this.save();
    return events;
  }

  // Board が変わった後の判定: Clear だけを見る。Dead End はプレイヤーが Add / Hint を押したときに分かる。
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
    st.history.push({ type: 'add', board: st.board, stuckBefore: stuck, chainBefore, chainAfter: stuck ? Math.floor(st.chain * cfg.stuck.addKeepRatio) : 0, multBefore: this.multiplierFor(chainBefore) });
    st.board = added.board;
    st.addsLeft -= 1;
    st.addsUsed += 1;
    // Dead End からの Add は仕方ないので控えめ(Chain を一部残す)。Pair が残っていたのに押すと途切れる
    st.chain = stuck ? Math.floor(st.chain * cfg.stuck.addKeepRatio) : 0;
    st.selected = null;
    st.hintPair = null; st.scope = null; st.flashUntil = null;
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

  /** Hint の料金を払う。FEVER 中は時間、それ以外は使用回数。払えなければ false。 */
  payHint(now) {
    const st = this.stage, cfg = this.cfg;
    if (st.fever) { st.fever.until -= cfg.fever.hintTimeCostMs; st.hintsUsed += 1; return true; }
    if (st.hintsLeft <= 0) return false;
    st.hintsLeft -= 1; st.hintsUsed += 1;
    return true;
  }

  useHint(now = Date.now()) {
    const st = this.stage, cfg = this.cfg, h = cfg.hint;
    if (!st || st.status !== 'play') return [];
    const tier = this.hintTier;
    const pairs = validPairs(st.board);
    st.selected = null;

    if (pairs.length === 0) {
      // Dead End なのに押した
      if (st.addsLeft <= 0) {
        // Add も無い: Stage 得点を全部失い、さらに減点して失敗
        const extra = Math.max(0, Math.min(this.run.score - st.stageScore, cfg.score.blindHintPenalty));
        this.run.score -= extra;
        const events = [{ type: 'noHint', penalty: st.stageScore + extra, addsLeft: 0, blind: true, tier }];
        events.push(...this.stageFailed('blindHint', 0));
        this.save();
        return events;
      }
      if (!this.payHint(now)) return [{ type: 'noHints', tier }];
      const before = st.chain;
      st.history.push({ type: 'hint', board: st.board.slice(), tier, stuck: true, chain: before });
      st.chain = Math.floor(st.chain * h.stuckKeepRatio);
      st.scope = null; st.hintPair = null;
      const penalty = Math.min(st.stageScore, cfg.score.hintWhenStuck);
      st.stageScore -= penalty; this.run.score -= penalty;
      this.save();
      return [{ type: 'noHint', penalty, addsLeft: st.addsLeft, blind: false, tier, from: before, chain: st.chain, mult: this.multiplier, hintsLeft: st.hintsLeft }];
    }

    if (!this.payHint(now)) return [{ type: 'noHints', tier }];
    st.history.push({ type: 'hint', board: st.board.slice(), tier, stuck: false, chain: st.chain });
    if (tier === 'hint') {
      st.hintPair = pairs[Math.floor(Math.random() * pairs.length)];
      this.save();
      return [{ type: 'hint', tier, pair: st.hintPair, hintsLeft: st.hintsLeft }];
    }
    if (tier === 'flash') {
      st.flashUntil = now + h.flashMs;
      // ゲージを半分に: 猶予の半分が過ぎたことにする
      if (st.chain > 0) { st.lastRemoveAt = now - cfg.chain.decayGraceMs * (1 - h.flashGaugeRatio); st.decayed = 0; }
      this.save();
      return [{ type: 'flash', tier, pairs, until: st.flashUntil, hintsLeft: st.hintsLeft }];
    }
    // scope: 相手のいるタイルを 1 枚。相手が少ないタイルを選ぶ(探しがいがある)
    const count = new Map();
    for (const [a, c] of pairs) { count.set(a, (count.get(a) ?? 0) + 1); count.set(c, (count.get(c) ?? 0) + 1); }
    const tiles = [...count.entries()].sort((x, y) => x[1] - y[1]);
    const tile = tiles[Math.floor(Math.random() * Math.min(3, tiles.length))][0];
    st.scope = { tile, misses: 0 };
    this.save();
    return [{ type: 'scope', tier, tile, remaining: pairs.length, hintsLeft: st.hintsLeft, fever: !!st.fever }];
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
    const hintBonus = st.hintsLeft * cfg.score.hintSaved;
    const lifeGain = perfect && this.run.lives < cfg.lives.max ? cfg.lives.perfectRecover : 0;
    this.run.lives = Math.min(cfg.lives.max, this.run.lives + lifeGain);
    const bonusTotal = clearBonus + perfectBonus + savedBonus + hintBonus;
    this.run.score += bonusTotal;
    st.stageScore += bonusTotal;
    st.scope = null; st.flashUntil = null;     // FEVER と Chain は次の Stage へ持ち越す
    st.status = 'clear';
    const rank = this.rankFor(st.stageScore);

    this.pushReview(def.stage, true);
    this.progress.stars[def.stage] = Math.max(this.progress.stars[def.stage] ?? 0, stars);
    const prevRank = this.progress.ranks[def.stage];
    if (!prevRank || rankIndex(rank) > rankIndex(prevRank)) this.progress.ranks[def.stage] = rank;
    this.progress.maxStage = Math.max(this.progress.maxStage, this.run.stageIndex + 1);
    this.progress.bestScore = Math.max(this.progress.bestScore, this.run.score);
    this.save();
    return [{
      type: 'stageClear', stage: def.stage, stars, rank, perfect, clearBonus, perfectBonus, savedBonus, hintBonus, lifeGain,
      stageScore: st.stageScore, playScore: st.stageScore - bonusTotal, score: this.run.score,
      addsUsed: st.addsUsed, addsLeft: st.addsLeft, hintsLeft: st.hintsLeft,
      isLast: this.run.stageIndex + 1 >= this.stages.length,
      worldEnd: (this.run.stageIndex + 1) % this.cfg.worldSize === 0,   // World の終わりなら Result の画面
      chain: st.chain, mult: this.multiplier, fever: !!st.fever,
      maxMult: this.multiplierFor(st.maxChain ?? 0), runMaxMult: this.multiplierFor(this.run.maxChain ?? 0),
    }];
  }

  /** 感想戦のために Stage の記録を Run に残す(直近 6 Stage まで)。 */
  pushReview(stage, cleared) {
    const st = this.stage;
    if (!this.run.reviews) this.run.reviews = [];
    this.run.reviews.push({ stage, cleared, history: st.history, stageScore: st.stageScore, maxChain: st.maxChain ?? 0 });
    if (this.run.reviews.length > 6) this.run.reviews.shift();
  }

  nextStage(now = Date.now()) {
    if (!this.run || this.stage.status !== 'clear') return [];
    if (this.run.stageIndex + 1 >= this.stages.length) {
      this.stage.status = 'complete';
      this.save();
      return [{ type: 'complete', score: this.run.score, best: this.progress.bestScore }];
    }
    const carry = { chain: this.stage.chain, fever: this.stage.fever };
    this.run.stageIndex += 1;
    return this.startStage(carry, now);
  }

  /** 失敗。keepRatio は Stage 得点のうち残す割合(GIVE UP なら半分、気づかずの Hint なら 0)。 */
  stageFailed(reason, keepRatio = 0) {
    const st = this.stage, def = this.stageDef;
    this.pushReview(def.stage, false);
    this.run.lives -= 1;
    const kept = Math.floor(st.stageScore * keepRatio);
    const lost = st.stageScore - kept;
    this.run.score -= lost;
    this.progress.attempts[def.stage] = (this.progress.attempts[def.stage] ?? 0) + 1;
    st.stageScore = 0;
    st.fever = null; st.scope = null; st.flashUntil = null;
    if (this.run.lives <= 0) {
      st.status = 'runOver';
      this.progress.bestScore = Math.max(this.progress.bestScore, this.run.score);
      this.save();
      return [{ type: 'runOver', reason, score: this.run.score, best: this.progress.bestScore, lost, kept,
                resumeStage: this.worldStart(this.run.stageIndex), stage: def.stage, runMaxMult: this.multiplierFor(this.run.maxChain ?? 0) }];
    }
    st.status = 'failed';
    this.save();
    return [{ type: 'stageFailed', reason, lives: this.run.lives, lost, kept, stage: def.stage, maxMult: this.multiplierFor(st.maxChain ?? 0) }];
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
