// SOLMAR BAY city generator. A deterministic 7x7 road grid (pitch 80, roads
// 16 wide) filled with procedural buildings, storefronts, lamps, trees,
// hydrants and traffic lights. Nothing is loaded from disk: facades and the
// ground are painted onto canvas textures at runtime. All colliders are
// axis-aligned boxes, shared with the player, cars and bullets.
import * as THREE from 'three';
import { makeRng, canvasTexture, lerp } from './util.js';

export const PITCH = 80;
export const ROAD_HALF = 8;
export const GRID_N = 3; // roads at -3..3 * PITCH, city spans about +/-280
export const CITY_EDGE = GRID_N * PITCH + ROAD_HALF + 34;

const FACADE_COLORS = [
  0x8a7a68, 0x7d7468, 0x9a8a74, 0x6f7a80, 0x84705a, 0x93806a,
  0x75685c, 0x8c7f70, 0x6a6f75, 0xa08a6a, 0x7a6a5c, 0x8f8578,
];
const ROOF_COLORS = [0x4a4642, 0x55504a, 0x3f3d3a, 0x5a5248];
const SHOP_NAMES = [
  'ROOKS', 'MARAS', 'NOODLE BAR', 'TACO JOINT', 'BAY 24', 'SOLMAR DELI',
  'PIER 9', 'LAUNDRY', 'DONUT STOP', 'FISH & CO', 'BAR NEON', 'GYM IRON',
  'NEON MOTEL', 'CYBER CAFE', 'RAMEN 24', 'VINYL', 'ARCADE', 'BODEGA',
  'SUSHI GO', 'PIZZA NOVA', 'HOTEL LUNA', 'CLUB VOLT', 'TACOS EL SOL', 'KARAOKE',
];
const SHOP_COLORS = [0xd94f3d, 0x3d9ad9, 0xe0a83c, 0x4fc46a, 0xc65fd9, 0x3dc4c0];
const NEON_COLORS = [0xff5fd0, 0x35e0ff, 0x9d6bff, 0x52ff9e, 0xffb020, 0xff3d5a];

function facadeTexture(rng, base, variant) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#' + base.toString(16).padStart(6, '0');
    g.fillRect(0, 0, w, h);
    // Grime: speckles, stains and vertical dirt streaks.
    for (let i = 0; i < 420; i++) {
      g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
      g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 3), rng.range(1, 3));
    }
    for (let i = 0; i < 7; i++) {
      g.fillStyle = 'rgba(0,0,0,0.10)';
      const x = rng.range(0, w);
      g.fillRect(x, rng.range(0, h * 0.4), rng.range(2, 6), rng.range(30, 120));
    }
    // Brick hint on some variants: faint horizontal courses.
    if (variant === 1 || variant === 4) {
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1;
      for (let y = 8; y < h; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }
    // Framed windows in a grid; some lit warm, most dark glass.
    const cols = 4 + (variant % 3);
    const rows = 7 + (variant % 3);
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.18, y = r * ch + ch * 0.2;
        const ww = cw * 0.64, wh = ch * 0.55;
        g.fillStyle = '#20242a';
        g.fillRect(x - 2, y - 2, ww + 4, wh + 4); // dark frame
        const lit = rng.chance(0.5);
        g.fillStyle = lit
          ? (rng.chance(0.55) ? '#ffd98a' : rng.chance(0.7) ? '#9fd8ff' : rng.chance(0.5) ? '#ff9de2' : '#7df9ff')
          : '#2c3540';
        g.fillRect(x, y, ww, wh);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + ww / 2 - 1, y, 2, wh); // mullion
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(x, y + wh - 3, ww, 3); // sill
        // Facade AC unit under some windows.
        if (rng.chance(0.14)) {
          g.fillStyle = '#3a3f45';
          g.fillRect(x + 2, y + wh + 4, ww * 0.6, 6);
        }
      }
    }
    // Fire-escape hint on variant 4.
    if (variant === 4) {
      g.strokeStyle = 'rgba(20,20,24,0.8)';
      g.lineWidth = 3;
      for (let y = 20; y < h; y += 46) {
        g.strokeRect(6, y, w - 12, 12);
        g.beginPath(); g.moveTo(6, y + 12); g.lineTo(w - 6, y); g.stroke();
      }
    }
  });
}

function groundTexture(rng) {
  return canvasTexture(1024, 1024, (g, w, h) => {
    // Base asphalt.
    g.fillStyle = '#33363b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.04)';
      g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 4), rng.range(1, 4));
    }
    // Dark asphalt patches and manholes.
    for (let i = 0; i < 26; i++) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.ellipse(rng.range(0, w), rng.range(0, h), rng.range(12, 34), rng.range(8, 22), rng.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = rng.range(0, w), y = rng.range(0, h);
      g.fillStyle = '#24262a';
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#4a4e55'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
    }
    // Sidewalk slabs: the ground plane is drawn block by block in world
    // space, so the texture also carries sidewalk joints as a grid.
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke();
    }
  });
}

function signTexture(name, color) {
  const hex = '#' + color.toString(16).padStart(6, '0');
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, w, h);
    // Neon tube: a blurred glow pass, then a crisp pass, then a white-hot
    // core so the sign reads as a lit tube rather than a painted board.
    g.shadowColor = hex;
    g.shadowBlur = 16;
    g.strokeStyle = hex;
    g.lineWidth = 4;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = hex;
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, w / 2, h / 2 + 1);
    g.fillText(name, w / 2, h / 2 + 1);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.fillText(name, w / 2, h / 2 + 1);
  });
}

// Soft radial glow sprite texture, shared by lamp halos, neon halos and
// headlights. One canvas, reused everywhere.
const glowTexture = canvasTexture(128, 128, (g, w, h) => {
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
});

export function buildCity(scene, seed = 1337) {
  const rng = makeRng(seed);
  const city = {
    colliders: [],           // {minX,maxX,minZ,maxZ}
    roadCoords: [],          // road centre lines, for traffic + police spawn
    storeSpots: [],          // {x,z,angle,name} robbery targets
    pickupSpots: [],         // pistol pickups
    safehouse: { x: 0, z: 0 },
    garage: { x: 0, z: 0 },
    safehouseTarget: { x: 0, z: 0 },
    garageTarget: { x: 0, z: 0 },
    windowMats: [],          // emissive materials lit at night
    lampGlows: [],          // {mat, base} lamp pools + halos, faded in at night
    neonHalos: [],          // {mat, base} neon sign halos, faded in at night
    nightSky: null,         // {starMat, moonMat, moonGlowMat} set by buildCity
    trafficLights: [],       // {group, mats:[r,y,g], phase}
    spawn: { x: 0, z: 40 },
  };
  for (let k = -GRID_N; k <= GRID_N; k++) city.roadCoords.push(k * PITCH);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_EDGE * 2 + 200, CITY_EDGE * 2 + 200),
    new THREE.MeshStandardMaterial({ map: groundTexture(rng), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Sidewalk slabs around every block, slightly raised and lighter.
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.9 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.9 });
  const blockSize = PITCH - ROAD_HALF * 2; // 64
  for (let bx = -GRID_N; bx < GRID_N; bx++) {
    for (let bz = -GRID_N; bz < GRID_N; bz++) {
      const cx = (bx + 0.5) * PITCH, cz = (bz + 0.5) * PITCH;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(blockSize + 2, 0.3, blockSize + 2), slabMat);
      slab.position.set(cx, 0.15, cz);
      slab.receiveShadow = true;
      scene.add(slab);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(blockSize + 4, 0.32, blockSize + 4), curbMat);
      curb.position.set(cx, 0.12, cz);
      scene.add(curb);
    }
  }

  // Road markings: dashed centre lines along every road.
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c95a });
  const dashGeo = new THREE.BoxGeometry(4, 0.06, 0.6);
  for (const rc of city.roadCoords) {
    for (let t = -CITY_EDGE; t < CITY_EDGE; t += 12) {
      const d1 = new THREE.Mesh(dashGeo, dashMat);
      d1.position.set(t, 0.06, rc);
      scene.add(d1);
      const d2 = new THREE.Mesh(dashGeo, dashMat);
      d2.rotation.y = Math.PI / 2;
      d2.position.set(rc, 0.06, t);
      scene.add(d2);
    }
  }

  // Buildings: one to three per block, stepped setbacks, roof props.
  const facadeMats = [];
  for (let v = 0; v < 5; v++) {
    const base = FACADE_COLORS[v * 2];
    const tex = facadeTexture(rng, base, v);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
    facadeMats.push(mat);
    city.windowMats.push(mat);
  }
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4642, roughness: 0.95 });
  const winGlowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffc46a, emissiveIntensity: 0.0 });

  function addBuilding(x, z, w, d, hgt, variant) {
    const group = new THREE.Group();
    const mat = facadeMats[variant % facadeMats.length];
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat);
    base.position.y = hgt / 2 + 0.3;
    base.castShadow = true; base.receiveShadow = true;
    group.add(base);
    // Setback upper slab, offset to one side so the skyline is not flat.
    if (hgt > 22) {
      const up = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.62, hgt * 0.32, d * 0.62),
        new THREE.MeshStandardMaterial({ color: FACADE_COLORS[(variant + 3) % FACADE_COLORS.length], roughness: 0.85 }),
      );
      up.position.set(w * 0.12, hgt + hgt * 0.16 + 0.3, -d * 0.1);
      up.castShadow = true;
      group.add(up);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.66, 0.8, d * 0.66), roofMat);
      cap.position.set(w * 0.12, hgt * 1.32 + 0.3, -d * 0.1);
      group.add(cap);
    }
    // Roof props: water tower on tall buildings, AC boxes, antennae.
    if (hgt > 26 && rng.chance(0.6)) {
      const tower = new THREE.Group();
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 10),
        new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.9 }));
      tank.position.y = 3.4;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.6, 10),
        new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 }));
      cone.position.y = 6.2;
      tower.add(tank, cone);
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 6), roofMat);
        const a = (i / 4) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 1.6, 1.1, Math.sin(a) * 1.6);
        tower.add(leg);
      }
      tower.position.set(-w * 0.22, hgt + 0.3, d * 0.18);
      group.add(tower);
    }
    if (rng.chance(0.7)) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6, metalness: 0.4 }));
      ac.position.set(w * 0.25, hgt + 0.85, d * 0.2);
      group.add(ac);
    }
    if (rng.chance(0.4)) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7, 6), roofMat);
      ant.position.set(w * 0.3, hgt + 3.5, -d * 0.25);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      tip.position.set(w * 0.3, hgt + 7, -d * 0.25);
      group.add(ant, tip);
    }
    // Neon edge strip: a glowing vertical tube on one front corner so the
    // skyline reads at night. MeshBasicMaterial is unlit — always bright.
    if (rng.chance(0.5)) {
      const neon = NEON_COLORS[rng.int(0, NEON_COLORS.length - 1)];
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, hgt * 0.72, 0.22),
        new THREE.MeshBasicMaterial({ color: neon }));
      strip.position.set((rng.chance(0.5) ? 1 : -1) * (w / 2 - 0.12), hgt * 0.36 + 0.3, d / 2 + 0.12);
      group.add(strip);
    }
    group.position.set(x, 0, z);
    scene.add(group);
    city.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return group;
  }

  // Storefronts: glowing shopfront + awning + neon sign on the ground floor.
  function addStorefront(x, z, w, facing, name, color) {
    const g = new THREE.Group();
    const front = new THREE.Mesh(new THREE.BoxGeometry(w, 4.4, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.4, metalness: 0.3 }));
    front.position.y = 2.5;
    g.add(front);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 2.6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.1, metalness: 0.7, emissive: 0xffc98a, emissiveIntensity: 0.4 }));
    glass.position.set(0, 2.2, 0.7);
    g.add(glass);
    // The shop window glows with the rest of the city at night.
    city.windowMats.push(glass.material);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.25, 2.6),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
    awning.position.set(0, 4.9, 1.1);
    awning.rotation.x = 0.25;
    g.add(awning);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 2.2),
      new THREE.MeshStandardMaterial({
        map: signTexture(name, color), emissive: 0xffffff, emissiveMap: signTexture(name, color), emissiveIntensity: 0.15,
      }));
    sign.position.set(0, 6.4, 0.75);
    g.add(sign);
    // Neon tube under the sign (unlit material: always full colour) plus
    // a soft halo sprite that fades in at night.
    const tube = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.16, 0.16),
      new THREE.MeshBasicMaterial({ color }));
    tube.position.set(0, 7.8, 0.75);
    g.add(tube);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(w * 1.7, 5, 1);
    halo.position.set(0, 6.4, 1.4);
    g.add(halo);
    city.neonHalos.push({ mat: halo.material, base: 0.55 });
    city.windowMats.push(sign.material);
    g.position.set(x, 0.3, z);
    g.rotation.y = facing;
    scene.add(g);
    city.storeSpots.push({ x, z, angle: facing, name });
  }

  let shopIdx = 0;
  for (let bx = -GRID_N; bx < GRID_N; bx++) {
    for (let bz = -GRID_N; bz < GRID_N; bz++) {
      const cx = (bx + 0.5) * PITCH, cz = (bz + 0.5) * PITCH;
      const isSafehouseBlock = bx === 0 && bz === 0;
      const isGarageBlock = bx === 1 && bz === 0;
      if (isSafehouseBlock || isGarageBlock) {
        // Landmark blocks keep one small building on the north side only.
        // The landmark house sits at the south edge; the mission target is
        // the curb on the road just south of it, reachable by car and foot.
        const target = { x: cx, z: cz + 24 };
        if (isSafehouseBlock) {
          city.safehouse = target;
          city.safehouseTarget = { x: cx, z: cz + 40 };
        } else {
          city.garage = target;
          city.garageTarget = { x: cx, z: cz + 40 };
        }
        addBuilding(cx, cz - 18, 20, 18, rng.range(12, 20), rng.int(0, 4));
        continue;
      }
      const n = rng.int(1, 3);
      if (n === 1) {
        const hgt = rng.range(18, 46);
        addBuilding(cx, cz, blockSize * rng.range(0.55, 0.8), blockSize * rng.range(0.55, 0.8), hgt, rng.int(0, 4));
      } else {
        // Split the block into two or three buildings along x.
        const slots = n === 2 ? [-blockSize / 4, blockSize / 4] : [-blockSize / 3, 0, blockSize / 3];
        for (const off of slots) {
          const hgt = rng.range(12, 40);
          addBuilding(cx + off, cz + rng.range(-4, 4), blockSize / n * 0.82, blockSize * rng.range(0.5, 0.75), hgt, rng.int(0, 4));
        }
      }
      // A storefront on the block edge facing the nearest road.
      if (shopIdx < SHOP_NAMES.length && rng.chance(0.85)) {
        const side = rng.pick(['n', 's', 'e', 'w']);
        const name = SHOP_NAMES[shopIdx];
        const color = SHOP_COLORS[shopIdx % SHOP_COLORS.length];
        shopIdx++;
        if (side === 's') addStorefront(cx, cz + blockSize / 2 + 0.4, 14, 0, name, color);
        if (side === 'n') addStorefront(cx, cz - blockSize / 2 - 0.4, 14, Math.PI, name, color);
        if (side === 'e') addStorefront(cx + blockSize / 2 + 0.4, cz, 14, -Math.PI / 2, name, color);
        if (side === 'w') addStorefront(cx - blockSize / 2 - 0.4, cz, 14, Math.PI / 2, name, color);
      }
    }
  }

  // Safehouse: a low house with a warm porch light + garage marker.
  function landmark(x, z, color, label) {
    const g = new THREE.Group();
    const house = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 10),
      new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 }));
    house.position.y = 3.8;
    house.castShadow = true;
    g.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x5a3a28, roughness: 0.9 }));
    roof.position.y = 9; roof.rotation.y = Math.PI / 4;
    g.add(roof);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x332211, emissive: color, emissiveIntensity: 1.2 }));
    lamp.position.set(0, 5.4, 5.4);
    g.add(lamp);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 26, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22 }));
    beacon.position.y = 16;
    g.add(beacon);
    g.position.set(x, 0.3, z);
    scene.add(g);
    city.colliders.push({ minX: x - 6, maxX: x + 6, minZ: z - 5, maxZ: z + 5 });
    return g;
  }
  landmark(city.safehouse.x, city.safehouse.z, 0xffc46a, 'safehouse');
  landmark(city.garage.x, city.garage.z, 0x4fc46a, 'garage');

  // Street props: lamps, trees, hydrants, traffic lights.
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.5 });
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffe9b0, emissiveIntensity: 0 });
  city.windowMats.push(lampHeadMat);
  for (let bx = -GRID_N; bx <= GRID_N; bx++) {
    for (let bz = -GRID_N; bz <= GRID_N; bz++) {
      const x = bx * PITCH, z = bz * PITCH;
      if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) continue;
      // Lamp at one corner of each intersection.
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 7, 8), lampPoleMat);
      pole.position.y = 3.5;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.18), lampPoleMat);
      arm.position.set(1.2, 6.9, 0);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.5), lampHeadMat);
      head.position.set(2.4, 6.8, 0);
      lamp.add(pole, arm, head);
      lamp.position.set(x + ROAD_HALF + 1.5, 0, z + ROAD_HALF + 1.5);
      scene.add(lamp);
      // Warm light pool on the road under the lamp + a soft halo at the
      // head. Both fade in at night (city.lampGlows, driven by game.js).
      const pool = new THREE.Mesh(new THREE.CircleGeometry(7, 20),
        new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x + ROAD_HALF + 1.5 + 2.4, 0.12, z + ROAD_HALF + 1.5);
      scene.add(pool);
      const lampHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      lampHalo.scale.set(8, 8, 1);
      lampHalo.position.set(x + ROAD_HALF + 1.5 + 2.4, 6.8, z + ROAD_HALF + 1.5);
      scene.add(lampHalo);
      city.lampGlows.push({ mat: pool.material, base: 0.22 }, { mat: lampHalo.material, base: 0.65 });
      // Traffic light at the four central intersections.
      if (Math.abs(bx) <= 1 && Math.abs(bz) <= 1) {
        const tl = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.4, 8), lampPoleMat);
        post.position.y = 2.7;
        tl.add(post);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.1, 0.7),
          new THREE.MeshStandardMaterial({ color: 0x181a1e, roughness: 0.5 }));
        box.position.y = 5.6;
        tl.add(box);
        const mats = [];
        for (let i = 0; i < 3; i++) {
          const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: [0xff2a22, 0xffb020, 0x2aff66][i], emissiveIntensity: 0.15 });
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), m);
          bulb.position.set(0, 6.3 - i * 0.62, 0.38);
          tl.add(bulb);
          mats.push(m);
        }
        tl.position.set(x - ROAD_HALF - 1.2, 0, z - ROAD_HALF - 1.2);
        scene.add(tl);
        city.trafficLights.push({ mats, phase: rng.range(0, 16) });
      }
    }
  }
  // Trees and hydrants scattered on sidewalks.
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
  const leafMats = [0x3f7a3a, 0x4c8a3f, 0x356b32].map(c =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  for (let i = 0; i < 46; i++) {
    const bx = rng.int(-GRID_N, GRID_N - 1), bz = rng.int(-GRID_N, GRID_N - 1);
    const cx = (bx + 0.5) * PITCH, cz = (bz + 0.5) * PITCH;
    const edge = rng.pick(['n', 's', 'e', 'w']);
    let x = cx, z = cz;
    if (edge === 'n') { z = cz - blockSize / 2 - 1; x += rng.range(-26, 26); }
    if (edge === 's') { z = cz + blockSize / 2 + 1; x += rng.range(-26, 26); }
    if (edge === 'e') { x = cx + blockSize / 2 + 1; z += rng.range(-26, 26); }
    if (edge === 'w') { x = cx - blockSize / 2 - 1; z += rng.range(-26, 26); }
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 8), trunkMat);
    trunk.position.y = 1.7;
    const f1 = new THREE.Mesh(new THREE.SphereGeometry(rng.range(2.2, 3.2), 10, 8), rng.pick(leafMats));
    f1.position.y = 4.6;
    const f2 = new THREE.Mesh(new THREE.SphereGeometry(rng.range(1.5, 2.2), 10, 8), rng.pick(leafMats));
    f2.position.set(1.2, 5.8, 0.6);
    tree.add(trunk, f1, f2);
    tree.position.set(x, 0.3, z);
    scene.add(tree);
  }
  const hydMat = new THREE.MeshStandardMaterial({ color: 0xc22a22, roughness: 0.5, metalness: 0.2 });
  for (let i = 0; i < 8; i++) {
    const bx = rng.int(-GRID_N, GRID_N - 1), bz = rng.int(-GRID_N, GRID_N - 1);
    const x = (bx + 0.5) * PITCH + rng.range(-28, 28);
    const z = (bz + 0.5) * PITCH + blockSize / 2 + 1;
    const hyd = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.1, 10), hydMat);
    body.position.y = 0.85;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), hydMat);
    cap.position.y = 1.45;
    hyd.add(body, cap);
    hyd.position.set(x, 0.3, z);
    scene.add(hyd);
  }

  // Distant skyline ring so the horizon is never empty. Towers reuse a
  // facade texture as their emissive map, so their windows light up at
  // night like the rest of the city.
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 1, emissive: 0xffffff, emissiveMap: facadeMats[2].map, emissiveIntensity: 0 });
  city.windowMats.push(skyMat);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const r = CITY_EDGE + rng.range(60, 160);
    const hgt = rng.range(30, 110);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(rng.range(18, 34), hgt, rng.range(18, 34)), skyMat);
    tower.position.set(Math.cos(a) * r, hgt / 2, Math.sin(a) * r);
    scene.add(tower);
  }

  // Night sky: a dome of stars and a moon with a halo, all faded in by
  // updateDayNight (city.nightSky). Fog is off for these — they sit far
  // beyond the fog range and must stay visible.
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 700; i++) {
    const a = rng.range(0, Math.PI * 2);
    const el = rng.range(0.08, Math.PI / 2);
    const r = 950;
    starPos.push(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
  scene.add(new THREE.Points(starGeo, starMat));
  const moonGroup = new THREE.Group();
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xf4f1de, transparent: true, opacity: 0, fog: false });
  const moon = new THREE.Mesh(new THREE.CircleGeometry(24, 24), moonMat);
  const moonGlowMat = new THREE.SpriteMaterial({ map: glowTexture, color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const moonGlow = new THREE.Sprite(moonGlowMat);
  moonGlow.scale.set(190, 190, 1);
  moonGroup.add(moon, moonGlow);
  moonGroup.position.set(-420, 380, -620);
  moonGroup.lookAt(0, 0, 0);
  scene.add(moonGroup);
  city.nightSky = { starMat, moonMat, moonGlowMat };

  // Pistol pickups sit on two road shoulders, marked on the minimap.
  city.pickupSpots = [
    { x: 80 + 5, z: 40, taken: false, respawn: 0 },
    { x: -80 - 5, z: -120, taken: false, respawn: 0 },
  ];
  city.spawn = { x: city.safehouse.x + 14, z: city.safehouse.z + 6 };
  return city;
}

// Day/night: returns 0.12 (midnight) .. 1 (noon) daylight factor for time t (seconds).
// NOTE: the clamp must wrap the whole sine, not the raw sine — max(0, sin)
// before the *0.5+0.5 step froze the night half of the cycle at 0.56, so
// "night" was never darker than dusk. That was the flat-night bug.
export function daylight(t) {
  const day = (t % 240) / 240; // 240 s full cycle
  return lerp(0.12, 1, Math.sin(day * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
}
export function skyColors(nightF) {
  // nightF 0 = day, 1 = night. Returns [top, horizon, fog] hex colours.
  // Night is near-black: the city lights have to carry the frame.
  const day = [0x6fb3e8, 0xbfd9ee, 0xcfe0ea];
  const night = [0x01030a, 0x0a1024, 0x05070f];
  return day.map((c, i) => {
    const a = new THREE.Color(c), b = new THREE.Color(night[i]);
    return a.lerp(b, nightF).getHex();
  });
}

// A point on the raised sidewalk slab beside a road, with a heading that
// walks along that road. The slab runs from 7 m off one road's centreline
// to 7 m off the next, so an offset of ROAD_HALF + 1.5..6 lands on it.
// `near` + `radius` bias the spot toward a place (the player spawn), so the
// streets around the player feel busy instead of uniformly empty.
export function sidewalkSpot(rng, roadCoords, near = null, radius = 170) {
  let x = 0, z = 0, heading = 0;
  for (let tries = 0; tries < 6; tries++) {
    const rc = rng.pick(roadCoords);
    const along = rng.range(-CITY_EDGE + 20, CITY_EDGE - 20);
    const side = rng.chance(0.5) ? 1 : -1;
    const off = ROAD_HALF + rng.range(1.5, 6);
    if (rng.chance(0.5)) {
      // Road runs along x (constant z): walk east or west.
      x = along; z = rc + side * off;
      heading = rng.pick([Math.PI / 2, -Math.PI / 2]);
    } else {
      // Road runs along z (constant x): walk north or south.
      x = rc + side * off; z = along;
      heading = rng.pick([0, Math.PI]);
    }
    if (!near) break;
    if (Math.hypot(x - near.x, z - near.z) <= radius) break;
  }
  if (near) {
    // All six tries missed the radius: pull the spot back to the radius
    // edge toward `near`, so groups really do gather near the safehouse
    // instead of silently spawning across the city.
    const d = Math.hypot(x - near.x, z - near.z);
    if (d > radius && d > 1e-6) {
      x = near.x + ((x - near.x) / d) * radius;
      z = near.z + ((z - near.z) / d) * radius;
    }
  }
  return { x, z, heading };
}
