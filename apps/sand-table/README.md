# The Sand Table

A hand-drawn whiteboard in the game's colours, for drawing explainers on
camera. Our own take on Excalidraw: nothing to pay for, every stamp and
colour is ours, and the drawing itself can be played back and exported as a
clip.

```sh
bun run sand          # from the repo root → http://localhost:3500
```

## The board

Draw with the tools along the top (each has a key: **V** select, **H** hand,
**P** pen, **R** rectangle, **O** ellipse, **D** diamond, **A** arrow, **L**
line, **T** text, **F** frame, **E** eraser, **S** stamps). Shapes go through
roughjs, the hand-drawn pen, with a fixed seed per shape so nothing wobbles
between frames. The style panel on the left sets the stroke and fill from the
game's palette, the fill hatching, width, sloppiness (ruler / hand / scrawl),
arrowheads, and for text the face: **Hand** (Caveat), **Title** (the game's
Cinzel) or **Plain** (Inter).

Select, marquee, move, resize from the handles, drag an arrow's ends. ⌘Z /
⇧⌘Z undo, ⌘D duplicate, ⌘A all, ⌫ delete, arrows nudge (⇧ ×10), `[` `]`
layer, **G** the dot grid. The tool stays after each draw; Esc goes back
to select, and **Q** switches to the flick-back-after-each-draw habit. Scroll pans,
pinch or ⌘-scroll zooms, hold Space to drag the view, ⇧1 fits the drawing.
Double-click a text to edit it; Esc or ⌘↩ finishes.

**Stamps (S)** are a drawer of pictures for diagrams (a server, a phone, a
cloud, a bolt, a skull…) drawn by the same pen in the stroke colour, plus the
game's own art: weapon and ability icons, mode cards, ranks, deeds. Pick one,
click the board to place it.

Scenes save themselves to `scenes/<game>/<name>.json` (committed: a scene is
the source of its clip; they're small). The select at the top switches
between them.

## On camera

Two ways to get a clip:

**Replay & clip (K).** Every element remembers when it was drawn and how
long it took, so the board can play the drawing back: strokes trace
themselves, text types out, stamps pop in, with the thinking time between
them cut to a beat. Scrub it, set the speed, then **Export clip**: the page
paints every frame of the replay itself at the chosen format (vertical,
square, landscape) and the server stitches them with ffmpeg. H.264 mp4, or a
ProRes 4444 `.mov` with alpha when **transparent background** is ticked, for
laying over footage. **Place frame (F)** puts a dashed frame on the board to
say what the clip shows; without one it fits the whole drawing. **Save a
still** writes one PNG of the finished drawing. Draw it slowly and badly,
tidy it up, then export it drawn in one clean take: that's the point.

**Present (Tab)** hides every panel and the grid so a screen recorder (or
**Record live**, which captures the canvas itself through the browser) gets
the board and nothing else, while you draw and talk. Tab brings the panels
back.

Finished files land in `out/<game>/` (gitignored), listed at the bottom of
the panel with **To the Desk**, which drops the clip onto the Desk's
`SAND TABLE` shelf (the Desk has to be running) ready to use in an edit.

## Adding a game

`games.ts`: an entry with the palette, the title face, the icon and the art
folders the stamp drawer should show. Scenes and outputs are per game.

## Shape of the code

- `lib/scene.ts` the element types, the replay `timeline()` (pure, tested)
- `lib/geometry.ts` bounds, hit testing, resize maths (pure, tested)
- `lib/glyphs.ts` the diagram pictures as primitives in a 100×100 box
- `lib/store.ts` scenes and outputs on disk; `lib/export.ts` frames → ffmpeg, live recordings, the Desk hand-off; `lib/stamps.ts` the art folders
- `ui/render.ts` paints elements to a 2D context: the live board, the replay and the exporter all go through it
- `ui/Board.tsx` the canvas and everything the pointer does; `ui/App.tsx` state, keys, panels

Gotchas: a request body must be streamed to disk chunk by chunk
(`Bun.write(path, new Response(body))` never finishes). The canvas prevents
default on pointerdown, or its mousedown would blur the text box it just
opened. Fonts load through the FontFace API, never a `url()` in CSS the
bundler would try to resolve.
