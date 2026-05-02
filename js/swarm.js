import * as THREE from 'three';
import {
  WORLD_SIZE, HALF_WORLD,
  NPC_TINTS,
  mergeBoxes, hamsterCoatBoxes, hamsterFixedBoxes,
} from './world.js';

// ============================================================
//   Hamster swarm — Pac-Man-style personalities + chase/scatter modes
// ============================================================

// ---------- AI tunables ----------
export const NPC_WANDER_SPEED = 1.4;
export const NPC_FLEE_SPEED   = 5.5;
export const FLEE_RADIUS      = 9;
export const FLEE_DURATION_MS = 2500;
export const DEATH_DURATION_MS= 1400;
export const SPAWN_FADE_MS    = 420;

// Most hamsters are passive WANDERER. ~30% are aggressive (split among 3 archetypes).
export const PERSONALITY_WANDERER = 0; // graze + wander, skittish to gunshots only
export const PERSONALITY_CHASER   = 1; // straight-line chase toward player position (Blinky)
export const PERSONALITY_AMBUSHER = 2; // intercept — aim ahead of player velocity (Pinky)
export const PERSONALITY_FLANKER  = 3; // approach from a perpendicular angle (Inky)

// Override coat tint for aggressive types so the player can read them at a glance
export const AGGRESSIVE_TINTS = {
  [PERSONALITY_CHASER]:   new THREE.Color(0xff5050), // angry red
  [PERSONALITY_AMBUSHER]: new THREE.Color(0xffaedb), // bubblegum pink
  [PERSONALITY_FLANKER]:  new THREE.Color(0x80e0ff), // sky cyan
};

export const NPC_AGGRESSIVE_FRAC = 0.30; // share of swarm that is aggressive
export const NPC_CHASE_SPEED     = 5.2;     // base aggressive pursuit speed
export const NPC_ATTACK_SPEED    = 9.8;     // commit-to-lunge speed
// Random evasion while chasing — sine wave on heading + occasional sharp jukes
export const NPC_DODGE_AMP       = 0.55;    // ±31° lateral wiggle on the chase line
export const NPC_DODGE_FREQ      = 0.0055;  // sin(now * freq + phase) — period ≈ 1.14 s
export const NPC_JUKE_MIN_MS     = 380;
export const NPC_JUKE_MAX_MS     = 1100;
export const NPC_JUKE_AMP        = 0.85;    // ±49° instant offset added to dodge target
export const ATTACK_RANGE        = 1.7;
export const ATTACK_HIT_RANGE    = 2.4;
export const ATTACK_DURATION_MS  = 460;
export const ATTACK_COOLDOWN_MS  = 1500;

// Global swarm mode oscillation — drives whether aggressive NPCs chase or scatter
export const SWARM_MODE_SCATTER_MS = 9000;
export const SWARM_MODE_CHASE_MS   = 14000;

// Aggressive types ALSO react to gunshots — but opposite of wanderers (charge in, don't flee)
export const ALERT_RADIUS_AGGRESSIVE = 18;
export const AGGRO_RAGE_MS           = 5000;
export const AGGRO_RAGE_SPEED_MUL    = 1.40;

export class Swarm {
  constructor(scene, count, tufts) {
    this.count = count;
    // Optional Float32Array of [x, z, x, z, ...] tuft positions — wanderers drift toward these
    this.tufts = tufts || null;
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
    this.dodgePhase      = new Float32Array(count);  // sine offset for chase-line wiggle
    this.jukeAt          = new Float32Array(count);  // ms timestamp for next sharp side juke
    this.jukeOffset      = new Float32Array(count);  // current juke heading delta (decays)

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
    this.dodgePhase[i]      = Math.random() * Math.PI * 2;
    this.jukeAt[i]          = now + 600 + Math.random() * 1000;
    this.jukeOffset[i]      = 0;

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

      // CHASE: aggressive types pursue player using personality-based target + jinking
      if (stCur === 4) {
        if (!swarmChasing && now >= this.rageUntil[i]) {
          // Mode is SCATTER and rage from a shot has worn off → drop chase
          this.state[i] = 1; stCur = 1;
        } else {
          let tx = px, tz = pz;
          if (personality === PERSONALITY_AMBUSHER) {
            tx = px + pvx * 1.5; tz = pz + pvz * 1.5;
          } else if (personality === PERSONALITY_FLANKER) {
            const len = Math.hypot(pvx, pvz) || 1;
            const perpX = -pvz / len, perpZ = pvx / len;
            const side = (i & 1) ? 1 : -1;
            tx = px + perpX * 5 * side; tz = pz + perpZ * 5 * side;
          }
          const baseHeading = Math.atan2(tz - this.pos[3 * i + 2], tx - this.pos[3 * i]);

          // ---- Random evasion: continuous sine wiggle + occasional sharp juke ----
          const wiggle = Math.sin(now * NPC_DODGE_FREQ + this.dodgePhase[i]) * NPC_DODGE_AMP;
          if (now > this.jukeAt[i]) {
            this.jukeOffset[i] = (Math.random() - 0.5) * 2 * NPC_JUKE_AMP;
            this.jukeAt[i] = now + NPC_JUKE_MIN_MS + Math.random() * (NPC_JUKE_MAX_MS - NPC_JUKE_MIN_MS);
          } else {
            // exponential decay back to 0 — sharp pop, smooth tail
            this.jukeOffset[i] *= Math.exp(-dt * 4.0);
          }
          // Suppress dodge as we close in so the final approach actually lands the lunge
          const ddx0 = px - this.pos[3 * i], ddz0 = pz - this.pos[3 * i + 2];
          const dist = Math.sqrt(ddx0 * ddx0 + ddz0 * ddz0);
          const dodgeAtten = Math.max(0, Math.min(1, (dist - 2.0) / 4.0));   // 0 within 2u, full at 6u+
          this.headingTarget[i] = baseHeading + (wiggle + this.jukeOffset[i]) * dodgeAtten;

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
          } else if (this.tufts && Math.random() < 0.30) {
            // 30% chance to bias toward a random grass tuft (per plan §Hamster NPCs)
            const tCount = this.tufts.length / 2;
            const idx = Math.floor(Math.random() * tCount);
            const tx = this.tufts[idx * 2];
            const tz = this.tufts[idx * 2 + 1];
            this.headingTarget[i] = Math.atan2(tz - this.pos[3 * i + 2], tx - this.pos[3 * i]);
            this.changeAt[i] = now + 1100 + Math.random() * 2200;
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
