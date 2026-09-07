import Lake
open Lake DSL

package «game2048-proof» where

@[default_target]
lean_lib Game2048 where
  srcDir := "lean"
