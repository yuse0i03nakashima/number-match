// BGM LAB: sweet の旋律候補を本番と同じ music.js で鳴らして聴き比べる
import { Music } from './music.js';
import { SWEET_MELODIES, DEFAULT_SWEET_MELODY } from './melodies.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let music = null;
let current = DEFAULT_SWEET_MELODY;

function heatFor(layers) { return [0, 0, 0.25, 0.5, 0.75][layers] ?? 0; }

function makeMusic() {
  const cand = SWEET_MELODIES[current];
  const m = new Music({ volume: CONFIG.bgm.synthVolume, tonic: Number($('key').value), bpm: CONFIG.bgm.bpm, sweetBpm: Number($('bpm').value), sweetMelody: cand.notes, sweetProgression: cand.progression, sweetStyle: cand.style });
  m.attach(ctx);
  m.setSong('sweet');
  m.setHeat(heatFor(Number($('layers').value)));
  m.setFever($('fever').checked);
  m.melodyOnly = $('solo').checked;
  return m;
}

function start() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  if (music) music.stop(0.2);
  music = makeMusic();
  music.play();
}

function showNotes() {
  const notes = SWEET_MELODIES[current].notes;
  const lines = [];
  for (let bar = 0; bar < 8; bar++) {
    const row = notes.filter((n) => n[0] >= bar * 16 && n[0] < (bar + 1) * 16);
    lines.push(row.map((n) => `[${n[0]}, ${n[1]}, ${n[2]}]`).join(', '));
  }
  $('notes').value = lines.join(',\n');
  $('desc').textContent = `${SWEET_MELODIES[current].name}: ${SWEET_MELODIES[current].desc}`;
}

for (const [key, m] of Object.entries(SWEET_MELODIES)) {
  const b = document.createElement('button');
  b.textContent = m.name;
  b.dataset.key = key;
  b.addEventListener('click', () => {
    current = key;
    for (const x of $('melodies').children) x.classList.toggle('on', x.dataset.key === key);
    showNotes();
    if (m.bpm) { $('bpm').value = m.bpm; $('bpmv').textContent = m.bpm; }
    if (m.tonic && [...$('key').options].some((o) => Number(o.value) === m.tonic)) { $('key').value = String(m.tonic); if (music) music.setSweetTonic(m.tonic); }
    else if (music) music.setSweetTonic(null);
    if (music) {
      music.setSweetMelody(m.notes); music.setSweetProgression(m.progression); music.setSweetStyle(m.style);
      music.sweetBpm = Number($('bpm').value); music.pendingBpm = music.bpmFor('sweet');
    }
  });
  if (key === current) b.classList.add('on');
  $('melodies').appendChild(b);
}
showNotes();

$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => { if (music) music.stop(0.3); });
$('bpm').addEventListener('input', () => {
  $('bpmv').textContent = $('bpm').value;
  if (music) { music.sweetBpm = Number($('bpm').value); music.pendingBpm = music.bpmFor('sweet'); }
});
$('key').addEventListener('change', () => { if (music) music.setSweetTonic(null); if (music && music.playing) start(); });
$('layers').addEventListener('change', () => { if (music) music.setHeat(heatFor(Number($('layers').value))); });
$('fever').addEventListener('change', () => { if (music) music.setFever($('fever').checked); });
$('solo').addEventListener('change', () => { if (music) music.melodyOnly = $('solo').checked; });
$('apply').addEventListener('click', () => {
  try {
    const arr = JSON.parse('[' + $('notes').value.replace(/,\s*$/, '') + ']');
    if (!Array.isArray(arr) || !arr.every((n) => Array.isArray(n) && n.length === 3 && n.every(Number.isFinite))) throw new Error('形が違います');
    SWEET_MELODIES[current].notes = arr;
    if (music) music.setSweetMelody(arr);
    $('err').textContent = `適用しました(${arr.length} 音)`;
  } catch (e) { $('err').textContent = '読めません: ' + e.message; }
});

setInterval(() => {
  if (!music || !music.playing) return;
  const bar = Math.floor(music.step / 16) % 8;
  $('pos').textContent = `${bar + 1} 小節目 / 層 ${music.layers} / ${music.bpm} BPM`;
  $('meter').style.width = `${Math.round(music.level() * 100)}%`;
}, 100);
