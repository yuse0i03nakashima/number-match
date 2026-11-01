// 調整値をここに集約する。遊んで「派手すぎる」「ぬるい」と感じたらこのファイルだけ直す。
export const CONFIG = {
  score: {
    pairBase: 10,          // 1 Pair 消すごとの基礎点(Bonus を足してから倍率を掛ける)
    rowClear: 100,         // 行が消えたとき: rowClear × (同時に消えた行数)^2 × 倍率
    stageClear: 200,       // Stage Clear
    perfect: 500,          // Add なしで Clear
    addSaved: 150,         // Clear 時、使わずに残した Add 1 回ごと(温存 Bonus)
    // 難しい消し方の Bonus(基礎点に足す)
    gapPerCell: 5,         // 2 つの間にある空マス 1 つごと(他を消して初めて通った道)
    wrap: 15,              // 行の右端と次の行の左端をまたぐ
    diagonal: 10,          // 斜め
    diagonalGapPerCell: 10, // 斜めで離れている: 間の空マス 1 つごとにさらに加点(見つけにくい)
    vertical: 5,           // 縦
    hintWhenStuck: 100,    // Pair が残っていないのに Hint を押したときの減点(Add が残っているとき)
    blindHintPenalty: 300, // Add も無いのに Hint を押したとき、Stage 得点を全部失ったうえで引かれる点
    giveUpKeepRatio: 0.5,  // GIVE UP したとき残る Stage 得点の割合
  },
  chain: {
    step: 0.5,             // 1 Pair 消すごとに倍率 +0.5
    max: 10.0,             // 倍率の上限(18 連鎖で到達)。到達すると FEVER
    decayGraceMs: 4000,    // 消去してからこの時間は倍率が下がらない
    decayStepMs: 1500,     // 猶予のあと、この時間ごとに Chain が 1 ずつ減る
  },
  fever: {
    durationMs: 10000,     // FEVER の長さ
    pointMult: 2,          // FEVER 中は得点 ×2
    endChainRatio: 0.5,    // FEVER が終わったら Chain をこの割合に戻す
  },
  speed: {
    fastMs: 1000,          // 前の消去から 1 秒以内: FAST
    quickMs: 2200,         // 2.2 秒以内: QUICK
    fastMult: 1.5,         // FAST の倍率(Pair 得点だけに掛かる)
    quickMult: 1.2,
  },
  stuck: {
    addKeepRatio: 0.5,     // 詰んでから Add を押したとき、Chain をこの割合だけ残す(0 なら途切れる)
  },
  rank: {
    perCell: 50,           // 基準点 = マス数 × perCell。Stage 得点がその何倍かで Rank
    S: 2.0, A: 1.4, B: 0.9, // これ未満は C
  },
  lives: {
    start: 3,
    max: 3,
    perfectRecover: 1,     // Perfect で回復する Heart
  },
  worldSize: 5,            // 5 Stage = 1 World。Run 終了後は World のはじめから再開
  fx: {
    particlesPerRemove: 22,
    particlesPerRow: 110,
    shakeBase: 2.5,        // 揺れの強さ(px)。Chain 倍率で増える
    maxParticles: 900,
    hitStopMs: 90,         // 行が消えた瞬間に粒子を止める時間(ヒットストップ)
  },
  audio: {
    masterVolume: 0.35,
  },
  storageKey: 'numbermatch.v1',
};
