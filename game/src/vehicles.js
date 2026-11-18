// Vehicles for SOLMAR BAY: four body styles built from primitives, arcade
// driving physics, traffic that follows the road grid and turns at
// intersections, and police cars that patrol, chase and ram.
import * as THREE from 'three';
import { makeRng, clamp, lerp, wrapAngle, dist2D, approach, canvasTexture } from './util.js';
import { PITCH, ROAD_HALF, CITY_EDGE } from './city.js';

// Shared radial glow texture for headlight/taillight halos.
const glowTexture = canvasTexture(64, 64, (g) => {
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
});

// Night-driven car lights, updated by the game once per frame.
// {mat, base} sprite/beam opacities; {mat, day, night} light emissives.
const nightGlow = [];
const nightBeam = [];
const nightLamp = [];
export function updateCarNight(nightF) {
  for (const e of nightGlow) e.mat.opacity = nightF * e.base;
  for (const e of nightBeam) e.mat.opacity = nightF * e.base;
  for (const e of nightLamp) e.mat.emissiveIntensity = lerp(e.day, e.night, nightF);
}

const CAR_COLORS = [
  0xc23b2e, 0x2e6fc2, 0xd8a83c, 0x3fae6a, 0x7a4fc2, 0xd8d8d8,
  0x22262c, 0xc26a2e, 0x3dc4c0, 0x9a2e5a, 0x5a7a2e, 0xe0e0e0,
];
const TYPES = ['sedan', 'hatch', 'van', 'truck'];

// Build one car mesh. `type` picks the silhouette, `color` the paint.
// Wheels spin (returned in userData.wheels) and headlights/taillights glow.
export function makeCarMesh(type, color, isPolice = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: isPolice ? 0x1a1d22 : color, roughness: 0.35, metalness: 0.45,
  });
  const glass = new THREE.MeshStandardMaterial({ color: 0x141c26, roughness: 0.15, metalness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.4 });
  const len = type === 'truck' ? 5.6 : type === 'van' ? 5.0 : type === 'hatch' ? 3.9 : 4.6;
  const wid = type === 'truck' ? 2.3 : 2.0;
  const bodyH = type === 'van' ? 1.5 : 0.85;

  const body = new THREE.Mesh(new THREE.BoxGeometry(len, bodyH, wid), paint);
  body.position.y = 0.75;
  body.castShadow = true;
  g.add(body);
  // Sloped nose + tail via thin angled boxes so the silhouette is not a slab.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, wid * 0.96), paint);
  nose.position.set(len / 2 + 0.15, 0.62, 0);
  nose.rotation.z = -0.35;
  g.add(nose);
  // Cabin: sloped windshield and rear glass.
  const cabinLen = type === 'van' ? len * 0.62 : type === 'truck' ? 1.5 : len * 0.5;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinLen, 0.75, wid * 0.88), glass);
  cabin.position.set(type === 'truck' ? len / 2 - 1.1 : -len * 0.06, 1.5, 0);
  cabin.castShadow = true;
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(cabinLen * 0.9, 0.12, wid * 0.86), paint);
  roof.position.set(cabin.position.x, 1.92, 0);
  g.add(roof);
  if (type === 'truck') {
    // Open cargo bed with side walls.
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len * 0.42, 0.8, 0.14), paint);
      wall.position.set(-len * 0.22, 1.35, s * (wid / 2 - 0.07));
      g.add(wall);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, wid), paint);
    tail.position.set(-len / 2 + 0.1, 1.35, 0);
    g.add(tail);
  }
  // Chrome grille strip, bumpers, licence plates front and back.
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, wid * 0.7),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.9 }));
  grille.position.set(len / 2 + 0.48, 0.62, 0);
  g.add(grille);
  for (const s of [-1, 1]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, wid * 0.98), trim);
    bumper.position.set(s * (len / 2 + 0.42), 0.5, 0);
    g.add(bumper);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.4 }));
    plate.position.set(s * (len / 2 + 0.58), 0.62, 0);
    g.add(plate);
  }
  // Emissive headlights (front) and taillights (rear).
  const headMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2c0, emissiveIntensity: 0.7 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2a22, emissiveIntensity: 0.6 });
  nightLamp.push({ mat: headMat, day: 0.7, night: 2.6 }, { mat: tailMat, day: 0.6, night: 2.2 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.42), headMat);
    h.position.set(len / 2 + 0.5, 0.85, s * (wid / 2 - 0.45));
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.42), tailMat);
    t.position.set(-len / 2 - 0.5, 0.85, s * (wid / 2 - 0.45));
    g.add(t);
  }
  // Headlight halos + a light cone on the road ahead, and taillight halos.
  // Opacity is driven by updateCarNight(nightF) from game.js.
  for (const s of [-1, 1]) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xfff2c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(2.4, 2.4, 1);
    halo.position.set(len / 2 + 0.55, 0.85, s * (wid / 2 - 0.45));
    g.add(halo);
    nightGlow.push({ mat: halo.material, base: 0.85 });
    const tail = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xff2a22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    tail.scale.set(1.5, 1.5, 1);
    tail.position.set(-len / 2 - 0.55, 0.85, s * (wid / 2 - 0.45));
    g.add(tail);
    nightGlow.push({ mat: tail.material, base: 0.7 });
  }
  // Beam cone: apex at the headlights, widening 12 m down the road.
  // ConeGeometry's apex is +Y; rotation.z = +90° maps +Y to -X, so with the
  // cone centred at len/2 + 6 the apex sits at the car's nose.
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 12, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.z = Math.PI / 2 - 0.1;
  beam.position.set(len / 2 + 6, 1.0, 0);
  g.add(beam);
  nightBeam.push({ mat: beam.material, base: 0.06 });
  if (isPolice) {
    // Light bar + POLICE door stripe.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    bar.position.set(-0.1, 2.05, 0);
    g.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 2 }));
    red.position.set(-0.32, 2.2, 0);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x000033, emissive: 0x2266ff, emissiveIntensity: 2 }));
    blue.position.set(0.12, 2.2, 0);
    g.add(red, blue);
    g.userData.policeLights = [red.material, blue.material];
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.7, 0.5, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    stripe.position.set(-0.1, 0.95, wid / 2 + 0.01);
    g.add(stripe);
    const stripe2 = stripe.clone();
    stripe2.position.z = -wid / 2 - 0.01;
    g.add(stripe2);
  }
  // Wheels: tire + hubcap + spoke bar, half-torus wheel arches.
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 14);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.8 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, tireMat);
      tire.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10), hubMat);
      hub.rotation.x = Math.PI / 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.36),
        new THREE.MeshStandardMaterial({ color: 0x666a70, roughness: 0.4, metalness: 0.6 }));
      wheel.add(tire, hub, spoke);
      wheel.position.set(sx * (len / 2 - 0.85), 0.42, sz * (wid / 2 - 0.05));
      g.add(wheel);
      wheels.push(wheel);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 12, Math.PI), paint);
      arch.position.set(sx * (len / 2 - 0.85), 0.55, sz * (wid / 2));
      arch.rotation.y = sz > 0 ? 0 : Math.PI;
      g.add(arch);
    }
  }
  g.userData.wheels = wheels;
  g.userData.len = len;
  g.userData.wid = wid;
  return g;
}

export class Car {
  constructor(mesh, x, z, heading, opts = {}) {
    this.mesh = mesh;
    this.x = x; this.z = z;
    this.heading = heading; // radians, 0 = +x
    this.speed = 0;
    this.steer = 0;
    this.kind = opts.kind || 'parked'; // parked | traffic | police | player
    this.color = opts.color || 0x888888;
    this.len = mesh.userData.len;
    this.axis = opts.axis || 'x'; // traffic axis
    this.dir = opts.dir || 1;
    this.lane = opts.lane || 4; // lane offset from road centre
    this.cruise = opts.cruise || 9;
    this.turnAt = null;
    this.crashCooldown = 0;
    this.condition = 100; // vehicle condition 100–0; wear slows the car, 0 stalls it
    this.condCleanT = 0;  // seconds since the last damage (recovery window)
    this.sirenPhase = Math.random() * 10;
    this.stuckTimer = 0;
  }
  get pos() { return { x: this.x, z: this.z }; }
  forward() { return { x: Math.cos(this.heading), z: -Math.sin(this.heading) }; }
  syncMesh(dt = 1 / 60) {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // Wheel spin scales with real time, not with the frame count, so the
    // wheels turn at the same speed on a 30 fps laptop and a 144 Hz one.
    const spin = this.speed * 3.6 * dt;
    for (const w of this.mesh.userData.wheels) w.rotation.z += spin;
  }
}

// Arcade driving: W accelerates, S brakes/reverses, A/D steer (speed-scaled),
// Space is the handbrake. Vehicle condition scales the car: a worn car is
// slower and lazier to steer; at 0 the car stalls and cannot drive.
// Returns nothing; mutates the car.
export function drivePlayerCar(car, input, dt, colliders) {
  const cond = car.condition == null ? 100 : car.condition;
  const stalled = cond <= 0;
  const condF = stalled ? 0 : 0.35 + 0.65 * (cond / 100);
  const accel = (input.forward ? 22 : 0) * (stalled ? 0 : 0.5 + 0.5 * (cond / 100));
  const brake = input.back ? 26 : 0;
  const maxSpeed = 34 * condF;
  const maxReverse = 10 * condF;
  if (input.forward) car.speed += accel * dt;
  if (input.back) {
    if (car.speed > 0.5) car.speed -= brake * dt;
    else car.speed -= 12 * dt;
  }
  if (!input.forward && !input.back) {
    car.speed = approach(car.speed, 0, 10 * dt);
  }
  if (input.handbrake) car.speed = approach(car.speed, 0, 40 * dt);
  if (stalled) car.speed = approach(car.speed, 0, 30 * dt);
  car.speed = clamp(car.speed, -maxReverse, maxSpeed);
  const steerTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const steerMax = 0.55 * clamp(1 - Math.abs(car.speed) / 40, 0.35, 1) * (stalled ? 0 : 0.6 + 0.4 * (cond / 100));
  car.steer = approach(car.steer, steerTarget * steerMax, 3.2 * dt);
  const turnRate = car.steer * clamp(Math.abs(car.speed) / 6, 0, 1.6);
  car.heading += turnRate * dt * Math.sign(car.speed || 1);
  const f = car.forward();
  let nx = car.x + f.x * car.speed * dt;
  let nz = car.z + f.z * car.speed * dt;
  // Soft city-edge bounce and building collision (circle vs AABB).
  nx = clamp(nx, -CITY_EDGE, CITY_EDGE);
  nz = clamp(nz, -CITY_EDGE, CITY_EDGE);
  const hit = resolveCircleColliders(nx, nz, 1.6, colliders);
  if (hit.collided) {
    car.speed *= 0.45;
    nx = hit.x; nz = hit.z;
  }
  car.x = nx; car.z = nz;
  car.crashCooldown = Math.max(0, car.crashCooldown - dt);
  car.syncMesh(dt);
  return hit.collided;
}

// Circle-vs-AABB resolve: pushes the circle out of any overlapping box.
export function resolveCircleColliders(x, z, r, colliders) {
  let collided = false;
  for (const c of colliders) {
    const cx = clamp(x, c.minX, c.maxX);
    const cz = clamp(z, c.minZ, c.maxZ);
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      collided = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const pl = x - c.minX, pr = c.maxX - x, pt = z - c.minZ, pb = c.maxZ - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.minX - r;
        else if (m === pr) x = c.maxX + r;
        else if (m === pt) z = c.minZ - r;
        else z = c.maxZ + r;
      }
    }
  }
  return { x, z, collided };
}

export function pointInColliders(x, z, colliders) {
  for (const c of colliders) {
    if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
  }
  return false;
}

// Flash a police car's light bar. Shared by the chase and the patrol
// paths so a patrolling police car flashes too, not just a chasing one.
function flashPoliceLights(car, dt) {
  if (!car.mesh.userData.policeLights) return;
  const [r, b] = car.mesh.userData.policeLights;
  const ph = (car.sirenPhase += dt * 6) % 2;
  r.emissiveIntensity = ph < 1 ? 2.4 : 0.15;
  b.emissiveIntensity = ph < 1 ? 0.15 : 2.4;
}

// Traffic: each car follows its road lane; at intersections it may turn
// (35%) or keep going; at the city edge it U-turns instead of teleporting.
export function updateTraffic(car, dt, others, colliders) {
  car.speed = approach(car.speed, car.cruise, 6 * dt);
  const f = car.forward();
  let nx = car.x + f.x * car.speed * dt;
  let nz = car.z + f.z * car.speed * dt;
  // Slow for a car ahead on the same lane.
  for (const o of others) {
    if (o === car) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    const ahead = dx * f.x + dz * f.z;
    const side = Math.abs(dx * -f.z + dz * f.x);
    if (ahead > 0 && ahead < 9 && side < 2.6) {
      car.speed = Math.min(car.speed, Math.max(0, o.speed - 2));
      nx = car.x + f.x * car.speed * dt;
      nz = car.z + f.z * car.speed * dt;
      break;
    }
  }
  // Intersection decision: nearest road coordinate on the moving axis.
  const along = car.axis === 'x' ? nx : nz;
  const roadIdx = Math.round(along / PITCH) * PITCH;
  if (Math.abs(along - roadIdx) < 1.2 && car.turnAt !== roadIdx) {
    car.turnAt = roadIdx;
    const cross = car.axis === 'x' ? nz : nx;
    const crossRoad = Math.abs(cross - Math.round(cross / PITCH) * PITCH) < ROAD_HALF + 2;
    if (crossRoad && Math.random() < 0.35) {
      // Turn onto the crossing road.
      const newAxis = car.axis === 'x' ? 'z' : 'x';
      const newDir = Math.random() < 0.5 ? 1 : -1;
      car.axis = newAxis;
      car.dir = newDir;
      car.heading = newAxis === 'x'
        ? (newDir > 0 ? 0 : Math.PI)
        : (newDir > 0 ? -Math.PI / 2 : Math.PI / 2);
      // Snap onto the new lane.
      if (newAxis === 'x') { car.z = roadIdx + (newDir > 0 ? -car.lane : car.lane); }
      else { car.x = roadIdx + (newDir > 0 ? car.lane : -car.lane); }
      nx = car.x; nz = car.z;
    }
  }
  // U-turn at the city edge.
  if (Math.abs(nx) > CITY_EDGE - 4 || Math.abs(nz) > CITY_EDGE - 4) {
    car.dir *= -1;
    car.heading = wrapAngle(car.heading + Math.PI);
    car.turnAt = null;
    nx = clamp(nx, -CITY_EDGE + 6, CITY_EDGE - 6);
    nz = clamp(nz, -CITY_EDGE + 6, CITY_EDGE - 6);
  }
  const hit = resolveCircleColliders(nx, nz, 1.6, colliders);
  car.x = hit.x; car.z = hit.z;
  if (hit.collided) car.speed *= 0.5;
  flashPoliceLights(car, dt);
  car.syncMesh(dt);
}

// Police chase: steer toward the target, ram at close range, give up and
// wander if the target is far away. Returns distance to target.
export function updatePoliceCar(car, target, dt, colliders) {
  const d = dist2D(car.x, car.z, target.x, target.z);
  const wantHeading = Math.atan2(-(target.z - car.z), target.x - car.x);
  const diff = wrapAngle(wantHeading - car.heading);
  car.heading += clamp(diff, -1.9 * dt, 1.9 * dt);
  const targetSpeed = d > 6 ? 30 : 18;
  car.speed = approach(car.speed, targetSpeed, 14 * dt);
  const f = car.forward();
  let nx = car.x + f.x * car.speed * dt;
  let nz = car.z + f.z * car.speed * dt;
  nx = clamp(nx, -CITY_EDGE, CITY_EDGE);
  nz = clamp(nz, -CITY_EDGE, CITY_EDGE);
  const hit = resolveCircleColliders(nx, nz, 1.6, colliders);
  car.x = hit.x; car.z = hit.z;
  if (hit.collided) car.speed *= 0.5;
  car.crashCooldown = Math.max(0, car.crashCooldown - dt);
  flashPoliceLights(car, dt);
  car.syncMesh(dt);
  return d;
}

export function spawnTrafficCars(scene, rng, colliders, count = 14) {
  const cars = [];
  const roads = [];
  for (let k = -3; k <= 3; k++) roads.push(k * PITCH);
  for (let i = 0; i < count; i++) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const road = rng.pick(roads);
    const along = rng.range(-CITY_EDGE + 20, CITY_EDGE - 20);
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane = 4;
    const x = axis === 'x' ? along : road + (dir > 0 ? lane : -lane);
    const z = axis === 'x' ? road + (dir > 0 ? -lane : lane) : along;
    const heading = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    const mesh = makeCarMesh(rng.pick(TYPES), rng.pick(CAR_COLORS));
    scene.add(mesh);
    const car = new Car(mesh, x, z, heading, {
      kind: 'traffic', axis, dir, lane, cruise: rng.range(7, 11),
    });
    car.speed = car.cruise;
    car.syncMesh();
    cars.push(car);
  }
  return cars;
}

export function spawnParkedCars(scene, rng, count = 12) {
  const cars = [];
  const roads = [];
  for (let k = -3; k <= 3; k++) roads.push(k * PITCH);
  for (let i = 0; i < count; i++) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const road = rng.pick(roads);
    const along = rng.range(-CITY_EDGE + 30, CITY_EDGE - 30);
    const side = rng.chance(0.5) ? 1 : -1;
    const x = axis === 'x' ? along : road + side * (ROAD_HALF - 1.5);
    const z = axis === 'x' ? road + side * (ROAD_HALF - 1.5) : along;
    const heading = axis === 'x' ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    const mesh = makeCarMesh(rng.pick(TYPES), rng.pick(CAR_COLORS));
    scene.add(mesh);
    const car = new Car(mesh, x, z, heading, { kind: 'parked', axis, dir: 1 });
    car.syncMesh();
    cars.push(car);
  }
  return cars;
}

export function makePoliceCar(scene, x, z) {
  const mesh = makeCarMesh('sedan', 0x1a1d22, true);
  scene.add(mesh);
  const car = new Car(mesh, x, z, 0, { kind: 'police', cruise: 30 });
  car.syncMesh();
  return car;
}
