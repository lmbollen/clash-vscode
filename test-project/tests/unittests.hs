import Test.Tasty

import qualified Tests.Example.Project
import Prelude
main :: IO ()
main = defaultMain tests

tests :: TestTree
tests = testGroup "."
  [ Tests.Example.Project.tests
  ]
