# 2048
A small clone of [1024](https://play.google.com/store/apps/details?id=com.veewo.a1024), based on [Saming's 2048](http://saming.fr/p/2048/) (also a clone).

Made just for fun. [Play it here!](http://gabrielecirulli.github.io/2048/)

### ⚡ SUPER MODE

This fork's undo button re-randomizes the spawn seed, which makes something
delightful possible: an AI that plays a *perfect* game. Hit **SUPER MODE**
and it builds the perfect spiral — 4, 8, 16 … 65536 snaked into your chosen
corner — undoing every unlucky spawn along the way (watch the undo counter).
When the spiral is complete, one final 4 drops into the last free cell and
the whole chain folds into **131072**, the highest tile 2048's rules allow.

- Pick the target corner (bottom-right by default) on the mini-board.
- Pick a speed: **1×–5×**, or **AFAP** (as fast as possible).
- Pick a flavor:
  - **🎲 SUPER** — spawns stay honest (90% twos, random cells); every
    unlucky one gets undone and re-rolled. About 1.8 million undos per
    perfect game.
  - **🔮 PREDICTABLE** — the AI decides which tile comes next *and where
    it lands*, choosing the placement that finishes fastest. Zero undos,
    zero luck: every move within ~12% of the 32,767-move lower bound that
    mass arithmetic allows.
- The finale always plays out in slow motion. It's the money shot.

The engine (`js/super_ai.js`) is a checkpoint search over controlled
outcomes: it plans a line of moves together with the spawn each move
needs, then either re-rolls reality until it matches (super) or simply
places the planned tile (predictable). Every state on screen is a real,
legal game state reached by real moves. All searching runs in a Web
Worker (`js/super_worker.js`), one line prefetched ahead, so the page
stays at 60fps even while the planner thinks hard.
`node test/run.js` drives the same engine headless as proof
(`PREDICTABLE=1` for the controlled-spawn mode).

### Contributions

 - [TimPetricola](https://github.com/TimPetricola) added best score storage
 - [chrisprice](https://github.com/chrisprice) added custom code for swipe handling on mobile

Many thanks to [rayhaanj](https://github.com/rayhaanj), [Mechazawa](https://github.com/Mechazawa), [grant](https://github.com/grant), [remram44](https://github.com/remram44) and [ghoullier](https://github.com/ghoullier) for the many other good contributions.

### Screenshot

[![Screenshot](http://pictures.gabrielecirulli.com/2048-20140309-234100.png)](http://pictures.gabrielecirulli.com/2048-20140309-234100.png)

That screenshot is fake, by the way. I never reached 2048 :smile:

## Contributing
Changes and improvements are more than welcome! Feel free to fork and open a pull request. Please make your changes in a specific branch and request to pull into `master`! If you can, please make sure the game fully works before sending the PR, as that will help speed up the process.

You can find the same information in the [contributing guide.](https://github.com/gabrielecirulli/2048/blob/master/CONTRIBUTING.md)

## License
2048 is licensed under the [MIT license.](https://github.com/gabrielecirulli/2048/blob/master/LICENSE.txt)

## Donations
I made this in my spare time, and it's hosted on GitHub (which means I don't have any hosting costs), but if you enjoyed the game and feel like buying me coffee, you can donate at my BTC address: `1Ec6onfsQmoP9kkL3zkpB6c5sA4PVcXU2i`. Thank you very much!
