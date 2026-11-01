# NumberMatch — 自作 Number Match（Haskell 生成器 ＋ ブラウザゲーム）

家族がスマホのブラウザで遊ぶ広告なしの Number Match と、ゆうせい本人の学習教材を兼ねるプロジェクト。計画の正本は `docs/00_全体像.md`。

## 構成と担当

- `generator/` — Haskell（cabal、依存は base・containers のみ）。**ルールの正本**。ボード面生成・解の存在保証・テストベクタ出力。
  - `cabal run gen` で `web/levels/stages.json` と `web/test/vectors.json` を書き出す。この2ファイルは手で編集しない。
- `web/` — GitHub Pages で配信する静的サイト（ES modules、ビルド工程なし、外部ライブラリなし）。
  - `js/rules.js` は Haskell の `Rules.hs` と同じ関数名・同じ意味。変更は両方に入れ、`node --test web/test/*.test.js` で一致を確認する。得点のための道の判定(`js/scoring.js`)は JavaScript だけにあり、ルールの正否には関わらない。
  - 調整値は `js/config.js` に集約する。
- `docs/` — 学習用の解説（Markdown）。授業ノート `study/関数型言語/Notebook` の章と対応づける。
- `.github/workflows/pages.yml` — `web/` を Pages に配置。

## 規則

- ファイルは UTF-8。日本語を含む ps1 は BOM 付き。
- 個人情報（家族の名前など）をコード・コミット・公開物に入れない。
- `docs/` などの人が読む日本語文書は explain-before-shorten → yomiyasu で推敲する（コード・設定・HANDOFF は対象外）。
- Haskell のコードは授業（Hutton 本の章順）で既習の道具を優先し、未習の道具（モナド変換子など）を使うときは docs に理由を書く。
- コミットは変更ファイルをパス指定で行う（`git add -A` 禁止）。
- 検証: `cabal build && cabal test`（generator）、`node --test web/test/*.test.js`、ブラウザでの実プレイ。
