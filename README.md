# Hammas3D

> Hamster grassland sweeper — Three.js, voxel art, god's-eye view, with Pac-Man-style NPC AI.
>
> A spin-off of [Hammas](https://github.com/Jung217) (Babylon hamster cage sim + Gun Mod), reimagined as an open grassland with hostile hamsters that can fight back.

## What it is

You play a voxel hamster running across a 200×200 grassland. Mouse cursor steers your hamster (auto-walk forward), `A`/`D` strafe, `Q`/`E` rotate the camera. ~150 NPC hamsters wander the field — most just graze, but ~30% are aggressive and will pursue you in coordinated **Pac-Man-style chase / scatter** waves. Get bitten and the BITES counter ticks up.

Sweep them with one of four weapons. Tracers, hit bubbles, screen vignette, blood-flash on hit.

## Stack

| Layer | Choice |
|-------|--------|
| 3D rendering | **Three.js r163**, vendored at `js/three/three.module.js` (no CDN) |
| Code | Pure ES module, single `js/grassland.js` (~1900 lines, no build step) |
| Visual | Voxel art — every entity is `BoxGeometry` / merged box geometries |
| Mass NPCs | Two `InstancedMesh` per hamster (coat / fixed) → ~3 draw calls for 150 hamsters |
| Audio | Web Audio synthesis only — no asset files (gunshot = white-noise burst + lowpass) |
| UI | Vanilla CSS-in-JS glassmorphism HUD overlay |

Open `index.html` over HTTP (importmap requires it):

```bash
cd Hammas3D
python -m http.server 8080
# open http://localhost:8080/
```

## Controls

| Key | Action |
|-----|--------|
| **mouse** | Steer the hamster — your avatar rotates to face the cursor |
| **A / D** | Strafe left / right (perpendicular to facing) |
| **Q / E** | Rotate camera 90° (smooth tween) |
| **click / hold** | Fire current weapon |
| **Space** | Auto-fire (keyboard alt) |
| **1 / 2 / 3 / 4** | Switch to Pistol / SMG / Shotgun / Sniper |
| **Esc** | Pause — splash returns, click PLAY to resume |

The avatar **auto-walks forward** in its facing direction; W/S do nothing.

## Weapons

| Key | Weapon | Fire rate | Spread | Pellets | Tracer | Notes |
|-----|--------|-----------|--------|---------|--------|-------|
| 1 | **Pistol** | 90 ms | 0 | 1 | yellow | balanced default |
| 2 | **SMG** | 55 ms | 0.025 NDC | 1 | cyan | rapid + slight jitter |
| 3 | **Shotgun** | 600 ms | 0.110 NDC | 8 | orange | crowd-clear cone |
| 4 | **Sniper** | 1100 ms | 0 | 1 | white-blue | **pierces** — kills every hamster on the line |

Tracers are stretched `BoxGeometry` from gun barrel to hit point, fading via opacity over each weapon's lifetime.

`SHOTS` is counted **per pellet**, so `ACC` reflects pellet hit-rate (a shotgun click adds 8 to `SHOTS`).

## NPC AI

Each hamster is one of four personalities, assigned randomly at spawn:

| Personality | Share | Coat tint | Behavior |
|-------------|-------|-----------|----------|
| **Wanderer** | 70% | random NPC tint (golden / grey / albino / chocolate) | wander · graze · skittish to gunshots only |
| **Chaser** (Blinky) | 10% | angry red | straight-line pursuit toward player position |
| **Ambusher** (Pinky) | 10% | bubblegum pink | aims **ahead of player velocity** to intercept |
| **Flanker** (Inky) | 10% | sky cyan | approaches from a perpendicular angle, splits L/R by index |

A **global swarm mode** alternates between `SCATTER` (9 s, all NPCs wander/graze) and `CHASE` (14 s, aggressive personalities switch into pursuit). When a chasing NPC closes within `ATTACK_RANGE = 1.7` units, it commits to a 460 ms lunge at attack speed. If the lunge lands, `onBite` fires:
- `BITES` HUD column ticks
- Screen edge red vignette
- Onomatopoeia bubble at impact (`BITE!` / `NOM!` / `CHOMP!` / `OW!` / `GNAW!`)
- 1.5 s cooldown before that hamster can lunge again

Per-hamster state machine — `0 idle/graze · 1 wander · 2 flee · 3 dead · 4 chase · 5 attack`. Heading is **lerped** (turn rate per state: idle 1.0 / wander 3.5 / chase 5.5 / flee 7.5 / attack 9.0) so turns look natural rather than snapping. Wander has periodic **hops** (parabolic Y boost), bigger and more frequent during flee/attack. Each hamster has a `speedMul` personality multiplier (0.85–1.20); aggressive types skew faster (1.05–1.25).

Shooting an aggressive hamster slumps + fades it over 1.4 s; a respawn ticks every 1.5 s with a fresh random personality.

## Scene

- **Sky dome**: vertex-colored sphere, smoothstep gradient from cream horizon (`#fff0d4`) to sky blue (`#6db8e8`).
- **Sun**: voxel cube + additive halo, `fog: false` so it doesn't fade.
- **Clouds**: 8 merged-box puff clusters at altitude, no fog.
- **Ground**: 64×64 quads (non-indexed) with per-quad random green tint from a 4-color palette → pixel-art tile feel.
- **Decoration** (all instanced): 2000 grass tufts, 240 tall grass, 30 trees, 50 rocks, 240 flowers (pink + yellow), 30 mushrooms, 36 bushes, 28 dirt patches, 200 fence segments around the perimeter.
- **Lighting**: warm directional sun (`#ffe6b3`, intensity 1.10), warm-sky → cool-grass hemisphere, soft ambient.
- **Fog**: cream `#f6e6c2`, 75–165 units — distant objects fade into the warm horizon band.

Total runtime: ~20 draw calls, comfortably 60 fps on integrated GPUs.

## Player avatar

Voxel hamster (gold tint) holding a tiny gun. Includes:
- **3D muzzle flash** at gun barrel — a Group of 5 boxes (hot white core, forward gold flame, 3 cross sparkle bars) + a brief `PointLight` for environmental flash. Quadratic decay over 90 ms.
- **Contact shadow**: dark transparent `CircleGeometry` under the player.
- **Drift movement**: target velocity lerps each frame (`PLAYER_ACCEL_LERP = 5.0`); turns produce a sideways slide. Wall hits zero out velocity into the wall to avoid oscillation.

## HUD

Bottom-left glass card: `SHOTS / BONKED / ACC / BITES` columns. Each value bumps with a spring animation when it changes. Top-right: weapon pill — round chip showing the hotkey + weapon name, color-tinted to weapon hue. Pause: top-left `← BACK` pill + center `PAUSED` hint, splash fades back in.

Crosshair = SVG tactical reticle (white ring + 4 red ticks + center dot) tracking the cursor. Pulses while armed, scales 1.22× on each shot for recoil feel. Hit feedback per shot: 8→64 px expanding yellow ring + onomatopoeia bubble at the projected impact point. DOM throttled (rings 70 ms, bubbles 120 ms) so high-rate fire doesn't pile up nodes.

## Files

```
Hammas3D/
├── README.md
├── LICENSE
├── plan.md                      ← original implementation plan
├── index.html                   ← splash + canvas + importmap
└── js/
    ├── grassland.js             ← whole game (single ES module, ~1900 lines)
    └── three/
        └── three.module.js      ← Three.js r163, vendored (1.2 MB)
```

## Tunables (top of `grassland.js`)

```js
WORLD_SIZE                 = 200
NPC_COUNT                  = 150
NPC_AGGRESSIVE_FRAC        = 0.30
NPC_WANDER_SPEED           = 1.4
NPC_FLEE_SPEED             = 5.5
NPC_CHASE_SPEED            = 3.6
NPC_ATTACK_SPEED           = 7.5
ATTACK_RANGE               = 1.7
ATTACK_DURATION_MS         = 460
ATTACK_COOLDOWN_MS         = 1500
SWARM_MODE_SCATTER_MS      = 9000
SWARM_MODE_CHASE_MS        = 14000
PLAYER_AUTO_FORWARD_SPEED  = 7.5
PLAYER_STRAFE_SPEED        = 6.0
WEAPONS                    = [pistol, smg, shotgun, sniper]   # see source for full config
```

Tweak and reload — no build step.

## Roadmap

- Player health / death / round-clear loop (currently endless)
- Power-up "frightened" mode (aggressive NPCs flee briefly after a kill streak)
- Ambient bird/wind audio
- Touch / mobile controls (currently desktop only)
