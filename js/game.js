// ゲームの進行(ルールの上に乗る層)。
//   rules.js  … 盤面の純粋な操作(Haskell と同じ)
//   game.js   … ラン・ステージ・チェーン・ライフ・スコア・保存   ← このファイル
//   main.js   … 画面・演出・音とのつなぎ
//
// 設計: 各操作(tap / useAdd / useHint …)は状態を更新し、「起きたこと」をイベントの配列で返す。
// 演出や音はイベントを見て動くので、ゲームの判断と見せ方が分かれる。

import { validPairs, removePair, collapseRows, addNumbers, isCleared, matches, connected, rows } from './rules.js';

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
  get multiplier() {
    const c = this.cfg.chain;
    return Math.min(c.max, 1 + c.step * (this.stage?.chain ?? 0));
  }
  get heat() {  // 0〜1。演出の熱さ
    const c = this.cfg.chain;
    return (this.multiplier - 1) / (c.max - 1);
  }
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
      status: 'play',        // play | clear | failed | runOver | complete
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex: this.run.stageIndex }];
  }

  // ---------- 操作 ----------
  tap(pos) {
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
    if (matches(b[i], b[j]) && connected(b, i, j)) return this.remove(i, j);
    // 組にならない: 選択を移す(本家と同じ)
    const prev = st.selected; st.selected = pos;
    return [{ type: 'invalid', from: prev, to: pos }, { type: 'select', pos }];
  }

  remove(i, j) {
    const st = this.stage, b = st.board, cfg = this.cfg;
    const before = removePair(i, j, b);
    const clearedRows = rows(before).map((r, k) => (r.every((c) => c === 0) ? k : -1)).filter((k) => k >= 0);
    const after = collapseRows(before);

    st.chain += 1;
    const mult = this.multiplier;
    const pairPoints = Math.round(cfg.score.pairBase * mult);
    const rowPoints = cfg.score.rowClear * clearedRows.length * clearedRows.length;
    const points = pairPoints + rowPoints;
    st.stageScore += points;
    this.run.score += points;
    st.selected = null;
    st.hintPair = null;
    st.board = after;

    const events = [{
      type: 'remove', i, j, a: b[i], b: b[j], points, pairPoints, rowPoints,
      chain: st.chain, mult, heat: this.heat, clearedRows, boardBefore: before, board: after,
    }];
    events.push(...this.afterBoardChange());
    this.save();
    return events;
  }

  // 盤が変わった後の判定: クリア / 詰み(追加できる) / 詰み(追加できない = 失敗)
  afterBoardChange() {
    const st = this.stage;
    if (isCleared(st.board)) return this.stageClear();
    if (validPairs(st.board).length > 0) return [];
    if (st.addsLeft > 0) return [{ type: 'stuck', addsLeft: st.addsLeft }];
    return this.stageFailed('stuck');
  }

  useAdd() {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    if (st.addsLeft <= 0) return [{ type: 'noAdds' }];
    const oldLength = st.board.length;
    st.board = addNumbers(st.board);
    st.addsLeft -= 1;
    st.addsUsed += 1;
    const brokeChain = st.chain > 0;
    st.chain = 0;
    st.selected = null;
    st.hintPair = null;
    const events = [{ type: 'add', oldLength, newLength: st.board.length, addsLeft: st.addsLeft, brokeChain, board: st.board }];
    events.push(...this.afterBoardChange());
    this.save();
    return events;
  }

  useHint() {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    const pairs = validPairs(st.board);
    if (pairs.length === 0) return [{ type: 'noHint' }];
    const brokeChain = st.chain > 0;
    st.chain = 0;
    st.selected = null;
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

  // ラン終了後: 今のワールドの先頭から新しいラン
  restartFromWorld() {
    const idx = this.run ? this.worldStart(this.run.stageIndex) : 0;
    return this.newRun(idx);
  }

  abandonRun() {
    this.run = null;
    this.save();
  }
}
