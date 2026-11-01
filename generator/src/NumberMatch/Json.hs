-- | JSON の書き出し(最小限)。ライブラリ(aeson)を使わず、
--   文字列の結合だけで組み立てる。数値のリストは show がそのまま JSON になる。
module NumberMatch.Json
  ( Json
  , jNull, jInt, jBool, jStr, jList, jObj
  , render
  ) where

import Data.List (intercalate)

-- | JSON の値。文字列として組み立て済みのものを持つだけの薄い型。
newtype Json = Json String

render :: Json -> String
render (Json s) = s

jNull :: Json
jNull = Json "null"

jInt :: Int -> Json
jInt = Json . show

jBool :: Bool -> Json
jBool True  = Json "true"
jBool False = Json "false"

jStr :: String -> Json
jStr s = Json (show s)   -- Haskell の show は JSON とほぼ同じエスケープ(ASCII の範囲で使う)

jList :: [Json] -> Json
jList xs = Json ("[" ++ intercalate "," (map render xs) ++ "]")

jObj :: [(String, Json)] -> Json
jObj kvs = Json ("{" ++ intercalate "," [show k ++ ":" ++ render v | (k, v) <- kvs] ++ "}")
