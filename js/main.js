// 起点。面データを読み、Game / Renderer / FX / Sound をつなぐ。
// 入力 → game.*() → イベントの配列 → handle() で画面・演出・音に振り分ける。
// 時間 → game.tick() を 200ms ごとに呼び、Chain ゲージと FEVER を進める。

import { CONFIG } from './config.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { FX, heatColor, PALETTE } from './fx.js';
import { Sound, vibrate } from './audio.js';
import { Bgm } from './bgm.js';
import { WIDTH, validPairs } from './rules.js';

const fmt = (n) => n.toLocaleString('en-US');
const pad2 = (n) => String(n).padStart(2, '0');

async function boot() {
  const res = await fetch('levels/stages.json');
  const stages = await res.json();

  const game = new Game(stages, CONFIG);
  const ui = new Renderer(document);
  const fx = new FX(document.getElementById('fx'), CONFIG.fx);
  const sound = new Sound(CONFIG.audio.masterVolume);
  const bgm = new Bgm(CONFIG.bgm);
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
  }
  function soundLabel() {
    document.getElementById('btn-sound-state').textContent = sound.enabled ? 'sound on' : 'sound off';
  }
  // 画面全体を一瞬だけ膨らませ、背景の格子を光らせる(大きな出来事の手応え)
  function punch() {
    app.classList.remove('punch'); void app.offsetWidth; app.classList.add('punch');
    document.body.classList.remove('gridflash'); void document.body.offsetWidth; document.body.classList.add('gridflash');
  }

  // ---------- 時間 ----------
  // Chain ゲージと FEVER は時間で動くので、定期的に進めて HUD を描き直す
  setInterval(() => {
    // BGM: Stage 中は Chain の熱と FEVER に合わせ、Title では止める。オーバーレイ中は小さく
    if (game.stage?.status === 'play' || game.stage?.status === 'clear') { bgm.setHeat(game.heat); bgm.setFever(game.inFever); bgm.play('normal'); }
    else if (titleShown) bgm.stop();
    bgm.duck(overlayOpen());
    if (!game.stage || game.stage.status !== 'play' || overlayOpen()) return;
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
          ui.selectCell(ev.pos);
          sound.select(); vibrate(8);
          break;
        }
        case 'deselect': {
          ui.cellEl(ev.pos)?.classList.remove('selected');
          sound.deselect();
          break;
        }
        case 'invalid': {
          ui.cellEl(ev.from)?.classList.remove('selected');
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
        case 'noHints': ui.toast('Hint の使用上限に達した'); sound.invalid(); break;
        case 'noHint': {
          // Pair が残っていないのに Hint を押した(Dead End)
          lineStreak = 0;
          redraw();
          if (ev.blind) ui.toast(`Pair はもう無く、Add も無かった… −${fmt(ev.penalty)}`, 3000);
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
          if (ev.stuckBefore && ev.chainBefore > 0) {
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
          ui.hideOverlay();
          redraw();
          ui.boardWrap.scrollTo({ top: 0 });
          break;
        }
        case 'stageClear': await onStageClear(ev); break;
        case 'stageFailed': await onStageFailed(ev); break;
        case 'runOver': await onRunOver(ev); break;
        case 'complete': showComplete(ev); break;
        default: break;
      }
    }
  }

  async function onRemove(ev) {
    busy = true;
    const color = ev.fever ? PALETTE.rose : heatColor(ev.heat);
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
      for (const c of [ci, cj]) fx.burst(c.x, c.y, { color, count, power, size: 3 + speedBoost + feverBoost });
      if (ev.heat > 0.5 || speedBoost > 0 || feverBoost) fx.ring(mx, my, color, 40 + ev.heat * 60 + speedBoost * 30 + feverBoost * 40);
      const target = ui.scoreCenter();
      fx.flyText(mx, my, target.x, target.y, `+${ev.pairPoints}`, { color, size: 18 + ev.heat * 10 + speedBoost * 4 + feverBoost * 6, dur: 0.5 });
      // 難しい道・速さのラベル(難しさは倍率で表示)
      const labels = [...ev.labels];
      if (ev.diffMult > 1) labels.unshift(`×${ev.diffMult.toFixed(2).replace(/0$/, '')}`);
      if (ev.speed === 'fast') labels.push('FAST!!');
      else if (ev.speed === 'quick') labels.push('QUICK');
      labels.forEach((text, k) => {
        const lc = text === 'FAST!!' ? PALETTE.rose : text === 'QUICK' ? PALETTE.amber : text === 'LONG SHOT' || text === 'DIAGONAL SNIPE' ? PALETTE.purple : text === 'SCOPE' || text === 'HINTED' ? PALETTE.red : text.startsWith('×') ? PALETTE.white : PALETTE.green;
        fx.floatText(mx, my - 36 - k * 22, text, { color: lc, size: 15 + (text === 'FAST!!' ? 4 : 0), dy: -45, life: 1.1 });
      });
      if (ev.chain >= 5 && ev.chain % 5 === 0) {
        fx.floatText(mx, my + 30, `${ev.chain} CHAIN  ×${ev.mult.toFixed(1)}`, { color: PALETTE.white, size: 16, dy: -30, life: 1.3 });
      }
    }
    ui.markRemoving(ev.i, ev.j);
    sound.remove(ev.chain, ev.heat);
    vibrate(12 + Math.round(ev.heat * 20));
    fx.shake(ui.boardWrap, CONFIG.fx.shakeBase * (0.5 + ev.heat * 1.5 + speedBoost + feverBoost), 160);

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

  async function onStageClear(ev) {
    busy = true;
    await sleep(200);
    sound.stageClear();
    fx.fireworks(ev.perfect ? 9 : 6);
    punch();
    if (ev.perfect) { setTimeout(() => sound.perfect(), 300); fx.flash('rgba(62,207,142,0.2)'); }
    vibrate([40, 60, 40, 60, 120]);
    await sleep(700);
    const card = ui.showOverlay(`
      <div class="eyebrow">stage ${pad2(ev.stage)}</div>
      <h1>${ev.perfect ? 'Perfect!' : 'Stage Clear'}</h1>
      <div class="ja">${ev.perfect ? 'Add なしで Clear！！Heart が回復！' : ev.isLast ? '最後の Stage を突破！！' : 'ALL CLEAR!!'}</div>
      <div class="result">
        <div class="rank ${ev.rank}" id="ov-rank">${ev.rank}</div>
        <div class="stars"><span class="star">★</span><span class="star">★</span><span class="star">★</span></div>
      </div>
      <div class="rows">
        <div class="row"><span class="k">Play Score</span><span class="v">${fmt(ev.playScore)}</span></div>
        <div class="row"><span class="k">Clear Bonus</span><span class="v plus">+${fmt(ev.clearBonus)}</span></div>
        ${ev.perfect ? `<div class="row"><span class="k">Perfect Bonus</span><span class="v plus">+${fmt(ev.perfectBonus)}</span></div>` : ''}
        ${ev.savedBonus ? `<div class="row"><span class="k">Add 温存 Bonus(${ev.addsLeft} 回)</span><span class="v plus">+${fmt(ev.savedBonus)}</span></div>` : ''}
        ${ev.hintBonus ? `<div class="row"><span class="k">Hint 温存 Bonus(${ev.hintsLeft} 回)</span><span class="v plus">+${fmt(ev.hintBonus)}</span></div>` : ''}
        ${ev.lifeGain ? `<div class="row"><span class="k">Heart 回復</span><span class="v plus">+${ev.lifeGain} ♥</span></div>` : ''}
        <div class="row"><span class="k">Add の使用</span><span class="v">${ev.addsUsed} 回</span></div>
        <div class="row total"><span class="k">Total Score</span><span class="v">${fmt(ev.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-next">${ev.isLast ? 'Result を見る' : 'Next Stage →'}</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
    ui.animateStars(card, ev.stars);
    setTimeout(() => { card.querySelector('#ov-rank')?.classList.add('show'); if (ev.rank === 'S') { sound.perfect(); fx.fireworks(4); } }, 1100);
    if (ev.lifeGain) { ui.renderLives(game.run.lives, CONFIG.lives.max, { gained: true }); sound.lifeGain(); }
    ui.renderHud(game);
    card.querySelector('#ov-next').onclick = () => { busy = false; handle(game.nextStage()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; showTitle(); };
  }

  async function onStageFailed(ev) {
    busy = true;
    if (ev.reason === 'giveUp') sound.giveUp(); else sound.fail();
    vibrate([80, 50, 80]);
    ui.renderLives(ev.lives + 1, CONFIG.lives.max, { lost: true });
    fx.flash('rgba(239,68,68,0.18)');
    fx.shake(ui.boardWrap, 8, 400);
    await sleep(900);
    const title = ev.reason === 'giveUp' ? 'Give Up' : ev.reason === 'blindHint' ? 'Stuck' : 'Stuck';
    const text = ev.reason === 'giveUp'
      ? 'Stage をあきらめた。Stage 得点の半分は獲得できる。'
      : ev.reason === 'blindHint'
        ? '消せる Pair は無く Add も無いのに Hint を押してしまった… '
        : '消せる Pair が無く、Add も残っていない…';
    const card = ui.showOverlay(`
      <div class="eyebrow">stage ${pad2(ev.stage)}</div>
      <h1>${title}</h1>
      <div class="ja">${text} Heart を 1 つ失った。</div>
      <div class="rows">
        <div class="row"><span class="k">失った Stage 得点</span><span class="v minus">−${fmt(ev.lost)}</span></div>
        ${ev.kept ? `<div class="row"><span class="k">残った Stage 得点</span><span class="v plus">${fmt(ev.kept)}</span></div>` : ''}
        <div class="row"><span class="k">残り Heart</span><span class="v">${'♥'.repeat(ev.lives)}${'♡'.repeat(CONFIG.lives.max - ev.lives)}</span></div>
        <div class="row total"><span class="k">Score</span><span class="v">${fmt(game.run.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-warn" id="ov-retry">新しい Board で Retry</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
      </div>`);
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
      <div class="rows">
        <div class="row"><span class="k">Best Score</span><span class="v">${fmt(game.progress.bestScore)}</span></div>
        <div class="row"><span class="k">Star</span><span class="v">★ ${game.totalStars} / ${stages.length * 3}</span></div>
        <div class="row"><span class="k">Rank</span><span class="v">${rankSummary()}</span></div>
      </div>
      <div class="actions">
        ${canResume ? `<button class="btn btn-primary" id="ov-resume">Continue (STAGE ${pad2(game.stageDef.stage)})</button>` : ''}
        <button class="btn ${canResume ? 'btn-ghost' : 'btn-primary'}" id="ov-new">New Game</button>
        <div class="worlds">${worlds.join('')}</div>
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
      </div>
      <div class="meta">rules verified</div>`);
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
        <b>FEVER</b>: 倍率が ×${c.chain.max} に達すると ${c.fever.durationMs / 1000} 秒間 Score ×${c.fever.pointMult}。その間 Chain は減らない。終わると Chain は半分になる。<br>
        <b>Speed</b>: 前の消去から ${c.speed.quickMs / 1000} 秒以内なら QUICK(×${c.speed.quickMult})、${c.speed.fastMs / 1000} 秒以内なら FAST(×${c.speed.fastMult})。<br>
        <b>Line</b>: 1 行まるごと空になるとその行が Board から消え、${c.score.rowClear} 点 × (同時に消えた行数の 2 乗) × Chain 倍率が加算される。<br>
        <b>Add</b>: Board に残っている数字と同じ数字を末尾に書き足す。並びは、足したあとの Board が Add なしで全消しできることを確かめたうえで選ぶ(確かめられないときは残っている順)。使える回数は Stage ごとに決まっている。<br>
        <b>Hint</b>(使用上限 Stage ごとに ${h.perStage} 回。Chain 倍率で中身が変わる):<br>
        ・<span class="ex">HINT</span>(×1.0〜): 消せる Pair を 1 組示す。その Pair は得点 ${c.score.hintedPairRatio * 100}%、Chain は維持(増えない)。<br>
        ・<span class="ex">FLASH</span>(×${h.flashFrom} 以上): 消せる Pair を全部 ${h.flashMs / 1000} 秒だけ光らせる。ゲージが半分になる。消した Pair は全て獲得。<br>
        ・<span class="ex">SCOPE</span>(×${h.scopeFrom} 以上と FEVER 中): 相手のいるタイルを 1 枚光らせ、残り Pair 数を示す。相手は自分で探す。光ったタイルを含む Pair を消せば全て獲得(Chain は維持、Speed なし)。相手を外すと 1 回目 Chain −${h.scopeMissChain}、2 回目で Chain 半分。光ったタイルを使わず別の Pair を消しても Chain 半分。FEVER 中は使用回数の代わりに FEVER 時間 −${c.fever.hintTimeCostMs / 1000} 秒。<br>
        <b>Dead End</b>: 消せる Pair が無くなってもゲームは明示しない。Dead End になってから Add を押せば Chain は半分保持される。Dead End なのに Hint を押すと、使用回数 1 と Chain 半分、−${c.score.hintWhenStuck} 点。<br>
        <b>GIVE UP</b>: Add が尽きると ADD ボタンが GIVE UP になる。押すと Heart −1 だが、Stage 得点の半分は獲得できる。それに気づかず Hint を押すと Heart −1 で、Stage 得点を全部失い、さらに −${c.score.blindHintPenalty} 点。<br>
        <b>Heart</b>: 3 つ。尽きると Run は終わり、World のはじめから再開。<br>
        <b>Clear</b>: Clear Bonus +${c.score.stageClear}。Add を使わずに Clear すると Perfect Bonus +${c.score.perfect} と Heart 回復。残した Add 1 回ごとに +${c.score.addSaved}、残した Hint 1 回ごとに +${c.score.hintSaved}。Star は Add 0 回で ★★★、1 回で ★★、2 回以上で ★。<br>
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
        <button class="btn btn-ghost" id="ov-bgm">BGM: ${bgm.enabled ? 'ON' : 'OFF'}</button>
        <button class="btn btn-ghost" id="ov-rules">How to Play</button>
        <button class="btn btn-ghost" id="ov-title">Title へ</button>
        ${inPlay ? '<button class="btn btn-danger" id="ov-giveup">GIVE UP(Heart −1 · 得点は半分残る)</button>' : ''}
      </div>`);
    card.querySelector('#ov-back').onclick = () => { game.resume(Date.now()); ui.hideOverlay(); };
    card.querySelector('#ov-sound').onclick = () => { sound.setEnabled(!sound.enabled); soundLabel(); showMenu(); };
    card.querySelector('#ov-bgm').onclick = () => { bgm.setEnabled(!bgm.enabled); showMenu(); };
    card.querySelector('#ov-rules').onclick = () => { showRules(); document.getElementById('ov-back').onclick = showMenu; };
    card.querySelector('#ov-title').onclick = showTitle;
    card.querySelector('#ov-giveup')?.addEventListener('click', () => { ui.hideOverlay(); handle(game.giveUp()); });
  }

  // ---------- 入力 ----------
  ui.board.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cell');
    if (!el || busy || overlayOpen()) return;
    ensureAudio();
    handle(game.tap(Number(el.dataset.pos), Date.now()));
  });
  document.getElementById('btn-add').onclick = () => { if (!busy && !overlayOpen()) { ensureAudio(); handle(game.useAdd(Date.now())); } };
  document.getElementById('btn-hint').onclick = () => { if (!busy && !overlayOpen()) { ensureAudio(); handle(game.useHint()); } };
  document.getElementById('btn-menu').onclick = showMenu;
  soundLabel();

  // ---------- 起動 ----------
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
