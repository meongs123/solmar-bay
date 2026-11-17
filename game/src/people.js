// People of SOLMAR BAY: the player on foot, wandering pedestrians and the
// foot cops who appear at high wanted levels. Characters are built from
// capsules and spheres — no cube people — with varied height, build, skin
// tone and hats.
import * as THREE from 'three';
import { makeRng, clamp, clamp01, damp, wrapAngle, dist2D, approach, weightedPick } from './util.js';
import { CITY_EDGE, sidewalkSpot } from './city.js';
import { resolveCircleColliders } from './vehicles.js';

const SKINS = [0xe8b88a, 0xc98d5f, 0x8a5a34, 0xf0c8a0, 0x6b4423];
const SHIRTS = [0xd94f3d, 0x3d9ad9, 0xe0a83c, 0x4fc46a, 0xc65fd9, 0x3dc4c0, 0xe8e8e8, 0x5a6a7a];
const PANTS = [0x2a3440, 0x3a3a3a, 0x4a3a2a, 0x22262c];

// A person mesh: capsule torso, sphere head with hair cap, capsule arms and
// legs, all animated by a simple walk swing in `animateWalk`.
export function makePersonMesh(opts = {}) {
  const rng = makeRng(opts.seed || 1);
  const scale = opts.scale || 1;
  const skin = opts.skin ?? rng.pick(SKINS);
  const shirt = opts.shirt ?? rng.pick(SHIRTS);
  const pants = opts.pants ?? rng.pick(PANTS);
  const g = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.85 });
  const hairMat = new THREE.MeshStandardMaterial({ color: opts.hair ?? rng.pick([0x1a1a1a, 0x4a2a14, 0x6a6a6a, 0x8a5a2a]), roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 6, 12), shirtMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), skinMat);
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hair.position.y = 1.76;
  g.add(hair);
  if (opts.cap) {
    // Flat cap with a brim, the player signature.
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.29, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.8 }));
    capTop.position.y = 1.94;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.8 }));
    brim.position.set(0, 1.9, 0.3);
    g.add(capTop, brim);
  }
  if (opts.hat) {
    // Wide-brim hat for a third of pedestrians.
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.05, 14),
      new THREE.MeshStandardMaterial({ color: rng.pick([0x8a6a3a, 0x3a3a3a, 0xd8c8a0]), roughness: 0.9 }));
    brim.position.y = 1.9;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.2, 12), brim.material);
    crown.position.y = 2.0;
    g.add(brim, crown);
  }
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), shirtMat);
  armL.position.set(-0.46, 1.1, 0);
  const armR = armL.clone();
  armR.position.x = 0.46;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.55, 4, 8), pantsMat);
  legL.position.set(-0.17, 0.45, 0);
  const legR = legL.clone();
  legR.position.x = 0.17;
  g.add(armL, armR, legL, legR);
  g.userData.limbs = { armL, armR, legL, legR };
  g.userData.baseY = 0;
  g.scale.setScalar(scale);
  return g;
}

export function animateWalk(mesh, phase, amount) {
  const l = mesh.userData.limbs;
  if (!l) return;
  const s = Math.sin(phase) * amount;
  l.armL.rotation.x = s;
  l.armR.rotation.x = -s;
  l.legL.rotation.x = -s;
  l.legR.rotation.x = s;
}

// ROOK — the player character. A procedural street-style humanoid built
// only from primitives in this file: teal jacket, charcoal jeans, white
// sneakers, black cap worn backwards. No imported model, no copied asset —
// every vertex is drawn by this code, and the look is ours alone.
const ROOK = {
  jacket: 0x0fa38e, jeans: 0x232a33, sneaker: 0xf2f2f2, sole: 0x1a1d22,
  skin: 0xe8b88a, hair: 0x1a1a1a, cap: 0x14161a, capBrim: 0x0fa38e,
  shirt: 0xe8e8e8,
};

function stdMat(color, roughness = 0.8) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

// A jointed humanoid: hips group -> torso/head/arms, hip pivots -> thigh ->
// knee -> shin -> sneaker. Rotations are applied at the pivots, so a walk
// swing bends the body the way a real body bends. Local forward is +z.
export function makePlayerMesh() {
  const g = new THREE.Group();
  const jacket = stdMat(ROOK.jacket);
  const jeans = stdMat(ROOK.jeans, 0.85);
  const skin = stdMat(ROOK.skin, 0.7);
  const white = stdMat(ROOK.sneaker, 0.6);
  const dark = stdMat(ROOK.sole, 0.9);

  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };

  const hips = new THREE.Group();
  hips.position.y = 0.98;
  g.add(hips);
  hips.add(mesh(new THREE.BoxGeometry(0.44, 0.2, 0.28), jeans, 0, 0.02, 0));

  const torso = new THREE.Group();
  torso.position.y = 0.12;
  hips.add(torso);
  torso.add(mesh(new THREE.CapsuleGeometry(0.3, 0.42, 6, 12), jacket, 0, 0.36, 0));
  // White tee showing through the open jacket, and a collar.
  torso.add(mesh(new THREE.BoxGeometry(0.16, 0.42, 0.03), stdMat(ROOK.shirt), 0, 0.36, 0.29));
  torso.add(mesh(new THREE.BoxGeometry(0.4, 0.08, 0.3), stdMat(0x0b7a68), 0, 0.62, 0));

  const head = new THREE.Group();
  head.position.y = 0.82;
  torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.23, 16, 12), skin, 0, 0.1, 0));
  head.add(mesh(new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    stdMat(ROOK.hair, 0.95), 0, 0.13, 0));
  // Cap worn backwards: crown + brim pointing back (-z).
  head.add(mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.1, 14), stdMat(ROOK.cap), 0, 0.3, 0));
  head.add(mesh(new THREE.BoxGeometry(0.3, 0.035, 0.22), stdMat(ROOK.capBrim), 0, 0.27, -0.3));

  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.4 * side, 0.56, 0);
    torso.add(shoulder);
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.105, 0.3, 4, 8), jacket, 0, -0.2, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.42;
    shoulder.add(elbow);
    elbow.add(mesh(new THREE.CapsuleGeometry(0.09, 0.28, 4, 8), skin, 0, -0.17, 0));
    elbow.add(mesh(new THREE.SphereGeometry(0.105, 10, 8), skin, 0, -0.37, 0));
    return { shoulder, elbow };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.17 * side, -0.04, 0);
    hips.add(hip);
    hip.add(mesh(new THREE.CapsuleGeometry(0.13, 0.34, 4, 8), jeans, 0, -0.22, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);
    knee.add(mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), jeans, 0, -0.2, 0));
    knee.add(mesh(new THREE.BoxGeometry(0.17, 0.11, 0.34), white, 0, -0.44, 0.05));
    knee.add(mesh(new THREE.BoxGeometry(0.18, 0.05, 0.36), dark, 0, -0.5, 0.05));
    return { hip, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  g.userData.joints = {
    hips, torso, head,
    shoulderL: armL.shoulder, elbowL: armL.elbow,
    shoulderR: armR.shoulder, elbowR: armR.elbow,
    hipL: legL.hip, kneeL: legL.knee,
    hipR: legR.hip, kneeR: legR.knee,
  };
  g.userData.baseHipsY = hips.position.y;
  return g;
}

// Procedural animation state machine — the same idea as a keyframed
// character (idle / walk / run / jump / fall / hit, priority hit >
// airborne > grounded), but every pose is computed from the player's live
// state in this file: no animation clips, no mixer, no imported motion.
// Poses blend toward their target at ~12/s, the feel of a 0.18 s crossfade.
// Rotation sign: on a limb hanging down (-y), negative rotation.x swings it
// forward (+z), positive swings it back; elbow bend is negative rotation.x.
const POSE_KEYS = ['hipsY', 'torsoX', 'torsoY', 'headX',
  'shLx', 'shLz', 'elLx', 'shRx', 'shRz', 'elRx',
  'hipLx', 'kneeLx', 'hipRx', 'kneeRx'];

export class PlayerAnimator {
  constructor(mesh) {
    this.j = mesh.userData.joints;
    this.baseY = mesh.userData.baseHipsY || 0.98;
    this.state = 'idle';
    this.time = 0;
    this.cur = {};
    for (const k of POSE_KEYS) this.cur[k] = 0;
    this.cur.hipsY = this.baseY;
  }

  update(dt, s) {
    this.time += dt;
    const t = this.time;
    const p = s.phase || 0;
    let state = 'idle';
    if (s.hit > 0) state = 'hit';
    else if (!s.grounded) state = s.vy > 0.5 ? 'jump' : 'fall';
    else if (s.moving) state = s.sprinting ? 'run' : 'walk';
    this.state = state;

    const c = this.cur;
    const T = {};
    if (state === 'idle') {
      const b = Math.sin(t * 2.2);
      T.hipsY = this.baseY + b * 0.012;
      T.torsoX = 0.03 + b * 0.015; T.torsoY = 0; T.headX = 0.02;
      T.shLx = 0.08 + b * 0.02; T.shLz = 0.06; T.elLx = -0.18;
      T.shRx = 0.08 - b * 0.02; T.shRz = -0.06; T.elRx = -0.18;
      T.hipLx = 0; T.kneeLx = -0.05; T.hipRx = 0; T.kneeRx = -0.05;
    } else if (state === 'walk' || state === 'run') {
      const run = state === 'run';
      const A = run ? 0.95 : 0.55;
      const armA = run ? 0.7 : 0.45;
      const sw = Math.sin(p);
      T.hipLx = -sw * A; T.hipRx = sw * A;
      T.kneeLx = Math.max(0, -T.hipLx) * 1.1; T.kneeRx = Math.max(0, -T.hipRx) * 1.1;
      T.shLx = sw * armA; T.shRx = -sw * armA;
      T.shLz = 0.08; T.shRz = -0.08;
      T.elLx = run ? -0.95 : -0.3; T.elRx = run ? -0.95 : -0.3;
      T.torsoX = run ? 0.17 : 0.07; T.torsoY = 0; T.headX = 0.02;
      T.hipsY = this.baseY + Math.abs(Math.cos(p)) * (run ? 0.06 : 0.035);
    } else if (state === 'jump') {
      T.hipsY = this.baseY;
      T.hipLx = -0.85; T.kneeLx = 1.15; T.hipRx = -0.55; T.kneeRx = 0.9;
      T.shLx = -2.2; T.shLz = 0.25; T.elLx = -0.35;
      T.shRx = -2.2; T.shRz = -0.25; T.elRx = -0.35;
      T.torsoX = 0.06; T.torsoY = 0; T.headX = -0.05;
    } else if (state === 'fall') {
      T.hipsY = this.baseY;
      T.hipLx = -0.35; T.kneeLx = 0.55; T.hipRx = -0.25; T.kneeRx = 0.5;
      T.shLx = -0.5; T.shLz = -0.85; T.elLx = -0.4;
      T.shRx = -0.5; T.shRz = 0.85; T.elRx = -0.4;
      T.torsoX = 0.1; T.torsoY = 0; T.headX = 0;
    } else { // hit: flinch back, arms up defensively, quick decay
      T.hipsY = this.baseY - 0.03;
      T.torsoX = -0.28; T.torsoY = 0; T.headX = -0.18;
      T.shLx = -0.95; T.shLz = 0.3; T.elLx = -1.15;
      T.shRx = -0.95; T.shRz = -0.3; T.elRx = -1.15;
      T.hipLx = -0.15; T.kneeLx = 0.25; T.hipRx = -0.1; T.kneeRx = 0.25;
    }
    // Punch overlay: the right arm snaps forward on a sine envelope over
    // the 0.3 s punch, torso twisting with it.
    if (s.punch > 0) {
      const e = Math.sin(Math.PI * (1 - clamp01(s.punch / 0.3)));
      T.shRx = T.shRx + (-1.5 - T.shRx) * e;
      T.elRx = T.elRx + (-0.05 - T.elRx) * e;
      T.torsoY = -0.32 * e;
    }
    for (const k of POSE_KEYS) c[k] = damp(c[k], T[k], 12, dt);
    const j = this.j;
    j.hips.position.y = c.hipsY;
    j.torso.rotation.x = c.torsoX; j.torso.rotation.y = c.torsoY;
    j.head.rotation.x = c.headX;
    j.shoulderL.rotation.x = c.shLx; j.shoulderL.rotation.z = c.shLz;
    j.elbowL.rotation.x = c.elLx;
    j.shoulderR.rotation.x = c.shRx; j.shoulderR.rotation.z = c.shRz;
    j.elbowR.rotation.x = c.elRx;
    j.hipL.rotation.x = c.hipLx; j.kneeL.rotation.x = c.kneeLx;
    j.hipR.rotation.x = c.hipRx; j.kneeR.rotation.x = c.kneeRx;
  }
}

// Jump: Space on foot. Gravity 28 m/s^2, launch speed 9.5 — about a
// 1.6 m hop, enough to clear a hydrant, not a building.
export function tryJump(player) {
  if (!player.grounded || player.inCar) return false;
  player.vy = 9.5;
  player.grounded = false;
  return true;
}

export function updateJump(player, dt) {
  if (player.grounded) return;
  player.vy -= 28 * dt;
  player.y += player.vy * dt;
  if (player.y <= 0) {
    player.y = 0; player.vy = 0; player.grounded = true;
  }
}

export class Player {
  constructor(scene, x, z) {
    this.mesh = makePlayerMesh();
    scene.add(this.mesh);
    this.animator = new PlayerAnimator(this.mesh);
    this.x = x; this.z = z;
    this.y = 0;           // height above the ground (jump)
    this.vy = 0;
    this.grounded = true;
    this.heading = Math.PI; // facing the street
    this.speed = 0;
    this.walkPhase = 0;
    this.hp = 100;
    this.inCar = null; // Car instance or null
    this.punchCooldown = 0;
    this.punchAnim = 0;
    this.hitAnim = 0;    // flinch timer, set by damagePlayer
    this.moving = false;
    this.sprinting = false;
  }
  syncMesh() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.heading;
  }
}

// On-foot movement: WASD relative to the camera yaw, Shift sprints.
// Returns true if the player moved into a building (collision occurred).
export function movePlayer(player, input, camYaw, dt, colliders) {
  const sprint = input.sprint ? 1.7 : 1;
  const speed = 6.5 * sprint;
  let mx = 0, mz = 0;
  if (input.forward) { mx += -Math.sin(camYaw); mz += -Math.cos(camYaw); }
  if (input.back) { mx += Math.sin(camYaw); mz += Math.cos(camYaw); }
  if (input.left) { mx += -Math.cos(camYaw); mz += Math.sin(camYaw); }
  if (input.right) { mx += Math.cos(camYaw); mz += -Math.sin(camYaw); }
  const len = Math.hypot(mx, mz);
  player.punchCooldown = Math.max(0, player.punchCooldown - dt);
  player.punchAnim = Math.max(0, player.punchAnim - dt);
  player.hitAnim = Math.max(0, player.hitAnim - dt);
  player.moving = len > 0.01;
  player.sprinting = !!input.sprint && player.moving;
  if (len > 0.01) {
    mx /= len; mz /= len;
    player.heading = Math.atan2(mx, mz);
    const nx = player.x + mx * speed * dt;
    const nz = player.z + mz * speed * dt;
    const hit = resolveCircleColliders(nx, nz, 0.55, colliders);
    player.x = clamp(hit.x, -CITY_EDGE, CITY_EDGE);
    player.z = clamp(hit.z, -CITY_EDGE, CITY_EDGE);
    player.walkPhase += dt * speed * 1.6;
    player.syncMesh();
    // The animator reads the live state every frame, so the visible body
    // always matches what the player is actually doing.
    player.animator.update(dt, {
      moving: player.moving, sprinting: player.sprinting,
      grounded: player.grounded, vy: player.vy,
      hit: player.hitAnim, punch: player.punchAnim, phase: player.walkPhase,
    });
    return hit.collided;
  }
  player.animator.update(dt, {
    moving: false, sprinting: false,
    grounded: player.grounded, vy: player.vy,
    hit: player.hitAnim, punch: player.punchAnim, phase: player.walkPhase,
  });
  player.syncMesh();
  return false;
}

export class Pedestrian {
  constructor(scene, rng, x, z) {
    this.mesh = makePersonMesh({
      seed: rng.int(1, 99999),
      scale: rng.range(0.88, 1.15),
      hat: rng.chance(0.3),
    });
    this.mesh.scale.x *= rng.range(0.85, 1.25);
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = rng.range(0, Math.PI * 2);
    this.speed = rng.range(1.2, 2.4);
    this.walkPhase = rng.range(0, 6);
    this.alive = true;
    this.downTimer = 0;
    this.targetHeading = this.heading;
    this.retarget = rng.range(2, 8);
    this.fleeing = false;
    this.syncMesh();
  }
  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    this.mesh.visible = this.alive || this.downTimer > 0;
  }
}

// Pedestrians stroll along sidewalks, turn at intersections, and flee from
// the player after an assault or a gunshot nearby.
export function updatePedestrian(ped, dt, colliders, playerPos, danger) {
  if (!ped.alive) {
    ped.downTimer -= dt;
    if (ped.downTimer <= 0) ped.mesh.visible = false;
    return;
  }
  ped.retarget -= dt;
  if (danger && dist2D(ped.x, ped.z, playerPos.x, playerPos.z) < 14) ped.fleeing = true;
  if (ped.retarget <= 0) {
    ped.retarget = ped.fleeing ? 1.2 : 4 + Math.random() * 6;
    if (ped.fleeing) {
      // Run away from the player.
      ped.targetHeading = Math.atan2(playerPos.x - ped.x, playerPos.z - ped.z) + Math.PI;
    } else {
      // Prefer walking along a road axis.
      ped.targetHeading = Math.floor(Math.random() * 4) * (Math.PI / 2);
    }
  }
  const diff = wrapAngle(ped.targetHeading - ped.heading);
  ped.heading += clamp(diff, -2.4 * dt, 2.4 * dt);
  const sp = ped.fleeing ? ped.speed * 2.6 : ped.speed;
  const nx = ped.x + Math.sin(ped.heading) * sp * dt;
  const nz = ped.z + Math.cos(ped.heading) * sp * dt;
  const hit = resolveCircleColliders(nx, nz, 0.5, colliders);
  ped.x = clamp(hit.x, -CITY_EDGE, CITY_EDGE);
  ped.z = clamp(hit.z, -CITY_EDGE, CITY_EDGE);
  if (hit.collided) ped.targetHeading += Math.PI / 2;
  ped.walkPhase += dt * sp * 2.2;
  animateWalk(ped.mesh, ped.walkPhase, 0.55);
  ped.syncMesh();
}

export function spawnPedestrians(scene, rng, count = 48, center = null, roadCoords = null) {
  const peds = [];
  // Pedestrians walk in small groups of 2–3 on the sidewalks, so the
  // sidewalks feel lived in. Most groups gather near the player spawn
  // (the safehouse), the rest spread across the city, and every group
  // starts on a sidewalk slab walking along its road.
  const roads = roadCoords || [-240, -160, -80, 0, 80, 160, 240];
  while (peds.length < count) {
    // 3 in 5 groups spawn near the player spawn, the rest anywhere.
    const near = center ? weightedPick(rng, [center, null], [3, 2]) : null;
    const spot = sidewalkSpot(rng, roads, near, 170);
    const group = rng.int(2, 3);
    for (let k = 0; k < group && peds.length < count; k++) {
      const ped = new Pedestrian(scene, rng,
        spot.x + rng.range(-2, 2) + k * 1.6, spot.z + rng.range(-2, 2) + k * 1.2);
      ped.heading = spot.heading + rng.range(-0.2, 0.2);
      ped.targetHeading = ped.heading;
      peds.push(ped);
    }
  }
  return peds;
}

export class FootCop {
  constructor(scene, x, z) {
    this.mesh = makePersonMesh({ seed: 99, shirt: 0x1a2a4a, pants: 0x1a1d22, skin: 0xc98d5f, cap: true, scale: 1.05 });
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = 0;
    this.hp = 100;
    this.shootCooldown = 0;
    this.walkPhase = 0;
    this.alive = true;
    this.syncMesh();
  }
  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }
}

// A foot cop runs at the player and, within 26 m, fires every 1.3 s for 3 dmg.
export function updateFootCop(cop, dt, playerPos, colliders, onShoot) {
  if (!cop.alive) return 0;
  cop.shootCooldown = Math.max(0, cop.shootCooldown - dt);
  const d = dist2D(cop.x, cop.z, playerPos.x, playerPos.z);
  cop.heading = Math.atan2(playerPos.x - cop.x, playerPos.z - cop.z);
  if (d > 3) {
    const sp = 5.2;
    const nx = cop.x + Math.sin(cop.heading) * sp * dt;
    const nz = cop.z + Math.cos(cop.heading) * sp * dt;
    const hit = resolveCircleColliders(nx, nz, 0.5, colliders);
    cop.x = hit.x; cop.z = hit.z;
    cop.walkPhase += dt * sp * 2;
    animateWalk(cop.mesh, cop.walkPhase, 0.6);
  }
  cop.syncMesh();
  if (d < 26 && cop.shootCooldown <= 0) {
    cop.shootCooldown = 1.3;
    onShoot();
    return 3;
  }
  return 0;
}
