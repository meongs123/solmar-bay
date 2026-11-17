// HUD for SOLMAR BAY: health bar, money, wanted stars, mission panel,
// speed, toasts, damage vignette and a live round minimap drawn on canvas.
// The minimap is north-up: roads, the player arrow, traffic, police, the
// mission marker, the safehouse and pistol pickups.
import { money } from './util.js';
import { CITY_EDGE } from './city.js';

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
    hud.crosshair.style.display = label && label.startsWith('PISTOL') ? 'block' : 'none';
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
    // Player arrow, rotated to the heading.
    c.save();
    c.translate(px(state.player.x), pz(state.player.z));
    c.rotate(-state.player.heading + Math.PI / 2);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#111111';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath();
    c.fill(); c.stroke();
    c.restore();
    c.restore();
    // Ring border.
    c.strokeStyle = '#0a0c0e';
    c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, S / 2 - 2, 0, Math.PI * 2); c.stroke();
  };

  return hud;
}
