import * as THREE from 'three';

// ============================================================
//   Hammas — Hamster Grassland
//   Three.js voxel-art open-world hamster shooter.
//   Player controls a voxel hamster avatar, third-person follow cam,
//   sweeps fire at NPC hamsters wandering a 200x200 grassland.
// ============================================================

// ---------- Tunables ----------
const WORLD_SIZE       = 200;
const HALF_WORLD       = WORLD_SIZE / 2;
const NPC_COUNT        = 150;
const FIRE_INTERVAL_MS = 90;
const PLAYER_SPEED     = 9.5;
const NPC_WANDER_SPEED = 1.4;
const NPC_FLEE_SPEED   = 5.5;
const FLEE_RADIUS      = 9;
const FLEE_DURATION_MS = 2500;
const DEATH_DURATION_MS= 1400;
const SPAWN_FADE_MS    = 420;
const RESPAWN_INTERVAL_MS = 1500;
const CAMERA_OFFSET    = new THREE.Vector3(0, 14.5, 11);
const CAMERA_LERP      = 0.12;
const CAMERA_YAW_LERP  = 3.5;        // per-second factor (was 6, plan called for ~0.18s tween)
const GROUND_PLANE     = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const PLAYER_HAM_COLOR = new THREE.Color(0xffd479);

// Per-instance NPC tints (golden / grey / albino / chocolate).
// The hamster's coat geometry is built with white vertex colors so instanceColor
// multiplies cleanly; head / paws / ears all pick up the tint, while baked-in
// parts (eyes, snout, nose, belly stripe, tail) come from a separate fixed mesh.
const NPC_TINTS = [
  new THREE.Color(0xe6a256), // golden
  new THREE.Color(0xb6b3a8), // grey
  new THREE.Color(0xf3e6c9), // albino / cream
  new THREE.Color(0x8a5a36), // chocolate
];

// Ground "tile" palette — 4 green hues, randomly assigned per quad
const GROUND_GREENS = [
  [0.30, 0.62, 0.20],
  [0.34, 0.68, 0.22],
  [0.27, 0.56, 0.18],
  [0.38, 0.72, 0.26],
];

// UI / input gates
const SPLASH_GATE_MS    = 600;   // ignore mousedown for 600ms after PLAY to prevent leak-through
const BUBBLE_THROTTLE_MS = 120;  // min spacing between hit bubbles (DOM cap)
const RING_THROTTLE_MS   = 70;   // min spacing between hit rings

// Player movement — auto-runner: hamster always walks forward in its facing direction,
// mouse cursor steers (player rotates to face aim), A/D strafes perpendicular.
const PLAYER_AUTO_FORWARD_SPEED = 7.5;
const PLAYER_STRAFE_SPEED       = 6.0;
const PLAYER_ACCEL_LERP   = 5.0;  // per-second factor — smooth approach to target velocity (drift feel)
const PLAYER_YAW_LERP     = 9.0;  // per-second factor for facing-aim rotation (turning drift)

// Weapons — switch with 1/2/3/4 number keys
const WEAPONS = [
  { name: 'PISTOL',  key: '1', fireMs:  90, spread: 0.000, pellets: 1, color: 0xffd84a, width: 0.05, life: 50,  pierce: false },
  { name: 'SMG',     key: '2', fireMs:  55, spread: 0.025, pellets: 1, color: 0x6cf0ff, width: 0.04, life: 45,  pierce: false },
  { name: 'SHOTGUN', key: '3', fireMs: 600, spread: 0.110, pellets: 8, color: 0xff8a3a, width: 0.06, life: 80,  pierce: false },
  { name: 'SNIPER',  key: '4', fireMs: 1100, spread: 0.000, pellets: 1, color: 0xe8f0ff, width: 0.08, life: 130, pierce: true  },
];

// Player muzzle flash decay
const MUZZLE_FLASH_MS = 90;

// ---------- Hamster NPC AI — Pac-Man-style personalities + chase/scatter modes ----------
// Most hamsters are passive WANDERER. ~30% are aggressive (split among 3 archetypes).
const PERSONALITY_WANDERER = 0; // graze + wander, skittish to gunshots only
const PERSONALITY_CHASER   = 1; // straight-line chase toward player position (Blinky)
const PERSONALITY_AMBUSHER = 2; // intercept — aim ahead of player velocity (Pinky)
const PERSONALITY_FLANKER  = 3; // approach from a perpendicular angle (Inky)

// Override coat tint for aggressive types so the player can read them at a glance
const AGGRESSIVE_TINTS = {
  [PERSONALITY_CHASER]:   new THREE.Color(0xff5050), // angry red
  [PERSONALITY_AMBUSHER]: new THREE.Color(0xffaedb), // bubblegum pink
  [PERSONALITY_FLANKER]:  new THREE.Color(0x80e0ff), // sky cyan
};

const NPC_AGGRESSIVE_FRAC = 0.30; // share of swarm that is aggressive
const NPC_CHASE_SPEED     = 3.6;
const NPC_ATTACK_SPEED    = 7.5;
const ATTACK_RANGE        = 1.7;  // distance at which a chasing NPC commits to attack
const ATTACK_HIT_RANGE    = 2.4;  // landing window during the lunge
const ATTACK_DURATION_MS  = 460;
const ATTACK_COOLDOWN_MS  = 1500;

// Global swarm mode oscillation — drives whether aggressive NPCs chase or scatter
const SWARM_MODE_SCATTER_MS = 9000;
const SWARM_MODE_CHASE_MS   = 14000;

// Aggressive types ALSO react to gunshots — but opposite of wanderers (charge in, don't flee)
const ALERT_RADIUS_AGGRESSIVE = 18;     // bigger than passive flee radius
const AGGRO_RAGE_MS           = 5000;   // brief rage timer after hearing a shot
const AGGRO_RAGE_SPEED_MUL    = 1.40;   // chase speed multiplier during rage

// Camera modes — V key cycles through these
const CAMERA_MODES = [
  { name: 'CHASE', key: 'V' },
  { name: 'FPS',   key: 'V' },
  { name: 'TOP',   key: 'V' },
];
const FPS_CAM_HEIGHT     = 0.65;        // camera at hamster head height in first-person
const TOPDOWN_CAM_HEIGHT = 38;          // straight-up height in top-down view

// ============================================================
//   HUD (style + DOM) — design language reused from Hammas gun.js
// ============================================================
function injectHUD() {
  const style = document.createElement('style');
  style.textContent = `
    #gunOverlay, #gunHud, .gun-bubble, .gun-muzzle, .gun-hit-ring, .gun-blood-vignette {
      --gun-bg:        rgba(12, 16, 24, 0.62);
      --gun-bg-strong: rgba(12, 16, 24, 0.86);
      --gun-border:    rgba(255, 255, 255, 0.10);
      --gun-fg:        #f5f7fb;
      --gun-fg-dim:    rgba(245, 247, 251, 0.62);
      --gun-accent:    #ff3a4f;
      --gun-warn:      #fbbf24;
      --gun-radius:    14px;
      --gun-shadow:    0 10px 32px rgba(0, 0, 0, 0.45);
      --gun-mono:      ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
      --gun-sans:      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
    }
    #gunOverlay {
      position: fixed; inset: 0; z-index: 99998;
      pointer-events: none; opacity: 0;
      transition: opacity .35s ease;
    }
    #gunOverlay.on { opacity: 1; }
    /* Soft red inner vignette only — corner brackets removed per design pass */
    #gunOverlay::before {
      content: ""; position: absolute; inset: 0;
      box-shadow: inset 0 0 80px rgba(255, 58, 79, 0.10);
      pointer-events: none;
    }

    #gunCrosshair {
      position: fixed; width: 60px; height: 60px;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      will-change: left, top;
      pointer-events: none; z-index: 99999;
    }
    #gunCrosshair svg {
      width: 100%; height: 100%; overflow: visible;
      filter: drop-shadow(0 0 6px rgba(255, 58, 79, 0.55));
      transition: transform .25s cubic-bezier(.2,.7,.3,1);
    }
    #gunCrosshair .ring { fill: none; stroke: rgba(255, 255, 255, 0.85); stroke-width: 1.4; }
    #gunCrosshair .tick { stroke: var(--gun-accent); stroke-width: 2; stroke-linecap: round; }
    #gunCrosshair .dot  { fill: var(--gun-accent); }
    @keyframes gun-crosshair-pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
    #gunOverlay.on ~ #gunCrosshair .ring { animation: gun-crosshair-pulse 2.4s ease-in-out infinite; }
    #gunCrosshair.fire svg { animation: gun-crosshair-recoil .14s ease-out; }
    @keyframes gun-crosshair-recoil {
      0% { transform: scale(1); }
      45% { transform: scale(1.22); }
      100% { transform: scale(1); }
    }

    #gunHud {
      position: fixed; bottom: 14px; left: 14px;
      display: flex; gap: 14px; padding: 10px 16px;
      background: var(--gun-bg);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      border: 1px solid var(--gun-border);
      border-radius: var(--gun-radius);
      box-shadow: var(--gun-shadow);
      z-index: 99999; pointer-events: none;
      align-items: center;
      font-family: var(--gun-mono);
    }
    #gunHud .stat { display: flex; flex-direction: column; gap: 3px; min-width: 56px; }
    #gunHud .stat-label { font: 700 9px/1 var(--gun-mono); letter-spacing: 0.16em; color: var(--gun-fg-dim); }
    #gunHud .stat-value { font: 700 22px/1 var(--gun-mono); font-variant-numeric: tabular-nums; color: var(--gun-fg);
                          text-shadow: 0 0 6px rgba(56, 189, 248, 0.4);
                          transform-origin: left center;
                          transition: transform .12s ease, color .2s ease; }
    #gunHud .stat.ham .stat-value { color: var(--gun-warn); text-shadow: 0 0 8px rgba(251, 191, 36, 0.5); }
    #gunHud .stat-value.bump { animation: gun-stat-bump .35s cubic-bezier(.34,1.56,.64,1); }
    @keyframes gun-stat-bump {
      0% { transform: scale(1); }
      40% { transform: scale(1.22); color: var(--gun-accent); }
      100% { transform: scale(1); }
    }
    #gunHud .divider {
      width: 1px; align-self: stretch;
      background: linear-gradient(to bottom, transparent, rgba(255,255,255,.20) 30%, rgba(255,255,255,.20) 70%, transparent);
    }

    .gun-hit-ring {
      position: fixed; transform: translate(-50%, -50%);
      width: 8px; height: 8px;
      border: 2px solid rgba(255, 220, 100, 0.95);
      border-radius: 50%;
      pointer-events: none; z-index: 99996;
      animation: gun-hit-ring .38s ease-out forwards;
      box-shadow: 0 0 14px rgba(255, 200, 80, 0.6);
    }
    @keyframes gun-hit-ring {
      0% { width: 8px; height: 8px; opacity: 1; border-width: 3px; }
      100% { width: 64px; height: 64px; opacity: 0; border-width: 1px; }
    }

    .gun-blood-vignette {
      position: fixed; inset: 0;
      pointer-events: none; z-index: 99996;
      background: radial-gradient(ellipse at center,
        transparent 35%,
        rgba(180, 0, 8, 0.10) 65%,
        rgba(140, 0, 6, 0.32) 90%,
        rgba(110, 0, 4, 0.42) 100%);
      animation: gun-blood-vignette .55s ease-out forwards;
    }
    @keyframes gun-blood-vignette {
      0% { opacity: 0; }
      15% { opacity: 1; }
      100% { opacity: 0; }
    }

    .gun-bubble {
      position: fixed; transform: translate(-50%, -100%);
      font: 800 20px/1 var(--gun-sans);
      letter-spacing: 0.04em; color: #fff;
      padding: 6px 14px; border-radius: 12px;
      background: linear-gradient(180deg, rgba(255, 58, 79, 0.96), rgba(220, 38, 38, 0.96));
      box-shadow: 0 6px 20px rgba(255, 58, 79, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.30);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      pointer-events: none; z-index: 99999;
      white-space: nowrap;
      animation: gun-bubble-fly .9s cubic-bezier(.2, .7, .2, 1) forwards;
    }
    .gun-bubble.warn {
      background: linear-gradient(180deg, rgba(251, 191, 36, 0.97), rgba(217, 119, 6, 0.97));
      box-shadow: 0 6px 20px rgba(251, 191, 36, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.30);
      color: #1a1208;
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
    }
    @keyframes gun-bubble-fly {
      0%   { opacity: 0; transform: translate(-50%, -60%)  scale(.45) rotate(-3deg); }
      18%  { opacity: 1; transform: translate(-50%, -110%) scale(1.18) rotate(2deg);  }
      40%  { opacity: 1; transform: translate(-50%, -135%) scale(1)    rotate(-1deg); }
      100% { opacity: 0; transform: translate(-50%, -200%) scale(.92)  rotate(0deg);  }
    }

    .gun-muzzle {
      position: fixed; inset: 0; pointer-events: none; z-index: 99997;
      background: radial-gradient(circle at center,
        rgba(255, 220, 140, 0.55) 0%,
        rgba(255, 140, 80, 0.18) 30%,
        transparent 55%);
      mix-blend-mode: screen;
      animation: gun-muzzle .12s ease-out;
    }
    @keyframes gun-muzzle { from { opacity: 1; } to { opacity: 0; } }

    /* Accuracy stat tints cyan to differentiate from SHOTS (white) and BONKED (amber) */
    #gunHud .stat.acc .stat-value {
      color: #38bdf8; text-shadow: 0 0 8px rgba(56, 189, 248, 0.45);
    }
    /* Bites stat tints red so player notices when it ticks up */
    #gunHud .stat.bites .stat-value {
      color: #ff5050; text-shadow: 0 0 8px rgba(255, 80, 80, 0.50);
    }

    /* ←  BACK pill (top-left) — glassmorphism, only visible when paused */
    #backPill {
      position: fixed; top: 14px; left: 14px;
      display: none; align-items: center; gap: 8px;
      padding: 8px 14px;
      background: var(--gun-bg);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      border: 1px solid var(--gun-border);
      border-radius: 999px;
      box-shadow: var(--gun-shadow);
      color: var(--gun-fg);
      font: 700 12px/1 var(--gun-mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      cursor: pointer;
      user-select: none;
      pointer-events: auto;
      z-index: 99999;
      transition: background .2s ease, border-color .2s ease, transform .12s ease;
    }
    #backPill.show { display: inline-flex; }
    #backPill:hover { background: var(--gun-bg-strong); border-color: rgba(255,255,255,0.22); }
    #backPill:active { transform: scale(0.96); }
    #backPill .arrow { font-size: 14px; line-height: 1; }

    /* Pause hint chip near center top */
    #pauseHint {
      position: fixed; top: 14px; left: 50%;
      transform: translateX(-50%);
      padding: 7px 12px;
      background: rgba(12,16,24,0.78);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 999px;
      color: rgba(245,247,251,0.78);
      font: 600 11px/1 var(--gun-mono);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      pointer-events: none;
      z-index: 99999;
      display: none;
      box-shadow: 0 6px 22px rgba(0,0,0,0.4);
    }
    #pauseHint.show { display: block; }
    #pauseHint .kbd {
      display: inline-block; padding: 2px 6px;
      font: 700 10px/1 var(--gun-mono);
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 4px;
      letter-spacing: 0;
      margin: 0 4px;
    }

    /* Weapon pill (top-right) — shows current weapon + key, color tints to weapon */
    #weaponPill {
      position: fixed; top: 14px; right: 14px;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 14px 7px 7px;
      background: var(--gun-bg);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      border: 1px solid var(--gun-border);
      border-radius: 999px;
      box-shadow: var(--gun-shadow);
      color: var(--gun-fg);
      font: 700 12px/1 var(--gun-mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      pointer-events: none;
      z-index: 99999;
      transition: border-color .2s ease, background .2s ease;
    }
    #weaponPill .weapon-key {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      border-radius: 50%;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.18);
      font: 800 11px/1 var(--gun-mono);
      letter-spacing: 0;
    }
    #weaponPill .weapon-name {
      font-weight: 700;
      color: var(--weapon-color, #ffd84a);
      text-shadow: 0 0 10px var(--weapon-glow, rgba(255, 216, 74, 0.55));
    }

    /* Camera mode pill (top-right under weapon pill) */
    #cameraPill {
      position: fixed; top: 56px; right: 14px;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px 6px 6px;
      background: var(--gun-bg);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      border: 1px solid var(--gun-border);
      border-radius: 999px;
      box-shadow: var(--gun-shadow);
      color: var(--gun-fg);
      font: 700 11px/1 var(--gun-mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      pointer-events: none;
      z-index: 99999;
    }
    #cameraPill .camera-key {
      display: inline-flex; align-items: center; justify-content: center;
      width: 19px; height: 19px;
      border-radius: 50%;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.18);
      font: 800 10px/1 var(--gun-mono);
      letter-spacing: 0;
    }
    #cameraPill .camera-mode {
      color: var(--gun-fg-dim);
      font-weight: 700;
    }

    /* Paused state — hide all in-game HUD so splash reads cleanly */
    body.paused #gunHud,
    body.paused #gunCrosshair,
    body.paused #gunOverlay,
    body.paused #weaponPill,
    body.paused #cameraPill { display: none !important; }

    @media (prefers-reduced-motion: reduce) {
      #gunOverlay, .gun-bubble, .gun-muzzle, .gun-hit-ring, .gun-blood-vignette,
      #gunHud .stat-value.bump, #gunCrosshair.fire svg {
        animation: none !important;
        transition: opacity .15s linear !important;
      }
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'gunOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);

  const cross = document.createElement('div');
  cross.id = 'gunCrosshair';
  cross.innerHTML = `
    <svg viewBox="0 0 60 60" aria-hidden="true">
      <circle class="ring" cx="30" cy="30" r="20"></circle>
      <line class="tick" x1="30" y1="3"  x2="30" y2="11"></line>
      <line class="tick" x1="30" y1="49" x2="30" y2="57"></line>
      <line class="tick" x1="3"  y1="30" x2="11" y2="30"></line>
      <line class="tick" x1="49" y1="30" x2="57" y2="30"></line>
      <circle class="dot" cx="30" cy="30" r="2.2"></circle>
    </svg>
  `;
  document.body.appendChild(cross);

  const hud = document.createElement('div');
  hud.id = 'gunHud';
  hud.innerHTML = `
    <div class="stat shots">
      <span class="stat-label">SHOTS</span>
      <span class="stat-value" id="hitCount">0</span>
    </div>
    <div class="divider"></div>
    <div class="stat ham">
      <span class="stat-label">BONKED</span>
      <span class="stat-value" id="hamCount">0</span>
    </div>
    <div class="divider"></div>
    <div class="stat acc">
      <span class="stat-label">ACC</span>
      <span class="stat-value" id="accCount">0%</span>
    </div>
    <div class="divider"></div>
    <div class="stat bites">
      <span class="stat-label">BITES</span>
      <span class="stat-value" id="biteCount">0</span>
    </div>
  `;
  document.body.appendChild(hud);

  // Back-to-splash pill (top-left), shown only when paused
  const back = document.createElement('div');
  back.id = 'backPill';
  back.setAttribute('role', 'button');
  back.setAttribute('tabindex', '0');
  back.setAttribute('aria-label', 'Back to title');
  back.innerHTML = `<span class="arrow">←</span> <span>BACK</span>`;
  document.body.appendChild(back);

  // Top-center "PAUSED — press Esc to resume" hint
  const hint = document.createElement('div');
  hint.id = 'pauseHint';
  hint.innerHTML = `Paused <span class="kbd">Esc</span> resume`;
  document.body.appendChild(hint);

  // Weapon pill (top-right) — content updated by Game._setWeapon
  const wp = document.createElement('div');
  wp.id = 'weaponPill';
  wp.innerHTML = `<span class="weapon-key">1</span><span class="weapon-name">PISTOL</span>`;
  document.body.appendChild(wp);

  // Camera mode pill (under weapon pill) — content updated by Game._setCameraMode
  const cp = document.createElement('div');
  cp.id = 'cameraPill';
  cp.innerHTML = `<span class="camera-key">V</span><span class="camera-mode">CHASE</span>`;
  document.body.appendChild(cp);
}

function setArmed(on) {
  document.getElementById('gunOverlay')?.classList.toggle('on', on);
  document.body.classList.toggle('armed', on);
}

function bumpStat(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function popBubble(screenX, screenY, text, variant) {
  const el = document.createElement('div');
  el.className = 'gun-bubble' + (variant ? ' ' + variant : '');
  el.textContent = text;
  el.style.left = screenX + 'px';
  el.style.top  = screenY + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 920);
}

function popHitRing(screenX, screenY) {
  const ring = document.createElement('div');
  ring.className = 'gun-hit-ring';
  ring.style.left = screenX + 'px';
  ring.style.top  = screenY + 'px';
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 400);
}

function flashMuzzle() {
  const el = document.createElement('div');
  el.className = 'gun-muzzle';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 90);
}

function flashVignette() {
  const v = document.createElement('div');
  v.className = 'gun-blood-vignette';
  document.body.appendChild(v);
  setTimeout(() => v.remove(), 600);
}

const CRIES = [
  ['OUCH!',  ''], ['EEK!',   ''], ['!?',     ''],
  ['@#!*',   ''], ['*BONK*', 'warn'], ['OOF', 'warn'], ['SQUEAK!', ''],
];

// ============================================================
//   Web Audio gunshot — copied verbatim from docs/js/gun.js
// ============================================================
let audioCtx = null;
function bang() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    const buf = ctx.createBuffer(1, (ctx.sampleRate * 0.12) | 0, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = Math.exp(-i / (data.length * 0.18));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1600; lp.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    src.connect(lp).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.12);
  } catch (e) {}
}

// ============================================================
//   Voxel mesh helpers
// ============================================================

// Build a single merged BufferGeometry from an array of voxel boxes,
// each with size, local position, and per-box color. Vertex colors only;
// indices are dropped via toNonIndexed() to keep the merge straightforward.
function mergeBoxes(boxes) {
  const parts = boxes.map(b => {
    const g = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]).toNonIndexed();
    g.translate(b.pos[0], b.pos[1], b.pos[2]);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[3 * i]     = b.color[0];
      colors[3 * i + 1] = b.color[1];
      colors[3 * i + 2] = b.color[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });

  const totalVerts = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(totalVerts * 3);
  const nrm = new Float32Array(totalVerts * 3);
  const col = new Float32Array(totalVerts * 3);
  let off = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nrm.set(g.attributes.normal.array,   off * 3);
    col.set(g.attributes.color.array,    off * 3);
    off += n;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3));
  merged.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  merged.computeBoundingSphere();
  return merged;
}

// Hamster voxel layout — split into two parts so the swarm can tint per instance:
//  · coat: body / head / ears / paws  → white vertex color, multiplied by instanceColor
//  · fixed: belly / snout / nose / eyes / tail → baked colors (always the same)
// Local space: forward = +Z, up = +Y, right = +X. Origin at hip.
function hamsterCoatBoxes(coat) {
  const c  = coat;
  const lt = [Math.min(1, c[0] * 1.18), Math.min(1, c[1] * 1.18), Math.min(1, c[2] * 1.18)];
  return [
    { size: [0.8, 0.55, 1.05], pos: [0, 0.40, 0.05],   color: c  }, // body
    { size: [0.68, 0.55, 0.55], pos: [0, 0.50, 0.72],  color: lt }, // head
    { size: [0.18, 0.22, 0.10], pos: [ 0.22, 0.86, 0.62], color: c }, // ears L
    { size: [0.18, 0.22, 0.10], pos: [-0.22, 0.86, 0.62], color: c }, // ears R
    { size: [0.18, 0.14, 0.20], pos: [ 0.26, 0.10, 0.45], color: lt }, // front paw L
    { size: [0.18, 0.14, 0.20], pos: [-0.26, 0.10, 0.45], color: lt }, // front paw R
    { size: [0.20, 0.14, 0.22], pos: [ 0.26, 0.10, -0.30], color: lt }, // back paw L
    { size: [0.20, 0.14, 0.22], pos: [-0.26, 0.10, -0.30], color: lt }, // back paw R
  ];
}

function hamsterFixedBoxes() {
  const wht = [0.98, 0.94, 0.86];
  const eye = [0.05, 0.04, 0.04];
  const drk = [0.18, 0.10, 0.06];
  return [
    { size: [0.62, 0.18, 0.88], pos: [0, 0.18, 0.05],  color: wht }, // belly stripe
    { size: [0.30, 0.22, 0.18], pos: [0, 0.40, 1.02],  color: wht }, // snout
    { size: [0.10, 0.08, 0.05], pos: [0, 0.46, 1.13],  color: drk }, // nose
    { size: [0.08, 0.10, 0.06], pos: [ 0.18, 0.58, 0.95], color: eye }, // eye L
    { size: [0.08, 0.10, 0.06], pos: [-0.18, 0.58, 0.95], color: eye }, // eye R
    { size: [0.10, 0.10, 0.16], pos: [0, 0.34, -0.55], color: wht }, // tail
  ];
}

function hamsterBoxes(coat) {
  return hamsterCoatBoxes(coat).concat(hamsterFixedBoxes());
}

function buildHamsterGeometry(color) {
  return mergeBoxes(hamsterBoxes([color.r, color.g, color.b]));
}

// ============================================================
//   World
// ============================================================
function buildWorld(scene) {
  // Warm horizon → distant objects fade into the cream sky band, gradient dome handles the rest
  const FOG_COLOR = 0xf6e6c2;
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 75, 165);

  const sun = new THREE.DirectionalLight(0xffe6b3, 1.10);
  sun.position.set(55, 110, 35);
  scene.add(sun);
  // Hemisphere: warm sky → cool grass
  scene.add(new THREE.HemisphereLight(0xfff0d8, 0x3a7a2c, 0.55));
  scene.add(new THREE.AmbientLight(0xffffff, 0.16));

  // Ground — 64x64 quads, per-quad random green tint for pixel-art tile feel
  // toNonIndexed() so each quad has its own 6 verts; we write 6 identical colors per quad
  const groundGeom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 64, 64).toNonIndexed();
  groundGeom.rotateX(-Math.PI / 2);
  {
    const verts = groundGeom.attributes.position.count;
    const cols  = new Float32Array(verts * 3);
    const rngG  = mulberry32(0xC1A55);
    for (let q = 0; q < verts / 6; q++) {
      const c = GROUND_GREENS[Math.floor(rngG() * GROUND_GREENS.length)];
      for (let v = 0; v < 6; v++) {
        const idx = q * 6 + v;
        cols[3 * idx]     = c[0];
        cols[3 * idx + 1] = c[1];
        cols[3 * idx + 2] = c[2];
      }
    }
    groundGeom.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const ground = new THREE.Mesh(
    groundGeom,
    new THREE.MeshLambertMaterial({ vertexColors: true })
  );
  ground.name = 'ground';
  scene.add(ground);

  // Decorative props as instanced meshes (Poisson-ish scatter via simple jittered grid)
  const rng = mulberry32(0xC0FFEE);
  function scatter(n, scale) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push([(rng() - 0.5) * (WORLD_SIZE - 6) * scale,
                (rng() - 0.5) * (WORLD_SIZE - 6) * scale]);
    }
    return out;
  }

  // Grass tufts: small green spike (single box), 2000 instances
  {
    const g = new THREE.BoxGeometry(0.18, 0.55, 0.18);
    g.translate(0, 0.275, 0);
    const m = new THREE.MeshLambertMaterial({ color: 0x4ea83a });
    const N = 2000;
    const inst = new THREE.InstancedMesh(g, m, N);
    inst.frustumCulled = false;
    const mat = new THREE.Matrix4();
    const pts = scatter(N, 1);
    for (let i = 0; i < N; i++) {
      const sx = 0.7 + rng() * 0.7;
      const sy = 0.6 + rng() * 1.0;
      mat.makeScale(sx, sy, sx);
      mat.setPosition(pts[i][0], 0, pts[i][1]);
      inst.setMatrixAt(i, mat);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // Trees: trunk + canopy as merged geometry, 30 instances
  {
    const treeGeom = mergeBoxes([
      { size: [0.5, 1.6, 0.5], pos: [0, 0.8, 0], color: [0.36, 0.22, 0.10] },
      { size: [1.7, 1.4, 1.7], pos: [0, 2.2, 0], color: [0.20, 0.55, 0.22] },
      { size: [1.3, 1.0, 1.3], pos: [0, 3.2, 0], color: [0.26, 0.62, 0.28] },
    ]);
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    const N = 30;
    const inst = new THREE.InstancedMesh(treeGeom, m, N);
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const x = (rng() - 0.5) * (WORLD_SIZE - 8);
      const z = (rng() - 0.5) * (WORLD_SIZE - 8);
      const sc = 0.85 + rng() * 0.6;
      p.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      s.set(sc, sc, sc);
      mat.compose(p, q, s);
      inst.setMatrixAt(i, mat);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // Rocks
  {
    const g = new THREE.BoxGeometry(1, 0.6, 1);
    g.translate(0, 0.3, 0);
    const m = new THREE.MeshLambertMaterial({ color: 0x9aa1ad });
    const N = 50;
    const inst = new THREE.InstancedMesh(g, m, N);
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const x = (rng() - 0.5) * (WORLD_SIZE - 4);
      const z = (rng() - 0.5) * (WORLD_SIZE - 4);
      const sc = 0.5 + rng() * 0.9;
      p.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      s.set(sc, sc * (0.6 + rng() * 0.8), sc);
      mat.compose(p, q, s);
      inst.setMatrixAt(i, mat);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // Flowers — pink and yellow tiny cubes
  for (const [color, count] of [[0xff7eb3, 120], [0xffe066, 120]]) {
    const g = new THREE.BoxGeometry(0.16, 0.08, 0.16);
    g.translate(0, 0.55, 0);
    const stem = new THREE.BoxGeometry(0.04, 0.5, 0.04);
    stem.translate(0, 0.25, 0);
    const merged = mergeBoxes([
      { size: [0.04, 0.5, 0.04], pos: [0, 0.25, 0], color: [0.30, 0.55, 0.20] },
      { size: [0.16, 0.08, 0.16], pos: [0, 0.55, 0], color: [
          ((color >> 16) & 0xff) / 255,
          ((color >> 8) & 0xff) / 255,
          (color & 0xff) / 255 ] },
    ]);
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    const inst = new THREE.InstancedMesh(merged, m, count);
    const mat = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const x = (rng() - 0.5) * (WORLD_SIZE - 4);
      const z = (rng() - 0.5) * (WORLD_SIZE - 4);
      mat.makeTranslation(x, 0, z);
      inst.setMatrixAt(i, mat);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // World boundary walls (fence-ish) — short brown boxes around the perimeter
  {
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
    const segLen = 8;
    const fenceGeom = new THREE.BoxGeometry(segLen, 1.2, 0.3);
    fenceGeom.translate(0, 0.6, 0);
    const total = Math.floor(WORLD_SIZE / segLen);
    const inst = new THREE.InstancedMesh(fenceGeom, fenceMat, total * 4);
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < total; i++) {
      const t = -HALF_WORLD + segLen / 2 + i * segLen;
      // top
      p.set(t, 0,  HALF_WORLD); q.set(0, 0, 0, 1);
      mat.compose(p, q, s); inst.setMatrixAt(n++, mat);
      // bottom
      p.set(t, 0, -HALF_WORLD);
      mat.compose(p, q, s); inst.setMatrixAt(n++, mat);
      // left
      p.set(-HALF_WORLD, 0, t); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      mat.compose(p, q, s); inst.setMatrixAt(n++, mat);
      // right
      p.set( HALF_WORLD, 0, t);
      mat.compose(p, q, s); inst.setMatrixAt(n++, mat);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // ---------- Sky dome (vertex-colored gradient, top blue → horizon cream) ----------
  {
    const skyGeom = new THREE.SphereGeometry(280, 32, 16);
    const verts = skyGeom.attributes.position.count;
    const cols = new Float32Array(verts * 3);
    const top = new THREE.Color(0x6db8e8);   // sky blue
    const horz = new THREE.Color(0xfff0d4);  // warm cream horizon
    const tmp = new THREE.Color();
    for (let i = 0; i < verts; i++) {
      const y = skyGeom.attributes.position.getY(i);
      const t = Math.max(0, Math.min(1, (y + 280) / 560));
      const u = t * t * (3 - 2 * t);                       // smoothstep
      const m = Math.max(0, (u - 0.42) / 0.45);            // hold horizon longer, blue swing higher
      const mm = Math.max(0, Math.min(1, m * m * (3 - 2 * m)));
      tmp.copy(horz).lerp(top, mm);
      cols[3 * i]     = tmp.r;
      cols[3 * i + 1] = tmp.g;
      cols[3 * i + 2] = tmp.b;
    }
    skyGeom.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const dome = new THREE.Mesh(skyGeom, skyMat);
    dome.renderOrder = -1;
    scene.add(dome);
  }

  // ---------- Sun (voxel cube, far away, no fog) ----------
  {
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff7c8, fog: false });
    const sunMesh = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), sunMat);
    sunMesh.position.set(55, 75, 35);
    scene.add(sunMesh);
    // Soft halo (slightly larger, additive)
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffe89c, transparent: true, opacity: 0.45, fog: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), haloMat);
    halo.position.copy(sunMesh.position);
    scene.add(halo);
  }

  // ---------- Clouds (a few merged voxel puffs at altitude, no fog) ----------
  {
    const rngC = mulberry32(0xC10D5);
    const clouds = [];
    for (let i = 0; i < 6; i++) {
      const boxes = [];
      const n = 4 + Math.floor(rngC() * 4);
      for (let j = 0; j < n; j++) {
        const dx = (rngC() - 0.5) * 9;
        const dy = (rngC() - 0.5) * 1.4;
        const dz = (rngC() - 0.5) * 9;
        const w = 2.4 + rngC() * 3.2;
        const h = 1.4 + rngC() * 1.0;
        boxes.push({ size: [w, h, w], pos: [dx, dy, dz], color: [0.97, 0.97, 0.99] });
      }
      clouds.push(mergeBoxes(boxes));
    }
    const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
    for (let i = 0; i < 8; i++) {
      const g = clouds[Math.floor(rngC() * clouds.length)];
      const m = new THREE.Mesh(g, cloudMat);
      m.position.set(
        (rngC() - 0.5) * 220,
        38 + rngC() * 14,
        (rngC() - 0.5) * 220,
      );
      m.rotation.y = rngC() * Math.PI * 2;
      const s = 0.85 + rngC() * 0.6;
      m.scale.set(s, s, s);
      scene.add(m);
    }
  }

  // ---------- Dirt patches on the ground (thin tan tiles) ----------
  {
    const rngD = mulberry32(0xD17707);
    const tileGeom = new THREE.BoxGeometry(1, 0.05, 1);
    tileGeom.translate(0, 0.025, 0);
    const tileMat = new THREE.MeshLambertMaterial({ color: 0xc89968 });
    const N = 28;
    const inst = new THREE.InstancedMesh(tileGeom, tileMat, N);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const sx = 1.6 + rngD() * 3.0;
      const sz = 1.6 + rngD() * 3.0;
      const x = (rngD() - 0.5) * (WORLD_SIZE - 6);
      const z = (rngD() - 0.5) * (WORLD_SIZE - 6);
      p.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rngD() * Math.PI * 2);
      s.set(sx, 1, sz);
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // ---------- Bushes (clusters of green cubes) ----------
  {
    const rngB = mulberry32(0xB05E5);
    const bushGeom = mergeBoxes([
      { size: [0.55, 0.55, 0.55], pos: [-0.18, 0.27, -0.10], color: [0.20, 0.46, 0.18] },
      { size: [0.50, 0.50, 0.50], pos: [ 0.20, 0.32,  0.08], color: [0.24, 0.52, 0.22] },
      { size: [0.45, 0.45, 0.45], pos: [ 0.02, 0.40, -0.22], color: [0.18, 0.42, 0.16] },
      { size: [0.40, 0.40, 0.40], pos: [-0.05, 0.20,  0.20], color: [0.22, 0.50, 0.20] },
    ]);
    const bushMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const N = 36;
    const inst = new THREE.InstancedMesh(bushGeom, bushMat, N);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      p.set(
        (rngB() - 0.5) * (WORLD_SIZE - 6),
        0,
        (rngB() - 0.5) * (WORLD_SIZE - 6),
      );
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rngB() * Math.PI * 2);
      const sc = 0.85 + rngB() * 0.7;
      s.set(sc, sc * (0.85 + rngB() * 0.4), sc);
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // ---------- Mushrooms (red cap + cream stem) ----------
  {
    const rngM = mulberry32(0x70710);
    const mushGeom = mergeBoxes([
      { size: [0.10, 0.20, 0.10], pos: [0, 0.10, 0], color: [0.94, 0.90, 0.78] }, // stem
      { size: [0.34, 0.10, 0.34], pos: [0, 0.25, 0], color: [0.84, 0.18, 0.18] }, // red cap
      { size: [0.06, 0.04, 0.06], pos: [-0.10, 0.30, -0.06], color: [1.0, 1.0, 1.0] }, // white spot
      { size: [0.06, 0.04, 0.06], pos: [ 0.10, 0.30,  0.08], color: [1.0, 1.0, 1.0] },
    ]);
    const mushMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const N = 30;
    const inst = new THREE.InstancedMesh(mushGeom, mushMat, N);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      p.set(
        (rngM() - 0.5) * (WORLD_SIZE - 8),
        0,
        (rngM() - 0.5) * (WORLD_SIZE - 8),
      );
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rngM() * Math.PI * 2);
      const sc = 0.8 + rngM() * 0.7;
      s.set(sc, sc, sc);
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  // ---------- Tall grass tufts (taller stems for variety) ----------
  {
    const rngT = mulberry32(0x7A115);
    const tallGeom = new THREE.BoxGeometry(0.10, 1.10, 0.10);
    tallGeom.translate(0, 0.55, 0);
    const tallMat = new THREE.MeshLambertMaterial({ color: 0x5fa838 });
    const N = 240;
    const inst = new THREE.InstancedMesh(tallGeom, tallMat, N);
    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      p.set(
        (rngT() - 0.5) * (WORLD_SIZE - 4),
        0,
        (rngT() - 0.5) * (WORLD_SIZE - 4),
      );
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rngT() * Math.PI * 2);
      const sx = 0.6 + rngT() * 0.7;
      const sy = 0.7 + rngT() * 0.9;
      s.set(sx, sy, sx);
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  return ground;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
//   Hamster swarm
// ============================================================
class Swarm {
  constructor(scene, count) {
    this.count = count;
    // Coat geometry built with white vertex color so instanceColor multiplies cleanly
    this.coatGeom  = mergeBoxes(hamsterCoatBoxes([1, 1, 1]));
    this.fixedGeom = mergeBoxes(hamsterFixedBoxes());
    this.coatMaterial  = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.fixedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.coatMesh  = new THREE.InstancedMesh(this.coatGeom,  this.coatMaterial,  count);
    this.fixedMesh = new THREE.InstancedMesh(this.fixedGeom, this.fixedMaterial, count);
    this.coatMesh.frustumCulled  = false;
    this.fixedMesh.frustumCulled = false;
    this.coatMesh.name  = 'swarmCoat';
    this.fixedMesh.name = 'swarmFixed';
    // alias used by raycaster — coat covers ~all aimable surface area
    this.mesh = this.coatMesh;

    // Per-instance state
    this.pos           = new Float32Array(count * 3);
    this.heading       = new Float32Array(count); // current yaw, radians (XZ angle, 0 = +X)
    this.headingTarget = new Float32Array(count); // desired yaw — heading lerps toward this for smooth turns
    this.state         = new Uint8Array(count);   // 0 idle · 1 wander · 2 flee · 3 dead · 4 chase · 5 attack
    this.fleeUntil     = new Float32Array(count);
    this.deadAt        = new Float32Array(count);
    this.spawnedAt     = new Float32Array(count); // ms timestamp for fade-in
    this.phase         = new Float32Array(count);
    this.changeAt      = new Float32Array(count);
    this.alive         = new Uint8Array(count);
    this.speedMul      = new Float32Array(count);    // 0.85..1.20 base-speed mul
    this.hopAt         = new Float32Array(count);
    this.hopFrom       = new Float32Array(count);
    this.personality   = new Uint8Array(count);      // 0 wanderer · 1 chaser · 2 ambusher · 3 flanker
    this.attackStartedAt = new Float32Array(count);
    this.attackCooldown  = new Float32Array(count);
    this.rageUntil       = new Float32Array(count);  // ms timestamp — aggressive types are enraged after a shot

    // Global swarm mode — alternates SCATTER / CHASE (Pac-Man style)
    this.mode = 'SCATTER';
    this.modeChangeAt = performance.now() + SWARM_MODE_SCATTER_MS;

    // Bite callback — Game wires this up to bookkeeping + HUD
    this.onBite = null;

    const tintColor = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.spawn(i, performance.now());
      const tint = NPC_TINTS[Math.floor(Math.random() * NPC_TINTS.length)];
      this.coatMesh.setColorAt(i, tintColor.copy(tint));
    }
    this.coatMesh.instanceMatrix.needsUpdate  = true;
    this.fixedMesh.instanceMatrix.needsUpdate = true;
    if (this.coatMesh.instanceColor) this.coatMesh.instanceColor.needsUpdate = true;
    scene.add(this.coatMesh);
    scene.add(this.fixedMesh);

    this._tmpMat = new THREE.Matrix4();
    this._tmpQ   = new THREE.Quaternion();
    this._tmpV   = new THREE.Vector3();
    this._tmpS   = new THREE.Vector3(1, 1, 1);
    this._hidden = (() => {
      const m = new THREE.Matrix4();
      m.compose(new THREE.Vector3(0, -1000, 0), new THREE.Quaternion(),
                new THREE.Vector3(0.001, 0.001, 0.001));
      return m;
    })();
  }

  // Apply current matrix to both coat & fixed meshes
  _writeMatrix(i, mat) {
    this.coatMesh.setMatrixAt(i, mat);
    this.fixedMesh.setMatrixAt(i, mat);
  }

  spawn(i, now, nearPlayer) {
    const margin = 6;
    const span = WORLD_SIZE - margin * 2;
    let x, z, tries = 0;
    do {
      x = -HALF_WORLD + margin + Math.random() * span;
      z = -HALF_WORLD + margin + Math.random() * span;
      tries++;
    } while (nearPlayer && tries < 10 &&
             Math.hypot(x - nearPlayer.x, z - nearPlayer.z) < 14);
    this.pos[3 * i]      = x;
    this.pos[3 * i + 1]  = 0;
    this.pos[3 * i + 2]  = z;
    this.heading[i]      = Math.random() * Math.PI * 2;
    this.headingTarget[i]= this.heading[i];
    this.state[i]        = 1;
    this.fleeUntil[i]    = 0;
    this.deadAt[i]       = 0;
    this.spawnedAt[i]    = now;
    this.phase[i]        = Math.random() * Math.PI * 2;
    this.changeAt[i]     = now + 800 + Math.random() * 2400;
    this.alive[i]        = 1;
    this.speedMul[i]     = 0.85 + Math.random() * 0.35;
    this.hopAt[i]        = now + 600 + Math.random() * 1800;
    this.hopFrom[i]      = 0;
    this.attackStartedAt[i] = 0;
    this.attackCooldown[i]  = 0;
    this.rageUntil[i]       = 0;

    // Personality roll: 70% wanderer · 10% each chaser/ambusher/flanker
    const r = Math.random();
    if (r < NPC_AGGRESSIVE_FRAC) {
      const aggRoll = Math.floor(Math.random() * 3) + 1; // 1..3
      this.personality[i] = aggRoll;
      // Aggressive types stat-boost a bit so they actually feel threatening
      this.speedMul[i] = 1.05 + Math.random() * 0.20;
    } else {
      this.personality[i] = PERSONALITY_WANDERER;
    }

    // Tint: aggressive personality forces a signature color, wanderer is random NPC_TINT
    if (this.coatMesh) {
      const aggTint = AGGRESSIVE_TINTS[this.personality[i]];
      const tint = aggTint || NPC_TINTS[Math.floor(Math.random() * NPC_TINTS.length)];
      this.coatMesh.setColorAt(i, tint);
      if (this.coatMesh.instanceColor) this.coatMesh.instanceColor.needsUpdate = true;
    }
  }

  alertNear(point, now) {
    const px = point.x, pz = point.z;
    const passiveR2  = FLEE_RADIUS * FLEE_RADIUS;
    const aggroR2    = ALERT_RADIUS_AGGRESSIVE * ALERT_RADIUS_AGGRESSIVE;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.state[i] === 3) continue;
      const dx = this.pos[3 * i] - px;
      const dz = this.pos[3 * i + 2] - pz;
      const d2 = dx * dx + dz * dz;
      const personality = this.personality[i];
      const isAggressive = (personality !== PERSONALITY_WANDERER);

      if (isAggressive) {
        // Aggressive types: gunshots = blood in the water. Big detection radius,
        // switch straight to CHASE, and enrage for a few seconds (faster pursuit).
        if (d2 <= aggroR2 && this.state[i] !== 5) {
          this.state[i] = 4;
          this.headingTarget[i] = Math.atan2(-dz, -dx); // toward the shot/player
          this.rageUntil[i] = now + AGGRO_RAGE_MS;
          if (this.hopFrom[i] === 0) this.hopAt[i] = now;
        }
      } else {
        // Wanderers: classic flee away from the shot
        if (d2 <= passiveR2) {
          this.state[i] = 2;
          this.fleeUntil[i] = now + FLEE_DURATION_MS;
          this.headingTarget[i] = Math.atan2(dz, dx); // away
          if (this.hopFrom[i] === 0) this.hopAt[i] = now;
        }
      }
    }
  }

  kill(i, now) {
    if (!this.alive[i] || this.state[i] === 3) return;
    this.state[i] = 3;
    this.deadAt[i] = now;
  }

  // Returns nothing; caller drives respawn timing.
  respawnOne(now, nearPlayer) {
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        this.spawn(i, now, nearPlayer);
        return true;
      }
    }
    return false;
  }

  tick(dt, now, player, playerVel) {
    const px = player.position.x;
    const pz = player.position.z;
    const pvx = playerVel ? playerVel.x : 0;
    const pvz = playerVel ? playerVel.z : 0;
    const upY = new THREE.Vector3(0, 1, 0);

    // -------- Global swarm mode timer (Pac-Man-style scatter ↔ chase) --------
    if (now > this.modeChangeAt) {
      if (this.mode === 'SCATTER') {
        this.mode = 'CHASE';
        this.modeChangeAt = now + SWARM_MODE_CHASE_MS;
      } else {
        this.mode = 'SCATTER';
        this.modeChangeAt = now + SWARM_MODE_SCATTER_MS;
      }
    }
    const swarmChasing = (this.mode === 'CHASE');

    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        this._writeMatrix(i, this._hidden);
        continue;
      }

      const st = this.state[i];

      if (st === 3) {
        // dying: shrink + slump (90° rotation around Z so it falls sideways)
        const t = (now - this.deadAt[i]) / DEATH_DURATION_MS;
        if (t >= 1) {
          this.alive[i] = 0;
          this._writeMatrix(i, this._hidden);
          continue;
        }
        const s = 1 - t * t;
        const deadYaw = -this.heading[i] + Math.PI / 2;
        this._tmpQ.setFromEuler(new THREE.Euler(0, deadYaw, Math.PI / 2));
        this._tmpS.set(s, s, s);
        this._tmpV.set(this.pos[3 * i],
                       Math.max(0.05, this.pos[3 * i + 1]),
                       this.pos[3 * i + 2]);
        this._tmpMat.compose(this._tmpV, this._tmpQ, this._tmpS);
        this._writeMatrix(i, this._tmpMat);
        continue;
      }

      // -------- State machine --------
      let stCur = st;
      const personality = this.personality[i];
      const isAggressive = (personality !== PERSONALITY_WANDERER);

      // FLEE expires
      if (stCur === 2 && now > this.fleeUntil[i]) {
        this.state[i] = isAggressive && swarmChasing ? 4 : 1;
        stCur = this.state[i];
      }
      // FLEE: aim away from player smoothly
      if (stCur === 2) {
        const dx = this.pos[3 * i] - px;
        const dz = this.pos[3 * i + 2] - pz;
        this.headingTarget[i] = Math.atan2(dz, dx);
      }

      // ATTACK lunge: timed window, lock heading toward player, then back to chase
      if (stCur === 5) {
        const at = now - this.attackStartedAt[i];
        if (at > ATTACK_DURATION_MS) {
          // Did we land within hit range? Fire onBite once per lunge
          const ddx = px - this.pos[3 * i];
          const ddz = pz - this.pos[3 * i + 2];
          if (ddx * ddx + ddz * ddz < ATTACK_HIT_RANGE * ATTACK_HIT_RANGE && this.onBite) {
            this.onBite(this.pos[3 * i], this.pos[3 * i + 2]);
          }
          this.state[i] = isAggressive && swarmChasing ? 4 : 1;
          stCur = this.state[i];
          this.attackCooldown[i] = now + ATTACK_COOLDOWN_MS;
        } else {
          this.headingTarget[i] = Math.atan2(pz - this.pos[3 * i + 2], px - this.pos[3 * i]);
        }
      }

      // CHASE: aggressive types pursue player using personality-based target
      if (stCur === 4) {
        if (!swarmChasing) {
          this.state[i] = 1; stCur = 1;
        } else {
          let tx = px, tz = pz;
          if (personality === PERSONALITY_AMBUSHER) {
            tx = px + pvx * 1.5; tz = pz + pvz * 1.5;
          } else if (personality === PERSONALITY_FLANKER) {
            const len = Math.hypot(pvx, pvz) || 1;
            const perpX = -pvz / len, perpZ = pvx / len;
            // pick a side based on instance index so flankers split L/R consistently
            const side = (i & 1) ? 1 : -1;
            tx = px + perpX * 5 * side; tz = pz + perpZ * 5 * side;
          }
          this.headingTarget[i] = Math.atan2(tz - this.pos[3 * i + 2], tx - this.pos[3 * i]);
          // Within ATTACK_RANGE → commit lunge (respect cooldown)
          const ddx = px - this.pos[3 * i], ddz = pz - this.pos[3 * i + 2];
          if (ddx * ddx + ddz * ddz < ATTACK_RANGE * ATTACK_RANGE && now > this.attackCooldown[i]) {
            this.state[i] = 5; stCur = 5;
            this.attackStartedAt[i] = now;
            this.hopFrom[i] = now; // visual emphasis on lunge
          }
        }
      }

      // WANDER → CHASE transition for aggressive NPCs when global mode flips to CHASE
      if (stCur === 1 && isAggressive && swarmChasing) {
        this.state[i] = 4; stCur = 4;
      }

      // Heading-change / graze logic — only for non-chase/attack states
      if ((stCur === 0 || stCur === 1) && now > this.changeAt[i]) {
        if (stCur === 1) {
          if (Math.random() < 0.22) {
            this.state[i] = 0; stCur = 0;
            this.changeAt[i] = now + 1000 + Math.random() * 1800;
          } else {
            this.headingTarget[i] = this.heading[i] + (Math.random() - 0.5) * 1.6;
            this.changeAt[i] = now + 900 + Math.random() * 2200;
          }
        } else if (stCur === 0) {
          this.state[i] = 1; stCur = 1;
          this.headingTarget[i] = Math.random() * Math.PI * 2;
          this.changeAt[i] = now + 1200 + Math.random() * 2400;
        }
      }

      // -------- Smooth heading lerp --------
      let dh = this.headingTarget[i] - this.heading[i];
      while (dh >  Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      // Tighter turn while chase/attack/flee, gentle while wandering, slow while idle
      const turnRate = (stCur === 5 ? 9.0
                       : stCur === 4 ? 5.5
                       : stCur === 2 ? 7.5
                       : stCur === 1 ? 3.5
                       : 1.0);
      this.heading[i] += dh * Math.min(1, dt * turnRate);

      // -------- Speed by state · per-instance personality · rage boost --------
      let speed = 0;
      if      (stCur === 1) speed = NPC_WANDER_SPEED * this.speedMul[i];
      else if (stCur === 2) speed = NPC_FLEE_SPEED   * this.speedMul[i];
      else if (stCur === 4) speed = NPC_CHASE_SPEED  * this.speedMul[i];
      else if (stCur === 5) speed = NPC_ATTACK_SPEED * this.speedMul[i];
      // Aggressive types stay enraged for a few seconds after hearing a shot
      if ((stCur === 4 || stCur === 5) && now < this.rageUntil[i]) {
        speed *= AGGRO_RAGE_SPEED_MUL;
      }

      // -------- Move + wall reflection --------
      let nx = this.pos[3 * i]     + Math.cos(this.heading[i]) * speed * dt;
      let nz = this.pos[3 * i + 2] + Math.sin(this.heading[i]) * speed * dt;
      if (nx >  HALF_WORLD - 2) { nx =  HALF_WORLD - 2; this.heading[i] = Math.PI - this.heading[i]; this.headingTarget[i] = this.heading[i]; }
      if (nx < -HALF_WORLD + 2) { nx = -HALF_WORLD + 2; this.heading[i] = Math.PI - this.heading[i]; this.headingTarget[i] = this.heading[i]; }
      if (nz >  HALF_WORLD - 2) { nz =  HALF_WORLD - 2; this.heading[i] = -this.heading[i];          this.headingTarget[i] = this.heading[i]; }
      if (nz < -HALF_WORLD + 2) { nz = -HALF_WORLD + 2; this.heading[i] = -this.heading[i];          this.headingTarget[i] = this.heading[i]; }
      this.pos[3 * i]     = nx;
      this.pos[3 * i + 2] = nz;

      // -------- Bob (smaller while idle, bigger while fleeing) --------
      // -------- Bob (per-state amplitude) --------
      const bobAmp = (stCur === 5 ? 0.12 : stCur === 4 ? 0.09 : stCur === 2 ? 0.10 : stCur === 0 ? 0.025 : 0.06);
      const bob = Math.sin(now * 0.011 + this.phase[i]) * bobAmp;

      // -------- Hop animation (parabolic Y boost during wander/flee/chase/attack) --------
      let hopY = 0;
      if (this.hopFrom[i] > 0) {
        const hopDur = (stCur === 5 ? 220 : stCur === 2 ? 280 : 380);
        const ht = now - this.hopFrom[i];
        if (ht >= hopDur) {
          this.hopFrom[i] = 0;
        } else {
          const u = ht / hopDur;
          const peak = (stCur === 5 ? 0.65 : stCur === 2 ? 0.50 : stCur === 4 ? 0.36 : 0.28);
          hopY = 4 * u * (1 - u) * peak;
        }
      } else if ((stCur === 1 || stCur === 2 || stCur === 4) && now > this.hopAt[i]) {
        this.hopFrom[i] = now;
        const minMs = (stCur === 4 ? 500 : stCur === 2 ? 320 : 1100);
        const maxMs = (stCur === 4 ? 950 : stCur === 2 ? 600 : 2600);
        this.hopAt[i] = now + minMs + Math.random() * (maxMs - minMs);
      }

      const baseY = (stCur === 5 ? 0.05 : stCur === 2 ? 0.04 : 0.02);
      const y = baseY + Math.abs(bob) + hopY;
      this.pos[3 * i + 1] = y;

      // Spawn fade-in: scale 0 → 1 over SPAWN_FADE_MS using smoothstep
      const sinceSpawn = now - this.spawnedAt[i];
      let scale = 1;
      if (sinceSpawn < SPAWN_FADE_MS) {
        const u = Math.max(0, sinceSpawn / SPAWN_FADE_MS);
        scale = u * u * (3 - 2 * u);
      }

      // Yaw so geometry's +Z forward aligns with heading (atan2-style XZ angle)
      const yaw = -this.heading[i] + Math.PI / 2;
      this._tmpQ.setFromAxisAngle(upY, yaw);
      this._tmpS.set(scale, scale, scale);
      this._tmpV.set(nx, y, nz);
      this._tmpMat.compose(this._tmpV, this._tmpQ, this._tmpS);
      this._writeMatrix(i, this._tmpMat);
    }
    this.coatMesh.instanceMatrix.needsUpdate  = true;
    this.fixedMesh.instanceMatrix.needsUpdate = true;
  }
}

// ============================================================
//   Player avatar (single Group, not instanced)
// ============================================================
function buildPlayerAvatar() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    buildHamsterGeometry(PLAYER_HAM_COLOR),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  body.name = 'playerBody';
  root.add(body);

  // Tiny "gun" sticking out front-right
  const gunGeom = mergeBoxes([
    { size: [0.10, 0.10, 0.45], pos: [0, 0.04, 0.25], color: [0.10, 0.10, 0.12] },
    { size: [0.10, 0.18, 0.18], pos: [0, -0.06, 0.08], color: [0.12, 0.12, 0.14] },
  ]);
  const gun = new THREE.Mesh(gunGeom, new THREE.MeshLambertMaterial({ vertexColors: true }));
  gun.position.set(0.30, 0.40, 0.55);
  gun.name = 'playerGun';
  root.add(gun);

  // 3D muzzle flash — Group of voxel boxes + a brief PointLight for environmental flash
  const muzzleGroup = new THREE.Group();
  muzzleGroup.name = 'playerMuzzle';
  muzzleGroup.position.set(0.30, 0.44, 1.05);
  muzzleGroup.scale.set(0.001, 0.001, 0.001);
  muzzleGroup.userData.flashMats = [];

  function addFlashMesh(geom, color, baseOpacity) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: baseOpacity, depthWrite: false,
    });
    const m = new THREE.Mesh(geom, mat);
    m.renderOrder = 3;
    muzzleGroup.add(m);
    muzzleGroup.userData.flashMats.push({ m: mat, base: baseOpacity });
    return m;
  }
  // Hot white core
  addFlashMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), 0xffffff, 1.00);
  // Forward flame (thin Z stretch)
  const flame = addFlashMesh(new THREE.BoxGeometry(0.13, 0.13, 0.46), 0xffcf3a, 0.95);
  flame.position.z = 0.22;
  // Star burst sparkle — 4 thin perpendicular bars
  addFlashMesh(new THREE.BoxGeometry(0.55, 0.045, 0.045), 0xfff8c0, 0.85);
  addFlashMesh(new THREE.BoxGeometry(0.045, 0.55, 0.045), 0xfff8c0, 0.85);
  addFlashMesh(new THREE.BoxGeometry(0.045, 0.045, 0.55), 0xfff8c0, 0.65);

  // Brief PointLight that fades out — gives the scene a yellow blink during fire
  const muzzleLight = new THREE.PointLight(0xffd870, 0, 7, 2);
  muzzleLight.position.set(0, 0, 0.4);
  muzzleGroup.add(muzzleLight);
  muzzleGroup.userData.light = muzzleLight;

  root.add(muzzleGroup);

  // Contact shadow under the player so the avatar reads grounded
  const shadowGeom = new THREE.CircleGeometry(0.7, 24);
  shadowGeom.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeom, shadowMat);
  shadow.position.set(0, 0.01, 0);
  shadow.renderOrder = 1;
  shadow.name = 'playerShadow';
  root.add(shadow);

  return root;
}

// ============================================================
//   Game
// ============================================================
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 400);

    this.ground = buildWorld(this.scene);

    this.player = buildPlayerAvatar();
    this.player.position.set(0, 0, 0);
    this.scene.add(this.player);
    this.muzzleMesh = this.player.getObjectByName('playerMuzzle');
    this.muzzleFiredAt = 0;

    this.swarm = new Swarm(this.scene, NPC_COUNT);

    this.cameraYaw       = 0;
    this.cameraYawTarget = 0;
    this.cameraPos       = this.player.position.clone().add(CAMERA_OFFSET);
    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.player.position);

    this.raycaster = new THREE.Raycaster();
    this.aimNDC    = new THREE.Vector2(0, 0);
    this.aimWorld  = new THREE.Vector3();
    this.pointer   = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    this.keys = new Set();
    this.firing = false;
    this.paused = false;
    this.gateUntil = 0;             // mousedown ignored before this timestamp (splash leak guard)
    this.lastShotAt = 0;
    this.lastRespawnAt = 0;
    this.lastBubbleAt = 0;
    this.lastRingAt = 0;
    this.shots = 0;
    this.bonked = 0;

    // Drift-style movement state
    this.velocity = new THREE.Vector3();
    this.playerYawTarget = 0;

    // Weapon system
    this.currentWeapon = 0;
    this._tracers = []; // { mesh, mat, geom, killAt }

    this._bindInput();
    window.addEventListener('resize', this._onResize.bind(this));

    this.shotsEl  = document.getElementById('hitCount');
    this.bonkedEl = document.getElementById('hamCount');
    this.accEl    = document.getElementById('accCount');
    this.bitesEl  = document.getElementById('biteCount');
    this.backPill = document.getElementById('backPill');
    this.pauseHint= document.getElementById('pauseHint');
    this.weaponPill = document.getElementById('weaponPill');
    this._setWeapon(0);

    this.cameraMode = 0;            // 0 chase · 1 fps · 2 top-down
    this.cameraPill = document.getElementById('cameraPill');
    // Cache references so we can toggle visibility per camera mode
    this.playerBody  = this.player.getObjectByName('playerBody');
    this.playerShadow = this.player.getObjectByName('playerShadow');
    this._setCameraMode(0);

    this.bites = 0;
    this.swarm.onBite = (x, z) => this._handleBite(x, z);

    if (this.backPill) {
      const pause = () => this.setPaused(true);
      this.backPill.addEventListener('click', pause);
      this.backPill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pause(); }
      });
    }
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.firing = false;
      this.keys.clear();
      this.backPill?.classList.add('show');
      this.pauseHint?.classList.add('show');
      setArmed(false);
      document.body.classList.add('paused');
      const splash = document.getElementById('splash');
      if (splash) splash.classList.remove('hide');
    } else {
      this.backPill?.classList.remove('show');
      this.pauseHint?.classList.remove('show');
      document.body.classList.remove('paused');
      setArmed(true);
      this.gateUntil = performance.now() + SPLASH_GATE_MS;
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  // NOTE: this game targets desktop only — mouse + keyboard. Touch is out of scope for v1.
  _bindInput() {
    const cross = document.getElementById('gunCrosshair');
    const onMove = (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (cross) {
        cross.style.left = e.clientX + 'px';
        cross.style.top  = e.clientY + 'px';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.paused) return;
      if (performance.now() < this.gateUntil) return; // splash → game leak guard
      this.firing = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    window.addEventListener('blur', () => { this.firing = false; this.keys.clear(); });
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      // Esc always works (toggles pause)
      if (k === 'escape') { this.setPaused(!this.paused); return; }
      if (this.paused) return;
      this.keys.add(k);
      if (k === 'q') this.cameraYawTarget -= Math.PI / 2;
      if (k === 'e') this.cameraYawTarget += Math.PI / 2;
      if (k === ' ') this.firing = true;
      // Weapon switch — number keys 1..4 map to WEAPONS index
      if (k >= '1' && k <= String(WEAPONS.length)) {
        this._setWeapon(parseInt(k, 10) - 1);
      }
      // Camera mode cycle
      if (k === 'v') this._setCameraMode((this.cameraMode + 1) % CAMERA_MODES.length);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ') this.firing = false;
    });
  }

  _updateAim() {
    this.aimNDC.x = (this.pointer.x / window.innerWidth) * 2 - 1;
    this.aimNDC.y = -(this.pointer.y / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.aimNDC, this.camera);
    const hit = this.raycaster.ray.intersectPlane(GROUND_PLANE, this.aimWorld);
    if (!hit) this.aimWorld.set(this.player.position.x, 0, this.player.position.z + 1);
  }

  _updatePlayer(dt) {
    const k = this.keys;

    // Auto-runner: only A/D strafes; the hamster always walks forward in its facing direction.
    let strafe = 0;
    if (k.has('a') || k.has('arrowleft'))  strafe -= 1;
    if (k.has('d') || k.has('arrowright')) strafe += 1;

    // Player's local forward (geometry authored +Z) rotated by yaw around Y
    const yaw = this.player.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    // Right vector perpendicular to forward, on XZ plane
    const rightX =  Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const targetVx = fwdX * PLAYER_AUTO_FORWARD_SPEED + rightX * strafe * PLAYER_STRAFE_SPEED;
    const targetVz = fwdZ * PLAYER_AUTO_FORWARD_SPEED + rightZ * strafe * PLAYER_STRAFE_SPEED;

    // Drift: lerp toward target velocity each frame — turns produce sideways slide
    const a = Math.min(1, dt * PLAYER_ACCEL_LERP);
    this.velocity.x += (targetVx - this.velocity.x) * a;
    this.velocity.z += (targetVz - this.velocity.z) * a;

    this.player.position.x += this.velocity.x * dt;
    this.player.position.z += this.velocity.z * dt;

    // World clamp — zero velocity component pressing into the wall so the auto-runner
    // doesn't oscillate along boundaries; turning away frees the velocity again
    if (this.player.position.x >  HALF_WORLD - 1.5) { this.player.position.x =  HALF_WORLD - 1.5; if (this.velocity.x > 0) this.velocity.x = 0; }
    if (this.player.position.x < -HALF_WORLD + 1.5) { this.player.position.x = -HALF_WORLD + 1.5; if (this.velocity.x < 0) this.velocity.x = 0; }
    if (this.player.position.z >  HALF_WORLD - 1.5) { this.player.position.z =  HALF_WORLD - 1.5; if (this.velocity.z > 0) this.velocity.z = 0; }
    if (this.player.position.z < -HALF_WORLD + 1.5) { this.player.position.z = -HALF_WORLD + 1.5; if (this.velocity.z < 0) this.velocity.z = 0; }

    // Face the aim point with smooth yaw drift — mouse cursor effectively steers the hamster
    const dx = this.aimWorld.x - this.player.position.x;
    const dz = this.aimWorld.z - this.player.position.z;
    if (dx * dx + dz * dz > 0.0004) {
      const heading = Math.atan2(dz, dx);
      this.playerYawTarget = -heading + Math.PI / 2;
    }
    let dYaw = this.playerYawTarget - this.player.rotation.y;
    while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.player.rotation.y += dYaw * Math.min(1, dt * PLAYER_YAW_LERP);
  }

  _updateCamera(dt) {
    // Smoothly tween yaw — only used by chase mode for Q/E camera rotation
    const yawDiff = this.cameraYawTarget - this.cameraYaw;
    this.cameraYaw += yawDiff * Math.min(1, dt * CAMERA_YAW_LERP);

    if (this.cameraMode === 1) {
      // -------- First-person: camera at hamster head, look toward aim --------
      this.cameraPos.set(
        this.player.position.x,
        this.player.position.y + FPS_CAM_HEIGHT,
        this.player.position.z,
      );
      this.camera.position.copy(this.cameraPos);
      // Look 0.6 above ground at the aim point (so horizon reads naturally)
      this.camera.lookAt(this.aimWorld.x, 0.6, this.aimWorld.z);
      return;
    }

    if (this.cameraMode === 2) {
      // -------- Top-down: straight overhead, camera "north" = -Z (up vector set in _setCameraMode) --------
      this.cameraPos.set(this.player.position.x, TOPDOWN_CAM_HEIGHT, this.player.position.z);
      this.camera.position.copy(this.cameraPos);
      this.camera.lookAt(this.player.position.x, 0, this.player.position.z);
      return;
    }

    // -------- Chase (default) --------
    const c = Math.cos(this.cameraYaw), s = Math.sin(this.cameraYaw);
    const ox = CAMERA_OFFSET.x * c - CAMERA_OFFSET.z * s;
    const oz = CAMERA_OFFSET.x * s + CAMERA_OFFSET.z * c;
    const targetX = this.player.position.x + ox;
    const targetY = CAMERA_OFFSET.y;
    const targetZ = this.player.position.z + oz;
    this.cameraPos.x += (targetX - this.cameraPos.x) * CAMERA_LERP;
    this.cameraPos.y += (targetY - this.cameraPos.y) * CAMERA_LERP;
    this.cameraPos.z += (targetZ - this.cameraPos.z) * CAMERA_LERP;
    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.player.position.x, 0.6, this.player.position.z);
  }

  _setCameraMode(idx) {
    if (idx < 0 || idx >= CAMERA_MODES.length) return;
    this.cameraMode = idx;
    const m = CAMERA_MODES[idx];
    if (this.cameraPill) {
      const k = this.cameraPill.querySelector('.camera-key');
      const n = this.cameraPill.querySelector('.camera-mode');
      if (k) k.textContent = m.key;
      if (n) n.textContent = m.name;
    }
    // Visibility: in FPS hide our own body/shadow so we don't see the inside of the hamster
    const isFPS = (idx === 1);
    if (this.playerBody)   this.playerBody.visible   = !isFPS;
    if (this.playerShadow) this.playerShadow.visible = !isFPS;
    // In top-down, set camera up vector so "north" stays consistent on screen
    this.camera.up.set(0, idx === 2 ? 0 : 1, idx === 2 ? -1 : 0);
  }

  _setWeapon(idx) {
    if (idx < 0 || idx >= WEAPONS.length) return;
    if (this.currentWeapon === idx && this.weaponPill?.querySelector('.weapon-name')?.textContent) return;
    this.currentWeapon = idx;
    const w = WEAPONS[idx];
    if (this.weaponPill) {
      const key  = this.weaponPill.querySelector('.weapon-key');
      const name = this.weaponPill.querySelector('.weapon-name');
      if (key)  key.textContent  = w.key;
      if (name) name.textContent = w.name;
      const r = (w.color >> 16) & 0xff;
      const g = (w.color >>  8) & 0xff;
      const b = (w.color)        & 0xff;
      this.weaponPill.style.setProperty('--weapon-color', `rgb(${r},${g},${b})`);
      this.weaponPill.style.setProperty('--weapon-glow',  `rgba(${r},${g},${b},0.55)`);
    }
  }

  _tryFire(now) {
    if (!this.firing) return;
    const w = WEAPONS[this.currentWeapon];
    if (now - this.lastShotAt < w.fireMs) return;
    this.lastShotAt = now;
    this._fire(now);
  }

  _fire(now) {
    const weapon = WEAPONS[this.currentWeapon];
    bang();
    flashMuzzle();
    const cross = document.getElementById('gunCrosshair');
    if (cross) {
      cross.classList.remove('fire');
      void cross.offsetWidth;
      cross.classList.add('fire');
    }
    // 3D muzzle flash burst at the gun barrel tip
    if (this.muzzleMesh) {
      this.muzzleMesh.scale.set(1.4, 1.4, 1.4);
      this.muzzleFiredAt = now;
      const mats = this.muzzleMesh.userData.flashMats || [];
      for (const e of mats) e.m.opacity = e.base;
      const light = this.muzzleMesh.userData.light;
      if (light) light.intensity = 5.5;
    }

    // Compute the gun-barrel world position once for every pellet's tracer start
    const muzzleWorld = new THREE.Vector3();
    if (this.muzzleMesh) this.muzzleMesh.getWorldPosition(muzzleWorld);
    else muzzleWorld.copy(this.player.position).add(new THREE.Vector3(0, 0.6, 0));

    // Per-pellet ray: jitter NDC by weapon.spread; pierce kills every live hamster on the line
    let anyHit = false;
    let bonkedThisShot = 0;
    for (let p = 0; p < weapon.pellets; p++) {
      const jx = (Math.random() - 0.5) * 2 * weapon.spread;
      const jy = (Math.random() - 0.5) * 2 * weapon.spread;
      const ndcX = this.aimNDC.x + jx;
      const ndcY = this.aimNDC.y + jy;
      this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
      const hits = this.raycaster.intersectObject(this.swarm.mesh, false);

      let tracerEnd = null;
      if (hits.length > 0) {
        const max = weapon.pierce ? hits.length : 1;
        let firstAlive = null;
        let killsThisRay = 0;
        for (let h = 0; h < max; h++) {
          const hit = hits[h];
          const i = hit.instanceId;
          if (i == null) continue;
          if (!this.swarm.alive[i] || this.swarm.state[i] === 3) continue;
          this.swarm.kill(i, now);
          this.swarm.alertNear(hit.point, now);
          this.bonked++;
          bonkedThisShot++;
          killsThisRay++;
          if (!firstAlive) firstAlive = hit.point;
        }
        if (killsThisRay > 0) anyHit = true;
        // Tracer ends at the FURTHEST kill (so sniper beam reads as full piercing line),
        // or the first geometric hit when we shot a corpse / sliding hits without kills.
        tracerEnd = (weapon.pierce && killsThisRay > 1) ? hits[hits.length - 1].point
                                                        : (firstAlive || hits[0].point);

        // Per-hit screen feedback (throttled by parent fire rate via lastRing/lastBubble)
        if (firstAlive) {
          const screen = projectToScreen(firstAlive, this.camera);
          if (now - this.lastRingAt > RING_THROTTLE_MS) {
            popHitRing(screen.x, screen.y);
            this.lastRingAt = now;
          }
          if (now - this.lastBubbleAt > BUBBLE_THROTTLE_MS) {
            const cry = CRIES[Math.floor(Math.random() * CRIES.length)];
            popBubble(screen.x, screen.y, cry[0], cry[1]);
            this.lastBubbleAt = now;
          }
        }
      } else {
        // No hit — startle nearby and project the tracer to the aim point on the ground
        this.swarm.alertNear(this.aimWorld, now);
        const r = this.raycaster.ray;
        tracerEnd = r.origin.clone().add(r.direction.clone().multiplyScalar(80));
      }

      this._spawnTracer(muzzleWorld, tracerEnd, weapon.color, weapon.width, weapon.life);
    }

    if (anyHit) flashVignette();
    if (this.bonkedEl && bonkedThisShot > 0) {
      this.bonkedEl.textContent = this.bonked;
      bumpStat(this.bonkedEl);
    }

    // Count one "shot" per pellet so accuracy means "pellet hit-rate"
    this.shots += weapon.pellets;
    if (this.shotsEl) {
      this.shotsEl.textContent = this.shots;
      bumpStat(this.shotsEl);
    }
    this._updateAccuracy();
  }

  _spawnTracer(start, end, color, width, life) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if (len < 0.1) return;
    const geom = new THREE.BoxGeometry(width, width, len);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.92, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(start).addScaledVector(dir, 0.5);
    mesh.lookAt(end);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    // Fast fade-out via timestamp; tick() decays opacity then disposes
    this._tracers.push({ mesh, mat, geom, born: performance.now(), life });
  }

  _decayTracers(now) {
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      const age = now - t.born;
      if (age >= t.life) {
        this.scene.remove(t.mesh);
        t.geom.dispose();
        t.mat.dispose();
        this._tracers.splice(i, 1);
        continue;
      }
      t.mat.opacity = 0.92 * (1 - age / t.life);
    }
  }

  _updateAccuracy() {
    if (!this.accEl) return;
    const acc = this.shots > 0 ? Math.round((this.bonked / this.shots) * 100) : 0;
    this.accEl.textContent = acc + '%';
  }

  _handleBite(worldX, worldZ) {
    this.bites++;
    if (this.bitesEl) {
      this.bitesEl.textContent = this.bites;
      bumpStat(this.bitesEl);
    }
    // Brief screen flash + onomatopoeia bubble at player screen position
    flashVignette();
    try {
      const p = new THREE.Vector3(worldX, 0.5, worldZ);
      const screen = projectToScreen(p, this.camera);
      const cries = ['BITE!', 'NOM!', 'CHOMP!', 'OW!', 'GNAW!'];
      popBubble(screen.x, screen.y, cries[Math.floor(Math.random() * cries.length)], 'warn');
    } catch (e) {}
  }

  _decayMuzzle3D(now) {
    if (!this.muzzleMesh || !this.muzzleFiredAt) return;
    const t = now - this.muzzleFiredAt;
    const mats = this.muzzleMesh.userData.flashMats || [];
    const light = this.muzzleMesh.userData.light;
    if (t > MUZZLE_FLASH_MS) {
      this.muzzleMesh.scale.set(0.001, 0.001, 0.001);
      for (const e of mats) e.m.opacity = 0;
      if (light) light.intensity = 0;
      this.muzzleFiredAt = 0;
      return;
    }
    // Sharp attack at t=0, then quadratic fade-out
    const u  = 1 - (t / MUZZLE_FLASH_MS);
    const ue = u * u;
    const s  = 0.55 + 0.85 * u;        // pulse 1.4 → 0.55 over the decay
    this.muzzleMesh.scale.set(s, s, s);
    for (const e of mats) e.m.opacity = e.base * ue;
    if (light) light.intensity = 5.5 * ue;
  }

  _maybeRespawn(now) {
    if (now - this.lastRespawnAt < RESPAWN_INTERVAL_MS) return;
    this.lastRespawnAt = now;
    this.swarm.respawnOne(now, this.player.position);
  }

  tick(dt, now) {
    if (this.paused) {
      // Render the frozen frame so transitions look clean, but don't simulate
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this._updateAim();
    this._updatePlayer(dt);
    this._updateCamera(dt);
    this.swarm.tick(dt, now, this.player, this.velocity);
    this._tryFire(now);
    this._maybeRespawn(now);
    this._decayMuzzle3D(now);
    this._decayTracers(now);
    this.renderer.render(this.scene, this.camera);
  }
}

function projectToScreen(point3, camera) {
  const v = point3.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
  };
}

// ============================================================
//   Bootstrap
// ============================================================
let _game = null;

function startOrResume() {
  const splash = document.getElementById('splash');
  splash?.classList.add('hide');                // fade splash; keep DOM so we can re-show on Esc

  if (_game) {
    _game.setPaused(false);
    return;
  }

  injectHUD();
  setArmed(true);

  const canvas = document.getElementById('gameCanvas');
  _game = new Game(canvas);
  _game.gateUntil = performance.now() + SPLASH_GATE_MS;  // ignore mousedown that leaks from PLAY click
  window.__game = _game;

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    _game.tick(dt, now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

const playBtn = document.getElementById('playBtn');
if (playBtn) {
  playBtn.addEventListener('click', startOrResume);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('playBtn')?.addEventListener('click', startOrResume);
  });
}
