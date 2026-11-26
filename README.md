# THE TEN(広告なしの Number Match)

同じ数字か、足して 10 になる 2 つの数字を消していくパズルです。スマホのブラウザで遊べます。盤面は Haskell で生成し、すべての面が「数字を追加せずに全消しできる」ことを探索で確認してあります。

- 遊ぶ: GitHub Pages の URL をスマホで開き、「ホーム画面に追加」するとアプリのように起動します。
- 学ぶ: `docs/` に、Haskell とブラウザ側の仕組みを授業の章と対応づけた解説があります。`docs/00_全体像.md` から読みます。

## 構成

| フォルダ | 役割 |
|---|---|
| `generator/` | Haskell。盤面の型とルール、全消し手順を探すソルバ、乱数による盤面の生成、JSON の書き出し。ルールの正本はここです |
| `web/` | ブラウザで動くゲーム本体。HTML、CSS、JavaScript だけで、ビルド工程も外部ライブラリもありません |
| `docs/` | 学習用の解説 |
| `tools/` | `web/` を GitHub Pages に配置するスクリプト(`deploy.ps1`)と、Actions 用の予備設定(`pages.yml`) |

## コマンド

Haskell 側は `generator/` で実行します。

```powershell
cabal build        # ビルド
cabal test         # ルールとソルバのテスト(22 件)
cabal run gen      # web/levels/stages.json と web/test/vectors.json を書き出す
```

ブラウザ側はリポジトリルートで実行します。

```powershell
node --test web/test/*.test.js            # ルールの移植が Haskell と一致するか、進行のテスト(74 件)
python -m http.server 8765 --bind 127.0.0.1 --directory web   # 手元で動かす
```

## 面データの流れ

1. `generator/app/Main.hs` がステージごとにシードを順に試し、パリティ条件を満たして追加なしで全消しできる盤面を 3 枚ずつ見つけます。全 60 ステージ(通常 30 + EXTRA 30)を生成します。
2. 見つけた盤面を `web/levels/stages.json` に書き出します。同時に、ルールのテスト用に 40 個の盤面と正解の組を `web/test/vectors.json` に書き出します。
3. ブラウザ側の `web/js/rules.js` は Haskell の `Rules.hs` を移植したもので、`node --test` でベクタと一致することを確認します。

この 2 つの JSON は手で編集せず、`cabal run gen` で作り直します。

## 調整

得点、チェーンの倍率、ライフ、演出の量は `web/js/config.js` にまとめてあります。ステージの構成(マス数、追加の回数)は `generator/src/NumberMatch/Generate.hs` の `stageSpec` で決め、変えたら `cabal run gen` を実行します。
