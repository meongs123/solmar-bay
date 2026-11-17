// The SOLMAR BAY story arc: six chained missions with a thin crime story.
// Each mission is a small state machine driven by `tick(dt, G)`, where G is
// the game object (player, cars, wanted level, money, toasts). Rewards stack
// to $2,850; finishing mission 6 ends the story and opens free roam.
import * as THREE from 'three';
import { dist2D, clamp } from './util.js';
import { PITCH } from './city.js';

const MISSION_DEFS = [
  {
    id: 1, title: 'First Wheels', reward: 150,
    brief: 'Rook needs wheels. Take any car on the street and bring it to the garage.',
    start: 'Steal a car — press E next to one.',
  },
  {
    id: 2, title: 'Delivery Run', reward: 250,
    brief: 'Mara has packages that cannot wait. Two drops, 100 seconds. Drive like it matters.',
    start: 'Drive to the first drop-off.',
  },
  {
    id: 3, title: 'Getaway', reward: 300,
    brief: 'The bay police are on you. Lose them — or outlast them — and meet Rook at the safehouse.',
    start: 'Lose the cops. Stay out of sight until the heat dies.',
  },
  {
    id: 4, title: 'Tail the Courier', reward: 350,
    brief: 'A courier carries the harbour ledger. Follow him — close enough to see, far enough to stay invisible.',
    start: 'Follow the courier. Not too close, not too far.',
  },
  {
    id: 5, title: 'Pickup', reward: 400,
    brief: 'A package waits at the old pier market. Pick it up on foot and bring it home.',
    start: 'Walk to the pickup point — the package is collected on arrival.',
  },
  {
    id: 6, title: 'The Big Score', reward: 1400,
    brief: 'Two shops, one night, no alarms. Rob both stores, then vanish to the safehouse.',
    start: 'Rob two stores — hold E at a shopfront.',
  },
];

export function createMissions(scene, city) {
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.85 });
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.3, 20), markerMat);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 40, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.18 }));
  beacon.position.y = 20;
  const markerGroup = new THREE.Group();
  markerGroup.add(marker, beacon);
  markerGroup.visible = false;
  scene.add(markerGroup);

  const M = {
    index: 0,            // next mission to start (0-based)
    active: null,        // current mission runtime state
    completed: 0,
    totalEarned: 0,
    courier: null,       // Car instance used by mission 4
    courierPath: null,
    robbed: 0,           // stores robbed during mission 6
    defs: MISSION_DEFS,

    currentDef() { return MISSION_DEFS[M.index] || null; },
    isStoryDone() { return M.index >= MISSION_DEFS.length; },

    markerPos() {
      if (!M.active) return null;
      return M.active.target;
    },

    start(G) {
      const def = M.currentDef();
      if (!def) return false;
      const a = { def, step: 0, timer: 0, progress: 0, target: null, dropIdx: 0, drops: [] };
      if (def.id === 1) {
        a.target = { x: city.garageTarget.x, z: city.garageTarget.z };
      } else if (def.id === 2) {
        a.drops = [
          { x: -160, z: 80 }, { x: 160, z: -80 },
        ];
        a.timer = 100;
        a.target = a.drops[0];
      } else if (def.id === 3) {
        // 60 s so the "lose the heat" path is actually reachable: the heat
        // needs 25 s clean + 12 s per star to decay from 2 stars (~49 s).
        a.timer = 60;
        a.target = { x: city.safehouseTarget.x, z: city.safehouseTarget.z };
        G.setWanted(2, 'The cops are on you!');
      } else if (def.id === 4) {
        // Courier drives a slow loop around the central blocks.
        a.target = null;
        G.spawnCourier();
        G.setWanted(0);
        G.stealthTail = true;
      } else if (def.id === 5) {
        a.target = { x: -160, z: -80 };
      } else if (def.id === 6) {
        M.robbed = 0;
        // The job needs two fresh shops: if the player already robbed
        // nearly every storefront in free roam, restock them first.
        const unrobbed = city.storeSpots.filter(
          (s) => !G.robbedStoreNames().includes(s.name));
        if (unrobbed.length < 2) {
          G.resetRobbedStores();
          G.toast('The shops restocked — two fresh targets.', 'info');
        }
        a.target = nearestStore(G.playerPos(), city);
      }
      M.active = a;
      G.toast(`${def.title} — ${def.start}`, 'mission');
      G.audioJingle('mission');
      M.updateMarker();
      return true;
    },

    updateMarker() {
      if (!M.active) { markerGroup.visible = false; return; }
      let t = M.active.target;
      if (M.active.def.id === 4 && M.courier) t = { x: M.courier.x, z: M.courier.z };
      if (!t) { markerGroup.visible = false; return; }
      markerGroup.visible = true;
      markerGroup.position.set(t.x, 0.4, t.z);
    },

    complete(G) {
      const a = M.active;
      if (!a) return;
      const reward = a.def.reward;
      G.addMoney(reward);
      M.totalEarned += reward;
      M.completed++;
      M.index++;
      G.toast(`${a.def.title} complete — +$${reward}`, 'good');
      G.audioJingle('complete');
      M.active = null;
      G.stealthTail = false;
      if (M.isStoryDone()) {
        G.onStoryComplete();
      } else {
        G.toast(`Next: ${MISSION_DEFS[M.index].title} — press N to start`, 'mission');
      }
      M.updateMarker();
    },

    fail(G, reason) {
      const a = M.active;
      if (!a) return;
      G.toast(`${a.def.title} failed — ${reason}. Press N to retry.`, 'bad');
      G.audioJingle('fail');
      M.active = null;
      G.stealthTail = false;
      if (a.def.id === 4) G.despawnCourier();
      M.updateMarker();
    },

    tick(dt, G) {
      const a = M.active;
      if (!a) return;
      const p = G.playerPos();
      const d = a.target ? dist2D(p.x, p.z, a.target.x, a.target.z) : 999;
      // Pulse the marker.
      markerGroup.position.y = 0.4 + Math.sin(performance.now() / 300) * 0.25;
      marker.rotation.y += dt * 1.5;
      M.updateMarker();

      switch (a.def.id) {
        case 1: {
          if (a.step === 0) {
            if (G.playerInCar()) {
              a.step = 1;
              G.toast('Nice wheels. Now drive to the garage marker.', 'mission');
            }
          } else if (d < 7) {
            M.complete(G);
          }
          break;
        }
        case 2: {
          a.timer -= dt;
          if (a.timer <= 0) { M.fail(G, 'out of time'); break; }
          if (d < 7) {
            a.dropIdx++;
            if (a.dropIdx >= a.drops.length) { M.complete(G); break; }
            a.target = a.drops[a.dropIdx];
            G.toast(`Drop ${a.dropIdx + 1} of 2 — ${Math.ceil(a.timer)}s left`, 'mission');
          }
          break;
        }
        case 3: {
          a.timer -= dt;
          if (G.wantedStars() === 0) { M.complete(G); break; }
          if (a.timer <= 0) { M.complete(G); break; }
          break;
        }
        case 4: {
          const c = M.courier;
          if (!c) { M.fail(G, 'courier lost'); break; }
          const cd = dist2D(p.x, p.z, c.x, c.z);
          if (cd > 42) { M.fail(G, 'you lost the courier'); break; }
          if (cd >= 8 && cd <= 32) {
            a.progress += dt;
            if (a.progress >= 25) {
              G.despawnCourier();
              M.complete(G);
            }
          } else if (cd < 6) {
            a.progress = Math.max(0, a.progress - dt * 2);
          }
          break;
        }
        case 5: {
          if (a.step === 0) {
            if (d < 5) {
              a.step = 1;
              a.target = { x: city.safehouseTarget.x, z: city.safehouseTarget.z };
              G.toast('Package collected. Bring it to the safehouse.', 'mission');
            }
          } else if (d < 7) {
            M.complete(G);
          }
          break;
        }
        case 6: {
          if (M.robbed >= 2) {
            a.target = { x: city.safehouseTarget.x, z: city.safehouseTarget.z };
            // NOTE: measure against the NEW target (the safehouse), not the
            // stale `d` computed at the top of tick against the old store
            // target — the player stands on that store, so the stale d is
            // ~0 and the story would complete without the final drive home.
            if (dist2D(p.x, p.z, a.target.x, a.target.z) < 7) M.complete(G);
          } else {
            const s = nearestUnrobbedStore(G, city);
            if (s) a.target = { x: s.x, z: s.z };
          }
          break;
        }
        default:
          break;
      }
    },

    // Objective line for the HUD, plus the live distance to the marker.
    objectiveText(G) {
      const a = M.active;
      if (!a) {
        if (M.isStoryDone()) return { title: 'Free roam', text: 'SOLMAR BAY IS YOURS — explore, earn, survive.', dist: null };
        return { title: MISSION_DEFS[M.index].title, text: 'Press N to start the next mission.', dist: null };
      }
      const p = G.playerPos();
      let t = a.target;
      if (a.def.id === 4 && M.courier) t = { x: M.courier.x, z: M.courier.z };
      let dist = t ? Math.round(dist2D(p.x, p.z, t.x, t.z)) : null;
      let text = a.def.brief;
      if (a.def.id === 2) text = `Deliveries: ${a.dropIdx}/2 — ${Math.max(0, Math.ceil(a.timer))}s left`;
      if (a.def.id === 3) text = `Lose the cops — ${Math.max(0, Math.ceil(a.timer))}s left (or reach 0 stars)`;
      if (a.def.id === 4) text = `Tail progress: ${Math.min(100, Math.round((a.progress / 25) * 100))}% — stay 8–32m back`;
      if (a.def.id === 6) text = `Stores robbed: ${M.robbed}/2${M.robbed >= 2 ? ' — get to the safehouse!' : ' — hold E at a shopfront'}`;
      return { title: a.def.title, text, dist };
    },
  };
  return M;
}

function nearestStore(p, city) {
  let best = city.storeSpots[0], bd = 1e9;
  for (const s of city.storeSpots) {
    const d = dist2D(p.x, p.z, s.x, s.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function nearestUnrobbedStore(G, city) {
  const robbed = G.robbedStoreNames ? G.robbedStoreNames() : [];
  let best = null, bd = 1e9;
  for (const s of city.storeSpots) {
    if (robbed.includes(s.name)) continue;
    const p = G.playerPos();
    const d = dist2D(p.x, p.z, s.x, s.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
