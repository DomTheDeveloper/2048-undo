import Game2048.Basic

/-! Regression checks of the formal rules. These are not assumptions. -/
namespace Game2048.RulesTests

example : Row.left ⟨2,2,2,2⟩ = ⟨4,4,0,0⟩ := by rfl
example : Row.left ⟨2,2,4,0⟩ = ⟨4,4,0,0⟩ := by rfl
example : Row.left ⟨2,0,2,4⟩ = ⟨4,4,0,0⟩ := by rfl
example : Row.left ⟨4,4,4,4⟩ = ⟨8,8,0,0⟩ := by rfl
example : Row.right ⟨2,2,2,0⟩ = ⟨0,0,2,4⟩ := by rfl

private def initial : Board :=
  ⟨⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,4,4⟩⟩

example : initial.slide .up =
  ⟨⟨0,0,4,4⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩⟩ := by rfl
example : initial.slide .down = initial := by rfl
example : initial.slide .left =
  ⟨⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨8,0,0,0⟩⟩ := by rfl
example : initial.slide .right =
  ⟨⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,8⟩⟩ := by rfl

-- Correct first move; 4 lands in the square freed by the merge.
example : step initial ⟨.right,.i3,.i2,4⟩ =
  some ⟨⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,0,0⟩,⟨0,0,4,8⟩⟩ := by rfl

-- Same slide, but the prescribed tile would overwrite the 8: forbidden.
example : step initial ⟨.right,.i3,.i3,4⟩ = none := by rfl
-- An 8 is not a permitted new tile.
example : step initial ⟨.right,.i3,.i2,8⟩ = none := by rfl
-- A move that changes nothing cannot generate a tile.
example : step initial ⟨.down,.i0,.i0,2⟩ = none := by rfl
example : step Board.empty ⟨.up,.i0,.i0,2⟩ = none := by rfl

-- Larger numbers remain exact; there is no fixed-width tile overflow.
example : Row.left ⟨65536,65536,0,0⟩ = ⟨131072,0,0,0⟩ := by rfl

end Game2048.RulesTests
