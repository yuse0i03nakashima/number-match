// 調整値をここに集約する。遊んで「派手すぎる」「ぬるい」と感じたらこのファイルだけ直す。
export const CONFIG = {
  score: {
    pairBase: 10,          // 1 ペア消すごとの基礎点(ボーナスを足してから倍率を掛ける)
    rowClear: 100,         // 行が消えたとき: rowClear × (同時に消えた行数)^2 × 倍率
    stageClear: 200,       // ステージクリア
    perfect: 500,          // Add なしでクリア
    // 難しい消し方のボーナス(基礎点に足す)
    gapPerCell: 5,         // 2 つの間にある空マス 1 つごと(他を消して初めて通った道)
    wrap: 15,              // 行の右端と次の行の左端をまたぐ
    diagonal: 10,          // 斜め
    vertical: 5,           // 縦
    hintWhenStuck: 100,    // ペアが残っていないのに Hint を押したときの減点
  },
  chain: {
    step: 0.5,             // 1 ペア消すごとに倍率 +0.5
    max: 10.0,             // 倍率の上限(18 連鎖で到達)
  },
  speed: {
    fastMs: 1000,          // 前の消去から 1 秒以内: FAST
    quickMs: 2200,         // 2.2 秒以内: QUICK
    fastMult: 1.5,         // FAST の倍率(ペア得点だけに掛かる)
    quickMult: 1.2,
  },
  stuck: {
    addKeepRatio: 0.5,     // 詰んでから Add を押したとき、チェーンをこの割合だけ残す(0 なら途切れる)
  },
  lives: {
    start: 3,
    max: 3,
    perfectRecover: 1,     // パーフェクトで回復するハート
  },
  worldSize: 5,            // 5 ステージ = 1 ワールド。ラン終了後はワールドのはじめから再開
  fx: {
    particlesPerRemove: 22,
    particlesPerRow: 110,
    shakeBase: 2.5,        // 揺れの強さ(px)。チェーン倍率で増える
    maxParticles: 900,
    hitStopMs: 90,         // 行が消えた瞬間に粒子を止める時間(ヒットストップ)
  },
  audio: {
    masterVolume: 0.35,
  },
  storageKey: 'numbermatch.v1',
};
