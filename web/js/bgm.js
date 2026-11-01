// BGM。mp3 をブラウザで読み込み、Chain の熱と FEVER に合わせて加工しながら流す。
// 加工はすべて WebAudio のノードで行う(ファイルを事前に作り直さない)。
//
// 作り(ゲーム音楽の「縦の遷移」。FMOD / Wwise や PFA Engine と同じ考え方):
//   * 通常曲と FEVER 曲を最初から同時に鳴らし続け、切り替えは音量だけで行う(鳴らし直さない)。
//     途中から聞こえてくるので、曲の頭に戻る不自然さがない。
//   * 切り替えは等パワーのクロスフェード(cos / sin)。中間で音量が凹まない。
//   * ループは、曲の終わりに次の周回を重ねてフェードで継ぐ(mp3 の継ぎ目のクリック音を消す)。
//   * 最後にコンプレッサーを通して音割れを防ぐ。歪みのエフェクトは使わない。
//
//   layer(通常) ─┐
//                ├─ lowpass ─ highshelf ─ master ─ compressor ─ analyser ─ 出力
//   layer(FEVER)─┘        └─ delay(FEVER 中だけ) ─┘
//
//   熱が低い: 高音を削ったこもった音、小さめ
//   熱が高い: 高音が開き、少し明るく(highshelf)、少し大きく、わずかに速く(最大 +3%)
//   FEVER:    FEVER 曲へ 3 秒でクロスフェード、エコーを足す

const OVERLAP = 0.8;   // ループの継ぎ目を重ねる秒数

// 1 本の曲を途切れなくループさせる。終わりの OVERLAP 秒手前で次の周回を重ねて始める。
class Loop {
  constructor(ctx, buffer, out) {
    this.ctx = ctx; this.buffer = buffer; this.out = out;
    this.sources = [];
    this.rate = 1;
    this.timer = null;
    this.running = false;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.spawn(this.ctx.currentTime + 0.05, true);
  }
  // when の時刻から 1 周回ぶん鳴らし、終わりに次を予約する
  spawn(when, first) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    const g = this.ctx.createGain();
    if (first) g.gain.setValueAtTime(1, when);
    else { g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(1, when + OVERLAP); }
    const dur = this.buffer.duration / this.rate;
    const end = when + dur;
    g.gain.setValueAtTime(1, end - OVERLAP);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(g); g.connect(this.out);
    src.start(when); src.stop(end + 0.05);
    this.sources.push({ src, g });
    this.sources = this.sources.filter((s) => s.src !== src || true).slice(-3);
    // 次の周回を、終わりの OVERLAP 秒手前に。タイマーは余裕を見て 1 秒前に起こす
    const msUntil = Math.max(0, (end - OVERLAP - this.ctx.currentTime) * 1000 - 1000);
    this.timer = setTimeout(() => { if (this.running) this.spawn(end - OVERLAP, false); }, msUntil);
  }
  setRate(rate) {
    this.rate = rate;
    const t = this.ctx.currentTime;
    for (const s of this.sources) s.src.playbackRate.setTargetAtTime(rate, t, 0.6);
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    for (const s of this.sources) { try { s.src.stop(); } catch { /* 無視 */ } }
    this.sources = [];
  }
}

export class Bgm {
  constructor(cfg) {
    this.cfg = cfg;                // { volume, tracks: { normal, fever }, trims? }
    this.ctx = null;
    this.buffers = {};
    this.layers = {};              // name → { loop, gain }
    this.enabled = this.loadEnabled();
    this.heat = 0;
    this.fever = false;
    this.ducked = false;
    this.playing = false;
    this.loading = null;
  }

  loadEnabled() {
    try { return localStorage.getItem('numbermatch.bgm') !== 'off'; } catch { return true; }
  }
  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('numbermatch.bgm', on ? 'on' : 'off'); } catch { /* 無視 */ }
    this.updateMaster();
  }

  // AudioContext はユーザー操作のあとで渡される(audio.js と共有する)
  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 1200; this.lowpass.Q.value = 0.5;
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = 'highshelf'; this.shelf.frequency.value = 3000; this.shelf.gain.value = 0;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // コンプレッサー(リミッター寄り)。効果音と重なっても割れないように
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 10; this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    // FEVER 用のエコー
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = 0.3;
    this.feedback = ctx.createGain(); this.feedback.gain.value = 0.3;
    this.delayGain = ctx.createGain(); this.delayGain.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = 0.6;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);

    this.lowpass.connect(this.shelf);
    this.shelf.connect(this.master);
    this.shelf.connect(this.delay);
    this.delay.connect(this.feedback); this.feedback.connect(this.delay);
    this.delay.connect(this.delayGain); this.delayGain.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  // 曲を読み込む(初回だけ)
  async load() {
    if (!this.ctx) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      for (const [name, url] of Object.entries(this.cfg.tracks)) {
        try {
          const res = await fetch(url);
          this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch (e) { console.warn('BGM の読み込みに失敗', url, e); }
      }
    })();
    return this.loading;
  }

  // 両方の曲を同時に鳴らし始める。FEVER 曲は音量 0 で待機
  async play() {
    if (!this.ctx) return;
    await this.load();
    if (this.playing) return;
    if (!this.buffers.normal) return;
    this.playing = true;
    for (const name of Object.keys(this.buffers)) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.lowpass);
      const loop = new Loop(this.ctx, this.buffers[name], gain);
      loop.setRate(this.rateFor());
      loop.start();
      this.layers[name] = { loop, gain };
    }
    const t = this.ctx.currentTime;
    const trim = (n) => (this.cfg.trims?.[n] ?? 1);
    this.layers.normal.gain.gain.setValueAtTime(this.fever ? 0 : trim('normal'), t);
    if (this.layers.fever) this.layers.fever.gain.gain.setValueAtTime(this.fever ? trim('fever') : 0, t);
    this.master.gain.setValueAtTime(0.0001, t);
    this.updateMaster(2.0);
  }

  stop(fade = 1.2) {
    if (!this.ctx || !this.playing) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.0001, t, fade / 4);
    const layers = this.layers;
    this.layers = {};
    this.playing = false;
    setTimeout(() => { for (const l of Object.values(layers)) { l.loop.stop(); l.gain.disconnect(); } }, fade * 1000 + 100);
  }

  rateFor() { return 1 + this.heat * 0.03; }

  targetVolume() {
    if (!this.enabled) return 0.0001;
    const base = this.cfg.volume * (0.85 + this.heat * 0.25);
    return Math.max(0.0001, base * (this.ducked ? 0.35 : 1));
  }
  updateMaster(tc = 0.4) {
    if (!this.master || !this.playing) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.targetVolume(), t, tc / 3);
  }

  // 熱(0〜1)。こもり・明るさ・音量・速さが変わる
  setHeat(heat) {
    heat = Math.max(0, Math.min(1, heat));
    if (Math.abs(heat - this.heat) < 0.005 && this.ctx) return;
    this.heat = heat;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const cutoff = 1200 * Math.pow(16000 / 1200, heat);        // 1.2 kHz → 16 kHz(対数で滑らかに)
    this.lowpass.frequency.setTargetAtTime(cutoff, t, 0.5);
    this.shelf.gain.setTargetAtTime(heat * 4, t, 0.5);          // 最大 +4 dB
    for (const l of Object.values(this.layers)) l.loop.setRate(this.rateFor());
    this.updateMaster(0.6);
  }

  // FEVER の入り切り。等パワーのクロスフェード(cos / sin)で 3 秒かけて切り替え、エコーを足す
  setFever(on) {
    if (this.fever === on) return;
    this.fever = on;
    if (!this.ctx || !this.playing || !this.layers.fever) return;
    const t = this.ctx.currentTime, dur = on ? 3.0 : 4.0, steps = 24;
    const trim = (n) => (this.cfg.trims?.[n] ?? 1);
    const a = this.layers.normal.gain.gain, b = this.layers.fever.gain.gain;
    a.cancelScheduledValues(t); b.cancelScheduledValues(t);
    const a0 = a.value, b0 = b.value;
    a.setValueAtTime(a0, t); b.setValueAtTime(b0, t);
    for (let k = 1; k <= steps; k++) {
      const u = k / steps, tt = t + dur * u;
      const inG = Math.sin(u * Math.PI / 2), outG = Math.cos(u * Math.PI / 2);
      if (on) { a.linearRampToValueAtTime(trim('normal') * outG, tt); b.linearRampToValueAtTime(trim('fever') * inG, tt); }
      else { a.linearRampToValueAtTime(trim('normal') * inG, tt); b.linearRampToValueAtTime(trim('fever') * outG, tt); }
    }
    this.delayGain.gain.setTargetAtTime(on ? 0.22 : 0, t, on ? 0.8 : 1.5);
  }

  // メニューや Title では小さく
  duck(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    this.updateMaster(0.5);
  }

  // いまの音の強さ(0〜1)。背景の脈動に使う(低音側の帯域)
  level() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteFrequencyData(this.bins);
    let sum = 0;
    const n = Math.min(24, this.bins.length);
    for (let i = 0; i < n; i++) sum += this.bins[i];
    return Math.min(1, sum / n / 200);
  }
}
