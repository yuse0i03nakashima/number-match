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
//
// モード: NORMAL と CLASSIC(cfg.classic)。記録(progress)と進行中の Run はモードごとに別の枠(slots)に持つ。
//   CLASSIC は本家に近い遊び方: 倍率 ×1 固定、ゲージ・FEVER・Speed・Heart なし、Dead End はすぐ知らせる、
//   Add は 5 回、Hint は 1 段階だけ。Perfect は Add も Hint も使わないこと。

import { validPairs, removePair, collapseRows, isCleared, matches, connected, rows, numbers, rowOf, WIDTH } from './rules.js';
import { pathInfo, difficultyMult, speedTier } from './scoring.js';
import { chooseAddition } from './solver.js';
import { makeQuest, updateQuest } from './quest.js';

const RANKS = ['C', 'B', 'A', 'S'];
const rankIndex = (r) => RANKS.indexOf(r);

export const MODES = ['normal', 'classic'];
const emptyProgress = () => ({ maxStage: 0, stars: {}, ranks: {}, attempts: {}, bestScore: 0, runs: 0, quests: {}, stageBest: {} });

export class Game {
  constructor(stages, config, storage = globalThis.localStorage) {
    this.stages = stages;
    this.cfg = config;
    this.storage = storage;
    this.mode = 'normal';
    // モードごとの枠: 記録(progress)と進行中の Run(無ければ null)
    this.slots = Object.fromEntries(MODES.map((m) => [m, { progress: emptyProgress(), run: null }]));
    this.coins = 0;          // Coin(モード共通。ショップとスロットで使う)
    this.slotStats = {};     // スロットの記録(slot.js が使う。ここでは保存するだけ)
    this.load();
  }

  // ---------- 保存 ----------
  load() {
    try {
      const raw = this.storage?.getItem(this.cfg.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.slots) {
        for (const m of MODES) {
          if (!data.slots[m]) continue;
          this.slots[m].progress = { ...emptyProgress(), ...(data.slots[m].progress ?? {}) };
          this.slots[m].run = data.slots[m].run ?? null;
        }
        if (MODES.includes(data.mode)) this.mode = data.mode;
        this.coins = Math.max(0, Math.floor(data.coins ?? 0));
        this.slotStats = data.slotStats ?? {};
      } else {
        // 旧形式(モードが無いころの保存)は NORMAL の記録として読む。relax の印は捨てる
        if (data.progress) { const { relax, ...p } = data.progress; this.slots.normal.progress = { ...emptyProgress(), ...p }; }
        if (data.run) this.slots.normal.run = data.run;
      }
    } catch { /* 壊れていたら初期状態で始める */ }
  }
  save() {
    try {
      this.storage?.setItem(this.cfg.storageKey, JSON.stringify({ mode: this.mode, slots: this.slots, coins: this.coins, slotStats: this.slotStats }));
    } catch { /* 保存できない環境では無視 */ }
  }

  // ---------- 参照 ----------
  get progress() { return this.slots[this.mode].progress; }
  set progress(v) { this.slots[this.mode].progress = v; }
  get run() { return this.slots[this.mode].run; }
  set run(v) { this.slots[this.mode].run = v; }
  get classic() { return this.mode === 'classic'; }
  /** モードを切り替える(Title から)。各モードの記録と Run はそのまま残る。 */
  setMode(mode) { if (MODES.includes(mode)) { this.mode = mode; this.save(); } }
  /** Coin を足す(負の値で引く)。残高は 0 未満にならない。 */
  addCoins(n) { this.coins = Math.max(0, Math.floor(this.coins + n)); this.save(); return this.coins; }
  /** ショップの品物と値段(いまのモード)。 */
  get shopPrices() { return this.cfg.shop[this.mode] ?? {}; }
  /** いま買える品物の一覧 [{ item, price, can }]。can は Coin が足りて、かつ買う意味がある(残り 0 など)とき。 */
  shopItems() {
    const st = this.stage, p = this.shopPrices, out = [];
    if (!st || st.status !== 'play') return out;
    if (p.hint) out.push({ item: 'hint', price: p.hint, can: this.coins >= p.hint && st.hintsLeft <= 0 && !st.fever });
    if (p.add) out.push({ item: 'add', price: p.add, can: this.coins >= p.add && st.addsLeft <= 0 });
    if (p.heart) out.push({ item: 'heart', price: p.heart, can: this.coins >= p.heart && this.run.lives < this.cfg.lives.max });
    return out;
  }
  /**
   * ショップで買う。買った Add・Hint は温存 Bonus と投資に数えない(addsBought / hintsBought)。
   * 買った Add を使えば Perfect は失い、買った Hint を使えば Quest「Hint を使わずに Clear」は失敗になる(通常の Add / Hint と同じ扱い)。
   */
  buy(item) {
    const st = this.stage;
    const entry = this.shopItems().find((e) => e.item === item);
    if (!entry) return [{ type: 'noShop', item }];
    if (!entry.can) return [{ type: 'noCoins', item, price: entry.price, coins: this.coins }];
    this.coins -= entry.price;
    if (item === 'hint') { st.hintsLeft += 1; st.hintsBought = (st.hintsBought ?? 0) + 1; }
    if (item === 'add') { st.addsLeft += 1; st.addsBought = (st.addsBought ?? 0) + 1; st.addsTotal = (st.addsTotal ?? 0) + 1; }
    if (item === 'heart') this.run.lives += 1;
    st.history.push({ type: 'buy', item, price: entry.price });
    st.coinUsed = true;
    this.save();
    return [{ type: 'buy', item, price: entry.price, coins: this.coins, addsLeft: st.addsLeft, hintsLeft: st.hintsLeft, lives: this.run.lives }];
  }

  // ---------- 必殺技(Coin) ----------
  /** 必殺技の一覧 [{ skill, price, can }]。can は Coin が足りて Stage 中のとき。 */
  skillItems() {
    const st = this.stage, p = this.cfg.skill[this.mode] ?? {}, out = [];
    if (!st || st.status !== 'play') return out;
    for (const [skill, price] of Object.entries(p)) out.push({ skill, price, can: this.coins >= price });
    return out;
  }
  /** 必殺技を構える。snipe は次の 2 タップ(位置は問わない Pair)、line は次のタップの行。Coin は決まった時点で払う。 */
  armSkill(skill) {
    const st = this.stage;
    const entry = this.skillItems().find((e) => e.skill === skill);
    if (!entry) return [{ type: 'noShop', item: skill }];
    if (!entry.can) return [{ type: 'noCoins', item: skill, price: entry.price, coins: this.coins }];
    st.selected = null;
    st.skill = { type: skill, price: entry.price };
    return [{ type: 'skillArmed', skill, price: entry.price }];
  }
  cancelSkill() {
    const st = this.stage;
    if (!st || !st.skill) return [];
    st.skill = null; st.selected = null;
    return [{ type: 'skillCancel' }];
  }
  /** 構えた必殺技でのタップ。tap() から呼ばれる。 */
  tapSkill(pos, now) {
    const st = this.stage, b = st.board, sk = st.skill;
    if (b[pos] === 0) return this.cancelSkill();                 // 空マスで取りやめ
    if (sk.type === 'line') {
      const r = rowOf(pos);
      const before = b.slice();
      for (let p = r * WIDTH; p < Math.min(b.length, (r + 1) * WIDTH); p++) before[p] = 0;
      const after = collapseRows(before);
      const mult = this.multiplier, feverMult = st.fever ? this.cfg.fever.pointMult : 1;
      const points = Math.round(this.cfg.score.rowClear * mult * feverMult);
      this.coins -= sk.price;
      st.coinUsed = true;
      st.skill = null; st.selected = null; st.hintPair = null; st.scope = null;
      st.stageScore += points; this.run.score += points;
      st.board = after;
      st.history.push({ type: 'skill', skill: 'line', board: b, row: r, points, price: sk.price });
      const events = [{ type: 'skillLine', row: r, points, price: sk.price, coins: this.coins, boardBefore: before, board: after, mult, chain: st.chain, heat: this.heat }];
      events.push(...this.afterBoardChange());
      this.save();
      return events;
    }
    // snipe: 1 つ目を選び、2 つ目が Pair なら位置に関係なく消す(通常の消去と同じ得点と Chain)
    if (sk.first === undefined || sk.first === null) { sk.first = pos; st.selected = pos; return [{ type: 'select', pos }]; }
    if (sk.first === pos) { sk.first = null; st.selected = null; return [{ type: 'deselect', pos }]; }
    const i = Math.min(sk.first, pos), j = Math.max(sk.first, pos);
    if (!matches(b[i], b[j])) { const prev = sk.first; sk.first = pos; st.selected = pos; return [{ type: 'invalid', from: prev, to: pos }, { type: 'select', pos }]; }
    this.coins -= sk.price;
    st.coinUsed = true;
    const price = sk.price;
    st.skill = null;
    st.history.push({ type: 'skill', skill: 'snipe', price });
    const events = this.remove(i, j, now, { skill: 'snipe' });
    events.unshift({ type: 'skillSnipe', i, j, price, coins: this.coins });
    return events;
  }
  get stage() { return this.run?.stage ?? null; }
  get stageDef() { return this.run ? this.stages[this.run.stageIndex] : null; }
  multiplierFor(chain) {
    if (this.classic) return 1;
    const c = this.cfg.chain;
    return Math.min(c.max, 1 + c.step * chain);
  }
  get multiplier() { return this.multiplierFor(this.stage?.chain ?? 0); }
  get heat() {  // 0〜1。演出の熱さ(CLASSIC は常に 0)
    if (this.classic) return 0;
    const c = this.cfg.chain;
    return (this.multiplier - 1) / (c.max - 1);
  }
  get isStuck() { return !!this.stage && validPairs(this.stage.board).length === 0; }
  get inFever() { return !!this.stage?.fever; }
  /** いまの Hint の段階: 'hint' | 'flash' | 'scope'。CLASSIC は常に 'hint'。 */
  get hintTier() {
    if (this.classic) return 'hint';
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
    if (st.fever || this.classic) return 1;
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
    this.run = { stageIndex, score: 0, lives: this.cfg.lives.start, stage: null, maxChain: 0, reviews: [], savedAdds: 0, investChain: 0, investAdds: 0, bonusAdds: 0 };
    this.progress.runs += 1;
    return this.startStage();
  }

  startStage(carry = null, now = Date.now()) {
    const def = this.stageDef;
    const attempt = this.progress.attempts[def.stage] ?? 0;
    const variant = def.boards[attempt % def.boards.length];
    // carry があれば前の Stage の Chain・FEVER を持ち越す(Board を全部消して続けるとき)。
    // World の最初の Stage では、前の World で残した Add の投資分(run.investChain)を開始 Chain に足す
    const worldStart = this.run.stageIndex % this.cfg.worldSize === 0;
    const invest = worldStart ? (this.run.investChain ?? 0) : 0;
    const chain = Math.max(carry ? carry.chain : 0, invest);
    if (worldStart) {
      // CLASSIC の投資は「次の World の各 Stage の Add +N」。World の最初に受け取り、World の間ずっと効く
      this.run.bonusAdds = this.classic ? (this.run.investAdds ?? 0) : 0;
      this.run.investChain = 0; this.run.investAdds = 0; this.run.savedAdds = 0;
    }
    const fever = carry && carry.fever ? { until: carry.fever.until, startedAt: carry.fever.startedAt ?? now } : null;
    const addsTotal = this.classic ? this.cfg.classic.addsPerStage + (this.run.bonusAdds ?? 0) : def.adds;
    this.run.stage = {
      board: variant.cells.slice(),
      addsLeft: addsTotal,
      addsTotal,
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
      fever,                 // FEVER 中なら { until, startedAt }
      status: 'play',        // play | clear | failed | runOver | complete
      history: [],           // 感想戦用の手の記録(review.js が読む)
      maxChain: chain,       // この Stage の最高 Chain
      quest: makeQuest(this.cfg, def.stage, variant.cells, { exclude: this.classic ? ['chain', 'noHint'] : [] }),   // この Stage のお題(CLASSIC に Chain のお題は無く、Hint なしは Perfect と重なるので出さない)
      firstDigitCleared: null,
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex: this.run.stageIndex, carried: !!carry, quest: this.run.stage.quest, invest, bonusAdds: worldStart ? (this.run.bonusAdds ?? 0) : 0, classic: this.classic }];
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
    if (!st.fever && !this.classic && st.chain > 0 && st.lastRemoveAt !== null) {
      const t = now - st.lastRemoveAt - cfg.chain.decayGraceMs;
      if (t > 0) {
        const steps = Math.floor(t / cfg.chain.decayStepMs) + 1 - st.decayed;
        if (steps > 0) {
          const before = st.chain;
          st.chain = Math.max(0, st.chain - steps);
          st.decayed += steps;
          events.push({ type: 'chainDecay', from: before, chain: st.chain, mult: this.multiplier, heat: this.heat });
          const qd = updateQuest(st.quest, { type: 'break' });
          if (qd.changed) events.push(this.questEvent(qd));
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
    if (st.skill) return this.tapSkill(pos, now);
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
    const qb = updateQuest(st.quest, { type: 'break' });
    this.save();
    return [{ type: 'scopeMiss', misses: 2, from: before, chain: st.chain, mult: this.multiplier }, { type: 'scopeEnd', reason: 'miss' }, ...(qb.changed ? [this.questEvent(qb)] : [])];
  }

  remove(i, j, now, { skill = null } = {}) {
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
    const diffFull = difficultyMult(cfg.difficulty, info);
    // CLASSIC: 難しさの倍率は無く、横の隣どうし以外に小さな定額の加点
    const pathBonus = this.classic && info && info.kind !== 'adjacent' ? cfg.classic.pathBonus : 0;
    const diff = this.classic ? { mult: 1, labels: diffFull.labels } : diffFull;
    const elapsed = st.lastRemoveAt === null ? Infinity : now - st.lastRemoveAt;
    const speed = scoped || this.classic ? { tier: null, mult: 1 } : speedTier(cfg.speed, elapsed);   // SCOPE の補助を受けた Pair と CLASSIC に Speed は付かない
    st.lastRemoveAt = now;
    st.decayed = 0;

    // Chain: 補助を受けた Pair(HINT / SCOPE)は増えない。それ以外は +1
    const assisted = hinted || scoped;
    const chainBefore = st.chain;
    if (!assisted) st.chain += 1;
    st.maxChain = Math.max(st.maxChain ?? 0, st.chain);
    this.run.maxChain = Math.max(this.run.maxChain ?? 0, st.chain);
    const mult = this.multiplier;
    // FEVER 中に消すと残り時間が延びる(全体の長さは maxTotalMs まで)
    let feverExtendMs = 0;
    if (st.fever) {
      const cap = (st.fever.startedAt ?? now) + cfg.fever.maxTotalMs;
      const extended = Math.max(st.fever.until, Math.min(st.fever.until + cfg.fever.extendMs, cap));
      feverExtendMs = extended - st.fever.until;
      st.fever.until = extended;
    }
    const feverMult = st.fever ? cfg.fever.pointMult : 1;
    const hintedRatio = hinted ? cfg.score.hintedPairRatio : 1;
    const pairPoints = Math.round(cfg.score.pairBase * diff.mult * mult * speed.mult * feverMult * hintedRatio) + pathBonus;
    const rowPoints = Math.round(cfg.score.rowClear * clearedRows.length * clearedRows.length * mult * feverMult);
    // DIGIT CLEAR: この 1 手で Board から消え切った数字(残りが 0 になった数字)
    const left = new Set(numbers(after));
    const digitsCleared = [...new Set([b[i], b[j]])].filter((d) => !left.has(d)).sort();
    const digitPoints = Math.round((this.classic ? cfg.classic.digitClear : cfg.score.digitClear) * digitsCleared.length * mult * feverMult);
    const points = pairPoints + rowPoints + digitPoints;
    st.stageScore += points;
    this.run.score += points;
    st.selected = null;
    st.board = after;
    st.history.push({ type: 'remove', board: b, i, j, points, chain: st.chain, chainBefore, mult, clearedRows, digitsCleared, hinted, scoped });
    const otherDigitClearedBefore = st.firstDigitCleared !== null;
    if (digitsCleared.length && st.firstDigitCleared === null) st.firstDigitCleared = digitsCleared[0];
    const questUpdate = updateQuest(st.quest, { type: 'remove', chain: st.chain, chainBefore, digitsCleared, path: info, otherDigitClearedBefore });

    const labels = skill ? ['SNIPE SHOT'] : [...diff.labels];
    if (scoped) labels.push('SCOPE');
    if (hinted) labels.push('HINTED');
    events.push({
      type: 'remove', i, j, a: b[i], b: b[j], points, pairPoints, rowPoints, digitPoints, digitsCleared,
      chain: st.chain, mult, heat: this.heat, clearedRows, boardBefore: before, board: after,
      path: info, diffMult: diff.mult, pathBonus, labels, speed: speed.tier, speedMult: speed.mult, elapsed, classic: this.classic,
      fever: !!st.fever, feverExtendMs, feverUntil: st.fever?.until ?? null, hinted, scoped, scopeBroken, skill,
    });
    if (scopeBroken) events.push({ type: 'scopeEnd', reason: 'ignored', chain: st.chain, mult: this.multiplier });
    if (questUpdate.changed) events.push(this.questEvent(questUpdate));
    // 倍率が上限に達したら FEVER 開始
    if (!this.classic && !st.fever && mult >= cfg.chain.max) {
      st.fever = { until: now + cfg.fever.durationMs, startedAt: now };
      events.push({ type: 'feverStart', until: st.fever.until, durationMs: cfg.fever.durationMs });
    }
    events.push(...this.afterBoardChange());
    this.save();
    return events;
  }

  // Board が変わった後の判定: Clear だけを見る。Dead End はプレイヤーが Add / Hint を押したときに分かる。
  // CLASSIC は本家と同じく Dead End をすぐ知らせ、Add も無ければその場で Stage 失敗(Heart は減らない)。
  afterBoardChange() {
    const st = this.stage;
    if (isCleared(st.board)) return this.stageClear();
    if (this.classic && validPairs(st.board).length === 0) {
      if (st.addsLeft > 0) return [{ type: 'deadEnd', addsLeft: st.addsLeft }];
      return this.stageFailed('deadEnd', this.cfg.classic.failKeepRatio);
    }
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
    st.selected = null; st.skill = null;
    st.hintPair = null; st.scope = null; st.flashUntil = null;
    st.lastRemoveAt = st.chain > 0 ? now : null;
    st.decayed = 0;
    const qa = updateQuest(st.quest, { type: 'break' });
    const events = [{
      type: 'add', oldLength, newLength: st.board.length, addsLeft: st.addsLeft, board: st.board,
      arrangement: added.arrangement, solvable: added.checked && added.arrangement !== 'fallback',
      stuckBefore: stuck, chainBefore, chainAfter: st.chain,
      multBefore: this.multiplierFor(chainBefore), multAfter: this.multiplier,
    }];
    if (qa.changed) events.push(this.questEvent(qa));
    this.save();
    return events;
  }

  /** お題の進み具合のイベント。 */
  questEvent(u) {
    const q = this.stage.quest;
    return { type: 'quest', quest: q, done: u.done, failed: u.failed };
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
    st.selected = null; st.skill = null;

    if (pairs.length === 0 && this.classic) {
      // CLASSIC: Dead End は知らせてあるので、罰も使用回数の消費も無い
      return [{ type: 'noHint', penalty: 0, addsLeft: st.addsLeft, blind: false, tier, from: st.chain, chain: st.chain, mult: 1, hintsLeft: st.hintsLeft }];
    }
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
    const qh = updateQuest(st.quest, { type: 'hint' });
    const questEvents = qh.changed ? [this.questEvent(qh)] : [];
    if (tier === 'hint') {
      st.hintPair = pairs[Math.floor(Math.random() * pairs.length)];
      this.save();
      return [{ type: 'hint', tier, pair: st.hintPair, hintsLeft: st.hintsLeft }, ...questEvents];
    }
    if (tier === 'flash') {
      st.flashUntil = now + h.flashMs;
      // ゲージを半分に: 猶予の半分が過ぎたことにする
      if (st.chain > 0) { st.lastRemoveAt = now - cfg.chain.decayGraceMs * (1 - h.flashGaugeRatio); st.decayed = 0; }
      this.save();
      return [{ type: 'flash', tier, pairs, until: st.flashUntil, hintsLeft: st.hintsLeft }, ...questEvents];
    }
    // scope: 相手のいるタイルを 1 枚。相手が少ないタイルを選ぶ(探しがいがある)
    const count = new Map();
    for (const [a, c] of pairs) { count.set(a, (count.get(a) ?? 0) + 1); count.set(c, (count.get(c) ?? 0) + 1); }
    const tiles = [...count.entries()].sort((x, y) => x[1] - y[1]);
    const tile = tiles[Math.floor(Math.random() * Math.min(3, tiles.length))][0];
    st.scope = { tile, misses: 0 };
    this.save();
    return [{ type: 'scope', tier, tile, remaining: pairs.length, hintsLeft: st.hintsLeft, fever: !!st.fever }, ...questEvents];
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
    const perCell = this.classic ? this.cfg.classic.rankPerCell : r.perCell;
    const ratio = stageScore / (def.cellsCount * perCell);
    return ratio >= r.S ? 'S' : ratio >= r.A ? 'A' : ratio >= r.B ? 'B' : 'C';
  }

  stageClear() {
    const st = this.stage, def = this.stageDef, cfg = this.cfg;
    // Perfect: Add なしで Clear。CLASSIC は Hint も使わないこと
    const perfect = st.addsUsed === 0 && (!this.classic || st.hintsUsed === 0);
    const stars = perfect ? 3 : st.addsUsed <= 1 ? 2 : 1;
    const clearBonus = cfg.score.stageClear;
    const perfectBonus = perfect ? cfg.score.perfect : 0;
    // 温存: 買った分は数えない
    const addsSaved = Math.max(0, st.addsLeft - (st.addsBought ?? 0));
    const hintsSaved = Math.max(0, st.hintsLeft - (st.hintsBought ?? 0));
    const savedBonus = addsSaved * cfg.score.addSaved;
    const hintBonus = hintsSaved * cfg.score.hintSaved;
    // お題: noHint は Clear で達成が決まる
    updateQuest(st.quest, { type: 'clear' });
    const questBonus = st.quest && st.quest.done ? cfg.quest.bonus : 0;
    if (st.quest && st.quest.done) this.progress.quests = { ...(this.progress.quests ?? {}), [def.stage]: true };
    // 温存の投資: この World で残した Add を数え、World の終わりで次の World の開始 Chain と Heart に変える
    this.run.savedAdds = (this.run.savedAdds ?? 0) + addsSaved;
    const worldEnd = (this.run.stageIndex + 1) % cfg.worldSize === 0;
    let investChain = 0, investHearts = 0, investAdds = 0;
    if (worldEnd && this.classic) {
      // CLASSIC: 残した Add → 次の World の各 Stage の Add +N
      investAdds = Math.min(cfg.classic.investAddsCap, Math.floor(this.run.savedAdds / cfg.classic.investAddsPer));
      this.run.investAdds = investAdds;
    } else if (worldEnd) {
      investChain = Math.min(cfg.invest.chainCap, this.run.savedAdds * cfg.invest.chainPerAdd);
      investHearts = Math.floor(this.run.savedAdds / cfg.invest.addsPerHeart);
      this.run.investChain = investChain;
    }
    // Heart は上限まで。Perfect の回復を先に、投資の分はその残りに入れる(表示する数は実際に増えた分)。CLASSIC に Heart は無い
    const room = this.classic ? 0 : cfg.lives.max - this.run.lives;
    const perfectGain = Math.min(room, perfect ? cfg.lives.perfectRecover : 0);
    investHearts = Math.min(room - perfectGain, investHearts);
    const lifeGain = perfectGain + investHearts;
    this.run.lives += lifeGain;
    const bonusTotal = clearBonus + perfectBonus + savedBonus + hintBonus + questBonus;
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
    // Stage ごとの最高得点(腕前の指標。Coin やショップでは変わらない)
    const prevBest = this.progress.stageBest?.[def.stage] ?? 0;
    const stageBestUpdated = !st.coinUsed && st.stageScore > prevBest;   // Coin(ショップ・必殺技)を使った Stage は腕前の記録に数えない
    if (!this.progress.stageBest) this.progress.stageBest = {};
    if (stageBestUpdated) this.progress.stageBest[def.stage] = st.stageScore;
    // Coin: Stage の得点がそのまま貯まる
    const coinsGained = st.stageScore;
    this.coins += coinsGained;
    this.save();
    return [{
      type: 'stageClear', stage: def.stage, stars, rank, perfect, clearBonus, perfectBonus, savedBonus, hintBonus, lifeGain,
      stageBest: stageBestUpdated ? st.stageScore : prevBest, stageBestUpdated, prevBest, coinsGained, coins: this.coins, coinUsed: !!st.coinUsed,
      stageScore: st.stageScore, playScore: st.stageScore - bonusTotal, score: this.run.score,
      addsUsed: st.addsUsed, addsLeft: st.addsLeft, hintsLeft: st.hintsLeft, addsSaved, hintsSaved,
      isLast: this.run.stageIndex + 1 >= this.stages.length,
      worldEnd,   // World の終わりなら Result の画面
      chain: st.chain, mult: this.multiplier, fever: !!st.fever,
      maxMult: this.multiplierFor(st.maxChain ?? 0), runMaxMult: this.multiplierFor(this.run.maxChain ?? 0),
      quest: st.quest, questBonus, savedAdds: this.run.savedAdds, investChain, investHearts, investAdds, classic: this.classic,
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
    if (!this.classic) this.run.lives -= 1;          // CLASSIC に Heart は無い(Run は終わらない)
    const kept = Math.floor(st.stageScore * keepRatio);
    const lost = st.stageScore - kept;
    this.run.score -= lost;
    this.progress.attempts[def.stage] = (this.progress.attempts[def.stage] ?? 0) + 1;
    st.stageScore = 0;
    st.fever = null; st.scope = null; st.flashUntil = null;
    if (!this.classic && this.run.lives <= 0) {
      st.status = 'runOver';
      this.progress.bestScore = Math.max(this.progress.bestScore, this.run.score);
      this.save();
      return [{ type: 'runOver', reason, score: this.run.score, best: this.progress.bestScore, lost, kept,
                resumeStage: this.worldStart(this.run.stageIndex), stage: def.stage, runMaxMult: this.multiplierFor(this.run.maxChain ?? 0) }];
    }
    st.status = 'failed';
    this.save();
    return [{ type: 'stageFailed', reason, lives: this.run.lives, lost, kept, stage: def.stage, maxMult: this.multiplierFor(st.maxChain ?? 0), classic: this.classic }];
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
