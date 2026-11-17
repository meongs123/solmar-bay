// SOLMAR BAY — the game itself. Owns the renderer, the state machine
// (menu / playing / paused / busted / wasted / complete), the camera, the
// wanted level and police response, combat, pickups, store robberies, the
// day/night cycle and saving. Everything the player sees runs through here.
import * as THREE from 'three';
import { makeRng, clamp, lerp, wrapAngle, dist2D, approach, money } from './util.js';
import { buildCity, daylight, skyColors, PITCH, ROAD_HALF, CITY_EDGE } from './city.js';
import {
  makeCarMesh, Car, drivePlayerCar, updateTraffic, updatePoliceCar,
  spawnTrafficCars, spawnParkedCars, makePoliceCar, pointInColliders,
} from './vehicles.js';
import { Player, movePlayer, spawnPedestrians, updatePedestrian, FootCop, updateFootCop, tryJump, updateJump } from './people.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const SAVE_KEY = 'solmarbay-save-v1';
const DAY_LENGTH = 240;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.params = new URLSearchParams(window.location.search);
    this.timeScale = parseFloat(this.params.get('ts') || '1') || 1;
    this.rng = makeRng(1337);
    this.state = 'menu'; // menu | playing | paused | busted | wasted | complete
    this.time = 0;
    this.dayTime = 90; // seconds into the 240 s day cycle; starts late morning
    this.money = 0;
    this.wanted = 0;
    this.wantedTimer = 0;      // time since the last crime
    this.wantedDecayTimer = 0;
    this.stealthTail = false;  // mission 4: police patrol, never hunt
    this.pistolAmmo = 0;
    this.hasPistol = false;
    this.robbedStores = new Set();
    this.robHold = 0;          // seconds of hold-E progress at a store
    this.robTarget = null;
    this.bustTimer = 0;
    this.errors = [];
    this.shotReady = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6fb3e8);
    this.scene.fog = new THREE.Fog(0xcfe0ea, 220, 780);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);
    this.camYaw = Math.PI;      // orbit yaw around the player
    this.camPitch = 0.3;
    this.camDist = 10;
    this.camTarget = new THREE.Vector3();

    // Lights: sun + sky fill. The sun swings with the day cycle.
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -90; this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90; this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.camera.far = 500;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd9ee, 0x5a5348, 0.9);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);

    // World + actors.
    this.city = buildCity(this.scene, 1337);
    this.player = new Player(this.scene, this.city.spawn.x, this.city.spawn.z);
    this.traffic = spawnTrafficCars(this.scene, this.rng, this.city.colliders, 14);
    this.parked = spawnParkedCars(this.scene, this.rng, 12);
    this.peds = spawnPedestrians(this.scene, this.rng, 48, this.city.spawn, this.city.roadCoords);
    this.policeCars = [];
    this.footCops = [];
    this.courier = null;
    this.missions = createMissions(this.scene, this.city);
    this.hud = createHud(document);
    this.audio = createAudio();
    this.input = {
      forward: false, back: false, left: false, right: false,
      sprint: false, handbrake: false,
    };
    this.dragging = false;
    this.lastX = 0; this.lastY = 0;
    this.tracer = null;
    this.pickupMeshes = [];
    for (const spot of this.city.pickupSpots) {
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.4, metalness: 0.6 }));
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.18), body.material);
      grip.position.set(-0.25, -0.18, 0);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.35 }));
      m.add(body, grip, glow);
      m.position.set(spot.x, 1.0, spot.z);
      this.scene.add(m);
      this.pickupMeshes.push(m);
    }
    this.saveData = this.loadSave();
    this.bindInput();
    this.bindMenus();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('error', (e) => this.errors.push(String(e.message || e.error)));
    this.updateHudStatic();
    this.showMenu();
  }

  // ---- public API used by missions.js -------------------------------------
  playerPos() { return { x: this.player.x, z: this.player.z }; }
  playerInCar() { return !!this.player.inCar; }
  wantedStars() { return this.wanted; }
  addMoney(n) { this.money += n; this.hud.setMoney(this.money); this.audio.cash(); }
  toast(text, kind) { this.hud.toast(text, kind); }
  audioJingle(kind) { this.audio.jingle(kind); }
  robbedStoreNames() { return [...this.robbedStores]; }
  setWanted(n, why) {
    if (n > this.wanted) {
      this.wanted = n;
      this.wantedTimer = 0;
      if (why) this.toast(why, 'bad');
      this.hud.setWanted(n);
      this.audio.setSiren(n > 0);
    } else if (n < this.wanted) {
      this.wanted = n;
      this.hud.setWanted(n);
      this.audio.setSiren(n > 0);
    }
  }
  addWanted(n, why) { this.setWanted(Math.min(5, this.wanted + n), why); }
  spawnCourier() {
    if (this.courier) return;
    const mesh = makeCarMesh('sedan', 0xc65fd9);
    this.scene.add(mesh);
    const car = new Car(mesh, this.player.x + 30, this.player.z - 10, 0,
      { kind: 'courier', axis: 'x', dir: 1, lane: 4, cruise: 10 });
    car.speed = 10;
    car.syncMesh();
    this.courier = car;
    this.missions.courier = car;
  }
  despawnCourier() {
    if (!this.courier) return;
    this.scene.remove(this.courier.mesh);
    this.courier = null;
    this.missions.courier = null;
  }
  onStoryComplete() {
    this.state = 'complete';
    this.showScreen('complete');
    this.hud.toast('SOLMAR BAY IS YOURS — $2,850 earned. Free roam!', 'good');
  }

  // Mission 6 needs two unrobbed shops: when the player already robbed
  // nearly every storefront in free roam, the shops restock so the job
  // stays completable instead of soft-locking.
  resetRobbedStores() { this.robbedStores.clear(); }

  // ---- save / load ----------------------------------------------------------
  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: this.money,
        missionIndex: this.missions.index,
        hp: Math.ceil(this.player.hp),
        x: this.player.x, z: this.player.z,
        dayTime: this.dayTime,
      }));
      this.toast('Game saved.', 'good');
    } catch (e) { /* storage unavailable: ignore */ }
  }
  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  // ---- input ---------------------------------------------------------------
  bindInput() {
    const keyMap = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
      Space: 'handbrake',
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (keyMap[e.code] !== undefined) {
        this.input[keyMap[e.code]] = true;
        if (e.code === 'Space') e.preventDefault();
      }
      // Space on foot is a jump (in a car it is the handbrake, via input).
      if (e.code === 'Space') this.tryJump();
      if (e.code === 'KeyE') { this.eHeld = true; this.onInteract(); }
      if (e.code === 'KeyF') this.onPunch();
      if (e.code === 'KeyN') this.onNextMission();
      if (e.code === 'KeyM') {
        const m = this.audio.toggleMute();
        this.toast(m ? 'Sound muted.' : 'Sound on.', 'info');
      }
      if (e.code === 'KeyP' || e.code === 'Escape') this.togglePause();
      this.audio.unlock();
    });
    window.addEventListener('keyup', (e) => {
      if (keyMap[e.code] !== undefined) this.input[keyMap[e.code]] = false;
      if (e.code === 'KeyE') this.eHeld = false;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
      this.audio.unlock();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.camYaw -= (e.clientX - this.lastX) * 0.005;
      this.camPitch = clamp(this.camPitch + (e.clientY - this.lastY) * 0.004, 0.12, 1.1);
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      // A click without a drag fires the pistol.
      if (this.dragging && Math.abs(e.clientX - this.lastX) < 4 && Math.abs(e.clientY - this.lastY) < 4) {
        this.onShoot();
      }
      this.dragging = false;
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 1.5, 6, 18);
      e.preventDefault();
    }, { passive: false });
  }

  bindMenus() {
    const $ = (id) => document.getElementById(id);
    $('btn-start').addEventListener('click', () => this.startGame(false));
    $('btn-continue').addEventListener('click', () => this.startGame(true));
    $('btn-resume').addEventListener('click', () => this.togglePause());
    $('btn-restart').addEventListener('click', () => this.restartFromDeath());
    $('btn-quit-menu').addEventListener('click', () => { this.showMenu(); this.state = 'menu'; });
    $('btn-free-roam').addEventListener('click', () => { this.hideScreens(); this.state = 'playing'; });
    $('btn-save').addEventListener('click', () => this.saveGame());
    $('btn-menu-from-pause').addEventListener('click', () => { this.showMenu(); this.state = 'menu'; });
    if (this.saveData) $('btn-continue').style.display = 'inline-block';
  }

  showMenu() {
    this.hideScreens();
    document.getElementById('menu').style.display = 'flex';
    this.state = 'menu';
  }
  showScreen(id) {
    this.hideScreens();
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
    if (id === 'complete') {
      document.getElementById('complete-money').textContent = money(this.money);
    }
  }
  hideScreens() {
    for (const id of ['menu', 'pause', 'busted', 'wasted', 'complete']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  }

  startGame(continueSave) {
    this.hideScreens();
    this.state = 'playing';
    this.audio.unlock();
    this.audio.startMusic();
    if (continueSave && this.saveData) {
      const s = this.saveData;
      this.money = s.money || 0;
      this.missions.index = s.missionIndex || 0;
      this.player.hp = s.hp || 100;
      this.player.x = s.x ?? this.city.spawn.x;
      this.player.z = s.z ?? this.city.spawn.z;
      this.dayTime = s.dayTime || 60;
      this.player.syncMesh();
      this.toast('Save loaded. Welcome back to Solmar Bay.', 'good');
    } else {
      this.toast('Welcome to Solmar Bay. Press N to start your first job.', 'mission');
    }
    this.updateHudStatic();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.showScreen('pause');
    } else if (this.state === 'paused') {
      this.hideScreens();
      this.state = 'playing';
    }
  }

  restartFromDeath() {
    // Death costs half the cash on hand; respawn at the safehouse, heat gone.
    this.money = Math.floor(this.money / 2);
    this.player.hp = 100;
    this.wanted = 0;
    this.hud.setWanted(0);
    this.audio.setSiren(false);
    this.player.x = this.city.spawn.x;
    this.player.z = this.city.spawn.z;
    this.player.y = 0; this.player.vy = 0; this.player.grounded = true;
    if (this.player.inCar) {
      this.scene.remove(this.player.inCar.mesh);
      this.player.inCar = null;
    }
    this.player.syncMesh();
    this.clearPolice();
    this.hideScreens();
    this.state = 'playing';
    this.updateHudStatic();
    this.toast('You wake up at the safehouse. Half your cash is gone.', 'bad');
  }

  clearPolice() {
    for (const c of this.policeCars) this.scene.remove(c.mesh);
    this.policeCars = [];
    for (const c of this.footCops) this.scene.remove(c.mesh);
    this.footCops = [];
  }

  // ---- interaction: enter/exit car, punch, shoot, rob, missions -----------
  nearestCar(maxD) {
    const all = [...this.parked, ...this.traffic];
    let best = null, bd = maxD;
    for (const c of all) {
      const d = dist2D(this.player.x, this.player.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // Space on foot: hop. Returns true when a jump actually started.
  tryJump() {
    if (this.state !== 'playing' || this.player.inCar) return false;
    if (tryJump(this.player)) {
      this.audio.jump();
      return true;
    }
    return false;
  }

  onInteract() {
    if (this.state !== 'playing') return;
    // Robbery hold is separate: holding E near a store is handled in update.
    if (this.player.inCar) {
      // Exit the car (blocked only while a robbery hold is in progress).
      if (this.robHold > 0) return;
      const car = this.player.inCar;
      const f = car.forward();
      this.player.x = car.x - f.z * 3;
      this.player.z = car.z + f.x * 3;
      this.player.heading = car.heading;
      this.player.inCar = null;
      car.speed = 0;
      this.player.y = 0; this.player.vy = 0; this.player.grounded = true;
      this.player.syncMesh();
      return;
    }
    // Mission 5's pickup advances on arrival (missions.js tick), so there
    // is nothing to do on E here — walk to the marker and it is collected.
    const car = this.nearestCar(4.5);
    if (car) {
      this.player.inCar = car;
      car.kind = 'player';
      this.player.y = 0; this.player.vy = 0; this.player.grounded = true;
      // Taking a parked car or a traffic car is a crime.
      this.addWanted(1, 'Car stolen — the cops noticed!');
      // Remove from its old list so traffic logic stops driving it.
      this.parked = this.parked.filter((c) => c !== car);
      this.traffic = this.traffic.filter((c) => c !== car);
      this.toast('In the car. WASD to drive, Space to brake, E to get out.', 'info');
    }
  }

  onPunch() {
    if (this.state !== 'playing' || this.player.inCar || this.player.punchCooldown > 0) return;
    this.player.punchCooldown = 0.45;
    this.player.punchAnim = 0.3;
    this.audio.punch();
    const f = { x: Math.sin(this.player.heading), z: Math.cos(this.player.heading) };
    // Hit the nearest ped or cop in front of the player.
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const d = dist2D(this.player.x, this.player.z, ped.x, ped.z);
      const dot = ((ped.x - this.player.x) * f.x + (ped.z - this.player.z) * f.z) / Math.max(d, 0.01);
      if (d < 2.4 && dot > 0.3) {
        ped.alive = false;
        ped.downTimer = 8;
        ped.mesh.rotation.x = Math.PI / 2;
        ped.mesh.position.y = 0.4;
        this.addWanted(1, 'Assault! A witness called it in.');
        this.toast('You knocked them down.', 'bad');
        return;
      }
    }
    for (const cop of this.footCops) {
      if (!cop.alive) continue;
      const d = dist2D(this.player.x, this.player.z, cop.x, cop.z);
      if (d < 2.4) {
        cop.hp -= 50;
        if (cop.hp <= 0) {
          cop.alive = false;
          cop.mesh.visible = false;
          this.addMoney(10);
          this.addWanted(1, 'You dropped a cop!');
        } else {
          this.addWanted(1, 'You hit a cop!');
        }
        return;
      }
    }
  }

  onShoot() {
    if (this.state !== 'playing' || this.player.inCar || !this.hasPistol || this.pistolAmmo <= 0) return;
    this.pistolAmmo--;
    this.audio.shoot();
    this.hud.setWeapon(`PISTOL ${this.pistolAmmo}`);
    if (this.pistolAmmo <= 0) {
      this.hasPistol = false;
      setTimeout(() => this.hud.setWeapon(''), 400);
    }
    // Hitscan from the camera through the crosshair, blocked by buildings.
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = this.camera.position.clone();
    let bestT = 120, bestHit = null, bestKind = null;
    const test = (x, z, radius, obj, kind) => {
      const dx = x - origin.x, dz = z - origin.z;
      const t = dx * dir.x + dz * dir.z;
      if (t < 0 || t > bestT) return;
      const px = origin.x + dir.x * t - x;
      const pz = origin.z + dir.z * t - z;
      if (px * px + pz * pz < radius * radius) { bestT = t; bestHit = obj; bestKind = kind; }
    };
    for (const ped of this.peds) if (ped.alive) test(ped.x, ped.z, 1.1, ped, 'ped');
    for (const cop of this.footCops) if (cop.alive) test(cop.x, cop.z, 1.1, cop, 'cop');
    // Buildings block the shot: ray vs AABB, coarse 2D check.
    for (const c of this.city.colliders) {
      const t = rayAABB2D(origin, dir, c);
      if (t !== null && t < bestT) { bestT = t; bestHit = null; bestKind = 'wall'; }
    }
    // Tracer line from the muzzle to the hit point.
    const end = origin.clone().add(dir.clone().multiplyScalar(bestT));
    this.showTracer(this.playerPos3(), end);
    if (bestKind === 'ped') {
      bestHit.alive = false;
      bestHit.downTimer = 8;
      bestHit.mesh.rotation.x = Math.PI / 2;
      bestHit.mesh.position.y = 0.4;
      this.addWanted(1, 'Gunshot! Witnesses called the cops.');
    } else if (bestKind === 'cop') {
      bestHit.hp -= 50;
      this.audio.hit();
      if (bestHit.hp <= 0) {
        bestHit.alive = false;
        bestHit.mesh.visible = false;
        this.addMoney(10);
        this.addWanted(1, 'You dropped a cop!');
      }
    }
  }

  playerPos3() {
    return new THREE.Vector3(this.player.x, 1.4 + (this.player.y || 0), this.player.z);
  }

  showTracer(from, to) {
    if (this.tracer) {
      this.scene.remove(this.tracer);
      this.tracer.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    this.tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
    this.scene.add(this.tracer);
    setTimeout(() => {
      if (this.tracer) { this.scene.remove(this.tracer); this.tracer = null; }
    }, 90);
  }

  onNextMission() {
    if (this.state !== 'playing') return;
    if (this.missions.active) {
      this.toast('Finish the current job first — or fail it and try again.', 'info');
      return;
    }
    if (this.missions.isStoryDone()) {
      this.toast('Story complete — free roam. Rob stores (hold E) or cruise the bay.', 'info');
      return;
    }
    this.missions.start(this);
  }

  // ---- wanted + police -------------------------------------------------------
  updateWanted(dt) {
    if (this.wanted > 0) this.wantedTimer += dt;
    // Decay: -1 star per 12 s after 25 s clean and no police within 60 m.
    if (this.wanted > 0 && this.wantedTimer > 25 && !this.stealthTail) {
      let nearPolice = false;
      for (const c of this.policeCars) {
        if (dist2D(c.x, c.z, this.player.x, this.player.z) < 60) { nearPolice = true; break; }
      }
      if (!nearPolice) {
        this.wantedDecayTimer += dt;
        if (this.wantedDecayTimer > 12) {
          this.wantedDecayTimer = 0;
          this.setWanted(this.wanted - 1);
          this.toast('The heat is cooling off…', 'info');
        }
      } else {
        this.wantedDecayTimer = 0;
      }
    }
    // Police cars: 2 patrol always; extra hunters per wanted level.
    const wantCount = this.stealthTail ? 2 : 2 + this.wanted;
    while (this.policeCars.length < wantCount) {
      const spot = this.policeSpawnSpot();
      this.policeCars.push(makePoliceCar(this.scene, spot.x, spot.z));
    }
    while (this.policeCars.length > 2 && this.wanted === 0) {
      const c = this.policeCars.pop();
      this.scene.remove(c.mesh);
    }
    // Foot cops at wanted >= 3 (max 3).
    if (this.wanted >= 3 && this.footCops.filter((c) => c.alive).length < 3 && !this.stealthTail) {
      const a = Math.random() * Math.PI * 2;
      const cop = new FootCop(this.scene,
        this.player.x + Math.cos(a) * 22, this.player.z + Math.sin(a) * 22);
      this.footCops.push(cop);
    }
    // Bust check: a foot cop close to a slow on-foot player.
    if (!this.player.inCar) {
      for (const cop of this.footCops) {
        if (!cop.alive) continue;
        const d = dist2D(cop.x, cop.z, this.player.x, this.player.z);
        if (d < 2.2) {
          this.bustTimer += dt;
          if (this.bustTimer > 1.6) { this.busted(); return; }
        } else {
          this.bustTimer = Math.max(0, this.bustTimer - dt);
        }
      }
    } else {
      this.bustTimer = 0;
    }
  }

  policeSpawnSpot() {
    // Spawn at a road intersection at least 70 m from the player.
    for (let tries = 0; tries < 20; tries++) {
      const rx = this.city.roadCoords[Math.floor(Math.random() * this.city.roadCoords.length)];
      const rz = this.city.roadCoords[Math.floor(Math.random() * this.city.roadCoords.length)];
      if (dist2D(rx, rz, this.player.x, this.player.z) > 70) return { x: rx, z: rz };
    }
    return { x: this.player.x + 90, z: this.player.z };
  }

  busted() {
    this.state = 'busted';
    this.audio.bust();
    this.showScreen('busted');
    this.money = Math.floor(this.money * 0.8);
    this.wanted = 0;
    this.hud.setWanted(0);
    this.audio.setSiren(false);
    this.clearPolice();
    this.updateHudStatic();
  }

  wasted() {
    this.state = 'wasted';
    this.audio.bust();
    this.showScreen('wasted');
  }

  damagePlayer(n, cause) {
    if (this.state !== 'playing') return;
    this.player.hp -= n;
    // The hit flinch is driven by the animation state machine.
    this.player.hitAnim = 0.35;
    this.hud.setHealth(this.player.hp);
    this.hud.damageFlash();
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.wasted();
    }
  }

  // ---- per-frame update -------------------------------------------------------
  update(dt) {
    if (this.state !== 'playing') return;
    dt *= this.timeScale;
    this.time += dt;
    this.dayTime = (this.dayTime + dt) % DAY_LENGTH;

    const p = this.player;
    if (p.inCar) {
      const car = p.inCar;
      const crashed = drivePlayerCar(car, this.input, dt, this.city.colliders);
      p.x = car.x; p.z = car.z;
      p.heading = car.heading;
      p.mesh.visible = false; // the driver sits inside the car, not on its roof
      p.syncMesh();
      if (crashed && car.crashCooldown <= 0) {
        car.crashCooldown = 1;
        this.audio.crash();
        this.damagePlayer(4, 'crash');
        this.checkCopRam(car);
      }
      this.audio.setEngine(Math.abs(car.speed) / 34, true);
    } else {
      p.mesh.visible = true;
      movePlayer(p, this.input, this.camYaw, dt, this.city.colliders);
      updateJump(p, dt);
      p.syncMesh();
      this.audio.setEngine(0, false);
    }

    // Pistol pickups: walk over to collect, 12 rounds, respawn after 60 s.
    for (let i = 0; i < this.city.pickupSpots.length; i++) {
      const spot = this.city.pickupSpots[i];
      const mesh = this.pickupMeshes[i];
      if (spot.taken) {
        spot.respawn -= dt;
        mesh.visible = false;
        if (spot.respawn <= 0) { spot.taken = false; mesh.visible = true; }
        continue;
      }
      mesh.rotation.y += dt * 2;
      mesh.position.y = 1.0 + Math.sin(this.time * 3 + i) * 0.15;
      if (!p.inCar && dist2D(p.x, p.z, spot.x, spot.z) < 2.2) {
        spot.taken = true;
        spot.respawn = 60;
        this.hasPistol = true;
        this.pistolAmmo = 12;
        this.hud.setWeapon('PISTOL 12');
        this.audio.pickup();
        this.toast('Pistol picked up — 12 rounds. Click to shoot.', 'good');
      }
    }

    // Store robbery: hold E near a shopfront for 3 s (on foot only).
    this.updateRobbery(dt);

    // Traffic, pedestrians, police.
    const others = [...this.traffic, ...this.policeCars];
    if (p.inCar) others.push(p.inCar);
    for (const c of this.traffic) updateTraffic(c, dt, others, this.city.colliders);
    for (const ped of this.peds) {
      updatePedestrian(ped, dt, this.city.colliders, { x: p.x, z: p.z },
        this.wanted > 0 || this.hasPistol);
    }
    this.updateWanted(dt);
    for (const pc of this.policeCars) {
      if (this.stealthTail) {
        // Mission 4 stealth: police patrol the roads instead of hunting.
        updateTraffic(pc, dt, others, this.city.colliders);
        continue;
      }
      const d = updatePoliceCar(pc, { x: p.x, z: p.z }, dt, this.city.colliders);
      if (d < 3.4 && pc.crashCooldown <= 0) {
        pc.crashCooldown = 1;
        if (p.inCar) {
          // A police ram only counts as the player hitting a cop when the
          // player is the aggressor (fast and at least as fast as the cop).
          if (Math.abs(p.inCar.speed) > 10 && Math.abs(p.inCar.speed) >= Math.abs(pc.speed)) {
            this.addWanted(1, 'You hit a cop car!');
          }
          this.damagePlayer(5, 'ram');
          p.inCar.speed *= 0.6;
          this.audio.crash();
        } else {
          this.damagePlayer(8, 'ram');
          this.audio.crash();
        }
      }
    }
    for (const cop of this.footCops) {
      if (!cop.alive) continue;
      const dmg = updateFootCop(cop, dt, { x: p.x, z: p.z }, this.city.colliders, () => {
        this.audio.shoot();
      });
      if (dmg > 0) this.damagePlayer(dmg, 'shot');
    }
    // Courier for mission 4 drives a loop around the central blocks.
    if (this.courier) {
      const c = this.courier;
      const target = { x: 0, z: 0 };
      // Loop waypoints: a rectangle around the centre.
      const wp = [
        { x: 160, z: 80 }, { x: 160, z: -80 }, { x: -160, z: -80 }, { x: -160, z: 80 },
      ];
      const cur = wp[c.courierWp || 0];
      const d = dist2D(c.x, c.z, cur.x, cur.z);
      if (d < 10) c.courierWp = ((c.courierWp || 0) + 1) % wp.length;
      const wantHeading = Math.atan2(-(cur.z - c.z), cur.x - c.x);
      c.heading += clamp(wrapAngle(wantHeading - c.heading), -1.4 * dt, 1.4 * dt);
      c.speed = approach(c.speed, 10, 8 * dt);
      const f = c.forward();
      c.x += f.x * c.speed * dt;
      c.z += f.z * c.speed * dt;
      c.syncMesh(dt);
    }

    // Missions.
    this.missions.tick(dt, this);
    const obj = this.missions.objectiveText(this);
    this.hud.setMission(obj.title, obj.text, obj.dist);

    // Traffic lights cycle every 8 s.
    for (const tl of this.city.trafficLights) {
      tl.phase = (tl.phase + dt) % 16;
      const green = tl.phase < 8;
      tl.mats[0].emissiveIntensity = green ? 0.15 : 1.6;
      tl.mats[1].emissiveIntensity = 0.15;
      tl.mats[2].emissiveIntensity = green ? 1.6 : 0.15;
    }

    this.updateDayNight(dt);
    this.updateCamera(dt);
    this.updateMinimap();
    this.updateClockHud();
  }

  updateRobbery(dt) {
    const p = this.player;
    // Robbery uses the E key held down (eHeld is set in bindInput).
    if (p.inCar || this.state !== 'playing') { this.robHold = 0; this.robTarget = null; return; }
    if (!this.eHeld) { this.robHold = 0; this.robTarget = null; return; }
    let target = null;
    for (const s of this.city.storeSpots) {
      if (this.robbedStores.has(s.name)) continue;
      if (dist2D(p.x, p.z, s.x, s.z) < 6) { target = s; break; }
    }
    if (!target) { this.robHold = 0; this.robTarget = null; return; }
    this.robTarget = target;
    this.robHold += dt;
    if (this.robHold >= 3) {
      this.robHold = 0;
      this.robbedStores.add(target.name);
      this.addMoney(150);
      this.addWanted(1, `You robbed ${target.name}!`);
      this.toast(`${target.name} robbed — +$150`, 'good');
      if (this.missions.active && this.missions.active.def.id === 6) {
        this.missions.robbed++;
      }
    }
  }

  checkCopRam(car) {
    // Crash into a police car while driving fast: +1 wanted.
    for (const pc of this.policeCars) {
      if (dist2D(car.x, car.z, pc.x, pc.z) < 4.5 && Math.abs(car.speed) > 10) {
        this.addWanted(1, 'You hit a cop car!');
        break;
      }
    }
  }

  updateDayNight(dt) {
    const dl = daylight(this.dayTime);
    const nightF = 1 - dl;
    const [top, horizon, fog] = skyColors(nightF);
    this.scene.background.setHex(top);
    this.scene.fog.color.setHex(fog);
    // Sun swings across the sky with the cycle.
    const ang = (this.dayTime / DAY_LENGTH) * Math.PI * 2 - Math.PI / 2;
    this.sun.position.set(Math.cos(ang) * 180, Math.sin(ang) * 160 + 30, 80);
    this.sun.intensity = lerp(0.15, 2.4, dl);
    this.sun.color.setHex(nightF > 0.7 ? 0x8aa0c8 : 0xfff2d8);
    this.hemi.intensity = lerp(0.3, 1.0, dl);
    this.ambient.intensity = lerp(0.4, 0.32, dl);
    // Windows + lamps glow at night.
    const glow = nightF * 0.9;
    for (const m of this.city.windowMats) {
      if (m.emissiveMap) m.emissiveIntensity = glow;
      else if (m.emissive) m.emissiveIntensity = glow * 1.4;
    }
  }

  updateCamera(dt) {
    const p = this.player;
    // While the pistol is out, ease the camera flatter so distant targets
    // are hittable through the crosshair.
    const pitchTarget = this.hasPistol && !p.inCar ? 0.22 : this.camPitch;
    const pitch = lerp(this.camPitch, pitchTarget, dt * 3);
    const dist = p.inCar ? this.camDist + 3 : this.camDist;
    const cx = p.x + Math.sin(this.camYaw) * Math.cos(pitch) * dist;
    const cz = p.z + Math.cos(this.camYaw) * Math.cos(pitch) * dist;
    const cy = 2.2 + Math.sin(pitch) * dist;
    // Pull the camera in when a building blocks the view.
    let finalDist = dist;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = lerp(p.x, cx, t), z = lerp(p.z, cz, t);
      if (pointInColliders(x, z, this.city.colliders)) {
        finalDist = dist * (t - 0.12);
        break;
      }
    }
    finalDist = Math.max(3, finalDist);
    this.camera.position.set(
      p.x + Math.sin(this.camYaw) * Math.cos(pitch) * finalDist,
      2.2 + (p.y || 0) + Math.sin(pitch) * finalDist,
      p.z + Math.cos(this.camYaw) * Math.cos(pitch) * finalDist,
    );
    this.camTarget.set(p.x, (p.inCar ? 1.6 : 1.5) + (p.y || 0), p.z);
    this.camera.lookAt(this.camTarget);
  }

  updateMinimap() {
    this.hud.drawMinimap({
      roads: this.city.roadCoords,
      safehouse: this.city.safehouse,
      pickups: this.city.pickupSpots,
      peds: this.peds,
      traffic: this.traffic,
      police: this.policeCars,
      courier: this.courier,
      marker: this.missions.markerPos() || (this.missions.active && this.missions.active.def.id === 4 && this.courier
        ? { x: this.courier.x, z: this.courier.z } : null),
      player: { x: this.player.x, z: this.player.z, heading: this.player.heading },
    });
  }

  updateClockHud() {
    const dayFrac = this.dayTime / DAY_LENGTH;
    const hour = Math.floor((dayFrac * 24 + 6) % 24);
    const min = Math.floor(((dayFrac * 24 + 6) % 1) * 60);
    const hh = String(hour).padStart(2, '0');
    const mm = String(min).padStart(2, '0');
    const part = hour < 6 ? 'NIGHT' : hour < 18 ? 'DAY' : 'DUSK';
    this.hud.setClock(`${hh}:${mm} ${part}`);
  }

  updateHudStatic() {
    this.hud.setHealth(this.player.hp);
    this.hud.setMoney(this.money);
    this.hud.setWanted(this.wanted);
    this.hud.setWeapon(this.hasPistol ? `PISTOL ${this.pistolAmmo}` : '');
    const obj = this.missions.objectiveText(this);
    this.hud.setMission(obj.title, obj.text, obj.dist);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---- frame loop + debug hooks ----------------------------------------------
  loop() {
    const clock = new THREE.Clock();
    const step = () => {
      requestAnimationFrame(step);
      const dt = Math.min(clock.getDelta(), 0.1);
      try {
        this.update(dt);
      } catch (e) {
        this.errors.push(String(e && e.message ? e.message : e));
      }
      this.renderer.render(this.scene, this.camera);
    };
    step();
  }

  // Screenshot staging: ?shot=chase|driving|street|mission stages a scene
  // with the HUD live, then sets window.__shotReady when it is settled.
  // Each shot is framed on a central road with traffic and pedestrians
  // gathered around it, so the frame reads as a busy city, not an empty lot.
  stageShot(name) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Put the player in a car on road z=80, facing `heading` (0 = east).
    const placeCarOnRoad = (x, z, heading) => {
      const car = this.parked[0];
      car.x = x; car.z = z; car.heading = heading; car.speed = 0;
      car.syncMesh();
      this.player.x = x; this.player.z = z;
      this.player.inCar = car;
      car.kind = 'player';
      this.parked = this.parked.filter((c) => c !== car);
      // Camera behind the car: camYaw -PI/2 looks east, +PI/2 looks west.
      this.camYaw = heading === 0 ? -Math.PI / 2 : Math.PI / 2;
      this.camPitch = 0.28;
      return car;
    };
    // Gather pedestrians onto the sidewalks and traffic onto the road
    // around (cx, roadZ) so the shot has a living street in it: twelve
    // peds in two rows, one on each sidewalk.
    const crowd = (roadZ, cx) => {
      for (let i = 0; i < 12; i++) {
        const ped = this.peds[i];
        ped.x = cx - 44 + i * 8;
        ped.z = roadZ + (i % 2 ? -11 : 11);
        ped.alive = true;
        ped.mesh.visible = true;
        ped.mesh.rotation.x = 0;
        ped.heading = (Math.PI / 2) * (i % 4);
        ped.syncMesh();
      }
      for (let i = 0; i < 4; i++) {
        const t = this.traffic[i];
        t.x = cx - 44 + i * 26;
        t.z = roadZ + (i % 2 ? -4 : 4);
        t.axis = 'x';
        t.dir = i % 2 ? 1 : -1;
        t.heading = t.dir > 0 ? 0 : Math.PI;
        t.speed = t.cruise;
        t.syncMesh();
      }
    };
    const run = async () => {
      this.startGame(false);
      if (name === 'driving') {
        placeCarOnRoad(-20, 80, 0);
        crowd(80, -20);
        this.input.forward = true;
        await sleep(2600);
        this.input.forward = false;
      } else if (name === 'street') {
        // On foot at the corner of the central intersection, looking east
        // down the road toward the garage marker.
        this.player.x = 68; this.player.z = 68;
        this.camYaw = -Math.PI / 2;
        this.camPitch = 0.3;
        crowd(80, 68);
        this.missions.start(this);
        await sleep(1800);
      } else if (name === 'chase') {
        placeCarOnRoad(-40, 80, 0);
        crowd(80, -40);
        this.setWanted(3, 'The cops are on you!');
        this.input.forward = true;
        await sleep(2000);
        // Pull the nearest police car into frame ahead of the player so
        // the chase reads in the screenshot, not just in the HUD.
        const pc = this.policeCars[0];
        if (pc) {
          pc.x = this.player.x + 32;
          pc.z = 84;
          pc.heading = Math.PI;
          pc.syncMesh();
        }
        await sleep(1200);
        this.input.forward = false;
      } else if (name === 'mission') {
        // Mission 2, delivery run: the car sits 40 m east of the first
        // drop-off, marker beacon visible down the road, street busy.
        this.missions.index = 1;
        this.missions.start(this);
        placeCarOnRoad(-120, 80, Math.PI);
        crowd(80, -120);
        await sleep(1800);
      }
      this.shotReady = true;
      window.__shotReady = true;
    };
    run();
  }
}

// 2D ray vs AABB, used to block pistol shots with buildings. Returns the
// distance along the ray, or null when there is no hit within 120 m.
function rayAABB2D(origin, dir, box) {
  const dx = dir.x, dz = dir.z;
  let tmin = 0, tmax = 120;
  if (Math.abs(dx) < 1e-8) {
    if (origin.x < box.minX || origin.x > box.maxX) return null;
  } else {
    let t1 = (box.minX - origin.x) / dx;
    let t2 = (box.maxX - origin.x) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-8) {
    if (origin.z < box.minZ || origin.z > box.maxZ) return null;
  } else {
    let t1 = (box.minZ - origin.z) / dz;
    let t2 = (box.maxZ - origin.z) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
