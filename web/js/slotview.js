// スロットの画面(DOM と回転のアニメ)。判断は slot.js、Coin の出し入れは game.js。
//
// リールは「中段のコマ番号」を小数で持ち、毎フレーム進める。止めるときは slot.stop() が決めた位置まで
// 回してから止める(引き込みのぶんだけ滑って見える)。

import { PALETTE } from './fx.js';
import { LINES } from './slot.js';

const SYMBOL_TEXT = { T: 'TEN', S: '★' };
const ROLE_TEXT = { big: 'BIG BONUS', reg: 'REG BONUS', same: 'TRIPLE', ten: 'TEN!', pairStar: 'PAIR ★' };

export class SlotView {
  constructor(root, { slot, game, fx, sound, onMenu, onBet, vibrate }) {
    this.onBet = onBet;
    this.root = root;
    this.slot = slot;
    this.game = game;
    this.fx = fx;
    this.sound = sound;
    this.onMenu = onMenu;
    this.vibrate = vibrate ?? (() => {});
    this.$ = (id) => root.querySelector('#' + id);
    this.active = false;
    this.busy = false;                               // 払い戻しの演出中
    this.reels = [0, 1, 2].map((k) => ({
      el: root.querySelector(`[data-reel="${k}"]`),
      strip: root.querySelector(`#strip-${k}`),
      cells: [],
      pos: 0, state: 'stopped', target: null, bounce: 0,
    }));
    for (const r of this.reels) {
      r.strip.innerHTML = '';
      for (let i = 0; i < 5; i++) { const c = document.createElement('div'); c.className = 'sym'; r.strip.appendChild(c); r.cells.push(c); }
      r.el.addEventListener('pointerdown', () => this.stop(this.reels.indexOf(r)));
    }
    root.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('pointerdown', () => this.stop(Number(b.dataset.stop))));
    this.$('slot-start').onclick = () => this.start();
    this.$('slot-bet').onclick = () => this.cycleBet();
    this.$('slot-menu').onclick = () => this.onMenu?.();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    this.renderAll();
  }

  get cfg() { return this.slot.cfg; }
  get n() { return this.slot.strips[0].length; }

  enter() { this.active = true; this.root.hidden = false; this.renderAll(); document.body.classList.add('slot'); document.body.classList.toggle('fever', !!this.slot.bonus); }
  leave() { this.active = false; this.root.hidden = true; document.body.classList.remove('fever', 'slot'); }

  // ---------- 表示 ----------
  renderAll() {
    this.$('slot-coins').textContent = this.game.coins.toLocaleString('en-US');
    this.$('slot-bet').innerHTML = `<span class="ctl-label">BET ${this.slot.bet.toLocaleString('en-US')}</span><span class="ctl-sub">${this.slot.lines} line${this.slot.lines > 1 ? 's' : ''} · タップで変更</span>`;
    const canStart = !this.slot.spinning && !this.busy && this.game.coins >= this.slot.bet;
    this.$('slot-start').disabled = !canStart;
    this.$('slot-start').querySelector('.ctl-sub').textContent = this.game.coins < this.slot.bet ? 'Coin が足りない' : this.slot.bonus ? 'BONUS 中' : '';
    this.root.querySelectorAll('[data-stop]').forEach((b, k) => { b.disabled = !(this.slot.spinning && this.reels[k].state === 'spinning'); });
    const bonus = this.$('slot-bonus');
    bonus.hidden = !this.slot.bonus;
    if (this.slot.bonus) {
      this.$('slot-bonus-label').textContent = this.slot.bonus.kind === 'big' ? 'BIG BONUS' : 'REG BONUS';
      this.$('slot-bonus-left').textContent = `あと ${this.slot.bonus.left} 回`;
    }
    const s = this.slot.stats;
    this.$('slot-stats').textContent = `回転 ${s.spins} · 当たり ${s.hits ?? 0} · BIG ${s.bigs} · REG ${s.regs} · 最高 ${s.bestWin.toLocaleString('en-US')}`;
    this.drawReels();
  }

  drawReels() {
    this.root.classList.toggle('spinning', this.reels.some((r) => r.state !== 'stopped'));
    const n = this.n;
    for (let k = 0; k < 3; k++) {
      const r = this.reels[k], strip = this.slot.strips[k];
      const base = Math.floor(r.pos), frac = r.pos - base;
      // 5 コマ(中段の 2 つ上〜2 つ下)を描き、端数ぶんだけずらす
      for (let i = 0; i < 5; i++) {
        const idx = ((base + i - 2) % n + n) % n;
        const sym = strip[idx];
        const c = r.cells[i];
        if (c.dataset.sym !== sym) { c.dataset.sym = sym; c.textContent = SYMBOL_TEXT[sym] ?? sym; c.classList.toggle('t', sym === 'T'); c.classList.toggle('s', sym === 'S'); }
      }
      const cellH = r.el.clientHeight / 3 || 64;        // リールの枠はちょうど 3 コマ分の高さ
      const bounce = r.bounce > 0 ? Math.sin(r.bounce * Math.PI) * 6 : 0;
      r.strip.style.transform = `translateY(${(-cellH) + frac * -cellH + bounce}px)`;
      r.el.classList.toggle('spinning', r.state !== 'stopped');
    }
  }

  // ---------- 操作 ----------
  cycleBet() {
    if (this.slot.spinning || this.busy) return;
    this.sound.select();
    if (this.onBet) { this.onBet(); return; }
    const bets = this.cfg.bets;
    this.slot.setBet(bets[(bets.indexOf(this.slot.bet) + 1) % bets.length]);
    this.renderAll();
  }

  // 停止ごとの手応えと、2 本止まったときのリーチ
  reelCenter(k) { const r = this.reels[k].el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
  onReelStopped(k) {
    const c = this.reelCenter(k);
    this.fx.shake(this.reels[k].el, 3, 140);
    this.fx.burst(c.x, c.y + c.h / 2, { color: PALETTE.blue, count: 10, power: 0.6, size: 2, spread: Math.PI, angle: -Math.PI / 2 });
    const reach = this.slot.reach();
    if (reach.length && this.reels.filter((r) => r.state !== 'stopped').length === 1) {
      // リーチ: 残りのリールを光らせ、文字と音で煽る
      const last = this.reels.find((r) => r.state !== 'stopped');
      last.el.classList.add('reach');
      const big = reach.includes('big') || reach.includes('reg');
      const lc = this.reelCenter(this.reels.indexOf(last));
      this.fx.floatText(lc.x, lc.y - lc.h / 2 - 16, big ? 'REACH!!' : 'REACH', { color: big ? PALETTE.rose : PALETTE.amber, size: big ? 30 : 22, dy: -30, life: 1.2 });
      this.fx.ring(lc.x, lc.y, big ? PALETTE.rose : PALETTE.amber, 90);
      if (big) this.fx.flash('rgba(240,98,146,0.14)');
      this.sound.slotReach(big);
      this.vibrate(big ? [30, 40, 60] : [20, 30]);
    }
  }
  clearReach() { for (const r of this.reels) r.el.classList.remove('reach'); }

  start() {
    if (this.busy) return;
    const r = this.slot.start(this.game.coins);
    if (!r.ok) { if (r.reason === 'coins') this.sound.invalid(); return; }
    this.game.addCoins(-r.bet);
    this.clearHits(); this.clearReach();
    this.$('slot-win').textContent = '0';
    this.$('slot-win').classList.remove('pop', 'big');
    for (const reel of this.reels) { reel.state = 'spinning'; reel.target = null; reel.bounce = 0; }
    this.$('slot-lamp').classList.toggle('on', !!r.notice);
    if (r.notice) { this.sound.slotLamp(); this.vibrate([20, 40, 20]); }
    this.sound.slotStart();
    this.vibrate(15);
    this.renderAll();
  }

  stop(k) {
    const reel = this.reels[k];
    if (!this.slot.spinning || reel.state !== 'spinning') return;
    const pressed = ((Math.round(reel.pos) % this.n) + this.n) % this.n;
    const res = this.slot.stop(k, pressed);
    if (!res) return;
    reel.state = 'stopping';
    reel.target = res.pos;
    reel.pendingResult = res.result;             // 3 本目なら、止まり切ったあとに払い戻し
    this.sound.slotStop();
    this.vibrate(10);
    this.renderAll();
  }

  // ---------- 毎フレーム ----------
  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (this.active) this.update(dt);
    requestAnimationFrame((tt) => this.loop(tt));
  }

  update(dt) {
    const speed = 1000 / this.cfg.spinStepMs;     // コマ / 秒
    const n = this.n;
    let changed = false;
    for (const reel of this.reels) {
      if (reel.state === 'spinning') { reel.pos = (reel.pos + speed * dt) % n; changed = true; }
      else if (reel.state === 'stopping') {
        const remain = ((reel.target - reel.pos) % n + n) % n;
        const step = speed * dt;
        if (remain <= step + 1e-6) {
          reel.pos = reel.target; reel.state = 'stopped'; reel.bounce = 1;
          this.drawReels();
          this.onReelStopped(this.reels.indexOf(reel));
          if (reel.pendingResult) { const res = reel.pendingResult; reel.pendingResult = null; this.settle(res); }
          this.renderAll();
        } else reel.pos = (reel.pos + step) % n;
        changed = true;
      }
      if (reel.bounce > 0) { reel.bounce = Math.max(0, reel.bounce - dt * 4); changed = true; }
    }
    if (changed) this.drawReels();
  }

  // ---------- 払い戻し ----------
  async settle(res) {
    this.busy = true;
    this.$('slot-lamp').classList.remove('on');
    this.clearReach();
    if (res.win > 0) {
      const w = res.wins.reduce((m, x) => (x.pay > (m?.pay ?? 0) ? x : m), null);
      const level = w.role === 'big' || w.role === 'reg' ? 2 : w.role === 'same' || w.role === 'ten' ? 1 : 0;
      const color = level === 2 ? PALETTE.rose : level === 1 ? PALETTE.amber : PALETTE.green;
      // ヒットストップ → 揃ったラインを光の線でなぞり、各コマで爆ぜ、画面がふくらむ
      this.fx.freeze(60 + level * 40);
      await sleep(70 + level * 40);
      this.markHits(w.line);
      const rows = LINES[w.line];
      const pts = rows.map((row, k) => { const c = this.reelCenter(k); return { x: c.x, y: c.y + (row - 1) * (c.h / 3) }; });
      this.fx.flashLine(pts[0].x, pts[0].y, pts[2].x, pts[2].y, color, 4 + level * 3);
      this.fx.trail(pts[0].x, pts[0].y, pts[2].x, pts[2].y, PALETTE.white, 20 + level * 10);
      for (const p of pts) this.fx.burst(p.x, p.y, { color, count: 18 + level * 16, power: 1.1 + level * 0.4, size: 3 + level });
      const rc = this.root.querySelector('#reels').getBoundingClientRect();
      const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      this.fx.rowSweep(pts[1].y - rc.height / 6, rc.height / 3, color);
      this.fx.ring(cx, cy, color, 120 + level * 70);
      this.fx.shake(this.root.querySelector('#reels'), 4 + level * 4, 200 + level * 100);
      this.fx.floatText(cx, cy - 20, ROLE_TEXT[w.role] ?? w.role, { color, size: 30 + level * 10, dy: -40, life: 1.6 });
      this.fx.floatText(cx, cy + 24, `+${res.win.toLocaleString('en-US')}`, { color: PALETTE.white, size: 22 + level * 6, dy: -30, life: 1.6 });
      if (level >= 1) { this.fx.flash(level === 2 ? 'rgba(240,98,146,0.3)' : 'rgba(245,166,35,0.2)'); this.fx.fireworks(1 + level * 2); }
      this.root.classList.remove('punch'); void this.root.offsetWidth; this.root.classList.add('punch');
      this.sound.slotWin(level);
      const winEl = this.$('slot-win');
      winEl.classList.remove('pop', 'big'); void winEl.offsetWidth; winEl.classList.add('pop');
      if (level === 2) winEl.classList.add('big');
      this.$('cabinet').classList.add('win');
      this.vibrate(level === 2 ? [60, 40, 60, 40, 150] : [30, 30, 40]);
      // Coin を数えながら足す
      const total = res.win;
      const steps = Math.min(20, total);
      for (let i = 1; i <= steps; i++) {
        const part = Math.round((total * i) / steps) - Math.round((total * (i - 1)) / steps);
        this.game.addCoins(part);
        this.$('slot-win').textContent = Math.round((total * i) / steps).toLocaleString('en-US');
        this.$('slot-coins').textContent = this.game.coins.toLocaleString('en-US');
        if (i % 3 === 0) { this.sound.coin(i); this.fx.sparks(this.$('slot-coins').getBoundingClientRect().left + 20, this.$('slot-coins').getBoundingClientRect().top + 10, PALETTE.amber, 4); }
        await sleep(level === 2 ? 70 : 40);
      }
    } else if (res.missed) {
      this.$('slot-win').textContent = 'こぼし';
    }
    if (res.bonusStart) {
      // BONUS 開始: 一瞬止めて、白く光り、花火と大きな文字。BONUS 中は FEVER と同じ見た目
      this.fx.freeze(160);
      await sleep(180);
      this.fx.flash('rgba(255,255,255,0.5)');
      this.sound.slotBonus();
      this.vibrate([80, 60, 80, 60, 200]);
      this.fx.fireworks(res.bonusStart === 'big' ? 12 : 6);
      this.fx.floatText(innerWidth / 2, innerHeight * 0.35, res.bonusStart === 'big' ? 'BIG BONUS' : 'REG BONUS', { color: PALETTE.rose, size: res.bonusStart === 'big' ? 48 : 40, dy: -40, life: 2.2 });
      this.fx.floatText(innerWidth / 2, innerHeight * 0.35 + 50, `${this.cfg.bonus[res.bonusStart].games} 回転の高確率`, { color: PALETTE.white, size: 16, dy: -30, life: 2.0 });
      document.body.classList.add('fever');
      this.fx.shake(this.root, 8, 500);
      await sleep(1100);
      this.fx.fireworks(4);
    }
    if (res.bonusEnd) {
      document.body.classList.remove('fever');
      this.fx.floatText(innerWidth / 2, innerHeight * 0.35, 'BONUS 終了', { color: PALETTE.white, size: 20, dy: -30, life: 1.4 });
    }
    this.game.slotStats = this.slot.toJSON();
    this.game.save();
    this.$('cabinet').classList.remove('win');
    this.busy = false;
    this.renderAll();
  }

  markHits(line) {
    const LINES = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
    LINES[line].forEach((row, k) => this.reels[k].cells[row + 1]?.classList.add('hit'));
  }
  clearHits() { for (const r of this.reels) for (const c of r.cells) c.classList.remove('hit'); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
