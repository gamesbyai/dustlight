# Dustlight

A small browser game drawn with about 1.7 million Gaussian splats. You're a paper-lantern spirit on a sky island at
night. Every landmark has fallen apart into drifting dust, and each ember you find pulls one back together, splat by
splat. Bring all four home and light the lamp.

**Play it:** https://gamesbyai.win/games/dustlight/ (or straight from this repo's page: https://gamesbyai.github.io/dustlight/)

**How we made it:** https://gamesbyai.win/blog/gaussian-splatting-game-with-blender/

Codex drew a front and a side view of every model. Claude Code wrote the Blender Python that turned those drawings
into painted models, and a Geometry Nodes group turned the models into Blender 5.3's native Gaussian splats. Blender
5.3 can't export splats yet, so a short script writes them as standard 3DGS files, and three.js with
[Spark](https://sparkjs.dev/) draws them here, with small GPU programs per splat for the dust and the colour. The
sound effects are synthesised in code, and the old keeper's voice was designed with VoxCPM2.

## Run it

```
npm install
npm run dev      # http://localhost:5270
npm run build    # static site in dist/, relative paths
```

`NOTES.md` explains how the game works, file by file. `docs/` is the built game that GitHub Pages serves.

## Controls

WASD or arrow keys to move, drag to look, Space to hop. On a phone: left thumb to move, drag to look, the hop button.

## Licence

The code is MIT licensed (see `LICENSE`). The art, sound and voice files in `public/` (splats, colliders, audio) are
© GamesByAI and not covered by the MIT licence. The fonts in `public/fonts/` keep their own licences.

A [GamesByAI](https://gamesbyai.win/) game.
