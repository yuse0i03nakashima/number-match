// 演出(全画面 Canvas に粒子・光の線・浮き文字を描く)。
// ゲームの判断には一切関わらない。main.js がイベントを見て呼ぶだけ。
//
// 仕組み: particles 配列に「位置・速度・寿命・色」を持つ小さな物体を入れ、
// requestAnimationFrame で毎フレーム動かして描く。寿命が尽きたら配列から外す。

export const PALETTE = {
  blue: '#5b8ff9', green: '#3ecf8e', amber: '#f5a623', rose: '#f06292', red: '#ef4444', purple: '#a78bfa', white: '#dde1ec',
};

// 熱(0〜1)→ 色。青 → 橙 → 薔薇 → 赤。チェーンが上がるほど熱くなる。
export function heatColor(heat) {
  const stops = [
    [0.0, [91, 143, 249]],
    [0.4, [245, 166, 35]],
    [0.75, [240, 98, 146]],
    [1.0, [239, 68, 68]],
  ];
  const t = Math.max(0, Math.min(1, heat));
  for (let k = 1; k < stops.length; k++) {
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * u));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(239,68,68)';
}

export class FX {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = config;
    this.particles = [];
    this.floats = [];
    this.lines = [];
    this.sweeps = [];
    this.rings = [];
    this.flies = [];
    this.frozenUntil = 0;     // ヒットストップ: この時刻まで粒子を止める
    this.last = performance.now();
    this.resize();
    addEventListener('resize', () => this.resize());
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.floor(innerWidth * dpr);
    this.canvas.height = Math.floor(innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- 発生 ----------
  burst(x, y, { color = PALETTE.blue, count = 18, power = 1, size = 3, spread = Math.PI * 2, angle = 0 } = {}) {
    const room = this.cfg.maxParticles - this.particles.length;
    count = Math.max(0, Math.min(count, room));
    for (let k = 0; k < count; k++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const sp = (120 + Math.random() * 260) * power;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * power,
        life: 0.5 + Math.random() * 0.5, age: 0, size: size * (0.6 + Math.random() * 0.8),
        color, gravity: 520, drag: 0.9, shape: Math.random() < 0.3 ? 'rect' : 'dot',
        spin: (Math.random() - 0.5) * 12, rot: Math.random() * Math.PI,
      });
    }
  }

  sparks(x, y, color, count = 10) {
    this.burst(x, y, { color, count, power: 0.6, size: 2 });
  }

  // 2 点を結ぶ光の線(一瞬で消える)
  flashLine(x1, y1, x2, y2, color = PALETTE.blue, width = 3) {
    this.lines.push({ x1, y1, x2, y2, color, width, life: 0.35, age: 0 });
  }

  // 浮き上がる文字(得点など)
  floatText(x, y, text, { color = PALETTE.white, size = 18, dy = -70, life = 0.9 } = {}) {
    this.floats.push({ x, y, text, color, size, vy: dy, life, age: 0 });
  }

  // 行が消えるときの横一閃
  rowSweep(y, height, color = PALETTE.amber) {
    this.sweeps.push({ y, height, color, life: 0.45, age: 0 });
  }

  ring(x, y, color = PALETTE.blue, radius = 60) {
    this.rings.push({ x, y, color, radius, life: 0.5, age: 0 });
  }

  // ステージクリアの花火(複数回に分けて打ち上げる)
  fireworks(count = 6) {
    const colors = [PALETTE.blue, PALETTE.green, PALETTE.amber, PALETTE.rose, PALETTE.purple];
    for (let k = 0; k < count; k++) {
      setTimeout(() => {
        const x = innerWidth * (0.15 + Math.random() * 0.7);
        const y = innerHeight * (0.2 + Math.random() * 0.4);
        const color = colors[k % colors.length];
        this.burst(x, y, { color, count: 70, power: 1.4, size: 3 });
        this.ring(x, y, color, 90);
      }, k * 220);
    }
  }

  // ヒットストップ: ms の間だけ粒子と浮き文字の動きを止める(描画は続ける)。
  // 大きな出来事の直前に一瞬止めると、止まった分だけ「重さ」が出る。
  freeze(ms) {
    this.frozenUntil = Math.max(this.frozenUntil, performance.now() + ms);
  }

  // 文字が (x, y) から (tx, ty) へ飛んでいく(得点がスコア表示へ吸い込まれる演出)。
  flyText(x, y, tx, ty, text, { color = PALETTE.white, size = 16, dur = 0.45, delay = 0 } = {}) {
    this.flies.push({ x, y, tx, ty, text, color, size, dur, age: -delay });
  }

  // 画面(要素)を揺らす。intensity は px。
  shake(el, intensity = 3, duration = 220) {
    if (!el) return;
    const start = performance.now();
    const tick = (t) => {
      const u = (t - start) / duration;
      if (u >= 1) { el.style.transform = ''; return; }
      const k = intensity * (1 - u);
      el.style.transform = `translate(${(Math.random() - 0.5) * 2 * k}px, ${(Math.random() - 0.5) * 2 * k}px)`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // 画面全体を一瞬明るくする(大きな出来事用)
  flash(color = 'rgba(255,255,255,0.18)') {
    this.flashColor = color; this.flashAge = 0;
  }

  // ---------- 毎フレーム ----------
  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.update(dt);
    this.draw();
    requestAnimationFrame((tt) => this.loop(tt));
  }

  update(dt) {
    if (performance.now() < this.frozenUntil) return;   // ヒットストップ中は何も動かさない
    for (const f of this.flies) f.age += dt;
    this.flies = this.flies.filter((f) => f.age < f.dur);
    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const f of this.floats) { f.age += dt; f.y += f.vy * dt; f.vy *= 0.97; }
    this.floats = this.floats.filter((f) => f.age < f.life);
    for (const l of this.lines) l.age += dt;
    this.lines = this.lines.filter((l) => l.age < l.life);
    for (const s of this.sweeps) s.age += dt;
    this.sweeps = this.sweeps.filter((s) => s.age < s.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    if (this.flashColor !== undefined) { this.flashAge += dt; if (this.flashAge > 0.18) this.flashColor = undefined; }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    if (this.flashColor) {
      ctx.globalAlpha = 1 - this.flashAge / 0.18;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sweeps) {
      const u = s.age / s.life;
      ctx.globalAlpha = (1 - u) * 0.55;
      const g = ctx.createLinearGradient(0, 0, innerWidth, 0);
      g.addColorStop(0, 'transparent'); g.addColorStop(Math.min(1, u * 1.2), s.color); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, s.y, innerWidth, s.height);
    }
    for (const l of this.lines) {
      const u = l.age / l.life;
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = l.color; ctx.lineWidth = l.width * (1 - u * 0.5); ctx.lineCap = 'round';
      ctx.shadowColor = l.color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    for (const r of this.rings) {
      const u = r.age / r.life;
      ctx.globalAlpha = (1 - u) * 0.8;
      ctx.strokeStyle = r.color; ctx.lineWidth = 3 * (1 - u) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.radius * (0.2 + u * 0.8), 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of this.particles) {
      const u = p.age / p.life;
      ctx.globalAlpha = 1 - u * u;
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - u * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const f of this.flies) {
      if (f.age < 0) continue;
      const u = f.age / f.dur, e = u * u * (3 - 2 * u);           // なめらかに加速・減速
      const x = f.x + (f.tx - f.x) * e, y = f.y + (f.ty - f.y) * e - Math.sin(u * Math.PI) * 30;
      ctx.globalAlpha = 1 - u * 0.3;
      ctx.font = `500 ${f.size * (1 - u * 0.4)}px "DM Mono", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
    }
    for (const f of this.floats) {
      const u = f.age / f.life;
      ctx.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      ctx.font = `500 ${f.size}px "DM Mono", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(12,13,17,0.9)';
      ctx.fillText(f.text, f.x + 1, f.y + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }
}
