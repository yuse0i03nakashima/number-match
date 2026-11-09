// 調整値をここに集約する。遊んで「派手すぎる」「ぬるい」と感じたらこのファイルだけ直す。
export const CONFIG = {
  score: {
    pairBase: 10,          // 1 Pair の基礎点。得点 = 基礎点 × 難しさ倍率 × Chain 倍率 × Speed 倍率(× FEVER)
    rowClear: 100,         // 行が消えたとき: rowClear × (同時に消えた行数)^2 × Chain 倍率
    digitClear: 150,       // ある数字を Board から全部消し切ったとき(1 つの数字ごと)× Chain 倍率。Add で戻ってきたらまた狙える
    stageClear: 200,       // Stage Clear(ALL CLEAR)。Board を全部消すと入り、Chain は途切れずに次の Stage へ続く
    perfect: 500,          // Add なしで Clear
    addSaved: 150,         // Clear 時、使わずに残した Add 1 回ごと(温存 Bonus)
    hintSaved: 50,         // Clear 時、使わずに残した Hint 1 回ごと
    hintedPairRatio: 0.5,  // HINT(低倍率)で示された Pair を消したときの得点の割合
    hintWhenStuck: 100,    // Pair が残っていないのに Hint を押したときの減点(Add が残っているとき)
    blindHintPenalty: 300, // Add も無いのに Hint を押したとき、Stage 得点を全部失ったうえで引かれる点
    giveUpKeepRatio: 0.5,  // GIVE UP したとき残る Stage 得点の割合
  },
  // 難しい消し方の倍率(Pair の得点に掛ける)
  difficulty: {
    vertical: 1.2,         // 縦
    wrap: 1.5,             // 行の右端と次の行の左端をまたぐ
    diagonal: 1.5,         // 斜め
    gapPerCell: 0.25,      // 2 つの間にある空マス 1 つごとに +0.25(他を消して初めて通った道)
    diagonalGapPerCell: 0.5, // 斜めで離れているときは空マス 1 つごとに +0.5(見つけにくい)
  },
  chain: {
    step: 1.0,             // 1 Pair 消すごとに倍率 +1.0
    max: 10.0,             // 倍率の上限(9 連鎖で到達)。到達すると FEVER
    decayGraceMs: 6000,    // 消去してからこの時間は倍率が下がらない
    decayStepMs: 2500,     // 猶予のあと、この時間ごとに Chain が 1 ずつ減る
  },
  fever: {
    durationMs: 10000,     // FEVER の長さ
    pointMult: 2,          // FEVER 中は得点 ×2
    endChainRatio: 0.5,    // FEVER が終わったら Chain をこの割合に戻す
    hintTimeCostMs: 3000,  // FEVER 中の Hint は使用回数ではなく FEVER の残り時間で払う
    extendMs: 1500,        // FEVER 中に Pair を消すと残り時間がこれだけ延びる
    maxTotalMs: 25000,     // ただし FEVER 全体の長さはここまで(延長の上限)
  },
  // Hint は Chain 倍率で性格が変わる(3 段階)
  hint: {
    perStage: 3,           // Stage ごとの使用上限
    flashFrom: 4.0,        // この倍率以上は FLASH(消せる Pair を全部一瞬だけ光らせる)
    scopeFrom: 8.0,        // この倍率以上(と FEVER 中)は SCOPE(相手のいるタイルを 1 枚光らせる)
    flashMs: 1200,         // FLASH の表示時間
    flashGaugeRatio: 0.5,  // FLASH のあとゲージをこの割合まで減らす
    scopeMissChain: 3,     // SCOPE で相手を外した 1 回目: Chain −3
    scopeBreakRatio: 0.5,  // 2 回目に外した / 光ったタイルを使わず別の Pair を消した: Chain をこの割合に
    stuckKeepRatio: 0.5,   // Dead End なのに Hint を押した: Chain をこの割合に
  },
  speed: {
    fastMs: 1000,          // 前の消去から 1 秒以内: FAST
    quickMs: 2200,         // 2.2 秒以内: QUICK
    fastMult: 1.5,         // FAST の倍率(Pair 得点だけに掛かる)
    quickMult: 1.2,
  },
  stuck: {
    addKeepRatio: 0.5,     // Dead End になってから Add を押したとき、Chain をこの割合だけ残す
  },
  rank: {
    perCell: 100,          // 基準点 = マス数 × perCell。Stage 得点がその何倍かで Rank
    S: 2.0, A: 1.4, B: 0.9, // これ未満は C
  },
  lives: {
    start: 3,
    max: 3,
    perfectRecover: 1,     // Perfect で回復する Heart
  },
  worldSize: 5,            // 5 Stage = 1 World。Run 終了後は World のはじめから再開。Result の画面は World の終わりだけ
  flow: {
    continueAfterClear: true,   // true: 全消ししたら Result を出さず次の Stage へ続く(Chain・FEVER を持ち越し)。false: 毎 Stage で Result
    autoNextMs: 2200,      // ALL CLEAR の演出を見せてから次の Stage へ進むまでの時間
  },
  fx: {
    particlesPerRemove: 22,
    particlesPerRow: 110,
    shakeBase: 2.5,        // 揺れの強さ(px)。Chain 倍率で増える
    maxParticles: 900,
    hitStopMs: 90,         // 行が消えた瞬間に粒子を止める時間(ヒットストップ)
  },
  bgm: {
    mode: 'synth',                   // 既定: 'synth'(生成 BGM) | 'off'
    synthVolume: 0.30,               // 生成 BGM の音量
    tonic: 64,                       // 生成 BGM の調(長調の主音の midi 番号)。64 = E。参考曲 Under a Darkening Sky の解析結果(E メジャー)に合わせた
    bpm: 124,                        // 生成 BGM のテンポ(1 曲目 dance)
    sweetBpm: 150,                   // 2 曲目 sweet のテンポ(参考 2 曲は 128 と 145。ユーザー希望でより速く)
    songs: ['dance', 'sweet'],       // Stage ごとに順に使う曲。Stage 1 = dance、Stage 2 = sweet、Stage 3 = dance、…
    sweetMelody: 'ours',             // sweet の旋律(melodies.js の候補名。lab.html で聴き比べる)。ours = R(参考曲)を土台にした自作
  },
  // VS: 2 台のスマホで同じ Board を同時に遊び、得点を競う(通信は vs.js)
  vs: {
    timeLimits: [120000, 180000, 300000],   // 選べる制限時間(ミリ秒)。既定は 2 つ目
    defaultTimeLimit: 180000,
    timeBonusPerSec: 10,             // ALL CLEAR したとき、残り 1 秒ごとに加点
    countdownMs: 3000,               // 両端末の 3・2・1
    syncMs: 400,                     // 相手に得点を送る間隔
  },
  // お題(Quest): Stage ごとに 1 つ。達成で Bonus
  quest: {
    bonus: 500,              // 達成の Bonus(Chain 倍率は掛けない)
    chainTarget: 7,          // 「Add なしで N Chain」の N(Pair の数が少なければそこまで)
    diagonalTarget: 2,       // 「斜めで N 回消せ」の N
  },
  // 温存の投資: World で残した Add を次の World に持ち込む
  invest: {
    chainPerAdd: 1,          // 残した Add 1 回ごとに、次の World の開始 Chain +1
    addsPerHeart: 3,         // 残した Add がこの数ごとに Heart +1(上限まで)
    chainCap: 5,             // 開始 Chain の上限
  },
  // CLASSIC モード(本家 Number Match に近い遊び方): Chain 倍率・ゲージ・FEVER・Speed・Heart が無く、得点は定額。
  // 残すリスクとリターン: Add と Hint の温存 Bonus、Perfect(Add も Hint も使わず Clear)、Quest、World の終わりの投資
  classic: {
    addsPerStage: 5,         // Add の回数(通常は Stage ごとに 2〜3)
    pathBonus: 5,            // 横の隣どうし以外(縦・斜め・またぎ・離れた Pair)の小さな加点(倍率の代わり)
    digitClear: 50,          // DIGIT CLEAR の点(通常 150 × 倍率)
    rankPerCell: 40,         // Rank の基準点 = マス数 × これ(通常 100)
    failKeepRatio: 0.5,      // Dead End で Add も無いとき Stage は失敗。Stage 得点はこの割合だけ残る(Heart は減らない)
    investAddsPer: 3,        // World で残した Add がこの数ごとに、次の World の各 Stage の Add +1
    investAddsCap: 2,        // その上限
    bpm: 96,                 // BGM のテンポ(通常 124)
    maxLayers: 1,            // BGM の層の上限(パッドと撥弦だけ。ドラム・ベース・リードは入らない)
    synthVolume: 0.22,       // BGM の音量(通常 0.30)
    fxScale: 0.5,            // 粒子の量の倍率。揺れ・ヒットストップ・画面の点滅は無し
    feverCalm: true,
  },
  // Coin: THE TEN で Stage を Clear すると、その Stage の得点がそのまま貯まる(Best Score とは別の累計)。ショップとスロットで使う
  shop: {
    normal:  { hint: 5000,  add: 10000, heart: 20000 },
    classic: { hint: 1500,  add: 3000 },                   // CLASSIC に Heart は無い
  },
  // 必殺技(Stage 中に大量の Coin で使う)。snipe: 位置に関係なく Pair を 1 組消す。line: 1 行を丸ごと消す
  // 使った Stage は Stage ごとの最高得点に数えない(ショップで買った Stage も同じ)
  skill: {
    normal:  { snipe: 5000, line: 20000 },
    classic: { snipe: 1500, line: 6000 },
  },
  // スロット(SLOT タブ。Coin を賭けて Coin を得る別ゲーム)。確率は 1 回転ごと。払い戻し率の目安は 90%(simulate で測る)
  slot: {
    bets: [5, 10, 25, 50, 100, 250, 500, 1000],       // BET の選択肢。任意の枚数も入力できる(1 枚以上、残高まで)
    defaultBet: 10,
    linesFor: (bet) => (bet >= 5 ? 5 : bet >= 3 ? 3 : 1),   // 賭け枚数 → 有効ライン(1: 中段、3: 横 3 本、5: 斜めも)
    pullIn: { default: 4, ten: 10, pairStar: 10 },   // 引き込み: 押した位置から何コマ先まで寄せるか。小役は広く、BONUS と同じ数字は目押しが要る
    payout: { big: 30, reg: 12, samePerDigit: 2, ten: 6, pairStar: 2 },   // 1 ライン・1 枚あたりの枚数(賭け枚数を掛ける)
    table: { big: 1 / 550, reg: 1 / 300, same: 1 / 90, ten: 1 / 18, pairStar: 1 / 18 },   // 通常時の役の確率。BONUS の役は揃えるまで持ち越す
    bonus: {
      big: { games: 30, table: { same: 1 / 12, ten: 1 / 2.5, pairStar: 1 / 5 } },
      reg: { games: 15, table: { same: 1 / 25, ten: 1 / 3, pairStar: 1 / 5 } },
    },
    notice: { onBonus: 0.7, fake: 0.03 },   // 予告ランプ: BONUS の役のとき光る確率と、ガセで光る確率
    spinStepMs: 45,          // リールが 1 コマ進む時間
  },
  audio: {
    masterVolume: 0.35,
  },
  storageKey: 'numbermatch.v1',
};
