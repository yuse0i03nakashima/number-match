// 起点。面データを読み、Game / Renderer / FX / Sound をつなぐ。
// 入力 → game.*() → イベントの配列 → handle() で画面・演出・音に振り分ける。

import { CONFIG } from './config.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { FX, heatColor, PALETTE } from './fx.js';
import { Sound, vibrate } from './audio.js';
import { WIDTH } from './rules.js';

const fmt = (n) => n.toLocaleString('en-US');

async function boot() {
  const res = await fetch('levels/stages.json');
  const stages = await res.json();

  const game = new Game(stages, CONFIG);
  const ui = new Renderer(document);
  const fx = new FX(document.getElementById('fx'), CONFIG.fx);
  const sound = new Sound(CONFIG.audio.masterVolume);
  let busy = false;   // 消去アニメ中の多重入力を防ぐ

  // ---------- 描き直し ----------
  function redraw(opts = {}) {
    const st = game.stage;
    if (!st) return;
    ui.renderBoard(st.board, { selected: st.selected, hintPair: st.hintPair, ...opts });
    ui.renderHud(game);
    ui.urgeAdd(false);
  }
  function soundLabel() {
    document.getElementById('btn-sound-state').textContent = sound.enabled ? 'sound on' : 'sound off';
  }

  // ---------- イベントの振り分け ----------
  async function handle(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'select': {
          ui.cellEl(ev.pos)?.classList.add('selected');
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
        case 'stuck': {
          ui.toast(`消せる組がありません — ＋ADD で数字を追加(残り ${ev.addsLeft})`, 2600);
          ui.urgeAdd(true);
          sound.stuck();
          break;
        }
        case 'noAdds': ui.toast('追加はもう使えません'); sound.invalid(); break;
        case 'noHint': ui.toast('消せる組がありません'); sound.invalid(); break;
        case 'add': {
          sound.add(); vibrate(25);
          redraw({ addedFrom: ev.oldLength });
          if (ev.brokeChain) ui.toast('チェーンが切れた …×1.0');
          // 追加された行が見えるように下へ
          requestAnimationFrame(() => ui.boardWrap.scrollTo({ top: ui.boardWrap.scrollHeight, behavior: 'smooth' }));
          break;
        }
        case 'hint': {
          sound.hint();
          redraw();
          if (ev.brokeChain) ui.toast('ヒント: チェーンが切れた …×1.0');
          const c = ui.cellCenter(ev.pair[0]);
          if (c) fx.ring(c.x, c.y, PALETTE.amber, 50);
          break;
        }
        case 'stageStart': {
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
    const color = heatColor(ev.heat);
    const ci = ui.cellCenter(ev.i), cj = ui.cellCenter(ev.j);
    const power = 0.8 + ev.heat * 1.4;

    // 1. 2 マスを結ぶ光、両端で爆ぜる
    if (ci && cj) {
      fx.flashLine(ci.x, ci.y, cj.x, cj.y, color, 3 + ev.heat * 3);
      for (const c of [ci, cj]) fx.burst(c.x, c.y, { color, count: CONFIG.fx.particlesPerRemove + Math.round(ev.heat * 20), power, size: 3 });
      const mx = (ci.x + cj.x) / 2, my = (ci.y + cj.y) / 2;
      fx.floatText(mx, my - 10, `+${ev.pairPoints}`, { color, size: 16 + ev.heat * 10 });
      if (ev.chain >= 5 && ev.chain % 5 === 0) {
        fx.floatText(mx, my - 40, `${ev.chain} CHAIN  ×${ev.mult.toFixed(1)}`, { color: PALETTE.white, size: 14, dy: -40, life: 1.2 });
      }
    }
    ui.markRemoving(ev.i, ev.j);
    sound.remove(ev.chain, ev.heat);
    vibrate(12 + Math.round(ev.heat * 20));
    fx.shake(ui.boardWrap, CONFIG.fx.shakeBase * (0.5 + ev.heat * 1.5), 160);

    // 2. 行が消えるなら、ひと呼吸おいて横一閃+大量の粒子+揺れ
    if (ev.clearedRows.length > 0) {
      await sleep(140);
      ui.markRowsRemoving(ev.clearedRows);
      const rows = ev.clearedRows.map((r) => ui.rowRect(r)).filter(Boolean);
      for (const r of rows) {
        fx.rowSweep(r.y, r.h, color);
        for (let k = 0; k < WIDTH; k++) {
          const x = innerWidth / 2 + (k - 4) * (r.h + 6);
          fx.burst(x, r.y + r.h / 2, { color: k % 2 ? color : PALETTE.white, count: Math.round(CONFIG.fx.particlesPerRow / WIDTH), power: 1.2 + ev.heat, size: 3.5 });
        }
      }
      const n = ev.clearedRows.length;
      const y = rows.length ? rows[0].y : innerHeight / 2;
      fx.floatText(innerWidth / 2, y - 30, n > 1 ? `${n} LINES  +${ev.rowPoints}` : `LINE  +${ev.rowPoints}`, { color: PALETTE.amber, size: 22, dy: -60, life: 1.3 });
      fx.flash(n > 1 ? 'rgba(245,166,35,0.25)' : 'rgba(255,255,255,0.14)');
      fx.shake(ui.boardWrap, 6 + n * 3, 320);
      sound.rowClear(n);
      vibrate([30, 40, 60]);
      await sleep(220);
    } else {
      await sleep(180);
    }
    redraw();
    ui.bumpScore();
    busy = false;
  }

  async function onStageClear(ev) {
    busy = true;
    await sleep(200);
    sound.stageClear();
    fx.fireworks(ev.perfect ? 9 : 6);
    if (ev.perfect) { setTimeout(() => sound.perfect(), 300); fx.flash('rgba(62,207,142,0.2)'); }
    vibrate([40, 60, 40, 60, 120]);
    await sleep(700);
    const card = ui.showOverlay(`
      <div class="eyebrow">stage ${String(ev.stage).padStart(2, '0')}</div>
      <h1>${ev.perfect ? 'Perfect!' : 'Stage Clear'}</h1>
      <div class="ja">${ev.perfect ? '追加なしで全消し。ハートが回復。' : ev.isLast ? '最後のステージを突破。' : '盤面をすべて消した。'}</div>
      <div class="stars"><span class="star">★</span><span class="star">★</span><span class="star">★</span></div>
      <div class="rows">
        <div class="row"><span class="k">ステージ得点</span><span class="v">${fmt(ev.stageScore - ev.clearBonus - ev.perfectBonus)}</span></div>
        <div class="row"><span class="k">クリアボーナス</span><span class="v plus">+${fmt(ev.clearBonus)}</span></div>
        ${ev.perfect ? `<div class="row"><span class="k">パーフェクト</span><span class="v plus">+${fmt(ev.perfectBonus)}</span></div>` : ''}
        ${ev.lifeGain ? `<div class="row"><span class="k">ハート回復</span><span class="v plus">+${ev.lifeGain} ♥</span></div>` : ''}
        <div class="row"><span class="k">追加の使用</span><span class="v">${ev.addsUsed} 回</span></div>
        <div class="row total"><span class="k">合計スコア</span><span class="v">${fmt(ev.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-next">${ev.isLast ? '結果を見る' : '次のステージ →'}</button>
        <button class="btn btn-ghost" id="ov-title">タイトルへ</button>
      </div>`);
    ui.animateStars(card, ev.stars);
    if (ev.lifeGain) { ui.renderLives(game.run.lives, CONFIG.lives.max, { gained: true }); sound.lifeGain(); }
    ui.renderHud(game);
    card.querySelector('#ov-next').onclick = () => { busy = false; handle(game.nextStage()); };
    card.querySelector('#ov-title').onclick = () => { busy = false; showTitle(); };
  }

  async function onStageFailed(ev) {
    busy = true;
    sound.fail(); vibrate([80, 50, 80]);
    ui.renderLives(ev.lives + 1, CONFIG.lives.max, { lost: true });
    fx.flash('rgba(239,68,68,0.18)');
    fx.shake(ui.boardWrap, 8, 400);
    await sleep(900);
    const card = ui.showOverlay(`
      <div class="eyebrow">stage ${String(ev.stage).padStart(2, '0')}</div>
      <h1>${ev.reason === 'giveUp' ? 'Give Up' : 'Stuck'}</h1>
      <div class="ja">${ev.reason === 'giveUp' ? 'ステージをあきらめた。' : '消せる組がなく、追加も残っていない。'}ハートを 1 つ失った。</div>
      <div class="rows">
        <div class="row"><span class="k">失ったステージ得点</span><span class="v minus">−${fmt(ev.lost)}</span></div>
        <div class="row"><span class="k">残りハート</span><span class="v">${'♥'.repeat(ev.lives)}${'♡'.repeat(CONFIG.lives.max - ev.lives)}</span></div>
        <div class="row total"><span class="k">スコア</span><span class="v">${fmt(game.run.score)}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-warn" id="ov-retry">新しい盤で再挑戦</button>
        <button class="btn btn-ghost" id="ov-title">タイトルへ</button>
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
      <div class="ja">ハートが尽きた。${ev.score >= ev.best && ev.score > 0 ? 'ベストスコア更新。' : `ベスト ${fmt(ev.best)}。`}</div>
      <div class="rows">
        <div class="row"><span class="k">到達ステージ</span><span class="v">${String(ev.stage).padStart(2, '0')}</span></div>
        <div class="row"><span class="k">再開地点</span><span class="v">WORLD ${w} (STAGE ${String(ev.resumeStage + 1).padStart(2, '0')})</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-restart">ワールド ${w} の先頭から</button>
        <button class="btn btn-ghost" id="ov-title">タイトルへ</button>
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
      <div class="ja">全ステージを突破。合計 ${fmt(ev.score)} 点、ベスト ${fmt(ev.best)} 点。</div>
      <div class="rows">
        <div class="row"><span class="k">集めた星</span><span class="v">${game.totalStars} / ${stages.length * 3}</span></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="ov-title">タイトルへ</button>
      </div>`);
    card.querySelector('#ov-title').onclick = () => { game.abandonRun(); showTitle(); };
  }

  // ---------- タイトル・メニュー ----------
  function showTitle() {
    busy = false;
    const canResume = game.run && game.stage && (game.stage.status === 'play' || game.stage.status === 'clear' || game.stage.status === 'failed');
    const worlds = [];
    const total = Math.ceil(stages.length / CONFIG.worldSize);
    for (let w = 0; w < total; w++) {
      const unlocked = w < game.unlockedWorlds;
      const first = w * CONFIG.worldSize;
      const starsIn = stages.slice(first, first + CONFIG.worldSize).reduce((a, s) => a + (game.progress.stars[s.stage] ?? 0), 0);
      worlds.push(`<button class="btn ${unlocked ? 'btn-ghost' : 'btn-ghost'}" data-world="${w}" ${unlocked ? '' : 'disabled'}>WORLD ${w + 1}<small>${unlocked ? `★ ${starsIn}/${CONFIG.worldSize * 3}` : 'locked'}</small></button>`);
    }
    const card = ui.showOverlay(`
      <div class="eyebrow">number match · no ads</div>
      <h1 class="big">TEN</h1>
      <div class="ja">同じ数字か、たして 10 になる 2 つを消す。盤を空にすればステージクリア。</div>
      <div class="rows">
        <div class="row"><span class="k">ベストスコア</span><span class="v">${fmt(game.progress.bestScore)}</span></div>
        <div class="row"><span class="k">集めた星</span><span class="v">★ ${game.totalStars} / ${stages.length * 3}</span></div>
      </div>
      <div class="actions">
        ${canResume ? `<button class="btn btn-primary" id="ov-resume">つづきから (STAGE ${String(game.stageDef.stage).padStart(2, '0')})</button>` : ''}
        <button class="btn ${canResume ? 'btn-ghost' : 'btn-primary'}" id="ov-new">はじめから</button>
        <div class="worlds">${worlds.join('')}</div>
        <button class="btn btn-ghost" id="ov-rules">あそびかた</button>
      </div>
      <div class="meta">generator: haskell · rules verified against 40 vectors</div>`);
    card.querySelector('#ov-resume')?.addEventListener('click', () => {
      sound.ensure();
      const st = game.stage;
      if (st.status === 'clear') { ui.hideOverlay(); redraw(); handle(game.nextStage()); return; }
      if (st.status === 'failed') { handle(game.retryStage()); return; }
      ui.hideOverlay(); redraw();
    });
    card.querySelector('#ov-new').onclick = () => { sound.ensure(); handle(game.newRun(0)); };
    card.querySelectorAll('[data-world]').forEach((b) => b.addEventListener('click', () => {
      sound.ensure(); handle(game.newRun(Number(b.dataset.world) * CONFIG.worldSize));
    }));
    card.querySelector('#ov-rules').onclick = showRules;
  }

  function showRules() {
    const card = ui.showOverlay(`
      <div class="eyebrow">how to play</div>
      <h1>あそびかた</h1>
      <div class="rules">
        <b>消せる組</b>: 同じ数字(<span class="ex">4 と 4</span>)か、たして 10(<span class="ex">3 と 7</span>)。<br>
        <b>位置</b>: 縦・横・斜めに並んでいるか、行の終わりと次の行の始まり。間が空マスなら離れていてもよい。<br>
        <b>行</b>: 1 行まるごと空になるとその行が消え、得点が大きい。<br>
        <b>チェーン</b>: 消すたびに倍率 +0.1(最大 ×3.0)。<b>追加</b>と<b>ヒント</b>を使うと ×1.0 に戻る。<br>
        <b>追加(＋ADD)</b>: 残っている数字を末尾に書き足す。ステージごとに回数が決まっている。<br>
        <b>詰み</b>: 消せる組がなく追加も残っていないと失敗。ハートが 1 つ減り、新しい盤で同じステージに再挑戦。ハートが尽きるとランは終わり、ワールドの先頭から再開。<br>
        <b>パーフェクト</b>: 追加なしで全消しするとボーナスとハート回復。星は追加 0 回で ★★★、1 回で ★★。<br>
        <span class="ex">すべての盤は、追加なしで全消しできることを確認済み。</span>
      </div>
      <div class="actions"><button class="btn btn-primary" id="ov-back">もどる</button></div>`);
    card.querySelector('#ov-back').onclick = showTitle;
  }

  function showMenu() {
    const inPlay = game.stage?.status === 'play';
    const card = ui.showOverlay(`
      <div class="eyebrow">menu</div>
      <h1>Pause</h1>
      <div class="actions">
        <button class="btn btn-primary" id="ov-back">ゲームにもどる</button>
        <button class="btn btn-ghost" id="ov-sound">サウンド: ${sound.enabled ? 'ON' : 'OFF'}</button>
        <button class="btn btn-ghost" id="ov-rules">あそびかた</button>
        <button class="btn btn-ghost" id="ov-title">タイトルへ(進行は保存)</button>
        ${inPlay ? '<button class="btn btn-danger" id="ov-giveup">このステージをあきらめる(ハート −1)</button>' : ''}
      </div>`);
    card.querySelector('#ov-back').onclick = () => ui.hideOverlay();
    card.querySelector('#ov-sound').onclick = () => { sound.setEnabled(!sound.enabled); soundLabel(); showMenu(); };
    card.querySelector('#ov-rules').onclick = () => { showRules(); document.getElementById('ov-back').onclick = showMenu; };
    card.querySelector('#ov-title').onclick = showTitle;
    card.querySelector('#ov-giveup')?.addEventListener('click', () => { ui.hideOverlay(); handle(game.giveUp()); });
  }

  // ---------- 入力 ----------
  ui.board.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cell');
    if (!el || busy) return;
    if (document.getElementById('overlay').hidden === false) return;
    sound.ensure();
    handle(game.tap(Number(el.dataset.pos)));
  });
  document.getElementById('btn-add').onclick = () => { if (!busy) { sound.ensure(); handle(game.useAdd()); } };
  document.getElementById('btn-hint').onclick = () => { if (!busy) { sound.ensure(); handle(game.useHint()); } };
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
