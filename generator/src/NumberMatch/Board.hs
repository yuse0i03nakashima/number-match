-- | 盤面の型。Number Match の盤は「幅 9 の格子」だが、
--   ここでは読み順(左→右、上→下)に並べた 1 本のリストで表す。
--   こうすると「行末→次行先頭」のつながりが「リストの隣」として自然に扱える。
module NumberMatch.Board
  ( Cell(..)
  , Board
  , Pos
  , width
  , rowOf, colOf
  , cellAt
  , fromDigits
  , toDigits
  , numbers
  , isCleared
  , rows
  ) where

-- | 1 マスの状態。数字が入っているか、消されて空か。
--   (第7章 「型と型クラスの宣言」: data と deriving)
data Cell = Empty | Num Int
  deriving (Eq, Ord, Show)

-- | 盤面 = マスのリスト(読み順)。長さは 9 の倍数とは限らない(最後の行は途中まで)。
type Board = [Cell]

-- | 位置 = リストの添字(0 始まり)。
type Pos = Int

-- | 盤の幅(1 行のマス数)。
width :: Int
width = 9

rowOf, colOf :: Pos -> Int
rowOf p = p `div` width
colOf p = p `mod` width

-- | 添字 p のマス。範囲外なら Empty 扱い。
cellAt :: Board -> Pos -> Cell
cellAt b p
  | p < 0 || p >= length b = Empty
  | otherwise              = b !! p

-- | 数字のリスト(0 は空マス)から盤面を作る。JSON との橋渡し用。
fromDigits :: [Int] -> Board
fromDigits = map toCell
  where
    toCell 0 = Empty
    toCell n = Num n

toDigits :: Board -> [Int]
toDigits = map fromCell
  where
    fromCell Empty   = 0
    fromCell (Num n) = n

-- | 盤に残っている数字だけを読み順で取り出す。
--   (第4章 リスト内包表記: パターンで絞り込む)
numbers :: Board -> [Int]
numbers b = [n | Num n <- b]

-- | 全部消えたか。
isCleared :: Board -> Bool
isCleared = null . numbers

-- | 盤を行(長さ 9 のリスト)に切り分ける。最後の行は短いことがある。
--   (第5章 再帰関数)
rows :: Board -> [[Cell]]
rows [] = []
rows b  = take width b : rows (drop width b)
