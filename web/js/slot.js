// スロット(パチスロ型)の判断。画面や音は slotview.js。
//
// 仕組み(本物のパチスロと同じ順序):
//   1. START で賭け金を払い、その回の「役」を先に抽選する(flag)。
//   2. リールは回り続け、プレイヤーが 1 本ずつ止める。押した位置から最大 pullIn(4)コマ先までの中で、
//      役が揃う位置があればそこへ引き込む。無ければ取りこぼし。役が無い回は、揃わない位置を選ぶ。
//   3. 3 本止まったら有効ラインを見て払い戻す。
//
// 図柄: '1'〜'9'、'T'(TEN)、'S'(★)。
// 役(1 ライン・1 枚賭けあたり。払い戻しは賭け枚数に比例):
//   big      T T T            … BIG BONUS。payout.big 枚 + bonus.big.games 回の高確率
//   reg      S S S            … REG BONUS。payout.reg 枚 + bonus.reg.games 回の高確率
//   same     d d d            … 同じ数字 3 つ。d × payout.samePerDigit 枚
//   ten      a + b + c = 10   … THE TEN の役。payout.ten 枚
//   pairStar a + b = 10 と S  … payout.pairStar 枚(S はどの位置でもよい)
// 有効ライン: 賭け 1 枚で中段、3 枚で横 3 本、5 枚で斜め 2 本を足して 5 本。
// 払い戻しは、揃ったラインのうち一番高い 1 本だけ(同時に 2 本揃っても足さない)。

export const SYMBOLS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'S'];

// リール帯(21 コマ)。T と S は 2 つずつ、離して置く(目押しが要る)。数字は 2 つずつ程度
export const STRIPS = [
  ['1', '5', 'T', '3', '7', '2', '8', 'S', '4', '6', '9', '1', '5', 'T', '2', '8', '3', '7', 'S', '4', '6'],
  ['2', '6', 'S', '4', '8', '1', '9', 'T', '3', '5', '7', '2', '6', 'S', '1', '9', '4', '8', 'T', '3', '5'],
  ['3', '7', 'T', '1', '9', '4', '6', 'S', '2', '8', '5', '3', '7', 'T', '4', '6', '1', '9', 'S', '2', '8'],
];

// 有効ライン(各リールの段: 0 上段, 1 中段, 2 下段)。賭け枚数で使う本数が変わる
export const LINES = [
  [1, 1, 1],   // 中段
  [0, 0, 0],   // 上段
  [2, 2, 2],   // 下段
  [0, 1, 2],   // 右下がり
  [2, 1, 0],   // 右上がり
];
export const LINES_FOR_BET = { 1: 1, 3: 3, 5: 5 };

const isDigit = (s) => s >= '1' && s <= '9';
const num = (s) => (isDigit(s) ? Number(s) : 0);

/** 1 ラインの役。無ければ null。 */
export function evalLine(a, b, c, payout) {
  if (a === 'T' && b === 'T' && c === 'T') return { role: 'big', pay: payout.big };
  if (a === 'S' && b === 'S' && c === 'S') return { role: 'reg', pay: payout.reg };
  if (isDigit(a) && a === b && b === c) return { role: 'same', pay: num(a) * payout.samePerDigit, digit: num(a) };
  if (isDigit(a) && isDigit(b) && isDigit(c) && num(a) + num(b) + num(c) === 10) return { role: 'ten', pay: payout.ten };
  const syms = [a, b, c];
  const stars = syms.filter((s) => s === 'S').length;
  if (stars === 1) {
    const d = syms.filter(isDigit);
    if (d.length === 2 && num(d[0]) + num(d[1]) === 10) return { role: 'pairStar', pay: payout.pairStar };
  }
  return null;
}

/** 停止位置 pos(中段のコマ番号)から、上・中・下の 3 コマを返す。 */
export function windowAt(strip, pos) {
  const n = strip.length;
  return [strip[(pos - 1 + n) % n], strip[pos % n], strip[(pos + 1) % n]];
}

/** 3 本の停止位置から、有効ラインごとの役を集める。 */
export function evaluate(positions, lines, payout, strips = STRIPS) {
  const wins = [];
  const windows = positions.map((p, k) => windowAt(strips[k], p));
  for (let L = 0; L < lines; L++) {
    const [r0, r1, r2] = LINES[L];
    const w = evalLine(windows[0][r0], windows[1][r1], windows[2][r2], payout);
    if (w) wins.push({ line: L, ...w });
  }
  const best = wins.reduce((m, w) => (w.pay > (m?.pay ?? 0) ? w : m), null);
  return { wins, best, total: best ? best.pay : 0, windows };
}

/** 役 flag(文字列)が、この 3 コマの組で成立しているか。 */
function matchesFlag(w, flag) {
  if (!w || !flag) return false;
  if (flag.role === 'same') return w.role === 'same' && w.digit === flag.digit;
  return w.role === flag.role;
}

/**
 * 残りのリールをでたらめに押したとき、引き込み(pullIn)込みで役 flag が揃う割合(0〜1)。
 * 残り 1 本なら押す位置ごとに「引き込み範囲に揃う位置があるか」を数える。残り 2 本なら次のリールの押す位置ごとに、
 * 最善の引き込み位置を選んだうえで、その先の割合を平均する。止める位置を選ぶときの目安に使う。
 */
export function coverage(positions, lines, flag, payout, strips, pullIn) {
  const k = positions.indexOf(null);
  if (k < 0) return flagMatched(positions, lines, flag, payout, strips) ? 1 : 0;
  const n = strips[k].length;
  let sum = 0;
  for (let p = 0; p < n; p++) {
    let best = 0;
    for (let s = 0; s <= pullIn; s++) {
      const ps = positions.slice(); ps[k] = (p + s) % n;
      if (!flagPossible(ps, lines, flag, payout, strips)) continue;
      const c = coverage(ps, lines, flag, payout, strips, pullIn);
      if (c > best) best = c;
      if (best >= 1) break;
    }
    sum += best;
  }
  return sum / n;
}

function flagMatched(positions, lines, flag, payout, strips) {
  return evaluate(positions, lines, payout, strips).wins.some((w) => matchesFlag(w, flag));
}

/**
 * まだ止まっていないリールを含めて、役 flag がどこかの有効ラインで成立し得るか。
 * positions[k] が null のリールは「どのコマにもなれる」とみなす(帯に存在する図柄だけ)。
 */
function flagPossible(positions, lines, flag, payout, strips) {
  const windows = positions.map((p, k) => (p === null ? null : windowAt(strips[k], p)));
  for (let L = 0; L < lines; L++) {
    const cells = LINES[L].map((row, k) => (windows[k] ? [windows[k][row]] : [...new Set(strips[k])]));
    for (const a of cells[0]) for (const b of cells[1]) for (const c of cells[2]) {
      if (matchesFlag(evalLine(a, b, c, payout), flag)) return true;
    }
  }
  return false;
}

export class Slot {
  /**
   * cfg: config.js の slot。rng: 0 以上 1 未満の乱数(検査で差し替える)。
   */
  constructor(cfg, rng = Math.random, strips = STRIPS) {
    this.cfg = cfg;
    this.rng = rng;
    this.strips = strips;
    this.bet = cfg.bets[cfg.bets.length - 1];
    this.bonus = null;            // { kind: 'big' | 'reg', left: 残り回数 }
    this.flag = null;             // この回の役
    this.positions = [null, null, null];
    this.spinning = false;
    this.lastResult = null;
    this.stats = { spins: 0, totalBet: 0, totalWin: 0, bestWin: 0, bigs: 0, regs: 0 };
  }

  get lines() { return LINES_FOR_BET[this.bet] ?? 1; }
  get allStopped() { return this.positions.every((p) => p !== null); }

  setBet(b) { if (!this.spinning && this.cfg.bets.includes(b)) this.bet = b; }

  /** 役の抽選。いまの状態(通常 / BONUS 中)の確率表から 1 つ選ぶ。 */
  drawFlag() {
    const table = this.bonus ? this.cfg.bonus[this.bonus.kind].table : this.cfg.table;
    let r = this.rng();
    for (const [role, p] of Object.entries(table)) {
      if (r < p) {
        if (role === 'same') return { role, digit: 1 + Math.floor(this.rng() * 9) };
        return { role };
      }
      r -= p;
    }
    return null;
  }

  /** START。賭け金を払えるときだけ回る。返り値: { ok, bet, flag(検査用), notice }。notice は予告ランプ。 */
  start(coins) {
    if (this.spinning) return { ok: false, reason: 'spinning' };
    if (coins < this.bet) return { ok: false, reason: 'coins' };
    // BONUS の役は揃えるまで持ち越す(本物と同じ)。小役は 1 回限り
    const carried = this.flag && (this.flag.role === 'big' || this.flag.role === 'reg') && this.lastResult && this.lastResult.missed;
    this.flag = carried ? this.flag : this.drawFlag();
    this.carried = !!carried;
    this.positions = [null, null, null];
    this.spinning = true;
    this.lastResult = null;
    this.stats.spins += 1;
    this.stats.totalBet += this.bet;
    // 予告: BONUS の役なら高い確率で光る。役が無くてもたまに光る(ガセ)
    const n = this.cfg.notice;
    const isBonus = this.flag && (this.flag.role === 'big' || this.flag.role === 'reg');
    const notice = isBonus ? this.rng() < n.onBonus : this.rng() < n.fake;
    return { ok: true, bet: this.bet, notice: notice || this.carried, lines: this.lines, carried: this.carried };
  }

  /**
   * リール k を、押した位置 pressed(中段のコマ番号)で止める。引き込みを入れた停止位置を返す。
   * 返り値: { pos, slip, result }。result は 3 本目を止めたときだけ(evaluate の結果 + 払い戻し + BONUS の変化)。
   */
  stop(k, pressed) {
    if (!this.spinning || this.positions[k] !== null) return null;
    const n = this.strips[k].length;
    // 引き込みの範囲は役ごと(小役は広く、BONUS と同じ数字は目押しが要る)
    const pull = this.pullInFor(this.flag);
    const candidates = [];
    for (let s = 0; s <= pull; s++) candidates.push({ slip: s, pos: (pressed + s) % n });
    const lines = this.lines, payout = this.cfg.payout;
    const others = this.positions.filter((p, i) => i !== k && p === null).length;   // まだ止まっていない他のリール
    const trial = (pos) => { const ps = this.positions.slice(); ps[k] = pos; return ps; };

    let pick = null;
    if (this.flag) {
      // 役あり: 最後のリールなら成立する位置のうち手前。手前のリールなら、残りのリールで揃う見込みが最も高い位置
      const ok = candidates.filter((c) => flagPossible(trial(c.pos), lines, this.flag, payout, this.strips));
      if (ok.length && others !== 1) pick = ok[0];        // 最初のリール(残り 2 本)は計算が重いので手前でよい
      else if (ok.length) {
        let best = -1;
        for (const c of ok) {
          const cov = coverage(trial(c.pos), lines, this.flag, payout, this.strips, pull);
          if (cov > best + 1e-9) { best = cov; pick = c; }
        }
      }
    }
    if (!pick && others === 0) {
      // 最後のリール: 役以外が揃わない位置(役の取りこぼし・役なしのとき)。無ければ仕方なく手前
      pick = candidates.find((c) => evaluate(trial(c.pos), lines, payout, this.strips).total === 0);
    }
    if (!pick) pick = candidates[0];
    this.positions[k] = pick.pos;

    let result = null;
    if (this.allStopped) result = this.settle();
    return { pos: pick.pos, slip: pick.slip, result };
  }

  /** 役ごとの引き込みの範囲(コマ数)。 */
  pullInFor(flag) {
    const p = this.cfg.pullIn;
    if (typeof p === 'number') return p;
    return (flag && p[flag.role]) ?? p.default;
  }

  /** 3 本止まった: 払い戻しと BONUS の進行。 */
  settle() {
    const ev = evaluate(this.positions, this.lines, this.cfg.payout, this.strips);
    const win = ev.total * this.bet;
    const flag = this.flag;
    const missed = !!flag && !ev.wins.some((w) => matchesFlag(w, flag));   // 取りこぼし
    const events = [];
    this.stats.totalWin += win;
    this.stats.bestWin = Math.max(this.stats.bestWin, win);
    // BONUS の開始・進行・終了
    let bonusStart = null, bonusEnd = null;
    if (this.bonus) {
      this.bonus.left -= 1;
      if (this.bonus.left <= 0) { bonusEnd = this.bonus.kind; this.bonus = null; }
    }
    for (const w of ev.wins) {
      if ((w.role === 'big' || w.role === 'reg') && !this.bonus) {
        this.bonus = { kind: w.role, left: this.cfg.bonus[w.role].games };
        bonusStart = w.role;
        if (w.role === 'big') this.stats.bigs += 1; else this.stats.regs += 1;
      }
    }
    this.spinning = false;
    this.lastResult = { wins: ev.wins, win, bet: this.bet, flag, missed, bonusStart, bonusEnd, bonus: this.bonus ? { ...this.bonus } : null, windows: ev.windows, events };
    return this.lastResult;
  }

  toJSON() { return { stats: this.stats, bonus: this.bonus, bet: this.bet }; }
  restore(data) {
    if (!data) return;
    if (data.stats) this.stats = { ...this.stats, ...data.stats };
    if (data.bonus) this.bonus = data.bonus;
    if (this.cfg.bets.includes(data.bet)) this.bet = data.bet;
  }
}

/**
 * 払い戻し率の見積もり(検査と調整用)。press は押す位置の決め方:
 *   'random' … 毎回でたらめな位置で押す(目押しなし)
 *   'perfect' … 役が成立する位置を知っていて、必ず引き込み範囲で押す(目押しが完璧)
 */
export function simulate(cfg, spins = 20000, press = 'random', rng = Math.random, bet = 5) {
  const slot = new Slot(cfg, rng);
  slot.setBet(bet);
  let coins = 1e9;
  const start = coins;
  for (let i = 0; i < spins; i++) {
    const r = slot.start(coins);
    if (!r.ok) break;
    coins -= slot.bet;
    for (let k = 0; k < 3; k++) {
      const n = slot.strips[k].length;
      let pressed = Math.floor(rng() * n);
      if (press === 'perfect' && slot.flag) {
        // 引き込み範囲のどこかに役の位置が入るような押し位置を探す
        const pull = slot.pullInFor(slot.flag);
        for (let p = 0; p < n; p++) {
          const ok = (() => {
            for (let s = 0; s <= pull; s++) {
              const ps = slot.positions.slice(); ps[k] = (p + s) % n;
              if (flagPossible(ps, slot.lines, slot.flag, cfg.payout, slot.strips)) return true;
            }
            return false;
          })();
          if (ok) { pressed = p; break; }
        }
      }
      const st = slot.stop(k, pressed);
      if (st.result) coins += st.result.win;
    }
  }
  return { rtp: slot.stats.totalWin / slot.stats.totalBet, stats: slot.stats, net: coins - start };
}
