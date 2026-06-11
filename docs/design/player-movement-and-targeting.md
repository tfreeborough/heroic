# Player Movement & Auto-Targeting

Status: **agreed** · Applies to: both games (shared mechanic) · Last decided: 2026-06-09

## Intent

One-thumb mobile controls. The player drives **movement** with a single virtual
stick and never aims manually — facing and attacking are automatic. This frees a
thumb and solves the twin-stick problem (independent move + aim) that doesn't fit
a phone. Movement is where the skill lives (kiting, positioning); the game aims
for you.

## Movement

- A single virtual joystick produces a desired velocity vector.
- The player is a **circle body** in the Matter.js world. The stick's vector is
  applied to that body (velocity/force); Matter resolves collisions.
- **Acceleration-limited** (decided 2026-06-11): the actual velocity chases the
  desired velocity at capped rates rather than snapping to it. Ramp-up is a
  short wind-up (~0.2s to max); release decelerates much faster but still
  skids a few px, scaling with how fast you were going — weight, not ice.
  Stopping must stay near-instant so kiting isn't mushy.
- **Impassable entities** (walls, etc.) are static/blocking bodies — the player
  physically cannot pass through them; no separate "can I move here" check.
- The player can **move and attack at the same time** (Brotato / survivor-like,
  *not* Archero's stop-to-shoot). Continuous kiting is intended and core.
- The physics body **never rotates** — a circle doesn't need to for collision.
  `facing` is tracked separately (see below) and used only for rendering + attack
  direction. **Movement and facing are fully decoupled** — you can walk one way
  while swinging another. That decoupling is what makes kiting work.

## Facing & targeting

Two radii, both centred on the player:

| Radius | Purpose | Size |
| --- | --- | --- |
| **Engagement radius** | which hostiles the player will *face* | larger |
| **Attack range** | how close a hostile must be to actually get *hit* | smaller, weapon-dependent |

- **Target set = hostiles only.** NPCs and interactables are **not** in the
  auto-target set — you don't want to swing at a chest or a friendly. Interactables
  use a separate proximity interaction (prompt/button), designed elsewhere.
- **Selection = nearest hostile** within the engagement radius, with
  **hysteresis**: keep the current target unless another is meaningfully closer
  (default ~15%). Prevents target flip-flop when two enemies are near-equidistant.
  (Closest is the starting heuristic; threat/low-HP weighting can come later — leave
  a hook, don't build it now.)
- **No hostile in engagement radius:** facing follows the **movement direction**
  while moving (no moonwalking); holds last facing when stationary.
- A hostile inside the engagement radius but outside attack range: the player
  **faces it as it approaches** but holds the attack until it enters attack range.

## The attack cycle

`Ready → Windup → Strike → Recovery → Ready`

- **Ready:** idle until a valid hostile is within **attack range**, then begin Windup.
- **Windup (committed):** at its start, **select the target and lock facing to it.**
  Facing is held through Strike — this is the only window where facing is locked, and
  it's what stops the swing snapping direction mid-animation.
- **Strike:** the hit resolves (see whiff handling below).
- **Recovery (cooldown):** facing is **free to re-track** the current best target
  (with hysteresis), so the *next* Windup already starts aimed at the right enemy.

Consequence to keep in mind: because facing only locks during Windup→Strike,
re-targeting effectively happens every Recovery — so **attack speed is also your
target-switching speed.** Fast builds feel snappy; very slow builds re-target less
often. That's an accepted, tunable trade-off, softened by re-tracking in Recovery.

**Lock-break triggers** (during Windup→Strike): if the locked target dies or leaves
the engagement radius, abort the lock and re-select immediately — never keep facing
a corpse or empty space.

### Whiff handling (move-and-attack consequence)

Because both player and target move during the swing, the target can leave the hit
zone after you've committed. Resolution depends on weapon type:

- **Melee → facing-authoritative.** The hit lands in the **facing direction** with a
  **forgiving arc**. Normal target drift still connects; bad positioning whiffs (and
  eats the cooldown). Readable — you hit where you point — and positioning stays the skill.
- **Ranged → auto-aimed at fire-time.** The projectile spawns toward the target's
  position at the moment of Strike, then travels on its own.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, testable):**
  - target selection — `selectTarget(hostiles, playerPos, engagementRadius, current, hysteresis)` → nearest-with-hysteresis, a pure function
  - the attack-cycle state machine (Ready/Windup/Strike/Recovery) advanced per fixed step
  - `facing` angle as entity state
- **`@heroic/engine` / app layer:**
  - joystick input → velocity on the Matter circle body
  - wall/blocker bodies and collision
  - rendering the body at `facing`, attack arcs / projectiles via Skia

## Open tunables (numbers to find in playtest)

- engagement radius vs attack range (per weapon)
- accel/decel rates (first pass: 1600 / 2800 px/s² at 280 px/s max speed)
- hysteresis margin (default ~15%)
- melee arc width; facing turn speed (default near-instant snap)
- **player speed vs enemy speed** — if the player out-runs everything, kiting
  trivialises melee; balance via swarm density, surrounds, faster/ranged enemies.
  (Balance concern, not a mechanics change.)
