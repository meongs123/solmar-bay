// SOLMAR BAY — bootstrap. Creates the game, starts the frame loop and
// exposes a small debug surface (window.__game) the play-tests drive:
// state, money, wanted, missions, teleport, givePistol and key injection.
// ?auto=1 skips the menu, ?shot=<name> stages a screenshot scene,
// ?ts=N speeds game time up for headless tests.
import { Game } from './game.js';

const game = new Game(document.getElementById('game'));
window.__game = game;

window.__debug = {
  state: () => ({
    state: game.state,
    money: game.money,
    wanted: game.wanted,
    hp: Math.ceil(game.player.hp),
    mission: game.missions.active ? game.missions.active.def.id : null,
    missionIndex: game.missions.index,
    storyDone: game.missions.isStoryDone(),
    inCar: !!game.player.inCar,
    speed: game.player.inCar ? game.player.inCar.speed : 0,
    x: Math.round(game.player.x),
    z: Math.round(game.player.z),
    ammo: game.pistolAmmo,
    hasPistol: game.hasPistol,
    weapon: game.currentWeapon,
    weaponAmmo: game.weaponAmmoOf(game.currentWeapon),
    smg: game.hasSmg,
    shotgun: game.hasShotgun,
    missionStep: game.missions.active ? game.missions.active.step : null,
    heli: !!game.heli,
    cond: game.player.inCar ? Math.round(game.player.inCar.condition) : null,
    robbed: game.robbedStores.size,
    errors: game.errors,
    police: game.policeCars.length,
    footCops: game.footCops.filter((c) => c.alive).length,
    peds: game.peds.length,
    pedsAlive: game.peds.filter((p) => p.alive).length,
    anim: game.player.animator ? game.player.animator.state : null,
    playerY: Math.round((game.player.y || 0) * 100) / 100,
    grounded: game.player.grounded,
    pedsNear: (x, z, r) => game.peds.filter(
      (p) => p.alive && Math.hypot(p.x - x, p.z - z) < r).length,
  }),
  teleport: (x, z) => {
    game.player.x = x; game.player.z = z;
    game.player.syncMesh();
  },
  // Teleport the player together with the car they are driving, so
  // scripted play-tests can drive missions without steering by hand.
  teleportCar: (x, z) => {
    if (game.player.inCar) {
      game.player.inCar.x = x; game.player.inCar.z = z;
      game.player.inCar.syncMesh();
    }
    game.player.x = x; game.player.z = z;
    game.player.syncMesh();
  },
  pressE: () => game.onInteract(),
  pressN: () => game.onNextMission(),
  // Inject a real keydown through the game's own handler, so scripted
  // tests exercise the same path a player does (map toggle, weapon keys…).
  pressKey: (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code })),
  openMap: () => game.openMap(),
  closeMap: () => game.closeMap(),
  jump: () => game.tryJump(),
  holdW: (on) => { game.input.forward = on; },
  givePistol: () => {
    game.hasPistol = true;
    game.pistolAmmo = 12;
    game.currentWeapon = 'pistol';
    game.hud.setWeapon(game.weaponLabel());
  },
  setWanted: (n) => game.setWanted(n),
  setMoney: (n) => { game.money = n; game.hud.setMoney(n); },
  startMission: (i) => {
    if (i !== undefined) game.missions.index = i;
    game.missions.start(game);
  },
  save: () => game.saveGame(),
  load: () => game.loadSave(),
};

game.loop();

// Screenshot staging runs after the first frames settle.
const shot = game.params.get('shot');
if (shot) {
  setTimeout(() => game.stageShot(shot), 800);
} else if (game.params.get('auto') === '1') {
  setTimeout(() => game.startGame(false), 400);
}
