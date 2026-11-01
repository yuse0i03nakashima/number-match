// BGM。mp3 をブラウザで読み込み、Chain の熱と FEVER に合わせて加工しながら流す。
// 加工はすべて WebAudio のノードで行う(ファイルを事前に作り直さない)。
//
//   source(通常曲) ─┐
//                    ├─ lowpass ─ drive ─ gain ─ (出力)
//   source(FEVER 曲)─┘
//
//   熱が低い: こもった音(lowpass 低め)、小さめ、再生速度 1.0
//   熱が高い: 抜けた音、少し大きく、速く(最大 +6%)、歪みをわずかに足す
//   FEVER:    FEVER 曲へクロスフェード、さらに速く、エコーを足す
//
// 音量の変化は setTargetAtTime で滑らかにし、曲の切り替えはクロスフェードで行う。
// 画面側は analyser から拍の強さ(0〜1)を読み、背景の格子を音に合わせて脈打たせる。

export class Bgm {
  constructor(cfg) {
    this.cfg = cfg;                // { volume, tracks: { normal, fever }, enabled の保存キー }
    this.ctx = null;
    this.buffers = {};
    this.players = {};             // name → { source, gain }
    this.current = null;           // 流れている曲の名前
    this.enabled = this.loadEnabled();
    this.heat = 0;
    this.loading = null;
  }

  loadEnabled() {
    try { return localStorage.getItem('numbermatch.bgm') !== 'off'; } catch { return true; }
  }
  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('numbermatch.bgm', on ? 'on' : 'off'); } catch { /* 無視 */ }
    if (this.master) this.master.gain.setTargetAtTime(on ? this.cfg.volume : 0, this.ctx.currentTime, 0.3);
  }

  // AudioContext はユーザー操作のあとで渡される(audio.js と共有する)
  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 900;
    this.lowpass.Q.value = 0.7;
    // 歪み(熱が上がるとカーブをきつくする)
    this.drive = ctx.createWaveShaper();
    this.setDrive(0);
    // FEVER 用のエコー
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.28;
    this.delayGain = ctx.createGain();
    this.delayGain.gain.value = 0;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.35;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.cfg.volume : 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.6;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);

    this.lowpass.connect(this.drive);
    this.drive.connect(this.master);
    this.drive.connect(this.delay);
    this.delay.connect(this.feedback); this.feedback.connect(this.delay);
    this.delay.connect(this.delayGain); this.delayGain.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  // 歪みのカーブ。amount 0 で素通し、1 でかなり歪む
  setDrive(amount) {
    const n = 256, curve = new Float32Array(n), k = amount * 40;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    this.drive.curve = curve;
  }

  // 曲を読み込む(初回だけ。ゲーム開始のタップのあとに呼ぶ)
  async load() {
    if (!this.ctx) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      for (const [name, url] of Object.entries(this.cfg.tracks)) {
        try {
          const res = await fetch(url);
          const data = await res.arrayBuffer();
          this.buffers[name] = await this.ctx.decodeAudioData(data);
        } catch (e) { console.warn('BGM の読み込みに失敗', url, e); }
      }
    })();
    return this.loading;
  }

  // 曲を鳴らし始める(すでに鳴っていれば何もしない)。fade 秒でフェードイン
  async play(name = 'normal', fade = 1.5) {
    if (!this.ctx) return;
    await this.load();
    if (!this.buffers[name]) return;
    if (this.current === name) return;
    const t = this.ctx.currentTime;
    // いまの曲をフェードアウトして止める
    if (this.current && this.players[this.current]) {
      const old = this.players[this.current];
      old.gain.gain.setTargetAtTime(0, t, fade / 3);
      setTimeout(() => { try { old.source.stop(); } catch { /* 無視 */ } }, fade * 1000 + 200);
      delete this.players[this.current];
    }
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers[name];
    source.loop = true;
    source.playbackRate.value = this.rateFor();
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.setTargetAtTime(1, t, fade / 3);
    source.connect(gain); gain.connect(this.lowpass);
    source.start(t);
    this.players[name] = { source, gain };
    this.current = name;
  }

  stop(fade = 1.0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [name, p] of Object.entries(this.players)) {
      p.gain.gain.setTargetAtTime(0, t, fade / 3);
      setTimeout(() => { try { p.source.stop(); } catch { /* 無視 */ } }, fade * 1000 + 200);
      delete this.players[name];
    }
    this.current = null;
  }

  rateFor() {
    return 1 + this.heat * 0.06 + (this.fever ? 0.04 : 0);
  }

  // 熱(0〜1)。こもり・音量・速さ・歪みが変わる
  setHeat(heat) {
    this.heat = heat;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const cutoff = 900 * Math.pow(18000 / 900, heat);          // 900 Hz → 18 kHz(対数で滑らかに)
    this.lowpass.frequency.setTargetAtTime(cutoff, t, 0.4);
    this.setDrive(heat * 0.6 + (this.fever ? 0.3 : 0));
    for (const p of Object.values(this.players)) p.source.playbackRate.setTargetAtTime(this.rateFor(), t, 0.5);
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.cfg.volume * (0.8 + heat * 0.35) : 0, t, 0.4);
  }

  // FEVER の入り切り。曲を切り替え、エコーを足す
  setFever(on) {
    if (this.fever === on) return;
    this.fever = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.delayGain.gain.setTargetAtTime(on ? 0.35 : 0, t, 0.3);
    this.play(on ? 'fever' : 'normal', on ? 0.8 : 2.0);
    this.setHeat(this.heat);
  }

  // メニューや Title では小さく、こもらせる
  duck(on) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? this.cfg.volume * (on ? 0.35 : 0.8 + this.heat * 0.35) : 0, t, 0.4);
  }

  // いまの音の強さ(0〜1)。背景の脈動に使う
  level() {
    if (!this.analyser || !this.current) return 0;
    this.analyser.getByteFrequencyData(this.bins);
    let sum = 0;
    const n = Math.min(24, this.bins.length);                 // 低音側の帯域で拍を取る
    for (let i = 0; i < n; i++) sum += this.bins[i];
    return Math.min(1, sum / n / 200);
  }
}
