// SOLMAR BAY — a gta6-01 entry (Node 22, standard library only). The game is
// this directory's game/ folder: a complete open-world crime game in a
// sun-soaked bay city, built on vendored three.js — play as Rook, a street
// kid in a teal jacket with a procedural animation state machine (idle /
// walk / run / jump / fall / hit / punch, all animated in code), drive and
// steal cars, outrun the bay police across a 0–5 star wanted level, run six
// story missions, fight on foot, rob shops, and save your progress. The program
// hands it in: it copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json, the summary the judge reads, with
// the vendored make.fun library. Screenshots in screenshots/ are real renders
// of this game's own code, taken in a headless browser during the build.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
// Fail loudly instead of handing in a broken dossier: the scorer refuses
// more than 4 screenshots, so never silently copy a fifth one in.
const shotFiles = existsSync(join(here, 'screenshots'))
  ? (await import('node:fs')).readdirSync(join(here, 'screenshots'))
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) : [];
if (shotFiles.length > 4) {
  throw new Error(`too many screenshots (${shotFiles.length}); the scorer caps at 4`);
}
// Never hand in an entry with no proof it renders: the screenshots are the
// judge's first look at the game, so a build with none of them is a bug.
if (shotFiles.length === 0) {
  throw new Error('no screenshots; take 4 real renders before submitting');
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
