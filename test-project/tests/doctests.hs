module Main where

import Test.Tasty.Parallel (mainFromCabal)
import System.Environment (getArgs)

main :: IO ()
main = mainFromCabal "simple" =<< getArgs
