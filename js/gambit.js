// HARD モードの GAMBIT: World の始めに 3 枚から 1 枚選ぶ札。見返り(up)と代償(down)が対になっていて、その World の 5 Stage に効く。
// 札の効き目は config の値の書き換え(patch)で表す。得点の倍率(hard.pointMult)と Coin の倍率(hard.coinMult)も cfg.hard にあるので、
// 札はそこも書き換えられる。cfg の組み立ては hardConfig が行う(game.js の cfg getter が HARD のときだけ呼ぶ)。
export const GAMBITS = [
  { id: 'blaze', name: 'BLAZE', up: 'FEVER が 2 倍長い', down: 'Hint 0',
    patch: (c) => ({ fever: { durationMs: c.fever.durationMs * 2, maxTotalMs: c.fever.maxTotalMs * 2 }, hint: { perStage: 0 } }) },
  { id: 'reserve', name: 'RESERVE', up: 'Add +2(各 Stage)', down: 'Coin 半分',
    patch: (c) => ({ hard: { addsPerStage: c.hard.addsPerStage + 2, coinMult: c.hard.coinMult * 0.5 } }) },
  { id: 'slant', name: 'SLANT', up: '斜めの倍率 ×3', down: '縦・またぎの倍率なし',
    patch: () => ({ difficulty: { diagonal: 3.0, diagonalGapPerCell: 1.0, vertical: 1.0, wrap: 1.0 } }) },
  { id: 'overdrive', name: 'OVERDRIVE', up: 'Chain が 1 回で +2', down: 'Chain の減りが 2 倍速い',
    patch: (c) => ({ chain: { step: c.chain.step * 2, decayGraceMs: c.chain.decayGraceMs / 2, decayStepMs: c.chain.decayStepMs / 2 } }) },
  { id: 'glass', name: 'GLASS', up: 'Coin 2 倍', down: 'Heart 1',
    patch: (c) => ({ lives: { start: 1, max: 1 }, hard: { coinMult: c.hard.coinMult * 2 } }) },
  { id: 'blind', name: 'BLIND', up: '得点 1.5 倍', down: 'Hint 0',
    patch: (c) => ({ hint: { perStage: 0 }, hard: { pointMult: c.hard.pointMult * 1.5 } }) },
  { id: 'rush', name: 'RUSH', up: 'FAST ×2.5・QUICK ×1.5', down: 'Chain の猶予が半分',
    patch: (c) => ({ speed: { fastMult: 2.5, quickMult: 1.5 }, chain: { decayGraceMs: c.chain.decayGraceMs / 2 } }) },
  { id: 'breaker', name: 'BREAKER', up: 'Line の得点 ×3', down: 'Pair の基礎点半分',
    patch: (c) => ({ score: { rowClear: c.score.rowClear * 3, pairBase: c.score.pairBase / 2 } }) },
];

/** 設定の深い併合。patch にある値だけを置き換え、無い値は base のまま(関数や配列はそのまま写す)。 */
export function mergeCfg(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const plain = v && typeof v === 'object' && !Array.isArray(v);
    out[k] = plain && base[k] && typeof base[k] === 'object' ? mergeCfg(base[k], v) : v;
  }
  return out;
}

/** HARD の設定: base → hard.rules → 選んだ GAMBIT の patch → 得点の項目に hard.pointMult を掛ける。 */
export function hardConfig(base, gambitId = null) {
  let c = mergeCfg(base, base.hard.rules);
  const g = gambitId ? GAMBITS.find((x) => x.id === gambitId) : null;
  if (g) c = mergeCfg(c, g.patch(c));
  const m = c.hard.pointMult, s = c.score;
  return mergeCfg(c, {
    score: {
      pairBase: s.pairBase * m, rowClear: s.rowClear * m, digitClear: s.digitClear * m, stageClear: s.stageClear * m,
      perfect: s.perfect * m, addSaved: s.addSaved * m, hintSaved: s.hintSaved * m,
      hintWhenStuck: s.hintWhenStuck * m, blindHintPenalty: s.blindHintPenalty * m,
    },
    quest: { bonus: c.quest.bonus * m },
  });
}

/** 種から n 枚を選ぶ(同じ種なら同じ組)。線形合同法で並べ替えて先頭 n 枚。 */
export function pickGambits(seed, n = 3) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const ids = GAMBITS.map((g) => g.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, Math.min(n, ids.length));
}
