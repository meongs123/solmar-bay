// People of SOLMAR BAY: the player on foot, wandering pedestrians and the
// foot cops who appear at high wanted levels. Characters are built from
// capsules and spheres — no cube people — with varied height, build, skin
// tone and hats.
import * as THREE from 'three';
import { makeRng, clamp, wrapAngle, dist2D, approach } from './util.js';
import { PITCH, CITY_EDGE } from './city.js';
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

export class Player {
  constructor(scene, x, z) {
    this.mesh = makePersonMesh({ seed: 7, shirt: 0xc23b2e, skin: 0xe8b88a, cap: true, scale: 1.02 });
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = Math.PI; // facing the street
    this.speed = 0;
    this.walkPhase = 0;
    this.hp = 100;
    this.inCar = null; // Car instance or null
    this.punchCooldown = 0;
    this.punchAnim = 0;
  }
  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
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
  if (len > 0.01) {
    mx /= len; mz /= len;
    player.heading = Math.atan2(mx, mz);
    const nx = player.x + mx * speed * dt;
    const nz = player.z + mz * speed * dt;
    const hit = resolveCircleColliders(nx, nz, 0.55, colliders);
    player.x = clamp(hit.x, -CITY_EDGE, CITY_EDGE);
    player.z = clamp(hit.z, -CITY_EDGE, CITY_EDGE);
    player.walkPhase += dt * speed * 1.6;
    animateWalk(player.mesh, player.walkPhase, 0.7);
    player.syncMesh();
    return hit.collided;
  }
  animateWalk(player.mesh, player.walkPhase, 0);
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

export function spawnPedestrians(scene, rng, count = 44) {
  const peds = [];
  // Pedestrians walk in small groups of 2–3 so the sidewalks feel lived in.
  while (peds.length < count) {
    const bx = rng.int(-3, 2), bz = rng.int(-3, 2);
    const cx = (bx + 0.5) * PITCH, cz = (bz + 0.5) * PITCH;
    const edge = rng.pick(['n', 's', 'e', 'w']);
    let x = cx, z = cz;
    if (edge === 'n') z = cz - 33;
    if (edge === 's') z = cz + 33;
    if (edge === 'e') x = cx + 33;
    if (edge === 'w') x = cx - 33;
    const group = rng.int(1, 3);
    const heading = rng.range(0, Math.PI * 2);
    for (let k = 0; k < group && peds.length < count; k++) {
      const ped = new Pedestrian(scene, rng,
        x + rng.range(-4, 4) + k * 1.6, z + rng.range(-4, 4) + k * 1.2);
      ped.heading = heading;
      ped.targetHeading = heading;
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
