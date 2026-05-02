# Hammas3D

> Voxel hamster grassland shooter built with Three.js. Pac-Man-style NPC AI, 4 weapons, 3 camera modes, plays on desktop & mobile.
>
> A spin-off of [Hammas](https://github.com/Jung217) (Babylon hamster cage sim + Gun Mod), reimagined as an open grassland with hostile hamsters that fight back.

## What it is

You play a voxel hamster running across a 200×200 grassland. Mouse cursor (or finger drag on touch) steers your hamster — it auto-walks forward in the direction it's facing. ~150 NPC hamsters wander the field; ~30% are aggressive and pursue you in coordinated **Pac-Man-style chase / scatter** waves. Get bitten and the BITES counter ticks up.

Sweep them with one of four weapons. Each has its own fire rate, spread, range, tracer color, and visible 3D model on the player avatar. Tracers always draw — even on misses they show the bullet's max range.

## Stack

| Layer | Choice |
|-------|--------|
| 3D rendering | **Three.js r163**, vendored at `js/three/three.module.js` (no CDN) |
| Code | Pure ES modules, split into 4 files (~2400 lines total, no build step) |
| Visual | Voxel art — every entity is `BoxGeometry` / merged box geometries |
| Mass NPCs | Two `InstancedMesh` per hamster (coat / fixed) → ~3 draw calls for 150 hamsters |
| Audio | Web Audio synthesis only — no asset files (gunshot = white-noise burst + lowpass) |
| UI | Vanilla CSS-in-JS glassmorphism HUD overlay |
| Input | PointerEvents (mouse + touch unified), KeyboardEvent fallbacks |

Open `index.html` over HTTP (importmap requires it):

```bash
cd Hammas3D
python -m http.server 8080
# open http://localhost:8080/
```

## Controls

### Desktop

| Input | Action |
|-------|--------|
| **mouse** | Steer the hamster — your avatar rotates to face the cursor (CHASE / TOP modes) |
| **A / D** | Strafe (CHASE / TOP) · Rotate yaw (FPS) |
| **Q / E** | Rotate camera 90° (CHASE only, smooth tween) |
| **click / hold** | Fire current weapon |
| **Space** | Auto-fire (keyboard alt) |
| **1 / 2 / 3 / 4** | Switch to Pistol / SMG / Shotgun / Sniper |
| **V** | Cycle camera mode (CHASE → FPS → TOP) |
| **wheel** | Zoom (TOP only, height 10–180 units) |
| **Esc** | Pause — splash returns, click PLAY to resume |
| **F3** / **`** | Toggle FPS · CALLS · TRIS perf overlay |
| hover top-left | Show `← BACK` pill (≤38 px corner zone) |

The avatar **auto-walks forward** in its facing direction; W/S do nothing.

### Mobile / touch

When the page detects a coarse pointer (`@media (pointer: coarse)`), an on-screen control set appears:

| UI | Action |
|----|--------|
| **drag anywhere** | Aim — the on-screen crosshair tracks your finger; player rotates to face it |
| big red **FIRE** button (bottom-right) | Press & hold to auto-fire |
| **GUN** chip (bottom-left) | Tap to cycle weapon, label shows current name |
| **CAM** chip (bottom-left) | Tap to cycle camera mode |
| **PAUSE** chip (bottom-left) | Tap to toggle pause (== Esc) |

Pinch-zoom and double-tap zoom are disabled (`viewport-fit=cover`, `user-scalable=no`, `touch-action: none`).

## Weapons

| Key | Weapon | Fire rate | Spread | Pellets | Range | Tracer | Notes |
|-----|--------|-----------|--------|---------|-------|--------|-------|
| 1 | **Pistol** | 90 ms | 0 | 1 | 36 u | yellow | balanced default |
| 2 | **SMG** | 55 ms | 0.025 NDC | 1 | 28 u | cyan | rapid + slight jitter, short range |
| 3 | **Shotgun** | 600 ms | 0.110 NDC | 8 | 14 u | orange | crowd-clear cone, very short range |
| 4 | **Sniper** | 1100 ms | 0 | 1 | 110 u | white-blue | **pierces** — kills every hamster on the line |

**Range** is enforced via `raycaster.far = weapon.range` so hits beyond the limit don't register. **Tracers always draw**: stretched `BoxGeometry` from gun barrel to hit point on a kill, or to `range` units along the ray on a miss — so you can see how far each weapon reaches.

Each weapon has a **distinct voxel gun model** on the player avatar:
- **Pistol** — 2-piece slide + grip
- **SMG** — barrel + receiver + dropping magazine + top rail (4 pieces)
- **Shotgun** — over/under double barrel + wood receiver + wood stock (4 pieces)
- **Sniper** — long thin barrel + wood receiver/stock + scope tube + eyepiece + objective (6 pieces)

The 3D muzzle flash relocates to each weapon's barrel tip on switch.

`SHOTS` is counted **per pellet**, so `ACC` reflects pellet hit-rate (a shotgun click adds 8 to `SHOTS`).

## NPC AI

Each hamster is one of four personalities, assigned randomly at spawn:

| Personality | Share | Coat tint | Behavior |
|-------------|-------|-----------|----------|
| **Wanderer** | 70% | random NPC tint (golden / grey / albino / chocolate) | wander · graze · skittish to gunshots only · biases toward grass tufts when changing heading |
| **Chaser** (Blinky) | 10% | angry red | straight-line pursuit toward player position |
| **Ambusher** (Pinky) | 10% | bubblegum pink | aims **ahead of player velocity** to intercept |
| **Flanker** (Inky) | 10% | sky cyan | approaches from a perpendicular angle, splits L/R by index |

A **global swarm mode** alternates between `SCATTER` (9 s, all NPCs wander/graze) and `CHASE` (14 s, aggressive personalities switch into pursuit). When a chasing NPC closes within `ATTACK_RANGE = 1.7 u`, it commits to a 460 ms lunge at attack speed. If the lunge lands, `onBite` fires:
- `BITES` HUD column ticks
- Screen edge red vignette
- Onomatopoeia bubble at impact (`BITE!` / `NOM!` / `CHOMP!` / `OW!` / `GNAW!`)
- 1.5 s cooldown before that hamster can lunge again

**Gunshot detection**: aggressive types ALSO react to gunshots, but **inversely** to wanderers — they detect within `ALERT_RADIUS_AGGRESSIVE = 18 u` (vs 9 u for wanderers), switch straight to CHASE, head **toward** the shot, and stay enraged for 5 s with a 1.40× speed multiplier.

**Random evasion** while chasing:
- Continuous sine-wiggle on heading (±31°, ~1.14 s period, per-instance phase offset)
- Occasional sharp side juke every 380–1100 ms (±49°, exponentially decays)
- **Distance attenuation**: dodge is suppressed when within 2 u so the lunge actually lands

Per-hamster state machine — `0 idle/graze · 1 wander · 2 flee · 3 dead · 4 chase · 5 attack`. Heading is **lerped** so turns look natural rather than snapping (turn rate per state: idle 1.0 / wander 3.5 / chase 5.5 / flee 7.5 / attack 9.0). Wander has periodic **hops** (parabolic Y boost), bigger and more frequent during flee/attack. Each hamster has a `speedMul` personality multiplier (0.85–1.20); aggressive types skew faster (1.05–1.25).

Shooting an aggressive hamster slumps + fades it over 1.4 s; a respawn ticks every 1.5 s with a fresh random personality.

## Camera

Three modes, cycled with **V**:

| Mode | Setup | Notes |
|------|-------|-------|
| **CHASE** (default) | Offset `(0, 14.5, 11)` from player, lerps with `0.12` smoothing; Q/E rotates yaw 90° in ~0.18 s tween | Standard 3rd-person follow |
| **FPS** | Camera at hamster head (height 0.65), looks down player's facing axis; A/D rotates the player; mouse cursor does **not** drag the camera — only the on-screen reticle | Player body + contact shadow auto-hide so you don't see inside the hamster |
| **TOP** | Straight overhead, height 55 u default, **scroll wheel zooms** (10–180 u). `camera.up = (0, 0, -1)` keeps "north" consistent | Best for crowd-clear with shotgun |

## Scene

- **Sky dome**: vertex-colored sphere, smoothstep gradient from cream horizon (`#fff0d4`) to sky blue (`#6db8e8`)
- **Sun**: voxel cube + additive halo, `fog: false` so it doesn't fade
- **Clouds**: 8 merged-box puff clusters at altitude, no fog
- **Ground**: 64×64 quads (non-indexed) with per-quad random green tint from a 4-color palette → pixel-art tile feel
- **Decorations** (all instanced): 2000 grass tufts, 240 tall grass, 30 trees, 50 rocks, 240 flowers (pink + yellow), 30 mushrooms, 36 bushes, 28 dirt patches, 200 fence segments around the perimeter
- **Lighting**: warm directional sun (`#ffe6b3`, intensity 1.10), warm-sky → cool-grass hemisphere, soft ambient
- **Fog**: cream `#f6e6c2`, 75–165 u — distant objects fade into the warm horizon band

Total runtime: ~22 draw calls, comfortably 60 fps on integrated GPUs (toggle perf overlay with `F3` to verify).

## Player avatar

Voxel hamster (gold tint). Per-frame:
- **Drift movement**: target velocity lerps each frame (`PLAYER_ACCEL_LERP = 5.0`); turning produces a sideways slide. Wall hits zero out velocity into the wall to avoid oscillation
- **Smooth yaw**: lerps toward aim direction; FPS mode bumps the rate 1.6× for snappy A/D rotation
- **3D muzzle flash** at gun barrel — Group of 5 boxes (hot white core, forward gold flame, 3 cross sparkle bars) + a brief `PointLight`. Quadratic decay over 90 ms. Position relocates per weapon
- **Contact shadow**: dark transparent `CircleGeometry` under the player (hidden in FPS)
- **Per-weapon gun model**: `_gunGeoms[]` cache pre-built voxel gun geometries; `_setWeapon` swaps `_playerGun.geometry`

## HUD

| Edge | Element | When visible |
|------|---------|--------------|
| top-left | `← BACK` pill | when paused, or hover within ≤38 px corner |
| top-left | weapon pill (key + name, color-tinted) | always |
| top-left (below) | camera mode pill | always |
| top-center | `PAUSED — Esc resume` hint | when paused |
| bottom-right | stats card: `SHOTS / BONKED / ACC / BITES` | always |
| bottom-left | perf overlay (FPS · CALLS · TRIS) | F3 / backtick toggle |
| bottom-right | big red `FIRE` button (touch only) | coarse pointer |
| bottom-left column | GUN / CAM / PAUSE chips (touch only) | coarse pointer |

Crosshair = SVG tactical reticle (white ring + 4 red ticks + center dot) tracking the cursor. Pulses while armed, scales 1.22× on each shot for recoil feel. Hit feedback per shot: 8→64 px expanding yellow ring + onomatopoeia bubble at the projected impact point. DOM throttled (rings 70 ms, bubbles 120 ms) so high-rate fire doesn't pile up nodes.

## Files

```
Hammas3D/
├── README.md
├── LICENSE
├── plan.md                      ← original implementation plan (kept for reference)
├── index.html                   ← splash + canvas + importmap + viewport meta
├── favicon.svg                  ← voxel hamster head on grass
└── js/
    ├── grassland.js             ← Game class + bootstrap + weapons / camera / UI gates  (~790 lines)
    ├── world.js                 ← buildWorld + voxel helpers + buildPlayerAvatar         (~580 lines)
    ├── swarm.js                 ← Swarm class + Pac-Man AI constants                     (~470 lines)
    ├── hud.js                   ← injectHUD + popups + bang() + projectToScreen          (~590 lines)
    └── three/
        └── three.module.js      ← Three.js r163, vendored (1.2 MB)
```

## Tunables (top of `grassland.js` and `swarm.js`)

```js
WORLD_SIZE                 = 200
NPC_COUNT                  = 150
NPC_AGGRESSIVE_FRAC        = 0.30
NPC_WANDER_SPEED           = 1.4
NPC_FLEE_SPEED             = 5.5
NPC_CHASE_SPEED            = 5.2
NPC_ATTACK_SPEED           = 9.8
ATTACK_RANGE               = 1.7
ATTACK_DURATION_MS         = 460
ATTACK_COOLDOWN_MS         = 1500
SWARM_MODE_SCATTER_MS      = 9000
SWARM_MODE_CHASE_MS        = 14000
ALERT_RADIUS_AGGRESSIVE    = 18
AGGRO_RAGE_MS              = 5000
AGGRO_RAGE_SPEED_MUL       = 1.40
NPC_DODGE_AMP              = 0.55   // ±31° chase wiggle
NPC_JUKE_AMP               = 0.85   // ±49° sharp juke
PLAYER_AUTO_FORWARD_SPEED  = 7.5
PLAYER_STRAFE_SPEED        = 6.0
FPS_TURN_RATE              = 2.6    // rad/s for A/D in FPS
TOPDOWN_CAM_HEIGHT         = 55     // default zoom; wheel can change to 10–180
WEAPONS                    = [pistol, smg, shotgun, sniper]   // see source for full config (range, gunBoxes, etc.)
```

Tweak and reload — no build step.

## Roadmap

- Player health / death / round-clear loop (currently endless)
- Power-up "frightened" mode (aggressive NPCs flee briefly after a kill streak)
- Ambient bird/wind audio
- Larger world with chunked terrain
- Gamepad support
