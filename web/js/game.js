// ゲームの進行(ルールの上に乗る層)。
//   rules.js   … ボード面の純粋な操作(Haskell と同じ)
//   scoring.js … 道の種類・速さによるボーナス(JavaScript だけ)
//   game.js    … ラン・ステージ・チェーン・ライフ・スコア・保存   ← このファイル
//   main.js    … 画面・演出・音とのつなぎ
//
// 設計: 各操作(tap / useAdd / useHint …)は状態を更新し、「起きたこと」をイベントの配列で返す。
// 演出や音はイベントを見て動くので、ゲームの判断と見せ方が分かれる。
//
// 詰み(消せるペアがない)の扱い: ゲームは自分からは教えない。
//   Add を押す  … 詰みなら「仕方ない」のでチェーンを半分残す。ペアが残っていたのに押すと途切れる。
//   Hint を押す … 詰みなら「まだあると思い込んでいた」ので、途切れたうえに減点。

import { validPairs, removePair, collapseRows, addNumbers, isCleared, matches, connected, rows } from './rules.js';
import { pathInfo, difficultyBonus, speedTier } from './scoring.js';

export class Game {
  constructor(stages, config, storage = globalThis.localStorage) {
    this.stages = stages;
    this.cfg = config;
    this.storage = storage;
    this.progress = { maxStage: 0, stars: {}, attempts: {}, bestScore: 0, runs: 0 };
    this.run = null;   // 進行中のラン(無ければ null)
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
  worldOf(stageIndex) { return Math.floor(stageIndex / this.cfg.worldSize); }
  worldStart(stageIndex) { return this.worldOf(stageIndex) * this.cfg.worldSize; }
  get unlockedWorlds() { return this.worldOf(Math.min(this.progress.maxStage, this.stages.length - 1)) + 1; }
  get totalStars() { return Object.values(this.progress.stars).reduce((a, b) => a + b, 0); }

  // ---------- ランとステージ ----------
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
      lastRemoveAt: null,    // 前の消去の時刻(速さボーナス用)
      status: 'play',        // play | clear | failed | runOver | complete
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex: this.run.stageIndex }];
  }

  // ---------- 操作 ----------
  // now は現在時刻(ミリ秒)。検査では好きな値を渡せる。
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
    // ペアにならない: 選択を移す(本家と同じ)
    const prev = st.selected; st.selected = pos;
    return [{ type: 'invalid', from: prev, to: pos }, { type: 'select', pos }];
  }

  remove(i, j, now) {
    const st = this.stage, b = st.board, cfg = this.cfg;
    const before = removePair(i, j, b);
    const clearedRows = rows(before).map((r, k) => (r.every((c) => c === 0) ? k : -1)).filter((k) => k >= 0);
    const after = collapseRows(before);

    // 難しい道・速さのボーナス
    const info = pathInfo(b, i, j);
    const diff = difficultyBonus(cfg.score, info);
    const elapsed = st.lastRemoveAt === null ? Infinity : now - st.lastRemoveAt;
    const speed = speedTier(cfg.speed, elapsed);
    st.lastRemoveAt = now;

    st.chain += 1;
    const mult = this.multiplier;
    const pairPoints = Math.round((cfg.score.pairBase + diff.bonus) * mult * speed.mult);
    const rowPoints = Math.round(cfg.score.rowClear * clearedRows.length * clearedRows.length * mult);
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
    }];
    events.push(...this.afterBoardChange());
    this.save();
    return events;
  }

  // ボードが変わった後の判定: クリアだけを見る。詰みはプレイヤーが Add / Hint を押したときに分かる。
  afterBoardChange() {
    if (isCleared(this.stage.board)) return this.stageClear();
    return [];
  }

  useAdd() {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    const stuck = this.isStuck;
    if (st.addsLeft <= 0) {
      // Add が無い。詰んでいればここで失敗が確定する
      return stuck ? this.stageFailed('stuck') : [{ type: 'noAdds' }];
    }
    const oldLength = st.board.length;
    const chainBefore = st.chain;
    st.board = addNumbers(st.board);
    st.addsLeft -= 1;
    st.addsUsed += 1;
    // 詰んでからの Add は仕方ないので控えめ(チェーンを一部残す)。ペアが残っていたのに押すと途切れる
    st.chain = stuck ? Math.floor(st.chain * cfg.stuck.addKeepRatio) : 0;
    st.selected = null;
    st.hintPair = null;
    st.lastRemoveAt = null;
    const events = [{
      type: 'add', oldLength, newLength: st.board.length, addsLeft: st.addsLeft, board: st.board,
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
    if (pairs.length === 0) {
      // まだあると思っていた: 途切れたうえに減点。Add も無ければ失敗
      const penalty = Math.min(st.stageScore, cfg.score.hintWhenStuck);
      st.stageScore -= penalty;
      this.run.score -= penalty;
      const events = [{ type: 'noHint', penalty, brokeChain, addsLeft: st.addsLeft }];
      if (st.addsLeft <= 0) events.push(...this.stageFailed('stuck'));
      this.save();
      return events;
    }
    st.hintPair = pairs[Math.floor(Math.random() * pairs.length)];
    this.save();
    return [{ type: 'hint', pair: st.hintPair, brokeChain }];
  }

  // 「あきらめる」= 失敗扱い
  giveUp() {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    const events = this.stageFailed('giveUp');
    this.save();
    return events;
  }

  // ---------- 結果 ----------
  stageClear() {
    const st = this.stage, def = this.stageDef, cfg = this.cfg;
    const perfect = st.addsUsed === 0;
    const stars = perfect ? 3 : st.addsUsed === 1 ? 2 : 1;
    const clearBonus = cfg.score.stageClear;
    const perfectBonus = perfect ? cfg.score.perfect : 0;
    const lifeGain = perfect && this.run.lives < cfg.lives.max ? cfg.lives.perfectRecover : 0;
    this.run.lives = Math.min(cfg.lives.max, this.run.lives + lifeGain);
    this.run.score += clearBonus + perfectBonus;
    st.stageScore += clearBonus + perfectBonus;
    st.status = 'clear';

    this.progress.stars[def.stage] = Math.max(this.progress.stars[def.stage] ?? 0, stars);
    this.progress.maxStage = Math.max(this.progress.maxStage, this.run.stageIndex + 1);
    this.progress.bestScore = Math.max(this.progress.bestScore, this.run.score);
    this.save();
    return [{
      type: 'stageClear', stage: def.stage, stars, perfect, clearBonus, perfectBonus, lifeGain,
      stageScore: st.stageScore, score: this.run.score, addsUsed: st.addsUsed,
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

  stageFailed(reason = 'stuck') {
    const st = this.stage, def = this.stageDef;
    this.run.lives -= 1;
    this.run.score -= st.stageScore;     // そのステージの得点は消える
    this.progress.attempts[def.stage] = (this.progress.attempts[def.stage] ?? 0) + 1;
    const lost = st.stageScore;
    st.stageScore = 0;
    if (this.run.lives <= 0) {
      st.status = 'runOver';
      this.progress.bestScore = Math.max(this.progress.bestScore, this.run.score);
      this.save();
      return [{ type: 'runOver', reason, score: this.run.score, best: this.progress.bestScore, lost,
                resumeStage: this.worldStart(this.run.stageIndex), stage: def.stage }];
    }
    st.status = 'failed';
    this.save();
    return [{ type: 'stageFailed', reason, lives: this.run.lives, lost, stage: def.stage }];
  }

  retryStage() {
    if (!this.run || this.stage.status !== 'failed') return [];
    return this.startStage();
  }

  // ラン終了後: 今のワールドのはじめから新しいラン
  restartFromWorld() {
    const idx = this.run ? this.worldStart(this.run.stageIndex) : 0;
    return this.newRun(idx);
  }

  abandonRun() {
    this.run = null;
    this.save();
  }
}
