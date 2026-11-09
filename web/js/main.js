// 起点。面データを読み、Game / Renderer / FX / Sound をつなぐ。
// 入力 → game.*() → イベントの配列 → handle() で画面・演出・音に振り分ける。
// 時間 → game.tick() を 200ms ごとに呼び、Chain ゲージと FEVER を進める。

import { CONFIG } from './config.js';
import { VsLink, makeCode, normalizeCode, pickBoard, makeSetup, stageDefFrom } from './vs.js';
import { SWEET_MELODIES } from './melodies.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { FX, heatColor, PALETTE } from './fx.js';
import { Sound, vibrate } from './audio.js';
import { Music } from './music.js';
import { analyzeStage } from './review.js';
import { Slot } from './slot.js';
import { SlotView } from './slotview.js';
import { WIDTH, validPairs } from './rules.js';

const fmt = (n) => n.toLocaleString('en-US');
const pad2 = (n) => String(n).padStart(2, '0');

async function boot() {
  const res = await fetch('levels/stages.json');
  const stages = await res.json();

  let game = new Game(stages, CONFIG);      // VS 中は VS 用の Game に差し替える(mainGame に戻す)
  const mainGame = game;
  const ui = new Renderer(document);
  const fx = new FX(document.getElementById('fx'), CONFIG.fx);
  const sound = new Sound(CONFIG.audio.masterVolume);
  // BGM は生成(music.js)。メニューで SYNTH / OFF を切り替える
  const cand = SWEET_MELODIES[CONFIG.bgm.sweetMelody];   // 候補に進行・音色・テンポ・調が付いていればそれも使う
  const synth = new Music({ volume: CONFIG.bgm.synthVolume, tonic: CONFIG.bgm.tonic, bpm: CONFIG.bgm.bpm, sweetBpm: cand.bpm ?? CONFIG.bgm.sweetBpm, sweetMelody: cand.notes, sweetMelodyLen: cand.length, sweetProgression: cand.progression, sweetStyle: cand.style, sweetTonic: cand.tonic });
  const loadBgmMode = () => { try { return localStorage.getItem('numbermatch.bgmMode') ?? CONFIG.bgm.mode; } catch { return CONFIG.bgm.mode; } };
  const bgm = {
    mode: loadBgmMode(),
    get active() { return this.mode === 'synth' ? synth : null; },
    attach(ctx) { synth.attach(ctx); },
    play() { this.active?.play(); },
    stop() { synth.stop(); },
    setHeat(h) { synth.setHeat(h); },
    setFever(on) { synth.setFever(on); },
    setSong(name) { synth.setSong(name); },
    // Stage ごとに曲を替える(Stage 1 は dance、Stage 2 は sweet、…)。スロットは dance
    songFor(stageIndex) { const order = CONFIG.bgm.songs; return order[stageIndex % order.length]; },
    duck(on) { synth.duck(on); },
    level() { return this.active ? this.active.level() : 0; },
    cycle() {
      const order = ['synth', 'off'];
      this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
      try { localStorage.setItem('numbermatch.bgmMode', this.mode); } catch { /* 無視 */ }
      this.stop();
    },
    get label() { return this.mode === 'synth' ? 'ON' : 'OFF'; },
  };
  // スロット(SLOT タブ)。判断は slot.js、画面は slotview.js。Coin は game が持つ
  const slot = new Slot(CONFIG.slot);
  slot.restore(game.slotStats);
  const slotEl = document.getElementById('slot');
  let slotActive = false;
  let titleTab = (() => { try { return localStorage.getItem('numbermatch.tab') || game.mode; } catch { return game.mode; } })();
  const slotView = new SlotView(slotEl, { slot, game, fx, sound, vibrate, onMenu: () => showSlotMenu(), onBet: () => showBetPicker() });
  // 賭け枚数を選ぶ(決まった枚数のほか、任意の枚数も入力できる)
  function showBetPicker() {
    const chips = CONFIG.slot.bets.map((b) => `<button class="btn btn-ghost chip ${slot.bet === b ? 'on' : ''}" data-bet="${b}" ${game.coins < b ? 'disabled' : ''}>${fmt(b)}</button>`).join('');
    const card = ui.showOverlay(`
      <div class="eyebrow">bet</div>
      <h1>Bet</h1>
      <div class="ja">Coin ${fmt(game.coins)}。5 枚以上で 5 ライン、3〜4 枚で横 3 本、1〜2 枚は中段だけ。払い戻しは枚数に比例。</div>
      <div class="chips">${chips}<button class="btn btn-ghost chip" data-bet="max" ${game.coins < 1 ? 'disabled' : ''}>MAX(${fmt(game.coins)})</button></div>
      <div class="bet-input"><input type="number" id="bet-input" min="1" max="${Math.max(1, game.coins)}" step="1" value="${slot.bet}" inputmode="numeric"><button class="btn btn-primary" id="bet-ok">OK</button></div>
      <div class="actions"><button class="btn btn-ghost" id="ov-back">Back</button></div>`);
    const apply = (b) => { slot.setBet(Math.min(Math.max(1, b), Math.max(1, game.coins))); slotView.renderAll(); ui.hideOverlay(); sound.select(); };
    card.querySelectorAll('[data-bet]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.bet === 'max' ? game.coins : Number(b.dataset.bet))));
    card.querySelector('#bet-ok').onclick = () => apply(Number(card.querySelector('#bet-input').value) || 1);
    card.querySelector('#ov-back').onclick = () => ui.hideOverlay();
  }
  function showSlot() {
    ensureAudio();
    ui.hideOverlay();
    slotActive = true; titleShown = false;
    app.hidden = true;
    fx.setCalm(false); document.body.classList.remove('classic');
    slotView.enter();
  }
  function leaveSlot() {
    slotView.leave();
    slotActive = false;
    app.hidden = false;
    applyMode();
  }
  function showSlotMenu() {
    if (slot.spinning) return;
    const card = ui.showOverlay(`
      <div class="eyebrow">slot</div>
      <h1>Pause</h1>
      <div class="ja">Coin ${fmt(game.coins)} · 払い戻し率の目安は約 90%。BONUS の役は揃えるまで持ち越す。</div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-back">Resume</button>
        <button class="btn btn-ghost" id="ov-sound">Sound: ${sound.enabled ? 'ON' : 'OFF'}</button>
        <button class="btn btn-ghost" id="ov-bgm">BGM: ${bgm.label}</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    card.querySelector('#ov-back').onclick = () => ui.hideOverlay();
    card.querySelector('#ov-sound').onclick = () => { sound.setEnabled(!sound.enabled); soundLabel(); showSlotMenu(); };
    card.querySelector('#ov-bgm').onclick = () => { bgm.cycle(); showSlotMenu(); };
    card.querySelector('#ov-title').onclick = () => { leaveSlot(); showTitle(); };
  }

  // モード(NORMAL / CLASSIC)を画面・音・演出に反映する。CLASSIC は BGM を静かに、揺れと点滅を止め、粒子を減らす
  let fxScale = 1;
  function applyMode() {
    const on = game.classic;
    const c = CONFIG.classic;
    synth.setCalm(on ? { bpm: c.bpm, maxLayers: c.maxLayers, volume: c.synthVolume, feverCalm: c.feverCalm } : null);
    fxScale = on ? c.fxScale : 1;
    fx.setCalm(on);
    document.body.classList.toggle('classic', on);
  }
  // 最初のタップで AudioContext ができたら BGM をつなぐ(ensure は何度呼んでもよい)
  const ensureAudio = () => { if (sound.ensure()) bgm.attach(sound.ctx); };
  // 拍に合わせて背景を脈打たせる
  (function beat() { document.documentElement.style.setProperty('--beat', bgm.level().toFixed(2)); requestAnimationFrame(beat); })();
  const app = document.getElementById('app');
  let busy = false;   // 消去アニメ中の多重入力を防ぐ
  let lineStreak = 0; // 連続で行を消した回数(行が消えない手・Add・Hint・Stage 開始で 0 に戻る)
  const overlayOpen = () => document.getElementById('overlay').hidden === false;

  // ---------- 描き直し ----------
  function redraw(opts = {}) {
    const st = game.stage;
    if (!st) return;
    const flashPairs = st.flashUntil !== null && Date.now() < st.flashUntil ? validPairs(st.board) : null;
    ui.renderBoard(st.board, { selected: st.selected, hintPair: st.hintPair, flashPairs, scopeTile: st.scope?.tile ?? null, ...opts });
    ui.renderHud(game);
    ui.renderQuest(st.quest);
  }
  function soundLabel() {
    document.getElementById('btn-sound-state').textContent = sound.enabled ? 'sound on' : 'sound off';
  }
  // 画面全体を一瞬だけ膨らませ、背景の格子を光らせる(大きな出来事の手応え)
  function punch() {
    if (game.classic) return;
    app.classList.remove('punch'); void app.offsetWidth; app.classList.add('punch');
    document.body.classList.remove('gridflash'); void document.body.offsetWidth; document.body.classList.add('gridflash');
  }

  // ---------- 時間 ----------
  // Chain ゲージと FEVER は時間で動くので、定期的に進めて HUD を描き直す
  setInterval(() => {
    // BGM: Stage 中は Chain の熱と FEVER に合わせ、Title では止める。オーバーレイ中は小さく
    if (slotActive) { bgm.setSong('dance'); bgm.setHeat(slot.bonus ? 0.85 : 0.3); bgm.setFever(!!slot.bonus); bgm.play(); bgm.duck(overlayOpen()); if (slot.bonus && !overlayOpen()) fx.embers(4); return; }
    if (vs.active) vsTick();
    if (game.stage?.status === 'play' || game.stage?.status === 'clear') { bgm.setHeat(game.heat); bgm.setFever(game.inFever); bgm.play(); }
    else if (titleShown) bgm.stop();
    bgm.duck(overlayOpen());
    if (!game.stage || game.stage.status !== 'play' || overlayOpen()) return;
    if (game.inFever && !game.classic) fx.embers(5);        // FEVER 中は火の粉が立ちのぼる
    const now = Date.now();
    const events = game.tick(now);
    if (events.length) handle(events);
    else ui.renderHud(game, now);
  }, 200);
  let titleShown = false;

  // ---------- イベントの振り分け ----------
  async function handle(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'select': {
          ui.selectCell(ev.pos, game.stage.board);
          sound.select(); vibrate(8);
          break;
        }
        case 'deselect': {
          ui.cellEl(ev.pos)?.classList.remove('selected');
          ui.clearSight();
          sound.deselect();
          break;
        }
        case 'invalid': {
          ui.cellEl(ev.from)?.classList.remove('selected');
          ui.clearSight();
          ui.shakeCell(ev.to);
          sound.invalid(); vibrate([20, 30, 20]);
          break;
        }
        case 'remove': await onRemove(ev); break;
        case 'feverStart': {
          sound.feverStart(); vibrate([60, 40, 60, 40, 150]);
          fx.flash('rgba(240,98,146,0.35)');
          fx.fireworks(5);
          punch();
          fx.floatText(innerWidth / 2, innerHeight * 0.4, 'FEVER!!', { color: PALETTE.rose, size: 44, dy: -40, life: 1.6 });
          fx.floatText(innerWidth / 2, innerHeight * 0.4 + 40, `${CONFIG.fever.durationMs / 1000} 秒間 Score ×${CONFIG.fever.pointMult}`, { color: PALETTE.white, size: 14, dy: -30, life: 1.6 });
          ui.renderHud(game);
          break;
        }
        case 'feverEnd': {
          sound.feverEnd();
          ui.toast(`FEVER 終了 … Chain ×${ev.mult.toFixed(1)}`, 2000);
          ui.renderHud(game);
          break;
        }
        case 'chainDecay': {
          sound.chainDecay();
          ui.renderHud(game);
          if (ev.chain === 0) ui.toast('Chain が途切れた … ×1.0', 1500);
          break;
        }
        case 'noAdds': ui.toast('Add はもう使えない'); sound.invalid(); break;
        case 'buy': {
          const name = { hint: 'Hint', add: 'Add', heart: 'Heart' }[ev.item];
          sound.lifeGain(); vibrate([20, 30, 20]);
          ui.toast(`${name} を購入 −${fmt(ev.price)} coin(残り ${fmt(ev.coins)})`, 2200);
          if (ev.item === 'heart') ui.renderLives(ev.lives, CONFIG.lives.max, { gained: true });
          ui.renderHud(game);
          break;
        }
        case 'noCoins': ui.toast(`Coin が足りない(${fmt(ev.price)} 必要、残り ${fmt(ev.coins)})`, 2200); sound.invalid(); break;
        case 'skillArmed': {
          sound.slotLamp(); vibrate([20, 30, 20]);
          document.body.classList.add('skill');
          ui.toast(ev.skill === 'line' ? `LINE BREAK: 消したい行の数字をタップ(${fmt(ev.price)} coin)。空マスで取りやめ` : `SNIPE SHOT: 数字を 2 つタップ。Pair なら位置に関係なく消える(${fmt(ev.price)} coin)。空マスで取りやめ`, 4000);
          break;
        }
        case 'skillCancel': document.body.classList.remove('skill'); redraw(); ui.toast('取りやめ', 1200); break;
        case 'skillSnipe': {
          document.body.classList.remove('skill');
          ui.toast(`SNIPE SHOT −${fmt(ev.price)} coin(残り ${fmt(ev.coins)})`, 2000);
          break;
        }
        case 'skillLine': await onSkillLine(ev); break;
        case 'noShop': sound.invalid(); break;
        case 'deadEnd': {
          // CLASSIC: 消せる Pair が無くなったらすぐ知らせる(本家と同じ)
          lineStreak = 0;
          redraw();
          ui.toast(`Dead End: 消せる Pair が無い。ADD で数字を足そう(残り ${ev.addsLeft} 回)`, 3000);
          sound.stuck(); vibrate([30, 30, 30]);
          break;
        }
        case 'noHints': ui.toast('Hint の使用上限に達した'); sound.invalid(); break;
        case 'noHint': {
          // Pair が残っていないのに Hint を押した(Dead End)
          lineStreak = 0;
          redraw();
          if (ev.blind) ui.toast(`Pair はもう無く、Add も無かった… −${fmt(ev.penalty)}`, 3000);
          else if (game.classic) ui.toast('Pair はもう無い… ADD で数字を足そう', 2400);
          else ui.toast(`Pair はもう無い… −${ev.penalty}、Chain ×${ev.mult.toFixed(1)}　Add で数字を足そう`, 2800);
          fx.flash('rgba(239,68,68,0.15)');
          sound.stuck(); vibrate([30, 30, 30]);
          break;
        }
        case 'flash': {
          sound.flash();
          redraw({ flashPairs: ev.pairs });
          for (const [a, b] of ev.pairs) { const ca = ui.cellCenter(a), cb = ui.cellCenter(b); if (ca && cb) fx.flashLine(ca.x, ca.y, cb.x, cb.y, PALETTE.amber, 2); }
          ui.toast(`FLASH: 消せる Pair ${ev.pairs.length} 組`, CONFIG.hint.flashMs);
          break;
        }
        case 'flashEnd': redraw(); break;
        case 'scope': {
          sound.scope();
          redraw();
          const c = ui.cellCenter(ev.tile);
          if (c) { fx.ring(c.x, c.y, PALETTE.red, 70); fx.burst(c.x, c.y, { color: PALETTE.red, count: 16, power: 0.6 }); }
          ui.toast(`SCOPE: このタイルの相手を探せ(残り Pair ${ev.remaining})`, 2600);
          break;
        }
        case 'scopeMiss': {
          sound.scopeMiss(); vibrate([40, 30, 40]);
          fx.flash('rgba(239,68,68,0.2)');
          ui.renderHud(game);
          ui.toast(ev.misses === 1 ? `外した… Chain −${CONFIG.hint.scopeMissChain} (×${ev.mult.toFixed(1)})` : `2 回目… Chain 半分 (×${ev.mult.toFixed(1)})、SCOPE 終了`, 2200);
          break;
        }
        case 'scopeEnd': {
          if (ev.reason === 'ignored') ui.toast(`光ったタイルを使わなかった… Chain 半分 (×${ev.mult.toFixed(1)})`, 2400);
          redraw();
          break;
        }
        case 'add': {
          lineStreak = 0;
          sound.add(); vibrate(25);
          redraw({ addedFrom: ev.oldLength });
          if (game.classic) {
            // CLASSIC に Chain は無い
          } else if (ev.stuckBefore && ev.chainBefore > 0) {
            ui.toast(`Dead End からの Add: Chain は半分残る ×${ev.multBefore.toFixed(1)} → ×${ev.multAfter.toFixed(1)}`, 2200);
          } else if (ev.chainBefore > 0) {
            ui.toast('まだ Pair があった… Chain が途切れた ×1.0', 2200);
          }
          // 追加された行が見えるように下へ
          requestAnimationFrame(() => ui.boardWrap.scrollTo({ top: ui.boardWrap.scrollHeight, behavior: 'smooth' }));
          break;
        }
        case 'hint': {
          sound.hint();
          redraw();
          ui.toast('HINT: この Pair は得点半分、Chain は維持', 2000);
          const c = ui.cellCenter(ev.pair[0]);
          if (c) fx.ring(c.x, c.y, PALETTE.amber, 50);
          break;
        }
        case 'stageStart': {
          lineStreak = 0; titleShown = false;
          bgm.setSong(bgm.songFor(ev.stageIndex));
          ui.hideOverlay();
          redraw();
          ui.boardWrap.scrollTo({ top: 0 });
          if (ev.invest > 0) ui.toast(`前の World で残した Add → 開始 Chain +${ev.invest}`, 2400);
          if (ev.bonusAdds > 0) ui.toast(`前の World で残した Add → この World の各 Stage で Add +${ev.bonusAdds}`, 2600);
          break;
        }
        case 'quest': {
          ui.renderQuest(ev.quest);
          if (ev.done) {
            sound.digitClear(2); vibrate([30, 40, 80]);
            fx.floatText(innerWidth / 2, innerHeight * 0.3, `QUEST CLEAR  +${CONFIG.quest.bonus}`, { color: PALETTE.green, size: 26, dy: -40, life: 1.8 });
            fx.fireworks(2);
          } else if (ev.failed) {
            ui.toast(`お題「${ev.quest.text}」は失敗`, 2000);
          }
          break;
        }
        case 'stageClear': if (vs.playing) await onVsClear(ev); else await onStageClear(ev); break;
        case 'stageFailed': if (vs.playing) vsFinish('stuck'); else await onStageFailed(ev); break;
        case 'runOver': if (vs.playing) vsFinish('stuck'); else await onRunOver(ev); break;
        case 'complete': showComplete(ev); break;
        default: break;
      }
    }
  }

  const FEVER_COLORS = [PALETTE.rose, PALETTE.amber, PALETTE.purple, PALETTE.white];
  let feverTick = 0;
  async function onRemove(ev) {
    busy = true;
    const color = ev.fever ? FEVER_COLORS[feverTick++ % FEVER_COLORS.length] : heatColor(ev.heat);
    const ci = ui.cellCenter(ev.i), cj = ui.cellCenter(ev.j);
    const speedBoost = ev.speed === 'fast' ? 1 : ev.speed === 'quick' ? 0.5 : 0;   // 速いほど派手に
    const feverBoost = ev.fever ? 1 : 0;                                            // FEVER 中はすべて増量
    const power = 0.8 + ev.heat * 1.4 + speedBoost * 0.5 + feverBoost * 0.6;
    const mx = ci && cj ? (ci.x + cj.x) / 2 : innerWidth / 2;
    const my = ci && cj ? (ci.y + cj.y) / 2 : innerHeight / 2;

    // 1. 2 マスを結ぶ光が尾を引き、両端で爆ぜ、得点が Score 表示へ飛んでいく
    if (ci && cj) {
      fx.flashLine(ci.x, ci.y, cj.x, cj.y, color, 3 + ev.heat * 3 + speedBoost * 2 + feverBoost * 2);
      fx.trail(ci.x, ci.y, cj.x, cj.y, color, 10 + Math.round(ev.heat * 10 + feverBoost * 12));
      const count = CONFIG.fx.particlesPerRemove + Math.round(ev.heat * 24 + speedBoost * 12 + feverBoost * 24);
      for (const c of [ci, cj]) fx.burst(c.x, c.y, { color, count: Math.round(count * fxScale), power: power * (0.6 + 0.4 * fxScale), size: 3 + speedBoost + feverBoost });
      if (ev.heat > 0.5 || speedBoost > 0 || feverBoost) fx.ring(mx, my, color, 40 + ev.heat * 60 + speedBoost * 30 + feverBoost * 40);
      const target = ui.scoreCenter();
      fx.flyText(mx, my, target.x, target.y, `+${ev.pairPoints}`, { color, size: 18 + ev.heat * 10 + speedBoost * 4 + feverBoost * 6, dur: 0.5 });
      // 難しい道・速さのラベル(難しさは倍率で表示)
      const labels = [...ev.labels];
      if (ev.diffMult > 1) labels.unshift(`×${ev.diffMult.toFixed(2).replace(/0$/, '')}`);
      if (ev.pathBonus > 0) labels.unshift(`+${ev.pathBonus}`);
      if (ev.speed === 'fast') labels.push('FAST!!');
      else if (ev.speed === 'quick') labels.push('QUICK');
      labels.forEach((text, k) => {
        const lc = text === 'FAST!!' ? PALETTE.rose : text === 'QUICK' ? PALETTE.amber : text === 'LONG SHOT' || text === 'DIAGONAL SNIPE' ? PALETTE.purple : text === 'SCOPE' || text === 'HINTED' ? PALETTE.red : text.startsWith('×') ? PALETTE.white : PALETTE.green;
        fx.floatText(mx, my - 36 - k * 22, text, { color: lc, size: 15 + (text === 'FAST!!' ? 4 : 0), dy: -45, life: 1.1 });
      });
      if (!ev.classic && ev.chain >= 5 && ev.chain % 5 === 0) {
        fx.floatText(mx, my + 30, `${ev.chain} CHAIN  ×${ev.mult.toFixed(1)}`, { color: PALETTE.white, size: 16, dy: -30, life: 1.3 });
      }
    }
    if (ev.digitsCleared.length > 0 && ci && cj) {
      const target = ui.scoreCenter();
      ev.digitsCleared.forEach((d, k) => {
        fx.floatText(mx, my - 70 - k * 26, `NO MORE ${d}  +${ev.digitPoints / ev.digitsCleared.length}`, { color: PALETTE.purple, size: 20, dy: -50, life: 1.6 });
      });
      fx.ring(mx, my, PALETTE.purple, 90);
      fx.burst(mx, my, { color: PALETTE.purple, count: 30, power: 1.2, size: 3.5 });
      fx.flyText(mx, my - 40, target.x, target.y, `+${ev.digitPoints}`, { color: PALETTE.purple, size: 18, dur: 0.6, delay: 0.3 });
      sound.digitClear(ev.digitsCleared.length);
    }
    ui.markRemoving(ev.i, ev.j);
    sound.remove(ev.chain, ev.heat);
    vibrate(12 + Math.round(ev.heat * 20));
    fx.shake(ui.boardWrap, CONFIG.fx.shakeBase * (0.5 + ev.heat * 1.5 + speedBoost + feverBoost) * fxScale, 160);
    if (ev.fever && !game.classic && ev.clearedRows.length === 0 && ci && cj) {
      // FEVER 中は 1 Pair ごとに LINE 消去なみの手応え: ヒットストップ → 画面の膨らみ → 2 マスの行を横一閃 → 輪と粒子 → 和音
      fx.freeze(60);
      await sleep(70);
      punch();
      for (const r of new Set([Math.floor(ev.i / WIDTH), Math.floor(ev.j / WIDTH)])) {
        const rr = ui.rowRect(r);
        if (rr) { fx.rowSweep(rr.y, rr.h, color); fx.rowSweep(rr.y, rr.h, PALETTE.white); }
      }
      fx.ring(mx, my, color, 150);
      fx.burst(mx, my, { color: PALETTE.white, count: Math.round(44 * fxScale), power: 1.5, size: 3.5 });
      fx.trail(ci.x, ci.y, cj.x, cj.y, PALETTE.white, 16);
      fx.shake(ui.boardWrap, 6, 260);
      fx.fireworks(1);
      sound.feverHit(feverTick);
      vibrate([20, 30, 40]);
    }
    if (ev.feverExtendMs > 0) {
      const fb = document.getElementById('hud-fever')?.getBoundingClientRect();
      if (fb) fx.floatText(fb.left + fb.width * 0.5, fb.top + fb.height, `FEVER +${(ev.feverExtendMs / 1000).toFixed(1)}s`, { color: PALETTE.rose, size: 13 * (0.7 + 0.3 * fxScale), dy: 22, life: 0.9 });
      ui.renderHud(game);
    }

    // 2. 行が消えるときはヒットストップのあと横一閃+大量の粒子+揺れ+画面の膨らみ。
    //    連続で行を消すほど(lineStreak)粒子・揺れ・フラッシュ・音が段階的に強くなる。
    if (ev.clearedRows.length > 0) {
      lineStreak += 1;
      const n = ev.clearedRows.length;
      const boost = Math.min(4, lineStreak - 1) + feverBoost;   // 0〜5 段階
      const streakColor = [PALETTE.amber, PALETTE.amber, PALETTE.rose, PALETTE.red, PALETTE.purple, PALETTE.purple][boost];
      fx.freeze(CONFIG.fx.hitStopMs + boost * 30);        // 一瞬止めてから爆発させる
      await sleep(CONFIG.fx.hitStopMs + boost * 40);
      ui.markRowsRemoving(ev.clearedRows);
      punch();
      const rows = ev.clearedRows.map((r) => ui.rowRect(r)).filter(Boolean);
      for (const r of rows) {
        fx.rowSweep(r.y, r.h, color);
        if (boost >= 1) fx.rowSweep(r.y, r.h, streakColor);
        for (let k = 0; k < WIDTH; k++) {
          const x = innerWidth / 2 + (k - 4) * (r.h + 6);
          fx.burst(x, r.y + r.h / 2, {
            color: k % 2 ? color : PALETTE.white,
            count: Math.round(CONFIG.fx.particlesPerRow / WIDTH) * (1 + boost * 0.5),
            power: 1.2 + ev.heat + boost * 0.3, size: 3.5 + boost * 0.5,
          });
        }
        if (boost >= 2) fx.ring(innerWidth / 2, r.y + r.h / 2, streakColor, 160 + boost * 40);
      }
      const y = rows.length ? rows[0].y : innerHeight / 2;
      const target = ui.scoreCenter();
      fx.floatText(innerWidth / 2, y - 30, n > 1 ? `${n} LINES  +${ev.rowPoints}` : `LINE  +${ev.rowPoints}`, { color: PALETTE.amber, size: 22 + boost * 3, dy: -60, life: 1.3 });
      fx.flyText(innerWidth / 2, y - 30, target.x, target.y, `+${ev.rowPoints}`, { color: PALETTE.amber, size: 20, dur: 0.6, delay: 0.5 });
      if (lineStreak >= 2) {
        const label = ['', '', 'DOUBLE', 'TRIPLE', 'QUAD', 'RAMPAGE'][Math.min(lineStreak, 5)];
        fx.floatText(innerWidth / 2, y - 64, `${label} LINE  ×${lineStreak}`, { color: streakColor, size: 24 + boost * 4, dy: -50, life: 1.5 });
      }
      if (lineStreak >= 4 || feverBoost) fx.fireworks(2 + boost);
      fx.flash(n > 1 || boost >= 1 ? `rgba(245,166,35,${0.22 + boost * 0.08})` : 'rgba(255,255,255,0.14)');
      fx.shake(ui.boardWrap, 6 + n * 3 + boost * 4, 320 + boost * 80);
      sound.rowClear(n, lineStreak - 1 + feverBoost);
      vibrate(boost >= 2 ? [40, 40, 80, 40, 120] : [30, 40, 60]);
      await sleep(220 + boost * 60);
    } else {
      lineStreak = 0;
      await sleep(180);
    }
    redraw();
    setTimeout(() => ui.bumpScore(), 250);   // 飛んだ得点が届くころに Score が跳ねる
    busy = false;
  }

  // 必殺技 LINE BREAK: 行消しの演出をそのまま使う(ヒットストップ → 横一閃 → 粒子 → 得点)
  async function onSkillLine(ev) {
    busy = true;
    document.body.classList.remove('skill');
    lineStreak = 0;
    const r = ui.rowRect(ev.row);
    fx.freeze(CONFIG.fx.hitStopMs + 60);
    await sleep(CONFIG.fx.hitStopMs + 80);
    ui.markRowsRemoving([ev.row]);
    punch();
    if (r) {
      fx.rowSweep(r.y, r.h, PALETTE.rose); fx.rowSweep(r.y, r.h, PALETTE.white);
      for (let k = 0; k < WIDTH; k++) {
        const x = innerWidth / 2 + (k - 4) * (r.h + 6);
        fx.burst(x, r.y + r.h / 2, { color: k % 2 ? PALETTE.rose : PALETTE.white, count: Math.round(14 * fxScale), power: 1.6, size: 4 });
      }
      fx.ring(innerWidth / 2, r.y + r.h / 2, PALETTE.rose, 200);
      const target = ui.scoreCenter();
      fx.floatText(innerWidth / 2, r.y - 30, `LINE BREAK  +${ev.points}`, { color: PALETTE.rose, size: 26, dy: -60, life: 1.4 });
      fx.flyText(innerWidth / 2, r.y - 30, target.x, target.y, `+${ev.points}`, { color: PALETTE.rose, size: 20, dur: 0.6, delay: 0.5 });
    }
    fx.flash('rgba(240,98,146,0.25)');
    fx.shake(ui.boardWrap, 10, 400);
    sound.rowClear(1, 3);
    vibrate([40, 40, 80, 40, 120]);
    ui.toast(`LINE BREAK −${fmt(ev.price)} coin(残り ${fmt(ev.coins)})`, 2000);
    await sleep(300);
    redraw();
    setTimeout(() => ui.bumpScore(), 250);
    busy = false;
  }

  async function onStageClear(ev) {
    busy = true;
    await sleep(200);
    sound.stageClear();
    fx.fireworks(ev.perfect ? 9 : 6);
    punch();
    if (ev.perfect) { setTimeout(() => sound.perfect(), 300); fx.flash('rgba(62,207,142,0.2)'); }
    vibrate([40, 60, 40, 60, 120]);
    // Board を全部消した: ALL CLEAR の表示。Chain と FEVER は次の Stage へ続く
    const cx = innerWidth / 2, cy = innerHeight * 0.42;
    fx.floatText(cx, cy, 'ALL CLEAR', { color: PALETTE.amber, size: 42, dy: -30, life: 2.0 });
    fx.floatText(cx, cy + 44, `+${fmt(ev.clearBonus + ev.perfectBonus + ev.savedBonus + ev.hintBonus)}${ev.perfect ? '  PERFECT' : ''}`, { color: ev.perfect ? PALETTE.green : PALETTE.white, size: 20, dy: -30, life: 2.0 });
    if (ev.chain > 0 && !ev.classic) fx.floatText(cx, cy + 76, `CHAIN ×${ev.mult.toFixed(1)} を持ち越し`, { color: heatColor(game.heat), size: 14, dy: -24, life: 2.0 });
    if (ev.questBonus) fx.floatText(cx, cy + 100, `QUEST CLEAR  +${ev.questBonus}`, { color: PALETTE.green, size: 16, dy: -24, life: 2.0 });
    if (ev.stageBestUpdated && ev.prevBest) fx.floatText(cx, cy + 124, `STAGE BEST  ${fmt(ev.stageBest)}`, { color: PALETTE.amber, size: 16, dy: -24, life: 2.0 });
    if (ev.lifeGain) { ui.renderLives(game.run.lives, CONFIG.lives.max, { gained: true }); sound.lifeGain(); }
    ui.renderHud(game);
    if (CONFIG.flow.continueAfterClear && !ev.worldEnd && !ev.isLast) {
      // 続けて次の Stage へ(Result の画面は World の終わりだけ)
      await sleep(CONFIG.flow.autoNextMs);
      busy = false;
      handle(game.nextStage(Date.now()));
      return;
    }
    await sleep(900);
    const card = ui.showOverlay(`
      <div class="eyebrow">${ev.isLast ? 'final stage' : `world ${game.worldOf(game.run.stageIndex) + 1} clear`} · stage ${pad2(ev.stage)}</div>
      <h1>${ev.perfect ? 'Perfect!' : 'World Clear'}</h1>
      <div class="ja">${ev.isLast ? '最後の Stage を突破！！' : `World ${game.worldOf(game.run.stageIndex) + 1} の 5 Stage を突破。`}</div>
      <div class="result">
        <div class="rank ${ev.rank}" id="ov-rank">${ev.rank}</div>
        <div class="stars"><span class="star">★</span><span class="star">★</span><span class="star">★</span></div>
      </div>
      <div class="rows">
        <div class="row"><span class="k">この Stage の Play Score</span><span class="v">${fmt(ev.playScore)}</span></div>
        <div class="row"><span class="k">ALL CLEAR Bonus</span><span class="v plus">+${fmt(ev.clearBonus)}</span></div>
        ${ev.perfect ? `<div class="row"><span class="k">Perfect Bonus</span><span class="v plus">+${fmt(ev.perfectBonus)}</span></div>` : ''}
        ${ev.savedBonus ? `<div class="row"><span class="k">Add 温存 Bonus(${ev.addsLeft} 回)</span><span class="v plus">+${fmt(ev.savedBonus)}</span></div>` : ''}
        ${ev.hintBonus ? `<div class="row"><span class="k">Hint 温存 Bonus(${ev.hintsLeft} 回)</span><span class="v plus">+${fmt(ev.hintBonus)}</span></div>` : ''}
        ${ev.questBonus ? `<div class="row"><span class="k">Quest「${ev.quest.text}」</span><span class="v plus">+${fmt(ev.questBonus)}</span></div>` : `<div class="row"><span class="k">Quest「${ev.quest?.text ?? ''}」</span><span class="v">未達成</span></div>`}
        ${ev.lifeGain ? `<div class="row"><span class="k">Heart 回復</span><span class="v plus">+${ev.lifeGain} ♥</span></div>` : ''}
        ${ev.worldEnd && !ev.isLast && ev.classic ? `<div class="row"><span class="k">温存した Add ${ev.savedAdds} 回 → 次の World</span><span class="v plus">各 Stage で Add +${ev.investAdds}</span></div>` : ''}
        ${ev.worldEnd && !ev.isLast && !ev.classic ? `<div class="row"><span class="k">温存した Add ${ev.savedAdds} 回 → 次の World</span><span class="v plus">開始 Chain +${ev.investChain}${ev.investHearts ? ` · Heart +${ev.investHearts}` : ''}</span></div>` : ''}
        <div class="row"><span class="k">この Stage の最高得点${ev.coinUsed ? '(Coin を使ったので更新なし)' : ''}</span><span class="v${ev.stageBestUpdated ? ' plus' : ''}">${fmt(ev.stageBest)}${ev.stageBestUpdated && ev.prevBest ? ' NEW!' : ''}</span></div>
        <div class="row"><span class="k">Coin</span><span class="v plus">+${fmt(ev.coinsGained)} → ${fmt(ev.coins)}</span></div>
        <div class="row"><span class="k">World の Rank</span><span class="v">${rankSummaryWorld(game.worldOf(game.run.stageIndex))}</span></div>
        ${ev.classic ? '' : `<div class="row"><span class="k">最高倍率(この Stage / Run)</span><span class="v">×${ev.maxMult.toFixed(1)} / ×${ev.runMaxMult.toFixed(1)}</span></div>`}
        <div class="row total"><span class="k">Total Score</span><span class="v">${fmt(ev.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-next">${ev.isLast ? 'Result を見る' : 'Next World →'}</button>
        <button class="btn btn-ghost" id="ov-review">感想戦(手の評価)</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    card.querySelector('#ov-review').onclick = () => showReview(() => onStageClear(ev));
    ui.animateStars(card, ev.stars);
    setTimeout(() => { card.querySelector('#ov-rank')?.classList.add('show'); if (ev.rank === 'S') { sound.perfect(); fx.fireworks(4); } }, 1100);
    card.querySelector('#ov-next').onclick = () => { busy = false; handle(game.nextStage(Date.now())); };
    card.querySelector('#ov-title').onclick = () => { busy = false; showTitle(); };
  }

  // ---------- 感想戦 ----------
  // 直近の Stage の手を評価して一覧にする。行をタップするとその局面の Board を小さく表示し、
  // 選んだ手(赤)と最善手(橙)を示す。back() で元の Result に戻る
  function showReview(back, pick = null) {
    const reviews = game.run?.reviews ?? [];
    if (!reviews.length) { ui.toast('記録が無い'); return; }
    const idx = pick ?? reviews.length - 1;
    const rev = reviews[idx];
    const a = analyzeStage(CONFIG, rev.history);
    const mark = { best: '★', good: '○', missed: '△', blunder: '✖', note: '・' };
    const rowsHtml = a.moves.map((m, k) => {
      const head = m.type === 'remove' ? `${m.board[m.i]} と ${m.board[m.j]}  +${m.points}  ×${m.mult.toFixed(1)}` : m.type === 'add' ? 'ADD' : 'HINT';
      return `<div class="rv-row rv-${m.verdict}" data-k="${k}"><span class="rv-mark">${mark[m.verdict]}</span><span class="rv-head">${k + 1}. ${head}</span><span class="rv-text">${m.text}</span></div>`;
    }).join('');
    const tabs = reviews.map((r, k) => `<button class="btn btn-ghost rv-tab ${k === idx ? 'on' : ''}" data-idx="${k}">S${pad2(r.stage)}${r.cleared ? '' : ' ✖'}</button>`).join('');
    const card = ui.showOverlay(`
      <div class="eyebrow">review · stage ${pad2(rev.stage)}</div>
      <h1>感想戦</h1>
      <div class="ja">★ 最善手　○ 良手　△ もっと得点できた手があった　✖ 悪手(全消しできなくなった / Chain を切った)</div>
      <div class="rv-tabs">${tabs}</div>
      <div class="rows">
        <div class="row"><span class="k">手数 / 最善手</span><span class="v">${a.summary.removes} / ${a.summary.bestCount}</span></div>
        <div class="row"><span class="k">悪手 / 逃した得点</span><span class="v">${a.summary.blunders} / ${fmt(a.summary.missed)}</span></div>
        <div class="row"><span class="k">最高倍率 / 行消し / DIGIT CLEAR</span><span class="v">×${a.summary.maxMult.toFixed(1)} / ${a.summary.rowsCleared} / ${a.summary.digitClears}</span></div>
      </div>
      <div class="rv-board" id="rv-board"></div>
      <div class="rv-list">${rowsHtml || '<div class="ja">手の記録が無い</div>'}</div>
      <div class="actions"><button class="btn btn-primary" id="ov-back">Back</button></div>`);
    const boardBox = card.querySelector('#rv-board');
    const showMove = (k) => {
      const m = a.moves[k];
      card.querySelectorAll('.rv-row').forEach((r) => r.classList.toggle('on', Number(r.dataset.k) === k));
      const cells = m.board.map((c, p) => {
        let cls = 'rv-cell' + (c === 0 ? ' empty' : '');
        if (m.type === 'remove' && (p === m.i || p === m.j)) cls += ' mine';
        if (m.best && (p === m.best.i || p === m.best.j)) cls += ' best';
        return `<span class="${cls}">${c || ''}</span>`;
      }).join('');
      boardBox.innerHTML = `<div class="rv-grid">${cells}</div><div class="rv-legend">${m.type === 'remove' ? '<span class="mine">■</span> 選んだ手' : ''}${m.best ? '　<span class="best">■</span> 最善手(+' + m.best.points + ')' : ''}</div>`;
    };
    card.querySelectorAll('.rv-row').forEach((r) => r.addEventListener('click', () => showMove(Number(r.dataset.k))));
    card.querySelectorAll('.rv-tab').forEach((b) => b.addEventListener('click', () => showReview(back, Number(b.dataset.idx))));
    const firstBad = a.moves.findIndex((m) => m.verdict === 'blunder' || m.verdict === 'missed');
    if (a.moves.length) showMove(firstBad >= 0 ? firstBad : 0);
    card.querySelector('#ov-back').onclick = back;
  }

  // World の 5 Stage の Rank を並べる
  function rankSummaryWorld(w) {
    const first = w * CONFIG.worldSize;
    return `<span class="ranks">${stages.slice(first, first + CONFIG.worldSize).map((s) => { const r = game.progress.ranks[s.stage] ?? '·'; return `<span class="${r}">${r}</span>`; }).join('')}</span>`;
  }

  async function onStageFailed(ev) {
    busy = true;
    if (!ev._replay) {
      if (ev.reason === 'giveUp') sound.giveUp(); else sound.fail();
      vibrate([80, 50, 80]);
      if (!ev.classic) ui.renderLives(ev.lives + 1, CONFIG.lives.max, { lost: true });
      fx.flash('rgba(239,68,68,0.18)');
      fx.shake(ui.boardWrap, 8, 400);
      await sleep(900);
    }
    const title = ev.reason === 'giveUp' ? 'Give Up' : ev.reason === 'blindHint' ? 'Stuck' : 'Stuck';
    const text = ev.reason === 'giveUp'
      ? 'Stage をあきらめた。Stage 得点の半分は獲得できる。'
      : ev.reason === 'blindHint'
        ? '消せる Pair は無く Add も無いのに Hint を押してしまった… '
        : '消せる Pair が無く、Add も残っていない…';
    const card = ui.showOverlay(`
      <div class="eyebrow">stage ${pad2(ev.stage)}</div>
      <h1>${title}</h1>
      <div class="ja">${text}${ev.classic ? ' 新しい Board でやり直せる。' : ' Heart を 1 つ失った。'}</div>
      <div class="rows">
        <div class="row"><span class="k">失った Stage 得点</span><span class="v minus">−${fmt(ev.lost)}</span></div>
        ${ev.kept ? `<div class="row"><span class="k">残った Stage 得点</span><span class="v plus">${fmt(ev.kept)}</span></div>` : ''}
        ${ev.classic ? '' : `<div class="row"><span class="k">残り Heart</span><span class="v">${'♥'.repeat(ev.lives)}${'♡'.repeat(CONFIG.lives.max - ev.lives)}</span></div>`}
        ${ev.classic ? '' : `<div class="row"><span class="k">最高倍率</span><span class="v">×${ev.maxMult.toFixed(1)}</span></div>`}
        <div class="row total"><span class="k">Score</span><span class="v">${fmt(game.run.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-warn" id="ov-retry">新しい Board で Retry</button>
        <button class="btn btn-ghost" id="ov-review">感想戦(どこで詰んだか)</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    card.querySelector('#ov-review').onclick = () => showReview(() => onStageFailed({ ...ev, _replay: true }));
    card.querySelector('#ov-retry').onclick = () => { busy = false; handle(game.retryStage()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; showTitle(); };
  }

  async function onRunOver(ev) {
    busy = true;
    sound.runOver(); vibrate([120, 80, 200]);
    ui.renderLives(1, CONFIG.lives.max, { lost: true });
    fx.flash('rgba(239,68,68,0.25)');
    fx.shake(ui.boardWrap, 10, 500);
    await sleep(1100);
    const w = game.worldOf(ev.resumeStage) + 1;
    const card = ui.showOverlay(`
      <div class="eyebrow">run over</div>
      <h1 class="big">${fmt(ev.score)}</h1>
      <div class="ja">Heart が尽きた…${ev.score >= ev.best && ev.score > 0 ? 'Best Score 更新！！' : `Best ${fmt(ev.best)}`}</div>
      <div class="rows">
        <div class="row"><span class="k">到達 Stage</span><span class="v">${pad2(ev.stage)}</span></div>
        <div class="row"><span class="k">最高倍率</span><span class="v">×${ev.runMaxMult.toFixed(1)}</span></div>
        <div class="row"><span class="k">再開地点</span><span class="v">WORLD ${w} (STAGE ${pad2(ev.resumeStage + 1)})</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-restart">World ${w} のはじめから</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    card.querySelector('#ov-restart').onclick = () => { busy = false; handle(game.restartFromWorld()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; game.abandonRun(); showTitle(); };
  }

  function showComplete(ev) {
    fx.fireworks(12);
    sound.stageClear();
    const card = ui.showOverlay(`
      <div class="eyebrow">all ${stages.length} stages</div>
      <h1 class="big">Complete</h1>
      <div class="ja">全 Stage を突破！！計 ${fmt(ev.score)} 点、Best ${fmt(ev.best)} 点</div>
      <div class="rows">
        <div class="row"><span class="k">集めた Star</span><span class="v">${game.totalStars} / ${stages.length * 3}</span></div>
        <div class="row"><span class="k">Rank</span><span class="v">${rankSummary()}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-title">Title へ</button>
      </div>`);
    card.querySelector('#ov-title').onclick = () => { game.abandonRun(); showTitle(); };
  }

  function rankSummary() {
    const c = game.rankCounts;
    return `<span class="ranks"><span class="S">S ×${c.S}</span><span class="A">A ×${c.A}</span><span class="B">B ×${c.B}</span><span class="C">C ×${c.C}</span></span>`;
  }

  // ---------- Title・Menu ----------
  function showTitle() {
    busy = false; titleShown = true;
    if (slotActive) leaveSlot();
    try { localStorage.setItem('numbermatch.tab', titleTab); } catch { /* 無視 */ }
    if (vs.active) leaveVs();
    if (titleTab === 'slot') { showSlotTitle(); return; }
    if (titleTab === 'vs') { showVsTitle(); return; }
    const canResume = game.run && game.stage && (game.stage.status === 'play' || game.stage.status === 'clear' || game.stage.status === 'failed');
    const worlds = [];
    const total = Math.ceil(stages.length / CONFIG.worldSize);
    for (let w = 0; w < total; w++) {
      const unlocked = w < game.unlockedWorlds;
      const first = w * CONFIG.worldSize;
      const inWorld = stages.slice(first, first + CONFIG.worldSize);
      const starsIn = inWorld.reduce((a, s) => a + (game.progress.stars[s.stage] ?? 0), 0);
      const ranksIn = inWorld.map((s) => game.progress.ranks[s.stage] ?? '·').join(' ');
      worlds.push(`<button class="btn btn-ghost" data-world="${w}" ${unlocked ? '' : 'disabled'}>WORLD ${w + 1}<small>${unlocked ? `★ ${starsIn}/${CONFIG.worldSize * 3}` : 'locked'}</small>${unlocked ? `<small>${ranksIn}</small>` : ''}</button>`);
    }
    const card = ui.showOverlay(`
      <div class="eyebrow">number match</div>
      <h1 class="big">THE TEN</h1>
      <div class="ja">同じ数字か、足して 10 になる 2 つの数字の Pair をタップで選んで消していこう！Board の数字を全部消せば Stage Clear！！</div>
      ${modeTabs()}
      <div class="ja mode-desc">${game.classic
        ? '本家に近い遊び方。倍率・制限時間・Heart は無く、得点は定額。Add は 5 回で、残すほど Bonus。Dead End はすぐ知らせる。'
        : 'Chain 倍率と FEVER で高得点を狙う遊び方。Chain は時間で減り、Heart が尽きると Run 終了。'}</div>
      <div class="rows">
        <div class="row"><span class="k">Coin</span><span class="v">${fmt(game.coins)}</span></div>
        <div class="row"><span class="k">Best Score</span><span class="v">${fmt(game.progress.bestScore)}</span></div>
        <div class="row"><span class="k">Star</span><span class="v">★ ${game.totalStars} / ${stages.length * 3}</span></div>
        <div class="row"><span class="k">Rank</span><span class="v">${rankSummary()}</span></div>
      </div>
      <div class="actions">
        ${canResume ? `<button class="btn btn-primary" id="ov-resume">Continue (STAGE ${pad2(game.stageDef.stage)})</button>` : ''}
        <button class="btn ${canResume ? 'btn-ghost' : 'btn-primary'}" id="ov-new">New Game</button>
        <div class="worlds">${worlds.join('')}</div>
        <button class="btn btn-ghost" id="ov-records">Records(Stage ごとの最高得点)</button>
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
      </div>
      <div class="meta">rules verified</div>`);
    card.querySelector('#ov-records').onclick = showRecords;
    bindTabs(card);
    card.querySelector('#ov-resume')?.addEventListener('click', () => {
      ensureAudio();
      const st = game.stage;
      if (st.status === 'clear') { ui.hideOverlay(); redraw(); handle(game.nextStage()); return; }
      if (st.status === 'failed') { handle(game.retryStage()); return; }
      game.resume(Date.now());
      ui.hideOverlay(); redraw();
    });
    card.querySelector('#ov-new').onclick = () => { ensureAudio(); handle(game.newRun(0)); };
    card.querySelectorAll('[data-world]').forEach((b) => b.addEventListener('click', () => {
      ensureAudio(); handle(game.newRun(Number(b.dataset.world) * CONFIG.worldSize));
    }));
    card.querySelector('#ov-rules').onclick = showRules;
  }

  // Title のタブ(NORMAL / CLASSIC / SLOT)
  function modeTabs() {
    const on = (t) => (titleTab === t ? 'on' : '');
    return `<div class="mode-tabs" role="tablist">
        <button class="mode-tab ${on('normal')}" data-tab="normal" role="tab">NORMAL</button>
        <button class="mode-tab ${on('classic')}" data-tab="classic" role="tab">CLASSIC</button>
        <button class="mode-tab ${on('slot')}" data-tab="slot" role="tab">SLOT</button>
        <button class="mode-tab ${on('vs')}" data-tab="vs" role="tab">VS</button>
      </div>`;
  }
  function bindTabs(card) {
    card.querySelectorAll('.mode-tab').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.tab;
      if (t === titleTab) return;
      titleTab = t;
      if (t !== 'slot' && t !== 'vs') { game.setMode(t); applyMode(); }
      showTitle();
    }));
  }
  function showSlotTitle() {
    const s = slot.stats;
    const card = ui.showOverlay(`
      <div class="eyebrow">number match</div>
      <h1 class="big">THE TEN</h1>
      <div class="ja">同じ数字か、足して 10 になる 2 つの数字の Pair をタップで選んで消していこう！Board の数字を全部消せば Stage Clear！！</div>
      ${modeTabs()}
      <div class="ja mode-desc">THE TEN で貯めた Coin を賭けるパチスロ。リールは自分で止める(目押し)。合計 10 の役と TEN TEN TEN の BIG BONUS。</div>
      <div class="rows">
        <div class="row"><span class="k">Coin</span><span class="v">${fmt(game.coins)}</span></div>
        <div class="row"><span class="k">最高の払い戻し</span><span class="v">${fmt(s.bestWin)}</span></div>
        <div class="row"><span class="k">回転 / BIG / REG</span><span class="v">${fmt(s.spins)} / ${s.bigs} / ${s.regs}</span></div>
        <div class="row"><span class="k">払い戻し率(これまで)</span><span class="v">${s.totalBet ? Math.round((s.totalWin / s.totalBet) * 100) + '%' : '·'}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-play">${slot.bonus ? `PLAY(${slot.bonus.kind === 'big' ? 'BIG' : 'REG'} BONUS 継続中)` : 'PLAY'}</button>
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
      </div>
      <div class="meta">${game.coins < CONFIG.slot.bets[0] ? 'Coin が無い。THE TEN で Stage を Clear すると貯まる' : 'payout ≈ 90%'}</div>`);
    bindTabs(card);
    card.querySelector('#ov-play').onclick = showSlot;
    card.querySelector('#ov-rules').onclick = showRules;
  }

  // Stage ごとの最高得点と Rank(腕前の記録。Coin やショップでは変わらない)
  function showRecords() {
    const best = game.progress.stageBest ?? {};
    const rows = stages.map((s) => {
      const b = best[s.stage];
      const r = game.progress.ranks[s.stage];
      const st = game.progress.stars[s.stage] ?? 0;
      return `<div class="row"><span class="k">STAGE ${pad2(s.stage)} <small>${s.cellsCount} cells</small></span><span class="v">${b ? fmt(b) : '·'} <span class="ranks"><span class="${r ?? ''}">${r ?? '·'}</span></span> <span class="rec-stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span></span></div>`;
    }).join('');
    const card = ui.showOverlay(`
      <div class="eyebrow">records · ${game.classic ? 'classic' : 'normal'}</div>
      <h1>Records</h1>
      <div class="ja">Stage ごとの最高得点、Rank、Star。Coin やショップで買った Add・Hint では変わらない、腕前の記録。</div>
      <div class="rows rec-rows">${rows}</div>
      <div class="actions"><button class="btn btn-primary" id="ov-back">Back</button></div>`);
    card.querySelector('#ov-back').onclick = showTitle;
  }

  function showRules() {
    const c = CONFIG, d = c.difficulty, h = c.hint;
    const card = ui.showOverlay(`
      <div class="eyebrow">how to play</div>
      <h1>How to Play</h1>
      <div class="rules">
        <b>Pair</b> とは、<span class="ex">同じ数字どうし</span>(4 と 4)か、<span class="ex">足して 10 になる 2 つ</span>(3 と 7、1 と 9)のこと。<br>
        <b>消せる Pair</b> は、次のどちらかの位置にある Pair。<br>
        ・縦・横・斜めの一直線上に並んでいて、2 つの間が全部空マス(隣どうしも含む)。<br>
        ・順番(左から右、上から下)で続いていて、間が全部空マス。行の右端と次の行の左端も続きとみなす。<br>
        <b>消し方</b>: 1 つ目の数字をタップし、2 つ目をタップする。Pair でなければ 2 つ目が選び直しになる。<br>
        <b>Score</b>: 1 Pair の得点 = ${c.score.pairBase} 点 × 難しさ倍率 × Chain 倍率 × Speed 倍率。難しさ倍率は、横の隣どうし ×1.0、縦 ×${d.vertical}、行をまたぐ ×${d.wrap}、斜め ×${d.diagonal}。2 つの間の空マス 1 つごとに +${d.gapPerCell}(他を消して初めて可能になる消し方)、斜めなら +${d.diagonalGapPerCell}。<br>
        <b>Chain</b>: Pair を消すたびに Chain 倍率が +${c.chain.step}(最大 ×${c.chain.max})。Add を使うと途切れて ×1.0 に戻る。${c.chain.decayGraceMs / 1000} 秒消さないでいると、${c.chain.decayStepMs / 1000} 秒ごとに 1 段階ずつ減る(ゲージ)。<br>
        <b>FEVER</b>: 倍率が ×${c.chain.max} に達すると ${c.fever.durationMs / 1000} 秒間 Score ×${c.fever.pointMult}。その間 Chain は減らず、Pair を消すたびに残り時間が ${c.fever.extendMs / 1000} 秒延びる(全体で ${c.fever.maxTotalMs / 1000} 秒まで)。終わると Chain は半分になる。<br>
        <b>Speed</b>: 前の消去から ${c.speed.quickMs / 1000} 秒以内なら QUICK(×${c.speed.quickMult})、${c.speed.fastMs / 1000} 秒以内なら FAST(×${c.speed.fastMult})。<br>
        <b>DIGIT CLEAR</b>: ある数字(たとえば 3)を Board から全部消し切ると、1 つの数字ごとに +${c.score.digitClear} × Chain 倍率。Add で戻ってきたらまた狙える。<br>
        <b>Line</b>: 1 行まるごと空になるとその行が Board から消え、${c.score.rowClear} 点 × (同時に消えた行数の 2 乗) × Chain 倍率が加算される。<br>
        <b>Add</b>: Board に残っている数字と同じ数字を末尾に書き足す。並びは、足したあとの Board が Add なしで全消しできることを確かめたうえで選ぶ(確かめられないときは残っている順)。使える回数は Stage ごとに決まっている。<br>
        <b>Hint</b>(使用上限 Stage ごとに ${h.perStage} 回。Chain 倍率で中身が変わる):<br>
        ・<span class="ex">HINT</span>(×1.0〜): 消せる Pair を 1 組示す。その Pair は得点 ${c.score.hintedPairRatio * 100}%、Chain は維持(増えない)。<br>
        ・<span class="ex">FLASH</span>(×${h.flashFrom} 以上): 消せる Pair を全部 ${h.flashMs / 1000} 秒だけ光らせる。ゲージが半分になる。消した Pair は全て獲得。<br>
        ・<span class="ex">SCOPE</span>(×${h.scopeFrom} 以上と FEVER 中): 相手のいるタイルを 1 枚光らせ、残り Pair 数を示す。相手は自分で探す。光ったタイルを含む Pair を消せば全て獲得(Chain は維持、Speed なし)。相手を外すと 1 回目 Chain −${h.scopeMissChain}、2 回目で Chain 半分。光ったタイルを使わず別の Pair を消しても Chain 半分。FEVER 中は使用回数の代わりに FEVER 時間 −${c.fever.hintTimeCostMs / 1000} 秒。<br>
        <b>Dead End</b>: 消せる Pair が無くなってもゲームは明示しない。Dead End になってから Add を押せば Chain は半分保持される。Dead End なのに Hint を押すと、使用回数 1 と Chain 半分、−${c.score.hintWhenStuck} 点。<br>
        <b>GIVE UP</b>: Add が尽きると ADD ボタンが GIVE UP になる。押すと Heart −1 だが、Stage 得点の半分は獲得できる。それに気づかず Hint を押すと Heart −1 で、Stage 得点を全部失い、さらに −${c.score.blindHintPenalty} 点。<br>
        <b>Heart</b>: 3 つ。尽きると Run は終わり、World のはじめから再開。<br>
        <b>ALL CLEAR</b>: Board を全部消すと +${c.score.stageClear} が入り、Chain と FEVER はそのまま次の Stage へ続く。Result の画面は World(5 Stage)の終わりに出る。Add を使わずに Clear すると Perfect Bonus +${c.score.perfect} と Heart 回復。残した Add 1 回ごとに +${c.score.addSaved}、残した Hint 1 回ごとに +${c.score.hintSaved}。Star は Add 0 回で ★★★、1 回で ★★、2 回以上で ★。<br>
        <b>CLASSIC モード</b>(Title のタブで切り替え。記録は NORMAL と別): 本家に近い遊び方。Chain 倍率・ゲージ・FEVER・Speed・Heart は無く、1 Pair ${c.score.pairBase} 点(横の隣どうし以外は +${c.classic.pathBonus})、Line ${c.score.rowClear} × 行数の 2 乗、DIGIT CLEAR ${c.classic.digitClear}。Add は ${c.classic.addsPerStage} 回、Hint は常に Pair を 1 組示す。Dead End はすぐ知らせ、Add も無ければ Stage 失敗(得点は半分残り、新しい Board でやり直し)。Perfect は Add も Hint も使わずに Clear。World で残した Add ${c.classic.investAddsPer} 回ごとに、次の World の各 Stage で Add +1(上限 +${c.classic.investAddsCap})。<br>
        <b>Quest</b>: Stage ごとに 1 つお題が出る(「3 を最初に消し切れ」「Add なしで 7 Chain」「斜めで 2 回消せ」「Hint を使わずに Clear」)。達成で +${c.quest.bonus}。どのお題も、その Board で達成できることを確かめてから出している。<br>
        <b>温存の投資</b>: World(5 Stage)で残した Add の回数が、次の World の開始 Chain(1 回ごとに +${c.invest.chainPerAdd}、上限 +${c.invest.chainCap})と Heart(${c.invest.addsPerHeart} 回ごとに +1)になる。<br>
        <b>Coin とショップ</b>: Stage を Clear すると、その Stage の得点がそのまま Coin として貯まる(Best Score とは別の累計。スロットでも使う)。Hint が尽きると HINT ボタンが BUY HINT(NORMAL ${fmt(c.shop.normal.hint)} / CLASSIC ${fmt(c.shop.classic.hint)} coin)、Add が尽きると ADD ボタンが BUY ADD(${fmt(c.shop.normal.add)} / ${fmt(c.shop.classic.add)} coin)に変わる。Heart はメニューから ${fmt(c.shop.normal.heart)} coin(NORMAL だけ)。買った Add・Hint は温存 Bonus と投資に数えない。買った Add を使えば Perfect は失う。<br>
        <b>SLOT</b>(Title のタブ): Coin を賭けるパチスロ。賭けは好きな枚数(1 枚以上、残高まで)。1〜2 枚は中段のみ、3〜4 枚で横 3 本、5 枚以上で斜めも 5 本。役は 1 ライン・1 枚あたり、TEN TEN TEN で BIG BONUS(${c.slot.payout.big} 枚 + ${c.slot.bonus.big.games} 回の高確率)、★★★ で REG BONUS(${c.slot.payout.reg} 枚 + ${c.slot.bonus.reg.games} 回)、同じ数字 3 つで数字 × ${c.slot.payout.samePerDigit}、合計 10 で ${c.slot.payout.ten}、足して 10 の Pair + ★ で ${c.slot.payout.pairStar}。払い戻しは賭け枚数を掛け、揃ったうち一番高い 1 本だけ。役は START の時点で決まっていて、リールを止めると押した位置から ${c.slot.pullIn.default} コマ先まで引き込む(合計 10 と Pair + ★ はもっと広い)。範囲の外で押すとこぼす。BONUS の役はこぼしても次の回に持ち越す。予告ランプが光ったら BONUS の役かもしれない(たまにガセ)。<br>
        <b>必殺技</b>(メニューから。Coin を大量に使う): SNIPE SHOT(NORMAL ${fmt(c.skill.normal.snipe)} / CLASSIC ${fmt(c.skill.classic.snipe)} coin)は数字を 2 つタップし、Pair なら位置に関係なく消す(得点と Chain は通常の消去と同じ)。LINE BREAK(${fmt(c.skill.normal.line)} / ${fmt(c.skill.classic.line)} coin)は 1 行を丸ごと消し、Line の得点 × Chain 倍率が入る。残った数字の組み合わせによっては Add が必要になる。Coin を使った Stage(ショップも必殺技も)は Stage ごとの最高得点に数えない。<br>
        <b>Rank</b>: Stage 得点が基準点(マス数 × ${c.rank.perCell})の ${c.rank.S} 倍以上で S、${c.rank.A} 倍で A、${c.rank.B} 倍で B、それ未満は C。
      </div>
      <div class="actions"><button class="btn btn-primary" id="ov-back">Back</button></div>`);
    card.querySelector('#ov-back').onclick = showTitle;
  }

  function showMenu() {
    const inPlay = game.stage?.status === 'play';
    const card = ui.showOverlay(`
      <div class="eyebrow">menu</div>
      <h1>Pause</h1>
      <div class="actions">
        <button class="btn btn-primary" id="ov-back">Resume</button>
        <button class="btn btn-ghost" id="ov-sound">Sound: ${sound.enabled ? 'ON' : 'OFF'}</button>
        <button class="btn btn-ghost" id="ov-bgm">BGM: ${bgm.label}</button>
        <div class="ja">${vs.active ? `VS · 合言葉 ${vs.code}` : `MODE: ${game.classic ? 'CLASSIC' : 'NORMAL'}(Title で切り替え) · Coin ${fmt(game.coins)}`}</div>
        ${inPlay && !vs.active ? game.skillItems().map((e) => `<button class="btn btn-ghost" data-skill="${e.skill}" ${e.can ? '' : 'disabled'}>${e.skill === 'line' ? 'LINE BREAK' : 'SNIPE SHOT'}<small>　${fmt(e.price)} coin · ${e.skill === 'line' ? '1 行を丸ごと消す' : '位置に関係なく Pair を 1 組消す'}</small></button>`).join('') : ''}
        ${inPlay && !vs.active && game.shopPrices.heart ? `<button class="btn btn-ghost" id="ov-buy-heart" ${game.shopItems().find((e) => e.item === 'heart')?.can ? '' : 'disabled'}>BUY HEART<small>　${fmt(game.shopPrices.heart)} coin · Heart ${game.run.lives}/${CONFIG.lives.max}</small></button>` : ''}
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
        ${inPlay ? (vs.active ? '<button class="btn btn-danger" id="ov-giveup">FINISH(得点を確定して終了)</button>' : `<button class="btn btn-danger" id="ov-giveup">GIVE UP(${game.classic ? '得点は半分残る' : 'Heart −1 · 得点は半分残る'})</button>`) : ''}
      </div>`);
    card.querySelector('#ov-back').onclick = () => { game.resume(Date.now()); ui.hideOverlay(); };
    card.querySelector('#ov-sound').onclick = () => { sound.setEnabled(!sound.enabled); soundLabel(); showMenu(); };
    if (game.stage?.skill) handle(game.cancelSkill());
    card.querySelector('#ov-bgm').onclick = () => { bgm.cycle(); showMenu(); };
    card.querySelector('#ov-rules').onclick = () => { showRules(); document.getElementById('ov-back').onclick = showMenu; };
    card.querySelector('#ov-title').onclick = showTitle;
    card.querySelector('#ov-buy-heart')?.addEventListener('click', () => { ui.hideOverlay(); handle(game.buy('heart')); });
    card.querySelectorAll('[data-skill]').forEach((b) => b.addEventListener('click', () => { ui.hideOverlay(); handle(game.armSkill(b.dataset.skill)); }));
    card.querySelector('#ov-giveup')?.addEventListener('click', () => { ui.hideOverlay(); if (vs.active) vsFinish('giveUp'); else handle(game.giveUp()); });
  }


  // ---------- VS(2 台のスマホで同じ Board) ----------
  // 部屋を作った側(host)が World と制限時間を選び、Board の cells をそのまま相手に送る。
  // 両端末は同じ Board を NORMAL のルールで同時に遊び、制限時間か ALL CLEAR か FINISH で得点を確定して比べる。
  // 進行中は game を VS 用の Game(保存しない)に差し替える。Heart・Coin・ショップ・必殺技は無い。
  const vs = {
    active: false, link: null, host: false, code: '', setup: null, playing: false, finished: false,
    startAt: 0, endAt: 0, myFinal: null, rivalFinal: null, rival: { score: 0, mult: 1, left: 1, total: 1, done: false, gone: false },
    lastSync: 0, lastSent: '', world: 0, timeLimitMs: CONFIG.vs.defaultTimeLimit,
  };
  const vsEl = (id) => document.getElementById(id);
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function showVsTitle() {
    const card = ui.showOverlay(`
      <div class="eyebrow">number match</div>
      <h1 class="big">THE TEN</h1>
      <div class="ja">同じ数字か、足して 10 になる 2 つの数字の Pair をタップで選んで消していこう！Board の数字を全部消せば Stage Clear！！</div>
      ${modeTabs()}
      <div class="ja mode-desc">2 台のスマホで同じ Board を同時に遊び、制限時間内の得点を競う。片方が部屋を作って合言葉を伝え、もう片方が合言葉で入る。ルールは NORMAL(Chain 倍率・FEVER)。Heart と Coin は無い。</div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-create">CREATE ROOM(部屋を作る)</button>
        <div class="code-input"><input id="vs-code-in" type="text" inputmode="latin" autocapitalize="characters" autocomplete="off" maxlength="4" placeholder="合言葉"><button class="btn btn-ghost" id="ov-join">JOIN</button></div>
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
      </div>
      <div class="meta">同じ Wi-Fi でなくてもつながる。仲介サーバーは接続のときだけ使い、得点は端末どうしで直接やり取りする</div>`);
    bindTabs(card);
    card.querySelector('#ov-create').onclick = () => { ensureAudio(); vsCreate(); };
    card.querySelector('#ov-join').onclick = () => { ensureAudio(); vsJoin(normalizeCode(card.querySelector('#vs-code-in').value)); };
    card.querySelector('#vs-code-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') card.querySelector('#ov-join').click(); });
    card.querySelector('#ov-rules').onclick = () => { showRules(); document.getElementById('ov-back').onclick = showTitle; };
  }

  function vsReset() {
    if (vs.link) { vs.link.close(); vs.link = null; }
    vs.active = false; vs.playing = false; vs.counting = false; vs.finished = false; vs.setup = null; vs.myFinal = null; vs.rivalFinal = null;
    vs.rival = { score: 0, mult: 1, left: 1, total: 1, done: false, gone: false };
    vsEl('vs-bar').hidden = true;
    document.body.classList.remove('vs');
  }
  /** VS をやめて通常の Game に戻す(Title へ戻るとき)。 */
  function leaveVs() {
    if (vs.link) vs.link.send({ t: 'leave' });
    vsReset();
    game = mainGame;
    applyMode();
    if (game.run && game.stage && game.stage.status === 'play') redraw();
  }

  function vsWire(link) {
    link.on('data', (d) => vsOnData(d));
    link.on('close', () => vsRivalGone('相手との接続が切れた'));
    link.on('error', (msg) => ui.toast(msg, 3000));
  }

  async function vsCreate() {
    vsReset();
    vs.active = true; vs.host = true;
    const card = ui.showOverlay(`<div class="eyebrow">vs</div><h1>Create Room</h1><div class="ja">仲介サーバーにつないでいる…</div>`);
    for (let tries = 0; tries < 5; tries++) {
      vs.code = makeCode();
      vs.link = new VsLink();
      try { await vs.link.host(vs.code); break; }
      catch (e) {
        vs.link.close(); vs.link = null;
        if (e.retry && tries < 4) continue;
        card.innerHTML = `<div class="eyebrow">vs</div><h1>Create Room</h1><div class="ja">${e.message}</div><div class="actions"><button class="btn btn-primary" id="ov-back">Back</button></div>`;
        card.querySelector('#ov-back').onclick = () => { vsReset(); showTitle(); };
        return;
      }
    }
    if (!vs.link) return;
    vsWire(vs.link);
    vs.link.on('open', () => { sound.lifeGain(); vibrate([20, 30, 20]); vs.link.send({ t: 'hello' }); showVsLobby(); });
    showVsLobby();
  }

  async function vsJoin(code) {
    if (code.length !== 4) { ui.toast('合言葉は 4 文字'); sound.invalid(); return; }
    vsReset();
    vs.active = true; vs.host = false; vs.code = code;
    const card = ui.showOverlay(`<div class="eyebrow">vs</div><h1>Join</h1><div class="ja">合言葉 ${code} の部屋を探している…</div>`);
    vs.link = new VsLink();
    vsWire(vs.link);
    try { await vs.link.join(code); }
    catch (e) {
      vs.link.close(); vs.link = null;
      card.innerHTML = `<div class="eyebrow">vs</div><h1>Join</h1><div class="ja">${e.message}</div><div class="actions"><button class="btn btn-primary" id="ov-back">Back</button></div>`;
      card.querySelector('#ov-back').onclick = () => { vsReset(); showTitle(); };
      return;
    }
    sound.lifeGain(); vibrate([20, 30, 20]);
    vs.link.send({ t: 'hello' });
    showVsLobby();
  }

  /** 部屋の画面。host は World と制限時間を選んで START。相手は待つ。 */
  function showVsLobby() {
    if (!vs.active || vs.playing) return;
    const connected = !!(vs.link && vs.link.open);
    const totalWorlds = Math.ceil(stages.length / CONFIG.worldSize);
    const worldChips = Array.from({ length: totalWorlds }, (_, w) => `<button class="btn btn-ghost chip ${vs.world === w ? 'on' : ''}" data-world="${w}">W${w + 1}<small>${stages[w * CONFIG.worldSize].cellsCount}〜 cells</small></button>`).join('');
    const timeChips = CONFIG.vs.timeLimits.map((ms) => `<button class="btn btn-ghost chip ${vs.timeLimitMs === ms ? 'on' : ''}" data-time="${ms}">${mmss(ms)}</button>`).join('');
    const card = ui.showOverlay(`
      <div class="eyebrow">vs · room</div>
      <h1>${vs.host ? 'Your Room' : 'Joined'}</h1>
      <div class="code">${vs.code}</div>
      <div class="ja">${vs.host ? (connected ? '相手がつながった。World と制限時間を選んで START。' : 'この合言葉を相手に伝える。相手が JOIN するまで待つ…') : (connected ? '相手(部屋の主)が START するのを待つ…' : 'つないでいる…')}</div>
      ${vs.host ? `<div class="ja" style="margin-top:10px">Board(World)</div><div class="opts">${worldChips}</div><div class="ja">制限時間</div><div class="opts">${timeChips}</div>` : ''}
      <div class="actions">
        ${vs.host ? `<button class="btn btn-primary" id="ov-start" ${connected ? '' : 'disabled'}>START</button>` : ''}
        <button class="btn btn-ghost" id="ov-title">Title へ(退出)</button>
      </div>`);
    card.querySelectorAll('[data-world]').forEach((b) => b.addEventListener('click', () => { vs.world = Number(b.dataset.world); sound.select(); showVsLobby(); }));
    card.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => { vs.timeLimitMs = Number(b.dataset.time); sound.select(); showVsLobby(); }));
    card.querySelector('#ov-start')?.addEventListener('click', () => vsHostStart());
    card.querySelector('#ov-title').onclick = () => { leaveVs(); showTitle(); };
  }

  function vsHostStart() {
    if (!vs.host || !vs.link?.open) return;
    const pick = pickBoard(stages, vs.world, CONFIG.worldSize);
    const setup = makeSetup(pick, { timeLimitMs: vs.timeLimitMs, world: vs.world });
    vs.link.send({ t: 'setup', setup });
    vsBegin(setup);
  }

  function vsOnData(d) {
    switch (d.t) {
      case 'hello': if (!vs.playing && !vs.counting) showVsLobby(); break;
      case 'setup': if (!vs.host) vsBegin(d.setup); break;
      case 'state': {
        vs.rival.score = d.score; vs.rival.mult = d.mult; vs.rival.left = d.left; vs.rival.total = d.total; vs.rival.fever = !!d.fever;
        vsRenderBar();
        break;
      }
      case 'final': {
        vs.rivalFinal = d;
        vs.rival.done = true; vs.rival.score = d.score;
        vsRenderBar();
        if (vs.finished) showVsResult();
        else ui.toast(`相手が得点を確定した: ${fmt(d.score)}`, 2500);
        break;
      }
      case 'leave': vsRivalGone('相手が退出した'); break;
      default: break;
    }
  }

  /** 相手がいなくなった(退出か切断)。対戦中なら続けて確定できる。終わっていれば結果に残す。部屋なら host は待ち直し、guest は VS の入口へ。 */
  function vsRivalGone(why) {
    if (!vs.active || vs.rival.gone) return;
    vs.rival.gone = true;
    if (vs.playing && !vs.finished) { ui.toast(`${why}。自分の得点は確定できる`, 3000); vsRenderBar(); return; }
    if (vs.finished || vs.myFinal) { showVsResult(); return; }
    ui.toast(why, 2500);
    if (vs.host) showVsLobby(); else { leaveVs(); titleTab = 'vs'; showTitle(); }
  }

  /** 3・2・1 のあと、同じ Board で始める。 */
  async function vsBegin(setup) {
    if (vs.counting) return;
    vs.counting = true;
    // 3・2・1 の間は playing を立てない(vsTick が時間切れと見なさないように)。endAt を決めてから playing にする
    vs.setup = setup; vs.playing = false; vs.finished = false; vs.myFinal = null; vs.rivalFinal = null;
    vs.rival = { ...vs.rival, score: 0, mult: 1, left: setup.cellsCount, total: setup.cellsCount, done: false };
    const def = stageDefFrom(setup);
    const vsGame = new Game([def], { ...CONFIG, vsMode: true, lives: { max: 1, start: 1 } }, null);
    busy = true;
    const card = ui.showOverlay(`<div class="eyebrow">vs · stage ${pad2(setup.stage)} · ${mmss(setup.timeLimitMs)}</div><div class="count" id="vs-count">3</div><div class="ja" style="text-align:center">同じ Board。制限時間内に高い得点を！</div>`);
    const steps = Math.round(CONFIG.vs.countdownMs / 1000);
    for (let k = steps; k >= 1; k--) {
      card.querySelector('#vs-count').textContent = String(k);
      sound.select();
      await sleep(1000);
    }
    card.querySelector('#vs-count').textContent = 'GO';
    sound.stageClear();
    await sleep(350);
    busy = false;
    game = vsGame;
    document.body.classList.add('vs');
    applyMode();
    vs.startAt = Date.now(); vs.endAt = vs.startAt + setup.timeLimitMs;
    vs.playing = true; vs.counting = false; vs.lastSent = '';
    vsEl('vs-bar').hidden = false;
    vsRenderBar();
    handle(game.newRun(0));
  }

  function vsRenderBar() {
    if (!vs.active || !vs.playing) return;
    const left = vs.endAt - Date.now();
    const t = vsEl('vs-time');
    t.textContent = mmss(left);
    t.classList.toggle('low', left <= 15000 && !vs.finished);
    vsEl('vs-rscore').textContent = fmt(vs.rival.score);
    vsEl('vs-rmult').textContent = vs.rival.fever ? 'FEVER' : `×${Number(vs.rival.mult).toFixed(1)}`;
    const total = Math.max(1, vs.rival.total);
    vsEl('vs-rprog').style.width = `${Math.round((1 - vs.rival.left / total) * 100)}%`;
    const st = vsEl('vs-rstate');
    st.className = 'vs-rstate' + (vs.rival.gone ? ' gone' : vs.rival.done ? ' done' : '');
    st.textContent = vs.rival.gone ? 'LOST' : vs.rival.done ? 'DONE' : `${vs.rival.left} left`;
  }

  /** 200ms ごと: 残り時間、相手への同期、時間切れ。 */
  function vsTick() {
    if (!vs.playing) return;
    const now = Date.now();
    vsRenderBar();
    if (!vs.finished && now >= vs.endAt) { vsFinish('time'); return; }
    if (!vs.finished && vs.link?.open && now - vs.lastSync >= CONFIG.vs.syncMs && game.stage) {
      const left = game.stage.board.filter((c) => c !== 0).length;
      const msg = { t: 'state', score: game.run.score, mult: Number(game.multiplier.toFixed(1)), left, total: vs.setup.cellsCount, fever: game.inFever };
      const key = JSON.stringify(msg);
      if (key !== vs.lastSent) { vs.link.send(msg); vs.lastSent = key; }
      vs.lastSync = now;
    }
  }

  /** ALL CLEAR: 残り時間の Bonus を足して確定。 */
  async function onVsClear(ev) {
    busy = true;
    sound.stageClear(); fx.fireworks(ev.perfect ? 9 : 6); punch();
    const remain = Math.max(0, vs.endAt - Date.now());
    const timeBonus = Math.floor(remain / 1000) * CONFIG.vs.timeBonusPerSec;
    game.run.score += timeBonus;
    const cx = innerWidth / 2, cy = innerHeight * 0.42;
    fx.floatText(cx, cy, 'ALL CLEAR', { color: PALETTE.amber, size: 42, dy: -30, life: 2.0 });
    fx.floatText(cx, cy + 44, `TIME BONUS +${fmt(timeBonus)}`, { color: PALETTE.green, size: 20, dy: -30, life: 2.0 });
    ui.renderHud(game);
    await sleep(1200);
    busy = false;
    vsFinish('clear', { timeBonus, perfect: ev.perfect });
  }

  /** 自分の得点を確定して相手に送る。相手も確定していれば結果へ。 */
  function vsFinish(reason, extra = {}) {
    if (!vs.playing || vs.finished) return;
    vs.finished = true;
    if (game.stage && game.stage.status === 'play') game.stage.status = 'failed';   // これ以上の操作を受けない
    vs.myFinal = { t: 'final', score: game.run.score, maxMult: game.multiplierFor(game.run.maxChain ?? 0), reason, ...extra };
    if (vs.link?.open) vs.link.send(vs.myFinal);
    vsRenderBar();
    if (reason === 'time') { sound.feverEnd(); vibrate([80, 50, 80]); fx.flash('rgba(255,255,255,0.18)'); }
    if (vs.rivalFinal || vs.rival.gone) { showVsResult(); return; }
    const card = ui.showOverlay(`
      <div class="eyebrow">vs · ${reason === 'time' ? 'time up' : reason === 'clear' ? 'all clear' : 'finished'}</div>
      <h1 class="big">${fmt(vs.myFinal.score)}</h1>
      <div class="ja">得点を確定した。相手が終わるのを待っている…(相手 ${fmt(vs.rival.score)}、残り ${vs.rival.left} cells)</div>
      <div class="actions"><button class="btn btn-ghost" id="ov-title">Title へ(退出)</button></div>`);
    card.querySelector('#ov-title').onclick = () => { leaveVs(); showTitle(); };
  }

  function showVsResult() {
    vs.playing = false;
    const me = vs.myFinal?.score ?? 0;
    const rv = vs.rivalFinal?.score ?? null;
    const gone = rv === null;
    const win = gone ? null : me > rv ? 'win' : me < rv ? 'lose' : 'draw';
    const title = gone ? 'No Contest' : win === 'win' ? 'YOU WIN' : win === 'lose' ? 'YOU LOSE' : 'DRAW';
    if (win === 'win') { sound.perfect(); fx.fireworks(8); } else if (win === 'lose') sound.fail(); else sound.stageClear();
    const reasonText = { time: '時間切れ', clear: 'ALL CLEAR', giveUp: 'FINISH', stuck: '詰み' };
    const card = ui.showOverlay(`
      <div class="eyebrow">vs · stage ${pad2(vs.setup.stage)} · ${mmss(vs.setup.timeLimitMs)}</div>
      <h1 class="big ${win === 'win' ? 'vs-win' : win === 'lose' ? 'vs-lose' : ''}">${title}</h1>
      <div class="vs-scores">
        <div class="side ${win === 'win' ? 'win' : ''}"><div class="who">YOU</div><div class="pts">${fmt(me)}</div></div>
        <div class="side ${win === 'lose' ? 'win' : ''}"><div class="who">RIVAL</div><div class="pts">${gone ? '—' : fmt(rv)}</div></div>
      </div>
      <div class="rows">
        <div class="row"><span class="k">終わり方(自分 / 相手)</span><span class="v">${reasonText[vs.myFinal?.reason] ?? '·'} / ${gone ? '接続が切れた' : (reasonText[vs.rivalFinal.reason] ?? '·')}</span></div>
        <div class="row"><span class="k">最高倍率(自分 / 相手)</span><span class="v">×${(vs.myFinal?.maxMult ?? 1).toFixed(1)} / ${gone ? '·' : '×' + Number(vs.rivalFinal.maxMult ?? 1).toFixed(1)}</span></div>
        ${vs.myFinal?.timeBonus ? `<div class="row"><span class="k">Time Bonus(自分)</span><span class="v plus">+${fmt(vs.myFinal.timeBonus)}</span></div>` : ''}
      </div>
      <div class="actions">
        ${vs.rival.gone ? '<div class="ja">相手は退出した。もう一度遊ぶには Title から部屋を作り直す</div>' : ''}
        ${vs.host && !vs.rival.gone ? '<button class="btn btn-primary" id="ov-rematch">REMATCH(新しい Board)</button>' : ''}
        ${!vs.host && !vs.rival.gone ? '<div class="ja">部屋の主が REMATCH を押すと次の対戦が始まる</div>' : ''}
        <button class="btn btn-ghost" id="ov-review">感想戦(手の評価)</button>
        <button class="btn btn-ghost" id="ov-title">Title へ(退出)</button>
      </div>`);
    card.querySelector('#ov-rematch')?.addEventListener('click', () => { vs.playing = false; showVsLobby(); });
    card.querySelector('#ov-review').onclick = () => showReview(showVsResult);
    card.querySelector('#ov-title').onclick = () => { leaveVs(); showTitle(); };
  }

  // ---------- 入力 ----------
  ui.board.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cell');
    if (!el || busy || overlayOpen() || slotActive) return;
    ensureAudio();
    handle(game.tap(Number(el.dataset.pos), Date.now()));
  });
  document.getElementById('btn-add').onclick = () => {
    if (busy || overlayOpen()) return;
    ensureAudio();
    const shop = game.shopItems().find((e) => e.item === 'add');
    if (vs.active && game.stage?.addsLeft <= 0) { vsFinish('giveUp'); return; }
    if (game.stage?.addsLeft <= 0 && shop && shop.can) handle(game.buy('add'));
    else handle(game.useAdd(Date.now()));
  };
  document.getElementById('btn-hint').onclick = () => {
    if (busy || overlayOpen()) return;
    ensureAudio();
    const shop = game.shopItems().find((e) => e.item === 'hint');
    if (game.stage?.hintsLeft <= 0 && shop && shop.can) handle(game.buy('hint'));
    else handle(game.useHint());
  };
  document.getElementById('btn-menu').onclick = showMenu;
  soundLabel();

  // 手元で動かすときだけ、検査用に中身を見えるようにする
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') globalThis.__ten = { get game() { return game; }, bgm, sound, vs };

  // ---------- 起動 ----------
  applyMode();
  if (game.run && game.stage && game.stage.status === 'play') redraw();
  showTitle();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

boot().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f87171;padding:16px;font:12px monospace">起動に失敗: ${err?.message ?? err}</pre>`);
  console.error(err);
});
