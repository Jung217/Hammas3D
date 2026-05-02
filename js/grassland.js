import * as THREE from 'three';
import {
  WORLD_SIZE, HALF_WORLD,
  buildWorld, buildPlayerAvatar,
} from './world.js';
import { Swarm } from './swarm.js';
import {
  injectHUD, setArmed, bumpStat,
  popBubble, popHitRing, flashMuzzle, flashVignette,
  bang, CRIES, projectToScreen,
} from './hud.js';

// ============================================================
//   Hammas — Hamster Grassland (entry)
//   Three.js voxel-art open-world hamster shooter.
//   Player controls a voxel hamster avatar across a 200x200 plain
//   and sweeps fire at NPC hamsters (some hostile) wandering the field.
//
//   Module layout:
//     · world.js   — terrain, decorations, voxel helpers, player avatar
//     · swarm.js   — InstancedMesh hamster crowd + Pac-Man-style AI
//     · hud.js     — HUD overlay, popups, screen projection, gunshot synth
//     · grassland.js (this file) — Game class, weapons, camera, bootstrap
// ============================================================

// ---------- Game / camera / UI tunables ----------
const NPC_COUNT          = 150;
const RESPAWN_INTERVAL_MS = 1500;

// Chase camera offset + smoothing
const CAMERA_OFFSET    = new THREE.Vector3(0, 14.5, 11);
const CAMERA_LERP      = 0.12;
const CAMERA_YAW_LERP  = 3.5;        // per-second factor (≈ 0.18 s tween for Q/E)
const GROUND_PLANE     = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// UI / input gates
const SPLASH_GATE_MS    = 600;   // ignore mousedown for 600ms after PLAY to prevent leak-through
const BUBBLE_THROTTLE_MS = 120;  // min spacing between hit bubbles (DOM cap)
const RING_THROTTLE_MS   = 70;   // min spacing between hit rings

// Player movement — auto-runner with mouse-steer (CHASE/TOP) or keyboard-rotate (FPS)
const PLAYER_AUTO_FORWARD_SPEED = 7.5;
const PLAYER_STRAFE_SPEED       = 6.0;
const PLAYER_ACCEL_LERP   = 5.0;  // per-second factor — smooth approach to target velocity (drift feel)
const PLAYER_YAW_LERP     = 9.0;  // per-second factor for facing-aim rotation

// Weapons — switch with 1/2/3/4 number keys
const WEAPONS = [
  { name: 'PISTOL',  key: '1', fireMs:  90, spread: 0.000, pellets: 1, color: 0xffd84a, width: 0.05, life: 50,  pierce: false },
  { name: 'SMG',     key: '2', fireMs:  55, spread: 0.025, pellets: 1, color: 0x6cf0ff, width: 0.04, life: 45,  pierce: false },
  { name: 'SHOTGUN', key: '3', fireMs: 600, spread: 0.110, pellets: 8, color: 0xff8a3a, width: 0.06, life: 80,  pierce: false },
  { name: 'SNIPER',  key: '4', fireMs: 1100, spread: 0.000, pellets: 1, color: 0xe8f0ff, width: 0.08, life: 130, pierce: true  },
];
const MUZZLE_FLASH_MS = 90;

// Camera modes — V key cycles through these
const CAMERA_MODES = [
  { name: 'CHASE', key: 'V' },
  { name: 'FPS',   key: 'V' },
  { name: 'TOP',   key: 'V' },
];
const FPS_CAM_HEIGHT     = 0.65;        // camera at hamster head height in first-person
const FPS_TURN_RATE      = 2.6;         // radians/sec — A/D turn speed when in FPS
const TOPDOWN_CAM_HEIGHT = 70;          // default straight-up height in top-down view
const TOPDOWN_HEIGHT_MIN = 28;
const TOPDOWN_HEIGHT_MAX = 160;
const TOPDOWN_ZOOM_STEP  = 0.06;        // multiplier per wheel delta unit

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

    const built = buildWorld(this.scene);
    this.ground = built.ground;
    this._tufts = built.tufts;

    this.player = buildPlayerAvatar();
    this.player.position.set(0, 0, 0);
    this.scene.add(this.player);
    this.muzzleMesh = this.player.getObjectByName('playerMuzzle');
    this.muzzleFiredAt = 0;

    this.swarm = new Swarm(this.scene, NPC_COUNT, this._tufts);

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
    this._tracers = []; // { mesh, mat, geom, life, born }

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
    this.topdownHeight = TOPDOWN_CAM_HEIGHT;  // adjustable via wheel in top-down mode
    this.cameraPill = document.getElementById('cameraPill');
    // Cache references so we can toggle visibility per camera mode
    this.playerBody  = this.player.getObjectByName('playerBody');
    this.playerShadow = this.player.getObjectByName('playerShadow');
    this._setCameraMode(0);

    this.bites = 0;
    this.swarm.onBite = (x, z) => this._handleBite(x, z);

    // Perf overlay state — toggled with F3 / backtick
    this.perfEl = document.getElementById('perfStats');
    this.perfVisible = false;
    this._perfFrames = 0;
    this._perfLastUpdate = performance.now();

    if (this.backPill) {
      const pause = () => this.setPaused(true);
      this.backPill.addEventListener('click', pause);
      this.backPill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pause(); }
      });

      // Hover near the top-left corner reveals the BACK pill (per plan §HUD)
      // Hides again ~700 ms after cursor leaves the corner zone, unless paused
      this._backHoverTimer = null;
      window.addEventListener('mousemove', (e) => {
        if (this.paused) return; // already showing via setPaused
        const inHotZone = (e.clientX < 88 && e.clientY < 88);
        if (inHotZone) {
          this.backPill.classList.add('show');
          if (this._backHoverTimer) { clearTimeout(this._backHoverTimer); this._backHoverTimer = null; }
        } else if (this.backPill.classList.contains('show') && !this._backHoverTimer) {
          this._backHoverTimer = setTimeout(() => {
            if (!this.paused) this.backPill.classList.remove('show');
            this._backHoverTimer = null;
          }, 700);
        }
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
    // Wheel zoom — only meaningful in top-down mode; preventDefault stops the page from scrolling
    window.addEventListener('wheel', (e) => {
      if (this.paused || this.cameraMode !== 2) return;
      e.preventDefault();
      this.topdownHeight = Math.max(
        TOPDOWN_HEIGHT_MIN,
        Math.min(TOPDOWN_HEIGHT_MAX, this.topdownHeight + e.deltaY * TOPDOWN_ZOOM_STEP),
      );
    }, { passive: false });
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
      // Perf overlay toggle (F3 or backtick)
      if (k === 'f3' || k === '`') {
        this.perfVisible = !this.perfVisible;
        this.perfEl?.classList.toggle('show', this.perfVisible);
      }
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
    const isFPS = (this.cameraMode === 1);

    // Input mapping — A/D mean different things by camera mode:
    //   FPS  : A/D rotate the hamster left/right (mouse must NOT steer or it's nausea-cam)
    //   else : A/D strafe perpendicular to facing (mouse steers via aim point)
    let strafe = 0, turn = 0;
    if (k.has('a') || k.has('arrowleft'))  { if (isFPS) turn -= 1; else strafe -= 1; }
    if (k.has('d') || k.has('arrowright')) { if (isFPS) turn += 1; else strafe += 1; }

    // FPS turn — directly nudge the yaw target; smooth lerp at the bottom does the easing
    if (isFPS && turn !== 0) {
      this.playerYawTarget += turn * FPS_TURN_RATE * dt;
    }

    // Player's local forward (geometry authored +Z) rotated by yaw around Y
    const yaw = this.player.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX =  Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    // Velocity: always auto-forward + (strafe only when not FPS)
    const targetVx = fwdX * PLAYER_AUTO_FORWARD_SPEED + (isFPS ? 0 : rightX * strafe * PLAYER_STRAFE_SPEED);
    const targetVz = fwdZ * PLAYER_AUTO_FORWARD_SPEED + (isFPS ? 0 : rightZ * strafe * PLAYER_STRAFE_SPEED);

    const a = Math.min(1, dt * PLAYER_ACCEL_LERP);
    this.velocity.x += (targetVx - this.velocity.x) * a;
    this.velocity.z += (targetVz - this.velocity.z) * a;

    this.player.position.x += this.velocity.x * dt;
    this.player.position.z += this.velocity.z * dt;

    if (this.player.position.x >  HALF_WORLD - 1.5) { this.player.position.x =  HALF_WORLD - 1.5; if (this.velocity.x > 0) this.velocity.x = 0; }
    if (this.player.position.x < -HALF_WORLD + 1.5) { this.player.position.x = -HALF_WORLD + 1.5; if (this.velocity.x < 0) this.velocity.x = 0; }
    if (this.player.position.z >  HALF_WORLD - 1.5) { this.player.position.z =  HALF_WORLD - 1.5; if (this.velocity.z > 0) this.velocity.z = 0; }
    if (this.player.position.z < -HALF_WORLD + 1.5) { this.player.position.z = -HALF_WORLD + 1.5; if (this.velocity.z < 0) this.velocity.z = 0; }

    // Yaw target — mouse-steers ONLY in non-FPS modes. FPS keeps the locked heading.
    if (!isFPS) {
      const dx = this.aimWorld.x - this.player.position.x;
      const dz = this.aimWorld.z - this.player.position.z;
      if (dx * dx + dz * dz > 0.0004) {
        const heading = Math.atan2(dz, dx);
        this.playerYawTarget = -heading + Math.PI / 2;
      }
    }

    let dYaw = this.playerYawTarget - this.player.rotation.y;
    while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    // FPS turn responds faster (it's input-driven, not aim-driven), other modes use the regular lerp
    const yawLerpRate = isFPS ? PLAYER_YAW_LERP * 1.6 : PLAYER_YAW_LERP;
    this.player.rotation.y += dYaw * Math.min(1, dt * yawLerpRate);
  }

  _updateCamera(dt) {
    // Smoothly tween yaw — only used by chase mode for Q/E camera rotation
    const yawDiff = this.cameraYawTarget - this.cameraYaw;
    this.cameraYaw += yawDiff * Math.min(1, dt * CAMERA_YAW_LERP);

    if (this.cameraMode === 1) {
      // -------- First-person: camera at hamster head, looking down the player's facing axis --------
      // Mouse cursor does NOT pull the camera around — A/D rotates the player → camera follows.
      this.cameraPos.set(
        this.player.position.x,
        this.player.position.y + FPS_CAM_HEIGHT,
        this.player.position.z,
      );
      this.camera.position.copy(this.cameraPos);
      const yaw = this.player.rotation.y;
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      this.camera.lookAt(
        this.player.position.x + fwdX * 5,
        this.player.position.y + 0.45,           // a touch above forward to feel like horizon, not feet
        this.player.position.z + fwdZ * 5,
      );
      return;
    }

    if (this.cameraMode === 2) {
      // -------- Top-down: straight overhead, height adjustable via wheel --------
      this.cameraPos.set(this.player.position.x, this.topdownHeight, this.player.position.z);
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

  _updatePerf(now) {
    this._perfFrames++;
    if (now - this._perfLastUpdate < 500) return;
    if (this.perfVisible && this.perfEl) {
      const fps = Math.round((this._perfFrames * 1000) / (now - this._perfLastUpdate));
      const r = this.renderer.info.render;
      this.perfEl.textContent = `FPS ${fps} · CALLS ${r.calls} · TRIS ${r.triangles}`;
    }
    this._perfFrames = 0;
    this._perfLastUpdate = now;
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
    this._updatePerf(now);
  }
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
