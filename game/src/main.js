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
    robbed: game.robbedStores.size,
    errors: game.errors,
    police: game.policeCars.length,
    footCops: game.footCops.filter((c) => c.alive).length,
  }),
  teleport: (x, z) => {
    game.player.x = x; game.player.z = z;
    game.player.syncMesh();
  },
  pressE: () => game.onInteract(),
  pressN: () => game.onNextMission(),
  holdW: (on) => { game.input.forward = on; },
  givePistol: () => {
    game.hasPistol = true;
    game.pistolAmmo = 12;
    game.hud.setWeapon('PISTOL 12');
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
