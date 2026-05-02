import * as THREE from 'three';

// ============================================================
//   World — terrain + decorations + voxel mesh helpers + player avatar geometry
// ============================================================

export const WORLD_SIZE = 200;
export const HALF_WORLD = WORLD_SIZE / 2;

// Player avatar coat color
export const PLAYER_HAM_COLOR = new THREE.Color(0xffd479);

// Per-instance NPC tints (golden / grey / albino / chocolate).
// The hamster's coat geometry is built with white vertex colors so instanceColor
// multiplies cleanly; head / paws / ears all pick up the tint, while baked-in
// parts (eyes, snout, nose, belly stripe, tail) come from a separate fixed mesh.
export const NPC_TINTS = [
  new THREE.Color(0xe6a256), // golden
  new THREE.Color(0xb6b3a8), // grey
  new THREE.Color(0xf3e6c9), // albino / cream
  new THREE.Color(0x8a5a36), // chocolate
];

// Ground "tile" palette — 4 green hues, randomly assigned per quad
export const GROUND_GREENS = [
  [0.30, 0.62, 0.20],
  [0.34, 0.68, 0.22],
  [0.27, 0.56, 0.18],
  [0.38, 0.72, 0.26],
];

// ============================================================
//   Voxel mesh helpers
// ============================================================

// Build a single merged BufferGeometry from an array of voxel boxes,
// each with size, local position, and per-box color. Vertex colors only;
// indices are dropped via toNonIndexed() to keep the merge straightforward.
export function mergeBoxes(boxes) {
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
export function hamsterCoatBoxes(coat) {
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

export function hamsterFixedBoxes() {
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

export function hamsterBoxes(coat) {
  return hamsterCoatBoxes(coat).concat(hamsterFixedBoxes());
}

export function buildHamsterGeometry(color) {
  return mergeBoxes(hamsterBoxes([color.r, color.g, color.b]));
}

// ============================================================
//   Player avatar (single Group, not instanced)
// ============================================================
export function buildPlayerAvatar() {
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
//   World — ground, decorations, sky, lighting; returns { ground, tufts }
// ============================================================
export function buildWorld(scene) {
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
  // Subset of tuft positions returned to the swarm so wanderers can drift toward them
  let tuftPositions = null;
  {
    const g = new THREE.BoxGeometry(0.18, 0.55, 0.18);
    g.translate(0, 0.275, 0);
    const m = new THREE.MeshLambertMaterial({ color: 0x4ea83a });
    const N = 2000;
    const inst = new THREE.InstancedMesh(g, m, N);
    inst.frustumCulled = false;
    const mat = new THREE.Matrix4();
    const pts = scatter(N, 1);
    // Sample 256 tufts as wander targets (full 2000 is overkill — random pick is O(1))
    const SAMPLE = 256;
    tuftPositions = new Float32Array(SAMPLE * 2);
    const stride = Math.max(1, Math.floor(N / SAMPLE));
    for (let i = 0; i < N; i++) {
      const sx = 0.7 + rng() * 0.7;
      const sy = 0.6 + rng() * 1.0;
      mat.makeScale(sx, sy, sx);
      mat.setPosition(pts[i][0], 0, pts[i][1]);
      inst.setMatrixAt(i, mat);
      const sIdx = Math.floor(i / stride);
      if (i % stride === 0 && sIdx < SAMPLE) {
        tuftPositions[sIdx * 2]     = pts[i][0];
        tuftPositions[sIdx * 2 + 1] = pts[i][1];
      }
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

  return { ground, tufts: tuftPositions };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
