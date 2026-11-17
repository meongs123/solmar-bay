# SOLMAR BAY

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/meongs123/solmar-bay/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/meongs123/solmar-bay/reward.svg)](https://make.fun/c/gta6-01)

An original open-world crime game for the make.fun **Make GTA 6** bounty
(`gta6-01`). Nothing here is copied from any commercial game — the city, the
characters, the cars, the story and the sounds are all built from scratch.

## The game

Solmar Bay is a sun-soaked bay city you can explore on foot and by car.
Steal parked cars and traffic cars, outrun the bay police across a 0–5 star
wanted level, fight on foot (fists and a pickup pistol), rob shops, and run
six story missions for Rook and Mara — from your first stolen car to the big
score that takes the city.

- **City:** a deterministic 7×7 road grid with textured buildings, setbacks
  and roof props, storefronts with neon signs, lamps, trees, hydrants,
  traffic lights and a distant skyline; a 240-second day/night cycle.
- **Driving:** arcade physics, four car body styles, 14 traffic cars that
  turn at intersections, 12 parked cars to steal, police cars that patrol,
  chase and ram.
- **Rook, the player:** a procedural humanoid built only from code —
  teal jacket, charcoal jeans, white sneakers, black cap worn backwards.
  A procedural animation state machine drives him from his live state:
  idle breathing, walk and run leg/arm swings (bigger and faster when
  sprinting), jump tuck and falling pose, a hit flinch, and a punch swing.
  Space jumps on foot; the collision stays a simple capsule, so the
  character looks human while the gameplay stays predictable.
- **On foot:** walk and sprint, jump, building collision, punch pedestrians,
  pistol pickups with hitscan shooting, foot cops at wanted 3+.
- **Living streets:** 48 pedestrians walk the sidewalks in groups of 2–3,
  denser around the safehouse — amber dots on the minimap, and they flee
  when you hit them or fire nearby.
- **Wanted:** crimes raise stars; police cars spawn at intersections and
  hunt you; heat decays when you stay clean and out of sight. Get busted
  or wasted and you wake up at the safehouse, lighter in the wallet.
- **Missions:** six chained jobs with timers, a stealth tail, a pickup and
  two store robberies — $150 to $2,850 in total.
- **HUD:** health, money, wanted stars, live round minimap (roads, traffic,
  pedestrians, police, mission marker, safehouse, pistol pickups), speed, mission
  objective with distance, toasts and a damage vignette.
- **Menus & save:** start menu, pause menu, busted/wasted/complete screens,
  save to localStorage with Continue on the menu.
- **Sound:** synthesized WebAudio only — engine hum, sirens, a bass line and
  jingles. No sound files, no network requests at all.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move on foot, drive |
| Mouse drag | Orbit camera · wheel zooms |
| E | Enter / exit car (stealing = +1 wanted) · hold E at a shopfront to rob it |
| F | Punch |
| Click | Shoot the pistol (after picking one up) |
| Space | Jump (on foot) · handbrake (driving) |
| Shift | Sprint |
| N | Start / retry the next mission |
| P / Esc | Pause · M mute |

## Play it

```sh
node serve.ts        # serves game/ at http://localhost:8080
# or: python3 -m http.server 8321 --directory game
# then open http://localhost:8321/index.html
```

Fully static: `game/index.html` plus its ES modules and vendored three.js
under `game/vendor/three/`. Zero network requests at runtime.

## Build

`main.ts` (Node 22, standard library only) copies `game/` and
`screenshots/` to `/output` and writes `/output/dossier.json`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
node cli/makefun.mjs check --kit <kit> --repo .
```

## License

MIT — see [LICENSE](LICENSE).
