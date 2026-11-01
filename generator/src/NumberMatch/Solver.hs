-- | 全消し手順を探す(深さ優先探索)。
--   「この盤は追加 k 回以内で全消しできる」ことを、実際に手順を見つけて保証する。
module NumberMatch.Solver
  ( solve
  , par
  , replay
  , orderMoves
  ) where

import qualified Data.Set as Set
import Data.List (sortOn)
import NumberMatch.Board
import NumberMatch.Rules

-- | 一度調べた (盤面, 残り追加回数) の集合。同じ状態を二度調べない。
type Visited = Set.Set (Board, Int)

-- | 探索の本体。返り値は (見つけた手順, 残り予算, 調べた状態)。
--   予算と訪問済み集合を引数と返り値で「手渡し」している。
--   この手渡しを隠してくれる道具が State モナド(第11章以降)。
search :: Int -> Int -> Board -> Visited -> (Maybe [Move], Int, Visited)
search budget adds b seen
  | isCleared b          = (Just [], budget, seen)
  | budget <= 0          = (Nothing, 0, seen)
  | Set.member key seen  = (Nothing, budget, seen)
  | otherwise            = tryMoves (budget - 1) (Set.insert key seen) candidates
  where
    key   = (b, adds)
    pairs = validPairs b
    -- 消せる組があるうちは消す。無くなったときだけ追加を試す。
    candidates
      | null pairs = [Add | adds > 0]
      | otherwise  = [Remove i j | (i, j) <- orderMoves b pairs]

    tryMoves bud s []       = (Nothing, bud, s)
    tryMoves bud s (m : ms) =
      case search bud (addsAfter m) (applyMove m b) s of
        (Just rest, bud', s') -> (Just (m : rest), bud', s')
        (Nothing,   bud', s') -> tryMoves bud' s' ms

    addsAfter Add = adds - 1
    addsAfter _   = adds

-- | 手の並べ替え(枝刈りの要)。行が消える手を先に、次に盤の上のほうの手を先に。
--   (第6章 高階関数: sortOn)
orderMoves :: Board -> [(Pos, Pos)] -> [(Pos, Pos)]
orderMoves b = sortOn key
  where
    key (i, j) = (length (applyMove (Remove i j) b), i, j)

-- | budget ノード以内・追加 maxAdds 回以内で全消し手順を探す。
solve :: Int -> Int -> Board -> Maybe [Move]
solve budget maxAdds b = result
  where
    (result, _, _) = search budget maxAdds b Set.empty

-- | 必要な追加回数の最小値(0 から順に試す)。見つからなければ Nothing。
par :: Int -> Int -> Board -> Maybe Int
par budget maxAdds b =
  case [k | k <- [0 .. maxAdds], Just _ <- [solve budget k b]] of
    (k : _) -> Just k
    []      -> Nothing

-- | 手順を盤に順に適用する(検証用)。
--   (第6章 高階関数: foldl)
replay :: Board -> [Move] -> Board
replay = foldl (flip applyMove)
