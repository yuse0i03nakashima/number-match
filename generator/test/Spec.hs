-- | ルールとソルバの検査。外部ライブラリなしの手書きテスト。
--   失敗が 1 つでもあれば終了コード 1 で終わる(cabal test が赤くなる)。
module Main (main) where

import Control.Monad (unless)
import System.Exit (exitFailure)
import System.IO (hSetEncoding, stdout, utf8)
import NumberMatch.Board
import NumberMatch.Rules
import NumberMatch.Solver
import NumberMatch.Generate

-- | (名前, 成否) の一覧。
tests :: [(String, Bool)]
tests =
  [ ("同じ数字は組になる",            matches 3 3)
  , ("合計 10 は組になる",            matches 4 6)
  , ("それ以外は組にならない",        not (matches 2 3))

  -- 盤: 1 行目 [1,0,0,9,5,5,0,0,2], 2 行目 [8,0,0,0,0,0,0,0,0]
  --      添字    0 1 2 3 4 5 6 7 8          9 ...
  , ("横: 間が空なら離れていてよい",  connected sample 0 3)
  , ("横: 間に数字があればだめ",      not (connected sample 3 8))
  , ("隣どうし",                      connected sample 4 5)
  , ("行末→次行先頭",                 connected sample 8 9)
  , ("縦: 0 と 9",                    connected sample 0 9)
  , ("斜めの偽物(行をまたぐ)は弾く",  not (connected wrapTrap 8 18))
  , ("本物の右下斜め",                connected diag 0 20)
  , ("本物の左下斜め",                connected diag2 2 18)

  , ("validPairs は i<j で列挙",      all (uncurry (<)) (validPairs sample))
  , ("sample の組",                   validPairs sample == [(0,3),(4,5),(8,9)])

  , ("空の行は消える",                collapseRows (replicate 9 Empty ++ [Num 1]) == [Num 1])
  , ("途中までの空行も消える",        collapseRows (fromDigits ([1,0,0,0,0,0,0,0,0] ++ [0,0])) == fromDigits [1,0,0,0,0,0,0,0,0])
  , ("行の途中の空マスは残る",        collapseRows [Num 1, Empty, Empty] == [Num 1, Empty, Empty])
  , ("追加は末尾の空を詰める",        addNumbers [Num 1, Empty, Num 2, Empty] == [Num 1, Empty, Num 2, Num 1, Num 2])

  , ("パリティ: 消しても偶奇は変わらない", all parityInvariant randomBoards)
  , ("ソルバ: 見つけた手順で本当に全消しになる", all solutionReplays solvableBoards)
  , ("ソルバ: パリティが崩れた盤は追加なしでは解けない", all (\b -> solve 20000 0 b == Nothing) oddBoards)
  , ("ソルバ: 検査対象の盤が実際に存在する", length solvableBoards >= 5)
  , ("27 マス(奇数)の盤はパリティを満たさない", all (not . parityOk) [randomBoard s 27 | s <- [1 .. 50]])
  ]
  where
    sample   = fromDigits ([1,0,0,9,5,5,0,0,2] ++ [8,0,0,0,0,0,0,0,0])
    -- 添字 8 (0 行 8 列) と 18 (2 行 0 列) は差が 10 だが斜めではない。途中の 12 に数字を置いて読み順の経路も塞ぐ。
    wrapTrap = fromDigits (replicate 8 0 ++ [3] ++ [0,0,0,1,0,0,0,0,0] ++ [7] ++ replicate 8 0)
    diag     = fromDigits ([4] ++ replicate 9 0 ++ replicate 9 0 ++ [0,0,6] ++ replicate 6 0)
    diag2    = fromDigits ([0,0,4] ++ replicate 9 0 ++ replicate 6 0 ++ [6] ++ replicate 8 0)

    randomBoards = [randomBoard s 36 | s <- [1 .. 30]]
    parityInvariant b = all (\(i, j) -> parityOk (removePair i j b) == parityOk b) (validPairs b)

    solvableBoards = [b | s <- [1 .. 300], let b = randomBoard s 36, parityOk b, Just _ <- [solve 4000 0 b]]
    solutionReplays b = maybe False (isCleared . replay b) (solve 4000 0 b)

    oddBoards = [b | s <- [1 .. 20], let b = randomBoard s 36, not (parityOk b)]

main :: IO ()
main = do
  hSetEncoding stdout utf8
  results <- mapM run tests
  let failed = length (filter not results)
  putStrLn (show (length tests - failed) ++ " passed, " ++ show failed ++ " failed")
  unless (failed == 0) exitFailure
  where
    run (name, ok) = do
      putStrLn ((if ok then "  ok   " else "  FAIL ") ++ name)
      return ok
