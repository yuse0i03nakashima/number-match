-- | ゲームのルール(正本)。web/js/rules.js はこのファイルの移植で、
--   同じ関数名・同じ意味を保つ。
module NumberMatch.Rules
  ( Move(..)
  , matches
  , connected
  , validPairs
  , removePair
  , collapseRows
  , addNumbers
  , applyMove
  , parityOk
  ) where

import NumberMatch.Board

-- | 1 手。2 マスを消すか、数字を追加するか。
data Move = Remove Pos Pos | Add
  deriving (Eq, Ord, Show)

-- | 2 つの数字が組になれるか: 同じ数字、または合計が 10。
matches :: Int -> Int -> Bool
matches a b = a == b || a + b == 10

-- | 位置 i と j (i < j) がつながっているか。
--   次のどれかの直線上にあり、途中のマスが全部空なら True。
--     * 読み順(同じ行、または行末→次行先頭を越える): 添字が 1 ずつ進む
--     * 縦:        添字が 9 ずつ進む(列が同じ)
--     * 右下斜め:  添字が 10 ずつ進む(列が 1 ずつ増える)
--     * 左下斜め:  添字が 8 ずつ進む (列が 1 ずつ減る)
--   斜めは「行をまたいでしまう」偽物を列の差で弾く。
connected :: Board -> Pos -> Pos -> Bool
connected b i j = any ok [1, width, width + 1, width - 1]
  where
    dr = rowOf j - rowOf i
    dc = colOf j - colOf i
    ok step
      | step == 1          = True        && clear 1
      | step == width      = dc == 0     && clear width
      | step == width + 1  = dc == dr    && clear (width + 1)
      | otherwise          = dc == negate dr && clear (width - 1)
      -- 「i から step ずつ進んで j に着く」かつ「途中が全部 Empty」
    clear step =
      (j - i) `mod` step == 0
        && all (\p -> cellAt b p == Empty) [i + step, i + 2 * step .. j - step]

-- | いま消せるペアの一覧(i < j)。
--   (第4章 リスト内包表記: 2 重の生成器とガード)
validPairs :: Board -> [(Pos, Pos)]
validPairs b =
  [ (i, j)
  | (i, Num a) <- indexed
  , (j, Num c) <- indexed
  , i < j
  , matches a c
  , connected b i j
  ]
  where
    indexed = zip [0 ..] b

-- | 2 マスを空にする(行の縮約はしない)。
removePair :: Pos -> Pos -> Board -> Board
removePair i j b = [if p == i || p == j then Empty else c | (p, c) <- zip [0 ..] b]

-- | 全部空になった行を取り除く。
--   (第6章 高階関数: filter と concat)
collapseRows :: Board -> Board
collapseRows = concat . filter (not . all (== Empty)) . rows

-- | 残っている数字を読み順のまま末尾に書き足す。
--   末尾の空マスは詰めてから足す(新しい数字が最後の数字の直後から続く)。
addNumbers :: Board -> Board
addNumbers b = trimmed ++ map Num (numbers b)
  where
    trimmed = reverse (dropWhile (== Empty) (reverse b))

-- | 1 手を適用する。消した後は必ず行の縮約まで行う。
applyMove :: Move -> Board -> Board
applyMove (Remove i j) = collapseRows . removePair i j
applyMove Add          = addNumbers

-- | パリティ不変量: 追加なしで全消しできるための必要条件。
--   d と 10-d の個数の合計が偶数(d = 5 は 5 の個数が偶数)。
--   消す操作は各グループから 2 個ずつ減らすので、この偶奇は変わらない。
parityOk :: Board -> Bool
parityOk b = all even [count d + count (10 - d) | d <- [1 .. 4]] && even (count 5)
  where
    ns = numbers b
    count d = length (filter (== d) ns)
