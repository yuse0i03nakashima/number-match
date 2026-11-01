// 調整値をここに集約する。遊んで「派手すぎる」「ぬるい」と感じたらこのファイルだけ直す。
export const CONFIG = {
  score: {
    pairBase: 10,          // 1 組消すごとの基礎点(×倍率)
    rowClear: 100,         // 行が消えたとき: rowClear × (同時に消えた行数)^2
    stageClear: 200,       // ステージクリア
    perfect: 500,          // 追加なしでクリア
  },
  chain: {
    step: 0.1,             // 1 組消すごとに倍率 +0.1
    max: 3.0,              // 倍率の上限
  },
  lives: {
    start: 3,
    max: 3,
    perfectRecover: 1,     // パーフェクトで回復するハート
  },
  worldSize: 5,            // 5 ステージ = 1 ワールド。ラン終了後はワールド先頭から再開
  fx: {
    particlesPerRemove: 18,
    particlesPerRow: 90,
    shakeBase: 2,          // 揺れの強さ(px)。チェーン倍率で増える
    maxParticles: 600,
  },
  audio: {
    masterVolume: 0.35,
  },
  storageKey: 'numbermatch.v1',
};
