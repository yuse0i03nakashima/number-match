// 効果音(WebAudio で合成。音源ファイルなし)。
// 方針: 耳に刺さる矩形波は使わず、三角波・正弦波に短い減衰をつけた「楽器っぽい」音にする。
// 消したときの音はペンタトニック(ド レ ミ ソ ラ)をチェーン数で上っていくので、連鎖が旋律になる。

// 長音階(ドレミファソラシド)。Chain が 1 つ上がるごとに 1 音上がり、8 連鎖で 1 オクターブ上のドに戻る。
const MAJOR = [0, 2, 4, 5, 7, 9, 11];        // 半音の並び(C メジャー)
const C4 = 261.6256;                          // 中央のド(A4 = 440 Hz の平均律)

function noteFreq(index) {
  const octave = Math.floor(index / MAJOR.length);
  const semi = MAJOR[((index % MAJOR.length) + MAJOR.length) % MAJOR.length] + 12 * octave;
  return C4 * Math.pow(2, semi / 12);
}

export class Sound {
  constructor(volume = 0.35) {
    this.volume = volume;
    this.ctx = null;
    this.master = null;
    this.enabled = this.loadEnabled();
  }

  loadEnabled() {
    try { return localStorage.getItem('numbermatch.sound') !== 'off'; } catch { return true; }
  }
  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('numbermatch.sound', on ? 'on' : 'off'); } catch { /* 無視 */ }
  }

  // AudioContext はユーザー操作の後でないと鳴らせない。最初のタップで作る。
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // ごく薄い残響(ディレイ)を足して、乾いた電子音にしない
    const delay = this.ctx.createDelay(0.5); delay.delayTime.value = 0.16;
    const fb = this.ctx.createGain(); fb.gain.value = 0.22;
    const wet = this.ctx.createGain(); wet.gain.value = 0.25;
    // 出口のコンプレッサー(音が重なっても割れないように)
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(this.ctx.destination);
    this.master.connect(comp);
    this.master.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(comp);
    return true;
  }

  // 1 音。type=波形、dur=長さ(秒)、gain=音量、attack/decay=立ち上がり・減衰
  tone(freq, { type = 'triangle', dur = 0.25, gain = 0.5, attack = 0.005, when = 0, detune = 0, lowpass = 4000 } = {}) {
    if (!this.enabled || !this.ensure()) return;
    const ctx = this.ctx, t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(filt); filt.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.3, gain = 0.3, from = 400, to = 2400, when = 0 } = {}) {
    if (!this.enabled || !this.ensure()) return;
    const ctx = this.ctx, t0 = ctx.currentTime + when;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.Q.value = 0.8;
    filt.frequency.setValueAtTime(from, t0); filt.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t0);
  }

  // ---------- 場面ごとの音 ----------
  select() { this.tone(880, { type: 'sine', dur: 0.08, gain: 0.18 }); }
  deselect() { this.tone(660, { type: 'sine', dur: 0.06, gain: 0.12 }); }

  // 消した: チェーン数で音階を上る。2 音重ねて厚みを出す。
  remove(chain, heat = 0) {
    const idx = Math.min(chain - 1, 14);               // ド(1 連鎖)から 2 オクターブ上のド(15 連鎖)まで
    const f = noteFreq(idx);
    this.tone(f, { type: 'triangle', dur: 0.32, gain: 0.5, lowpass: 3000 + heat * 3000 });
    this.tone(f * 2, { type: 'sine', dur: 0.18, gain: 0.12 });
    this.noise({ dur: 0.05, gain: 0.05, from: 1500, to: 600 });
  }

  // 行が消えた: 和音をアルペジオで。連続(streak)で消すほど構成音が増え、音域も上がる
  rowClear(count = 1, streak = 0) {
    const base = 7 + Math.min(count, 3) + Math.min(streak, 4);        // 1 オクターブ上のドから
    const voicing = [0, 2, 4, 7, 9, 11, 14].slice(0, 4 + Math.min(streak, 3));   // ド ミ ソ ド' (ラ シ ミ')
    voicing.forEach((k, n) => {
      this.tone(noteFreq(base + k), { type: 'triangle', dur: 0.55 + streak * 0.05, gain: 0.42, when: n * 0.045 });
      if (streak >= 2) this.tone(noteFreq(base + k) / 2, { type: 'sine', dur: 0.6, gain: 0.18, when: n * 0.045 });
    });
    this.noise({ dur: 0.35 + streak * 0.05, gain: 0.18 + streak * 0.03, from: 300, to: 3000 });
  }

  // Chain が時間で 1 つ減った: 低く短い音
  chainDecay() { this.tone(noteFreq(1) / 2, { type: 'sine', dur: 0.15, gain: 0.14, lowpass: 900 }); }

  feverStart() {
    [0, 2, 4, 7, 9, 11, 14].forEach((k, n) => this.tone(noteFreq(7 + k), { type: 'triangle', dur: 0.5, gain: 0.35, when: n * 0.06 }));
    this.noise({ dur: 0.8, gain: 0.25, from: 200, to: 4000 });
  }
  feverEnd() {
    [11, 9, 7].forEach((k, n) => this.tone(noteFreq(k), { type: 'sine', dur: 0.4, gain: 0.25, when: n * 0.12 }));
  }
  giveUp() { [5, 3].forEach((k, n) => this.tone(noteFreq(k), { type: 'triangle', dur: 0.5, gain: 0.3, when: n * 0.2, lowpass: 1200 })); }

  invalid() { this.tone(110, { type: 'sine', dur: 0.12, gain: 0.25, lowpass: 600 }); }

  add() { this.noise({ dur: 0.45, gain: 0.25, from: 200, to: 1800 }); this.tone(noteFreq(2), { type: 'sine', dur: 0.3, gain: 0.2, when: 0.1 }); }

  flash() { [7, 9, 11, 14].forEach((k, n) => this.tone(noteFreq(k), { type: 'sine', dur: 0.12, gain: 0.22, when: n * 0.05 })); }
  scope() { this.tone(noteFreq(14), { type: 'sine', dur: 0.5, gain: 0.25 }); this.tone(noteFreq(14) * 1.5, { type: 'sine', dur: 0.5, gain: 0.12, when: 0.1 }); }
  scopeMiss() { this.tone(noteFreq(0) / 2, { type: 'triangle', dur: 0.25, gain: 0.3, lowpass: 700 }); }
  hint() { this.tone(noteFreq(7), { type: 'sine', dur: 0.2, gain: 0.25 }); this.tone(noteFreq(9), { type: 'sine', dur: 0.3, gain: 0.25, when: 0.12 }); }

  stageClear() {
    [0, 2, 4, 5, 7, 9].forEach((k, n) => this.tone(noteFreq(k + 5), { type: 'triangle', dur: 0.6, gain: 0.4, when: n * 0.09 }));
    this.tone(noteFreq(15), { type: 'triangle', dur: 1.2, gain: 0.35, when: 0.6 });
    this.tone(noteFreq(10), { type: 'sine', dur: 1.2, gain: 0.25, when: 0.6 });
  }

  perfect() { [10, 12, 14, 15, 17].forEach((k, n) => this.tone(noteFreq(k), { type: 'sine', dur: 0.5, gain: 0.3, when: 0.9 + n * 0.07 })); }

  fail() {
    [8, 6, 3].forEach((k, n) => this.tone(noteFreq(k) * 0.944, { type: 'triangle', dur: 0.6, gain: 0.35, when: n * 0.18, lowpass: 1500 }));
  }

  runOver() {
    [6, 4, 1, 0].forEach((k, n) => this.tone(noteFreq(k) * 0.944, { type: 'triangle', dur: 0.9, gain: 0.35, when: n * 0.25, lowpass: 1200 }));
  }

  lifeGain() { [9, 12, 14].forEach((k, n) => this.tone(noteFreq(k), { type: 'sine', dur: 0.35, gain: 0.3, when: n * 0.08 })); }

  stuck() { this.tone(noteFreq(3), { type: 'sine', dur: 0.25, gain: 0.2 }); this.tone(noteFreq(1), { type: 'sine', dur: 0.35, gain: 0.2, when: 0.15 }); }
}

// 振動(Android の Chrome など対応端末のみ)
export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* 無視 */ }
}
