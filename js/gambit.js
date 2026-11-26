// GAMBIT: World の始めに 3 枚から 1 枚選ぶ札。見返り(up)と代償(down)が対になっている。
// HARD では 1 枚ずつ入れ替え、ROGUE では World を越えるたびに積み上げてシナジーを組める。
// 札の効き目は config の値の書き換え(patch)で表す。複数枚あるときは順に合成する(composeConfig)。
export const GAMBITS = [
  { id: 'blaze', name: 'BLAZE', up: 'FEVER が 2 倍長い', down: 'Hint 0',
    patch: (c) => ({ fever: { durationMs: c.fever.durationMs * 2, maxTotalMs: c.fever.maxTotalMs * 2 }, hint: { perStage: 0 } }) },
  { id: 'reserve', name: 'RESERVE', up: 'Add +2(各 Stage)', down: 'Coin 半分',
    patch: (c) => ({ hard: { addsPerStage: c.hard.addsPerStage + 2, coinMult: c.hard.coinMult * 0.5 }, rogue: { coinMult: c.rogue.coinMult * 0.5 }, bonusAddsDelta: (c.bonusAddsDelta ?? 0) + 2 }) },
  { id: 'slant', name: 'SLANT', up: '斜めの倍率 ×3', down: '縦・またぎの倍率なし',
    patch: () => ({ difficulty: { diagonal: 3.0, diagonalGapPerCell: 1.0, vertical: 1.0, wrap: 1.0 } }) },
  { id: 'overdrive', name: 'OVERDRIVE', up: 'Chain が 1 回で +2', down: 'Chain の減りが 2 倍速い',
    patch: (c) => ({ chain: { step: c.chain.step * 2, decayGraceMs: Math.max(1200, Math.round(c.chain.decayGraceMs / 2)), decayStepMs: Math.max(600, Math.round(c.chain.decayStepMs / 2)) } }) },
  { id: 'glass', name: 'GLASS', up: 'Coin 2 倍', down: 'Heart 1',
    patch: (c) => ({ lives: { start: 1, max: 1 }, hard: { coinMult: c.hard.coinMult * 2 }, rogue: { coinMult: c.rogue.coinMult * 2 } }) },
  { id: 'blind', name: 'BLIND', up: '得点 1.5 倍', down: 'Hint 0',
    patch: (c) => ({ hint: { perStage: 0 }, pointScale: (c.pointScale ?? 1) * 1.5 }) },
  { id: 'rush', name: 'RUSH', up: 'FAST ×2.5・QUICK ×1.5', down: 'Chain の猶予が半分',
    patch: (c) => ({ speed: { fastMult: 2.5, quickMult: 1.5 }, chain: { decayGraceMs: Math.max(1200, Math.round(c.chain.decayGraceMs / 2)) } }) },
  { id: 'breaker', name: 'BREAKER', up: 'Line の得点 ×3', down: 'Pair の基礎点半分',
    patch: (c) => ({ score: { rowClear: c.score.rowClear * 3, pairBase: Math.max(1, Math.round(c.score.pairBase / 2)) } }) },
  { id: 'ignite', name: 'IGNITE', up: '行消しで FEVER +2 秒 & Chain +1', down: 'Add −1(最低 1)',
    patch: (c) => ({ perks: { lineFeverExtendMs: (c.perks?.lineFeverExtendMs ?? 0) + 2000, lineExtraChain: (c.perks?.lineExtraChain ?? 0) + 1 }, bonusAddsDelta: (c.bonusAddsDelta ?? 0) - 1 }) },
  { id: 'midas', name: 'MIDAS', up: 'GOLD タイル 2 倍 & Coin 1.5 倍', down: 'Chain 猶予 0.7 倍',
    patch: (c) => ({ special: { goldCount: c.special.goldCount * 2, goldCoins: Math.round(c.special.goldCoins * 1.5) }, hard: { coinMult: c.hard.coinMult * 1.5 }, rogue: { coinMult: c.rogue.coinMult * 1.5 }, chain: { decayGraceMs: Math.max(1200, Math.round(c.chain.decayGraceMs * 0.7)) } }) },
  { id: 'sniper', name: 'SNIPER', up: '離れた Pair の空マス加算 +0.5', down: '隣どうしの基礎点 0.6 倍',
    patch: (c) => ({ difficulty: { gapPerCell: c.difficulty.gapPerCell + 0.5, diagonalGapPerCell: c.difficulty.diagonalGapPerCell + 0.5 }, perks: { adjacentMult: 0.6 } }) },
  { id: 'drain', name: 'DRAIN', up: 'DIGIT CLEAR で Chain +2 & ゲージ回復', down: 'Hint −1(最低 0)',
    patch: (c) => ({ perks: { digitExtraChain: (c.perks?.digitExtraChain ?? 0) + 2, digitRefillGauge: true }, hint: { perStage: Math.max(0, c.hint.perStage - 1) } }) },
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

/** 複数枚の GAMBIT を重ねた設定を組み立てる。hard = true のときは hard.rules と hard.pointMult も掛ける。 */
export function composeConfig(base, gambitIds = [], { hard = false } = {}) {
  let c = hard ? mergeCfg(base, base.hard.rules) : mergeCfg(base, {});
  c = mergeCfg(c, { pointScale: hard ? base.hard.pointMult : 1 });
  const ids = Array.isArray(gambitIds) ? gambitIds : gambitIds ? [gambitIds] : [];
  for (const id of ids) {
    const g = GAMBITS.find((x) => x.id === id);
    if (g) c = mergeCfg(c, g.patch(c));
  }
  const m = c.pointScale ?? 1;
  if (m !== 1) {
    const s = c.score;
    c = mergeCfg(c, {
      score: {
        pairBase: s.pairBase * m, rowClear: s.rowClear * m, digitClear: s.digitClear * m, stageClear: s.stageClear * m,
        perfect: s.perfect * m, addSaved: s.addSaved * m, hintSaved: s.hintSaved * m,
        hintWhenStuck: s.hintWhenStuck * m, blindHintPenalty: s.blindHintPenalty * m,
      },
      quest: { bonus: Math.round(c.quest.bonus * m) },
      special: { fuseBonus: Math.round(c.special.fuseBonus * m) },
    });
  }
  return c;
}

/** HARD の設定(単一 GAMBIT 互換ラッパー)。 */
export function hardConfig(base, gambitId = null) {
  return composeConfig(base, gambitId ? [gambitId] : [], { hard: true });
}

/** 種から n 枚を選ぶ(同じ種なら同じ組)。exclude に含まれる札は除く。 */
export function pickGambits(seed, n = 3, exclude = []) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const ex = new Set(exclude);
  const ids = GAMBITS.map((g) => g.id).filter((id) => !ex.has(id));
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, Math.min(n, ids.length));
}
