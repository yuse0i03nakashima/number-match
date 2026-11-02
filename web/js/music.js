// 生成 BGM(音源ファイルを使わず、WebAudio で合成する電子音の曲)。
//
// ねらい: Chain の熱に合わせて「層」を足し引きし、切り替えは必ず小節の頭で行う。
//   こうすると熱が上がったときのつながりが音楽的になる(拍を外した瞬間の音色変化や、音程のゆらぎが無い)。
//   調は C メジャー(A マイナー)。効果音(audio.js)の連鎖の音階と同じなので、消したときの音と調和する。
//
// 構成(BPM 124、4 分の 4、4 小節のコード進行 Am → F → C → G を繰り返す):
//   層 0(熱 0〜)       パッド(コードの持続音)+ まばらな撥弦
//   層 1(熱 0.25〜)    キックとハイハット(8 分)
//   層 2(熱 0.5〜)     ベース(8 分でルート音、オクターブ跳び)
//   層 3(熱 0.75〜)    アルペジオのリード(16 分)+ エコー
//   FEVER              全層 + ハイハット 16 分 + スネア + リードを 1 オクターブ上 + フィルタの開閉 + キックに合わせた音量のポンプ
//
// 時間の管理は「先読みスケジューラ」(Chris Wilson, A Tale of Two Clocks):
//   setInterval で 50ms ごとに起き、AudioContext の時計で 0.2 秒先までの音を予約する。
//   JavaScript のタイマーのゆれが音のタイミングに出ない。

const STEPS_PER_BAR = 16;

// 音名 → 周波数(A4 = 440)。midi 番号で扱う
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 調(長調の主音の midi 番号。C4 = 60)と BPM は設定で変えられる。
// 既定の C メジャーは効果音の音階と同じ。参考曲の解析結果(docs/05)を入れると、その曲に寄せた響きになる。
// コード進行は度数で持ち、主音から組み立てる: vi → IV → I → V(Am → F → C → G の形)
const PROGRESSION = [
  { degree: 9, minor: true },    // vi
  { degree: 5, minor: false },   // IV
  { degree: 0, minor: false },   // I
  { degree: 7, minor: false },   // V
];
const PENTA_DEGREES = [0, 2, 4, 7, 9];   // 長音階のペンタトニック

function buildChords(tonic) {
  return PROGRESSION.map(({ degree, minor }) => {
    const root = tonic - 12 + degree;                  // 主音の 1 オクターブ下から
    const third = root + (minor ? 3 : 4);
    return { root, notes: [root, third, root + 7] };
  });
}
function buildPenta(tonic) {
  const out = [];
  for (let oct = 0; oct < 2; oct++) for (const d of PENTA_DEGREES) out.push(tonic + 12 * oct + d);
  return out;
}

export class Music {
  constructor(cfg) {
    this.cfg = cfg;                     // { volume, tonic?, bpm? }
    this.tonic = cfg.tonic ?? 60;       // 60 = C
    this.bpm = cfg.bpm ?? 124;
    this.stepSec = 60 / this.bpm / 4;   // 16 分音符 1 つの秒数
    this.chords = buildChords(this.tonic);
    this.penta = buildPenta(this.tonic);
    this.ctx = null;
    this.heat = 0;
    this.fever = false;
    this.ducked = false;
    this.enabled = true;
    this.playing = false;
    this.layers = 0;                    // いま鳴らしている層の数(小節の頭で heat から決める)
    this.calm = null;                   // Relax モードの設定 { bpm, maxLayers, volume, feverCalm }。null なら通常
    this.pendingBpm = null;             // 次の小節の頭から適用するテンポ
    this.step = 0;                      // 次に予約する 16 分の番号(曲の頭から通し)
    this.nextTime = 0;                  // その 16 分の時刻
    this.timer = null;
  }

  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.pump = ctx.createGain(); this.pump.gain.value = 1;        // キックに合わせて凹ませる
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 3500; this.lowpass.Q.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 8; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = 0.5;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    // リード用のエコー
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = this.stepSec * 3;   // 付点 8 分
    this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.35;
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.3;
    this.delay.connect(this.delayFb); this.delayFb.connect(this.delay); this.delay.connect(this.delayOut); this.delayOut.connect(this.lowpass);
    // ドラムはフィルタを通さない(抜けを保つ)
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 1;
    this.drumBus.connect(this.pump);
    this.lowpass.connect(this.pump);
    this.pump.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    // ハイハット・スネア用のノイズを 1 秒ぶん作っておく
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) { this.enabled = on; this.updateMaster(); }

  play() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.layers = this.layersFor(this.heat);
    this.master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.updateMaster(1.5);
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stop(fade = 1.0) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.0001, t, fade / 4);
  }

  layersFor(heat) {
    const cap = this.calm ? this.calm.maxLayers : 4;
    if (this.fever && !(this.calm && this.calm.feverCalm)) return Math.min(4, cap);
    const n = heat >= 0.75 ? 4 : heat >= 0.5 ? 3 : heat >= 0.25 ? 2 : 1;
    return Math.min(n, cap);
  }

  // Relax モードの入り切り。テンポは次の小節の頭から変わる(途中で変えると拍がよれる)
  setCalm(settings) {
    this.calm = settings;
    this.pendingBpm = settings ? settings.bpm : (this.cfg.bpm ?? 124);
    this.updateMaster(0.8);
  }

  targetVolume() {
    if (!this.enabled) return 0.0001;
    const base = this.calm ? this.calm.volume : this.cfg.volume;
    return Math.max(0.0001, base * (0.9 + this.heat * 0.2) * (this.ducked ? 0.35 : 1));
  }
  updateMaster(tc = 0.5) {
    if (!this.master || !this.playing) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.targetVolume(), t, tc / 3);
  }

  // 熱。層の数は次の小節の頭で変わる。フィルタだけは滑らかに追従する
  setHeat(heat) {
    heat = Math.max(0, Math.min(1, heat));
    if (Math.abs(heat - this.heat) < 0.005 && this.ctx) return;
    this.heat = heat;
    if (!this.ctx) return;
    const cutoff = 3500 * Math.pow(12000 / 3500, heat);
    this.lowpass.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.8);
    this.updateMaster(0.8);
  }
  setFever(on) { this.fever = on; }
  duck(on) { if (this.ducked !== on) { this.ducked = on; this.updateMaster(0.5); } }

  level() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteFrequencyData(this.bins);
    let sum = 0;
    const n = Math.min(20, this.bins.length);
    for (let i = 0; i < n; i++) sum += this.bins[i];
    return Math.min(1, sum / n / 190);
  }

  // ---------- スケジューラ ----------
  schedule() {
    const ahead = this.ctx.currentTime + 0.2;
    while (this.nextTime < ahead) {
      const s = this.step % STEPS_PER_BAR;
      const bar = Math.floor(this.step / STEPS_PER_BAR);
      if (s === 0) {
        if (this.pendingBpm !== null) { this.bpm = this.pendingBpm; this.stepSec = 60 / this.bpm / 4; this.delay.delayTime.setValueAtTime(this.stepSec * 3, this.nextTime); this.pendingBpm = null; }
        this.layers = this.layersFor(this.heat);     // 層の切り替えは小節の頭だけ
        this.playBar(this.nextTime, bar);
      }
      this.playStep(this.nextTime, bar, s);
      this.nextTime += this.stepSec;
      this.step += 1;
    }
  }

  chordAt(bar) { return this.chords[bar % this.chords.length]; }

  // 小節単位の音: パッド
  playBar(t, bar) {
    const chord = this.chordAt(bar);
    const barLen = this.stepSec * STEPS_PER_BAR;
    for (const m of chord.notes) {
      // 2 本を少しずらしてコーラス感。1 オクターブ上も重ねて、スマホのスピーカーでも聞こえる帯域にする
      for (const det of [-6, 6]) {
        this.tone({ t, freq: mtof(m), type: 'sawtooth', detune: det, dur: barLen, gain: 0.07, attack: 0.5, release: 0.8, cutoff: 2200 });
        this.tone({ t, freq: mtof(m + 12), type: 'triangle', detune: det * 0.5, dur: barLen, gain: 0.05, attack: 0.7, release: 0.8, cutoff: 4000 });
      }
    }
    // FEVER: 小節ごとにフィルタが開いて閉じる(Relax では開閉しない)
    if (this.fever && !(this.calm && this.calm.feverCalm)) {
      this.lowpass.frequency.cancelScheduledValues(t);
      this.lowpass.frequency.setValueAtTime(3000, t);
      this.lowpass.frequency.exponentialRampToValueAtTime(14000, t + barLen * 0.5);
      this.lowpass.frequency.exponentialRampToValueAtTime(4000, t + barLen);
    }
  }

  // 16 分単位の音
  playStep(t, bar, s) {
    const chord = this.chordAt(bar);
    const L = this.layers;
    const onBeat = s % 4 === 0, offBeat = s % 4 === 2;

    // 撥弦(層 0〜): 拍ごとに、コード構成音のペンタトニックから
    if (s % 4 === 1 || (s % 8 === 6 && L >= 2) || (s % 8 === 3 && L === 1)) {
      const pool = this.penta.filter((m) => chord.notes.some((c) => (m - c) % 12 === 0)).concat(chord.notes.map((c) => c + 12));
      const m = pool[(bar * 7 + s * 3) % pool.length];
      this.tone({ t, freq: mtof(m), type: 'triangle', dur: 0.35, gain: 0.2, attack: 0.004, release: 0.3, cutoff: 6000 });
    }
    // 層 0 でも裏拍に小さなハイハット(拍の手がかり)
    if (L === 1 && offBeat) this.hat(t, 0.035);

    // ドラム(層 1〜)
    if (L >= 2) {
      if (onBeat) this.kick(t);
      const wild = this.fever && !(this.calm && this.calm.feverCalm);
      if (wild || L >= 4 ? true : offBeat) this.hat(t, s % 4 === 2 ? 0.14 : 0.08, wild && s % 8 === 6);
      if (wild && (s === 4 || s === 12)) this.snare(t);
    }

    // ベース(層 2〜): 8 分。3 拍目の裏でオクターブ上
    if (L >= 3 && s % 2 === 0) {
      const m = chord.root - 12 + (s === 10 || s === 14 ? 12 : 0);
      this.tone({ t, freq: mtof(m), type: 'sawtooth', dur: this.stepSec * 1.8, gain: 0.22, attack: 0.005, release: 0.08, cutoff: 500 + this.heat * 900 });
    }

    // リードのアルペジオ(層 3〜): 16 分。FEVER では 1 オクターブ上
    if (L >= 4) {
      const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
      const notes = chord.notes.map((c) => c + 12 + (this.fever ? 12 : 0));
      const m = notes[pattern[s % 8]] + (s >= 8 && bar % 2 === 1 ? 2 : 0) * 0;
      const g = (s % 4 === 0 ? 0.13 : 0.09) * (this.fever ? 1.15 : 1);
      this.tone({ t, freq: mtof(m), type: 'square', dur: this.stepSec * 0.9, gain: g, attack: 0.003, release: 0.08, cutoff: 3500, toDelay: true });
    }
  }

  // ---------- 楽器 ----------
  tone({ t, freq, type, detune = 0, dur, gain, attack, release, cutoff, toDelay = false }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f); f.connect(g); g.connect(this.lowpass);
    if (toDelay) g.connect(this.delay);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  kick(t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g); g.connect(this.drumBus);
    osc.start(t); osc.stop(t + 0.35);
    // FEVER のポンプ: キックのたびに全体を凹ませて戻す(サイドチェインの代わり)。Relax ではしない
    if (this.fever && !(this.calm && this.calm.feverCalm)) {
      this.pump.gain.cancelScheduledValues(t);
      this.pump.gain.setValueAtTime(0.55, t);
      this.pump.gain.linearRampToValueAtTime(1, t + this.stepSec * 3);
    }
  }

  hat(t, gain, open = false) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain();
    const dur = open ? 0.25 : 0.05;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.drumBus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  snare(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f); f.connect(g); g.connect(this.drumBus);
    src.start(t); src.stop(t + 0.2);
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t); osc.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.4, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g2); g2.connect(this.drumBus); osc.start(t); osc.stop(t + 0.15);
  }
}
