import Lake
open Lake DSL

package «game2048-proof» where

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git" @ "v4.27.0"

@[default_target]
lean_lib Game2048 where
  srcDir := "lean"
