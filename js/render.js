// 画面の描き直し(DOM)。盤面は <button class="cell"> の格子、HUD は数字と記号。
// 「状態 → 見た目」の一方向だけ。入力の処理は main.js。

import { WIDTH } from './rules.js';
import { heatColor } from './fx.js';

export class Renderer {
  constructor(root) {
    this.root = root;
    this.$ = (id) => root.querySelector('#' + id);
    this.board = this.$('board');
    this.boardWrap = this.$('board-wrap');
    this.fitCells();
    addEventListener('resize', () => this.fitCells());
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
  }

  // 盤面全体を作り直す。selected / hintPair の見た目もここで付ける。
  renderBoard(board, { selected = null, hintPair = null, addedFrom = null } = {}) {
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
      if (hintPair && (hintPair[0] === p || hintPair[1] === p)) el.classList.add('hint');
      if (addedFrom !== null && p >= addedFrom) {
        el.classList.add('added');
        el.style.animationDelay = `${Math.min(0.6, (p - addedFrom) * 0.012)}s`;
      }
      frag.appendChild(el);
    });
    this.board.replaceChildren(frag);
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

  renderHud(game) {
    const run = game.run, st = game.stage, def = game.stageDef;
    if (!run || !st || !def) return;
    this.$('hud-stage-label').textContent = `STAGE ${String(def.stage).padStart(2, '0')}`;
    this.$('hud-world-label').textContent = `world ${game.worldOf(run.stageIndex) + 1} · ${def.cellsCount} cells`;
    this.$('hud-score').textContent = run.score.toLocaleString('en-US');
    this.$('hud-mult').textContent = `×${game.multiplier.toFixed(1)}`;
    this.$('hud-chain-fill').style.width = `${Math.round(game.heat * 100)}%`;
    this.setHeat(game.heat);
    this.renderLives(run.lives, game.cfg.lives.max);
    this.renderStock(st.addsLeft, def.adds);
    this.$('btn-add').disabled = st.addsLeft <= 0;
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

  renderStock(left, total) {
    const dots = [];
    for (let k = 0; k < total; k++) dots.push(`<span class="dot${k < left ? '' : ' off'}"></span>`);
    this.$('add-stock').innerHTML = `<span class="stock">${dots.join('')}</span>`;
  }

  bumpScore() {
    const el = this.$('hud-score');
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  urgeAdd(on) { this.$('btn-add').classList.toggle('urge', on); }

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

  // 星を順番に出す
  animateStars(card, count) {
    const stars = card.querySelectorAll('.star');
    stars.forEach((s, k) => {
      setTimeout(() => { s.classList.add('show'); if (k < count) s.classList.add('on'); }, 250 + k * 260);
    });
  }
}
