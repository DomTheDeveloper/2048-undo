#!/usr/bin/env python3
"""Apply the reviewed manuscript revision only to its exact baseline."""
from pathlib import Path
from hashlib import sha256
import json
r=Path(__file__).resolve().parents[1]
p=r/'paper/main.tex';s=p.read_text()
if r'\input{deductions}' in s:
    print('Research manuscript is already integrated; no replacement performed.')
    raise SystemExit(0)
for name,digest in json.loads((r/'research/baseline-hashes.json').read_text()).items():
    if sha256((r/name).read_bytes()).hexdigest()!=digest:
        raise SystemExit('Refusing to replace concurrently changed file: '+name)
s=s.replace(r'\title{Perfect 2048:\\ the fewest moves, the highest score, the longest game,\\ and what the undo button buys}',r'\title{Perfect 2048:\\ Certified Extremal Play and Stochastic Bounds}')
s=s.replace('Enumeration checks the small\nboards, including the $2\\times2\\times2$ cube, and reproduces the\npublished $3\\times3$ state count.',r'''Exhaustive enumeration of $2\times5$ visits $1{,}814{,}373{,}350$
positions up to symmetry and attains the predicted extrema; smaller
boards include the $2\times2\times2$ cube. Further certified constructions
give $128$ full-chain arrangements, including a noncorner largest tile.
A mass-only stochastic relaxation bounds the standard game's optimal
expected score by $1{,}915{,}854.958$, without enumerating its board states.''')
s=s.replace('The third and fourth questions we have not seen\nasked in print; their answers fall out of the same accounting.','The remaining questions connect extremal configurations and honest-play\nbounds to the same accounting.')
s=s.replace('on $4\\times4$ and for every tile on every board of at most\nten cells.', 'on $4\\times4$ and for every attainable tile on each small board\nlisted in Table~\\ref{tab:exact}.')
s=s.replace('is attained for every tile on every board up to ten cells---the 2048','is attained for every attainable tile on the listed boards of at most ten cells---the 2048')
s=s.replace('On every board up to ten cells, the\nthree-dimensional one included,', 'On each listed board of at most ten cells, including the cube,')
s=s.replace('on every\nboard up to ten cells, the cube included, by exhaustive enumeration','on the listed boards of at most ten cells, including the cube, by exhaustive enumeration')
s=s.replace('boards up to nine cells and the cube solved here','the listed smaller boards and cube solved here')
a=s.index(r'\paragraph{What is new here.}')
b=s.index(r'\section{Preliminaries}',a)
s=s[:a]+r'''\paragraph{Prior art and contribution boundaries.}
The numerical score formula is not new. Rip\`a's June 2014 discussion
\cite{ripa2014} and OEIS entry A244056 \cite{ripaoeis2014} give
$4(n^2-1)(2^{n^2}-1)$, the $4\times4$ value $3932100$, the
$131052$-move figure, and the rare spawn-value expression associated
with the score ceiling. A July 2014 account \cite{amo2014} also derives
the score and notes that the last tile may be 2 or 4. These observations
are credited separately from geometric constructions and formal proofs.
Lees-Miller's 519-move analysis and Eppstein's change-making abstraction
are likewise important antecedents, not results we claim to originate.

Our reproducible contributions combine exact extrema on the listed
boards, complete legal trajectories, fixed-$4\times4$ kernel-checked
minimum-move theorems, and explicit new arrangement certificates.
Section~\ref{sec:deductions} gives a mass-barrier proof of the ceilings,
a score--length generating function for a stochastic relaxation,
policy-independent probability and expectation bounds, and a
kernel-checked quantitative deadline lemma. The $128$ arrangements are
a certified lower bound, not a complete classification. Neither a
failed snake heuristic nor successful kernel checking establishes
historical priority; no unconditional claim of first discovery is made.

''' + s[b:]
s=s.replace('On any board with $c$ cells, every play satisfies\n$\\mathrm{score}\\le\\Phi_c-4c$. Equality requires the final position to be\nthe full chain, reached with exactly one spawned 4 in the merge tree of\neach of its $c$ tiles.',r'''On any board with $c\ge2$ cells, every play satisfies
$\mathrm{score}\le\Phi_c-4c$. Equality after a complete round requires
the full chain with exactly $c$ spawned 4s, or the same chain with its
4 replaced by a 2 and exactly $c-1$ spawned 4s. Each of the $c-1$ larger
tiles has exactly one spawned 4 in its merge tree; a final 4 is itself
spawned.''')
s=s.replace("Equality forces $k_p=c+2-p$ and $h_p=1$ with $h'_p=1$ for every $p$.",r'''Equality forces $m\ge c-1$, and for $p<c$ it forces $k_p=c+2-p$
and $h'_p=h_p=1$. If $m=c-1$, every final tile has value at least 8,
which is impossible just after the mandatory 2/4 spawn. Thus $m=c$.
The final zero-valued bracket permits both
$(k_c,h_c,h'_c)=(2,1,1)$ and $(1,0,0)$, giving the two stated cases.''')
s=s.replace('the full chain is the unique position of maximum mass','the full chain is the unique tile multiset of maximum mass')
s=s.replace('always on the full chain, always with exactly one spawned 4\nper tile,', 'attained on the full chain with exactly one spawned 4\nper tile (and equally on its final-2 variant),')
s=s.replace('which\nneeds every layer, did not fit in memory here and is left to a bigger\nmachine.', 'whose current backward implementation retains every layer, exceeded\navailable memory. This is an implementation limitation, not a proof\nthat an external-memory or recomputing solver cannot finish it.')
s=s.replace('The honest-game side of the same\ncomputation is in Table~\\ref{tab:honest}.','The completed honest-game computations, excluding $2\\times5$, are in\nTable~\\ref{tab:honest}.')
pos=s.index(r'\section{Where the')
s=s[:pos]+'\\input{deductions}\n\n'+s[pos:]
s=s.replace('optimal move in every position; optimal expected score & open;', 'optimal move in every position; optimal expected score & open; expected score $<1{,}915{,}854.958$ here (Section~\\ref{sec:massbellman});')
s=s.replace('eight spiral arrangements reachable (Theorem~\\ref{thm:eight});', '$128$ arrangements certified (Theorem~\\ref{thm:arrangements});')
s=s.replace('probability that an honest game reaches 131072 & open; at least $10^{-57{,}047}$, the probability of the shipped line (Proposition~\\ref{prop:cert})', 'probability that an honest game reaches 131072 & exact value open; between $10^{-57{,}047}$ (Proposition~\\ref{prop:cert}) and $(1+10^{-65535})/11$ (Theorem~\\ref{thm:massprob})')
s=s.replace('At least the eight spirals are; every reachable one has its 4 on the\nboundary beside the 8 (Proposition~\\ref{prop:lastmove}). Can the\n$131072$ sit off the corners, or the 4 at the corner opposite the\n$131072$?',r'''At least $128$ are now certified. Both a noncorner 131072 and a 4
opposite the 131072 are possible (Theorem~\ref{thm:arrangements}).
The full classification, and whether the largest tile can occupy an
interior cell in a full chain, remain unresolved here.''')
s=s.replace('which would prefer spawns with\nmany empty cells','which locally favours 2-spawns and fewer empty cells\nwhen one exact spawn cell is prescribed')
s=s.replace('the possible-play half. Table~\\ref{tab:status} lists both halves.','extremal possible play and upper bounds on honest play.\nTable~\\ref{tab:status} distinguishes these from a strong solution.')
s=s.replace('\\item Section~\\ref{sec:undo}:',r'''\item Section~\ref{sec:deductions}: minimum-length full-chain certificates
with opposite corners and a noncorner largest tile, $128$ distinct
arrangements, a mass-barrier stochastic relaxation, and quantitative
near-optimum rigidity.
\item Section~\ref{sec:undo}:''')
anchor=r'\paragraph{Executable witnesses and experiments.}'
s=s.replace(anchor,r'''\paragraph{Further deductions.}
\texttt{bash research/check.sh} reproduces the sixteen spliced base
certificates, the $128$ endpoint count, the exact rational tests of the
mass-only generating function, the outward-rounded expectation bounds,
the two-by-two score equality counterexample, and the new Lean deadline
lemmas. It does not rerun the billion-state $2\times5$ enumeration or
re-prove geometric attainability of the $4\times4$ score ceiling.

'''+anchor)
s=s.replace(r'\bibliographystyle{plain}',r'''\section*{Computational assistance and verification scope}
Generative AI assistance was used in developing and revising the code,
formal proofs, and manuscript. The stated formal claims are assessed by
the recorded kernel checks, and the executable constructions by the
specified independent replayers. Those checks do not verify historical
priority or the unformalised parts of the manuscript.

\bibliographystyle{plain}''')
p.write_text(s)
bib=r/'paper/refs.bib';t=bib.read_text()+r'''

@misc{ripa2014,
  author = {Marco Rip\`a},
  title = {2048 game: massimo punteggio},
  year = {2014},
  howpublished = {Matematicamente, 14 June 2014},
  url = {https://www.matematicamente.it/giochi-e-gare/gioca-con-la-matematica/2048-gane-massimo-punteggio/},
  note = {In Italian. Numerical score and length bounds and spawn-value probability formula}
}
@misc{ripaoeis2014,
  author = {Marco Rip\`a},
  title = {{OEIS A244056}: Maximum score achievable in the 2048 game on an n by n grid},
  year = {2014},
  howpublished = {The On-Line Encyclopedia of Integer Sequences},
  url = {https://oeis.org/A244056},
  note = {Entry authored 18 June 2014; consulted 7 September 2026}
}
@misc{amo2014,
  author = {{amoO\_O}},
  title = {2048 scoring and the theoretical maximum score},
  year = {2014},
  howpublished = {Qiita, 3 July 2014},
  url = {https://qiita.com/amoO_O/items/743715e918c87d4c4930},
  note = {In Japanese; title translated. Includes the final-2/final-4 observation}
}
''';bib.write_text(t)
p=r/'README.md';s=p.read_text()
insert='''### Further deductions and checked constructions

The research extension supplies **128 distinct minimum-length full-chain
arrangements**, including a **4 opposite 131072** and a **noncorner 131072**.
The largest tile is realised at all twelve boundary cells. This is not a
complete classification; interior placements in a full chain remain open here.
Two representative plain witnesses are `witness/full-chain-opposite-corners.txt`
and `witness/full-chain-noncorner.txt`, both **65,533 legal rounds**.

A mass-only stochastic relaxation gives policy-independent bounds for a
single honest game: probability of the top tile at most
`(1 + 10^(-65535))/11`, full-chain probability below `2.397e-17`, optimal
expected score below **1,915,854.958**, and expected length below
**62,412.330 rounds**. These are upper bounds, not a strong solution.
The paper includes complete derivations and a spawn-count generating function.

The new kernel-checked deadline lemma says that a game finishing within
`d` rounds of the 32,781 optimum has at most `2d` early 2-spawns,
including the opening, before its final fifteen rounds. The probability
corollaries and arrangement enumeration are not separately Lean-formalised.

An audit corrected the old score equality clause: a full chain whose last
4 is replaced by a 2 can attain exactly the same score and length. The
score formula, the 131,052 figure, and the rare maximum-score value-word
probability are credited to 2014 sources, not claimed as new numerical results.

Reproduce the extension with `bash research/check.sh`; see
`research/README.md` for scope, exact source provenance, and remaining questions.

'''
s=s.replace('### 🤖 The AI panel',insert+'### 🤖 The AI panel')
s=s.replace('is attained on every board up to nine cells — always on the full chain,','is attained on the enumerated boards — on the full chain or its final-2 variant,')
s=s.replace('always with exactly one 4 per tile.','with exactly one spawned 4 per larger tile and per final 4 when present.')
s=s.replace('**Longest game.** The same ledger answers a question nobody seems to\nhave asked in print:', '**Longest game.** The same ledger recovers the 2014 length bound:')
s=s.replace('full chain is the unique maximum-mass position','full chain is the unique maximum-mass tile multiset')
s=s.replace('game needs every layer and did not fit in 13 GB.','game was not solved: the current backward implementation retains all layers\nand exceeded 13 GB; that is not a lower bound on the memory a different solver needs.')
p.write_text(s)
print('Applied baseline-checked paper, bibliography, and README revision.')
