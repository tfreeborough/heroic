# heroic

Fantasy mobile game with rogue-like elements — a Bun monorepo of two Expo / React
Native games that share one engine.

## Why a monorepo

The flagship game (**Heroic**) is a multi-month build. A smaller game,
**Heroic: Enter the Gauntlet**, ships first to validate the core loop and reach the
App Store sooner. Both games are thin app shells over the same shared systems
(pathfinding, combat, simulation), so the hard parts are built once and reused.

## Layout

```
.
├── apps/
│   ├── enter-the-gauntlet/     Heroic: Enter the Gauntlet — ships first
│   └── journey-to-greatness/   Heroic: Journey to Greatness — the main game (in development)
└── packages/
    ├── core/       @heroic/core   — PURE TypeScript game logic (no React Native)
    └── engine/     @heroic/engine — RN runtime: game loop + Matter.js physics
```

### `@heroic/core` (pure TypeScript)

No React Native, no Skia, no DOM — so it's fully unit-testable with `bun test`
and 100% shared between games. Contains:

- `math` — Vec2 helpers (incl. `lerp` for render interpolation)
- `pathfinding` — A* over a uniform grid (`findPath`), 4- or 8-directional
- `combat` — deterministic, seeded attack resolution
- `ecs` — a minimal entity/component/system world
- `sim` — fixed-timestep accumulator (`advanceFixed`) for a stable game loop
- `rng` — seedable PRNG so simulations/replays are reproducible

### `@heroic/engine` (React Native runtime)

The only package that knows about frame timing and physics. Swapping the
renderer (Skia → Pixi) or physics (Matter → Rapier) later means touching this
package and nothing else.

- `useGameLoop` — fixed-timestep loop on `requestAnimationFrame`
- `physics/matterWorld` — thin Matter.js wrapper (+ re-exports `Matter`)

## Tech stack

| Concern   | Choice                              |
| --------- | ----------------------------------- |
| Runtime   | Expo SDK 56, React Native 0.85, React 19 |
| Renderer  | `@shopify/react-native-skia` (native 2D GPU) |
| Physics   | `matter-js` (pure JS, Hermes-safe)  |
| Game loop | fixed-timestep sim + interpolated render |
| UI / HUD  | React Native views over the Skia canvas |
| Tooling   | Bun workspaces, TypeScript (strict) |

**Architecture rule:** simulation is separated from rendering. The fixed-step
sim + physics produce state; Skia just draws the interpolated result. Keeps the
shared core pristine and the game deterministic.

## Commands

```sh
# repo root
bun install            # install + link all workspaces
bun test               # run @heroic/core unit tests
bun run typecheck      # typecheck every workspace

# per app — run from apps/enter-the-gauntlet or apps/journey-to-greatness
bun run start          # start Metro (expo start)
bun run ios            # build + run on iOS (expo run:ios)
bun run android        # build + run on Android
```

Expo SDK 56 auto-configures Metro for monorepos and the Reanimated Babel plugin,
so there are no custom `metro.config.js` / `babel.config.js` files to maintain.
