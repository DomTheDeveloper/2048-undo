import Std

namespace Game2048

inductive Dir where
  | U | R | D | L
  deriving DecidableEq, Repr

structure Step where
  dir : Dir
  row : Nat
  col : Nat
  rank : Nat
  deriving DecidableEq, Repr

/-- A 4x4 board in row-major order. 0 means empty; k>0 means tile 2^k. -/
abbrev Board := List Nat

def emptyBoard : Board := List.replicate 16 0

def idx (row col : Nat) : Nat := 4 * row + col

def cell (b : Board) (row col : Nat) : Nat := b.getD (idx row col) 0

def setCell (b : Board) (row col rank : Nat) : Board := b.set (idx row col) rank

def tileValue (rank : Nat) : Nat := if rank = 0 then 0 else 2 ^ rank

def boardMass (b : Board) : Nat := b.foldl (fun s r => s + tileValue r) 0

def maxRank (b : Board) : Nat := b.foldl Nat.max 0

def containsRank (b : Board) (r : Nat) : Bool := b.any (· == r)

private def mergePacked : List Nat → List Nat
  | [] => []
  | [a] => [a]
  | a :: b :: rest =>
      if a = b then (a + 1) :: mergePacked rest
      else a :: mergePacked (b :: rest)

def mergeLine (xs : List Nat) : List Nat :=
  (mergePacked (xs.filter (fun x => x != 0)) ++ List.replicate 4 0).take 4

def lineIndices (d : Dir) (i : Nat) : List Nat :=
  match d with
  | .U => [i, 4 + i, 8 + i, 12 + i]
  | .D => [12 + i, 8 + i, 4 + i, i]
  | .L => [4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3]
  | .R => [4 * i + 3, 4 * i + 2, 4 * i + 1, 4 * i]

private def readAt (b : Board) (is : List Nat) : List Nat :=
  is.map (fun i => b.getD i 0)

private def writeAt : Board → List Nat → List Nat → Board
  | b, i :: is, v :: vs => writeAt (b.set i v) is vs
  | b, _, _ => b

def slide (b : Board) (d : Dir) : Board :=
  [0, 1, 2, 3].foldl (fun acc i =>
    let is := lineIndices d i
    writeAt acc is (mergeLine (readAt b is))) b

/-- One standard 2048 move: a nontrivial slide, then one legal 2/4 spawn. -/
def applyStep (b : Board) (s : Step) : Option Board :=
  let moved := slide b s.dir
  if moved = b then none
  else if s.row < 4 ∧ s.col < 4 ∧ (s.rank = 1 ∨ s.rank = 2) then
    if cell moved s.row s.col = 0 then some (setCell moved s.row s.col s.rank)
    else none
  else none

def replay : Board → List Step → Option Board
  | b, [] => some b
  | b, s :: ss =>
      match applyStep b s with
      | none => none
      | some b' => replay b' ss

theorem replay_append (b : Board) (xs ys : List Step) :
    replay b (xs ++ ys) =
      match replay b xs with
      | none => none
      | some b' => replay b' ys := by
  induction xs generalizing b with
  | nil => rfl
  | cons x xs ih =>
      simp only [List.cons_append, replay]
      cases h : applyStep b x with
      | none => simp [h]
      | some b' => simp [h, ih]

/-- The canonical witness starts with two 4s in the bottom-right corner. -/
def witnessStart : Board :=
  [0,0,0,0,
   0,0,0,0,
   0,0,0,0,
   0,0,2,2]

end Game2048
