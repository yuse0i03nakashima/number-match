-- | ボード面の生成。乱数も自分で書く(線形合同法)。
--   同じシードからは必ず同じボードができるので、面を「シード」だけで再現できる。
module NumberMatch.Generate
  ( Seed
  , nextSeed
  , digitFrom
  , randomDigits
  , randomBoard
  , StageSpec(..)
  , stageSpec
  ) where

import NumberMatch.Board

type Seed = Int

-- | 線形合同法。2^31 で折り返す古典的なパラメータ。
nextSeed :: Seed -> Seed
nextSeed s = (1103515245 * s + 12345) `mod` 2147483648

-- | シードから 1〜9 の数字を 1 つ取り出す(上位ビットを使うと偏りが小さい)。
digitFrom :: Seed -> Int
digitFrom s = (s `div` 65536) `mod` 9 + 1

-- | シードから n 個の数字。
--   (第5章 再帰: 無限リスト iterate から take する書き方は第4章・第6章)
randomDigits :: Seed -> Int -> [Int]
randomDigits seed n = map digitFrom (take n (drop 1 (iterate nextSeed seed)))

-- | n 個の数字で埋めたボード(最後の行は途中まででよい)。
--   注意: 1 手で 2 個ずつ消えるので、追加なしで全消しできるボードはマス数が偶数。
--   本家のように 27 個(3 行)から始めると、追加なしでは絶対に全消しできない。
randomBoard :: Seed -> Int -> Board
randomBoard seed n = fromDigits (randomDigits seed n)

-- | ステージの設定。
data StageSpec = StageSpec
  { specStage :: Int   -- ^ ステージ番号(1 始まり)
  , specCells :: Int   -- ^ 初期のマス数(偶数)
  , specAdds  :: Int   -- ^ 「数字を追加」の回数
  } deriving (Show)

-- | ステージ番号 → 設定。ステージが進むごとにマス数を 2 ずつ増やす(偶数を保つ)。
--   ステージ 1 は 26 個(2 行 + 8 個。本家の 27 個に近い)、ステージ 30 は 84 個(9 行 + 3 個)。
--   「数字を追加」の回数は、ステージ 10 までは 3 回、それ以降は 2 回。
stageSpec :: Int -> StageSpec
stageSpec n = StageSpec n cells adds
  where
    cells = 24 + 2 * n
    adds | n <= 10   = 3
         | otherwise = 2
