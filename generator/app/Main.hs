-- | 面データとテストベクタを JSON で書き出す。IO はこのファイルに閉じ込める。
--   使い方:  cabal run gen            (../web に書く)
--            cabal run gen -- <出力先>
module Main (main) where

import System.Environment (getArgs)
import System.IO
import NumberMatch.Board
import NumberMatch.Rules
import NumberMatch.Solver
import NumberMatch.Generate
import NumberMatch.Json

-- | 作るステージ数と、1 回の探索に許すノード数。
stageCount, budget :: Int
stageCount = 30
budget     = 4000   -- 小さめ: 探索がすぐ見つけるボード = 人にも筋道が見つけやすいボード

-- | ステージ 1 面ぶんの結果。
data Stage = Stage
  { stSpec  :: StageSpec
  , stSeed  :: Seed
  , stBoard :: Board
  , stPar   :: Int
  , stMoves :: Int        -- ^ 初手で消せるペアの数(難しさの目安)
  , stSolution :: [Move]
  }

-- | シードを順に試し、追加なしで全消しできるボードを見つける。
--   parityOk で先に弾くと、探索しなくてよいシードが大半になる。
findStage :: StageSpec -> Seed -> Stage
findStage spec seed
  | parityOk b, enoughMoves, Just sol <- solve budget 0 b =
      Stage spec seed b 0 moves sol
  | otherwise = findStage spec (nextSeed seed)
  where
    b     = randomBoard seed (specCells spec)
    moves = length (validPairs b)
    -- 序ボードは初手の選択肢を多めに(やさしく)、後半は絞る。
    enoughMoves
      | specStage spec <= 5 = moves >= 6
      | otherwise           = moves >= 3

-- | 1 ステージ = 同じ設定のボードを variantCount 枚。失敗して再挑戦するとき別のボードを出す。
variantCount :: Int
variantCount = 3

stageVariants :: Int -> [Stage]
stageVariants n = [findStage (stageSpec n) (n * 100003 + 7 + k * 104729) | k <- [0 .. variantCount - 1]]

stageJson :: [Stage] -> Json
stageJson sts@(st : _) = jObj
  [ ("stage", jInt (specStage (stSpec st)))
  , ("cellsCount", jInt (specCells (stSpec st)))
  , ("adds",  jInt (specAdds (stSpec st)))
  , ("par",   jInt (stPar st))
  , ("boards", jList (map boardJson sts))
  ]
stageJson [] = jNull

boardJson :: Stage -> Json
boardJson st = jObj
  [ ("seed",  jInt (stSeed st))
  , ("initialMoves", jInt (stMoves st))
  , ("solutionLength", jInt (length (stSolution st)))
  , ("cells", jList (map jInt (toDigits (stBoard st))))
  ]

-- | テストベクタ: ランダムなボードに数手進めた状態と、各関数の結果。
data Vector = Vector
  { vBoard :: Board
  , vPairs :: [(Pos, Pos)]
  , vAfterRemove :: Maybe Board   -- ^ 最初の組を消して縮約したボード
  , vAfterAdd :: Board
  }

makeVector :: Seed -> Vector
makeVector seed = Vector b ps afterRemove (addNumbers b)
  where
    cellsN = 26 + 2 * (digitFrom seed `mod` 6)
    b0     = randomBoard (nextSeed seed) cellsN
    steps = digitFrom (nextSeed (nextSeed seed)) `mod` 8
    b     = playRandom (nextSeed (nextSeed (nextSeed seed))) steps b0
    ps    = validPairs b
    afterRemove = case ps of
      ((i, j) : _) -> Just (applyMove (Remove i j) b)
      []           -> Nothing

-- | 乱数で選んだ組を n 手ぶん消す(消せるペアが無ければそこで止める)。
playRandom :: Seed -> Int -> Board -> Board
playRandom _ 0 b = b
playRandom s n b =
  case validPairs b of
    [] -> b
    ps -> let (i, j) = ps !! (s `div` 65536 `mod` length ps)
          in playRandom (nextSeed s) (n - 1) (applyMove (Remove i j) b)

vectorJson :: Vector -> Json
vectorJson v = jObj
  [ ("cells", cells (vBoard v))
  , ("pairs", jList [jList [jInt i, jInt j] | (i, j) <- vPairs v])
  , ("afterRemoveFirst", maybe jNull cells (vAfterRemove v))
  , ("afterAdd", cells (vAfterAdd v))
  ]
  where
    cells = jList . map jInt . toDigits

main :: IO ()
main = do
  args <- getArgs
  let outDir = case args of
        (d : _) -> d
        []      -> "../web"
  hSetEncoding stdout utf8
  hSetBuffering stdout LineBuffering   -- 進み具合を 1 行ずつ表示する
  let stages = map stageVariants [1 .. stageCount]
  mapM_ (mapM_ report) stages
  writeFile (outDir ++ "/levels/stages.json") (render (jList (map stageJson stages)))
  let vectors = [makeVector (s * 7919 + 1) | s <- [1 .. 40]]
  writeFile (outDir ++ "/test/vectors.json") (render (jList (map vectorJson vectors)))
  putStrLn ("wrote " ++ show (length stages) ++ " stages x " ++ show variantCount ++ " boards, " ++ show (length vectors) ++ " vectors")
  where
    report st = putStrLn $ concat
      [ "stage ", show (specStage (stSpec st))
      , " seed=", show (stSeed st)
      , " cells=", show (specCells (stSpec st))
      , " moves=", show (stMoves st)
      , " solution=", show (length (stSolution st))
      ]
