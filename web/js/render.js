// 画面の描き直し(DOM)。Board は <button class="cell"> の格子、HUD は数字と記号。
// 「状態 → 見た目」の一方向だけ。入力の処理は main.js。

import { WIDTH } from './rules.js';
import { heatColor } from './fx.js';
import { sightLines } from './scoring.js';

export class Renderer {
  constructor(root) {
    this.root = root;
    this.$ = (id) => root.querySelector('#' + id);
    this.board = this.$('board');
    this.boardWrap = this.$('board-wrap');
    this.fitCells();
    addEventListener('resize', () => { this.fitCells(); this.alignGrid(); });
    this.boardWrap?.addEventListener('scroll', () => this.alignGrid(), { passive: true });
  }

  // 背景の格子を Board のマスに合わせる(1 マス + 隙間 を周期にし、線が隙間の真ん中に来るよう原点をずらす)
  alignGrid() {
    if (this._alignPending) return;
    this._alignPending = true;
    // HUD やお題の帯が同じフレームで変わることがあるので、レイアウトが決まってから測る
    requestAnimationFrame(() => {
      this._alignPending = false;
      const r = this.board.getBoundingClientRect();
      const rs = document.documentElement.style;
      rs.setProperty('--grid-x', `${r.left}px`);
      rs.setProperty('--grid-y', `${r.top}px`);
    });
  }

  // 画面幅から 1 マスの大きさを決める(9 列が収まる最大、ただし 56px まで)
  // 数字の大きさはマスの 62%(style.css)。幅 390px のスマホならマス 37px・数字 23px になる。
  fitCells() {
    const gutter = 12 * 2, gap = 4 * (WIDTH - 1);
    const avail = Math.min(innerWidth, 520) - gutter - gap;
    const size = Math.max(30, Math.min(56, Math.floor(avail / WIDTH)));
    document.documentElement.style.setProperty('--cell', size + 'px');
  }

  setHeat(heat) {
    document.documentElement.style.setProperty('--heat', heatColor(heat));
    document.documentElement.style.setProperty('--glow', heat.toFixed(2));
  }

  // Score 表示の中心座標(得点が飛んでいく先)
  scoreCenter() {
    const r = this.$('hud-score').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Board 全体を作り直す。selected / hintPair / flash / scope の見た目もここで付ける。
  renderBoard(board, { selected = null, hintPair = null, flashPairs = null, scopeTile = null, addedFrom = null } = {}) {
    const flashSet = new Set();
    if (flashPairs) for (const [a, b] of flashPairs) { flashSet.add(a); flashSet.add(b); }
    const sight = selected !== null && board[selected] ? sightLines(board, selected) : null;
    const raySet = new Set(sight?.ray), reachSet = new Set(sight?.reach);
    const frag = document.createDocumentFragment();
    board.forEach((c, p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cell' + (c === 0 ? ' empty' : '');
      el.dataset.pos = String(p);
      el.textContent = c === 0 ? '' : String(c);
      el.setAttribute('role', 'gridcell');
      if (c === 0) el.tabIndex = -1;
      if (selected === p) el.classList.add('selected');
      if (raySet.has(p)) el.classList.add('ray');
      if (reachSet.has(p)) el.classList.add('reach');
      if (hintPair && (hintPair[0] === p || hintPair[1] === p)) el.classList.add('hint');
      if (flashSet.has(p)) el.classList.add('flash');
      if (scopeTile === p) el.classList.add('scope');
      if (addedFrom !== null && p >= addedFrom) {
        el.classList.add('added');
        el.style.animationDelay = `${Math.min(0.6, (p - addedFrom) * 0.012)}s`;
      }
      frag.appendChild(el);
    });
    this.board.replaceChildren(frag);
    this.alignGrid();
  }

  cellEl(pos) { return this.board.querySelector(`.cell[data-pos="${pos}"]`); }

  // マスの中心座標(演出の発生位置に使う)
  cellCenter(pos) {
    const el = this.cellEl(pos);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  rowRect(rowIndex) {
    const el = this.cellEl(rowIndex * WIDTH);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { y: r.top, h: r.height };
  }

  // 選んだマスを伸び縮みさせる(squash & stretch)。board を渡すと視線も示す
  selectCell(pos, board = null) {
    const el = this.cellEl(pos);
    if (!el) return;
    el.classList.remove('selected', 'squash'); void el.offsetWidth;
    el.classList.add('selected', 'squash');
    this.clearSight();
    if (board) {
      const { ray, reach } = sightLines(board, pos);
      for (const p of ray) this.cellEl(p)?.classList.add('ray');
      for (const p of reach) this.cellEl(p)?.classList.add('reach');
    }
  }

  // 視線の表示(ray / reach)を消す
  clearSight() {
    for (const el of this.board.querySelectorAll('.cell.ray, .cell.reach')) el.classList.remove('ray', 'reach');
  }

  // 消えるマスにクラスを付ける(アニメ後に renderBoard で作り直す)
  markRemoving(i, j) {
    for (const p of [i, j]) this.cellEl(p)?.classList.add('removing');
  }
  markRowsRemoving(rowIndices) {
    for (const r of rowIndices) {
      for (let p = r * WIDTH; p < (r + 1) * WIDTH; p++) this.cellEl(p)?.classList.add('removing');
    }
  }
  shakeCell(pos) {
    const el = this.cellEl(pos);
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  renderHud(game, now = Date.now()) {
    const run = game.run, st = game.stage, def = game.stageDef;
    if (!run || !st || !def) return;
    this.$('hud-stage-label').textContent = `STAGE ${String(def.stage).padStart(2, '0')}`;
    this.$('hud-world-label').textContent = `world ${game.worldOf(run.stageIndex) + 1} · ${def.cellsCount} cells${game.classic ? ' · classic' : ''}`;
    this.$('hud-score').textContent = run.score.toLocaleString('en-US');
    // CLASSIC に Chain・Heart は無い
    this.$('hud-chain').hidden = game.classic;
    this.$('hud-lives').hidden = game.classic;
    this.$('hud-mult').textContent = `×${game.multiplier.toFixed(1)}`;
    this.$('hud-chain-fill').style.width = `${Math.round(game.heat * 100)}%`;
    this.setHeat(game.heat);
    this.renderGauge(game, now);
    this.renderFever(game, now);
    this.renderLives(run.lives, game.cfg.lives.max);
    this.renderAddButton(st.addsLeft, st.addsTotal ?? def.adds);
    this.renderHintButton(game);
  }

  // HINT ボタン。Chain 倍率で HINT / FLASH / SCOPE に変わり、残り使用回数を点で示す
  renderHintButton(game) {
    const st = game.stage, tier = game.hintTier;
    const btn = this.$('btn-hint'), label = this.$('btn-hint-label'), sub = this.$('btn-hint-sub');
    btn.classList.remove('tier-hint', 'tier-flash', 'tier-scope');
    btn.classList.add(`tier-${tier}`);
    label.textContent = tier.toUpperCase();
    if (game.inFever) { sub.textContent = `FEVER 時間 −${game.cfg.fever.hintTimeCostMs / 1000} 秒`; btn.disabled = false; return; }
    const dots = [];
    for (let k = 0; k < game.cfg.hint.perStage; k++) dots.push(`<span class="dot${k < st.hintsLeft ? '' : ' off'}"></span>`);
    sub.innerHTML = `<span class="stock">${dots.join('')}</span>`;
    btn.disabled = st.hintsLeft <= 0;
  }

  // Chain ゲージ(時間で減る)。満タンから空になるまでの残り
  renderGauge(game, now) {
    const ratio = game.gaugeRatio(now);
    const fill = this.$('hud-gauge-fill');
    fill.style.width = `${Math.round(ratio * 100)}%`;
    fill.classList.toggle('low', ratio > 0 && ratio < 0.35 && !game.inFever);
  }

  renderFever(game, now) {
    const box = this.$('hud-fever');
    const on = game.inFever;
    box.hidden = !on;
    document.body.classList.toggle('fever', on);
    if (on) this.$('hud-fever-fill').style.width = `${Math.round(game.feverRatio(now) * 100)}%`;
  }

  // お題の帯(HUD の下)。進み具合と達成・失敗を示す
  renderQuest(quest) {
    const box = this.$('hud-quest');
    if (!box) return;
    if (!quest) { box.hidden = true; return; }
    box.hidden = false;
    box.classList.toggle('done', !!quest.done);
    box.classList.toggle('failed', !!quest.failed);
    const prog = quest.target > 1 ? ` ${Math.min(quest.progress, quest.target)}/${quest.target}` : '';
    this.$('hud-quest-text').textContent = `${quest.text}${prog}`;
    this.$('hud-quest-mark').textContent = quest.done ? '✓' : quest.failed ? '✗' : '';
  }

  renderLives(lives, max, { lost = false, gained = false } = {}) {
    const box = this.$('hud-lives');
    const hearts = [];
    for (let k = 0; k < max; k++) {
      const on = k < lives;
      let cls = 'heart' + (on ? '' : ' off');
      if (lost && k === lives) cls += ' lost';
      if (gained && k === lives - 1) cls += ' gain';
      hearts.push(`<span class="${cls}">♥</span>`);
    }
    box.innerHTML = hearts.join('');
  }

  // ADD ボタン。Add が尽きたら GIVE UP に変わる
  renderAddButton(left, total) {
    const btn = this.$('btn-add');
    const label = this.$('btn-add-label');
    const sub = this.$('add-stock');
    if (left <= 0) {
      btn.classList.remove('ctl-primary'); btn.classList.add('ctl-danger');
      label.textContent = 'GIVE UP';
      sub.textContent = 'Heart −1 · 得点は半分残る';
    } else {
      btn.classList.add('ctl-primary'); btn.classList.remove('ctl-danger');
      label.textContent = '＋ ADD';
      const dots = [];
      for (let k = 0; k < total; k++) dots.push(`<span class="dot${k < left ? '' : ' off'}"></span>`);
      sub.innerHTML = `<span class="stock">${dots.join('')}</span>`;
    }
    btn.disabled = false;
  }

  bumpScore() {
    const el = this.$('hud-score');
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  toast(text, ms = 1800) {
    const el = this.$('toast');
    el.textContent = text; el.hidden = false; el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---------- オーバーレイ ----------
  showOverlay(html) {
    const ov = this.$('overlay');
    this.$('overlay-card').innerHTML = html;
    ov.hidden = false;
    return this.$('overlay-card');
  }
  hideOverlay() { this.$('overlay').hidden = true; }

  // Star を順番に出す
  animateStars(card, count) {
    const stars = card.querySelectorAll('.star');
    stars.forEach((s, k) => {
      setTimeout(() => { s.classList.add('show'); if (k < count) s.classList.add('on'); }, 250 + k * 260);
    });
  }
}
