// ============================================================
//   HUD — DOM + CSS overlay (glassmorphism), helper popups,
//          Web Audio gunshot synth, screen-space projection
//   No Three.js dependency: projectToScreen takes a Vector3
//   that already has a `.clone().project()` method.
// ============================================================

// ============================================================
//   HUD inject — style + DOM (style block ported from gun.js)
// ============================================================
export function injectHUD() {
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
      position: fixed; bottom: 14px; right: 14px;
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

    /* ←  BACK pill (top-left) — glassmorphism, only visible when paused or on hover */
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

    /* Weapon pill (top-left) — shows current weapon + key, color tints to weapon */
    #weaponPill {
      position: fixed; top: 14px; left: 14px;
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

    /* Perf overlay (F3 / backtick to toggle) — FPS · draw calls · triangles */
    #perfStats {
      position: fixed; bottom: 14px; left: 14px;
      padding: 6px 12px;
      background: rgba(12, 16, 24, 0.78);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      color: #cbd5e1;
      font: 600 11px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      letter-spacing: 0.06em;
      pointer-events: none;
      z-index: 99999;
      display: none;
      white-space: pre;
    }
    #perfStats.show { display: block; }
    body.paused #perfStats { display: none !important; }

    /* Camera mode pill (top-left under weapon pill) */
    #cameraPill {
      position: fixed; top: 56px; left: 14px;
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

    /* ===========================================================
       Mobile / touch controls — visible only on touch-capable devices
       (coarse pointer = phone/tablet; mouse devices keep desktop layout)
       =========================================================== */
    #mobileFire, #mobileButtons { display: none; }
    @media (pointer: coarse) {
      #mobileFire   { display: flex; }
      #mobileButtons { display: flex; }
      /* Bigger tap targets for the existing pills on touch screens */
      #weaponPill, #cameraPill, #backPill { font-size: 13px; padding-top: 10px; padding-bottom: 10px; }
    }

    /* Big circular FIRE button — bottom-right, primary action */
    #mobileFire {
      position: fixed; bottom: 28px; right: 24px;
      width: 92px; height: 92px;
      border-radius: 50%;
      background: rgba(255, 58, 79, 0.55);
      border: 3px solid rgba(255, 255, 255, 0.42);
      box-shadow: 0 10px 28px rgba(255, 58, 79, 0.45),
                  inset 0 0 18px rgba(255, 255, 255, 0.12);
      align-items: center; justify-content: center;
      font: 800 15px/1 var(--gun-mono);
      letter-spacing: 0.18em; color: #fff;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: none;
      pointer-events: auto;
      z-index: 99999;
      transition: background .12s ease, transform .08s ease;
    }
    #mobileFire.firing {
      background: rgba(255, 58, 79, 0.92);
      transform: scale(0.93);
      box-shadow: 0 6px 18px rgba(255, 58, 79, 0.65),
                  inset 0 0 24px rgba(255, 255, 255, 0.25);
    }

    /* Small button column — left side, easier for left thumb in landscape */
    #mobileButtons {
      position: fixed; bottom: 30px; left: 16px;
      flex-direction: column; gap: 12px;
      align-items: flex-start;
      z-index: 99999;
      pointer-events: none;
    }
    #mobileButtons .mbtn {
      width: 64px; height: 56px;
      border-radius: 28px;
      background: rgba(12, 16, 24, 0.78);
      backdrop-filter: blur(12px) saturate(140%);
      -webkit-backdrop-filter: blur(12px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.42);
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 2px;
      font: 800 11px/1 var(--gun-mono);
      letter-spacing: 0.10em; color: var(--gun-fg);
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      pointer-events: auto;
      transition: transform .08s ease, background .15s ease;
    }
    #mobileButtons .mbtn .label-sm {
      font-size: 8px; letter-spacing: 0.14em;
      color: var(--gun-fg-dim); font-weight: 700;
    }
    #mobileButtons .mbtn:active { transform: scale(0.92); background: rgba(28, 36, 50, 0.92); }

    body.paused #mobileFire, body.paused #mobileButtons { display: none !important; }

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

  // Back-to-splash pill (top-left), shown when paused or on top-left hover
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

  // Perf overlay (hidden by default, F3 / backtick toggles)
  const ps = document.createElement('div');
  ps.id = 'perfStats';
  ps.textContent = 'FPS — · CALLS — · TRIS —';
  document.body.appendChild(ps);

  // ----- Touch / mobile UI (visible only on coarse-pointer devices via CSS) -----
  const fire = document.createElement('div');
  fire.id = 'mobileFire';
  fire.setAttribute('role', 'button');
  fire.setAttribute('aria-label', 'Fire');
  fire.textContent = 'FIRE';
  document.body.appendChild(fire);

  const mbs = document.createElement('div');
  mbs.id = 'mobileButtons';
  mbs.innerHTML = `
    <div class="mbtn" id="mobileWeapon" role="button" aria-label="Switch weapon">
      <span class="label-sm">GUN</span><span id="mobileWeaponName">PISTOL</span>
    </div>
    <div class="mbtn" id="mobileCamera" role="button" aria-label="Switch camera">
      <span class="label-sm">CAM</span><span id="mobileCameraName">CHASE</span>
    </div>
    <div class="mbtn" id="mobilePause" role="button" aria-label="Pause">
      <span class="label-sm">⏸</span><span>PAUSE</span>
    </div>
  `;
  document.body.appendChild(mbs);
}

export function setArmed(on) {
  document.getElementById('gunOverlay')?.classList.toggle('on', on);
  document.body.classList.toggle('armed', on);
}

export function bumpStat(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

export function popBubble(screenX, screenY, text, variant) {
  const el = document.createElement('div');
  el.className = 'gun-bubble' + (variant ? ' ' + variant : '');
  el.textContent = text;
  el.style.left = screenX + 'px';
  el.style.top  = screenY + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 920);
}

export function popHitRing(screenX, screenY) {
  const ring = document.createElement('div');
  ring.className = 'gun-hit-ring';
  ring.style.left = screenX + 'px';
  ring.style.top  = screenY + 'px';
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 400);
}

export function flashMuzzle() {
  const el = document.createElement('div');
  el.className = 'gun-muzzle';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 90);
}

export function flashVignette() {
  const v = document.createElement('div');
  v.className = 'gun-blood-vignette';
  document.body.appendChild(v);
  setTimeout(() => v.remove(), 600);
}

export const CRIES = [
  ['OUCH!',  ''], ['EEK!',   ''], ['!?',     ''],
  ['@#!*',   ''], ['*BONK*', 'warn'], ['OOF', 'warn'], ['SQUEAK!', ''],
];

// ============================================================
//   Web Audio gunshot — copied verbatim from docs/js/gun.js
// ============================================================
let audioCtx = null;
export function bang() {
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
//   Screen-space projection — point3 must be a THREE.Vector3
// ============================================================
export function projectToScreen(point3, camera) {
  const v = point3.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
  };
}
