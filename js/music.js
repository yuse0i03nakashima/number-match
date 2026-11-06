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
// 2 曲目「sweet」(World ごとに切り替える。THE ROOMS と同じ曲):
//   参考 2 曲(案山子「真生活」、Dyolow「ROCK PAPER SCISSORS!」)の共通点を借りた、
//   アップテンポで甘く、どこか切ない曲。BPM 140、8 小節
//   IVmaj7 → III7 → vi7 → I7 → IVmaj7 → V → iii7 → II7(III7 と II7 が切なさ、IVmaj7 と I7 が甘さ)
//   層 1: 四つ打ち・2 と 4 のスネア・8 分ハット・808 風ベース・プラックの和音・パッド
//   層 2: 旋律   層 3: 高いベルと 16 分のハット連打   層 4 / FEVER: 旋律を 1 オクターブ上でも重ね、16 分ハット
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

// ---------- 2 曲目「sweet」の素材 ----------
// コード進行は主音からの半音で持つ(III7 や II7 のように、音階に無い音を含むため)
const SWEET_PROGRESSION = [
  { degree: 5, kind: 'maj7' },   // IVmaj7
  { degree: 4, kind: '7' },      // III7   (切ない: 音階の外の長 3 度)
  { degree: 9, kind: 'm7' },     // vi7
  { degree: 0, kind: '7' },      // I7     (属七。IV へ戻る甘さ)
  { degree: 5, kind: 'maj7' },   // IVmaj7
  { degree: 7, kind: 'maj' },    // V
  { degree: 4, kind: 'm7' },     // iii7
  { degree: 2, kind: '7' },      // II7    (V7/ii。ここも切ない)
];
const SWEET_INTERVALS = { maj7: [0, 4, 7, 11], maj: [0, 4, 7, 12], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10] };
function buildSweetChords(tonic) {
  return SWEET_PROGRESSION.map(({ degree, kind }) => {
    const root = tonic - 12 + degree;
    return { root, notes: SWEET_INTERVALS[kind].map((i) => root + i) };
  });
}
// 旋律: [8 小節通しの 16 分の位置, 主音からの半音, 長さ(16 分の数)]。基準は主音の 1 オクターブ上
// 毎小節同じリズムのフックを繰り返し、3 つ目の長い音にその小節の和音の特徴音を置く。音域は 12〜24(高い)
const SWEET_MELODY = [
  // 1 小節目 IVmaj7
  [0, 16, 2], [2, 19, 1], [3, 21, 3], [6, 19, 2], [8, 16, 2], [10, 14, 2], [12, 16, 4],
  // 2 小節目 III7(20 が音階の外の長 3 度、23 が 7 度)
  [16, 20, 2], [18, 19, 1], [19, 16, 3], [22, 14, 2], [24, 16, 2], [26, 20, 2], [28, 23, 4],
  // 3 小節目 vi7
  [32, 24, 2], [34, 23, 1], [35, 21, 3], [38, 19, 2], [40, 21, 2], [42, 24, 2], [44, 21, 4],
  // 4 小節目 I7(22 が短 7 度。IV へ戻る)
  [48, 19, 2], [50, 21, 1], [51, 22, 3], [54, 19, 2], [56, 16, 4], [60, 14, 2], [62, 16, 2],
  // 5 小節目 IVmaj7(1 小節目と同じフック)
  [64, 16, 2], [66, 19, 1], [67, 21, 3], [70, 19, 2], [72, 16, 2], [74, 14, 2], [76, 16, 4],
  // 6 小節目 V
  [80, 19, 2], [82, 21, 1], [83, 23, 3], [86, 19, 2], [88, 16, 2], [90, 14, 2], [92, 19, 4],
  // 7 小節目 iii7
  [96, 23, 2], [98, 21, 1], [99, 19, 3], [102, 16, 2], [104, 14, 2], [106, 16, 2], [108, 19, 4],
  // 8 小節目 II7(18 が音階の外の長 3 度。14 で終えて 1 小節目の 16 へ上がる)
  [112, 18, 2], [114, 21, 1], [115, 24, 3], [118, 21, 2], [120, 18, 2], [122, 16, 2], [124, 14, 4],
];
const SWEET_MELODY_LEN = 8 * 16;
// やわらかい歪み(tanh)。808 風ベースの倍音用
function makeSoftCurve() {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.2); }
  return curve;
}

export class Music {
  constructor(cfg) {
    this.cfg = cfg;                     // { volume, tonic?, bpm? }
    this.tonic = cfg.tonic ?? 60;       // 60 = C
    this.bpm = cfg.bpm ?? 124;
    this.stepSec = 60 / this.bpm / 4;   // 16 分音符 1 つの秒数
    this.song = 'dance';                // 'dance'(元の曲) | 'sweet'(2 曲目)。切り替えは小節の頭
    this.pendingSong = null;
    this.sweetBpm = cfg.sweetBpm ?? 150;
    this.chords = buildChords(this.tonic);
    this.penta = buildPenta(this.tonic);
    this.ctx = null;
    this.heat = 0;
    this.fever = false;
    this.ducked = false;
    this.enabled = true;
    this.playing = false;
    this.layers = 0;                    // いま鳴らしている層の数(小節の頭で heat から決める)
    this.calm = null;                   // CLASSIC モードの設定 { bpm, maxLayers, volume, feverCalm }。null なら通常
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

  // CLASSIC モードの入り切り。テンポは次の小節の頭から変わる(途中で変えると拍がよれる)
  setCalm(settings) {
    this.calm = settings;
    this.pendingBpm = this.bpmFor(this.song);
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
    const base = this.song === 'sweet' ? 6500 : 3500;
    const cutoff = base * Math.pow(13000 / base, heat);
    this.lowpass.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.8);
    this.updateMaster(0.8);
  }
  setFever(on) { this.fever = on; }

  // 曲を選ぶ。鳴っている最中なら次の小節の頭で切り替える(拍を崩さない)
  setSong(name) {
    if (name !== 'dance' && name !== 'sweet') return;
    if (name === this.song && !this.pendingSong) return;
    if (this.playing) { this.pendingSong = name; return; }
    this.applySong(name);
  }
  bpmFor(song) {
    if (this.calm) return this.calm.bpm;
    return song === 'sweet' ? this.sweetBpm : (this.cfg.bpm ?? 124);
  }
  applySong(name) {
    this.song = name;
    this.pendingSong = null;
    this.chords = name === 'sweet' ? buildSweetChords(this.tonic) : buildChords(this.tonic);
    this.pendingBpm = this.bpmFor(name);
    if (!this.playing) { this.bpm = this.pendingBpm; this.stepSec = 60 / this.bpm / 4; this.pendingBpm = null; }
    if (this.ctx) { const h = this.heat; this.heat = -1; this.setHeat(h); }
  }
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
        if (this.pendingSong) this.applySong(this.pendingSong);
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

  playBar(t, bar) { if (this.song === 'sweet') this.playBarSweet(t, bar); else this.playBarDance(t, bar); }
  playStep(t, bar, s) { if (this.song === 'sweet') this.playStepSweet(t, bar, s); else this.playStepDance(t, bar, s); }

  // ---------- 2 曲目 sweet ----------
  playBarSweet(t, bar) {
    const chord = this.chordAt(bar);
    const barLen = this.stepSec * STEPS_PER_BAR;
    for (const m of chord.notes) {
      for (const det of [-6, 6]) {
        this.tone({ t, freq: mtof(m + 12), type: 'triangle', detune: det, dur: barLen * 1.02, gain: 0.028, attack: 0.3, release: 0.5, cutoff: 2800 });
      }
    }
    if (this.fever && !(this.calm && this.calm.feverCalm)) {
      this.lowpass.frequency.cancelScheduledValues(t);
      this.lowpass.frequency.setValueAtTime(5000, t);
      this.lowpass.frequency.exponentialRampToValueAtTime(15000, t + barLen * 0.5);
      this.lowpass.frequency.exponentialRampToValueAtTime(6500, t + barLen);
    }
  }

  playStepSweet(t, bar, s) {
    const chord = this.chordAt(bar);
    const L = this.layers;
    const v = chord.notes;
    const wild = this.fever && !(this.calm && this.calm.feverCalm);

    // ドラム: 四つ打ち、2・4 拍にスネア、8 分のハイハット。層 3 からは 2 小節に 1 回 16 分の連打。FEVER は 16 分
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    const roll = L >= 3 && bar % 2 === 1 && s >= 13;
    if (s % 2 === 0 || roll || wild) this.hat(t, roll ? 0.07 : s % 4 === 2 ? 0.1 : 0.06, s === 14 && !roll);

    // 808 風のベース: 音の頭で上から滑り込む
    const bassAt = { 0: 6, 6: 2, 8: 4, 12: 2, 14: 2 };
    if (bassAt[s]) {
      const m = chord.root - 12 + (s === 14 ? 12 : s === 12 ? 7 : 0);
      this.bass808(t, mtof(m), this.stepSec * bassAt[s], s === 0 ? 1.5 : 1.12);
    }

    // プラックの和音: 裏で刻むシンコペーション
    const stabs = { 0: 0.13, 3: 0.1, 6: 0.12, 10: 0.1, 12: 0.08, 14: 0.11 };
    if (stabs[s]) {
      for (const [i, m] of v.entries()) this.pluck(t + i * 0.005, mtof(m + 12), stabs[s] * (i === 0 ? 0.6 : 1));
    }

    // 旋律(層 2〜)。層 4 / FEVER では 1 オクターブ上でも重ねる
    if (L >= 2) {
      const pos = (bar * STEPS_PER_BAR + s) % SWEET_MELODY_LEN;
      const note = SWEET_MELODY.find((n) => n[0] === pos);
      if (note) {
        const m = this.tonic + 12 + note[1];
        const dur = this.stepSec * note[2] * 0.9;
        const rel = Math.min(0.16, dur * 0.4);
        this.tone({ t, freq: mtof(m), type: 'triangle', dur, gain: 0.15, attack: 0.004, release: rel, cutoff: 7000 });
        this.tone({ t, freq: mtof(m), type: 'square', detune: -5, dur, gain: 0.07, attack: 0.006, release: rel, cutoff: 3600, toDelay: true });
        this.tone({ t, freq: mtof(m), type: 'sawtooth', detune: 7, dur, gain: 0.05, attack: 0.006, release: rel, cutoff: 4200 });
        if (L >= 4) this.tone({ t, freq: mtof(m + 12), type: 'triangle', dur, gain: 0.07, attack: 0.008, release: Math.min(0.18, dur * 0.4), cutoff: 6000, toDelay: true });
      }
    }
    // 高いベル(層 3〜): 16 分の 1・5・9・13 に和音の音を上から順に
    if (L >= 3 && s % 4 === 1) {
      const m = v[(3 - Math.floor(s / 4)) % v.length] + 24;
      this.tone({ t, freq: mtof(m), type: 'sine', dur: this.stepSec * 1.6, gain: 0.055, attack: 0.002, release: 0.14, cutoff: 9000, toDelay: true });
    }
  }

  // プラック: のこぎり波のフィルタを一気に閉じる(明るい立ち上がり、短い余韻)
  pluck(t, freq, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + this.stepSec * 1.6);
    osc.connect(f); f.connect(g); g.connect(this.lowpass);
    osc.start(t); osc.stop(t + this.stepSec * 1.7);
  }

  // 808 風ベース: 正弦波を上から滑り込ませ、少し歪ませて倍音を足す
  bass808(t, freq, dur, slide) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * slide, t); osc.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
    const shaper = ctx.createWaveShaper(); shaper.curve = this.softCurve ?? (this.softCurve = makeSoftCurve());
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    g.gain.setValueAtTime(0.5, t + Math.max(0.01, dur - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const out = ctx.createGain(); out.gain.value = 0.42;
    osc.connect(g); g.connect(shaper); shaper.connect(out); out.connect(this.drumBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // ---------- 1 曲目 dance ----------
  // 小節単位の音: パッド
  playBarDance(t, bar) {
    const chord = this.chordAt(bar);
    const barLen = this.stepSec * STEPS_PER_BAR;
    for (const m of chord.notes) {
      // 2 本を少しずらしてコーラス感。1 オクターブ上も重ねて、スマホのスピーカーでも聞こえる帯域にする
      for (const det of [-6, 6]) {
        this.tone({ t, freq: mtof(m), type: 'sawtooth', detune: det, dur: barLen, gain: 0.07, attack: 0.5, release: 0.8, cutoff: 2200 });
        this.tone({ t, freq: mtof(m + 12), type: 'triangle', detune: det * 0.5, dur: barLen, gain: 0.05, attack: 0.7, release: 0.8, cutoff: 4000 });
      }
    }
    // FEVER: 小節ごとにフィルタが開いて閉じる(CLASSIC では開閉しない)
    if (this.fever && !(this.calm && this.calm.feverCalm)) {
      this.lowpass.frequency.cancelScheduledValues(t);
      this.lowpass.frequency.setValueAtTime(3000, t);
      this.lowpass.frequency.exponentialRampToValueAtTime(14000, t + barLen * 0.5);
      this.lowpass.frequency.exponentialRampToValueAtTime(4000, t + barLen);
    }
  }

  // 16 分単位の音
  playStepDance(t, bar, s) {
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
    // FEVER のポンプ: キックのたびに全体を凹ませて戻す(サイドチェインの代わり)。CLASSIC ではしない
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
