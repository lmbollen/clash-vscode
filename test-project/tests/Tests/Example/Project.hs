module Tests.Example.Project where

import Prelude

import Test.Tasty
import Test.Tasty.TH
import Test.Tasty.Hedgehog

import Hedgehog ((===))
import qualified Hedgehog as H
import qualified Hedgehog.Gen as Gen
import qualified Hedgehog.Range as Range

prop_example :: H.Property
prop_example = H.property $ do
  x <- H.forAll (Gen.int (Range.linear 0 100))
  x === x

tests :: TestTree
tests = $(testGroupGenerator)
