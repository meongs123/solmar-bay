// HUD for SOLMAR BAY: health bar, money, wanted stars, mission panel,
// speed, toasts, damage vignette and a live round minimap drawn on canvas.
// The minimap is north-up: roads, the player arrow, traffic, police, the
// mission marker, the safehouse and pistol pickups.
import { money } from './util.js';
import { CITY_EDGE } from './city.js';

// District from a city position: the central square is DOWNTOWN, the four
// outer quadrants are the named districts. Shared by the minimap label and
// the full-screen map so both always agree.
export function districtAt(x, z) {
  if (Math.abs(x) < 80 && Math.abs(z) < 80) return 'DOWNTOWN';
  return z < 0 ? (x < 0 ? 'NORTH HARBOUR' : 'MARINA HEIGHTS')
    : (x < 0 ? 'OLD PIER' : 'DOCKSIDE');
}

export function createHud(doc) {
  const el = (id) => doc.getElementById(id);
  const hud = {
    hpFill: el('hp-fill'),
    hpText: el('hp-text'),
    moneyEl: el('money'),
    starsEl: el('stars'),
    missionTitle: el('mission-title'),
    missionText: el('mission-text'),
    missionDist: el('mission-dist'),
    speedEl: el('speed'),
    speedWrap: el('speed-wrap'),
    weaponEl: el('weapon'),
    toastsEl: el('toasts'),
    vignette: el('vignette'),
    minimap: el('minimap'),
    clockEl: el('clock'),
    crosshair: el('crosshair'),
  };
  hud.ctx = hud.minimap.getContext('2d');
  hud.lastToast = 0;

  hud.toast = (text, kind = 'info') => {
    const now = Date.now();
    if (text === hud.lastToastText && now - hud.lastToast < 1500) return;
    hud.lastToast = now; hud.lastToastText = text;
    const d = doc.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    hud.toastsEl.appendChild(d);
    while (hud.toastsEl.children.length > 4) hud.toastsEl.removeChild(hud.toastsEl.firstChild);
    setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 600); }, 3600);
  };

  // Dialogue card: a named speaker + portrait medallion, created on first
  // use. Non-blocking by construction (#hud is pointer-events:none) and
  // timed — it hides itself after 4.2 s so it can never stall the game.
  hud.dialogueEl = null; hud.dialogueTimer = null;
  hud.dialogue = (name, text, color = '#14d8b8') => {
    if (!hud.dialogueEl) {
      const d = doc.createElement('div');
      d.style.cssText = 'position:absolute;left:16px;bottom:240px;max-width:360px;pointer-events:none;display:none;gap:10px;align-items:flex-start;background:rgba(8,10,14,0.82);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:10px 12px;';
      const por = doc.createElement('div');
      por.style.cssText = 'flex:none;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#062a24;';
      const body = doc.createElement('div');
      const nm = doc.createElement('div');
      nm.style.cssText = 'font-size:12px;font-weight:800;letter-spacing:1px;';
      const ln = doc.createElement('div');
      ln.style.cssText = 'font-size:14px;line-height:1.35;';
      body.appendChild(nm); body.appendChild(ln);
      d.appendChild(por); d.appendChild(body);
      hud.toastsEl.parentElement.appendChild(d);
      hud.dialogueEl = d; hud.dialoguePor = por; hud.dialogueName = nm; hud.dialogueLine = ln;
    }
    const el = hud.dialogueEl;
    el.style.display = 'flex';
    hud.dialoguePor.textContent = name.charAt(0);
    hud.dialoguePor.style.background = color;
    hud.dialogueName.textContent = name;
    hud.dialogueName.style.color = color;
    hud.dialogueLine.textContent = text;
    clearTimeout(hud.dialogueTimer);
    hud.dialogueTimer = setTimeout(() => { el.style.display = 'none'; }, 4200);
  };

  // Respect meter: one star per completed story job (0–7), shown under the
  // money readout. Presentation only — it reads M.completed, never drives it.
  hud.respectEl = null;
  hud.setRespect = (n) => {
    if (!hud.respectEl) {
      const d = doc.createElement('div');
      d.style.cssText = 'font-size:12px;font-weight:700;letter-spacing:2px;color:#ffc46a;margin-top:2px;';
      hud.moneyEl.parentElement.appendChild(d);
      hud.respectEl = d;
    }
    const done = Math.max(0, Math.min(7, n));
    hud.respectEl.textContent = 'RESPECT ' + '★'.repeat(done) + '☆'.repeat(7 - done) + ' ' + done + '/7';
  };

  // Vehicle condition bar: lives in the speed panel, only while driving.
  // Created on first use; the fill colour runs green → amber → red.
  hud.condEl = null; hud.condFill = null;
  hud.setCondition = (pct, inCar) => {
    if (!hud.condEl) {
      const wrap = doc.createElement('div');
      wrap.style.cssText = 'margin-top:6px;text-align:right;font-size:11px;font-weight:700;letter-spacing:1px;';
      const lab = doc.createElement('div');
      lab.textContent = 'CONDITION';
      lab.style.cssText = 'opacity:0.8;margin-bottom:2px;';
      const bar = doc.createElement('div');
      bar.style.cssText = 'height:8px;background:rgba(255,255,255,0.18);border-radius:4px;overflow:hidden;';
      const fill = doc.createElement('div');
      fill.style.cssText = 'height:100%;width:100%;background:#4fc46a;border-radius:4px;';
      bar.appendChild(fill);
      wrap.appendChild(lab); wrap.appendChild(bar);
      hud.speedWrap.appendChild(wrap);
      hud.condEl = wrap; hud.condFill = fill;
    }
    hud.condEl.style.display = inCar ? 'block' : 'none';
    if (!inCar) return;
    const p = Math.max(0, Math.min(100, pct));
    hud.condFill.style.width = p + '%';
    hud.condFill.style.background = p > 50 ? '#4fc46a' : p > 25 ? '#e0a83c' : '#d94f3d';
  };

  hud.setHealth = (hp) => {
    const pct = Math.max(0, Math.min(100, hp));
    hud.hpFill.style.width = pct + '%';
    hud.hpFill.style.background = pct > 50 ? '#4fc46a' : pct > 25 ? '#e0a83c' : '#d94f3d';
    hud.hpText.textContent = Math.ceil(pct);
  };
  hud.setMoney = (m) => { hud.moneyEl.textContent = money(m); };
  hud.setWanted = (stars) => {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < stars ? '★' : '☆';
    hud.starsEl.textContent = s;
    hud.starsEl.classList.toggle('hot', stars >= 3);
  };
  hud.setMission = (title, text, dist) => {
    hud.missionTitle.textContent = title;
    hud.missionText.textContent = text;
    hud.missionDist.textContent = dist == null ? '' : dist + ' m';
  };
  hud.setSpeed = (kmh, inCar) => {
    hud.speedWrap.style.display = inCar ? 'block' : 'none';
    hud.speedEl.textContent = Math.round(kmh);
  };
  hud.setWeapon = (label) => {
    hud.weaponEl.style.display = label ? 'block' : 'none';
    hud.weaponEl.textContent = label || '';
    // Crosshair shows for any owned weapon, not just the pistol.
    hud.crosshair.style.display = label ? 'block' : 'none';
  };
  hud.setClock = (label) => { hud.clockEl.textContent = label; };
  hud.damageFlash = () => {
    hud.vignette.style.opacity = '0.85';
    setTimeout(() => { hud.vignette.style.opacity = '0'; }, 180);
  };

  // Minimap: scale the city into the canvas, draw roads, then actors.
  hud.drawMinimap = (state) => {
    const c = hud.ctx, S = hud.minimap.width;
    const cx = S / 2, cy = S / 2;
    const scale = S / (CITY_EDGE * 2 + 40);
    const px = (x) => cx + x * scale;
    const pz = (z) => cy + z * scale;
    c.clearRect(0, 0, S, S);
    // Round mask is CSS; paint the disc background here.
    c.fillStyle = '#20262e';
    c.beginPath(); c.arc(cx, cy, S / 2, 0, Math.PI * 2); c.fill();
    c.save();
    c.beginPath(); c.arc(cx, cy, S / 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#2c333c';
    c.fillRect(0, 0, S, S);
    // Roads.
    c.strokeStyle = '#4a5058';
    c.lineWidth = 7;
    for (const rc of state.roads) {
      c.beginPath(); c.moveTo(px(rc), 0); c.lineTo(px(rc), S); c.stroke();
      c.beginPath(); c.moveTo(0, pz(rc)); c.lineTo(S, pz(rc)); c.stroke();
    }
    c.strokeStyle = '#d8c95a';
    c.lineWidth = 1;
    c.setLineDash([4, 5]);
    for (const rc of state.roads) {
      c.beginPath(); c.moveTo(px(rc), 0); c.lineTo(px(rc), S); c.stroke();
      c.beginPath(); c.moveTo(0, pz(rc)); c.lineTo(S, pz(rc)); c.stroke();
    }
    c.setLineDash([]);
    // Safehouse (green house dot).
    c.fillStyle = '#4fc46a';
    c.beginPath(); c.arc(px(state.safehouse.x), pz(state.safehouse.z), 4, 0, Math.PI * 2); c.fill();
    // Pistol pickups (green dots).
    c.fillStyle = '#7dff8a';
    for (const pk of state.pickups) {
      if (pk.taken) continue;
      c.beginPath(); c.arc(px(pk.x), pz(pk.z), 3, 0, Math.PI * 2); c.fill();
    }
    // Traffic (white dots) and police (blue/red flashing dots).
    c.fillStyle = '#e8e8e8';
    for (const t of state.traffic) {
      c.beginPath(); c.arc(px(t.x), pz(t.z), 2.5, 0, Math.PI * 2); c.fill();
    }
    // Pedestrians (amber dots) — the streets read as lived-in on the map.
    if (state.peds) {
      c.fillStyle = '#e0a83c';
      for (const pd of state.peds) {
        if (!pd.alive) continue;
        c.beginPath(); c.arc(px(pd.x), pz(pd.z), 1.8, 0, Math.PI * 2); c.fill();
      }
    }
    const flash = Math.floor(performance.now() / 300) % 2 === 0;
    c.fillStyle = flash ? '#ff2a22' : '#2266ff';
    for (const p of state.police) {
      c.beginPath(); c.arc(px(p.x), pz(p.z), 3.5, 0, Math.PI * 2); c.fill();
    }
    // Courier (purple) for the tail mission.
    if (state.courier) {
      c.fillStyle = '#c65fd9';
      c.beginPath(); c.arc(px(state.courier.x), pz(state.courier.z), 3.5, 0, Math.PI * 2); c.fill();
    }
    // Mission marker (gold pulsing ring).
    if (state.marker) {
      const r = 5 + Math.sin(performance.now() / 250) * 1.5;
      c.strokeStyle = '#ffc46a';
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(px(state.marker.x), pz(state.marker.z), r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#ffc46a';
      c.beginPath(); c.arc(px(state.marker.x), pz(state.marker.z), 2.5, 0, Math.PI * 2); c.fill();
    }
    // Player arrow, rotated to the heading — Rook's teal, so the player
    // reads distinct from the white traffic dots on the map.
    c.save();
    c.translate(px(state.player.x), pz(state.player.z));
    c.rotate(-state.player.heading + Math.PI / 2);
    c.fillStyle = '#14d8b8';
    c.strokeStyle = '#062a24';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath();
    c.fill(); c.stroke();
    c.restore();
    // Police response panel: count + distance-derived status. Our police
    // only patrol/chase/ram, so the status comes from the nearest unit's
    // distance to the player, not from a state machine.
    const cops = state.police || [];
    let copStatus = 'CLEAR', copDist = null;
    if (cops.length) {
      let dmin = 1e9;
      for (const pc of cops) {
        const d = Math.hypot(pc.x - state.player.x, pc.z - state.player.z);
        if (d < dmin) dmin = d;
      }
      copDist = Math.round(dmin);
      copStatus = dmin < 40 ? 'CHASING' : dmin < 120 ? 'CLOSING' : 'PATROLLING';
    }
    const copText = `POLICE ${cops.length} · ${copStatus}` + (copDist == null ? '' : ` · ${copDist}m`);
    const copColor = copStatus === 'CHASING' ? '#ff4a3d' : copStatus === 'CLOSING' ? '#ffb020' : copStatus === 'PATROLLING' ? '#9fd8ff' : '#4fc46a';
    c.font = 'bold 11px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const copW = c.measureText(copText).width + 12;
    c.fillStyle = 'rgba(8,10,14,0.6)';
    c.fillRect(cx - copW / 2, 26, copW, 16);
    c.fillStyle = copColor;
    c.fillText(copText, cx, 34);
    // District label: coarse quadrant from the player position.
    const district = districtAt(state.player.x, state.player.z);
    c.font = 'bold 11px sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText(district, cx, S - 16);
    c.restore();
    // Ring border.
    c.strokeStyle = '#0a0c0e';
    c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, S / 2 - 2, 0, Math.PI * 2); c.stroke();
  };

  // Full-screen map: a DOM overlay with a big canvas. Same data shape as
  // drawMinimap (plus garage, SMG pickup and heli when the game passes
  // them). The game pauses while it is open; Esc / M closes it.
  hud.bigMapEl = null; hud.bigMapCanvas = null; hud.bigMapCtx = null;
  hud.openBigMap = (state) => {
    if (!hud.bigMapEl) {
      const d = doc.createElement('div');
      d.id = 'bigmap';
      d.style.cssText = 'position:fixed;inset:0;z-index:8;display:none;align-items:center;justify-content:center;flex-direction:column;background:rgba(8,10,14,0.92);pointer-events:auto;';
      const title = doc.createElement('div');
      title.style.cssText = 'font-size:22px;font-weight:900;letter-spacing:4px;color:#ffc46a;margin-bottom:10px;';
      title.textContent = 'SOLMAR BAY — CITY MAP';
      const cv = doc.createElement('canvas');
      cv.width = 640; cv.height = 640;
      cv.style.cssText = 'width:min(70vmin,560px);height:min(70vmin,560px);border:2px solid rgba(255,255,255,0.3);border-radius:8px;';
      const legend = doc.createElement('div');
      legend.style.cssText = 'margin-top:10px;font-size:13px;opacity:0.9;';
      legend.innerHTML = '<span style="color:#14d8b8">▲ YOU</span> &nbsp; <span style="color:#ffc46a">◎ JOB</span> &nbsp; <span style="color:#ff4a3d">● POLICE</span> &nbsp; <span style="color:#ff2a55">H HELI</span> &nbsp; <span style="color:#4fc46a">● SAFEHOUSE</span> &nbsp; <span style="color:#7dff8a">● PICKUP</span> &nbsp; M / Esc to close — game paused';
      d.appendChild(title); d.appendChild(cv); d.appendChild(legend);
      doc.body.appendChild(d);
      hud.bigMapEl = d; hud.bigMapCanvas = cv; hud.bigMapCtx = cv.getContext('2d');
    }
    hud.bigMapEl.style.display = 'flex';
    hud.drawBigMap(state);
  };
  hud.closeBigMap = () => {
    if (hud.bigMapEl) hud.bigMapEl.style.display = 'none';
  };
  hud.drawBigMap = (state) => {
    if (!state || !hud.bigMapCtx) return;
    const c = hud.bigMapCtx, S = 640;
    const scale = S / (CITY_EDGE * 2 + 40);
    const px = (x) => S / 2 + x * scale;
    const pz = (z) => S / 2 + z * scale;
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#20262e';
    c.fillRect(0, 0, S, S);
    // District quadrants: central DOWNTOWN square + four named regions.
    const regions = [
      { x0: -80, x1: 80, z0: -80, z1: 80, name: 'DOWNTOWN', fill: '#2a323c' },
      { x0: -CITY_EDGE, x1: -80, z0: -CITY_EDGE, z1: -80, name: 'NORTH HARBOUR', fill: '#26303a' },
      { x0: 80, x1: CITY_EDGE, z0: -CITY_EDGE, z1: -80, name: 'MARINA HEIGHTS', fill: '#2e2a33' },
      { x0: -CITY_EDGE, x1: -80, z0: 80, z1: CITY_EDGE, name: 'OLD PIER', fill: '#2b2f2a' },
      { x0: 80, x1: CITY_EDGE, z0: 80, z1: CITY_EDGE, name: 'DOCKSIDE', fill: '#2a2f33' },
    ];
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const r of regions) {
      c.fillStyle = r.fill;
      c.fillRect(px(r.x0), pz(r.z0), (r.x1 - r.x0) * scale, (r.z1 - r.z0) * scale);
    }
    // Roads.
    c.strokeStyle = '#4a5058';
    c.lineWidth = 10;
    for (const rc of state.roads) {
      c.beginPath(); c.moveTo(px(rc), 0); c.lineTo(px(rc), S); c.stroke();
      c.beginPath(); c.moveTo(0, pz(rc)); c.lineTo(S, pz(rc)); c.stroke();
    }
    c.strokeStyle = '#d8c95a';
    c.lineWidth = 1.5;
    c.setLineDash([6, 7]);
    for (const rc of state.roads) {
      c.beginPath(); c.moveTo(px(rc), 0); c.lineTo(px(rc), S); c.stroke();
      c.beginPath(); c.moveTo(0, pz(rc)); c.lineTo(S, pz(rc)); c.stroke();
    }
    c.setLineDash([]);
    // District names go on AFTER the roads, or the road strokes clip them.
    for (const r of regions) {
      c.font = 'bold 15px sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillText(r.name, (px(r.x0) + px(r.x1)) / 2, (pz(r.z0) + pz(r.z1)) / 2);
    }
    // Safehouse + garage.
    if (state.safehouse) {
      c.fillStyle = '#4fc46a';
      c.beginPath(); c.arc(px(state.safehouse.x), pz(state.safehouse.z), 7, 0, Math.PI * 2); c.fill();
      c.font = 'bold 12px sans-serif'; c.fillStyle = '#4fc46a';
      c.fillText('SAFEHOUSE', px(state.safehouse.x), pz(state.safehouse.z) - 14);
    }
    if (state.garage) {
      c.fillStyle = '#e0a83c';
      c.beginPath(); c.arc(px(state.garage.x), pz(state.garage.z), 6, 0, Math.PI * 2); c.fill();
      c.font = 'bold 12px sans-serif'; c.fillStyle = '#e0a83c';
      c.fillText('GARAGE', px(state.garage.x), pz(state.garage.z) - 14);
    }
    // Pickups.
    c.fillStyle = '#7dff8a';
    for (const pk of state.pickups || []) {
      if (pk.taken) continue;
      c.beginPath(); c.arc(px(pk.x), pz(pk.z), 5, 0, Math.PI * 2); c.fill();
    }
    if (state.smgPickup && !state.smgPickup.taken) {
      c.fillStyle = '#ffc46a';
      c.beginPath(); c.arc(px(state.smgPickup.x), pz(state.smgPickup.z), 6, 0, Math.PI * 2); c.fill();
    }
    // Traffic + peds.
    c.fillStyle = '#e8e8e8';
    for (const t of state.traffic || []) {
      c.beginPath(); c.arc(px(t.x), pz(t.z), 4, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#e0a83c';
    for (const pd of state.peds || []) {
      if (!pd.alive) continue;
      c.beginPath(); c.arc(px(pd.x), pz(pd.z), 3, 0, Math.PI * 2); c.fill();
    }
    // Police (flashing) + helicopter.
    const flash = Math.floor(performance.now() / 300) % 2 === 0;
    c.fillStyle = flash ? '#ff2a22' : '#2266ff';
    for (const p of state.police || []) {
      c.beginPath(); c.arc(px(p.x), pz(p.z), 6, 0, Math.PI * 2); c.fill();
    }
    if (state.heli) {
      c.fillStyle = '#ff2a55';
      c.beginPath(); c.arc(px(state.heli.x), pz(state.heli.z), 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.font = 'bold 11px sans-serif';
      c.fillText('H', px(state.heli.x), pz(state.heli.z));
    }
    if (state.courier) {
      c.fillStyle = '#c65fd9';
      c.beginPath(); c.arc(px(state.courier.x), pz(state.courier.z), 6, 0, Math.PI * 2); c.fill();
    }
    // Mission marker.
    if (state.marker) {
      const r = 10 + Math.sin(performance.now() / 250) * 2;
      c.strokeStyle = '#ffc46a'; c.lineWidth = 3;
      c.beginPath(); c.arc(px(state.marker.x), pz(state.marker.z), r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#ffc46a';
      c.beginPath(); c.arc(px(state.marker.x), pz(state.marker.z), 4, 0, Math.PI * 2); c.fill();
    }
    // Player arrow.
    c.save();
    c.translate(px(state.player.x), pz(state.player.z));
    c.rotate(-state.player.heading + Math.PI / 2);
    c.fillStyle = '#14d8b8';
    c.strokeStyle = '#062a24'; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -12); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10); c.closePath();
    c.fill(); c.stroke();
    c.restore();
    // Current district, bottom centre.
    c.font = 'bold 15px sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillText('YOU ARE IN ' + districtAt(state.player.x, state.player.z), S / 2, S - 18);
  };

  return hud;
}
